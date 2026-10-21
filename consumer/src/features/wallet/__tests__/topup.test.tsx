import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearAuth } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import WalletPage from '../WalletPage'

const clients: QueryClient[] = []

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([true, false])(
  'uses server currencies without guessing and continues one confirmed order (currency provided: %s)',
  async (currencyProvided) => {
    const replace = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue(
      currencyProvided
        ? ({
            opener: null,
            name: 'synthetic-checkout',
            closed: false,
            location: { replace },
            close: vi.fn(),
          } as unknown as Window)
        : null,
    )
    let finishQuote: (value: Response) => void = () => undefined
    let holdQuote = false
    const fetcher = vi.fn(async (path: string, _options?: RequestInit) => {
      if (path === '/api/status')
        return Response.json({
          success: true,
          data: { quota_per_unit: 500000, quota_display_type: 'USD' },
        })
      if (path === '/api/user/topup/info')
        return Response.json({
          success: true,
          data: {
            enable_online_topup: true,
            enable_waffo_topup: true,
            pay_methods: [
              { type: 'alipay', name: 'Alipay' },
              { type: 'waffo', name: 'Waffo' },
            ],
            request_amount_unit: 'USD',
            payment_currencies: currencyProvided ? { alipay: 'CNY', waffo: 'USD' } : {},
            request_min_topup: { epay: 2, waffo: 5 },
            amount_options: [1, 10, 25],
          },
        })
      if (path === '/api/subscription/self')
        return Response.json({
          success: true,
          data: {
            subscriptions: currencyProvided
              ? [{ subscription: { id: 1 } }, { subscription: { id: 2 } }]
              : [],
            all_subscriptions: [{ subscription: { id: 3, status: 'expired' } }],
          },
        })
      if (path.endsWith('/amount')) {
        if (holdQuote)
          return new Promise<Response>((resolve) => {
            finishQuote = resolve
          })
        return Response.json({ success: true, data: '9.50' })
      }
      if (path === '/api/user/waffo/pay')
        return Response.json({
          success: true,
          data: { pay_link: 'https://pay.example.test/checkout' },
        })
      throw new Error(`Unexpected test request ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    const router = createRouter({
      routeTree: createRootRoute({ component: WalletPage }),
      history: createMemoryHistory(),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const user = userEvent.setup()
    const alipay = await screen.findByRole('button', { name: 'Alipay' })
    expect(
      screen.getByRole('spinbutton', { name: 'Recharge amount' }).compareDocumentPosition(alipay) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'WeChat' })).not.toBeInTheDocument()
    const planLink = await screen.findByRole('link', { name: /Manage plans/ })
    expect(planLink).toHaveAttribute('href', '/plans')
    expect(planLink).toHaveTextContent(currencyProvided ? 'Active plans: 2' : 'No active plan')
    expect(
      planLink.compareDocumentPosition(screen.getByRole('heading', { name: 'Add balance' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your active plans' })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('Next reset')).not.toBeInTheDocument()
    expect(fetcher.mock.calls.some(([path]) => path === '/api/subscription/plans')).toBe(false)
    expect(alipay).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('combobox', { name: 'Payment method' })).not.toBeInTheDocument()
    expect(
      await screen.findByText(
        currencyProvided ? 'CN¥9.50' : '9.50 · Payment currency not provided by the server',
      ),
    ).toBeVisible()
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/pay'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
    const quoteSummary = screen.getByText('Quoted payment amount')
    const balanceLabel = screen.getByText('Balance increase')
    holdQuote = true
    await user.click(screen.getByRole('button', { name: '25' }))
    expect(screen.getByRole('spinbutton', { name: 'Recharge amount' })).toHaveValue(25)
    expect(screen.getByText('Quoted payment amount')).toBe(quoteSummary)
    expect(screen.getByText('Balance increase')).toBe(balanceLabel)
    expect(screen.getByRole('button', { name: 'Confirm and continue to payment' })).toBeDisabled()
    expect(screen.queryByText('CN¥9.50')).not.toBeInTheDocument()
    await act(async () =>
      finishQuote(
        Response.json(
          { success: false, message: 'Quote temporarily unavailable' },
          { status: 503 },
        ),
      ),
    )
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByText('Quoted payment amount')).toBe(quoteSummary)
    expect(screen.getByRole('button', { name: 'Confirm and continue to payment' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => finishQuote(Response.json({ success: true, data: '23.75' })))
    holdQuote = false
    await user.clear(screen.getByRole('spinbutton', { name: 'Recharge amount' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Recharge amount' }), '24')
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, options]) =>
            path === '/api/user/amount' && options?.body === JSON.stringify({ amount: 24 }),
        ),
      ).toBe(true),
    )
    expect(
      fetcher.mock.calls.some(
        ([path, options]) =>
          path.endsWith('/amount') && options?.body === JSON.stringify({ amount: 2 }),
      ),
    ).toBe(false)
    await user.clear(screen.getByRole('spinbutton', { name: 'Recharge amount' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Recharge amount' }), '1')
    expect(screen.getByRole('button', { name: 'Confirm and continue to payment' })).toBeDisabled()
    await user.clear(screen.getByRole('spinbutton', { name: 'Recharge amount' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Recharge amount' }), '10')
    holdQuote = true
    await user.clear(screen.getByRole('spinbutton', { name: 'Recharge amount' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Recharge amount' }), '12')
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, options]) =>
            path === '/api/user/amount' && options?.body === JSON.stringify({ amount: 12 }),
        ),
      ).toBe(true),
    )
    const oldQuote = finishQuote
    await user.click(screen.getByRole('button', { name: 'Waffo' }))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, options]) =>
            path === '/api/user/waffo/amount' && options?.body === JSON.stringify({ amount: 12 }),
        ),
      ).toBe(true),
    )
    expect(screen.getByRole('button', { name: 'Waffo' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => oldQuote(Response.json({ success: true, data: '99.99' })))
    expect(screen.queryByText('99.99')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm and continue to payment' })).toBeDisabled()
    finishQuote(Response.json({ success: true, data: '8.25' }))
    expect(
      await screen.findByText(
        currencyProvided ? '$8.25' : '8.25 · Payment currency not provided by the server',
      ),
    ).toBeVisible()
    expect(screen.getByText('Balance increase')).toBeVisible()
    await user.dblClick(screen.getByRole('button', { name: 'Confirm and continue to payment' }))
    expect(await screen.findByRole('link', { name: 'Open secure checkout' })).toBeVisible()
    const writes = fetcher.mock.calls.filter(([path]) => path.endsWith('/pay'))
    expect(writes).toHaveLength(1)
    if (currencyProvided) expect(replace).toHaveBeenCalledWith('https://pay.example.test/checkout')
    else expect(replace).not.toHaveBeenCalled()
    const paymentCall = fetcher.mock.calls.find(([path]) => path === '/api/user/waffo/pay')
    expect(JSON.parse((paymentCall as unknown as [string, RequestInit])[1].body as string)).toEqual(
      {
        amount: 12,
        payment_method: 'waffo',
      },
    )
    expect(screen.getByText(/Payment is confirmed only/)).toBeVisible()
  },
)
