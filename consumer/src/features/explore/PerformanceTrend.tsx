import { useId, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { formatDate, formatNumber } from '@/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import {
  performanceMetrics,
  performanceSegments,
  formatPerformanceValue,
  performanceValue,
  type PerformancePoint,
  type PerformanceMetric,
} from './performance'

export function PerformanceTrend(props: {
  series: PerformancePoint[]
  start: number
  end: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const id = useId()
  const [metric, setMetric] = useState<PerformanceMetric>('success_rate')
  const [selected, setSelected] = useState<number | null>(null)
  const points = props.series
    .filter((point) => Number.isFinite(point.ts))
    .sort((a, b) => a.ts - b.ts)
  const current = points.find((point) => point.ts === selected) || points.at(-1)
  const selectedIndex = current ? points.indexOf(current) : -1
  const meta = performanceMetrics.find((item) => item.key === metric)!
  const duration = metric === 'avg_ttft_ms' || metric === 'avg_latency_ms'
  const start = Number.isFinite(props.start)
    ? Math.min(props.start, points[0]?.ts ?? props.start)
    : points[0]?.ts || 0
  const end = Number.isFinite(props.end)
    ? Math.max(props.end, points.at(-1)?.ts ?? props.end)
    : points.at(-1)?.ts || start + 1
  const width = Math.max(1, end - start)
  const maximum =
    metric === 'success_rate'
      ? 100
      : Math.max(1, ...points.map((point) => performanceValue(point, metric) ?? 0))
  const value = current ? performanceValue(current, metric) : null
  function selectPointerSample(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const axisWidth = duration ? 60 : 40
    if (rect.width <= axisWidth + 12) return
    const ts =
      start +
      Math.max(
        0,
        Math.min(1, (event.clientX - rect.left - axisWidth) / (rect.width - axisWidth - 12)),
      ) *
        width
    const nearest = points.reduce<PerformancePoint | undefined>(
      (best, point) => (!best || Math.abs(point.ts - ts) < Math.abs(best.ts - ts) ? point : best),
      undefined,
    )
    setSelected(nearest?.ts ?? null)
  }
  return (
    <section className="performance-trend" aria-label={t('Performance trends')}>
      <div className="segmented performance-metric-picker" aria-label={t('Trend metric')}>
        {performanceMetrics.map((item) => (
          <Button
            key={item.key}
            variant="ghost"
            aria-pressed={metric === item.key}
            onClick={() => setMetric(item.key)}
          >
            {t(item.label)}
          </Button>
        ))}
      </div>
      <p className="muted">
        {t('Hover or tap to inspect a sample. Use arrow keys when the chart is focused.')}
      </p>
      <div
        className={`performance-plot ${duration ? 'is-duration' : ''}`}
        role="group"
        tabIndex={0}
        aria-label={t('Performance trends')}
        aria-describedby={id}
        onKeyDown={(event) => {
          let index = selectedIndex
          if (event.key === 'ArrowLeft') index--
          else if (event.key === 'ArrowRight') index++
          else if (event.key === 'Home') index = 0
          else if (event.key === 'End') index = points.length - 1
          else return
          event.preventDefault()
          setSelected(points[Math.max(0, Math.min(points.length - 1, index))]?.ts ?? null)
        }}
        onPointerMove={selectPointerSample}
        onPointerDown={selectPointerSample}
      >
        <div className="performance-y-axis" aria-hidden>
          {[0, 0.5, 1].map((ratio) => (
            <span key={ratio} style={{ top: `${((156 - ratio * 140) / 180) * 100}%` }}>
              {duration
                ? formatPerformanceValue(maximum * ratio, metric, locale)
                : formatNumber(Math.round(maximum * ratio * 100) / 100, locale)}
            </span>
          ))}
        </div>
        <div className="performance-plot-area" role="img" aria-label={t(meta.label)}>
          {[0, 0.5, 1].map((ratio) => (
            <span
              key={ratio}
              className="performance-grid-line"
              style={{ top: `${((156 - ratio * 140) / 180) * 100}%` }}
            />
          ))}
          <svg
            className="performance-lines"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {performanceSegments(points, metric)
              .filter((segment) => segment.length > 1)
              .map((segment) => (
                <polyline
                  key={segment[0]!.ts}
                  points={segment
                    .map(
                      (point) =>
                        `${((point.ts - start) / width) * 100},${((156 - (performanceValue(point, metric)! / maximum) * 140) / 180) * 100}`,
                    )
                    .join(' ')}
                />
              ))}
          </svg>
          {points.map((point) => {
            const value = performanceValue(point, metric)
            if (value === null) return null
            return (
              <span
                key={point.ts}
                className={`performance-dot ${point.ts === current?.ts ? 'selected' : ''}`}
                style={{
                  left: `${((point.ts - start) / width) * 100}%`,
                  top: `${((156 - (value / maximum) * 140) / 180) * 100}%`,
                }}
              />
            )
          })}
        </div>
      </div>
      <div className="performance-time-axis">
        <span>{formatDate(start, locale)}</span>
        <span>{formatDate(end, locale)}</span>
      </div>
      <div id={id} className="performance-point-detail" role="status" aria-live="polite">
        <strong>{current ? formatDate(current.ts, locale) : t('No recent samples')}</strong>
        <span>
          {t(meta.label)}: {formatPerformanceValue(value, metric, locale)}
        </span>
        <span>
          {t('Requests')}:{' '}
          {typeof current?.request_count === 'number'
            ? formatNumber(current.request_count, locale)
            : t('Not recorded')}
        </span>
      </div>
      <p className="muted">
        {t(
          'Lines connect measured hourly samples. Missing hours or measurements leave gaps; lines do not establish uptime.',
        )}
      </p>
    </section>
  )
}
