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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { getUserGroups } from '../api'
import { getGroupFallback } from '../lib/options/playground-option-utils'

afterEach(() => vi.restoreAllMocks())

describe('shared chat and image studio group options', () => {
  test('uses server display ranks for numeric names and preserves the saved selected group', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          '2': { desc: 'Standard', ratio: 1, display_order: 2 },
          '10': { desc: 'Preferred', ratio: 1, display_order: 0 },
          premium: { desc: 'Priority', ratio: 2, display_order: 1 },
        },
      },
    })

    const groups = await getUserGroups()
    expect(groups.map((group) => group.value)).toEqual(['10', 'premium', '2'])
    expect(groups[0]).toMatchObject({ desc: 'Preferred', ratio: 1 })
    expect(getGroupFallback(groups, '2')).toBeNull()
    expect(getGroupFallback(groups, 'retired')).toBe('10')
  })

  test('keeps old-server group order and descriptions when ranks are absent', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          premium: { desc: 'Priority', ratio: 2 },
          default: { desc: 'Standard', ratio: 1 },
        },
      },
    })

    expect(await getUserGroups()).toEqual([
      { label: 'premium', value: 'premium', desc: 'Priority', ratio: 2 },
      { label: 'default', value: 'default', desc: 'Standard', ratio: 1 },
    ])
  })

  test('keeps an empty authorized group list empty', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: {} },
    })
    expect(await getUserGroups()).toEqual([])
  })
})
