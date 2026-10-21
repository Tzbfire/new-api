import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth, getAuthSnapshot } from '@/lib/auth-state'
import { SessionProvider, useSession } from '@/lib/session'

const bundle = {
  access_token: 'synthetic-token',
  token_type: 'Bearer' as const,
  access_expires_at: Math.floor(Date.now() / 1000) + 900,
  user: {
    id: 8,
    username: 'sample',
    display_name: 'Sample',
    email: '',
    role: 1,
    group: 'default',
    quota: 0,
    used_quota: 0,
    request_count: 0,
  },
  session: {
    sid: 'synthetic-session',
    current: true,
    login_method: 'password',
    ip: '127.0.0.1',
    user_agent: 'Test',
    created_at: 1,
    last_active_at: 2,
    expires_at: 9999999999,
  },
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function SessionControls() {
  const session = useSession()
  const [error, setError] = useState('')
  return (
    <>
      <output>{session.status}</output>
      <a href="/app/login">Public sign-in link</a>
      <input aria-label="Public username" />
      {session.authenticationError instanceof Error && (
        <p role="alert">{session.authenticationError.message}</p>
      )}
      <button
        onClick={() => {
          void session.retryAuthentication()
        }}
      >
        Retry authentication
      </button>
      <button
        onClick={() => {
          void session.logout().catch((failure: Error) => setError(failure.message))
        }}
      >
        Sign out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=1;path=/'
  acceptAuthBundle(bundle)
  vi.stubGlobal('BroadcastChannel', undefined)
})
afterEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=;max-age=0;path=/'
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('does not refresh on remount or visibility changes while the memory token is fresh', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(fetcher).not.toHaveBeenCalled()
  expect(getAuthSnapshot().status).toBe('authenticated')
})

it('refreshes an expiring token and ignores same-session cross-tab notices while forcing changed-session reconciliation', async () => {
  let receive: (event: MessageEvent) => void = () => undefined
  class TestBroadcastChannel {
    addEventListener(_type: string, callback: (event: MessageEvent) => void) {
      receive = callback
    }
    postMessage() {}
    close() {}
  }
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const fetcher = vi.fn().mockResolvedValue(response({ success: true, data: bundle }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  act(() =>
    receive(
      new MessageEvent('message', {
        data: {
          kind: 'authenticated',
          sid: bundle.session.sid,
          source: 'other-tab',
          timestamp: Date.now(),
        },
      }),
    ),
  )
  expect(fetcher).not.toHaveBeenCalled()
  act(() => {
    acceptAuthBundle({ ...bundle, access_expires_at: Math.floor(Date.now() / 1000) + 30 })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(getAuthSnapshot().expiresAt).toBe(bundle.access_expires_at))
  const changed = { ...bundle, session: { ...bundle.session, sid: 'another-session' } }
  fetcher.mockResolvedValue(response({ success: true, data: changed }))
  act(() =>
    receive(
      new MessageEvent('message', {
        data: {
          kind: 'authenticated',
          sid: 'another-session',
          source: 'other-tab',
          timestamp: Date.now(),
        },
      }),
    ),
  )
  await waitFor(() => expect(getAuthSnapshot().session?.sid).toBe('another-session'))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(new Headers(fetcher.mock.calls[1][1].headers).has('X-Auth-Session')).toBe(false)
})

it('shows an empty-body rate limit as a friendly error and does not retry it on tab activation', async () => {
  clearAuth()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many sign-in attempts. Please try again later.',
  )
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: 'Public sign-in link' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Public username' })).toBeEnabled()
  expect(getAuthSnapshot().status).toBe('loading')
  act(() => acceptAuthBundle(bundle))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
})

it('keeps public content available after restoration failure and allows an explicit retry to restore authentication', async () => {
  clearAuth()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValue(response({ success: true, data: bundle }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to restore your session. Please try again.',
  )
  expect(screen.getByRole('textbox', { name: 'Public username' })).toBeEnabled()
  expect(getAuthSnapshot().status).toBe('loading')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Retry authentication' }))
  await waitFor(() => expect(getAuthSnapshot().status).toBe('authenticated'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('preserves the session after a failed logout and clears it only when the server confirms revocation', async () => {
  let failure = true
  const fetcher = vi.fn().mockImplementation(async (path: string, options: RequestInit) => {
    if (path.endsWith('/refresh')) return response({ success: true, data: bundle })
    expect(path).toBe('/api/user/auth/logout')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(options.headers).get('X-Auth-Session')).toBe('synthetic-session')
    return failure
      ? response({ success: false, message: 'Please try again later.' }, 503)
      : response({ success: true, data: { revoked_sid: 'synthetic-session' } })
  })
  vi.stubGlobal('fetch', fetcher)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  expect(fetcher).not.toHaveBeenCalled()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again later.')
  expect(getAuthSnapshot().status).toBe('authenticated')
  failure = false
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(getAuthSnapshot().status).toBe('anonymous'))
  expect(getAuthSnapshot().token).toBeNull()
})

it('does not clear a newer session of the same account when an earlier logout finishes', async () => {
  let finish: (value: Response) => void = () => undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    ),
  )
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <SessionControls />
      </SessionProvider>
    </QueryClientProvider>,
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
  act(() => acceptAuthBundle({ ...bundle, session: { ...bundle.session, sid: 'new-login' } }))
  await act(async () =>
    finish(response({ success: true, data: { revoked_sid: bundle.session.sid } })),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your session has changed. Please try again.',
  )
  expect(getAuthSnapshot().session?.sid).toBe('new-login')
  expect(getAuthSnapshot().status).toBe('authenticated')
})
