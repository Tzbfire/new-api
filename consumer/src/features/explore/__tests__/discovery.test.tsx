import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth } from '@/lib/auth-state'
import { CatalogProvider } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import ExplorePage from '../ExplorePage'

beforeEach(() => {
  clearAuth()
  localStorage.clear()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

async function renderExplore(
  initialEntry = '/',
  pricingReady?: Promise<void>,
  permissionsReady?: Promise<void>,
) {
  if (permissionsReady)
    acceptAuthBundle({
      access_token: 'synthetic-catalog-session',
      token_type: 'Bearer',
      access_expires_at: 9999999999,
      user: {
        id: 82,
        username: 'catalog-fixture',
        display_name: 'Catalog fixture',
        email: '',
        role: 1,
        group: 'default',
        quota: 0,
        used_quota: 0,
        request_count: 0,
      },
      session: {
        sid: 'catalog-fixture',
        current: true,
        login_method: 'password',
        ip: '',
        user_agent: '',
        created_at: 1,
        last_active_at: 1,
        expires_at: 9999999999,
      },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: { default: { desc: 'Everyday', ratio: 1 }, premium: { desc: 'Premium', ratio: 2 } },
        })
      if (path.startsWith('/api/user/models')) {
        if (path.includes('premium')) {
          await permissionsReady
          return Response.json({ success: true, data: [] })
        }
        return Response.json({ success: true, data: ['Chat 1'] })
      }
      if (path.startsWith('/api/perf-metrics'))
        return Response.json({
          success: true,
          data: {
            summary: null,
            groups: permissionsReady
              ? [
                  { group: 'premium', avg_tps: 9999, success_rate: 100, series: [] },
                  { group: 'private-staff', avg_tps: 8888, success_rate: 100, series: [] },
                ]
              : [],
            series: [],
          },
        })

      if (path.startsWith('/api/pricing/quote'))
        return Response.json({
          success: true,
          data: { group: 'default', group_ratio: 1, quotes: [] },
        })
      await pricingReady
      return Response.json({
        success: true,
        data: [
          ...Array.from({ length: 13 }, (_, index) => ({
            model_name: `Chat ${index + 1}`,
            supported_endpoint_types: ['openai'],
            enable_groups: permissionsReady ? ['default', 'premium'] : ['default'],
            tags: 'reasoning',
          })),
          {
            model_name: 'Image model',
            supported_endpoint_types: ['image-generation', 'openai'],
            enable_groups: ['default'],
            tags: 'illustration',
          },
          {
            model_name: 'Premium model',
            supported_endpoint_types: ['openai'],
            enable_groups: ['premium'],
          },
        ],
        usable_group: { default: 'Everyday', premium: 'Premium' },
        group_ratio: { default: 1, premium: 2 },
      })
    }),
  )
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function ExploreRoute() {
    const location = useLocation()
    const params = new URLSearchParams(location.searchStr)
    return (
      <SessionProvider>
        <CatalogProvider
          intent={{
            key: location.searchStr,
            model: params.get('model') || undefined,
            group: params.get('group') || undefined,
          }}
        >
          <ExplorePage />
        </CatalogProvider>
      </SessionProvider>
    )
  }
  const root = createRootRoute({ component: ExploreRoute })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return router
}

it('finds model capabilities and ignores whitespace around a pasted search', async () => {
  await renderExplore()
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Chat 1' })
  await user.type(screen.getByRole('searchbox', { name: 'Search models' }), '  illustration  ')
  expect(await screen.findByRole('heading', { name: 'Image model' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 1' })).not.toBeInTheDocument()
})

it('shows service groups without opening a selector and supports direct keyboard selection', async () => {
  await renderExplore()
  const groups = await screen.findByRole('group', { name: 'Service plan' })
  const everyday = await within(groups).findByRole('button', { name: /default/ })
  const premium = within(groups).getByRole('button', { name: /premium/ })
  expect(everyday).toBeVisible()
  expect(everyday).toHaveAttribute('aria-pressed', 'true')
  expect(premium).toBeVisible()
  expect(premium).toHaveTextContent('2×')
  expect(screen.queryByRole('combobox', { name: 'Service plan' })).not.toBeInTheDocument()
  premium.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(premium).toHaveAttribute('aria-pressed', 'true')
  expect(everyday).toHaveAttribute('aria-pressed', 'false')
  expect(within(groups).getByText('Premium')).toBeVisible()
  expect(await screen.findByRole('heading', { name: 'Premium model' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 1' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Only available in this group' })).toBeChecked()
})

it('defaults to the selected group and resets an all-models override when switching groups', async () => {
  await renderExplore()
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Chat 1' })
  expect(screen.getByRole('checkbox', { name: 'Only available in this group' })).toBeChecked()
  await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'Premium model')
  expect(screen.getByText('No models found')).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Only available in this group' }))
  expect(screen.getByRole('heading', { name: 'Premium model' })).toBeVisible()
  await user.clear(screen.getByRole('searchbox', { name: 'Search models' }))
  await user.click(
    within(screen.getByRole('group', { name: 'Service plan' })).getByRole('button', {
      name: /premium/,
    }),
  )
  expect(screen.getByRole('checkbox', { name: 'Only available in this group' })).toBeChecked()
  expect(screen.getByRole('heading', { name: 'Premium model' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 1' })).not.toBeInTheDocument()
})

it('keeps the group controls visible without listing unverified models while permissions load', async () => {
  let release!: () => void
  const permissions = new Promise<void>((resolve) => {
    release = resolve
  })
  await renderExplore('/', undefined, permissions)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Chat 1' })
  await user.click(
    within(screen.getByRole('group', { name: 'Service plan' })).getByRole('button', {
      name: /premium/,
    }),
  )
  expect(screen.getByRole('group', { name: 'Service plan' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Premium model' })).not.toBeInTheDocument()
  expect(screen.queryByText('No models found')).not.toBeInTheDocument()
  await act(async () => release())
  expect(await screen.findByText('No models found')).toBeVisible()
})

it('restores group filtering and the first page when URL navigation changes the service group', async () => {
  const router = await renderExplore()
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Chat 1' })
  await user.click(screen.getByRole('checkbox', { name: 'Only available in this group' }))
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await act(async () => {
    await router.navigate({ to: '/', search: { group: 'premium' } })
  })
  expect(screen.getByRole('checkbox', { name: 'Only available in this group' })).toBeChecked()
  expect(screen.getByRole('heading', { name: 'Premium model' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 13' })).not.toBeInTheDocument()
  await act(async () => {
    await router.navigate({ to: '/', search: { group: 'default' } })
  })
  expect(screen.getByRole('checkbox', { name: 'Only available in this group' })).toBeChecked()
  expect(screen.getByRole('heading', { name: 'Chat 1' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Premium model' })).not.toBeInTheDocument()
})

it('resets pagination for model filters and service plans and exposes the selected model details', async () => {
  await renderExplore()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Next page' }))
  expect(await screen.findByRole('heading', { name: 'Chat 13' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Image creation' }))
  expect(await screen.findByRole('heading', { name: 'Image model' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Image model' }))
  const dialog = await screen.findByRole('dialog', { name: 'Image model' })
  await user.click(within(dialog).getByText('Model information and API endpoints'))
  expect(within(dialog).getByText('image-generation')).toBeVisible()
  expect(within(dialog).getByRole('link', { name: /Create an image/ })).toHaveAttribute(
    'href',
    '/studio?group=default&model=Image+model',
  )
  expect(within(dialog).getByRole('link', { name: /Get your API key/ })).toHaveAttribute(
    'href',
    '/keys?group=default&model=Image+model',
  )
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'All models' }))
  await user.click(
    within(screen.getByRole('group', { name: 'Service plan' })).getByRole('button', {
      name: /premium/,
    }),
  )
  expect(await screen.findByRole('heading', { name: 'Premium model' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Chat 1' })).not.toBeInTheDocument()
})

it('opens the requested permitted model after catalog loading and keeps a closed intent dismissed', async () => {
  await renderExplore('/?model=Image+model&group=default')
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog', { name: 'Image model' })
  expect(within(dialog).getByRole('link', { name: /Create an image/ })).toHaveAttribute(
    'href',
    '/studio?group=default&model=Image+model',
  )
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'All models' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each(['Missing model'])(
  'shows unavailable requested model %s as a search with no unrelated details',
  async (model) => {
    await renderExplore(`/?model=${encodeURIComponent(model)}&group=default`)
    expect(await screen.findByText('No models found')).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveValue(model)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
)

it('closes model details on service plan change and accepts a subsequent URL intent', async () => {
  const router = await renderExplore('/?model=Image+model&group=default')
  const user = userEvent.setup()
  await screen.findByRole('dialog', { name: 'Image model' })
  await user.keyboard('{Escape}')
  await user.click(
    within(screen.getByRole('group', { name: 'Service plan' })).getByRole('button', {
      name: /premium/,
    }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => {
    await router.navigate({ to: '/', search: { model: 'Premium model', group: 'premium' } })
  })
  const dialog = await screen.findByRole('dialog', { name: 'Premium model' })
  expect(within(dialog).getByRole('link', { name: /Get your API key/ })).toHaveAttribute(
    'href',
    '/keys?group=premium&model=Premium+model',
  )
})

it('does not open a requested model before the pricing catalog resolves', async () => {
  let releasePricing!: () => void
  const pricingReady = new Promise<void>((resolve) => {
    releasePricing = resolve
  })
  await renderExplore('/?model=Image+model&group=default', pricingReady)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => {
    releasePricing()
    await pricingReady
  })
  expect(await screen.findByRole('dialog', { name: 'Image model' })).toBeVisible()
})

it('finds a model outside the current group and keeps its details open while selecting a usable group', async () => {
  await renderExplore('/?model=Premium+model&group=default')
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog', { name: 'Premium model' })
  const choices = within(dialog).getByRole('group', { name: 'Selected service group' })
  expect(within(choices).getByRole('button', { name: /default/ })).toBeDisabled()
  expect(within(choices).getByRole('button', { name: /premium/ })).toBeVisible()
  expect(
    within(dialog).queryByRole('link', { name: /Start a conversation/ }),
  ).not.toBeInTheDocument()
  await user.click(within(choices).getByRole('button', { name: /premium/ }))
  expect(within(dialog).getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Compare service groups' }))
  const defaultGroup = within(dialog).getByRole('article', { name: 'default' })
  expect(within(defaultGroup).getByRole('button', { name: 'Use this group' })).toBeDisabled()
  const premium = within(dialog).getByRole('article', { name: 'premium' })
  expect(screen.getByRole('dialog', { name: 'Premium model' })).toBe(dialog)
  expect(within(premium).getByRole('button', { name: 'Selected' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(within(dialog).getByRole('link', { name: /Start a conversation/ })).toHaveAttribute(
    'href',
    '/chat?group=premium&model=Premium+model',
  )
  expect(within(dialog).getByRole('link', { name: /Get your API key/ })).toHaveAttribute(
    'href',
    '/keys?group=premium&model=Premium+model',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Performance trends' }))
  expect(within(dialog).getByText('No recent samples')).toBeVisible()
  expect(
    within(within(dialog).getByRole('group', { name: 'Selected service group' })).getByRole(
      'button',
      { name: /premium/ },
    ),
  ).toHaveAttribute('aria-pressed', 'true')
})

it('verifies group access before showing prices or metrics and excludes unrelated metric groups', async () => {
  let release!: () => void
  const permission = new Promise<void>((resolve) => {
    release = resolve
  })
  await renderExplore('/?model=Chat+1&group=default', undefined, permission)
  const dialog = await screen.findByRole('dialog', { name: 'Chat 1' })
  const choices = within(dialog).getByRole('group', { name: 'Selected service group' })
  expect(within(choices).getByRole('button', { name: /premium/ })).toBeDisabled()
  await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Prices and groups' }))
  const premium = within(dialog).getByRole('article', { name: 'premium' })
  expect(within(premium).getByText('Checking model access…')).toBeVisible()
  expect(within(premium).getByRole('button', { name: 'Use this group' })).toBeDisabled()
  expect(within(dialog).queryByText('9,999 token/s')).not.toBeInTheDocument()
  expect(within(dialog).queryByText('private-staff')).not.toBeInTheDocument()
  await act(async () => release())
  await waitFor(() =>
    expect(within(premium).queryByText('Checking model access…')).not.toBeInTheDocument(),
  )
  expect(within(premium).getByRole('button', { name: 'Use this group' })).toBeDisabled()
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([path]) =>
          String(path).startsWith('/api/pricing/quote') && String(path).includes('group=premium'),
      ),
  ).toBe(false)
})
