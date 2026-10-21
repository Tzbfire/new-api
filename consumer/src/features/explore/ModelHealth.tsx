import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate, formatNumber } from '@/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import { Button } from '@/components/ui'
import {
  performanceMetrics,
  formatPerformanceValue,
  performanceValue,
  useModelMetrics,
  type PerformanceSample,
} from './performance'
import { PerformanceTrend } from './PerformanceTrend'

export function PerformanceValues(props: { sample?: PerformanceSample; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const metrics = props.compact ? performanceMetrics.slice(0, 2) : performanceMetrics
  return (
    <dl className="model-health-stats">
      {metrics.map((metric) => {
        const value = performanceValue(props.sample, metric.key)
        return (
          <div key={metric.key}>
            <dt>{t(metric.label)}</dt>
            <dd>
              {value === null || metric.key === 'avg_ttft_ms' || metric.key === 'avg_latency_ms' ? (
                formatPerformanceValue(value, metric.key, locale)
              ) : (
                <>
                  <span>{formatNumber(Math.round(value * 100) / 100, locale)}</span>{' '}
                  <small>{metric.unit}</small>
                </>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** Gateway observations for this exact group, never a live uptime assertion. */
export function ModelHealth(props: {
  model: string
  group: string
  expanded?: boolean
  summaryOnly?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const metrics = useModelMetrics(props.model, props.group !== 'auto')
  const group = metrics.error
    ? undefined
    : metrics.data?.groups?.find((item) => item.group === props.group)
  const series = (group?.series || []).filter((point) => Number.isFinite(point.ts))
  const latest = [...series].sort((a, b) => a.ts - b.ts).at(-1)
  let state = 'No recent samples'
  if (metrics.isPending) state = 'Loading performance…'
  else if (metrics.error) state = 'Performance unavailable'
  else if (latest && performanceValue(latest, 'success_rate') !== null)
    state = latest.success_rate === 100 ? 'Recent requests succeeded' : 'Recent requests had errors'
  if (props.group === 'auto')
    return (
      <p className="muted model-health-note">
        {t(
          'Automatic routing is measured under the group that actually served the request. Compare specific groups below.',
        )}
      </p>
    )
  return (
    <section
      className={`model-health ${props.expanded || props.summaryOnly ? 'is-expanded' : ''}`}
      aria-label={t('Model performance')}
    >
      <div className="model-health-heading">
        <span className="model-health-state">
          <Activity size={13} aria-hidden />
          {t(state)}
        </span>
        <span className="muted">{t('Last 24 hours')}</span>
      </div>
      <PerformanceValues
        sample={metrics.error ? undefined : group}
        compact={!props.expanded && !props.summaryOnly}
      />
      {props.summaryOnly && group && (
        <p className="model-health-note muted">
          {typeof group.request_count === 'number'
            ? t('{{samples}} recorded requests', {
                samples: formatNumber(group.request_count, locale),
              })
            : t('Sample count not recorded')}
          {latest && (
            <>
              {' '}
              · {t('Latest sample')}: {formatDate(latest.ts, locale)}
            </>
          )}
        </p>
      )}
      {props.expanded && (
        <>
          <div className="performance-samples">
            <span>
              {t('Service plan')}: <strong>{props.group}</strong>
            </span>
            <span>
              {t('Requests')}:{' '}
              <strong>
                {typeof group?.request_count === 'number'
                  ? formatNumber(group.request_count, locale)
                  : t('Not recorded')}
              </strong>
            </span>
            {typeof group?.success_count === 'number' && (
              <span>
                {t('Successful requests')}:{' '}
                <strong>{formatNumber(group.success_count, locale)}</strong>
              </span>
            )}
            {latest && (
              <span>
                {t('Latest sample')}: {formatDate(latest.ts, locale)}
              </span>
            )}
          </div>
          {metrics.error && (
            <p className="field-error" role="alert">
              {t('Could not refresh performance. Try again to see current observations.')}
            </p>
          )}
          {!!series.length && !metrics.error && (
            <PerformanceTrend
              key={`${props.model}:${props.group}`}
              series={series}
              start={metrics.data?.window_start || series[0]!.ts}
              end={metrics.data?.window_end || latest!.ts + 1}
            />
          )}
          <details className="performance-methodology">
            <summary>{t('How these metrics are measured')}</summary>
            <p>
              {t(
                'The window covers 24 hourly periods, including the current partial hour. These are recorded gateway requests; recent traffic or other instances may not be fully represented.',
              )}
            </p>
            <dl className="details-list">
              <div>
                <dt>{t('Request success rate')}</dt>
                <dd>
                  {t(
                    'Completed successfully / counted requests. Business rejections and user cancellations are excluded. This is not time-based uptime.',
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('Token speed (TPS)')}</dt>
                <dd>
                  {t(
                    'Recorded tokens / generation seconds, not an average of request speeds. Streaming starts at the first response; non-streaming uses total time. Async tasks use reported token counts.',
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('First response (TTFT)')}</dt>
                <dd>
                  {t(
                    'Mean time to the first streamed response, only for requests with a recorded first response. It is not necessarily the first visible word.',
                  )}
                  {typeof group?.ttft_sample_count === 'number' && (
                    <>
                      {' '}
                      {t('Measured requests')}: {formatNumber(group.ttft_sample_count, locale)}.
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('Total latency')}</dt>
                <dd>
                  {t(
                    'Mean total duration of counted requests, including failures and retry time. Request length and workload affect comparisons.',
                  )}
                </dd>
              </div>
            </dl>
            <p>
              {t(
                'A dash means the metric was not recorded. No requests does not mean offline. Sparse samples cannot establish reliability.',
              )}
            </p>
          </details>
          <Button variant="ghost" busy={metrics.isFetching} onClick={() => void metrics.refetch()}>
            {t('Refresh')}
          </Button>
        </>
      )}
    </section>
  )
}
