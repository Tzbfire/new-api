import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth, getAuthSnapshot } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import { CheckoutDialog } from '../CheckoutDialog'
import PlansPage from '../PlansPage'
import { PaymentMethods } from '../PaymentMethods'
import { createCheckout, enabledMethods, paymentURL, type TopupInfo } from '../api'

beforeEach(() => {
  clearAuth()
  localStorage.clear()
  sessionStorage.clear()
  document.cookie = 'new_api_session=; Max-Age=0'
  document.cookie = 'new_api_has_session=; Max-Age=0'
})
afterEach(() => vi.unstubAllGlobals())

describe('provider checkout contracts', () => {
  it('keeps billing preference in the heading and saves it without starting a purchase', async () => {
    const subscriptionData = {
      billing_preference: 'subscription_first',
      subscriptions: [],
      all_subscriptions: [],
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(['status'], { quota_per_unit: 500000 })
    client.setQueryData(['plans'], [])
    client.setQueryData(['subscriptions'], subscriptionData)
    client.setQueryData(['topup-info'], { pay_methods: [] })
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        subscriptionData.billing_preference = JSON.parse(String(init.body)).billing_preference
      return Response.json({ success: true, data: subscriptionData })
    })
    vi.stubGlobal('fetch', fetcher)
    const language = createInstance()
    await language.init({ lng: 'en', resources: { en: { translation: {} } } })
    render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <PlansPage />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const header = (await screen.findByRole('heading', { name: 'Plans' })).closest('header')!
    const preference = within(header).getByRole('combobox', { name: 'Billing preference' })
    expect(
      screen.queryByRole('heading', { name: 'How you pay for requests' }),
    ).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(preference)
    await user.click(await screen.findByRole('option', { name: 'Use wallet only' }))
    await waitFor(() => expect(preference).toHaveTextContent('Use wallet only'))
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([
      [
        '/api/subscription/self/preference',
        expect.objectContaining({ body: JSON.stringify({ billing_preference: 'wallet_only' }) }),
      ],
    ])
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/pay'))).toBe(false)
    client.clear()
  })

  it('closes a successful balance purchase even when refreshing the account fails', async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/status')
        return Response.json({ success: true, data: { quota_per_unit: 500000 } })
      if (path === '/api/subscription/plans')
        return Response.json({
          success: true,
          data: [
            {
              plan: {
                id: 8,
                title: 'Everyday plan',
                subtitle: 'Test allowance',
                price_amount: 10,
                currency: 'USD',
                duration_unit: 'month',
                duration_value: 1,
                total_amount: 5000000,
                quota_reset_period: 'never',
                allow_balance_pay: true,
              },
            },
          ],
        })
      if (path === '/api/user/topup/info')
        return Response.json({ success: true, data: { pay_methods: [] } })
      if (path === '/api/subscription/self')
        return Response.json({
          success: true,
          data: {
            billing_preference: 'subscription_first',
            subscriptions: [],
            all_subscriptions: [],
          },
        })
      if (path === '/api/subscription/balance/pay')
        return Response.json({ success: true, data: null })
      if (path === '/api/user/self')
        return Response.json({ success: false, message: 'Refresh unavailable' }, { status: 503 })
      throw new Error(`Unexpected test request ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SessionProvider>
            <PlansPage />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Choose plan' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }))
    expect(
      await screen.findByText(
        'Your plan was purchased. Refresh your balance to see the latest amount.',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirm purchase' })).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.filter(([path]) => path === '/api/subscription/balance/pay'),
    ).toHaveLength(1)
  })
  it.each([true, false])(
    'offers VIP purchase independently of ordinary balance policy (%s)',
    async (allowBalancePay) => {
      const { fetcher, client } = await renderPlanPreview({ bucketBilling: true, allowBalancePay })
      await userEvent.click(await screen.findByRole('button', { name: 'Choose plan' }))
      expect(await screen.findByRole('button', { name: 'Pay with premium balance' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Wallet balance' })).not.toBeInTheDocument()
      expect(screen.getByText(/premium balance:/)).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: 'Confirm purchase' }))
      await waitFor(() =>
        expect(
          fetcher.mock.calls.filter(([path]) => path === '/api/subscription/wallet/pay'),
        ).toHaveLength(1),
      )
      expect(fetcher.mock.calls.some(([path]) => path === '/api/subscription/balance/pay')).toBe(
        false,
      )
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Confirm purchase' })).not.toBeInTheDocument(),
      )
      client.clear()
    },
  )

  it('keeps a legacy plan without balance redemption unavailable when bucket billing is off', async () => {
    const { client } = await renderPlanPreview({ bucketBilling: false, allowBalancePay: false })
    await userEvent.click(await screen.findByRole('button', { name: 'Choose plan' }))
    expect(
      screen.queryByRole('button', { name: 'Pay with premium balance' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wallet balance' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm purchase' })).toBeDisabled()
    client.clear()
  })

  it.each([
    { selectableNow: true, selectableAfterPurchase: true },
    { selectableNow: false, selectableAfterPurchase: true },
    { selectableNow: false, selectableAfterPurchase: false },
  ])(
    'previews plan models and server prices without requiring current group access: %j',
    async (permissions) => {
      const { fetcher, client } = await renderPlanPreview(permissions)
      await userEvent.click(await screen.findByRole('button', { name: 'codeplan' }))
      expect(await screen.findByText('Plan code model')).toBeVisible()
      expect(await screen.findByText('$0.42')).toBeVisible()
      expect(screen.getByText('Plan model preview')).toBeVisible()
      expect(
        screen.getByText(
          'Prices use current rules for account group codeplan after purchase. Final charges follow the rules in effect when used.',
        ),
      ).toBeVisible()
      expect(
        screen
          .getByRole('heading', { name: 'Your active plans', hidden: true })
          .compareDocumentPosition(
            screen.getByRole('heading', { name: 'Available plans', hidden: true }),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      await userEvent.click(
        screen.getByRole('button', { name: 'View pricing for Plan code model' }),
      )
      expect(await screen.findByText('Usage estimate and billing details')).toBeVisible()
      await waitFor(() => expect(screen.getAllByText('$0.42')).toHaveLength(2))
      expect(screen.queryByText('Other group model')).not.toBeInTheDocument()
      if (!permissions.selectableAfterPurchase)
        expect(
          screen.getByText(
            'This plan covers spending in this group but does not grant access. Contact the administrator before purchasing.',
          ),
        ).toBeVisible()
      else if (!permissions.selectableNow)
        expect(screen.getByText('Available after purchasing this plan.')).toBeVisible()
      expect(
        fetcher.mock.calls.some(
          ([path]) => path === '/api/subscription/plans/9/pricing?group=codeplan',
        ),
      ).toBe(true)
      expect(
        fetcher.mock.calls.some(([path]) =>
          path.startsWith(
            '/api/subscription/plans/9/pricing/quote?model=Plan%20code%20model&group=codeplan',
          ),
        ),
      ).toBe(true)
      expect(
        fetcher.mock.calls.some(
          ([path]) => path.startsWith('/api/pricing') || path.startsWith('/api/user/models'),
        ),
      ).toBe(false)
      expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
        true,
      )
      expect(getAuthSnapshot().user?.group).toBe('default')
      client.clear()
    },
  )
  it('opens group choices for an unrestricted plan and requests its server preview', async () => {
    const { client, fetcher } = await renderPlanPreview({ unrestricted: true })
    await userEvent.click(await screen.findByRole('button', { name: 'All available groups' }))
    expect(await screen.findByText('Plan code model')).toBeVisible()
    expect(await screen.findByText('$0.42')).toBeVisible()
    expect(
      fetcher.mock.calls.some(
        ([path]) => path === '/api/subscription/plans/9/pricing?group=default',
      ),
    ).toBe(true)
    client.clear()
  })
  it('keeps server price previews separate for plans covering the same group', async () => {
    const { client, fetcher } = await renderPlanPreview({ secondPlan: true })
    const buttons = await screen.findAllByRole('button', { name: 'codeplan' })
    await userEvent.click(buttons[0])
    expect(await screen.findByText('$0.42')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(buttons[1])
    expect(await screen.findByText('$0.84')).toBeVisible()
    expect(screen.queryByText('$0.42')).not.toBeInTheDocument()
    expect(
      fetcher.mock.calls.some(([path]) =>
        path.startsWith('/api/subscription/plans/10/pricing/quote?'),
      ),
    ).toBe(true)
    client.clear()
  })
  it.each(['empty', 'disabled', 'error'] as const)(
    'shows a truthful %s plan preview without borrowing the account catalog',
    async (result) => {
      const { client, fetcher } = await renderPlanPreview({ result })
      await userEvent.click(await screen.findByRole('button', { name: 'codeplan' }))
      if (result === 'empty') {
        expect(
          await screen.findByText('No models are configured for this plan group yet.'),
        ).toBeVisible()
        expect(
          screen.queryByText('Only models authorized for your account are shown.'),
        ).not.toBeInTheDocument()
      } else {
        expect(await screen.findByRole('alert')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
      }
      expect(screen.queryByText('Other group model')).not.toBeInTheDocument()
      expect(fetcher.mock.calls.some(([path]) => path.includes('/pricing/quote'))).toBe(false)
      client.clear()
    },
  )
  it('preserves the EPay form and sends its requested amount only once', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        message: 'success',
        url: 'https://pay.example.test/submit',
        data: { amount: '10', sign: 'synthetic-signature' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await createCheckout('/api/user/pay', { amount: 10, payment_method: 'alipay' })
    expect(result).toEqual({
      url: 'https://pay.example.test/submit',
      fields: { amount: '10', sign: 'synthetic-signature' },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      amount: 10,
      payment_method: 'alipay',
    })
    expect(fetch.mock.calls[0][1].credentials).toBe('same-origin')
  })
  it.each(['pay_link', 'checkout_url', 'payment_url'])(
    'accepts %s without retaining provider tokens',
    async (key) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json({
            message: 'success',
            data: {
              [key]: 'https://pay.example.test/checkout',
              token: 'synthetic-private-token',
            },
          }),
        ),
      )
      const result = await createCheckout('/api/user/stripe/pay', { amount: 10 })
      expect(result).toEqual({ url: 'https://pay.example.test/checkout' })
      expect(localStorage.length).toBe(0)
      expect(sessionStorage.length).toBe(0)
    },
  )
  it('does not retry a purchase when the server rejects authorization', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ success: false, message: 'Please sign in to continue' }, { status: 401 }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(createCheckout('/api/subscription/balance/pay', { plan_id: 4 })).rejects.toThrow(
      'Please sign in',
    )
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'https://user:secret@pay.example.test'])(
    'rejects unsafe checkout URL %s',
    (url) => {
      expect(() => paymentURL(url)).toThrow('invalid')
    },
  )
  it('does not expose payment methods disabled by the server', () => {
    expect(
      enabledMethods({
        enable_online_topup: false,
        enable_stripe_topup: true,
        enable_waffo_topup: false,
        pay_methods: [
          { type: 'alipay', name: 'AliPay' },
          { type: 'stripe', name: 'Stripe' },
          { type: 'waffo', name: 'Waffo' },
        ],
      } as TopupInfo),
    ).toEqual([{ type: 'stripe', name: 'Stripe' }])
  })
  it('shows only Alipay when the server explicitly configures only Alipay', () => {
    const info = {
      enable_online_topup: true,
      pay_methods: [{ type: 'alipay', name: 'Alipay' }],
    } as TopupInfo
    render(
      <PaymentMethods
        label="Payment method"
        methods={enabledMethods(info)}
        value="alipay"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Alipay' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: /WeChat|微信|custom1|自定义/i }),
    ).not.toBeInTheDocument()
  })
  it('keeps only explicitly enabled nonempty unique server methods', () => {
    const info = {
      enable_online_topup: true,
      enable_stripe_topup: false,
      pay_methods: [
        { type: 'alipay', name: 'Alipay' },
        { type: ' alipay ', name: 'Duplicate' },
        { type: ' ', name: 'Empty type' },
        { type: 'custom1', name: ' ' },
        { type: 'stripe', name: 'Stripe' },
        { type: 'waffo', name: 'Waffo' },
      ],
    } as TopupInfo
    expect(enabledMethods(info)).toEqual([{ type: 'alipay', name: 'Alipay' }])
    expect(
      enabledMethods({ ...info, enable_online_topup: 'true' } as unknown as TopupInfo),
    ).toEqual([])
  })
  it('opens external payment only on user interaction and refreshes without declaring payment success', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    const refresh = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <CheckoutDialog
            checkout={{ url: 'https://pay.example.test/checkout' }}
            onClose={() => {}}
            onRefresh={refresh}
          />
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const link = await screen.findByRole('link', { name: 'Open secure checkout' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(refresh).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'I have paid · Refresh' }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByText(/Payment is confirmed only/)).toBeVisible()
  })
})

async function renderPlanPreview(
  options: {
    bucketBilling?: boolean
    allowBalancePay?: boolean
    selectableNow?: boolean
    selectableAfterPurchase?: boolean
    secondPlan?: boolean
    unrestricted?: boolean
    result?: 'empty' | 'disabled' | 'error'
  } = {},
) {
  acceptAuthBundle({
    access_token: 'synthetic-plan-preview-session',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user: {
      id: 82,
      username: 'plan-fixture',
      display_name: 'Plan fixture',
      email: '',
      role: 1,
      group: 'default',
      quota: 5000000,
      quota_buckets: {
        enabled: options.bucketBilling ?? false,
        paid_group: 'premium',
        groups: [
          { billing_group: 'default', amount_remaining: 4000000 },
          { billing_group: 'premium', amount_remaining: 1000000 },
        ],
      },
      used_quota: 0,
      request_count: 0,
    },
    session: {
      sid: 'plan-fixture',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const model = {
    model_name: 'Plan code model',
    supported_endpoint_types: ['openai'],
    enable_groups: ['codeplan'],
  }
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path === '/api/status') return Response.json({ success: true, data: {} })
    if (path === '/api/subscription/plans')
      return Response.json({
        success: true,
        data: (options.secondPlan ? [9, 10] : [9]).map((id) => ({
          plan: {
            id,
            title: `Code plan ${id}`,
            currency: 'USD',
            price_amount: 10,
            allow_balance_pay: options.allowBalancePay,
            allowed_token_groups: options.unrestricted ? '' : 'codeplan',
            duration_unit: 'month',
            duration_value: 1,
            total_amount: 0,
            quota_reset_period: 'never',
          },
        })),
      })
    if (path === '/api/subscription/self')
      return Response.json({ success: true, data: { subscriptions: [], all_subscriptions: [] } })
    if (path === '/api/user/topup/info')
      return Response.json({ success: true, data: { pay_methods: [] } })
    if (/^\/api\/subscription\/plans\/\d+\/pricing\?/.test(path)) {
      if (options.result === 'disabled')
        return Response.json({ success: false, message: 'Plan is no longer available' })
      if (options.result === 'error')
        return Response.json({ success: false, message: 'Preview unavailable' }, { status: 503 })
      return Response.json({
        success: true,
        data: {
          group: 'codeplan',
          group_ratio: 2,
          purchase_user_group: 'codeplan',
          selectable_now: options.selectableNow ?? false,
          selectable_after_purchase: options.selectableAfterPurchase ?? true,
          models: options.result === 'empty' ? [] : [model],
        },
      })
    }
    if (/^\/api\/subscription\/plans\/\d+\/pricing\/quote\?/.test(path))
      return Response.json({
        success: true,
        data: {
          group: 'codeplan',
          group_ratio: 2,
          quotes: [
            {
              label: 'Code model',
              billing_mode: 'per_call',
              billing_unit: 'request',
              usd: path.includes('/10/') ? 0.84 : 0.42,
            },
          ],
        },
      })
    if (path === '/api/subscription/wallet/pay') return Response.json({ success: true, data: {} })
    if (path === '/api/user/self')
      return Response.json({ success: true, data: getAuthSnapshot().user })
    // The general catalog deliberately contains no access to the plan group.
    if (path === '/api/pricing')
      return Response.json({
        success: true,
        data: [model],
        usable_group: { default: 'Default' },
        group_ratio: { default: 1 },
      })
    if (path === '/api/user/self/groups')
      return Response.json({ success: true, data: { default: { desc: 'Default', ratio: 1 } } })
    if (path.startsWith('/api/user/models')) return Response.json({ success: true, data: [] })
    throw new Error(`Unexpected test request ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <PlansPage />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { client, fetcher }
}
