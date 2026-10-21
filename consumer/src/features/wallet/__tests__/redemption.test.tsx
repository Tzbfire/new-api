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
import { clearAuth } from '@/lib/auth-state'
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
