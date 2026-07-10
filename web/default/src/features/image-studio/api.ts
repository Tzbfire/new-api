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
import { t } from 'i18next'

import { api } from '@/lib/api'

import type {
  ImageModelCatalogItem,
  ImageStudioEstimate,
  ImageStudioConfig,
  ImageStudioImage,
  ImageStudioSubmission,
  ImageStudioTask,
} from './types'

type ImageGenerationPayload = {
  group: string
  model: string
  prompt: string
  n: number
  size: string
  quality: string
}

type ImageEstimatePayload = ImageGenerationPayload & {
  mode: 'generation' | 'edit'
}

type ApiEnvelope<T> = {
  success: boolean
  message?: string
  data?: T
}

type TaskPage = {
  items?: ImageStudioTask[]
  total?: number
}

type TaskSubmissionPayload =
  | ImageStudioTask
  | { batch_id?: string; tasks?: ImageStudioTask[] }

type PricingModel = {
  model_name?: string
  enable_groups?: string[]
  supported_endpoint_types?: string[]
}

const requestConfig = {
  skipErrorHandler: true,
  skipBusinessError: true,
}

function assertSuccess(response: ApiEnvelope<unknown>): void {
  if (response.success === false) {
    throw new Error(response.message || 'Request failed')
  }
}

/**
 * Pricing can be disabled by the administrator. A null result means callers
 * should preserve the user's available-model list instead of blocking Studio.
 */
export async function fetchImageModelCatalog(): Promise<
  ImageModelCatalogItem[] | null
> {
  try {
    const res = await api.get<ApiEnvelope<PricingModel[]>>(
      '/api/pricing',
      requestConfig
    )
    const models = res.data?.data
    if (!res.data?.success || !Array.isArray(models)) return null

    return models
      .filter((model) =>
        model.supported_endpoint_types?.includes('image-generation')
      )
      .flatMap((model) => {
        const modelName = model.model_name?.trim()
        if (!modelName) return []
        return [
          {
            modelName,
            enableGroups: Array.isArray(model.enable_groups)
              ? model.enable_groups
              : [],
          },
        ]
      })
  } catch {
    return null
  }
}

export async function fetchImageStudioConfig(): Promise<ImageStudioConfig> {
  const res = await api.get<ApiEnvelope<ImageStudioConfig>>(
    '/pg/image-studio/config',
    requestConfig
  )
  assertSuccess(res.data)
  return {
    prompt_presets: res.data.data?.prompt_presets ?? [],
    size_presets: res.data.data?.size_presets ?? [],
    retention_days: res.data.data?.retention_days ?? 0,
  }
}

export async function submitGeneration(
  payload: ImageGenerationPayload
): Promise<ImageStudioSubmission> {
  const res = await api.post<ApiEnvelope<TaskSubmissionPayload>>(
    '/pg/image-studio/generations',
    payload,
    { ...requestConfig, timeout: 30_000 }
  )
  assertSuccess(res.data)
  return normalizeSubmission(res.data.data)
}

export async function estimateImageStudioCost(
  payload: ImageEstimatePayload,
  signal?: AbortSignal
): Promise<ImageStudioEstimate> {
  const { mode, ...request } = payload
  const res = await api.post<ApiEnvelope<ImageStudioEstimate>>(
    '/pg/image-studio/estimate',
    request,
    {
      ...requestConfig,
      params: { mode },
      signal,
      timeout: 15_000,
    }
  )
  assertSuccess(res.data)
  if (!res.data.data) throw new Error(t('Pricing estimate unavailable.'))
  return res.data.data
}

export async function submitEdit(
  formData: FormData
): Promise<ImageStudioSubmission> {
  const res = await api.post<ApiEnvelope<TaskSubmissionPayload>>(
    '/pg/image-studio/edits',
    formData,
    { ...requestConfig, timeout: 30_000 }
  )
  assertSuccess(res.data)
  return normalizeSubmission(res.data.data)
}

function normalizeSubmission(
  data: TaskSubmissionPayload | undefined
): ImageStudioSubmission {
  if (!data) {
    throw new Error(t('Image task was accepted without a task record.'))
  }
  if ('task_id' in data) return { tasks: [data] }
  const tasks = data?.tasks
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(t('Image task was accepted without a task record.'))
  }
  return { batchId: data.batch_id, tasks }
}

export async function fetchImageTasks(): Promise<ImageStudioTask[]> {
  const res = await api.get<ApiEnvelope<TaskPage>>('/api/task/self', {
    ...requestConfig,
    disableDuplicate: true,
    params: {
      p: 1,
      page_size: 30,
      platform: 'image_studio',
    },
  })
  assertSuccess(res.data)
  return Array.isArray(res.data?.data?.items) ? res.data.data.items : []
}

export async function deleteImageTasks(taskIds: string[]): Promise<void> {
  const res = await api.delete<ApiEnvelope<unknown>>('/api/task/image-studio', {
    ...requestConfig,
    data: { task_ids: taskIds },
  })
  assertSuccess(res.data)
}

export async function fetchImageBlob(image: ImageStudioImage): Promise<Blob> {
  if (!image.url) throw new Error(t('Image is no longer available.'))
  const imageURL = new URL(image.url, window.location.origin)
  if (imageURL.pathname.startsWith('/api/image-studio/assets/')) {
    const response = await fetch(imageURL, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      throw new Error(t('Image is no longer available.'))
    }
    return response.blob()
  }
  const response = await api.get<Blob>(image.url, {
    ...requestConfig,
    disableDuplicate: true,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadImageArchive(taskIDs: string[]): Promise<Blob> {
  const params = new URLSearchParams({ task_ids: taskIDs.join(',') })
  const res = await api.get<Blob>(
    `/api/task/image-studio/download?${params.toString()}`,
    {
      ...requestConfig,
      disableDuplicate: true,
      responseType: 'blob',
    }
  )
  return res.data
}
