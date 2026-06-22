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
import type { AuthUser } from '@/stores/auth-store'

export type ImageStudioMode = 't2i' | 'i2i'
export type ImageStudioTaskStatus = 'pending' | 'success' | 'failed'
export type ImageSizeTier = '1K' | '2K' | '4K'
export type AspectKey = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | 'auto'

export type GroupOption = {
  label: string
  value: string
  ratio?: number | string
  fullLabel?: string
  desc?: string
}

export type ModelOption = {
  label: string
  value: string
  supported_endpoint_types?: string[]
}

export type ImageSizePrices = Partial<Record<ImageSizeTier, number>>

export type PricingEntry = {
  model_name: string
  quota_type?: number
  model_price?: number
  model_ratio?: number
  image_ratio?: number
  size_prices?: ImageSizePrices | null
  [key: string]: unknown
}

export type ImageStudioTaskRequest = {
  group?: string
  model?: string
  prompt?: string
  n?: number | string
  size?: string
  mode?: ImageStudioMode | string
  batch_size?: number | string
  batch_index?: number | string
  batch_id?: string
  [key: string]: unknown
}

export type ImageStudioResponseImage = {
  url?: string
  b64_json?: string
  revised_prompt?: string
  [key: string]: unknown
}

export type ImageStudioTaskData = {
  request?: ImageStudioTaskRequest
  response?: unknown
  [key: string]: unknown
}

export type ImageStudioTask = {
  task_id?: string
  data?: ImageStudioTaskData | null
  status?: string
  submit_time?: number
  created_at?: number
  start_time?: number
  finish_time?: number
  action?: string
  quota?: number
  fail_reason?: string
  properties?: {
    origin_model_name?: string
    upstream_model_name?: string
    input?: string
    [key: string]: unknown
  }
}

export type ImageStudioResult = {
  id: string
  taskId?: string
  parentBatchId?: string
  batchId?: string
  index: number
  status: ImageStudioTaskStatus
  src: string
  ext: string
  model: string
  prompt: string
  size: string
  mode: ImageStudioMode
  ts: number
  submitTime: number
  startTime: number
  finishTime: number
  durationSeconds: number | null
  batchSize: number
  costIsBatchTotal: boolean
  cost: number | null
  error: string
}

export type ApiEnvelope<T> = {
  success?: boolean
  message?: string
  data?: T
  group_ratio?: Record<string, number | string>
}

export type ImageStudioPricing = {
  pricingMap: Record<string, PricingEntry>
  groupRatioMap: Record<string, number | string>
}

export type SubmitGenerationPayload = {
  group: string
  model: string
  prompt: string
  n: number
  size: string
}

export type SubmitEditPayload = SubmitGenerationPayload & {
  files: File[]
}

export type RefreshUserResult = AuthUser | null
