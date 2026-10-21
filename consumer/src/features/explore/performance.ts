import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/api'
import { useSession } from '@/lib/session'
import { formatDurationMilliseconds, formatNumber } from '@/lib/format'

export interface PerformanceSample {
  success_rate?: number
  avg_tps?: number
  avg_ttft_ms?: number
  avg_latency_ms?: number
  request_count?: number
  success_count?: number
  ttft_sample_count?: number
  tps_observed?: boolean
}
export interface PerformancePoint extends PerformanceSample {
  ts: number
}
export interface PerformanceGroup extends PerformanceSample {
  group: string
  series: PerformancePoint[]
}
export interface ModelMetrics {
  model_name: string
  window_start: number
  window_end: number
  groups: PerformanceGroup[]
}
export const performanceMetrics = [
  { key: 'success_rate', label: 'Request success rate', unit: '%' },
  { key: 'avg_tps', label: 'Token speed (TPS)', unit: 'token/s' },
  { key: 'avg_ttft_ms', label: 'First response (TTFT)', unit: 'ms' },
  { key: 'avg_latency_ms', label: 'Total latency', unit: 'ms' },
] as const
export type PerformanceMetric = (typeof performanceMetrics)[number]['key']

/** Use one duration policy for summaries, group comparisons, trend axes and sample details. */
export function formatPerformanceValue(
  value: number | null,
  key: PerformanceMetric,
  locale: string,
): string {
  if (value === null) return '—'
  if (key === 'avg_ttft_ms' || key === 'avg_latency_ms')
    return formatDurationMilliseconds(value, locale)
  return `${formatNumber(Math.round(value * 100) / 100, locale)} ${key === 'success_rate' ? '%' : 'token/s'}`
}

/** The API returns hourly buckets. Missing hours or unmeasured values break a trend. */
export function performanceSegments(
  points: PerformancePoint[],
  key: PerformanceMetric,
): PerformancePoint[][] {
  const segments: PerformancePoint[][] = []
  let segment: PerformancePoint[] = []
  for (const point of points
    .filter((point) => Number.isFinite(point.ts))
    .sort((a, b) => a.ts - b.ts)) {
    if (performanceValue(point, key) === null) {
      segment = []
      continue
    }
    const previous = segment.at(-1)
    if (!previous || point.ts - previous.ts > 3600 || point.ts <= previous.ts) {
      segment = []
      segments.push(segment)
    }
    segment.push(point)
  }
  return segments
}

/** Read the same model window once; never replace group data with model-wide averages. */
export function useModelMetrics(model: string, enabled = true) {
  const session = useSession()
  return useQuery({
    queryKey: ['consumer-model-health', session.user?.id || 'public', session.sessionId, model],
    queryFn: ({ signal }) =>
      request<ModelMetrics>(`/api/perf-metrics?model=${encodeURIComponent(model)}&hours=24`, {
        signal,
      }),
    enabled: enabled && Boolean(model),
    staleTime: 60_000,
    retry: false,
  })
}

/** Older servers omit observation counts. A zero then stays unknown, except a recorded success rate. */
export function performanceValue(
  sample: PerformanceSample | undefined,
  key: PerformanceMetric,
): number | null {
  if (!sample || sample.request_count === 0) return null
  const value = sample[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (key === 'success_rate') return value <= 100 ? value : null
  if (key === 'avg_ttft_ms' && sample.ttft_sample_count === 0) return null
  if (key === 'avg_tps' && sample.tps_observed === false) return null
  if (value > 0) return value
  if (key === 'avg_ttft_ms' && (sample.ttft_sample_count || 0) > 0) return value
  if (key === 'avg_tps' && sample.tps_observed === true) return value
  return null
}
