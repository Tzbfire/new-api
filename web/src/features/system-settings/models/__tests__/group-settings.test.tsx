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
import { zodResolver } from '@hookform/resolvers/zod'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  renderHook,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { useUpdateOption } from '../../hooks/use-update-option'
import { positiveIntegerSchema } from '../../utils/numeric-field'
import { GroupRatioForm } from '../group-ratio-form'

const defaults = {
  GroupRatio: '{"default":1,"vip":0.8}',
  TopupGroupRatio: '{"vip":1.2}',
  UserUsableGroups: '{"default":"Standard access","vip":"Premium access"}',
  GroupGroupRatio: '{}',
  AutoGroups: '["default","vip"]',
  GroupDisplayOrder: '[]',
  MaxTokenAutoGroups: 5,
  DefaultUseAutoGroup: false,
  QuotaBucketBillingEnabled: false,
  PaidQuotaBillingGroup: 'vip',
  GroupSpecialUsableGroup: '{}',
}

const schema = z.object({
  GroupRatio: z.string(),
  TopupGroupRatio: z.string(),
  UserUsableGroups: z.string(),
  GroupGroupRatio: z.string(),
  AutoGroups: z.string(),
  GroupDisplayOrder: z.string(),
  MaxTokenAutoGroups: positiveIntegerSchema('Enter a positive integer'),
  DefaultUseAutoGroup: z.boolean(),
  QuotaBucketBillingEnabled: z.boolean(),
  PaidQuotaBillingGroup: z.string(),
  GroupSpecialUsableGroup: z.string(),
})

function Fixture(props: {
  onSave?: (values: typeof defaults) => Promise<void>
  initial?: Partial<typeof defaults>
  isSaving?: boolean
}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const form = useForm({
    defaultValues: { ...defaults, ...props.initial },
    resolver: zodResolver(schema),
  })
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <GroupRatioForm
        form={form}
        onSave={props.onSave ?? (async () => {})}
        isSaving={props.isSaving ?? false}
      />
    </SettingsPageProvider>
  )
}

describe('group settings workspace', () => {
  it('saves user display order independently of pricing and automatic routing', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Group display order' }))
    const list = screen.getByRole('list', { name: 'Group display order' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'default'
    )
    expect(
      within(list).queryByRole('button', { name: 'Remove vip' })
    ).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Move vip up' }))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('vip')
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupDisplayOrder)).toEqual([
      'vip',
      'default',
    ])
    expect(onSave.mock.calls[0][0].AutoGroups).toBe(defaults.AutoGroups)
    expect(onSave.mock.calls[0][0].GroupRatio).toBe(defaults.GroupRatio)
  })

  it('appends newly available groups, ignores retired groups and restores default display order', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{ GroupDisplayOrder: '["vip","retired"]' }}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'Group display order' }))
    const list = screen.getByRole('list', { name: 'Group display order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('vip')
    expect(within(list).queryByText('retired')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Restore default order' })
    )
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'default'
    )
    expect(
      screen.getByRole('button', { name: 'Restore default order' })
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupDisplayOrder)).toEqual([])
  })

  it('reorders the display list from its keyboard drag handle and keeps edits between editor modes', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('tab', { name: 'Group display order' }))
    const list = screen.getByRole('list', { name: 'Group display order' })
    const handle = within(list).getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'default'
    )
    expect(handle).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
    await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
    expect(
      within(
        screen.getByRole('list', { name: 'Group display order' })
      ).getAllByRole('listitem')[0]
    ).toHaveTextContent('vip')
  })

  it('keeps a single display group fixed and includes the automatic option when selectable', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        initial={{
          GroupRatio: '{}',
          TopupGroupRatio: '{}',
          UserUsableGroups: '{"auto":"Automatic selection"}',
        }}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'Group display order' }))
    const list = screen.getByRole('list', { name: 'Group display order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Automatic selection')).toBeVisible()
    expect(
      within(list).getByRole('button', { name: 'Move auto up' })
    ).toBeDisabled()
    expect(
      within(list).getByRole('button', { name: 'Move auto down' })
    ).toBeDisabled()
    const handle = within(list).getByRole('button', {
      name: 'Drag auto to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}')
    expect(within(list).getByRole('listitem')).toHaveTextContent('auto')
  })

  it('keeps bucket billing settings editable across visual and JSON modes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('switch', { name: 'Enable strict quota bucket billing' }))
    const group = screen.getByRole('textbox', { name: 'Paid quota entitlement group' })
    await user.clear(group)
    await user.type(group, 'premium')
    await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
    expect(screen.getByRole('switch', { name: 'Enable strict quota bucket billing' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Paid quota entitlement group' })).toHaveValue('premium')
    await user.click(screen.getByRole('button', { name: 'Save group settings' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ QuotaBucketBillingEnabled: true, PaidQuotaBillingGroup: 'premium' })
  })

  it('filters by description and clears search without discarding edits', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    const search = screen.getByRole('textbox', {
      name: 'Search groups by name or description',
    })
    await user.type(search, 'PREMIUM')
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      1
    )
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue(
      'vip'
    )
    await user.clear(screen.getByRole('spinbutton', { name: 'Ratio' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Ratio' }), '0.6')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      2
    )
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[1]).toHaveValue(
      0.6
    )
    await user.type(search, 'missing')
    expect(screen.getByText('No results found')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(search).toHaveValue('')
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_1', 'default', 'vip'])
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[2]).toHaveValue(
      0.6
    )
  })

  it('prepends consecutive new groups and saves them without changing existing settings', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_2', 'group_1', 'default', 'vip'])

    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(JSON.parse(saved.GroupRatio)).toEqual({
      group_2: 1,
      group_1: 1,
      default: 1,
      vip: 0.8,
    })
    expect(JSON.parse(saved.UserUsableGroups)).toEqual({
      group_2: '',
      group_1: '',
      default: 'Standard access',
      vip: 'Premium access',
    })
    expect(JSON.parse(saved.TopupGroupRatio)).toEqual({ vip: 1.2 })
    expect(saved.AutoGroups).toBe(defaults.AutoGroups)
  })

  it('keeps unfinished visibility rules while switching sections and supports keyboard tabs', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        initial={{
          GroupSpecialUsableGroup: '{"vip":{"+:default":"Standard"}}',
        }}
      />
    )
    const pricing = screen.getByRole('tab', { name: 'Pricing groups' })
    pricing.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.queryByRole('table', { name: 'Pricing groups' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    await user.click(pricing)
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    const toggle = screen.getByRole('button', { name: 'Rules for vip' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('reorders and removes auto groups with named controls and saves across sections', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move vip up' }))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('vip')
    await user.click(
      screen.getByRole('switch', { name: 'Default to auto groups' })
    )
    await user.click(screen.getByRole('button', { name: 'Remove default' }))
    expect(screen.getByRole('button', { name: 'Move vip up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        AutoGroups: '[\n  "vip"\n]',
        DefaultUseAutoGroup: true,
      })
    )
  })

  it('reorders from the drag handle with arrow keys, preserves unknown groups and saves the new order', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{
          AutoGroups: '["default","vip","retired"]',
          MaxTokenAutoGroups: 1,
        }}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'default'
    )
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent(
      'default'
    )
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'default'
    )
    expect(screen.getByText('Not in pricing table')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].AutoGroups)).toEqual([
      'vip',
      'default',
      'retired',
    ])
  })

  it('keeps a single auto group unchanged when using its drag handle keyboard controls', async () => {
    const user = userEvent.setup()
    render(<Fixture initial={{ AutoGroups: '["default"]' }} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}')
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('listitem')).toHaveTextContent('default')
    expect(handle).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move default down' })
    ).toBeDisabled()
  })

  it('opens the auto section and focuses its invalid limit when saving from another section', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Maximum custom groups per token',
      }),
      { target: { value: '0' } }
    )
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Auto group order' })
      ).toHaveAttribute('aria-selected', 'true')
    )
    const input = screen.getByRole('spinbutton', {
      name: 'Maximum custom groups per token',
    })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByText('Enter a positive integer')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows empty state guidance and disables save during a pending request', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        isSaving
        initial={{
          GroupRatio: '{}',
          TopupGroupRatio: '{}',
          UserUsableGroups: '{}',
          AutoGroups: '[]',
        }}
      />
    )
    expect(
      screen.getByText('No groups yet. Add a group to get started.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Group display order' }))
    expect(
      screen.queryByRole('list', { name: 'Group display order' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restore default order' })
    ).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Special ratio rules' }))
    expect(
      screen.getByText('Base group ratios apply until you add an override.')
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    expect(screen.getByText('No auto groups configured')).toBeVisible()
  })

  it('preserves pricing edits when switching between visual and JSON editors', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.clear(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    )
    await user.type(
      screen.getAllByRole('textbox', { name: 'Group description' })[1],
      'Updated description'
    )
    await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
    await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
    expect(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    ).toHaveValue('Updated description')
  })
})

describe('saved group display order cache refresh', () => {
  it.each([
    ['group_setting.display_order', true, true],
    ['group_setting.display_order', false, false],
    ['ServerAddress', true, false],
  ])(
    'saving %s with success=%s refreshes group displays only when needed',
    async (key, success, refreshGroups) => {
      const put = vi.spyOn(api, 'put').mockResolvedValue({
        data: { success, message: success ? '' : 'Save rejected' },
      })
      const client = new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 60 * 1000, retry: false },
          mutations: { retry: false },
        },
      })
      const groupQueries = [
        ['groups'],
        ['user-groups'],
        ['playground-groups'],
        ['image-studio', 'groups'],
        ['pricing'],
      ]
      const preservedQueries = [
        ['token-auto-groups'],
        ['playground-models', 'default'],
      ]
      for (const queryKey of [...groupQueries, ...preservedQueries]) {
        client.setQueryData(queryKey, ['default', 'vip'])
      }
      const { result, unmount } = renderHook(() => useUpdateOption(), {
        wrapper: (props: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            {props.children}
          </QueryClientProvider>
        ),
      })

      try {
        await act(async () => {
          const save = result.current.mutateAsync({
            key,
            value: '["vip","default"]',
          })
          if (success) await save
          else await expect(save).rejects.toThrow('Save rejected')
        })
        expect(put).toHaveBeenCalledWith('/api/option/', {
          key,
          value: '["vip","default"]',
        })
        for (const queryKey of groupQueries) {
          // A user returning before the normal five-minute TTL must see the new order.
          const data = await client.fetchQuery({
            queryKey,
            queryFn: async () => ['vip', 'default'],
          })
          expect(data).toEqual(
            refreshGroups ? ['vip', 'default'] : ['default', 'vip']
          )
        }
        for (const queryKey of preservedQueries) {
          const data = await client.fetchQuery({
            queryKey,
            queryFn: async () => ['vip', 'default'],
          })
          expect(data).toEqual(['default', 'vip'])
        }
      } finally {
        unmount()
        client.clear()
        put.mockRestore()
      }
    }
  )
})
