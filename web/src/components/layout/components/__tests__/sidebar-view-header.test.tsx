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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'
import { expect, test, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'

import { SYSTEM_SETTINGS_VIEW } from '../../config/system-settings.config'
import { SidebarViewHeader } from '../sidebar-view-header'

test('returning from system settings explicitly selects the legacy console through document navigation', async () => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/system-settings'] }),
    routeTree: createRootRoute({
      component: () => (
        <SidebarProvider>
          <SidebarViewHeader view={SYSTEM_SETTINGS_VIEW} />
        </SidebarProvider>
      ),
    }),
  })
  render(<RouterProvider router={router} />)
  const link = await screen.findByRole('link', { name: 'Back to Dashboard' })
  expect(link).toHaveAttribute(
    'href',
    '/frontend/switch?version=legacy&return_to=%2Fdashboard%2Foverview'
  )
  // A document request must reach the gateway to persist the selected interface.
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(undefined)
  fireEvent.click(link)
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ reloadDocument: true })
  )
})

vi.mock('@/features/system-settings/auth/section-registry', () => ({
  getAuthSectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/billing/section-registry', () => ({
  getBillingSectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/content/section-registry', () => ({
  getContentSectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/models/section-registry', () => ({
  getModelsSectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/operations/section-registry', () => ({
  getOperationsSectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/request-policies/section-registry', () => ({
  getPolicySectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/security/section-registry', () => ({
  getSecuritySectionNavItems: () => [],
}))

vi.mock('@/features/system-settings/site/section-registry', () => ({
  getSiteSectionNavItems: () => [],
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: (props: { children: ReactNode }) => props.children,
  SidebarHeader: (props: { children: ReactNode }) => (
    <div>{props.children}</div>
  ),
  SidebarMenu: (props: { children: ReactNode }) => <ul>{props.children}</ul>,
  SidebarMenuItem: (props: { children: ReactNode }) => (
    <li>{props.children}</li>
  ),
  SidebarMenuButton: (props: { render: ReactElement; children: ReactNode }) =>
    cloneElement(props.render, {}, props.children),
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
}))
