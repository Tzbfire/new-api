import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { clearAuth } from '@/lib/auth-state'
import { CatalogProvider } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import { KeyEditor } from '../KeyEditor'
import KeysPage from '../KeysPage'

const key = {
  id: 1,
  name: 'Synthetic app',
  key: 'abcd********wxyz',
  status: 1,
  group: 'default',
  expired_time: -1,
  remain_quota: 500000,
  unlimited_quota: false,
}

function TestRouter(props: { children: ReactNode }) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => props.children }),
    history: createMemoryHistory(),
  })
  return <RouterProvider router={router} />
}

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
})
afterEach(() => vi.unstubAllGlobals())

async function renderKeys(
  children: ReactNode,
  tokens: (url: URL, init?: RequestInit) => Promise<Response>,
  models: import('@/lib/catalog').PricingModel[] = [],
) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, 'http://localhost')
    if (url.pathname === '/api/status')
      return Response.json({ success: true, data: { quota_per_unit: 500000 } })
    if (url.pathname === '/api/user/models' && !models.length)
      return Response.json({ success: true, data: [] })
    if (url.pathname === '/api/pricing')
      return Response.json({
        success: true,
        data: models,
        usable_group: { default: 'Everyday' },
        group_ratio: { default: 1 },
      })
    return tokens(url, init)
  })
  vi.stubGlobal('fetch', fetch)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <CatalogProvider>{children}</CatalogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
    { wrapper: TestRouter },
  )
  return fetch
}

it('returns to the previous key page after deleting its last item', async () => {
  let deleted = false
  await renderKeys(<KeysPage />, async (url, init) => {
    if (init?.method === 'DELETE') {
      deleted = true
      return Response.json({ success: true, data: {} })
    }
    const page = Number(url.searchParams.get('p'))
    const items =
      page === 1
        ? Array.from({ length: 12 }, (_, index) => ({
            ...key,
            id: index + 1,
            name: `App ${index + 1}`,
          }))
        : deleted
          ? []
          : [{ ...key, id: 13, name: 'Last page app' }]
    return Response.json({
      success: true,
      data: { items, total: deleted ? 12 : 13, page, page_size: 12 },
    })
  })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Next page' }))
  await screen.findByText('Last page app')
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm' }))
  expect(await screen.findByText('App 1')).toBeVisible()
  expect(screen.queryByText('Your first connection starts here')).not.toBeInTheDocument()
})

it('keeps setup in the page actions and search options together so keys follow the toolbar', async () => {
  await renderKeys(<KeysPage />, async () =>
    Response.json({ success: true, data: { items: [key], total: 1, page: 1, page_size: 12 } }),
  )
  expect(await screen.findByText('Synthetic app')).toBeVisible()
  expect(screen.queryByText('One key. Your choice of models.')).not.toBeInTheDocument()
  const heading = screen.getByRole('heading', { name: 'API keys' }).closest('header')!
  const setup = within(heading).getByRole('button', { name: 'Addresses and setup' })
  expect(within(heading).getByRole('button', { name: 'Create a key' })).toBeEnabled()
  const search = screen.getByRole('search', { name: 'Search keys' })
  expect(within(search).getByRole('textbox', { name: 'Search keys' })).toBeVisible()
  expect(within(search).getByRole('checkbox', { name: 'Exact name match' })).toBeVisible()
  const user = userEvent.setup()
  await user.click(setup)
  expect(await screen.findByRole('dialog', { name: 'Connect your AI tools' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(setup).toHaveFocus()
  expect(screen.getByText('Synthetic app')).toBeVisible()
})

it('links same-name and inactive keys to their own usage records without revealing secrets', async () => {
  const fetcher = await renderKeys(<KeysPage />, async () =>
    Response.json({
      success: true,
      data: {
        items: [key, { ...key, id: 2, status: 2 }],
        total: 2,
        page: 1,
        page_size: 12,
      },
    }),
  )
  const links = await screen.findAllByRole('link', {
    name: 'View usage records for Synthetic app',
  })
  expect(links).toHaveLength(2)
  links.forEach((link, index) => {
    const href = new URL(link.getAttribute('href')!, 'http://localhost')
    expect(href.pathname).toBe('/usage')
    expect(href.searchParams.get('token_id')).toBe(String(index + 1))
    expect(href.searchParams.get('token_label')).toBe('Synthetic app')
    expect(href.searchParams.has('token_name')).toBe(false)
    expect(href.href).not.toContain(key.key)
  })
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/key'))).toBe(false)
})

it('rejects an empty spending limit while preserving an explicitly entered zero', async () => {
  const onSaved = vi.fn()
  const fetch = await renderKeys(
    <KeyEditor existing={null} onClose={() => {}} onSaved={onSaved} />,
    async () => Response.json({ success: true, data: {} }),
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Key name' }), 'Synthetic app')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save key' })).toBeEnabled())
  const budget = screen.getByRole('spinbutton', { name: 'Key spending limit (USD)' })
  await user.clear(budget)
  await user.click(screen.getByRole('button', { name: 'Save key' }))
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  await user.type(budget, '0')
  await user.click(screen.getByRole('button', { name: 'Save key' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
    remain_quota: 0,
    unlimited_quota: false,
  })
})

it('explains an empty model group instead of showing a perpetual price check', async () => {
  const fetcher = await renderKeys(
    <KeyEditor existing={null} onClose={() => {}} onSaved={() => {}} />,
    async () => Response.json({ success: true, data: {} }),
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'View supported models and prices' }))
  expect(await screen.findByRole('heading', { name: 'No models in this group yet' })).toBeVisible()
  expect(screen.queryByText('Checking current prices…')).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([path]) => path.startsWith('/api/pricing/quote'))).toBe(false)
})

it('rejects malformed IP restrictions and saves valid IPv4, IPv6 and CIDR values unchanged', async () => {
  const onSaved = vi.fn()
  const fetcher = await renderKeys(
    <KeyEditor existing={null} onClose={() => {}} onSaved={onSaved} />,
    async () => Response.json({ success: true, data: {} }),
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Key name' }), 'IP fixture')
  await user.click(screen.getByText('Advanced settings'))
  const ips = screen.getByRole('textbox', { name: 'Allowed IP addresses' })
  for (const invalid of ['not-an-ip', '192.0.2.0/33', '2001:db8::/129', '127.1', '0x7f000001']) {
    await user.clear(ips)
    await user.type(ips, invalid)
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid IP address or CIDR range on each line.',
    )
  }
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  const valid = '192.0.2.1\n198.51.100.0/24\n2001:db8::1\n2001:db8::/32'
  await user.clear(ips)
  await user.type(ips, valid)
  await user.click(screen.getByRole('button', { name: 'Save key' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(call?.[1]?.body)).allow_ips).toBe(valid)
})

it('prevents another key reveal until the requested secret finishes loading', async () => {
  let complete: ((value: Response) => void) | undefined
  const pending = new Promise<Response>((resolve) => {
    complete = resolve
  })
  const fetch = await renderKeys(<KeysPage />, async (url) => {
    if (url.pathname.endsWith('/key')) return pending
    return Response.json({
      success: true,
      data: { items: [key, { ...key, id: 2, name: 'Second app' }], total: 2 },
    })
  })
  const user = userEvent.setup()
  await screen.findByText('Second app')
  const reveal = screen.getAllByRole('button', { name: 'Reveal key' })
  await user.click(reveal[0])
  expect(reveal[0]).toBeDisabled()
  expect(reveal[1]).toBeDisabled()
  await act(async () => {
    complete?.(Response.json({ success: true, data: { key: 'synthetic-only-secret' } }))
  })
  expect(await screen.findByText('sk-synthetic-only-secret')).toBeVisible()
  expect(fetch.mock.calls.filter(([path]) => path.endsWith('/key'))).toHaveLength(1)
})

it('shows a search-specific empty state instead of the first-key onboarding prompt', async () => {
  await renderKeys(<KeysPage />, async () =>
    Response.json({ success: true, data: { items: [], total: 0, page: 1, page_size: 12 } }),
  )
  const user = userEvent.setup()
  await screen.findByRole('textbox', { name: 'Search keys' })
  await user.type(screen.getByRole('textbox', { name: 'Search keys' }), 'missing')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText('No keys found')).toBeVisible()
  expect(screen.getByText('Try another key name.')).toBeVisible()
})

it('shows used, remaining and total key budget with an accessible remaining progress bar', async () => {
  await renderKeys(<KeysPage />, async () =>
    Response.json({
      success: true,
      data: { items: [{ ...key, used_quota: 500000, remain_quota: 1500000 }], total: 1 },
    }),
  )
  const progress = await screen.findByRole('progressbar', { name: 'Remaining key budget' })
  expect(progress).toHaveAttribute('aria-valuenow', '75')
  expect(screen.getByText('Used')).toBeVisible()
  expect(screen.getByText('Total key budget')).toBeVisible()
})

it('distinguishes expired keys and unlimited keys without implying wallet funds are unlimited', async () => {
  await renderKeys(<KeysPage />, async () =>
    Response.json({
      success: true,
      data: {
        items: [{ ...key, status: 3, expired_time: 1, unlimited_quota: true, used_quota: 500000 }],
        total: 1,
      },
    }),
  )
  expect(await screen.findByText('Expired')).toBeVisible()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText('Your wallet balance still applies.')).toBeVisible()
})

it('edits remaining quota and previews used plus remaining as the total', async () => {
  await renderKeys(
    <KeyEditor
      existing={{ ...key, used_quota: 500000 } as import('../types').APIKey}
      onClose={() => {}}
      onSaved={() => {}}
    />,
    async () => Response.json({ success: true, data: {} }),
  )
  const input = await screen.findByRole('spinbutton', {
    name: 'Remaining available key quota (USD)',
  })
  await waitFor(() => expect(input).toHaveValue(1))
  await userEvent.clear(input)
  await userEvent.type(input, '3')
  expect(screen.getByText('Used: $1.00 · Total after saving: $4.00')).toBeVisible()
})

it('uses substring name search by default and exact mode without wildcards', async () => {
  const fetch = await renderKeys(<KeysPage />, async () =>
    Response.json({ success: true, data: { items: [], total: 0 } }),
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Search keys' }), 'app')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([path]) => new URL(path, 'http://localhost').searchParams.get('keyword') === '%app%',
      ),
    ).toBe(true),
  )
  await user.click(screen.getByRole('checkbox', { name: 'Exact name match' }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([path]) => new URL(path, 'http://localhost').searchParams.get('keyword') === 'app',
      ),
    ).toBe(true),
  )
})

it('keeps the chat example on a placeholder until a model is explicitly chosen', async () => {
  await renderKeys(<KeysPage />, async () =>
    Response.json({ success: true, data: { items: [], total: 0 } }),
  )
  const user = userEvent.setup()
  expect(
    screen.queryByRole('combobox', { name: 'Chat model for this example' }),
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Addresses and setup' }))
  await screen.findByRole('combobox', { name: 'Chat model for this example' })
  await user.click(screen.getByText('Try a request'))
  expect(screen.getByText(/"model": "YOUR_CHAT_MODEL"/)).toBeInTheDocument()
})

it('excludes image models from chat examples and requires an explicit supported chat selection', async () => {
  await renderKeys(
    <KeysPage />,
    async () => Response.json({ success: true, data: { items: [], total: 0 } }),
    [
      {
        model_name: 'image-model',
        supported_endpoint_types: ['openai', 'image-generation'],
        enable_groups: ['default'],
      },
      {
        model_name: 'chat-model',
        supported_endpoint_types: ['openai'],
        enable_groups: ['default'],
      },
    ],
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Addresses and setup' }))
  await user.click(screen.getByText('Try a request'))
  expect(screen.getByText(/"model": "YOUR_CHAT_MODEL"/)).toBeInTheDocument()
  await user.click(await screen.findByRole('combobox', { name: 'Chat model for this example' }))
  expect(await screen.findByRole('option', { name: 'chat-model' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'image-model' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'chat-model' }))
  expect(screen.getByText(/"model": "chat-model"/)).toBeInTheDocument()
})

it('rejects short partial terms and raw wildcards before issuing a search', async () => {
  const fetch = await renderKeys(<KeysPage />, async () =>
    Response.json({ success: true, data: { items: [], total: 0 } }),
  )
  const user = userEvent.setup()
  const search = await screen.findByRole('textbox', { name: 'Search keys' })
  await user.type(search, 'a')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Use at least two characters')
  await user.clear(search)
  await user.type(search, 'app%')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(fetch.mock.calls.filter(([path]) => path.startsWith('/api/token/search'))).toHaveLength(0)
})

it('retains rows during same-filter pagination and disables stale key actions', async () => {
  let complete: ((response: Response) => void) | undefined
  const pending = new Promise<Response>((resolve) => {
    complete = resolve
  })
  await renderKeys(<KeysPage />, async (url) => {
    if (url.searchParams.get('p') === '2') return pending
    return Response.json({
      success: true,
      data: { items: [key], total: 13, page: 1, page_size: 12 },
    })
  })
  const user = userEvent.setup()
  await screen.findByText('Synthetic app')
  const loadingStatus = screen.getByTestId('keys-page-status')
  expect(loadingStatus).toHaveTextContent('')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(loadingStatus).toHaveTextContent('Loading…')
  expect(screen.getByText('Synthetic app')).toBeVisible()
  for (const name of ['Edit', 'Reveal key', 'Disable', 'Delete']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  await act(async () =>
    complete?.(
      Response.json({
        success: true,
        data: { items: [{ ...key, id: 2, name: 'Page two' }], total: 13, page: 2, page_size: 12 },
      }),
    ),
  )
  expect(await screen.findByText('Page two')).toBeVisible()
  expect(screen.getByTestId('keys-page-status')).toBe(loadingStatus)
  expect(loadingStatus).toHaveTextContent('')
  expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
})

it('opens a key model catalog directly without editing or changing the selected service group', async () => {
  const fetcher = await renderKeys(
    <KeysPage />,
    async (url) => {
      if (url.pathname === '/api/user/models')
        return Response.json({ success: true, data: ['allowed-chat', 'restricted-chat'] })
      if (url.pathname === '/api/pricing/quote')
        return Response.json({
          success: true,
          data: { quotes: [{ billing_unit: 'request', usd: 0.2 }] },
        })
      return Response.json({
        success: true,
        data: {
          items: [
            { ...key, group: 'premium', model_limits_enabled: true, model_limits: 'allowed-chat' },
          ],
          total: 1,
        },
      })
    },
    [
      {
        model_name: 'allowed-chat',
        supported_endpoint_types: ['openai'],
        enable_groups: ['premium'],
      },
      {
        model_name: 'restricted-chat',
        supported_endpoint_types: ['openai'],
        enable_groups: ['premium'],
      },
    ],
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'View supported models and prices' }))
  const dialog = await screen.findByRole('dialog', { name: 'View supported models and prices' })
  expect(
    within(dialog).getAllByRole('heading', { name: 'View supported models and prices' }),
  ).toHaveLength(1)
  expect(await within(dialog).findByRole('article', { name: 'allowed-chat' })).toBeVisible()
  expect(within(dialog).queryByRole('article', { name: 'restricted-chat' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Edit API key' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([path]) => path === '/api/user/models?group=premium')).toBe(true)
})
