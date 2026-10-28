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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('saves model-specific limits as their own option', async () => {
    renderRateLimits()
    const editor = screen.getByRole('textbox', {
      name: 'Model-specific rate limits',
    })

    fireEvent.input(editor, {
      target: { value: '{"gpt-6-luna":[5,5]}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate limits' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitModel',
        value: '{"gpt-6-luna":[5,5]}',
      })
    )
  })
})
