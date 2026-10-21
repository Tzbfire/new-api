import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveSiteBrand } from '@/lib/brand'
import type { SiteStatus } from '@/lib/status'
import { Brand, SiteMetadata } from '../brand'

beforeEach(() => {
  for (const key of [
    'PUBLIC_SITE_NAME',
    'PUBLIC_SITE_DOMAIN',
    'PUBLIC_SITE_TITLE',
    'PUBLIC_SITE_DESCRIPTION',
    'PUBLIC_SITE_LOGO_URL',
  ])
    vi.stubEnv(key, '')
})
afterEach(() => vi.unstubAllEnvs())

it('uses neutral defaults and accepts backend presentation without requiring site-specific code', () => {
  expect(resolveSiteBrand()).toMatchObject({
    name: 'New API',
    domain: '',
    title: 'New API',
    logo: '',
  })
  expect(
    resolveSiteBrand({
      system_name: 'Example AI',
      server_address: 'https://ai.example.test/base',
      logo: '/brand.svg',
    }),
  ).toMatchObject({
    name: 'Example AI',
    domain: 'ai.example.test',
    title: 'Example AI',
    logo: '/brand.svg',
  })
  expect(
    resolveSiteBrand({ server_address: 'invalid', logo: 'javascript:alert(1)' }),
  ).toMatchObject({ domain: '', logo: '' })
})

it('allows private build settings to override presentation without changing backend settings', () => {
  vi.stubEnv('PUBLIC_SITE_NAME', 'Private AI')
  vi.stubEnv('PUBLIC_SITE_DOMAIN', 'private.example.test')
  vi.stubEnv('PUBLIC_SITE_TITLE', 'Private AI platform')
  vi.stubEnv('PUBLIC_SITE_DESCRIPTION', 'Your private model platform')
  vi.stubEnv('PUBLIC_SITE_LOGO_URL', '/private-logo.svg')
  expect(resolveSiteBrand({ system_name: 'Example AI', logo: '/old-logo.svg' })).toEqual({
    name: 'Private AI',
    domain: 'private.example.test',
    title: 'Private AI platform',
    description: 'Your private model platform',
    logo: '/private-logo.svg',
  })
})

it('updates the visible brand and page metadata together when administrator settings change', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData<SiteStatus>(['status'], {
    system_name: 'Example',
    server_address: 'https://example.test',
    logo: '/brand.svg',
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const description = document.createElement('meta')
  description.name = 'description'
  const icon = document.createElement('link')
  icon.rel = 'icon'
  document.head.append(description, icon)
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: createRootRoute({
      component: () => (
        <>
          <SiteMetadata />
          <Brand />
        </>
      ),
    }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  try {
    expect(
      await screen.findByRole('link', { name: 'Example · AI model platform' }),
    ).toHaveTextContent('Example.test')
    expect(document.title).toBe('Example')
    expect(description.content).toContain('Powered by New API · QuantumNous')
    expect(icon.getAttribute('href')).toBe('/brand.svg')
    fireEvent.error(document.querySelector('img.site-mark')!)
    expect(document.querySelector('svg.site-mark')).toBeInTheDocument()
    act(() =>
      client.setQueryData<SiteStatus>(['status'], {
        system_name: 'Another AI',
        logo: '/another.svg',
      }),
    )
    await waitFor(() => expect(document.title).toBe('Another AI'))
    expect(
      screen.getByRole('link', { name: 'Another AI · AI model platform' }),
    ).not.toHaveTextContent('.test')
    expect(document.querySelector('img.site-mark')).toHaveAttribute('src', '/another.svg')
    expect(icon.getAttribute('href')).toBe('/another.svg')
  } finally {
    view.unmount()
    client.clear()
    description.remove()
    icon.remove()
  }
})
