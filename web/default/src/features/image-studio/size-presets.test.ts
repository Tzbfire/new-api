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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  imageStudioSizeValue,
  recommendedSizePreset,
  sizePresetsForSelection,
} from './size-presets'
import type { ImageStudioSizePreset } from './types'

const presets: ImageStudioSizePreset[] = [
  {
    id: 'standard',
    group_pattern: '*',
    model_pattern: 'gpt-image*',
    aspect_ratio: '1:1',
    tier: 'standard',
    tier_label: 'Standard',
    width: 1024,
    height: 1024,
    enabled: true,
    experimental: false,
  },
  {
    id: '4k',
    group_pattern: '*',
    model_pattern: 'gpt-image-2*',
    aspect_ratio: '16:9',
    tier: '4k',
    tier_label: '4K',
    width: 3840,
    height: 2160,
    enabled: true,
    experimental: true,
  },
]

describe('image studio size presets', () => {
  test('combines general and model-specific presets in configured order', () => {
    assert.deepEqual(
      sizePresetsForSelection(presets, 'default', 'gpt-image-2'),
      presets
    )
    assert.deepEqual(
      sizePresetsForSelection(presets, 'default', 'gpt-image-1'),
      [presets[0]]
    )
    assert.equal(imageStudioSizeValue(presets[1]), '3840x2160')
  })

  test('uses a more specific model rule to override the same ratio and tier', () => {
    const override = {
      ...presets[0],
      id: 'specific-standard',
      model_pattern: 'gpt-image-2*',
      width: 1536,
      height: 1536,
    }
    assert.deepEqual(
      sizePresetsForSelection([...presets, override], 'default', 'gpt-image-2'),
      [override, presets[1]]
    )
  })

  test('uses a matching group rule before a global rule', () => {
    const groupOverride = {
      ...presets[0],
      id: 'vip-standard',
      group_pattern: 'vip',
      model_pattern: 'gpt-*',
      width: 2048,
      height: 2048,
    }
    const configured = [...presets, groupOverride]

    assert.deepEqual(
      sizePresetsForSelection(configured, 'vip', 'gpt-image-2'),
      [groupOverride, presets[1]]
    )
    assert.deepEqual(
      sizePresetsForSelection(configured, 'default', 'gpt-image-2'),
      presets
    )
  })

  test('matches group and model wildcard rules case-insensitively', () => {
    const wildcardPreset = {
      ...presets[0],
      id: 'vip-wildcard',
      group_pattern: 'vip*',
      model_pattern: '*image-2',
    }
    assert.deepEqual(
      sizePresetsForSelection([wildcardPreset], 'VIP-annual', 'vendor-image-2'),
      [wildcardPreset]
    )
    assert.deepEqual(
      sizePresetsForSelection([wildcardPreset], 'default', 'vendor-image-2'),
      []
    )
  })

  test('resolves a prompt preset recommendation to an exact size variant', () => {
    assert.equal(recommendedSizePreset(presets, '16:9', '4k'), presets[1])
    assert.equal(recommendedSizePreset(presets, '9:16', '4k'), undefined)
  })
})
