import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { router } from '../app'
import { SessionProvider } from '../lib/session'
import { acceptAuthBundle, clearAuth, getAuthSnapshot, type AuthBundle } from '../lib/auth-state'

afterEach(() => {
  vi.unstubAllGlobals()
  clearAuth()
  window.history.replaceState(null, '', '/')
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
})

it('clears private workspace dialogs when the authenticated session changes', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=1; path=/'
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  const bundle = {
    access_token: 'synthetic-session-one',
    token_type: 'Bearer' as const,
    access_expires_at: Math.floor(Date.now() / 1000) + 900,
    user: {
      id: 94,
      username: 'workspace-user',
      display_name: 'Workspace fixture',
      email: '',
      role: 1,
      group: 'default',
      quota: 0,
      used_quota: 0,
      request_count: 0,
    },
    session: {
      sid: 'workspace-one',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'fixture',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  }
  acceptAuthBundle(bundle)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/status')
        return Response.json({ success: true, data: { quota_per_unit: 500000 } })
      if (path === '/api/pricing')
        return Response.json({
          success: true,
          data: [],
          usable_group: { default: 'Everyday' },
          group_ratio: { default: 1 },
        })
      if (path === '/api/user/self/groups')
        return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
      if (path.startsWith('/api/user/models')) return Response.json({ success: true, data: [] })
      if (path.startsWith('/api/token/'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      throw new Error(`Unexpected workspace request ${path}`)
    }),
  )
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const testRouter = createRouter({
    routeTree: router.routeTree,
    context: { queryClient: client },
    basepath: '/',
    history: createMemoryHistory({ initialEntries: ['/keys'] }),
  })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={testRouter} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.click(
    (await screen.findAllByRole('button', { name: 'Create a key' }, { timeout: 10000 }))[0],
  )
  await user.type(await screen.findByRole('textbox', { name: 'Key name' }), 'Private draft')
  await act(async () =>
    acceptAuthBundle({
      ...bundle,
      access_token: 'synthetic-session-two',
      session: { ...bundle.session, sid: 'workspace-two' },
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click((await screen.findAllByRole('button', { name: 'Create a key' }))[0])
  expect(await screen.findByRole('textbox', { name: 'Key name' })).toHaveValue('')
  client.clear()
}, 20000)

it.each(['reset', 'oauth'])(
  'keeps the %s callback in memory after URL cleanup and session restoration',
  async (flow) => {
    clearAuth()
    document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
    vi.stubGlobal('scrollTo', vi.fn())
    const postMessage = vi.fn()
    vi.stubGlobal('opener', { postMessage })
    const url =
      flow === 'reset'
        ? '/app/reset?email=fixture%40example.test&token=synthetic-reset-token'
        : '/app/oauth/github?state=synthetic-state&code=synthetic-code'
    window.history.replaceState(null, '', url)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, data: { password_login_enabled: true } })),
    )
    const language = createInstance()
    await language.init({ lng: 'en', resources: { en: { translation: {} } } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const testRouter = createRouter({
      routeTree: router.routeTree,
      context: { queryClient: client },
      basepath: '/',
      history: createMemoryHistory({ initialEntries: [url] }),
    })
    render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={testRouter} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    if (flow === 'reset')
      expect(await screen.findByRole('button', { name: 'Reset password' })).toBeVisible()
    else
      expect(
        await screen.findByRole('heading', { name: 'Return to your sign-in window' }),
      ).toBeVisible()
    expect(window.location.search).toBe('')
    await act(async () =>
      acceptAuthBundle({
        access_token: 'synthetic-restored-session',
        token_type: 'Bearer',
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
        user: {
          id: 92,
          username: 'callback-user',
          display_name: 'Callback fixture',
          email: '',
          role: 1,
          group: 'default',
          quota: 0,
          used_quota: 0,
          request_count: 0,
        },
        session: {
          sid: 'callback-session',
          current: true,
          login_method: 'password',
          ip: '127.0.0.1',
          user_agent: 'fixture',
          created_at: 1,
          last_active_at: 1,
          expires_at: 9999999999,
        },
      }),
    )
    if (flow === 'reset') {
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeVisible()
      expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument()
    } else {
      expect(screen.getByRole('heading', { name: 'Return to your sign-in window' })).toBeVisible()
      expect(postMessage).toHaveBeenCalledExactlyOnceWith(
        {
          kind: 'new-api-consumer-oauth',
          provider: 'github',
          state: 'synthetic-state',
          code: 'synthetic-code',
          error: undefined,
        },
        window.location.origin,
      )
    }
    expect(window.location.search).toBe('')
    if (flow === 'reset') {
      expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
        'href',
        '/login',
      )
    }
    client.clear()
  },
)

it.each([
  ['/wallet', '/wallet'],
  ['/wallet?pay=pending&show_history=true', '/orders?pay=pending'],
  ['/wallet?pay=fail', '/wallet?pay=fail'],
  ['/usage?request_id=req_1&from=42#details', '/usage?request_id=req_1&from=42#details'],
  ['/image-studio?group=premium&model=art#settings', '/studio?group=premium&model=art'],
  ['/profile', '/account'],
  [
    '/model-pricing?group=premium&model=vendor%2Fchat&token=secret',
    '/model-pricing?group=premium&model=vendor%2Fchat',
  ],
  [
    '/keys?group=premium&model=vendor%2Fchat%2Bmodel&untrusted=ignored',
    '/keys?group=premium&model=vendor%2Fchat%2Bmodel',
  ],
])('keeps the requested protected page %s while login loads', async (entry, expected) => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/user/auth/refresh')
        return Response.json({ success: false }, { status: 401 })
      if (path === '/api/status')
        return Response.json({ success: true, data: { password_login_enabled: true } })
      if (path === '/api/pricing')
        return Response.json({ success: true, data: [], usable_group: {}, group_ratio: {} })
      throw new Error(`Unexpected navigation test request ${path}`)
    }),
  )
  const language = createInstance()
  await language.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const testRouter = createRouter({
    routeTree: router.routeTree,
    context: { queryClient: client },
    basepath: '/',
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={testRouter} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await waitFor(() => expect(testRouter.state.location.pathname).toBe('/login'))
  expect(testRouter.state.location.search).toMatchObject({ next: expected })
})

it('rejects anonymous direct navigation before any protected child loader can run', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: false }, { status: 401 })),
  )
  const guarded: AnyRoute = Object.values(router.routesById).find(
    (route) => route.fullPath === '/keys',
  )!
  const originalLoader = guarded.options.loader
  const childLoader = vi.fn(() => 'private result')
  guarded.options.loader = childLoader
  try {
    const testRouter = createRouter({
      routeTree: router.routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ['/keys?group=default'] }),
    })
    await testRouter.load()
    expect(childLoader).not.toHaveBeenCalled()
    expect(testRouter.state.location.pathname).toBe('/login')
    expect(testRouter.state.location.search).toMatchObject({ next: '/keys?group=default' })
  } finally {
    guarded.options.loader = originalLoader
  }
})

const guardBundle: AuthBundle = {
  access_token: 'synthetic-guard-token',
  token_type: 'Bearer',
  access_expires_at: 9999999999,
  user: {
    id: 88,
    username: 'guard-user',
    display_name: 'Guard user',
    email: '',
    role: 1,
    group: 'default',
    quota: 0,
    used_quota: 0,
    request_count: 0,
  },
  session: {
    sid: 'guard-session',
    current: true,
    login_method: 'password',
    ip: '',
    user_agent: '',
    created_at: 1,
    last_active_at: 1,
    expires_at: 9999999999,
  },
}

it('keeps workspace navigation mounted when comparing models, opening a key and returning', async () => {
  localStorage.clear()
  acceptAuthBundle(guardBundle)
  const { testRouter, client } = await guardedPage(
    '/keys',
    async (path) => {
      if (path === '/api/status')
        return Response.json({ success: true, data: { quota_per_unit: 500000 } })
      if (path === '/api/pricing')
        return Response.json({
          success: true,
          data: [
            {
              model_name: 'Workspace model',
              supported_endpoint_types: ['openai'],
              enable_groups: ['default'],
            },
          ],
          usable_group: { default: 'Everyday' },
          group_ratio: { default: 1 },
        })
      if (path === '/api/user/self/groups')
        return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
      if (path.startsWith('/api/user/models'))
        return Response.json({ success: true, data: ['Workspace model'] })
      if (path.startsWith('/api/token/'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      if (path.startsWith('/api/pricing/quote'))
        return Response.json({
          success: true,
          data: { group: 'default', group_ratio: 1, quotes: [] },
        })
      if (path.startsWith('/api/perf-metrics'))
        return Response.json({ success: true, data: { summary: null, groups: [], series: [] } })
      throw new Error('Unexpected workspace catalog request: ' + path)
    },
    true,
  )
  const user = userEvent.setup()
  const sidebar = await screen.findByRole('complementary')
  await user.click(within(sidebar).getByRole('button', { name: 'Collapse navigation' }))
  await user.click(within(sidebar).getByRole('link', { name: 'Models and pricing' }))
  await screen.findByRole('heading', { name: 'Workspace model' })
  expect(testRouter.state.location.pathname).toBe('/model-pricing')
  expect(screen.getByRole('complementary')).toBe(sidebar)
  expect(within(sidebar).getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  expect(within(sidebar).getByRole('link', { name: 'Models and pricing' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(screen.queryByRole('banner', { name: 'Main navigation' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Workspace model' }))
  const detail = await screen.findByRole('dialog', { name: 'Workspace model' })
  await user.click(within(detail).getByRole('link', { name: /Get your API key/ }))
  await waitFor(() => expect(testRouter.state.location.pathname).toBe('/keys'))
  expect(testRouter.state.location.search).toMatchObject({
    group: 'default',
    model: 'Workspace model',
  })
  expect(screen.getByRole('complementary')).toBe(sidebar)
  await act(async () => testRouter.history.back())
  await screen.findByRole('heading', { name: 'Workspace model' })
  expect(screen.getByRole('complementary')).toBe(sidebar)
  await user.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }))
  expect(within(sidebar).getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  client.clear()
})

it('does not bypass a disabled pricing module through the authenticated workspace entry', async () => {
  acceptAuthBundle(guardBundle)
  const fetcher = vi.fn(async () =>
    Response.json({ success: true, data: { HeaderNavModules: { pricing: { enabled: false } } } }),
  )
  const { testRouter, client } = await guardedPage('/model-pricing?group=default', fetcher)
  expect(testRouter.state.location.pathname).toBe('/')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/api/status', expect.anything())
  client.clear()
})

async function guardedPage(
  entry: string,
  fetcher: (path: string) => Promise<Response>,
  mount = false,
) {
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const testRouter = createRouter({
    routeTree: router.routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  if (mount) {
    const language = createInstance()
    await language.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })
    render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={testRouter} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
  } else await testRouter.load()
  return { testRouter, client }
}

it.each([
  '/model-pricing',
  '/chat',
  '/studio',
  '/library',
  '/keys',
  '/usage',
  '/wallet',
  '/plans',
  '/orders',
  '/account',
  '/image-studio',
  '/profile',
])('guards direct navigation to %s before a private page renders', async (entry) => {
  clearAuth()
  const fetcher = vi.fn(async (_path: string) => Response.json({ success: false }, { status: 401 }))
  const { testRouter } = await guardedPage(entry, fetcher)
  expect(testRouter.state.location.pathname).toBe('/login')
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/user/auth/refresh'])
})

it('restores a valid refresh-cookie session without a readable hint before opening a protected page', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  const fetcher = vi.fn(async () => Response.json({ success: true, data: guardBundle }))
  const { testRouter } = await guardedPage('/keys?group=default', fetcher)
  expect(testRouter.state.location.pathname).toBe('/keys')
  expect(getAuthSnapshot().session?.sid).toBe('guard-session')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each(['/login', '/register'])(
  'redirects an authenticated visitor away from %s to a safe return target',
  async (entry) => {
    acceptAuthBundle(guardBundle)
    const fetcher = vi.fn(async (_path: string) =>
      Response.json({ success: false }, { status: 401 }),
    )
    const { testRouter } = await guardedPage(entry + '?next=%2Fkeys%3Fgroup%3Ddefault', fetcher)
    expect(testRouter.state.location.pathname).toBe('/keys')
    expect(testRouter.state.location.search).toMatchObject({ group: 'default' })
    expect(fetcher).not.toHaveBeenCalled()
  },
)

it.each([429, 503])(
  'keeps a recovery HTTP %s error on the requested page and restores it after explicit retry',
  async (code) => {
    clearAuth()
    let failing = true
    const fetcher = vi.fn(async (path: string) => {
      if (path === '/api/user/auth/refresh')
        return failing
          ? new Response(null, { status: code })
          : Response.json({ success: true, data: guardBundle })
      if (path === '/api/status')
        return Response.json({ success: true, data: { password_login_enabled: true } })
      if (path === '/api/pricing')
        return Response.json({ success: true, data: [], usable_group: {}, group_ratio: {} })
      if (path === '/api/user/self/groups')
        return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
      if (path.startsWith('/api/user/models')) return Response.json({ success: true, data: [] })
      if (path.startsWith('/api/token/'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      throw new Error('Unexpected guard test request')
    }) as typeof fetch
    const { testRouter } = await guardedPage('/keys', fetcher, true)
    await screen.findByRole('alert')
    expect(testRouter.state.location.pathname).toBe('/keys')
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument()
    await act(async () => {
      await testRouter.invalidate()
    })
    expect(
      vi.mocked(fetcher).mock.calls.filter(([path]) => path === '/api/user/auth/refresh'),
    ).toHaveLength(1)
    failing = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByRole('button', { name: 'Create a key' })).length).toBeGreaterThan(
      0,
    )
    expect(testRouter.state.location.pathname).toBe('/keys')
    expect(getAuthSnapshot().status).toBe('authenticated')
  },
)

it.each([
  [{ pricing: { enabled: false } }, '/'],
  [{ pricing: { enabled: true, requireAuth: true } }, '/login'],
])(
  'respects server pricing module policy %j before reading the catalog',
  async (policy, target) => {
    clearAuth()
    const fetcher = vi.fn(async (path: string) =>
      path === '/api/status'
        ? Response.json({ success: true, data: { HeaderNavModules: JSON.stringify(policy) } })
        : Response.json({ success: false }, { status: 401 }),
    ) as typeof fetch
    const { testRouter } = await guardedPage('/explore?group=default', fetcher)
    expect(testRouter.state.location.pathname).toBe(target)
    expect(vi.mocked(fetcher).mock.calls.some(([path]) => path === '/api/pricing')).toBe(false)
  },
)

it('keeps workspace queries and content unmounted while a server session check is pending', async () => {
  clearAuth()
  let finish: (value: Response) => void = () => undefined
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/user/auth/refresh') return pending
    if (path === '/api/status') return Response.json({ success: true, data: {} })
    throw new Error('Private request started before authentication')
  }) as typeof fetch
  const { testRouter } = await guardedPage('/keys', fetcher, true)
  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  expect(
    vi
      .mocked(fetcher)
      .mock.calls.some(
        ([path]) => path === '/api/pricing' || String(path).startsWith('/api/token'),
      ),
  ).toBe(false)
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument()
  await act(async () => finish(Response.json({ success: false }, { status: 401 })))
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
  expect(testRouter.state.location.pathname).toBe('/login')
})

it('removes an open private workspace on session termination and preserves the return path', async () => {
  acceptAuthBundle(guardBundle)
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/status')
      return Response.json({ success: true, data: { password_login_enabled: true } })
    if (path === '/api/pricing')
      return Response.json({ success: true, data: [], usable_group: {}, group_ratio: {} })
    if (path === '/api/user/self/groups')
      return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
    if (path.startsWith('/api/user/models')) return Response.json({ success: true, data: [] })
    if (path.startsWith('/api/token/'))
      return Response.json({ success: true, data: { items: [], total: 0 } })
    throw new Error('Unexpected guard test request')
  }) as typeof fetch
  const { testRouter, client } = await guardedPage('/keys?group=default', fetcher, true)
  await screen.findAllByRole('button', { name: 'Create a key' })
  client.setQueryData(['private-session-data'], { secret: 'synthetic' })
  act(() => clearAuth({ verified: true }))
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Create a key' })).not.toBeInTheDocument()
  expect(testRouter.state.location.search).toMatchObject({ next: '/keys?group=default' })
  expect(client.getQueryData(['private-session-data'])).toBeUndefined()
})

it.each([false, true])(
  'keeps model discovery separate from account navigation when signed in is %s',
  async (signedIn) => {
    clearAuth()
    if (signedIn) acceptAuthBundle(guardBundle)
    const fetcher = vi.fn(async (path: string) => {
      if (path === '/api/status') return Response.json({ success: true, data: {} })
      if (path === '/api/pricing')
        return Response.json({
          success: true,
          data: [],
          usable_group: { default: 'Everyday' },
          group_ratio: { default: 1 },
        })
      if (path === '/api/user/self/groups')
        return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
      if (path.startsWith('/api/user/models')) return Response.json({ success: true, data: [] })
      throw new Error('Unexpected public catalog request: ' + path)
    })
    await guardedPage('/explore', fetcher, true)
    await screen.findByRole('heading', { name: 'Models and pricing' })
    expect(screen.getByRole('banner', { name: 'Main navigation' })).toBeVisible()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    for (const name of ['Wallet', 'Orders', 'Profile and security', 'Usage', 'API keys'])
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: signedIn ? 'Open workspace' : 'Sign in' }),
    ).toHaveAttribute('href', signedIn ? '/chat' : '/login')
    expect(screen.getByRole('link', { name: 'Models and pricing' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
)
