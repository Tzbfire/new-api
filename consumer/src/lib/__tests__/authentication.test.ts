import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptAuthBundle,
  clearAuth,
  getAuthSnapshot,
  isAuthBundle,
  type AuthBundle,
} from '../auth-state'
import {
  authorizedFetch,
  decodeEnvelope,
  refreshAuthentication,
  resolveAuthentication,
  request,
} from '../api'
import { passwordFields } from '../password'

const fixture = (overrides: Partial<AuthBundle> = {}): AuthBundle => ({
  access_token: 'synthetic-access-token',
  token_type: 'Bearer',
  access_expires_at: Math.floor(Date.now() / 1000) + 900,
  user: {
    id: 7,
    username: 'synthetic-user',
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
    user_agent: 'Test browser',
    created_at: 1,
    last_active_at: 2,
    expires_at: 9999999999,
  },
  ...overrides,
})
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=;max-age=0;path=/'
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('consumer authentication contracts', () => {
  it('explains an empty HTTP 429 response without retrying the login submission', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/api/user/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 429,
      message: 'Too many requests. Please try again later.',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not accept an MFA challenge as a signed-in session or persist a credential', () => {
    const challenge = {
      require_verification: true,
      flow_token: 'synthetic-flow',
      methods: [{ method: '2fa', available: true }],
    }
    expect(isAuthBundle(challenge)).toBe(false)
    expect(() => acceptAuthBundle(challenge as unknown as AuthBundle)).toThrow(
      'Invalid authentication response',
    )
    acceptAuthBundle(fixture())
    expect(getAuthSnapshot().user?.id).toBe(7)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).not.toContain('synthetic-access-token')
  })

  it('refreshes once for concurrent requests and attaches the replacement bearer token', async () => {
    acceptAuthBundle(fixture({ access_expires_at: Math.floor(Date.now() / 1000) + 10 }))
    const fetcher = vi.fn().mockImplementation(async (path: string, options: RequestInit) => {
      if (path === '/api/user/auth/refresh')
        return response({ success: true, data: fixture({ access_token: 'replacement-token' }) })
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer replacement-token')
      return response({ success: true, data: path })
    })
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([request('/api/user/self'), request('/api/user/sessions')])
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/auth/refresh')).toHaveLength(1)
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-Auth-Session')).toBe(
      'synthetic-session',
    )
  })

  it('never replays a rejected write that spent a security proof', async () => {
    acceptAuthBundle(fixture())
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ success: false, code: 'AUTH_TOKEN_EXPIRED', message: 'Unauthorized' }, 401),
      )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      request('/api/user/2fa/disable', {
        method: 'POST',
        headers: { 'X-Security-Proof': 'synthetic-proof' },
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('blocks a stale account mutation when a refresh discovers another account', async () => {
    acceptAuthBundle(fixture({ access_expires_at: Math.floor(Date.now() / 1000) + 10 }))
    const other = fixture({
      user: { ...fixture().user, id: 8 },
      session: { ...fixture().session, sid: 'other-session' },
    })
    const fetcher = vi.fn().mockResolvedValue(response({ success: true, data: other }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      request('/api/user/self', {
        method: 'PUT',
        body: JSON.stringify({ display_name: 'Wrong account' }),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/user/auth/refresh')
  })

  it('does not resurrect a signed-out session when an earlier refresh finishes', async () => {
    acceptAuthBundle(fixture())
    let finish: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const refresh = refreshAuthentication()
    clearAuth()
    finish(response({ success: true, data: fixture() }))
    expect(await refresh).toBe(false)
    expect(getAuthSnapshot().status).toBe('anonymous')
  })

  it('refuses external request targets before attaching a bearer token', async () => {
    acceptAuthBundle(fixture())
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(authorizedFetch('https://outside.invalid/api')).rejects.toThrow(
      'Only requests to this website are allowed',
    )
    await expect(authorizedFetch('//outside.invalid/api')).rejects.toThrow(
      'Only requests to this website are allowed',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves legacy payment envelopes but rejects business failures even at HTTP 200', async () => {
    expect(
      await decodeEnvelope(
        response({
          message: 'success',
          url: 'https://pay.example.invalid',
          data: { amount: '1.00' },
        }),
      ),
    ).toMatchObject({ url: 'https://pay.example.invalid' })
    await expect(
      decodeEnvelope(
        response({ success: false, message_key: 'Insufficient balance', message: 'details' }),
      ),
    ).rejects.toThrow('Insufficient balance')
  })

  it('fails closed when encrypted login has no valid public key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ success: true, data: { enabled: false } })),
    )
    await expect(passwordFields('synthetic password only', true)).rejects.toThrow()
    expect(getAuthSnapshot().token).toBeNull()
  })

  it('adopts security-operation token rotation before the next protected request', async () => {
    acceptAuthBundle(fixture())
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          success: true,
          data: { ...fixture({ access_token: 'rotated-after-mfa' }), user: undefined },
        }),
      )
      .mockResolvedValue(response({ success: true, data: {} }))
    vi.stubGlobal('fetch', fetcher)
    await request('/api/user/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ flow_token: 'synthetic-flow', code: '123456' }),
    })
    await request('/api/user/self')
    expect(new Headers(fetcher.mock.calls[1][1].headers).get('Authorization')).toBe(
      'Bearer rotated-after-mfa',
    )
  })

  it('rejects an anonymous OAuth callback if its prerequisite refresh restores another login', async () => {
    document.cookie = 'new_api_has_session=1;path=/'
    const fetcher = vi.fn().mockResolvedValue(response({ success: true, data: fixture() }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      authorizedFetch(
        '/api/oauth/github?state=synthetic&code=synthetic',
        {},
        { userID: undefined, sessionID: undefined },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/user/auth/refresh')
  })
})

it('verifies a required route without a readable session hint using refresh cookie', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ success: true, data: fixture() }))
  vi.stubGlobal('fetch', fetcher)
  expect(await resolveAuthentication({ required: true })).toBe(true)
  expect(getAuthSnapshot().verified).toBe(true)
})

it('suspends failed restoration and does not retry until explicitly requested', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })))
  await expect(resolveAuthentication({ required: true })).rejects.toMatchObject({ status: 429 })
  expect(getAuthSnapshot()).toMatchObject({ status: 'loading', verified: false })
  await expect(resolveAuthentication({ required: true })).rejects.toMatchObject({ status: 429 })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('invalidates a final unauthorized write without replaying it', async () => {
  acceptAuthBundle(fixture())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ success: false }, 401)))
  await expect(request('/api/user/self', { method: 'PUT', body: '{}' })).rejects.toMatchObject({
    status: 401,
  })
  expect(getAuthSnapshot()).toMatchObject({ status: 'anonymous', verified: true, token: null })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([403, 429])(
  'keeps the current identity after an ordinary HTTP %s response',
  async (status) => {
    acceptAuthBundle(fixture())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ success: false }, status)))
    await expect(request('/api/user/self', { method: 'PUT' })).rejects.toMatchObject({ status })
    expect(getAuthSnapshot().status).toBe('authenticated')
  },
)

it('clears the identity after one GET refresh and a second unauthorized response', async () => {
  acceptAuthBundle(fixture())
  const fetcher = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path === '/api/user/auth/refresh'
        ? response({ success: true, data: fixture({ access_token: 'replacement' }) })
        : response({ success: false }, 401),
    )
  vi.stubGlobal('fetch', fetcher)
  await expect(request('/api/user/self')).rejects.toMatchObject({ status: 401 })
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(getAuthSnapshot()).toMatchObject({ status: 'anonymous', verified: true })
})

it('does not suspend a newer login when an earlier refresh fails', async () => {
  let rejectRefresh!: (reason: unknown) => void
  vi.stubGlobal(
    'fetch',
    vi.fn().mockReturnValue(
      new Promise<Response>((_, reject) => {
        rejectRefresh = reject
      }),
    ),
  )
  const pending = refreshAuthentication()
  acceptAuthBundle(fixture())
  rejectRefresh(new Error('offline'))
  expect(await pending).toBe(true)
  expect(getAuthSnapshot()).toMatchObject({ status: 'authenticated', authenticationError: null })
})

it('marks a non-JSON terminal refresh rejection verified and does not probe again', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
  expect(await resolveAuthentication({ required: true })).toBe(false)
  expect(await resolveAuthentication({ required: true })).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(getAuthSnapshot()).toMatchObject({ status: 'anonymous', verified: true })
})

it('shares required restoration without a readable hint with public bootstrap', async () => {
  let finish!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  const required = resolveAuthentication({ required: true })
  const bootstrap = resolveAuthentication()
  finish(response({ success: true, data: fixture() }))
  expect(await Promise.all([required, bootstrap])).toEqual([true, true])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(getAuthSnapshot().status).toBe('authenticated')
})

it('does not refresh or restore identity after logout while waiting for the browser lock', async () => {
  let runLocked!: () => Promise<boolean>
  let finishLock!: (value: boolean) => void
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn((_name, _options, operation) => {
        runLocked = operation
        return new Promise<boolean>((resolve) => {
          finishLock = resolve
        })
      }),
    },
  })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const pending = refreshAuthentication()
  clearAuth({ verified: true })
  finishLock(await runLocked())
  expect(await pending).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  expect(getAuthSnapshot()).toMatchObject({ status: 'anonymous', verified: true })
})
