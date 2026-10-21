import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { apiAddresses, ccSwitchLink, protocolBaseURL } from '../api-addresses'
import { CCSwitchImport } from '../CCSwitchImport'
import type { APIKey } from '../types'

vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 31, group: 'default' } }) }))
vi.mock('@/lib/status', () => ({
  useStatus: () => ({
    data: {
      api_info: [
        {
          url: 'https://api.example.test/gateway/v1',
          route: 'Primary',
          description: 'Official gateway',
        },
      ],
    },
  }),
}))
vi.mock('@/lib/catalog', () => ({
  useCatalog: () => ({
    allModels: [
      { model_name: 'responses-only', supported_endpoint_types: ['openai-response'] },
      { model_name: 'restricted-model', supported_endpoint_types: ['openai-response'] },
      { model_name: 'gpt-image-2', supported_endpoint_types: ['openai-response'] },
    ],
    isPending: false,
  }),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('uses administrator addresses safely and preserves protocol prefixes', () => {
  const entries = apiAddresses(
    {
      api_info: [
        {
          url: 'https://primary.test/gateway/v1/',
          route: 'Fast',
          description: 'Recommended network',
        },
        { url: 'https://primary.test/gateway/v1', route: 'duplicate', description: '' },
        { url: 'javascript:alert(1)', route: 'unsafe', description: '' },
        { url: 'https://user:secret@private.test', route: 'secret', description: '' },
      ],
    },
    'http://localhost:3100',
  )
  expect(entries).toEqual([
    { url: 'https://primary.test/gateway/v1', label: 'Fast', description: 'Recommended network' },
  ])
  expect(
    apiAddresses(
      {
        api_info_enabled: false,
        api_info: [{ url: 'https://hidden.test', route: 'hidden', description: '' }],
        server_address: 'https://default.test',
      },
      'http://localhost:3100',
    )[0]?.url,
  ).toBe('https://default.test')
  expect(protocolBaseURL(entries[0]!.url, 'openai')).toBe('https://primary.test/gateway/v1')
  expect(protocolBaseURL(entries[0]!.url, 'native')).toBe('https://primary.test/gateway')
  expect(() => protocolBaseURL('https://api.test/?key=secret', 'openai')).toThrow()
})

it.each(['claude', 'codex', 'gemini'] as const)(
  'encodes an explicit %s import without automatically enabling it',
  (app) => {
    const url = new URL(
      ccSwitchLink({
        app,
        name: 'Example & 测试',
        address: 'https://api.test/proxy/v1',
        model: 'model&version=1',
        key: 'synthetic-only',
      }),
    )
    expect(url.protocol).toBe('ccswitch:')
    expect(url.searchParams.get('model')).toBe('model&version=1')
    expect(url.searchParams.get('apiKey')).toBe('sk-synthetic-only')
    expect(url.searchParams.get('enabled')).toBe('false')
    expect(url.searchParams.get('endpoint')).toBe(
      app === 'codex' ? 'https://api.test/proxy/v1' : 'https://api.test/proxy',
    )
  },
)

it('offers Responses-only models, honors key restrictions and reveals only for an explicit import', async () => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/user/models?group=premium')
      return Response.json({
        success: true,
        data: ['responses-only', 'restricted-model', 'gpt-image-2'],
      })
    if (path === '/api/token/4/key')
      return Response.json({ success: true, data: { key: 'synthetic-private-import' } })
    throw new Error(`Unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const key = {
    id: 4,
    group: 'premium',
    name: 'Desktop',
    model_limits_enabled: true,
    model_limits: 'responses-only,gpt-image-2',
  } as APIKey
  render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <CCSwitchImport apiKey={key} onClose={() => {}} />
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  )
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  expect(await screen.findByRole('option', { name: 'responses-only' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'restricted-model' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'gpt-image-2' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'responses-only' }))
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/key'))).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Prepare import' }))
  const button = await screen.findByRole('button', { name: 'Open CC Switch' })
  expect(document.body.innerHTML).not.toContain('synthetic-private-import')
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('synthetic-private-import')
  await user.click(button)
  expect(opened).toHaveBeenCalledOnce()
  const url = new URL(String(opened.mock.calls[0]?.[0]))
  expect(url.searchParams.get('model')).toBe('responses-only')
  expect(url.searchParams.get('endpoint')).toBe('https://api.example.test/gateway/v1')
  expect(url.searchParams.get('apiKey')).toBe('sk-synthetic-private-import')
  expect(Object.values(localStorage).join(' ')).not.toContain('synthetic-private-import')
  expect(await screen.findByRole('button', { name: 'Prepare import' })).toBeVisible()
  client.clear()
})
