import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatNumber } from '@/lib/format'
import { isRunning, type StudioTask } from './contracts'

export function TaskTiming(props: { task: StudioTask; detailed?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [createdAt, submitted, startedAt, finished] = [
    props.task.created_at,
    props.task.submit_time,
    props.task.start_time,
    props.task.finish_time,
  ].map((value) =>
    value && Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value * 1000).getTime())
      ? value
      : undefined,
  )
  const submittedAt = submitted || createdAt
  const finishedAt = isRunning(props.task) ? undefined : finished
  const duration =
    startedAt !== undefined && finishedAt !== undefined && finishedAt >= startedAt
      ? finishedAt - startedAt
      : undefined
  let durationText = t('Not recorded')
  if (duration !== undefined) {
    durationText = t('{{seconds}} s', { seconds: formatNumber(duration, locale) })
    if (duration === 0) durationText = t('Less than 1 s')
  } else if (isRunning(props.task)) {
    durationText = props.task.status === 'IN_PROGRESS' ? t('Creating') : t('Queued')
  }

  if (props.detailed) {
    return (
      <>
        {[
          { label: t('Submitted at'), value: submittedAt },
          { label: t('Started at'), value: startedAt },
          { label: t('Finished at'), value: finishedAt },
        ].map((item) => (
          <Fragment key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              {item.value ? (
                <time dateTime={new Date(item.value * 1000).toISOString()}>
                  {formatDate(item.value, locale)}
                </time>
              ) : (
                '—'
              )}
            </dd>
          </Fragment>
        ))}
        <dt>{t('Generation duration')}</dt>
        <dd>{durationText}</dd>
      </>
    )
  }

  const timestamp = finishedAt || submittedAt
  if (!timestamp && duration === undefined) return null
  let label = t('Submitted at')
  if (finishedAt) label = props.task.status === 'SUCCESS' ? t('Generated at') : t('Finished at')
  const fullTime = timestamp ? `${label}: ${formatDate(timestamp, locale)}` : undefined
  return (
    <div className="studio-task-timing muted">
      {timestamp && (
        <time
          className="studio-task-time"
          dateTime={new Date(timestamp * 1000).toISOString()}
          aria-label={fullTime}
          title={fullTime}
        >
          {new Intl.DateTimeFormat(locale, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(timestamp * 1000))}
        </time>
      )}
      {timestamp && duration !== undefined && <span aria-hidden>·</span>}
      {duration !== undefined && (
        <span
          className="studio-task-duration"
          title={t('Generation duration: {{duration}}', { duration: durationText })}
        >
          <span className="sr-only">{t('Generation duration')}: </span>
          {duration === 0
            ? t('<1s')
            : t('{{seconds}}s', { seconds: formatNumber(duration, locale) })}
        </span>
      )}
    </div>
  )
}
