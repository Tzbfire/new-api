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
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { RateLimitSection } from '../rate-limit-section'
import { RateLimitVisualEditor } from '../rate-limit-visual-editor'

type Defaults = Parameters<typeof RateLimitSection>[0]['defaultValues']
const defaults: Defaults = {
  ModelRequestRateLimitEnabled: true,
  ModelRequestRateLimitDurationMinutes: 120,
  ModelRequestRateLimitCount: 0,
  ModelRequestRateLimitSuccessCount: 10000,
  ModelRequestRateLimitGroup: '',
  ModelRequestRateLimitModel: '',
  ModelRequestRateLimitGroupModel: '',
}
function renderRateLimits(overrides: Partial<Defaults> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const actionsContainer = document.createElement('div')
  document.body.append(actionsContainer)
  const Wrapper = (props: { values: Defaults }) => (
    <QueryClientProvider client={queryClient}>
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <RateLimitSection defaultValues={props.values} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const view = render(<Wrapper values={{ ...defaults, ...overrides }} />)
  return {
    ...view,
    rerenderDefaults: (values: Partial<Defaults>) =>
      view.rerender(<Wrapper values={{ ...defaults, ...values }} />),
  }
}
async function selectTarget(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: value }))
  await user.keyboard('{Escape}')
}
function changeLimits(total: string, success: string) {
  fireEvent.change(
    screen.getByRole('spinbutton', {
      name: 'Max Requests (including failures)',
    }),
    { target: { value: total } }
  )
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Max Successful Requests' }),
    { target: { value: success } }
  )
}
function savedOptions() {
  return vi.mocked(api.put).mock.calls.map(([, value]) => value)
}

describe('unified rate limit rules', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en')
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/group/'
            ? ['default', 'Codex-Plus', 'Codex-Pro', 'Luna-Pro']
            : [{ id: 'gpt-6-luna' }, { id: 'gpt-5.6-luna' }],
      },
    }))
    vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
    vi.spyOn(toast, 'success')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows legacy group, model, group-model and global rules in one table with one add action', () => {
    renderRateLimits({
      ModelRequestRateLimitGroup: '{"default":[100,50]}',
      ModelRequestRateLimitModel: '{"gpt-6-luna":[3000,2000]}',
      ModelRequestRateLimitGroupModel: '{"Luna-Pro":{"gpt-6-luna":[0,0]}}',
    })
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Add rule' })).toHaveLength(1)
    expect(
      screen.getByRole('row', { name: /default All models/ })
    ).toBeVisible()
    expect(
      screen.getByRole('row', { name: /All groups gpt-6-luna/ })
    ).toBeVisible()
    expect(
      screen.getByRole('row', { name: /Luna-Pro gpt-6-luna/ })
    ).toBeVisible()
    expect(
      screen.queryByText('Group-based rate limits')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Model-specific rate limits')
    ).not.toBeInTheDocument()
  })

  it('adds all six group-model combinations in one dialog', async () => {
    renderRateLimits()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    for (const group of ['default', 'Codex-Plus', 'Codex-Pro']) {
      await selectTarget(user, 'Select groups', group)
    }
    for (const model of ['gpt-6-luna', 'gpt-5.6-luna']) {
      await selectTarget(user, 'Select models', model)
    }
    changeLimits('3000', '2000')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(8))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(savedOptions()).toEqual([
      {
        key: 'ModelRequestRateLimitGroupModel',
        value: JSON.stringify({
          default: { 'gpt-6-luna': [3000, 2000], 'gpt-5.6-luna': [3000, 2000] },
          'Codex-Plus': {
            'gpt-6-luna': [3000, 2000],
            'gpt-5.6-luna': [3000, 2000],
          },
          'Codex-Pro': {
            'gpt-6-luna': [3000, 2000],
            'gpt-5.6-luna': [3000, 2000],
          },
        }),
      },
    ])
  })

  it.each(['group', 'model'])(
    'adds an unlimited %s rule from the same dialog',
    async (scope) => {
      renderRateLimits()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Add rule' }))
      if (scope === 'group') {
        await selectTarget(user, 'Select groups', 'Luna-Pro')
        await user.click(screen.getByRole('switch', { name: 'All models' }))
      } else {
        await user.click(screen.getByRole('switch', { name: 'All groups' }))
        await selectTarget(user, 'Select models', 'gpt-6-luna')
      }
      await user.click(screen.getByRole('switch', { name: 'Unlimited' }))
      expect(
        screen.getByRole('spinbutton', { name: 'Max Successful Requests' })
      ).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Add' }))
      await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
      await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
      const expected =
        scope === 'group'
          ? { key: 'ModelRequestRateLimitGroup', value: '{"Luna-Pro":[0,0]}' }
          : { key: 'ModelRequestRateLimitModel', value: '{"gpt-6-luna":[0,0]}' }
      expect(savedOptions()).toEqual([expected])
    }
  )

  it('edits the global default without offering deletion or target changes', async () => {
    renderRateLimits()
    const user = userEvent.setup()
    const row = within(
      screen.getByRole('row', { name: /All groups All models/ })
    )
    expect(
      row.queryByRole('button', { name: 'Open menu' })
    ).not.toBeInTheDocument()
    await user.click(row.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('switch', { name: 'All groups' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('switch', { name: 'All models' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await user.click(screen.getByRole('switch', { name: 'Unlimited' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitSuccessCount',
        value: 0,
      })
    )
  })

  it('moves a rule to all groups and removes its previous group-specific entry', async () => {
    renderRateLimits({
      ModelRequestRateLimitGroupModel: '{"default":{"gpt-6-luna":[10,5]}}',
    })
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('row', { name: /default gpt-6-luna/ })).getByRole(
        'button',
        { name: 'Edit' }
      )
    )
    await user.click(screen.getByRole('switch', { name: 'All groups' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(
      screen.queryByRole('row', { name: /default gpt-6-luna/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('row', { name: /All groups gpt-6-luna/ })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
    expect(savedOptions()).toContainEqual({
      key: 'ModelRequestRateLimitGroupModel',
      value: '{}',
    })
    expect(savedOptions()).toContainEqual({
      key: 'ModelRequestRateLimitModel',
      value: '{"gpt-6-luna":[10,5]}',
    })
  })

  it('rejects missing targets and duplicate rules without overwriting existing limits', async () => {
    renderRateLimits({ ModelRequestRateLimitModel: '{"gpt-6-luna":[10,5]}' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(
      await screen.findByText('Select at least one group or enable All groups.')
    ).toBeVisible()
    expect(
      screen.getByText('Select at least one model or enable All models.')
    ).toBeVisible()
    await user.click(screen.getByRole('switch', { name: 'All groups' }))
    await selectTarget(user, 'Select models', 'gpt-6-luna')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(
      await screen.findByText('Rule already exists for this group and model.')
    ).toBeVisible()
    expect(api.put).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      within(
        screen.getByRole('row', { name: /All groups gpt-6-luna/ })
      ).getByText('5')
    ).toBeVisible()
  })

  it('switches unlimited off and supports total-only limits', async () => {
    renderRateLimits({
      ModelRequestRateLimitGroupModel: '{"Luna-Pro":{"gpt-6-luna":[0,0]}}',
    })
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('row', { name: /Luna-Pro/ })).getByRole(
        'button',
        { name: 'Edit' }
      )
    )
    await user.click(screen.getByRole('switch', { name: 'Unlimited' }))
    expect(
      screen.getByRole('spinbutton', { name: 'Max Successful Requests' })
    ).toHaveValue(1)
    changeLimits('10', '0')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ModelRequestRateLimitGroupModel',
        value: '{"Luna-Pro":{"gpt-6-luna":[10,0]}}',
      })
    )
  })

  it('deletes only the chosen rule and preserves unrelated scopes', async () => {
    renderRateLimits({
      ModelRequestRateLimitGroup: '{"default":[100,50]}',
      ModelRequestRateLimitGroupModel: '{"Luna-Pro":{"gpt-6-luna":[0,0]}}',
    })
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('row', { name: /Luna-Pro/ })).getByRole(
        'button',
        { name: 'Open menu' }
      )
    )
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(savedOptions()).toEqual([
      { key: 'ModelRequestRateLimitGroupModel', value: '{}' },
    ])
    expect(
      screen.getByRole('row', { name: /default All models/ })
    ).toBeVisible()
  })

  it('keeps the draft after a partial save failure and retries without reporting success', async () => {
    const view = renderRateLimits({
      ModelRequestRateLimitGroupModel: '{"default":{"gpt-6-luna":[10,5]}}',
    })
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('row', { name: /default gpt-6-luna/ })).getByRole(
        'button',
        { name: 'Edit' }
      )
    )
    await user.click(screen.getByRole('switch', { name: 'All models' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))
    vi.mocked(api.put)
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({
        data: { success: false, message: 'Save failed' },
      })
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    expect(
      await screen.findByText(
        'Some settings may have been saved. Your changes are kept; save again to finish.'
      )
    ).toBeVisible()
    expect(toast.success).not.toHaveBeenCalled()
    view.rerenderDefaults({ ModelRequestRateLimitGroupModel: '{}' })
    expect(
      screen.getByRole('row', { name: /default All models/ })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(savedOptions()).toContainEqual({
      key: 'ModelRequestRateLimitGroup',
      value: '{"default":[10,5]}',
    })
  })

  it('disables editing until the save request finishes', async () => {
    renderRateLimits()
    let finish: ((response: { data: { success: boolean } }) => void) | undefined
    vi.mocked(api.put).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('switch', { name: 'Enable rate limiting' })
    )
    await user.click(screen.getByRole('button', { name: 'Save rate limits' }))
    expect(
      screen.getByRole('switch', { name: 'Enable rate limiting' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(
      screen.getByRole('spinbutton', { name: 'Limit period' })
    ).toBeDisabled()
    await act(async () => {
      finish?.({ data: { success: true } })
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save rate limits' })
      ).toBeEnabled()
    )
    expect(
      screen.getByRole('switch', { name: 'Enable rate limiting' })
    ).toHaveAttribute('aria-checked', 'false')
  })

  it.each([0, 1.5, 1441])(
    'rejects an invalid limit period %s before saving',
    async (value) => {
      renderRateLimits()
      fireEvent.change(
        screen.getByRole('spinbutton', { name: 'Limit period' }),
        { target: { value: String(value) } }
      )
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Save rate limits' }))
      const expected =
        value === 1.5
          ? 'Amount must be a whole number'
          : 'Count must be between 1 and 1440'
      expect(await screen.findByText(expected)).toBeVisible()
      expect(api.put).not.toHaveBeenCalled()
    }
  )

  it('does not rewrite unchanged legacy JSON when opening and saving the unified table', async () => {
    renderRateLimits({
      ModelRequestRateLimitGroup: '{ "default": [100, 50] }',
      ModelRequestRateLimitModel: '{ "gpt-6-luna": [3000, 2000] }',
      ModelRequestRateLimitGroupModel: '{"empty":{}}',
    })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Save rate limits' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each(['null', '{"default":null}', '{"default":{"gpt-6-luna":[0]}}'])(
    'preserves invalid stored settings and prevents saving %s',
    async (invalid) => {
      renderRateLimits({ ModelRequestRateLimitGroupModel: invalid })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The saved rate limit configuration is invalid.'
      )
      expect(
        screen.getByRole('button', { name: 'Save rate limits' })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
      expect(api.put).not.toHaveBeenCalled()
    }
  )

  it('filters unified rules by either group or model', async () => {
    renderRateLimits({
      ModelRequestRateLimitGroup: '{"default":[100,50]}',
      ModelRequestRateLimitModel: '{"gpt-6-luna":[3000,2000]}',
    })
    const user = userEvent.setup()
    const search = screen.getByRole('textbox', {
      name: 'Search groups or models...',
    })
    await user.type(search, 'gpt-6-luna')
    expect(
      screen.getByRole('row', { name: /All groups gpt-6-luna/ })
    ).toBeVisible()
    expect(
      screen.queryByRole('row', { name: /default/ })
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'default')
    expect(
      screen.getByRole('row', { name: /default All models/ })
    ).toBeVisible()
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
  ])('formats counts for interface language %s', async (language, expected) => {
    i18next.addResourceBundle(language, 'translation', { Groups: 'Groups' })
    await i18next.changeLanguage(language)
    render(
      <RateLimitVisualEditor
        rules={[
          {
            group: 'default',
            model: 'gpt-6-luna',
            maxRequests: 3000,
            maxSuccess: 2000,
          },
        ]}
        onChange={() => undefined}
      />
    )
    expect(
      within(
        screen.getByRole('row', { name: /default.*gpt-6-luna/ })
      ).getByText(expected, { normalizer: (value) => value })
    ).toBeVisible()
  })
  it('updates rule counts when the interface language changes', async () => {
    render(
      <RateLimitVisualEditor
        rules={[
          {
            group: 'default',
            model: 'gpt-6-luna',
            maxRequests: 3000,
            maxSuccess: 2000,
          },
        ]}
        onChange={() => undefined}
      />
    )
    expect(screen.getByText('3,000')).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('vi')
    })
    expect(screen.getByText('3.000')).toBeVisible()
  })
})
