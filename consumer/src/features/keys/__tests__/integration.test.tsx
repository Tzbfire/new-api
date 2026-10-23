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

const catalogState = vi.hoisted(() => ({
  metadataPending: false,
  metadataError: null as Error | null,
  isPending: false,
  error: null as Error | null,
}))

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
      { model_name: 'chat-only', supported_endpoint_types: ['openai'] },
      { model_name: 'claude-text', supported_endpoint_types: ['anthropic'] },
      { model_name: 'gemini-text', supported_endpoint_types: ['gemini'] },
      { model_name: 'another-group', supported_endpoint_types: ['openai'] },
      { model_name: 'image-only', supported_endpoint_types: ['image-generation'] },
      { model_name: 'alias/gpt-image-2', supported_endpoint_types: ['openai'] },
      { model_name: 'embedding', supported_endpoint_types: ['embeddings'] },
      { model_name: 'rerank', supported_endpoint_types: ['rerank'] },
      { model_name: 'audio-only', supported_endpoint_types: ['audio'] },
      { model_name: 'task-only', supported_endpoint_types: ['task'] },
    ],
    ...catalogState,
  }),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  Object.assign(catalogState, {
    metadataPending: false,
    metadataError: null,
    isPending: false,
    error: null,
  })
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

it.each([
  ['claude', 'anthropic', 'https://api.test/proxy'],
  ['codex', 'openai_responses', 'https://api.test/proxy/v1'],
  ['gemini', 'gemini_native', 'https://api.test/proxy'],
  ['agy', 'gemini_native', 'https://api.test/proxy'],
  ['grokbuild', 'openai_responses', 'https://api.test/proxy/v1'],
  ['opencode', 'openai_chat', 'https://api.test/proxy/v1'],
  ['openclaw', 'openai_chat', 'https://api.test/proxy/v1'],
  ['hermes', 'openai_chat', 'https://api.test/proxy/v1'],
  ['pi', 'openai_chat', 'https://api.test/proxy/v1'],
] as const)(
  'encodes an explicit %s import using its official format without automatically enabling it',
  (app, format, endpoint) => {
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
    expect(url.host).toBe('v1')
    expect(url.pathname).toBe('/import')
    expect(url.searchParams.get('resource')).toBe('provider')
    expect(url.searchParams.get('app')).toBe(app)
    expect(url.searchParams.get('name')).toBe('Example & 测试')
    expect(url.searchParams.get('apiFormat')).toBe(format)
    expect(url.searchParams.get('model')).toBe('model&version=1')
    expect(url.searchParams.get('apiKey')).toBe('sk-synthetic-only')
    expect(url.searchParams.get('enabled')).toBe('false')
    expect(url.searchParams.get('endpoint')).toBe(endpoint)
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

it('offers every permitted text model and keeps the choice when switching target apps', async () => {
  // The key belongs to premium; a different group selected elsewhere must not block it.
  catalogState.isPending = true
  catalogState.error = new Error('Another selected group is unavailable')
  const names = [
    'chat-only',
    'claude-text',
    'gemini-text',
    'responses-only',
    'gpt-image-2',
    'alias/gpt-image-2',
    'image-only',
    'embedding',
    'rerank',
    'audio-only',
    'task-only',
  ]
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/user/models?group=premium')
      return Response.json({ success: true, data: names })
    if (path === '/api/token/4/key')
      return Response.json({ success: true, data: { key: 'synthetic-pi-import' } })
    throw new Error(`Unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const key = {
    id: 4,
    group: 'premium',
    name: 'Desktop',
    model_limits_enabled: false,
    model_limits: 'responses-only',
  } as APIKey
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <CCSwitchImport apiKey={key} onClose={() => {}} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  const picker = screen.getByRole('combobox', { name: 'Model' })
  await waitFor(() => expect(picker).toBeEnabled())
  expect(screen.getByText('Use CC Switch 4.0.18 or later for all listed apps.')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Application' }))
  expect(screen.getAllByRole('option')).toHaveLength(9)
  expect(screen.queryByRole('option', { name: 'Claude Desktop' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'MiniMax Code' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Kimi Code' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  for (const [app, endpoint] of [
    ['Codex', 'https://api.example.test/gateway/v1'],
    ['Claude Code', 'https://api.example.test/gateway'],
    ['Gemini CLI', 'https://api.example.test/gateway'],
    ['Antigravity CLI', 'https://api.example.test/gateway'],
    ['Grok Build', 'https://api.example.test/gateway/v1'],
    ['OpenCode', 'https://api.example.test/gateway/v1'],
    ['OpenClaw', 'https://api.example.test/gateway/v1'],
    ['Hermes', 'https://api.example.test/gateway/v1'],
    ['Pi', 'https://api.example.test/gateway/v1'],
  ]) {
    if (app !== 'Codex') {
      await user.click(screen.getByRole('combobox', { name: 'Application' }))
      await user.click(await screen.findByRole('option', { name: app }))
      expect(picker).toHaveTextContent('chat-only')
    }
    expect(screen.getAllByText(endpoint!, { exact: true }).length).toBeGreaterThan(0)
    if (app === 'Antigravity CLI')
      expect(
        screen.getByText(
          'Launch Antigravity CLI from CC Switch after importing to use this provider.',
        ),
      ).toBeVisible()
    await user.click(picker)
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['chat-only', 'claude-text', 'gemini-text', 'responses-only']),
    )
    expect(screen.getAllByRole('option')).toHaveLength(4)
    await user.click(screen.getByRole('option', { name: 'chat-only' }))
    expect(screen.getByRole('button', { name: 'Prepare import' })).toBeEnabled()
  }
  expect(fetcher.mock.calls).toEqual([['/api/user/models?group=premium', expect.anything()]])
  await user.click(screen.getByRole('button', { name: 'Prepare import' }))
  await screen.findByRole('button', { name: 'Open CC Switch' })
  expect(screen.getByRole('combobox', { name: 'Application' })).toBeDisabled()
  expect(document.body.innerHTML).not.toContain('synthetic-pi-import')
  await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
  const imported = new URL(String(opened.mock.calls[0]?.[0]))
  expect(imported.searchParams.get('app')).toBe('pi')
  expect(imported.searchParams.get('apiFormat')).toBe('openai_chat')
  expect(imported.searchParams.get('model')).toBe('chat-only')
  expect(imported.searchParams.get('endpoint')).toBe('https://api.example.test/gateway/v1')
  expect(imported.searchParams.get('apiKey')).toBe('sk-synthetic-pi-import')
  expect(opened.mock.calls[0]?.slice(1)).toEqual(['_blank', 'noopener,noreferrer'])
  expect(Object.values(localStorage).join(' ')).not.toContain('synthetic-pi-import')
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('synthetic-pi-import')
  client.clear()
})

it.each([false, true])(
  'distinguishes an empty model list from a failed group request (failure: %s)',
  async (failure) => {
    const fetcher = vi.fn(async () =>
      failure
        ? Response.json({ success: false, message: 'Group models unavailable' }, { status: 503 })
        : Response.json({ success: true, data: [] }),
    )
    vi.stubGlobal('fetch', fetcher)
    const language = createInstance()
    await language.init({ lng: 'en', resources: { en: { translation: {} } } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <CCSwitchImport
            apiKey={
              { id: 4, group: 'premium', name: 'Desktop', model_limits_enabled: false } as APIKey
            }
            onClose={() => {}}
          />
        </QueryClientProvider>
      </I18nextProvider>,
    )
    if (failure) {
      expect(await screen.findByText('Group models unavailable')).toBeVisible()
      expect(
        screen.queryByText('No text models are available to this key in this group.'),
      ).not.toBeInTheDocument()
    } else
      expect(
        await screen.findByText('No text models are available to this key in this group.'),
      ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Prepare import' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledOnce()
    client.clear()
  },
)
