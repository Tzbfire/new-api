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

import { getPricing } from '../api'
import { SORT_OPTIONS } from '../constants'
import { sortModels } from '../lib/filters'
import { getAvailableGroups } from '../lib/model-helpers'
import type { PricingModel } from '../types'

function pricingModel(
  modelName: string,
  overrides: Partial<PricingModel>
): PricingModel {
  return {
    id: 1,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

const models = [
  pricingModel('legacy-ratio', { model_ratio: 1, completion_ratio: 4 }),
  pricingModel('legacy-per-call', { quota_type: 1, model_price: 0.05 }),
  pricingModel('expr-tokens', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 1 + c * 10)',
  }),
  pricingModel('expr-long-context', {
    billing_mode: 'tiered_expr',
    billing_expr:
      'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", p * 6 + c * 22.5)',
  }),
  pricingModel('expr-input-only', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 0.1)',
  }),
  pricingModel('expr-fixed', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("request", fixed(0.02))',
  }),
  pricingModel('expr-task', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", u("seconds") * 0.1)',
    billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
    billing_usage_examples: [{ label: '5s', facts: { seconds: 5 } }],
  }),
]

describe('price sorting', () => {
  test.each([
    [
      SORT_OPTIONS.INPUT_PRICE_LOW,
      [
        'expr-input-only',
        'expr-tokens',
        'legacy-ratio',
        'expr-long-context',
        'legacy-per-call',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.INPUT_PRICE_HIGH,
      [
        'expr-long-context',
        'legacy-ratio',
        'expr-tokens',
        'expr-input-only',
        'legacy-per-call',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.OUTPUT_PRICE_LOW,
      [
        'legacy-ratio',
        'expr-tokens',
        'expr-long-context',
        'legacy-per-call',
        'expr-input-only',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.REQUEST_PRICE_HIGH,
      [
        'expr-task',
        'legacy-per-call',
        'expr-fixed',
        'legacy-ratio',
        'expr-tokens',
        'expr-long-context',
        'expr-input-only',
      ],
    ],
  ])(
    '%s compares base prices across legacy and expression billing and keeps unpriced models last',
    (sortBy, expected) => {
      expect(sortModels(models, sortBy).map((m) => m.model_name)).toEqual(
        expected
      )
    }
  )
})

afterEach(() => vi.restoreAllMocks())

test('pricing group order survives numeric object keys and excludes groups unavailable to the model', async () => {
  const autoGroups = ['2', '10']
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      group_order: ['10', 'premium', '2'],
      usable_group: {
        '2': { desc: '', ratio: 1 },
        '10': { desc: '', ratio: 1 },
        premium: { desc: '', ratio: 2 },
      },
      auto_groups: autoGroups,
    },
  })

  const data = await getPricing()
  const model = pricingModel('text-model', { enable_groups: ['2', '10'] })
  expect(getAvailableGroups(model, data.usable_group)).toEqual(['10', '2'])
  expect(data.auto_groups).toEqual(autoGroups)
})

test('pricing without display order retains the older server group order', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      usable_group: {
        premium: { desc: '', ratio: 2 },
        default: { desc: '', ratio: 1 },
      },
    },
  })
  const data = await getPricing()
  expect(
    getAvailableGroups(
      pricingModel('text-model', { enable_groups: ['default', 'premium'] }),
      data.usable_group
    )
  ).toEqual(['premium', 'default'])
})

test('normalizes real API group descriptions without losing zero ratios or configured order', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      group_order: ['premium', '10', '2'],
      group_ratio: { premium: 2, '10': 0, '2': 1 },
      usable_group: {
        '2': 'Standard access',
        '10': 'Complimentary access',
        premium: 'Priority access',
      },
    },
  })

  const data = await getPricing()
  expect(data.usable_group['10']).toMatchObject({
    desc: 'Complimentary access',
    ratio: 0,
  })
  expect(data.usable_group.premium).toMatchObject({
    desc: 'Priority access',
    ratio: 2,
  })
  expect(
    getAvailableGroups(
      pricingModel('text-model', { enable_groups: ['10', '2', 'premium'] }),
      data.usable_group
    )
  ).toEqual(['premium', '10', '2'])
})
