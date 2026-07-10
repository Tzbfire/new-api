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
import type { ImageStudioSizePreset } from '@/features/image-studio/types'

export const MAX_SIZE_PRESETS = 64
export const MAX_SIZE_EDGE = 8192
const MAX_SIZE_PIXELS = 32 * 1024 * 1024

export function parseImageStudioSizePresetJSON(
  value: string
): ImageStudioSizePreset[] {
  try {
    return parseImageStudioSizePresets(JSON.parse(value || '[]'))
  } catch {
    return []
  }
}

function parseImageStudioSizePresets(value: unknown): ImageStudioSizePreset[] {
  if (!Array.isArray(value)) return []
  const presets: ImageStudioSizePreset[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const preset = item as Partial<ImageStudioSizePreset>
    if (
      typeof preset.id !== 'string' ||
      typeof preset.model_pattern !== 'string' ||
      typeof preset.aspect_ratio !== 'string' ||
      typeof preset.tier !== 'string' ||
      typeof preset.tier_label !== 'string' ||
      typeof preset.width !== 'number' ||
      typeof preset.height !== 'number' ||
      typeof preset.enabled !== 'boolean' ||
      typeof preset.experimental !== 'boolean'
    ) {
      continue
    }
    presets.push({
      id: preset.id,
      group_pattern:
        typeof preset.group_pattern === 'string' ? preset.group_pattern : '*',
      model_pattern: preset.model_pattern,
      aspect_ratio: preset.aspect_ratio,
      tier: preset.tier,
      tier_label: preset.tier_label,
      width: preset.width,
      height: preset.height,
      enabled: preset.enabled,
      experimental: preset.experimental,
    })
  }
  return presets
}

export function validateImageStudioSizePresetJSON(value: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(value || '[]')
  } catch {
    return false
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_SIZE_PRESETS) return false
  const presets = parseImageStudioSizePresets(parsed)
  if (presets.length !== parsed.length) return false
  const ids = new Set<string>()
  const combinations = new Set<string>()
  for (const preset of presets) {
    const pixelCount = preset.width * preset.height
    const combination = `${preset.group_pattern.trim().toLowerCase()}\u0000${preset.model_pattern.trim().toLowerCase()}\u0000${preset.aspect_ratio.trim()}\u0000${preset.tier.trim()}`
    if (
      preset.id.trim() === '' ||
      preset.id.length > 64 ||
      ids.has(preset.id.trim()) ||
      combinations.has(combination) ||
      preset.group_pattern.trim() === '' ||
      preset.group_pattern.length > 128 ||
      (preset.group_pattern.match(/\*/g)?.length ?? 0) > 1 ||
      preset.model_pattern.trim() === '' ||
      preset.model_pattern.length > 128 ||
      (preset.model_pattern.match(/\*/g)?.length ?? 0) > 1 ||
      preset.aspect_ratio.trim() === '' ||
      preset.aspect_ratio.length > 32 ||
      preset.tier.trim() === '' ||
      preset.tier.length > 32 ||
      preset.tier_label.trim() === '' ||
      preset.tier_label.length > 32 ||
      !Number.isInteger(preset.width) ||
      !Number.isInteger(preset.height) ||
      preset.width < 64 ||
      preset.height < 64 ||
      preset.width > MAX_SIZE_EDGE ||
      preset.height > MAX_SIZE_EDGE ||
      pixelCount > MAX_SIZE_PIXELS
    ) {
      return false
    }
    ids.add(preset.id.trim())
    combinations.add(combination)
  }
  return true
}
