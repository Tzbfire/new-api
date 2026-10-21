import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth, type AuthBundle } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import LandingPage from '../LandingPage'

const bundle: AuthBundle = {
  access_token: 'synthetic-landing-token',
  token_type: 'Bearer',
  access_expires_at: Math.floor(Date.now() / 1000) + 900,
  session: {
    sid: 'landing-session',
    current: true,
    login_method: 'password',
    ip: '',
    user_agent: '',
    created_at: 1,
    last_active_at: 1,
    expires_at: 9999999999,
  },
  user: {
    id: 8,
    username: 'designer',
    display_name: 'Studio Designer',
    email: '',
    role: 1,
    group: 'default',
    quota: 0,
    used_quota: 0,
    request_count: 0,
  },
}
let client: QueryClient
afterEach(() => {
  cleanup()
  client?.clear()
  clearAuth()
  document.cookie = 'new_api_has_session=;max-age=0;path=/'
  vi.unstubAllGlobals()
})

async function showHome() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: LandingPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  await screen.findByRole('navigation', { name: 'Main navigation' })
}

it('opens the workspace from the homepage and updates after sign-out without a reload', async () => {
  document.cookie = 'new_api_has_session=1;path=/'
  acceptAuthBundle(bundle)
  await showHome()
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', '/chat')
  expect(screen.getByRole('link', { name: /Continue chatting/ })).toHaveAttribute('href', '/chat')
  act(() => clearAuth())
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Open workspace' })).not.toBeInTheDocument()
})

it('restores the homepage account from the server after a page load', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=1;path=/'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: bundle })))
  await showHome()
  expect(await screen.findByRole('link', { name: 'Open workspace' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
})

it('does not treat a session hint as authenticated when restoration is rejected', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=1;path=/'
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ success: false }, { status: 401 })),
  )
  await showHome()
  expect(await screen.findByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Open workspace' })).not.toBeInTheDocument()
})

it('keeps the sign-in entry available when session restoration is temporarily unavailable', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=1;path=/'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
  await showHome()
  expect(await screen.findByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(screen.queryByText('Restoring your session…')).not.toBeInTheDocument()
})

it('offers the legacy homepage to visitors without exposing administration', async () => {
  clearAuth()
  await showHome()
  expect(screen.getByRole('link', { name: 'Switch to legacy' })).toHaveAttribute(
    'href',
    '/frontend/switch?version=legacy&return_to=%2F',
  )
  expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
})

it('offers product navigation on mobile and returns keyboard focus after closing it', async () => {
  clearAuth()
  await showHome()
  const user = userEvent.setup()
  const menu = screen.getByRole('button', { name: 'Open navigation' })
  expect(menu).toHaveAttribute('aria-expanded', 'false')
  await user.click(menu)
  const dialog = await screen.findByRole('dialog', { name: 'Main navigation' })
  expect(menu).toHaveAttribute('aria-expanded', 'true')
  expect(within(dialog).getByRole('link', { name: 'Models and pricing' })).toHaveAttribute(
    'href',
    '/explore',
  )
  expect(within(dialog).getByRole('link', { name: 'AI chat' })).toHaveAttribute('href', '/chat')
  expect(within(dialog).getByRole('link', { name: 'Image studio' })).toHaveAttribute(
    'href',
    '/studio',
  )
  expect(within(dialog).queryByRole('link', { name: 'Wallet' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(menu).toHaveFocus()
})
