/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { RateLimitSection } from '../rate-limit-section'

function renderRateLimits() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const actionsContainer = document.createElement('div')
  document.body.append(actionsContainer)

  render(
    <QueryClientProvider client={queryClient}>
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <RateLimitSection
          defaultValues={{
            ModelRequestRateLimitEnabled: true,
            ModelRequestRateLimitDurationMinutes: 1,
            ModelRequestRateLimitCount: 100,
            ModelRequestRateLimitSuccessCount: 100,
            ModelRequestRateLimitGroup: '',
            ModelRequestRateLimitModel: '',
          }}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

describe('rate limit settings', () => {
  beforeEach(() => {
    vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('adds model-specific limits through the visual editor', async () => {
    renderRateLimits()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Model Name' }),
      'gpt-6-luna'
    )
    const spinbuttons = screen.getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[0], { target: { value: '5' } })
    fireEvent.change(spinbuttons[1], { target: { value: '5' } })
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    const dialogAddButton = addButtons.at(-1)
    if (!dialogAddButton) throw new Error('Add button not found')
    await user.click(dialogAddButton)
    fireEvent.click(screen.getByRole('button', { name: 'Save rate limits' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitModel',
        value: '{\n  "gpt-6-luna": [\n    5,\n    5\n  ]\n}',
      })
    )
  })
})
