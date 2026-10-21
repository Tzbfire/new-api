import { useState, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogProvider, useCatalog, type PricingModel } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import { acceptAuthBundle, clearAuth, type AuthBundle } from '@/lib/auth-state'
import { usePreferredModel } from '@/lib/use-preferred-model'
import { ServicePicker, supportsKind } from '../service-picker'
import { ModelPrice } from '../model-price'
import { Button, CopyButton, Modal } from '../ui'
import { IntegrationGuide } from '@/features/keys/IntegrationGuide'

const bundle: AuthBundle = {
  access_token: 'synthetic-test-session',
  token_type: 'Bearer',
  access_expires_at: 4_102_444_800,
  user: {
    id: 42,
    username: 'fixture-user',
    display_name: 'Fixture',
    email: '',
    role: 1,
    group: 'everyday',
    quota: 1_000_000,
    used_quota: 0,
    request_count: 0,
  },
  session: {
    sid: 'fixture-session',
    current: true,
    login_method: 'password',
    ip: '',
    user_agent: '',
    created_at: 1,
    last_active_at: 1,
    expires_at: 4_102_444_800,
  },
}
const models: PricingModel[] = [
  {
    model_name: 'chat-shared',
    supported_endpoint_types: ['openai'],
    enable_groups: ['everyday', 'premium'],
  },
  {
    model_name: 'everyday-only',
    supported_endpoint_types: ['openai'],
    enable_groups: ['everyday'],
  },
]

beforeEach(() => {
  localStorage.clear()
  clearAuth()
  document.cookie = 'new_api_has_session=1; path=/'
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.unstubAllGlobals()
})

async function renderApplication(
  children: ReactNode,
  authenticated = false,
  scope = 'catalog',
  entry = '/',
) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRootRoute({
    component: () => {
      const location = useLocation()
      const intentURL = new URL(location.href, 'http://localhost')
      return authenticated ? (
        <SessionProvider>
          <CatalogProvider
            scope={scope}
            intent={{
              key: location.href,
              group: intentURL.searchParams.get('group') || undefined,
              model: intentURL.searchParams.get('model') || undefined,
            }}
          >
            {children}
          </CatalogProvider>
        </SessionProvider>
      ) : (
        children
      )
    },
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { client, i18n, router, ...view }
}

async function renderIntegrationGuide(
  requestedModel: string,
  permitted: string[] | Promise<string[]> = ['chat-shared', 'everyday-only'],
  waitForModels = true,
) {
  acceptAuthBundle(bundle)
  const fetcher = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost')
    if (url.pathname === '/api/user/auth/refresh')
      return Response.json({ success: true, data: bundle })
    if (url.pathname === '/api/status')
      return Response.json({ success: true, data: { server_address: 'https://api.example.test' } })
    if (url.pathname === '/api/pricing')
      return Response.json({
        success: true,
        data: [
          ...models,
          { model_name: 'image-only', supported_endpoint_types: ['image-generation'] },
        ],
        usable_group: {},
        group_ratio: {},
      })
    if (url.pathname === '/api/user/self/groups')
      return Response.json({ success: true, data: { everyday: { desc: 'Everyday', ratio: 1 } } })
    if (url.pathname === '/api/user/models')
      return Response.json({ success: true, data: await permitted })
    throw new Error(`Unexpected fixture ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const view = await renderApplication(
    <IntegrationGuide />,
    true,
    'keys',
    `/?group=everyday&model=${encodeURIComponent(requestedModel)}`,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Addresses and setup' }))
  const selector = await screen.findByRole('combobox', { name: 'Chat model for this example' })
  if (waitForModels) await waitFor(() => expect(selector).toBeEnabled())
  await userEvent.click(screen.getByText('Try a request'))
  return { ...view, fetcher, selector }
}

it('prefills an allowed URL model and keeps a manual choice until a new URL intent arrives', async () => {
  const view = await renderIntegrationGuide('chat-shared')
  expect(view.selector).toHaveTextContent('chat-shared')
  expect(screen.getByText(/"model": "chat-shared"/)).toBeVisible()
  const user = userEvent.setup()
  await user.click(view.selector)
  await user.click(await screen.findByRole('option', { name: 'everyday-only' }))
  await act(async () => view.client.invalidateQueries({ queryKey: ['catalog'] }))
  expect(view.selector).toHaveTextContent('everyday-only')
  expect(screen.getByText(/"model": "everyday-only"/)).toBeVisible()
  await act(async () =>
    view.router.navigate({ to: '/', search: { group: 'everyday', model: 'chat-shared', from: 1 } }),
  )
  expect(view.selector).toHaveTextContent('chat-shared')
  expect(screen.getByText(/"model": "chat-shared"/)).toBeVisible()
  expect(view.fetcher.mock.calls.some(([path]) => /\/api\/token\//.test(path))).toBe(false)
})

it.each([
  ['everyday-only', ['chat-shared']],
  ['image-only', ['chat-shared', 'image-only']],
  ['unknown-model', ['chat-shared']],
])(
  'keeps the example placeholder when requested model %s is unavailable for chat',
  async (model, permitted) => {
    const view = await renderIntegrationGuide(model, permitted)
    expect(view.selector).toHaveTextContent('Choose a chat model explicitly')
    expect(screen.getByText(/"model": "YOUR_CHAT_MODEL"/)).toBeVisible()
    expect(view.fetcher.mock.calls.some(([path]) => /\/api\/token\//.test(path))).toBe(false)
  },
)

it('waits for server model permissions before preselecting the requested example model', async () => {
  let finishPermissions: (models: string[]) => void = () => {}
  const permitted = new Promise<string[]>((resolve) => {
    finishPermissions = resolve
  })
  const view = await renderIntegrationGuide('chat-shared', permitted, false)
  expect(view.selector).toBeDisabled()
  expect(screen.getByText(/"model": "YOUR_CHAT_MODEL"/)).toBeVisible()
  await act(async () => finishPermissions(['chat-shared']))
  await waitFor(() => expect(view.selector).toBeEnabled())
  expect(view.selector).toHaveTextContent('chat-shared')
  expect(screen.getByText(/"model": "chat-shared"/)).toBeVisible()
})

function CatalogFlow(props: { kind?: 'chat' | 'image' } = {}) {
  const catalog = useCatalog()
  const [model, setModel] = useState(props.kind === 'image' ? '' : 'chat-shared')
  return (
    <>
      <ServicePicker kind={props.kind || 'chat'} model={model} onModelChange={setModel} />
      <output aria-label="Selected model">{model || 'none'}</output>
      {model && <ModelPrice model={model} group={catalog.group} compact />}
    </>
  )
}

describe('service group and price boundaries', () => {
  it('guides an empty image group to a server-permitted alternative without silently changing its price', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const url = new URL(path, 'http://localhost')
        if (url.pathname === '/api/user/auth/refresh')
          return Response.json({ success: true, data: bundle })
        if (url.pathname === '/api/pricing')
          return Response.json({
            success: true,
            data: [
              ...models,
              {
                model_name: 'image-model',
                supported_endpoint_types: ['image-generation'],
                enable_groups: ['premium', 'restricted'],
              },
            ],
            usable_group: {},
            group_ratio: {},
          })
        if (url.pathname === '/api/user/self/groups')
          return Response.json({
            success: true,
            data: {
              everyday: { desc: 'Everyday service', ratio: 1 },
              premium: { desc: 'Image service', ratio: 1.75 },
              restricted: { desc: 'Not available for this account', ratio: 2 },
            },
          })
        if (url.pathname === '/api/user/models') {
          const group = url.searchParams.get('group')
          const permitted = group === 'premium' ? ['image-model'] : []
          return Response.json({
            success: true,
            data: group === 'everyday' ? ['chat-shared'] : permitted,
          })
        }
        if (url.pathname === '/api/pricing/quote')
          return Response.json({ success: true, data: { quotes: [] } })
        throw new Error(`Unexpected fixture endpoint ${url.pathname}`)
      }),
    )
    await renderApplication(<CatalogFlow kind="image" />, true)
    expect(
      await screen.findByText('This service plan has no image models available.'),
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Service plan' })).toHaveTextContent('everyday')
    const suggestion = await screen.findByRole('button', { name: 'Switch to premium · 1.75×' })
    expect(screen.queryByRole('button', { name: /Switch to restricted/ })).not.toBeInTheDocument()
    await userEvent.setup().click(suggestion)
    expect(screen.getByRole('combobox', { name: 'Service plan' })).toHaveTextContent('premium')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Model' }))
    expect(await screen.findByRole('option', { name: 'image-model' })).toBeVisible()
    await userEvent.setup().keyboard('{Escape}')
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled()
    expect(screen.getByLabelText('Selected model')).toHaveTextContent('none')
    expect(
      screen.queryByText('This service plan has no image models available.'),
    ).not.toBeInTheDocument()
  })

  it('shows a model loading error instead of calling failed permissions an empty plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const url = new URL(path, 'http://localhost')
        if (url.pathname === '/api/user/auth/refresh')
          return Response.json({ success: true, data: bundle })
        if (url.pathname === '/api/pricing')
          return Response.json({ success: true, data: models, usable_group: {}, group_ratio: {} })
        if (url.pathname === '/api/user/self/groups')
          return Response.json({
            success: true,
            data: { everyday: { desc: 'Everyday service', ratio: 1 } },
          })
        if (url.pathname === '/api/user/models')
          return Response.json({ success: false, message: 'Service unavailable' }, { status: 503 })
        throw new Error(`Unexpected fixture endpoint ${url.pathname}`)
      }),
    )
    await renderApplication(<CatalogFlow kind="image" />, true)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Models could not be loaded. Open Explore to try again.',
    )
    expect(
      screen.queryByText('This service plan has no image models available.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument()
  })

  it('preserves a shared model across group changes while hiding stale prices and awaiting permissions', async () => {
    let releasePremiumModels: ((value: Response) => void) | undefined
    let releasePremiumQuote: ((value: Response) => void) | undefined
    const premiumModels = new Promise<Response>((resolve) => {
      releasePremiumModels = resolve
    })
    const premiumQuote = new Promise<Response>((resolve) => {
      releasePremiumQuote = resolve
    })
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost')
      if (url.pathname === '/api/user/auth/refresh')
        return Response.json({ success: true, data: bundle })
      if (url.pathname === '/api/pricing')
        return Response.json({
          success: true,
          data: models,
          group_ratio: { everyday: 1, premium: 2 },
          usable_group: { everyday: 'Everyday service', premium: 'Premium service' },
        })
      if (url.pathname === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: {
            everyday: { desc: 'Everyday service', ratio: 1 },
            premium: { desc: 'Premium service', ratio: 2 },
          },
        })
      if (url.pathname === '/api/user/models')
        return url.searchParams.get('group') === 'premium'
          ? premiumModels
          : Response.json({ success: true, data: ['chat-shared', 'everyday-only'] })
      if (url.pathname === '/api/pricing/quote')
        return url.searchParams.get('group') === 'premium'
          ? premiumQuote
          : Response.json({
              success: true,
              data: {
                group: 'everyday',
                group_ratio: 1,
                quotes: [
                  {
                    label: 'Standard example',
                    billing_mode: 'tokens',
                    billing_unit: 'tokens',
                    usd: 0.01,
                  },
                ],
              },
            })
      throw new Error(`Unexpected fixture endpoint ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetch)
    await renderApplication(<CatalogFlow />, true)
    expect(await screen.findByText('$0.01')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Service plan' }))
    await user.click(await screen.findByRole('option', { name: /premium/ }))
    expect(screen.getByLabelText('Selected model')).toHaveTextContent('chat-shared')
    expect(screen.queryByText('$0.01')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    expect(screen.queryByRole('option', { name: 'everyday-only' })).not.toBeInTheDocument()
    await act(async () => {
      releasePremiumModels?.(Response.json({ success: true, data: ['chat-shared'] }))
    })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('chat-shared')
    expect(screen.queryByText('$0.01')).not.toBeInTheDocument()
    await act(async () => {
      releasePremiumQuote?.(
        Response.json({
          success: true,
          data: {
            group: 'premium',
            group_ratio: 2,
            quotes: [
              {
                label: 'Standard example',
                billing_mode: 'tokens',
                billing_unit: 'tokens',
                usd: 0.02,
              },
            ],
          },
        }),
      )
    })
    expect(await screen.findByText('$0.02')).toBeInTheDocument()
    expect(screen.queryByText('$0.01')).not.toBeInTheDocument()
  })

  it('shows explicit server zero price as zero without turning an unavailable quote into free usage', async () => {
    document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            group: 'everyday',
            group_ratio: 1,
            quotes: [
              {
                provider: 'Free fixture',
                label: 'Standard example',
                billing_mode: 'tokens',
                billing_unit: 'tokens',
                usd: 0,
              },
              {
                provider: 'Unknown fixture',
                label: 'Standard example',
                billing_mode: 'tokens',
                billing_unit: 'tokens',
              },
            ],
          },
        }),
      ),
    )
    await renderApplication(<ModelPrice model="chat-shared" group="everyday" compact />)
    expect(await screen.findByText('Free fixture')).toBeInTheDocument()
    expect(screen.getAllByText('$0.00')).toHaveLength(1)
    expect(screen.getByText('Price preview is unavailable. Please try again.')).toBeInTheDocument()
  })

  it('does not present responses-only models as directly supported by the chat playground', () => {
    expect(
      supportsKind(
        { model_name: 'responses-only', supported_endpoint_types: ['openai-response'] },
        'chat',
      ),
    ).toBe(false)
    expect(
      supportsKind(
        { model_name: 'chat-compatible', supported_endpoint_types: ['openai-response', 'openai'] },
        'chat',
      ),
    ).toBe(true)
    expect(
      supportsKind(
        { model_name: 'image-only', supported_endpoint_types: ['image-generation'] },
        'chat',
      ),
    ).toBe(false)
  })
})

function ModalFlow() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open model details</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Model details"
        description="Pricing and capabilities"
      >
        <Button>Primary action</Button>
        <Button>Secondary action</Button>
      </Modal>
    </>
  )
}

describe('model details keyboard access', () => {
  it('moves focus into the dialog, supports forward and backward Tab, and closes with Escape', async () => {
    document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
    await renderApplication(<ModalFlow />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open model details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Model details' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible()
    within(dialog).getByRole('button', { name: 'Primary action' }).focus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Secondary action' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Primary action' })).toHaveFocus()
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

function CopyFlow() {
  const [value, setValue] = useState('model-one')
  return (
    <>
      <CopyButton value={value} />
      <Button onClick={() => setValue('model-two')}>Change model</Button>
    </>
  )
}

it('does not claim a new API example is copied after its content changes', async () => {
  const user = userEvent.setup()
  await renderApplication(<CopyFlow />)
  await user.click(await screen.findByRole('button', { name: 'Copy' }))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Change model' }))
  expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
})

function RememberedChat() {
  const [model, setModel] = usePreferredModel('chat')
  return <ServicePicker kind="chat" model={model} onModelChange={setModel} />
}

it('restores permitted chat choices across reloads, isolates studio and rejects removed models', async () => {
  let permitted = ['chat-shared', 'everyday-only']
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost')
      if (url.pathname === '/api/user/auth/refresh')
        return Response.json({ success: true, data: bundle })
      if (url.pathname === '/api/pricing')
        return Response.json({ success: true, data: models, usable_group: {}, group_ratio: {} })
      if (url.pathname === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: {
            everyday: { desc: 'Everyday service', ratio: 1 },
            premium: { desc: 'Premium service', ratio: 2 },
          },
        })
      if (url.pathname === '/api/user/models')
        return Response.json({ success: true, data: permitted })
      throw new Error(`Unexpected endpoint ${url.pathname}`)
    }),
  )
  const first = await renderApplication(<RememberedChat />, true, 'chat')
  const user = userEvent.setup()
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('chat-shared'),
  )
  await user.click(screen.getByRole('combobox', { name: 'Service plan' }))
  await user.click(await screen.findByRole('option', { name: /premium/ }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  await user.click(await screen.findByRole('option', { name: 'everyday-only' }))
  first.unmount()
  first.client.clear()
  const second = await renderApplication(<RememberedChat />, true, 'chat')
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('everyday-only'),
  )
  expect(screen.getByRole('combobox', { name: 'Service plan' })).toHaveTextContent('premium')
  second.unmount()
  second.client.clear()
  const studio = await renderApplication(<RememberedChat />, true, 'studio')
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Service plan' })).toHaveTextContent('everyday'),
  )
  studio.unmount()
  studio.client.clear()
  permitted = ['chat-shared']
  await renderApplication(<RememberedChat />, true, 'chat')
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('chat-shared'),
  )
})

it('carries explicit model and service group into a new workspace and its price link', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost')
      if (url.pathname === '/api/user/auth/refresh')
        return Response.json({ success: true, data: bundle })
      if (url.pathname === '/api/pricing')
        return Response.json({ success: true, data: models, usable_group: {}, group_ratio: {} })
      if (url.pathname === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: {
            everyday: { desc: 'Everyday', ratio: 1 },
            premium: { desc: 'Premium', ratio: 2 },
          },
        })
      if (url.pathname === '/api/user/models')
        return Response.json({ success: true, data: ['chat-shared', 'everyday-only'] })
      throw new Error(`Unexpected fixture ${url.pathname}`)
    }),
  )
  await renderApplication(<RememberedChat />, true, 'chat', '/?group=premium&model=everyday-only')
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('everyday-only'),
  )
  expect(screen.getByRole('combobox', { name: 'Service plan' })).toHaveTextContent('premium')
  const href = screen.getByRole('link', { name: 'Compare prices' }).getAttribute('href') || ''
  expect(new URL(href, 'http://localhost').pathname).toBe('/model-pricing')
  expect(new URL(href, 'http://localhost').searchParams.get('group')).toBe('premium')
  expect(new URL(href, 'http://localhost').searchParams.get('model')).toBe('everyday-only')
})

it('shows only image quantity for a fixed image request instead of unrelated token inputs', async () => {
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          group: 'default',
          group_ratio: 1,
          supports_image_count: true,
          quotes: [
            { label: 'Image', billing_mode: 'tiered_expr', billing_unit: 'request', usd: 0.04 },
          ],
        },
      }),
    ),
  )
  await renderApplication(<ModelPrice model="image-model" group="default" />)
  await screen.findByText('$0.04')
  expect(screen.queryByRole('spinbutton', { name: 'Input tokens' })).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton', { name: 'Output tokens' })).not.toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: 'Images' })).toHaveValue(1)
})

it.each([true, false])(
  'uses administrator group order, including numeric names, without changing selection (signed in: %s)',
  async (authenticated) => {
    let order = ['premium', '10', '2', 'everyday']
    if (authenticated) acceptAuthBundle(bundle)
    else document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
    localStorage.setItem('factory:choice:42:chat:group', 'everyday')
    localStorage.setItem('factory:choice:public:chat:group', 'everyday')
    const fetcher = vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost')
      if (url.pathname === '/api/user/auth/refresh')
        return Response.json({ success: true, data: bundle })
      if (url.pathname === '/api/pricing')
        return Response.json({
          success: true,
          data: [],
          usable_group: { everyday: 'Everyday', 2: 'Two', 10: 'Ten', premium: 'Premium' },
          group_ratio: { everyday: 1, 2: 1, 10: 1, premium: 2 },
          group_order: [...order, 'unauthorized'],
        })
      if (url.pathname === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: Object.fromEntries(
            ['everyday', '2', '10', 'premium'].map((id) => [
              id,
              { desc: id, ratio: 1, display_order: order.indexOf(id) },
            ]),
          ),
        })
      if (url.pathname === '/api/user/models') return Response.json({ success: true, data: [] })
      throw new Error(`Unexpected endpoint ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const children = authenticated ? (
      <RememberedChat />
    ) : (
      <SessionProvider>
        <CatalogProvider scope="chat">
          <RememberedChat />
        </CatalogProvider>
      </SessionProvider>
    )
    const view = await renderApplication(children, authenticated, 'chat')
    const user = userEvent.setup()
    const picker = await screen.findByRole('combobox', { name: 'Service plan' })
    await waitFor(() => expect(picker).toBeEnabled())
    expect(picker).toHaveTextContent('everyday')
    await user.click(picker)
    expect(
      (await screen.findAllByRole('option')).map((item) => item.textContent?.split(' · ')[0]),
    ).toEqual(order)
    await user.keyboard('{Escape}')
    order = ['2', 'everyday', 'premium', '10']
    await act(async () => {
      await view.client.invalidateQueries({
        queryKey: [authenticated ? 'service-groups' : 'catalog'],
      })
    })
    expect(picker).toHaveTextContent('everyday')
    await user.click(picker)
    expect(
      (await screen.findAllByRole('option')).map((item) => item.textContent?.split(' · ')[0]),
    ).toEqual(order)
    expect(screen.queryByRole('option', { name: /unauthorized/ })).not.toBeInTheDocument()
    view.unmount()
    view.client.clear()
  },
)
