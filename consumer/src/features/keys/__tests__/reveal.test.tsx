import type { ReactNode } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { clearAuth } from '@/lib/auth-state'
import { CatalogProvider } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import KeysPage from '../KeysPage'
import { KeyEditor } from '../KeyEditor'
import type { APIKey } from '../types'

function TestRouter(props: { children: ReactNode }) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => props.children }),
    history: createMemoryHistory(),
  })
  return <RouterProvider router={router} />
}

beforeEach(() => {
  clearAuth()
  localStorage.clear()
  sessionStorage.clear()
  document.cookie = 'new_api_session=; Max-Age=0'
  document.cookie = 'new_api_has_session=; Max-Age=0'
})

it('editing a name preserves inherited group and disabled model restrictions', async () => {
  const fetch = vi.fn(async (path: string) => {
    if (path === '/api/status')
      return Response.json({ success: true, data: { quota_per_unit: 500000 } })
    if (path === '/api/pricing')
      return Response.json({
        success: true,
        data: [],
        usable_group: { default: 'Everyday' },
        group_ratio: { default: 1 },
      })
    if (path === '/api/token/') return Response.json({ success: true, data: {} })
    throw new Error(`Unexpected test request ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <CatalogProvider>
            <KeyEditor
              existing={
                {
                  id: 3,
                  name: 'Original name',
                  group: '',
                  expired_time: -1,
                  remain_quota: 500000,
                  unlimited_quota: false,
                  model_limits: 'archived-model',
                  model_limits_enabled: false,
                  allow_ips: '192.0.2.0/24',
                  allow_user_quota_query: false,
                  auto_groups: null,
                } as APIKey
              }
              onClose={() => {}}
              onSaved={() => {}}
            />
          </CatalogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
    { wrapper: TestRouter },
  )
  const input = await screen.findByRole('textbox', { name: 'Key name' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Renamed app')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save key' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Save key' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/token/')).toBe(true))
  const call = fetch.mock.calls.find(([path]) => path === '/api/token/') as unknown as [
    string,
    RequestInit,
  ]
  expect(call[1].method).toBe('PUT')
  expect(JSON.parse(call[1].body as string)).toMatchObject({
    id: 3,
    name: 'Renamed app',
    group: '',
    remain_quota: 500000,
    model_limits_enabled: false,
    model_limits: 'archived-model',
    allow_ips: '192.0.2.0/24',
    allow_user_quota_query: false,
  })
  expect(JSON.parse(call[1].body as string)).not.toHaveProperty('key')
})
afterEach(() => vi.unstubAllGlobals())

it('reveals only on explicit POST and clears the displayed secret when the dialog closes', async () => {
  const fetch = vi.fn(async (path: string) => {
    if (path === '/api/status')
      return Response.json({ success: true, data: { quota_per_unit: 500000 } })
    if (path === '/api/pricing')
      return Response.json({
        success: true,
        data: [],
        usable_group: { default: 'Everyday' },
        group_ratio: { default: 1 },
      })
    if (path.startsWith('/api/token/?'))
      return Response.json({
        success: true,
        data: {
          items: [
            {
              id: 2,
              name: 'Writing app',
              key: 'abcd********wxyz',
              status: 1,
              group: 'default',
              expired_time: -1,
              remain_quota: 500000,
              unlimited_quota: false,
            },
          ],
          total: 1,
        },
      })
    if (path === '/api/token/2/key')
      return Response.json({ success: true, data: { key: 'synthetic-secret-for-test' } })
    throw new Error(`Unexpected test request ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <CatalogProvider>
            <KeysPage />
          </CatalogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
    { wrapper: TestRouter },
  )
  await screen.findByText('Writing app')
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/key'))).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Reveal key' }))
  expect(await screen.findByText('sk-synthetic-secret-for-test')).toBeVisible()
  const reveal = fetch.mock.calls.find(([path]) => path.endsWith('/key')) as unknown as [
    string,
    RequestInit,
  ]
  expect(reveal[1].method).toBe('POST')
  expect(Object.values(localStorage).join(' ')).not.toContain('synthetic-secret')
  expect(sessionStorage.length).toBe(0)
  const keyCaches = client.getQueriesData({ queryKey: ['consumer-keys'] })
  expect(keyCaches.length).toBeGreaterThan(0)
  expect(keyCaches.some(([, data]) => Boolean(data))).toBe(true)
  expect(JSON.stringify(keyCaches)).not.toContain('synthetic-secret')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() =>
    expect(screen.queryByText('sk-synthetic-secret-for-test')).not.toBeInTheDocument(),
  )
})
