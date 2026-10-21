import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth, getAuthSnapshot, updateAuthUser } from '@/lib/auth-state'
import { ModelPrice } from '../model-price'
beforeEach(() => clearAuth())
afterEach(() => vi.unstubAllGlobals())
it('retains the previous sample while updating and never labels it with the new inputs', async () => {
  let finish: ((value: Response) => void) | undefined
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const data = (input: number, usd: number) =>
    Response.json({
      success: true,
      data: {
        group: 'default',
        group_ratio: 1,
        input_tokens: input,
        output_tokens: 1000,
        image_count: 1,
        quotes: [{ billing_unit: 'token', usd }],
      },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      new URL(path, 'http://localhost').searchParams.get('input_tokens') === '2000'
        ? pending
        : data(1000, 0.006),
    ),
  )
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={new QueryClient()}>
        <ModelPrice model="chat" group="default" />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const statusSlot = screen.getByRole('status')
  expect(await screen.findByText('$0.006')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  const user = userEvent.setup()
  await user.clear(screen.getByRole('spinbutton', { name: 'Input tokens' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Input tokens' }), '2000')
  await user.click(screen.getByRole('button', { name: 'Calculate' }))
  expect(screen.getByText('$0.006')).toBeVisible()
  expect(screen.getByText('1,000 input + 1,000 output tokens')).toBeVisible()
  expect(screen.getByText('Updating price for this example…')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  await act(async () => finish?.(data(2000, 0.008)))
  expect(await screen.findByText('$0.008')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  expect(screen.getByText('2,000 input + 1,000 output tokens')).toBeVisible()
})

it('keeps plan previews separate from current prices and other plans while switching', async () => {
  let finish: ((value: Response) => void) | undefined
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const quote = (usd: number) =>
    Response.json({
      success: true,
      data: {
        group: 'codeplan',
        group_ratio: 1,
        quotes: [{ billing_unit: 'request', usd }],
      },
    })
  const fetcher = vi.fn(async (path: string) => {
    if (path.startsWith('/api/subscription/plans/9/pricing/quote?')) return quote(0.42)
    if (path.startsWith('/api/subscription/plans/10/pricing/quote?')) return pending
    if (path.startsWith('/api/pricing/quote?')) return quote(0.99)
    throw new Error('Unexpected quote endpoint')
  })
  vi.stubGlobal('fetch', fetcher)
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<ModelPrice model="chat" group="codeplan" planId={9} />, {
    wrapper: (props) => (
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
      </I18nextProvider>
    ),
  })
  expect(await screen.findByText('$0.42')).toBeVisible()
  view.rerender(<ModelPrice model="chat" group="codeplan" planId={10} />)
  expect(screen.queryByText('$0.42')).not.toBeInTheDocument()
  expect(screen.getByText('Checking current prices…')).toBeVisible()
  await act(async () => finish?.(quote(0.24)))
  expect(await screen.findByText('$0.24')).toBeVisible()
  view.rerender(<ModelPrice model="chat" group="codeplan" />)
  expect(screen.queryByText('$0.24')).not.toBeInTheDocument()
  expect(await screen.findByText('$0.99')).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(3)
  client.clear()
})

it.each([403, 404])(
  'hides cached plan prices and calculator when revalidation returns %s',
  async (status) => {
    let rejected = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        rejected
          ? Response.json({ success: false, message: 'Preview unavailable' }, { status })
          : Response.json({
              success: true,
              data: {
                group: 'codeplan',
                group_ratio: 2,
                quotes: [{ billing_unit: 'token', usd: 0.42 }],
              },
            }),
      ),
    )
    const language = createInstance()
    await language.init({ lng: 'en', resources: { en: { translation: {} } } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <ModelPrice model="chat" group="codeplan" planId={9} />
        </QueryClientProvider>
      </I18nextProvider>,
    )
    expect(await screen.findByText('$0.42')).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Input tokens' })).toBeVisible()
    rejected = true
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['model-price'] })
    })
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('$0.42')).not.toBeInTheDocument()
    expect(screen.queryByText('Includes 2× service plan multiplier')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Input tokens' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument()
    rejected = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('$0.42')).toBeVisible()
    client.clear()
  },
)

it('refreshes a plan price when the account group changes within the same session', async () => {
  acceptAuthBundle({
    access_token: 'synthetic-plan-price-session',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user: {
      id: 82,
      username: 'plan-fixture',
      display_name: 'Plan fixture',
      email: '',
      role: 1,
      group: 'default',
      quota: 0,
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
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      data: {
        group: 'codeplan',
        group_ratio: 1,
        quotes: [
          {
            billing_unit: 'request',
            usd: getAuthSnapshot().user?.group === 'codeplan' ? 0.24 : 0.42,
          },
        ],
      },
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient()
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <ModelPrice model="chat" group="codeplan" planId={9} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  expect(await screen.findByText('$0.42')).toBeVisible()
  act(() => updateAuthUser({ ...getAuthSnapshot().user!, group: 'codeplan' }))
  expect(screen.queryByText('$0.42')).not.toBeInTheDocument()
  expect(await screen.findByText('$0.24')).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(2)
  client.clear()
})
