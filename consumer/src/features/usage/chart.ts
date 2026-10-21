export interface UsagePoint {
  created_at: number
  quota: number
  count: number
  token_used: number
}
export interface DailyUsage {
  date: number
  quota: number
  count?: number
  token_used?: number
}

export interface UsageMetric {
  kind: 'tokens' | 'images'
  count?: number
}

export function usageDetails(other: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(other)
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {
    // Historical records can omit or contain malformed metadata.
  }
  return {}
}

/** Identify image logs from explicit server metadata without inferring from token fields. */
export function usageMetric(log: {
  prompt_tokens: number
  completion_tokens: number
  other: string
  content?: string
}): UsageMetric {
  const details = usageDetails(log.other)
  const requestPath = typeof details.request_path === 'string' ? details.request_path : ''
  const isImageRequest = /(?:^|\/)images\/(?:generations|edits)(?:\/|$)/.test(requestPath)
  // Fixed-price HTTP image requests store their settled count as a structured
  // log message; expression pricing also exposes image_count directly.
  const usage = details.usage_facts
  let imageCount =
    details.image_count ??
    (usage && typeof usage === 'object' && 'image_count' in usage ? usage.image_count : undefined)
  if (imageCount === undefined && Array.isArray(details.content_parts)) {
    const counts = details.content_parts.flatMap((part: unknown) => {
      if (
        !part ||
        typeof part !== 'object' ||
        !('key' in part) ||
        part.key !== 'Image count {{count}}' ||
        !('params' in part)
      )
        return []
      const params = part.params
      return params && typeof params === 'object' && 'count' in params ? [params.count] : []
    })
    if (counts.length) imageCount = new Set(counts).size === 1 ? counts[0] : null
  }
  if (imageCount === undefined && isImageRequest && log.content) {
    // Pre-structured logs use these exact gateway-authored comma-separated
    // fields. Never extract quantities from arbitrary messages or token counts.
    const counts = log.content.split(', ').flatMap((part) => {
      const match = /^(?:生成数量|Image count) ([1-9][0-9]*)$/.exec(part)
      return match ? [Number(match[1])] : []
    })
    if (new Set(counts).size === 1) imageCount = counts[0]
  }
  if (typeof imageCount === 'number' && Number.isSafeInteger(imageCount) && imageCount > 0) {
    return { kind: 'images', count: imageCount }
  }
  if (isImageRequest) {
    return { kind: 'images' }
  }
  return { kind: 'tokens', count: log.prompt_tokens + log.completion_tokens }
}

/** 按浏览器本地日历日汇总服务端小时数据，跨夏令时不假设一天固定为 24 小时。 */
export function dailyUsage(points: UsagePoint[], start: number, end: number): DailyUsage[] {
  const date = new Date(start * 1000)
  date.setHours(0, 0, 0, 0)
  const days: DailyUsage[] = []
  while (date.getTime() / 1000 <= end) {
    days.push({ date: date.getTime() / 1000, quota: 0 })
    date.setDate(date.getDate() + 1)
  }
  const byDate = new Map(days.map((day) => [day.date, day]))
  for (const point of points) {
    if (point.created_at < start || point.created_at > end) continue
    const day = new Date(point.created_at * 1000)
    day.setHours(0, 0, 0, 0)
    const bucket = byDate.get(day.getTime() / 1000)
    if (bucket) {
      bucket.quota += point.quota
      for (const key of ['count', 'token_used'] as const) {
        if (Number.isFinite(point[key])) bucket[key] = (bucket[key] || 0) + point[key]
      }
    }
  }
  return days
}

/** Throughput follows the recorded total duration, never time minus first response. */
export function usageTiming(log: {
  type?: number
  is_stream?: boolean
  use_time: number
  completion_tokens: number
  prompt_tokens: number
  other: string
}) {
  const details = usageDetails(log.other)
  const textStream =
    log.type === 2 &&
    log.is_stream === true &&
    details.is_task !== true &&
    usageMetric(log).kind === 'tokens'
  const duration = Number.isFinite(log.use_time) && log.use_time > 0 ? log.use_time : undefined
  const frt = details.frt
  return {
    duration,
    firstResponse:
      textStream &&
      typeof frt === 'number' &&
      Number.isFinite(frt) &&
      frt > 0 &&
      duration !== undefined &&
      frt <= duration * 1000
        ? frt / 1000
        : undefined,
    tokensPerSecond:
      textStream &&
      duration !== undefined &&
      Number.isFinite(log.completion_tokens) &&
      log.completion_tokens > 0
        ? log.completion_tokens / duration
        : undefined,
  }
}

/** Display recorded cache counts even when an historical input denominator is unavailable. */
export function usageCache(other: string, promptTokens?: number) {
  const details = usageDetails(other)
  const tokens = details.billing_tokens
  const values =
    tokens && typeof tokens === 'object' && !Array.isArray(tokens)
      ? (tokens as Record<string, unknown>)
      : {}
  const readValue =
    details.cache_tokens ??
    (typeof values.cr === 'number' && typeof values.img_cr === 'number'
      ? values.cr + values.img_cr
      : values.cr)
  const read = recordedTokenCount(readValue)
  const short = recordedTokenCount(details.cache_creation_tokens_5m)
  const long = recordedTokenCount(details.cache_creation_tokens_1h)
  const aggregate = recordedTokenCount(details.cache_creation_tokens)
  let write = recordedTokenCount(details.cache_write_tokens)
  if (
    write === undefined &&
    (short !== undefined || long !== undefined || aggregate !== undefined)
  ) {
    // TTL counts are parts of the aggregate, not additional tokens.
    write = recordedTokenCount(Math.max(aggregate ?? 0, (short ?? 0) + (long ?? 0)))
  }
  if (write === undefined && typeof values.cc === 'number') {
    write = recordedTokenCount(values.cc + (typeof values.cc1h === 'number' ? values.cc1h : 0))
  }
  let total = recordedTokenCount(values.len) ?? recordedTokenCount(details.input_tokens_total)
  const prompt = recordedTokenCount(promptTokens)
  if (total === undefined && prompt !== undefined) {
    const anthropic = details.usage_semantic === 'anthropic' || details.claude === true
    const legacyConverted = !details.usage_semantic && ((short ?? 0) > 0 || (long ?? 0) > 0)
    if (anthropic) {
      if (read !== undefined && write !== undefined)
        total = recordedTokenCount(prompt + read + write)
    } else if (!legacyConverted) total = prompt
  }
  if (read === undefined && write === undefined) return undefined
  // A known count remains useful even if historical metadata cannot support a percentage.
  if (total === 0 || (read !== undefined && total !== undefined && read > total)) total = undefined
  return {
    read,
    write,
    total,
    share: read !== undefined && total !== undefined ? (read / total) * 100 : undefined,
  }
}

function recordedTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
