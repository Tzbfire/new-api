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
import JSZip from 'jszip'
import type { TFunction } from 'i18next'
import type {
  AspectKey,
  GroupOption,
  ImageStudioMode,
  ImageStudioResponseImage,
  ImageStudioResult,
  ImageStudioTask,
  ImageStudioTaskData,
  ImageStudioTaskRequest,
  ModelOption,
} from './types'

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isResponseImage(value: unknown): value is ImageStudioResponseImage {
  const record = toRecord(value)
  if (!record) return false
  return typeof record.url === 'string' || typeof record.b64_json === 'string'
}

function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^\w.-]+/g, '_').slice(0, 120) || 'image'
}

export function processModelsData(data: unknown[]): ModelOption[] {
  return data.map((item) => {
    if (typeof item === 'string') {
      return {
        label: item,
        value: item,
        supported_endpoint_types: [],
      }
    }

    const record = toRecord(item) || {}
    const value =
      stringValue(record.value) ||
      stringValue(record.model) ||
      stringValue(record.id) ||
      stringValue(record.label)

    return {
      label: stringValue(record.label) || value,
      value,
      supported_endpoint_types: isStringArray(record.supported_endpoint_types)
        ? record.supported_endpoint_types
        : [],
    }
  })
}

export function processGroupsData(
  data: Record<string, { desc?: unknown; ratio?: unknown }>,
  userGroup: string | undefined
): GroupOption[] {
  const groupOptions = Object.entries(data).map(([group, info]) => {
    const desc = typeof info.desc === 'string' ? info.desc : group
    const label = desc.length > 20 ? `${desc.slice(0, 20)}...` : desc
    const ratio =
      typeof info.ratio === 'number' || typeof info.ratio === 'string'
        ? info.ratio
        : 1

    return {
      label,
      value: group,
      ratio,
      fullLabel: desc,
      desc,
    }
  })

  if (groupOptions.length === 0) {
    return [
      {
        label: '用户分组',
        value: '',
        ratio: 1,
        fullLabel: '用户分组',
      },
    ]
  }

  if (!userGroup) return groupOptions

  const userGroupIndex = groupOptions.findIndex((g) => g.value === userGroup)
  if (userGroupIndex === -1) return groupOptions

  const reordered = [...groupOptions]
  const current = reordered.splice(userGroupIndex, 1)[0]
  if (current) reordered.unshift(current)
  return reordered
}

export function isImageGenModel(model: ModelOption | string): boolean {
  const rawValue = typeof model === 'string' ? model : model.value
  const value = rawValue.toLowerCase()
  return (
    value.startsWith('gpt-image') ||
    value.startsWith('dall-e') ||
    value.includes('image')
  )
}

export function pickPreferredModel(models: ModelOption[]): string {
  if (models.length === 0) return ''

  try {
    const lastModel = window.localStorage.getItem('image_studio.last_model')
    if (lastModel && models.some((model) => model.value === lastModel)) {
      return lastModel
    }
  } catch {
    /* empty */
  }

  const gptImage = models.find((model) => model.value === 'gpt-image-2')
  return gptImage?.value || models[0].value
}

export function imageStudioTaskEventURL(): string {
  const path = '/api/task/self/image-studio/events'
  const base = import.meta.env.VITE_REACT_APP_SERVER_URL as string | undefined
  if (!base) return path
  return `${base.replace(/\/+$/, '')}${path}`
}

export function isDownloadableResult(
  item: ImageStudioResult | null | undefined
): item is ImageStudioResult {
  return Boolean(
    item && item.src && item.status !== 'pending' && item.status !== 'failed'
  )
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

export function computeSizeRatio(model: string, size: string): number {
  if (!model.toLowerCase().startsWith('dall-e')) return 1
  if (size === '256x256') return 0.4
  if (size === '512x512') return 0.45
  if (size === '1024x1024') return 1
  if (size === '1024x1792' || size === '1792x1024') return 2
  return 1
}

export function getQuotaPerUnit(): number {
  try {
    const value = window.localStorage.getItem('quota_per_unit')
    const parsed = Number(value || 500000)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 500000
  } catch {
    return 500000
  }
}

export function extractImages(data: unknown): ImageStudioResponseImage[] {
  const record = toRecord(data)
  if (!record) return []

  if (Array.isArray(record.data)) return record.data.filter(isResponseImage)

  const response = toRecord(record.response)
  if (response && Array.isArray(response.data)) {
    return response.data.filter(isResponseImage)
  }

  const nestedData = toRecord(record.data)
  if (nestedData && Array.isArray(nestedData.data)) {
    return nestedData.data.filter(isResponseImage)
  }

  return []
}

function normalizeTaskMode(
  request: ImageStudioTaskRequest,
  action: string | undefined
): ImageStudioMode {
  if (request.mode === 'i2i' || request.mode === 't2i') return request.mode
  return action === 'imageEdit' ? 'i2i' : 't2i'
}

function normalizeTaskData(task: ImageStudioTask): ImageStudioTaskData {
  return task.data || {}
}

export function taskToItems(
  task: ImageStudioTask,
  t: TFunction
): ImageStudioResult[] {
  const taskData = normalizeTaskData(task)
  const request = taskData.request || {}
  const images = extractImages(taskData.response)
  const submitTime = numberValue(task.submit_time || task.created_at)
  const startTime = numberValue(task.start_time)
  const finishTime = numberValue(task.finish_time)
  const submitMs = submitTime * 1000
  const ts = submitMs > 0 ? submitMs : Date.now()
  const imageCount = Math.max(1, numberValue(request.n) || images.length || 1)
  const batchSize = Math.max(1, numberValue(request.batch_size) || imageCount)
  const batchIndex = numberValue(request.batch_index) || null
  const durationSeconds =
    finishTime > 0 && submitTime > 0
      ? Math.max(0, finishTime - submitTime)
      : null
  const taskId = task.task_id || `task-${ts}`
  const mode = normalizeTaskMode(request, task.action)
  const cost = typeof task.quota === 'number' && task.quota > 0 ? task.quota : null
  const base = {
    taskId: task.task_id,
    parentBatchId: stringValue(request.batch_id) || task.task_id,
    model:
      stringValue(request.model) ||
      task.properties?.origin_model_name ||
      task.properties?.upstream_model_name ||
      '',
    prompt: stringValue(request.prompt) || task.properties?.input || '',
    size: stringValue(request.size),
    mode,
    ts,
    submitTime,
    startTime,
    finishTime,
    durationSeconds,
    batchSize,
    costIsBatchTotal: imageCount > 1,
    cost,
  }

  if (task.status === 'SUCCESS' && images.length === 0) {
    return [
      {
        ...base,
        id: `${taskId}-1`,
        batchId: task.task_id,
        index: batchIndex || 1,
        status: 'failed',
        src: '',
        ext: 'png',
        error: t('No image returned. Please check model and quota.'),
      },
    ]
  }

  if (task.status === 'SUCCESS') {
    return images.map((image, index) => {
      let src = ''
      let ext = 'png'
      if (image.url) {
        src = image.url
        const match = image.url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i)
        if (match) ext = match[1].toLowerCase().replace('jpeg', 'jpg')
      } else if (image.b64_json) {
        src = `data:image/png;base64,${image.b64_json}`
      }

      return {
        ...base,
        id: `${taskId}-${index + 1}`,
        batchId: task.task_id,
        index: batchIndex || index + 1,
        status: src ? 'success' : 'failed',
        src,
        ext,
        error: src ? '' : t('No image returned. Please check model and quota.'),
      }
    })
  }

  return Array.from({ length: imageCount }, (_, index) => ({
    ...base,
    id: `${taskId}-${index + 1}`,
    batchId: task.task_id,
    index: batchIndex || index + 1,
    status: task.status === 'FAILURE' ? 'failed' : 'pending',
    src: '',
    ext: 'png',
    error: task.status === 'FAILURE' ? task.fail_reason || t('Generation failed') : '',
  }))
}

export function getTaskElapsedSeconds(
  item: ImageStudioResult,
  nowMs: number
): number | null {
  if (item.durationSeconds != null) return item.durationSeconds
  if (item.status !== 'pending' || !item.submitTime) return null
  return Math.max(0, Math.floor(nowMs / 1000) - item.submitTime)
}

export async function fetchRemoteAsBlob(url: string): Promise<Blob> {
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (response.ok) return await response.blob()
  } catch {
    /* fallback to canvas */
  }

  return await new Promise<Blob>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Canvas context unavailable'))
          return
        }
        context.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('toBlob returned empty'))
        }, 'image/png')
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Canvas export failed'))
      }
    })
    img.addEventListener('error', () => reject(new Error('Image loading failed')))
    img.src = url
  })
}

export async function imageResultToBlob(item: ImageStudioResult): Promise<Blob> {
  if (item.src.startsWith('data:')) {
    const response = await fetch(item.src)
    return await response.blob()
  }
  return await fetchRemoteAsBlob(item.src)
}

export function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export async function downloadOneResult(item: ImageStudioResult): Promise<void> {
  const filename = `${sanitizeFilename(item.model)}-${item.id}.${item.ext || 'png'}`
  if (item.src.startsWith('data:')) {
    triggerDownload(item.src, filename)
    return
  }

  const blob = await fetchRemoteAsBlob(item.src)
  const url = URL.createObjectURL(blob)
  try {
    triggerDownload(url, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export async function zipImageResults(
  results: ImageStudioResult[],
  t: TFunction
): Promise<{ okCount: number; failedCount: number; filename: string }> {
  const zip = new JSZip()
  const folderName = `image-studio-${new Date()
    .toISOString()
    .replaceAll(/[-:T]/g, '')
    .slice(0, 14)}`
  const folder = zip.folder(folderName) || zip
  const manifestLines: string[] = []
  let okCount = 0
  let failedCount = 0

  for (const [index, item] of results.entries()) {
    const ext = (item.ext || 'png').replace(/^\./, '')
    const fname = `${String(index + 1).padStart(2, '0')}-${sanitizeFilename(
      item.model || 'img'
    )}.${ext}`
    try {
      const blob = await imageResultToBlob(item)
      folder.file(fname, blob)
      manifestLines.push(
        `[${index + 1}] ${fname}\n  model: ${item.model}\n  size:  ${item.size}\n  prompt: ${item.prompt}\n`
      )
      okCount += 1
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'error'
      failedCount += 1
      manifestLines.push(
        `[${index + 1}] (FAILED: ${reason})\n  url: ${item.src}\n  model: ${item.model}\n  prompt: ${item.prompt}\n`
      )
    }
  }

  folder.file(
    'manifest.txt',
    `${t('AI Studio results')}\n${t('Generated at')}: ${new Date().toLocaleString()}\n${t(
      'Total {{total}}, succeeded {{ok}}, failed {{fail}}',
      { total: results.length, ok: okCount, fail: failedCount }
    )}\n\n${manifestLines.join('\n')}`
  )

  if (okCount === 0) {
    return { okCount, failedCount, filename: `${folderName}.zip` }
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE',
  })
  const url = URL.createObjectURL(zipBlob)
  try {
    triggerDownload(url, `${folderName}.zip`)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return { okCount, failedCount, filename: `${folderName}.zip` }
}

export function aspectFromSize(size: string): AspectKey {
  if (size === 'auto') return 'auto'
  if (size.includes('1792x1024') || size.includes('2560x1440')) return '16:9'
  if (size.includes('1024x1792') || size.includes('1440x2560')) return '9:16'
  if (size.includes('1536x1024') || size.includes('2368x1576')) return '3:2'
  if (size.includes('1024x1536') || size.includes('1576x2368')) return '2:3'
  return '1:1'
}
