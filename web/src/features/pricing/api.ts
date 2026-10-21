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
import { api } from '@/lib/api'
import { orderedGroupEntries } from '@/lib/group-order'

import type { PricingData } from './types'

// ----------------------------------------------------------------------------
// Pricing APIs
// ----------------------------------------------------------------------------

// Get model pricing data
export async function getPricing(): Promise<PricingData> {
  const res = await api.get('/api/pricing')
  const data: Omit<PricingData, 'usable_group'> & {
    usable_group: Record<string, string | PricingData['usable_group'][string]>
  } = res.data
  const usableGroups = Object.fromEntries(
    Object.entries(data.usable_group ?? {}).map(([group, info]) => [
      group,
      typeof info === 'string'
        ? { desc: info, ratio: data.group_ratio?.[group] ?? 1 }
        : info,
    ])
  )
  return {
    ...data,
    usable_group: Object.fromEntries(
      orderedGroupEntries(usableGroups, data.group_order).map(
        ([group, info], displayOrder) => [
          group,
          { ...info, display_order: displayOrder },
        ]
      )
    ),
  }
}
