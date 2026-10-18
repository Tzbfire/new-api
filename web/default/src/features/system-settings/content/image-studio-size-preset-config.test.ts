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

import { validateImageStudioSizePresetJSON } from './image-studio-size-preset-config'

const validPreset = {
  id: 'gpt2-4k',
  group_pattern: '*',
  model_pattern: 'gpt-image-2*',
  aspect_ratio: '16:9',
  tier: '4k',
  tier_label: '4K',
  width: 3840,
  height: 2160,
  enabled: true,
  experimental: true,
}

describe('image studio size preset configuration', () => {
  test('accepts a safe configurable 4K preset', () => {
    assert.equal(
      validateImageStudioSizePresetJSON(JSON.stringify([validPreset])),
      true
    )
  })

  test('keeps legacy presets global and accepts group-specific variants', () => {
    const legacyPreset = Object.fromEntries(
      Object.entries(validPreset).filter(([key]) => key !== 'group_pattern')
    )
    assert.equal(
      validateImageStudioSizePresetJSON(JSON.stringify([legacyPreset])),
      true
    )
    assert.equal(
      validateImageStudioSizePresetJSON(
        JSON.stringify([
          validPreset,
          { ...validPreset, id: 'vip-4k', group_pattern: 'vip' },
        ])
      ),
      true
    )
  })

  test('rejects ambiguous combinations and unsafe pixel counts', () => {
    assert.equal(
      validateImageStudioSizePresetJSON(
        JSON.stringify([validPreset, { ...validPreset, id: 'duplicate' }])
      ),
      false
    )
    assert.equal(
      validateImageStudioSizePresetJSON(
        JSON.stringify([{ ...validPreset, width: 8192, height: 8192 }])
      ),
      false
    )
    assert.equal(
      validateImageStudioSizePresetJSON(
        JSON.stringify([{ ...validPreset, group_pattern: '*vip*group*' }])
      ),
      false
    )
  })
})
