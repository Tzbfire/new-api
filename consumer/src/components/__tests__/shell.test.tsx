import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppShell } from '../shell'
const session = vi.hoisted(() => ({ user: { id: 5, username: 'fixture', quota: 0, role: 1 } }))
vi.mock('@/lib/session', () => ({ useSession: () => session }))
vi.mock('@/lib/status', () => ({ useStatus: () => ({ data: { quota_per_unit: 500000 } }) }))
beforeEach(() => {
  localStorage.clear()
  session.user.role = 1
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
async function setup(path = '/chat') {
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: AppShell }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}
it('lets the chat user collapse and reopen site navigation and remembers the explicit preference', async () => {
  const view = await setup()
  const collapse = await screen.findByRole('button', { name: 'Collapse navigation' })
  expect(collapse).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(collapse)
  const expand = screen.getByRole('button', { name: 'Expand navigation' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: 'API keys' })).toBeInTheDocument()
  view.unmount()
  await setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Expand navigation' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    ),
  )
})

it.each([1, 10, 100])(
  'shows the workspace legacy link and limits administration to role %s',
  async (role) => {
    session.user.role = role
    await setup('/keys')
    const legacyEntry = await screen.findByRole('link', { name: 'Switch to legacy' })
    expect(legacyEntry).toHaveClass('button-ghost')
    expect(screen.queryByText('New interface')).not.toBeInTheDocument()
    legacyEntry.focus()
    expect(legacyEntry).toHaveFocus()
    expect(legacyEntry).toHaveAttribute(
      'href',
      '/frontend/switch?version=legacy&return_to=%2Fdashboard',
    )
    if (role >= 10)
      expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute(
        'href',
        '/system-settings',
      )
    else expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
  },
)
