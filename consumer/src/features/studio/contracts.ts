export type StudioConfig = {
  prompt_presets: {
    id: string
    title: string
    prompt: string
    aspect_ratio?: string
    tier?: string
  }[]
  size_presets: {
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
  }[]
  retention_days: number
  interactive_batch_limit: number
  max_batch_size: number
  download_all_enabled: boolean
}
export type StudioRequest = {
  group: string
  model: string
  prompt: string
  count: number
  size: string
  quality: string
}
export type StudioEstimate = {
  estimated_quota: number
  per_image_quota: number
  count: number
  resolved_group: string
}
export type StudioTask = {
  id: number
  task_id: string
  group: string
  quota: number
  status: string
  fail_reason?: string
  created_at: number
  submit_time?: number
  start_time?: number
  finish_time?: number
  progress?: string
  data?: unknown
}
export type StudioSubmission = { batch_id: string; tasks: StudioTask[]; total_count: number }
export type StudioSummary = {
  deleted_count?: number
  total_count: number
  queued_count: number
  active_count: number
  success_count: number
  failure_count: number
  finished_count: number
}
export type StudioBatch = StudioSummary & {
  batch_id: string
  mode: string
  group: string
  model: string
  prompt: string
  size: string
  quality: string
  deleted_count: number
  progress: number
  status: string
  created_at: number
}
export type StudioTaskPage = {
  items: StudioTask[]
  total: number
  page: number
  page_size: number
  summary?: StudioSummary
}
export type StudioBatchPage = {
  items: StudioBatch[]
  total: number
  page: number
  page_size: number
}
export type StudioFilter = 'all' | 'active' | 'completed' | 'failed'
export type StudioImage = {
  url?: string
  download_url?: string
  asset_status?: string
  mime_type?: string
}
export type StudioTaskRequest = Partial<StudioRequest> & {
  request_id?: string
  mode?: string
  batch_id?: string
  batch_index?: number
  batch_size?: number
}

/** Normalize only public task payloads; signed image URLs are refreshed by listing. */
export function studioTaskContent(task: StudioTask): {
  request: StudioTaskRequest
  images: StudioImage[]
} {
  let data = task.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown
    } catch {
      data = null
    }
  }
  if (!data || typeof data !== 'object') return { request: {}, images: [] }
  const payload = data as Record<string, unknown>
  const images: StudioImage[] = []
  const pending: unknown[] = [payload.response]
  for (let index = 0; index < pending.length && index < 200; index++) {
    const value = pending[index]
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, 100))
      continue
    }
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (typeof item.url === 'string' || typeof item.asset_status === 'string') {
      images.push({
        url: safeImageURL(item.url),
        download_url: safeImageURL(item.download_url),
        asset_status: typeof item.asset_status === 'string' ? item.asset_status : undefined,
        mime_type: typeof item.mime_type === 'string' ? item.mime_type : undefined,
      })
    } else pending.push(...Object.values(item))
  }
  return {
    request:
      payload.request && typeof payload.request === 'object'
        ? (payload.request as StudioTaskRequest)
        : {},
    images,
  }
}

/** Accept server-signed relative assets or HTTPS asset hosts, never script/data URLs. */
export function safeImageURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.startsWith('/api/image-studio/') && !value.includes('\\')) return value
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href
    if (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    )
      return parsed.href
  } catch {
    /* A malformed provider URL must not become a clickable link. */
  }
  return undefined
}

export function isRunning(task: StudioTask): boolean {
  return !['SUCCESS', 'FAILURE'].includes(task.status)
}

/** Keep selected task IDs scoped to the visible results; changing filters drops old selections. */
export function selectedVisibleTasks(
  tasks: StudioTask[],
  selected: ReadonlySet<string>,
): StudioTask[] {
  return tasks.filter((task) => selected.has(task.task_id) && !isRunning(task))
}

export function matchingSizePresets(
  config: StudioConfig | undefined,
  group: string,
  model: string,
): StudioConfig['size_presets'] {
  const slots = new Map<string, StudioConfig['size_presets'][number]>()
  for (const preset of config?.size_presets || []) {
    if (!preset.enabled) continue
    const pairs = [
      [preset.group_pattern, group],
      [preset.model_pattern, model],
    ]
    if (
      !pairs.every(([pattern = '', value = '']) => {
        const wildcard = pattern.indexOf('*')
        if (wildcard < 0) return pattern.toLowerCase() === value.toLowerCase()
        return (
          value.toLowerCase().startsWith(pattern.slice(0, wildcard).toLowerCase()) &&
          value.toLowerCase().endsWith(pattern.slice(wildcard + 1).toLowerCase())
        )
      })
    )
      continue
    const key = `${preset.aspect_ratio}:${preset.tier}`
    const current = slots.get(key)
    const score =
      preset.group_pattern.replace('*', '').length * 1000 +
      preset.model_pattern.replace('*', '').length
    const currentScore = current
      ? current.group_pattern.replace('*', '').length * 1000 +
        current.model_pattern.replace('*', '').length
      : -1
    if (score > currentScore) slots.set(key, preset)
  }
  return [...slots.values()]
}

/** Validate the product count independently of the provider's n parameter. */
export function validateStudioRequest(payload: StudioRequest, maxCount: number): void {
  if (!payload.group || !payload.model || !payload.prompt.trim())
    throw new Error('Choose a service group, model, and describe your image.')
  if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > maxCount)
    throw new Error('Choose a valid number of images.')
  if (payload.prompt.length > 16_000) throw new Error('Your description is too long.')
}
