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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { RateLimitSection } from '../rate-limit-section'
import { RateLimitVisualEditor } from '../rate-limit-visual-editor'

function renderRateLimits(groupModel = '') {
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
            ModelRequestRateLimitGroupModel: groupModel,
          }}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

describe('rate limit settings', () => {
  beforeEach(() => {
    void i18next.changeLanguage('en')
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/group/'
            ? ['default', 'Codex-Plus', 'Codex-Pro', 'Luna-Pro']
            : [{ id: 'gpt-6-luna' }],
      },
    }))
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
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Max Requests (including failures)',
      }),
      { target: { value: '5' } }
    )
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Max Successful Requests' }),
      { target: { value: '5' } }
    )
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

  it('creates a group-model rule and saves its nested JSON', async () => {
    renderRateLimits()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Add group-model rule' })
    )
    const dialog = within(screen.getByRole('dialog'))
    await user.type(
      dialog.getByRole('combobox', { name: 'Group Name' }),
      'Codex-Plus'
    )
    await user.type(
      dialog.getByRole('combobox', { name: 'Model Name' }),
      'gpt-6-luna'
    )
    fireEvent.change(
      dialog.getByRole('spinbutton', {
        name: 'Max Requests (including failures)',
      }),
      { target: { value: '3000' } }
    )
    fireEvent.change(
      dialog.getByRole('spinbutton', { name: 'Max Successful Requests' }),
      { target: { value: '2000' } }
    )
    await user.click(dialog.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify(
          { 'Codex-Plus': { 'gpt-6-luna': [3000, 2000] } },
          null,
          2
        ),
      })
    )
  })

  it('edits a group-model rule to unlimited and disables its count inputs', async () => {
    renderRateLimits('{"Luna-Pro":{"gpt-6-luna":[3000,2000]}}')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('switch', { name: 'Unlimited' }))
    expect(
      dialog.getByRole('spinbutton', {
        name: 'Max Requests (including failures)',
      })
    ).toBeDisabled()
    expect(
      dialog.getByRole('spinbutton', { name: 'Max Successful Requests' })
    ).toBeDisabled()
    await user.click(dialog.getByRole('button', { name: 'Update' }))
    expect(
      within(
        screen.getByRole('row', { name: /Luna-Pro.*gpt-6-luna/ })
      ).getAllByText('Unlimited')
    ).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify(
          { 'Luna-Pro': { 'gpt-6-luna': [0, 0] } },
          null,
          2
        ),
      })
    )
  })

  it('deletes only the chosen group-model rule and keeps other groups', async () => {
    renderRateLimits(
      '{"Codex-Plus":{"gpt-6-luna":[3000,2000]},"Luna-Pro":{"gpt-6-luna":[0,0]}}'
    )
    const user = userEvent.setup()
    const row = screen.getByRole('row', { name: /Codex-Plus/ })
    await user.click(within(row).getByRole('button', { name: 'Open menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify(
          { 'Luna-Pro': { 'gpt-6-luna': [0, 0] } },
          null,
          2
        ),
      })
    )
  })

  it('restores a successful request limit when switching unlimited off', async () => {
    renderRateLimits('{"Luna-Pro":{"gpt-6-luna":[0,0]}}')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('switch', { name: 'Unlimited' }))
    expect(
      dialog.getByRole('spinbutton', { name: 'Max Successful Requests' })
    ).toHaveValue(1)
    await user.click(dialog.getByRole('button', { name: 'Update' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify(
          { 'Luna-Pro': { 'gpt-6-luna': [0, 1] } },
          null,
          2
        ),
      })
    )
  })

  it('selects known groups and models and allows a total-only rule', async () => {
    renderRateLimits()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Add group-model rule' })
    )
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: 'Group Name' }))
    await user.click(await dialog.findByRole('option', { name: 'Codex-Pro' }))
    await user.click(dialog.getByRole('combobox', { name: 'Model Name' }))
    await user.click(await dialog.findByRole('option', { name: 'gpt-6-luna' }))
    fireEvent.change(
      dialog.getByRole('spinbutton', {
        name: 'Max Requests (including failures)',
      }),
      { target: { value: '10' } }
    )
    fireEvent.change(
      dialog.getByRole('spinbutton', { name: 'Max Successful Requests' }),
      { target: { value: '0' } }
    )
    await user.click(dialog.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify(
          { 'Codex-Pro': { 'gpt-6-luna': [10, 0] } },
          null,
          2
        ),
      })
    )
  })

  it('saves clearing the JSON editor as an empty object', async () => {
    renderRateLimits('{"Luna-Pro":{"gpt-6-luna":[0,0]}}')
    const user = userEvent.setup()
    const section = screen
      .getByText('Group and model rate limits')
      .closest('[data-slot="form-item"]')
    if (!section) throw new Error('Group-model settings field not found')
    await user.click(
      within(section as HTMLElement).getByRole('button', { name: 'JSON Mode' })
    )
    const editor = screen.getByRole('textbox', {
      name: 'Group and model rate limits',
    })
    fireEvent.input(editor, { target: { value: '  ' } })
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: '{}',
      })
    )
  })

  it('filters group-model rules by group and model', async () => {
    renderRateLimits(
      '{"Codex-Plus":{"gpt-6-luna":[10,10]},"Luna-Pro":{"gpt-5.6-luna":[0,0]}}'
    )
    const user = userEvent.setup()
    const search = screen.getByRole('textbox', {
      name: 'Search groups or models...',
    })
    await user.type(search, 'Codex-Plus')
    expect(screen.getByRole('row', { name: /Codex-Plus/ })).toBeVisible()
    expect(
      screen.queryByRole('row', { name: /Luna-Pro/ })
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'gpt-5.6')
    expect(screen.getByRole('row', { name: /Luna-Pro/ })).toBeVisible()
  })

  it.each([
    ['zhCN', '3,000'],
    ['zhTW', '3,000'],
    ['en', '3,000'],
    ['fr', '3\u202f000'],
    ['ru', '3\u00a0000'],
    ['ja', '3,000'],
    ['vi', '3.000'],
    ['not_a_locale', '3,000'],
  ])(
    'formats rule counts for interface language %s',
    async (language, expected) => {
      i18next.addResourceBundle(language, 'translation', {
        'Group Name': 'Group Name',
      })
      await i18next.changeLanguage(language)
      render(
        <RateLimitVisualEditor
          entity='group-model'
          value='{"default":{"gpt-6-luna":[3000,2000]}}'
          onChange={() => undefined}
        />
      )
      const row = screen.getByRole('row', { name: /default.*gpt-6-luna/ })
      expect(
        within(row).getByText(expected, { normalizer: (value) => value })
      ).toBeVisible()
    }
  )

  it('updates count formatting when the interface language changes', async () => {
    i18next.addResourceBundle('vi', 'translation', {
      'Group Name': 'Group Name',
    })
    render(
      <RateLimitVisualEditor
        entity='group-model'
        value='{"default":{"gpt-6-luna":[3000,2000]}}'
        onChange={() => undefined}
      />
    )
    expect(screen.getByText('3,000')).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('vi')
    })
    expect(screen.getByText('3.000')).toBeVisible()
  })

  it.each([
    'null',
    '{"default":[1,1]}',
    '{"default":{"gpt-6-luna":[1.5,1]}}',
    '{" ":{"gpt-6-luna":[0,0]}}',
    '{" default":{"gpt-6-luna":[0,0]}}',
    '{"default":{"gpt-6-luna ":[0,0]}}',
  ])('rejects invalid group-model JSON %s', async (invalid) => {
    renderRateLimits(invalid)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    expect(
      await screen.findByText(
        'Invalid JSON format or values out of allowed range'
      )
    ).toBeVisible()
    expect(api.put).not.toHaveBeenCalled()
  })
})
