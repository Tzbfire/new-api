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
import { expect, test } from 'vitest'

import { subscriptionPlanSchema } from '../../types'
import { formValuesToPlanPayload, planToFormValues } from '../plan-form'

test.each([true, false])(
  'preserves group scope and wallet fallback when editing a plan: %s',
  (allowWalletOverflow) => {
    const plan = subscriptionPlanSchema.parse({
      id: 1,
      title: 'Image package',
      price_amount: 12,
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'monthly',
      enabled: true,
      sort_order: 0,
      max_purchase_per_user: 1,
      total_amount: 1000000,
      allowed_token_groups: 'images,auto',
      allow_wallet_overflow: allowWalletOverflow,
    })
    const values = planToFormValues(plan)
    expect(values.allowed_token_groups).toEqual(['images', 'auto'])
    const payload = formValuesToPlanPayload(values)
    expect(payload.plan.allowed_token_groups).toBe('images,auto')
    expect(payload.plan.allow_wallet_overflow).toBe(allowWalletOverflow)
    expect(payload.plan.disable_wallet_fallback).toBe(!allowWalletOverflow)
    expect(payload.plan.total_amount).toBe(1000000)
  }
)
