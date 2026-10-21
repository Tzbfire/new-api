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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Toaster } from 'sonner'
import { beforeEach, expect, test, vi } from 'vitest'

import { FrontendEntry } from '@/components/layout/components/frontend-entry'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { SystemInfoSection } from '../system-info-section'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <Toaster />
      <div ref={setContainer} />
      <FrontendEntry />
      <SettingsPageProvider actionsContainer={container}>
        <SystemInfoSection
          defaultValues={{
            SystemName: 'New API',
            TaskPublicAddress: '',
            general_setting: { docs_link: '' },
            legal: {},
          }}
        />
      </SettingsPageProvider>
    </>
  )
}
async function renderSettings(enabled = true, available = true) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { frontend_enabled: enabled, frontend_available: available },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return {
    client,
    toggle: await screen.findByRole('switch', {
      name: 'Enable new user interface',
    }),
  }
}
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})
test('absent option defaults on and saving toggled preference sends its key and refreshes status', async () => {
  const { client, toggle } = await renderSettings()
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'frontend_setting.enabled',
      value: 'false',
    })
  )
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['status'] })
  )
})
test('failed save keeps the changed setting available to retry', async () => {
  vi.mocked(api.put).mockResolvedValue({
    data: { success: false, message: 'Save rejected' },
  })
  const { toggle } = await renderSettings()
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()
})
test.each([
  [true, true],
  [true, false],
  [false, true],
])('entry respects enabled %s and available %s', async (enabled, available) => {
  await renderSettings(enabled, available)
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  if (enabled && available) {
    expect(await screen.findByText('New release')).toBeVisible()
    const entry = await screen.findByRole('link', {
      name: 'Try the new interface',
    })
    expect(entry).toHaveAttribute(
      'href',
      '/frontend/switch?version=consumer&return_to=/'
    )
    expect(entry).toHaveClass('h-10', 'max-w-full')
    entry.focus()
    expect(entry).toHaveFocus()
    expect(entry).not.toHaveAttribute('tabindex', '-1')
  } else {
    expect(
      screen.queryByRole('link', { name: 'Try the new interface' })
    ).not.toBeInTheDocument()
  }
  if (!available) {
    expect(
      await screen.findByText(
        'New interface assets are unavailable. The legacy interface remains active.'
      )
    ).toBeInTheDocument()
  }
})
