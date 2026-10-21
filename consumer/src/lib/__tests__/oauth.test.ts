import { afterEach, describe, expect, it, vi } from 'vitest'
import { enabledOAuthProviders, startOAuth, validOAuthCallback } from '../auth-oauth'
import { safeLoginDestination } from '@/features/auth/login'

describe('sign-in destination', () => {
  it('returns to known app pages and rejects external or unrecognized destinations', () => {
    expect(safeLoginDestination('/keys')).toBe('/keys')
    expect(safeLoginDestination('/wallet')).toBe('/wallet')
    expect(safeLoginDestination('https://outside.invalid')).toBe('/explore')
    expect(safeLoginDestination('//outside.invalid')).toBe('/explore')
    expect(safeLoginDestination('/admin')).toBe('/explore')
    expect(safeLoginDestination(null)).toBe('/explore')
    expect(
      safeLoginDestination(
        '/keys?group=premium&model=vendor%2Fchat%2Bmodel&redirect=https://outside.invalid#fragment',
      ),
    ).toBe('/keys?group=premium&model=vendor%2Fchat%2Bmodel')
    expect(
      safeLoginDestination('/keys?group=' + 'x'.repeat(128) + '&model=' + 'x'.repeat(256)),
    ).toBe('/keys')
    expect(safeLoginDestination('/unknown?group=premium')).toBe('/explore')
    expect(safeLoginDestination('/' + String.fromCharCode(92) + 'outside.invalid')).toBe('/explore')
    expect(safeLoginDestination('/keys' + String.fromCharCode(10) + '?group=premium')).toBe(
      '/explore',
    )
  })
})

it.each([
  [
    '/model-pricing?group=premium&model=vendor%2Fchat&token=secret',
    '/model-pricing?group=premium&model=vendor%2Fchat',
  ],
  ['/wallet?pay=pending&show_history=true&token=secret#orders', '/orders?pay=pending#orders'],
  ['/usage?request_id=req_1&from=42#details', '/usage?request_id=req_1&from=42#details'],
  ['/wallet?pay=forged&show_history=false#token=secret', '/wallet'],
  ['/wallet?pay=success%0a&request_id=bad%0a&from=-1#https://evil.test', '/explore'],
  ['/wallet%0a?pay=success', '/explore'],
])('sanitizes a post-login return %s to %s', (value, expected) => {
  expect(safeLoginDestination(value)).toBe(expected)
})

describe('OAuth popup binding', () => {
  const popup = {} as Window
  const callback = {
    kind: 'new-api-consumer-oauth',
    provider: 'github',
    state: 'synthetic-state',
    code: 'synthetic-code',
  }
  it('accepts only the original same-origin popup and expected provider/state', () => {
    const event = new MessageEvent('message', {
      origin: window.location.origin,
      source: popup,
      data: callback,
    })
    expect(validOAuthCallback(event, popup, 'github', 'synthetic-state')).toBe(true)
  })
  it.each([
    { origin: 'https://outside.invalid' },
    { source: {} as Window },
    { data: { ...callback, state: 'other-state' } },
    { data: { ...callback, provider: 'discord' } },
    { data: { ...callback, code: undefined } },
  ])('rejects an unrelated callback %# before it reaches the API', (override) => {
    const event = new MessageEvent<unknown>('message', {
      origin: window.location.origin,
      source: popup,
      data: callback,
      ...override,
    })
    expect(validOAuthCallback(event, popup, 'github', 'synthetic-state')).toBe(false)
  })
})

describe('public OAuth provider configuration', () => {
  it('shows enabled GitHub alongside the configured custom provider name', () => {
    expect(
      enabledOAuthProviders({
        github_oauth: true,
        custom_oauth_providers: [{ slug: 'yaohuo', name: '妖火网' }],
      }),
    ).toEqual([
      { slug: 'github', name: 'GitHub' },
      { slug: 'yaohuo', name: '妖火网' },
    ])
  })

  it('keeps disabled GitHub hidden and rejects malformed custom provider slugs', () => {
    expect(
      enabledOAuthProviders({
        github_oauth: false,
        custom_oauth_providers: [
          { slug: 'yaohuo', name: '妖火' },
          { slug: '../github', name: 'Invalid' },
        ],
      }),
    ).toEqual([{ slug: 'yaohuo', name: '妖火' }])
  })
})

afterEach(() => vi.restoreAllMocks())

it.each([
  { status: 403, redirect: '/oauth/yaohuo', state: 'synthetic-flow' },
  { status: 200, redirect: 'https://outside.invalid/oauth/yaohuo', state: 'synthetic-flow' },
  { status: 200, redirect: '/oauth/github', state: 'synthetic-flow' },
  { status: 200, redirect: '/oauth/yaohuo', state: 'other-flow' },
])(
  'keeps server and callback validation after removing the public-status precheck: %j',
  async (scenario) => {
    const popup = { close: vi.fn(), location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const authorization = new URL('https://provider.example/authorize')
    authorization.searchParams.set(
      'redirect_uri',
      new URL(scenario.redirect, window.location.origin).href,
    )
    authorization.searchParams.set('state', scenario.state)
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: scenario.status === 200,
          message: scenario.status === 403 ? 'State parameter is empty or mismatched' : '',
          data: {
            flow_token: 'synthetic-flow',
            expires_at: Date.now() / 1000 + 60,
            authorization_url: authorization.href,
          },
        },
        { status: scenario.status },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(startOAuth('yaohuo', 'login')).rejects.toThrow()
      expect(popup.location.href).toBe('about:blank')
      expect(popup.close).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

it('reports an old backend without an authorization URL and closes its blank popup', async () => {
  const popup = { close: vi.fn(), location: { href: 'about:blank' } }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { flow_token: 'synthetic-flow', expires_at: Date.now() / 1000 + 60 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
  try {
    await expect(startOAuth('yaohuo', 'login')).rejects.toThrow(
      'Third-party sign-in requires an updated server.',
    )
    expect(popup.close).toHaveBeenCalledOnce()
    expect(popup.location.href).toBe('about:blank')
  } finally {
    vi.unstubAllGlobals()
  }
})

it.each(['/oauth/yaohuo', '/app/oauth/yaohuo'])(
  'retains the state-bound popup flow when the server uses %s',
  async (path) => {
    const popup = { close: vi.fn(), closed: false, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const authorization = new URL('https://provider.example/authorize')
    authorization.searchParams.set('redirect_uri', window.location.origin + path)
    authorization.searchParams.set('state', 'synthetic-flow')
    const fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                flow_token: 'synthetic-flow',
                expires_at: Date.now() / 1000 + 60,
                authorization_url: authorization.toString(),
              },
            }),
          ),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { verified: true } })),
      )
    })
    vi.stubGlobal('fetch', fetch)
    const pending = startOAuth('yaohuo', 'login')
    // Wait for the visible popup navigation before emulating the provider callback.
    await vi.waitFor(() =>
      expect(popup.location.href).toContain('https://provider.example/authorize'),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: popup as unknown as Window,
        data: {
          kind: 'new-api-consumer-oauth',
          provider: 'yaohuo',
          state: 'synthetic-flow',
          code: 'synthetic-code',
        },
      }),
    )
    try {
      await expect(pending).resolves.toEqual({ verified: true })
      expect(popup.close).toHaveBeenCalledOnce()
      expect(fetch.mock.calls.at(-1)?.[0]).toBe(
        '/api/oauth/yaohuo?state=synthetic-flow&code=synthetic-code',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  },
)
