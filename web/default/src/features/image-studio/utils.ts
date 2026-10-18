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
import type { GroupOption, ModelOption } from '@/features/playground/types'

import type {
  ImageModelCatalogItem,
  ImageStudioImage,
  ImageStudioTask,
  ImageStudioTaskRequest,
  NormalizedImageStudioTask,
} from './types'

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILURE'])

export function isTerminalTask(task: Pick<ImageStudioTask, 'status'>): boolean {
  return TERMINAL_STATUSES.has(task.status)
}

export function isActiveTask(task: Pick<ImageStudioTask, 'status'>): boolean {
  return !isTerminalTask(task)
}

export function isImageStudioEditMode(mode: string | undefined): boolean {
  return mode === 'edit' || mode === 'i2i'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseTaskData(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) ?? {}
    } catch {
      return {}
    }
  }
  return asRecord(value) ?? {}
}

function isImage(value: unknown): value is ImageStudioImage {
  const record = asRecord(value)
  return Boolean(
    record &&
    (typeof record.url === 'string' ||
      typeof record.b64_json === 'string' ||
      typeof record.asset_status === 'string')
  )
}

function extractImages(value: unknown): ImageStudioImage[] {
  const record = asRecord(value)
  if (!record) return []

  if (Array.isArray(record.data)) {
    const direct = record.data.filter(isImage)
    if (direct.length > 0) return direct
  }

  const nestedResponse = extractImages(record.response)
  if (nestedResponse.length > 0) return nestedResponse
  return extractImages(record.data)
}

export function normalizeTask(
  task: ImageStudioTask
): NormalizedImageStudioTask {
  const data = parseTaskData(task.data)
  return {
    ...task,
    request: (asRecord(data.request) ?? {}) as ImageStudioTaskRequest,
    images: extractImages(data.response ?? data),
  }
}

export function filterImageModels(
  models: ModelOption[],
  catalog: ImageModelCatalogItem[] | null,
  group: string
): ModelOption[] {
  if (catalog !== null) {
    const knownCatalogNames = new Set(catalog.map((item) => item.modelName))
    const catalogNames = new Set(
      catalog
        .filter((item) => imageCatalogItemSupportsGroup(item, group))
        .map((item) => item.modelName)
    )
    return models.filter(
      (model) =>
        catalogNames.has(model.value) ||
        (!knownCatalogNames.has(model.value) && isLikelyImageModel(model.value))
    )
  }

  const likelyImageModels = models.filter((model) =>
    isLikelyImageModel(model.value)
  )
  return likelyImageModels.length > 0 ? likelyImageModels : models
}

function isLikelyImageModel(model: string): boolean {
  return /(image|dall-e|imagen|flux)/i.test(model)
}

export function selectImageStudioGroup(
  groups: GroupOption[],
  catalog: ImageModelCatalogItem[] | null,
  preferredGroups: Array<string | undefined>
): string {
  const availableGroups = new Set(groups.map((group) => group.value))
  const supportsImages = (group: string) =>
    catalog === null ||
    catalog.some((item) => imageCatalogItemSupportsGroup(item, group))
  const candidates = [...preferredGroups, ...groups.map((group) => group.value)]
  return (
    candidates.find(
      (group): group is string =>
        typeof group === 'string' &&
        group !== '' &&
        availableGroups.has(group) &&
        supportsImages(group)
    ) ?? ''
  )
}

function imageCatalogItemSupportsGroup(
  item: ImageModelCatalogItem,
  group: string
): boolean {
  return item.enableGroups.includes('all') || item.enableGroups.includes(group)
}

export function imageSource(image: ImageStudioImage): string {
  if (image.url) return image.url
  if (image.b64_json) return `data:image/png;base64,${image.b64_json}`
  return ''
}

export function imageFileExtension(image: ImageStudioImage): string {
  if (image.mime_type === 'image/jpeg') return 'jpg'
  if (image.mime_type === 'image/webp') return 'webp'
  return 'png'
}

export function taskProgress(task: ImageStudioTask): number {
  const parsed = Number.parseInt(task.progress ?? '', 10)
  if (Number.isFinite(parsed)) return Math.min(100, Math.max(0, parsed))
  if (task.status === 'SUCCESS' || task.status === 'FAILURE') return 100
  return task.status === 'IN_PROGRESS' ? 10 : 0
}

export function formatTaskTime(timestamp: number): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

export function taskDurationSeconds(
  task: Pick<ImageStudioTask, 'start_time' | 'finish_time'>
): number | null {
  if (
    !Number.isFinite(task.start_time) ||
    !Number.isFinite(task.finish_time) ||
    task.start_time <= 0 ||
    task.finish_time < task.start_time
  ) {
    return null
  }
  return Math.max(1, Math.round(task.finish_time - task.start_time))
}

export function activeTaskElapsedSeconds(
  task: Pick<ImageStudioTask, 'status' | 'created_at' | 'start_time'>,
  nowSeconds: number
): number | null {
  if (!isActiveTask(task)) return null
  const startedAt = task.start_time > 0 ? task.start_time : task.created_at
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null
  return Math.max(0, Math.floor(nowSeconds - startedAt))
}

export function errorMessage(error: unknown): string {
  const record = asRecord(error)
  const response = asRecord(record?.response)
  const responseData = asRecord(response?.data)
  const nestedError = asRecord(responseData?.error)
  return String(
    nestedError?.message ||
      responseData?.message ||
      record?.message ||
      'Request failed'
  )
}

export function taskStatusKey(status: string): string {
  switch (status) {
    case 'SUCCESS':
      return 'Completed'
    case 'FAILURE':
      return 'Failed'
    case 'IN_PROGRESS':
      return 'Running'
    default:
      return 'Queued'
  }
}
