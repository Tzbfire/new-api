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
import type { ImageStudioSizePreset } from './types'

function imageStudioPatternMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase()
  const normalizedValue = value.trim().toLowerCase()
  if (normalizedPattern === '*') return normalizedValue !== ''
  const wildcard = normalizedPattern.indexOf('*')
  if (wildcard < 0) return normalizedPattern === normalizedValue
  return (
    normalizedValue.startsWith(normalizedPattern.slice(0, wildcard)) &&
    normalizedValue.endsWith(normalizedPattern.slice(wildcard + 1))
  )
}

export function imageStudioSizeValue(
  preset: Pick<ImageStudioSizePreset, 'width' | 'height'>
): string {
  return `${preset.width}x${preset.height}`
}

export function sizePresetsForSelection(
  presets: ImageStudioSizePreset[],
  groupName: string,
  modelName: string
): ImageStudioSizePreset[] {
  const matches = presets.filter(
    (preset) =>
      preset.enabled &&
      imageStudioPatternMatches(preset.group_pattern, groupName) &&
      imageStudioPatternMatches(preset.model_pattern, modelName)
  )
  const result: ImageStudioSizePreset[] = []
  const slots = new Map<
    string,
    { index: number; groupSpecificity: number; modelSpecificity: number }
  >()
  for (const preset of matches) {
    const key = `${preset.aspect_ratio}\u0000${preset.tier}`
    const groupSpecificity = preset.group_pattern.replace('*', '').length
    const modelSpecificity = preset.model_pattern.replace('*', '').length
    const current = slots.get(key)
    if (!current) {
      slots.set(key, {
        index: result.length,
        groupSpecificity,
        modelSpecificity,
      })
      result.push(preset)
      continue
    }
    if (
      groupSpecificity > current.groupSpecificity ||
      (groupSpecificity === current.groupSpecificity &&
        modelSpecificity > current.modelSpecificity)
    ) {
      result[current.index] = preset
      slots.set(key, {
        index: current.index,
        groupSpecificity,
        modelSpecificity,
      })
    }
  }
  return result
}

export function uniquePresetValues(
  presets: ImageStudioSizePreset[],
  field: 'aspect_ratio' | 'tier'
): string[] {
  return [...new Set(presets.map((preset) => preset[field]))]
}

export function recommendedSizePreset(
  presets: ImageStudioSizePreset[],
  aspectRatio?: string,
  tier?: string
): ImageStudioSizePreset | undefined {
  if (!aspectRatio || !tier) return undefined
  return presets.find(
    (preset) => preset.aspect_ratio === aspectRatio && preset.tier === tier
  )
}
