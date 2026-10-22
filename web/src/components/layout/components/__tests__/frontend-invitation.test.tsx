/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { FrontendInvitation } from '../frontend-invitation'

async function renderInvitation(path = '/', enabled = true, available = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    frontend_enabled: enabled,
    frontend_available: available,
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: FrontendInvitation }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await router.load()
  return view
}

beforeEach(() => {
  localStorage.clear()
  document.cookie = 'factory_frontend=; Max-Age=0; Path=/'
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: {} } })
})

test('offers an optional preview on the legacy home page without selecting a version', async () => {
  await renderInvitation()
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveAccessibleName(/A new interface to explore/)
  expect(dialog).toHaveAccessibleDescription(
    /account and balance stay the same/
  )
  expect(
    within(dialog).getByRole('link', { name: 'Try the new interface' })
  ).toHaveAttribute('href', '/frontend/switch?version=consumer&return_to=/')
  expect(localStorage.getItem('factory:frontend')).toBeNull()
  expect(document.cookie).not.toContain('factory_frontend=')
})

test.each(['button', 'escape'])(
  'dismissing with %s keeps the legacy page and does not repeat on reload',
  async (action) => {
    const view = await renderInvitation()
    const dialog = await screen.findByRole('dialog')
    if (action === 'button') {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: 'Keep using the current interface',
        })
      )
    } else {
      await userEvent.setup().keyboard('{Escape}')
    }
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(localStorage.getItem('factory:frontend')).toBeNull()
    view.unmount()
    await renderInvitation()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }
)

test.each(['consumer', 'legacy'])(
  'does not invite someone who explicitly selected %s',
  async (preference) => {
    localStorage.setItem('factory:frontend', preference)
    await renderInvitation()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }
)

test('respects a saved cookie when local storage has no preference', async () => {
  document.cookie = 'factory_frontend=legacy; Path=/'
  await renderInvitation()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each([
  '/wallet?pay=success',
  '/orders',
  '/sign-in',
  '/oauth/github?code=original',
  '/system-settings',
])('does not interrupt the existing flow at %s', async (path) => {
  await renderInvitation(path)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each([
  [false, true],
  [true, false],
])(
  'does not offer an unavailable interface (enabled %s, available %s)',
  async (enabled, available) => {
    await renderInvitation('/', enabled, available)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }
)

test('does not interrupt browsing when preference storage is unavailable', async () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  await renderInvitation()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
