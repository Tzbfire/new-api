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
export type ImageStudioTask = {
  id: number
  task_id: string
  platform: string
  group: string
  quota: number
  action: string
  status: string
  fail_reason?: string
  created_at: number
  submit_time: number
  start_time: number
  finish_time: number
  progress?: string
  properties?: Record<string, unknown>
  data?: unknown
}

export type ImageStudioTaskRequest = {
  group?: string
  model?: string
  prompt?: string
  size?: string
  quality?: string
  n?: number
  mode?: string
  batch_id?: string
  batch_index?: number
  batch_size?: number
}

export type ImageStudioImage = {
  url?: string
  download_url?: string
  b64_json?: string
  mime_type?: string
  size_bytes?: number
  sha256?: string
  asset_status?: 'pending' | 'ready' | 'discarding' | 'deleting' | 'expired'
}

export type ImageStudioFormValues = {
  group: string
  model: string
  prompt: string
  size: string
  quality: string
  count: number
}

export type NormalizedImageStudioTask = ImageStudioTask & {
  request: ImageStudioTaskRequest
  images: ImageStudioImage[]
}

export type ImageStudioSubmission = {
  batchId?: string
  tasks: ImageStudioTask[]
}

export type ImageStudioEstimate = {
  estimated_quota: number
  per_image_quota: number
  count: number
  resolved_group: string
}

export type ImageStudioPromptPreset = {
  id: string
  title: string
  prompt: string
  aspect_ratio?: string
  tier?: string
}

export type ImageStudioSizePreset = {
  id: string
  group_pattern: string
  model_pattern: string
  aspect_ratio: string
  tier: string
  tier_label: string
  width: number
  height: number
  enabled: boolean
  experimental: boolean
}

export type ImageStudioConfig = {
  prompt_presets: ImageStudioPromptPreset[]
  size_presets: ImageStudioSizePreset[]
  retention_days: number
}

export type ImageModelCatalogItem = {
  modelName: string
  enableGroups: string[]
}

export type ImageStudioDraft = {
  revision: number
  values: Partial<ImageStudioFormValues>
  files: File[]
}
