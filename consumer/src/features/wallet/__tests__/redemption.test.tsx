import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import WalletPage from '../WalletPage'

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
})
afterEach(() => vi.unstubAllGlobals())

it('keeps a successful redemption receipt and offers a read-only refresh when balance loading fails', async () => {
  let refreshAvailable = false
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/status')
      return Response.json({ success: true, data: { quota_per_unit: 500000 } })
    if (path === '/api/user/topup/info')
      return Response.json({ success: true, data: { enable_redemption: true, pay_methods: [] } })
    if (path === '/api/subscription/self')
      return Response.json({ success: true, data: { subscriptions: [], all_subscriptions: [] } })
    if (path === '/api/user/topup') return Response.json({ success: true, data: 500000 })
    if (path === '/api/user/self')
      return Response.json(
        {
          success: false,
          message: refreshAvailable ? 'Session unavailable' : 'Refresh unavailable',
        },
        { status: 503 },
      )
    throw new Error(`Unexpected test request ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  cache.setQueryData(['topup-orders'], { items: [], total: 0 })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: WalletPage }),
    history: createMemoryHistory(),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={cache}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Redemption code' }), 'synthetic-code')
  await user.click(screen.getByRole('button', { name: 'Redeem code' }))
  expect(
    await screen.findByText(
      'Your code was redeemed. Refresh your balance to see the latest amount.',
    ),
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Redemption code' })).toHaveValue('')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await waitFor(() => expect(cache.getQueryState(['topup-orders'])?.isInvalidated).toBe(true))
  refreshAvailable = true
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable')
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/topup')).toHaveLength(1)
  expect(
    screen.getByText('Your code was redeemed. Refresh your balance to see the latest amount.'),
  ).toBeVisible()
})

it('shows ordinary and configured VIP balances separately, including an empty paid bucket', async () => {
  acceptAuthBundle({
    access_token: 'synthetic-wallet-buckets',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    session: {
      sid: 'wallet-buckets',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
    user: {
      id: 72,
      username: 'buckets',
      display_name: '',
      email: '',
      role: 1,
      group: 'default',
      quota: 1000000,
      used_quota: 0,
      request_count: 0,
      quota_buckets: {
        enabled: true,
        paid_group: 'premium',
        groups: [{ billing_group: 'default', amount_remaining: 1000000 }],
      },
    },
  })
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  cache.setQueryData(['status'], { quota_per_unit: 500000, quota_display_type: 'USD' })
  cache.setQueryData(['topup-info'], { pay_methods: [] })
  cache.setQueryData(['subscriptions'], { subscriptions: [], all_subscriptions: [] })
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: WalletPage }),
    history: createMemoryHistory(),
  })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={cache}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const free = await screen.findByText('Default balance')
  const vip = screen.getByText('premium balance')
  expect(free.closest('div')).toHaveTextContent('$2.00')
  expect(vip.closest('div')).toHaveTextContent('$0.00')
  cache.clear()
})
