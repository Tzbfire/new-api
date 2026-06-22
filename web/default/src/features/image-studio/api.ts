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
import { api } from '@/lib/api'
import { MAX_IMAGE_COUNT, IMAGE_STUDIO_PLATFORM } from './constants'
import { processGroupsData, processModelsData, isImageGenModel } from './utils'
import type {
  ApiEnvelope,
  GroupOption,
  ImageStudioPricing,
  ImageStudioTask,
  ModelOption,
  PricingEntry,
  RefreshUserResult,
  SubmitEditPayload,
  SubmitGenerationPayload,
} from './types'

type RawGroupInfo = { desc?: string; ratio?: number | string }

type ApiConfig = {
  skipBusinessError?: boolean
  skipErrorHandler?: boolean
  disableDuplicate?: boolean
  timeout?: number
  headers?: Record<string, string>
  params?: Record<string, string | number>
}

function assertApiSuccess<T>(body: ApiEnvelope<T>, fallback: string): void {
  if (body.success === false) {
    throw new Error(body.message || fallback)
  }
}

export async function getImageStudioGroups(
  userGroup: string | undefined
): Promise<GroupOption[]> {
  const res = await api.get('/api/user/self/groups')
  const body = res.data as ApiEnvelope<Record<string, RawGroupInfo>>
  if (!body.success || !body.data) return []
  return processGroupsData(body.data, userGroup)
}

export async function getImageStudioModels(
  group: string
): Promise<ModelOption[]> {
  const res = await api.get('/api/user/models', {
    params: group ? { group } : undefined,
  })
  const body = res.data as ApiEnvelope<unknown[]>
  if (!body.success || !Array.isArray(body.data)) return []
  return processModelsData(body.data).filter(isImageGenModel)
}

export async function getImageStudioPricing(): Promise<ImageStudioPricing> {
  const res = await api.get('/api/pricing')
  const body = res.data as ApiEnvelope<PricingEntry[]>
  const pricingMap: Record<string, PricingEntry> = {}
  if (body.success && Array.isArray(body.data)) {
    body.data.forEach((entry) => {
      if (entry.model_name) pricingMap[entry.model_name] = entry
    })
  }
  return {
    pricingMap,
    groupRatioMap: body.group_ratio || {},
  }
}

export async function getImageStudioTasks(): Promise<ImageStudioTask[]> {
  const res = await api.get('/api/task/self', {
    disableDuplicate: true,
    params: {
      p: 1,
      page_size: MAX_IMAGE_COUNT,
      platform: IMAGE_STUDIO_PLATFORM,
    },
  } as ApiConfig)
  const body = res.data as ApiEnvelope<{ items?: ImageStudioTask[] }>
  if (!body.success || !body.data?.items) return []
  return body.data.items
}

export async function deleteImageStudioTasks(taskIds: string[]): Promise<void> {
  const cleanTaskIds = [...new Set(taskIds.filter(Boolean))]
  if (cleanTaskIds.length === 0) return
  const res = await api.delete('/api/task/self/image-studio', {
    data: { task_ids: cleanTaskIds },
    skipBusinessError: true,
  } as ApiConfig)
  assertApiSuccess(res.data as ApiEnvelope<unknown>, '删除失败')
}

export async function submitImageGeneration(
  payload: SubmitGenerationPayload
): Promise<void> {
  const res = await api.post('/pg/image-studio/generations', payload, {
    timeout: 30000,
    skipBusinessError: true,
    skipErrorHandler: true,
  } as ApiConfig)
  assertApiSuccess(res.data as ApiEnvelope<unknown>, '提交失败')
}

export async function submitImageEdit(payload: SubmitEditPayload): Promise<void> {
  const form = new FormData()
  form.append('group', payload.group)
  form.append('model', payload.model)
  form.append('prompt', payload.prompt)
  form.append('n', String(payload.n))
  form.append('size', payload.size)
  payload.files.forEach((file) => {
    form.append(payload.files.length > 1 ? 'image[]' : 'image', file, file.name)
  })

  const res = await api.post('/pg/image-studio/edits', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
    skipBusinessError: true,
    skipErrorHandler: true,
  } as ApiConfig)
  assertApiSuccess(res.data as ApiEnvelope<unknown>, '提交失败')
}

export async function refreshImageStudioUser(): Promise<RefreshUserResult> {
  const res = await api.get('/api/user/self', {
    skipErrorHandler: true,
  })
  const body = res.data as ApiEnvelope<RefreshUserResult>
  if (body.success && body.data) return body.data
  return null
}
