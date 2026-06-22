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
import type { AspectKey, ImageSizeTier } from './types'

export const MAX_IMAGE_COUNT = 100
export const MAX_REFERENCE_IMAGES = 6
export const IMAGE_STUDIO_PLATFORM = 'image_studio'
export const IMAGE_TASK_POLL_INTERVAL = 3000
export const IMAGE_TASK_SSE_POLL_INTERVAL = 60000
export const IMAGE_TASK_SSE_REFRESH_DEBOUNCE = 300
export const LS_HIDDEN_RESULTS = 'image_studio.hidden_results'
export const LS_LAST_GROUP = 'image_studio.last_group'
export const LS_LAST_MODEL = 'image_studio.last_model'

export const PROMPT_PRESETS = [
  '电影感清晨薄雾森林特写，柔和金光，超写实',
  '极简主义产品大片：一台手机置于大理石台面，工作室灯光，写实质感',
  '赛博朋克霓虹城市，雨夜，湿漉反光的街道，银翼杀手氛围',
  '可爱 3D 等距小房间，马卡龙色系，blender 风格，octane 渲染',
]

export const ASPECT_OPTIONS: { label: string; value: string }[] = [
  { label: '1:1 方图', value: '1024x1024' },
  { label: '2:3 竖图', value: '1024x1536' },
  { label: '3:2 横图', value: '1536x1024' },
  { label: '9:16 手机竖屏', value: '1024x1792' },
  { label: '16:9 宽屏', value: '1792x1024' },
  { label: '自动', value: 'auto' },
]

export const ASPECT_KEYS: { key: AspectKey; label: string }[] = [
  { key: '1:1', label: '1:1' },
  { key: '3:2', label: '3:2' },
  { key: '2:3', label: '2:3' },
  { key: '16:9', label: '16:9' },
  { key: '9:16', label: '9:16' },
  { key: 'auto', label: '自动' },
]

export const TIER_KEYS: ImageSizeTier[] = ['1K', '2K', '4K']

export const TIER_ASPECT_TO_SIZE: Record<
  ImageSizeTier,
  Record<AspectKey, string>
> = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    auto: 'auto',
  },
  '2K': {
    '1:1': '1920x1920',
    '3:2': '2368x1576',
    '2:3': '1576x2368',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    auto: '1920x1920',
  },
  '4K': {
    '1:1': '2880x2880',
    '3:2': '3552x2368',
    '2:3': '2368x3552',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    auto: '2880x2880',
  },
}

export const SIZE_TO_TIER: Record<string, ImageSizeTier> = Object.entries(
  TIER_ASPECT_TO_SIZE
).reduce<Record<string, ImageSizeTier>>((acc, [tier, values]) => {
  Object.values(values).forEach((size) => {
    if (!acc[size]) acc[size] = tier as ImageSizeTier
  })
  return acc
}, {})

export const SIZE_TO_ASPECT: Record<string, AspectKey> = Object.entries(
  TIER_ASPECT_TO_SIZE
).reduce<Record<string, AspectKey>>(
  (acc, [, values]) => {
    Object.entries(values).forEach(([aspect, size]) => {
      if (!acc[size]) acc[size] = aspect as AspectKey
    })
    return acc
  },
  { auto: 'auto' }
)
