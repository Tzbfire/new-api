import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, Modal } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { Turnstile } from '@/features/auth/turnstile'
import { getCheckinStatus, type CheckinStatus } from './api'

export default function CheckinDialog(props: {
  status?: CheckinStatus
  statusError: unknown
  error: unknown
  checked: boolean
  busy: boolean
  needsConfirmation: boolean
  balancePending: boolean
  refreshingBalance: boolean
  onClose: () => void
  onRefreshStatus: () => void
  onRefreshBalance: () => void
  onSubmit: (token: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  const session = useSession()
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [monthChoice, setMonth] = useState('')
  const [token, setToken] = useState('')
  const todayMonth = props.status?.today?.slice(0, 7) || ''
  const month = monthChoice || todayMonth
  const history = useQuery({
    queryKey: ['checkin', session.user?.id, session.sessionId, month],
    queryFn: ({ signal }) => getCheckinStatus(signal, month),
    enabled: recordsOpen && !!month && month !== todayMonth,
    staleTime: 30_000,
    retry: false,
  })
  const records = month === todayMonth ? props.status : history.data
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const monthDate = new Date(`${month || '2000-01'}-01T12:00:00Z`)
  const quota = (value: number) =>
    formatQuota(value, site.data, locale, { maximumFractionDigits: 8 })
  const verify = site.data?.turnstile_check === true
  const todayReward = props.status?.stats.records.find(
    (record) => record.checkin_date === props.status?.today,
  )

  function changeMonth(offset: number) {
    const date = new Date(monthDate)
    date.setUTCMonth(date.getUTCMonth() + offset)
    setMonth(date.toISOString().slice(0, 7))
  }

  return (
    <Modal open onClose={props.onClose} title={t('Daily check-in')} className="checkin-dialog">
      <div className="stack">
        {!!props.statusError && (
          <ErrorState
            error={props.statusError}
            title={t('Check-in status unavailable')}
            retry={props.onRefreshStatus}
          />
        )}
        {props.status && (
          <>
            <div className="checkin-today">
              <span className="checkin-gift" aria-hidden>
                {props.checked ? <Check size={22} /> : <Gift size={22} />}
              </span>
              <div>
                <strong>{t(props.checked ? 'Checked in today' : 'Check in for credit')}</strong>
                {props.checked && todayReward && (
                  <p className="checkin-award">
                    {t('Claimed {{amount}}', { amount: quota(todayReward.quota_awarded) })}
                  </p>
                )}
                <p className="muted">
                  {props.status.min_quota === props.status.max_quota
                    ? t('Fixed daily reward: {{amount}}', { amount: quota(props.status.min_quota) })
                    : t('Daily reward: {{min}}–{{max}}', {
                        min: quota(props.status.min_quota),
                        max: quota(props.status.max_quota),
                      })}
                </p>
              </div>
            </div>
            <p className="field-hint">
              {t('Rewards are added to your wallet balance.')}{' '}
              {props.status.timezone &&
                t('Resets daily at 00:00 ({{timezone}}).', { timezone: props.status.timezone })}
            </p>
            {props.needsConfirmation && (
              <div className="checkin-warning" role="alert">
                <p>{t('Unable to confirm check-in. Refresh the status before trying again.')}</p>
                <Button variant="secondary" busy={props.busy} onClick={props.onRefreshStatus}>
                  {t('Refresh check-in status')}
                </Button>
              </div>
            )}
            {!!props.error && <ErrorState error={props.error} />}
            {props.balancePending && (
              <div className="checkin-warning" role="status">
                <p>{t('Check-in successful. Balance is still updating.')}</p>
                <Button
                  variant="secondary"
                  busy={props.refreshingBalance}
                  onClick={props.onRefreshBalance}
                >
                  {t('Refresh balance')}
                </Button>
              </div>
            )}
            {!props.checked && !props.needsConfirmation && (
              <>
                {verify && (
                  <Turnstile
                    key={String(props.busy)}
                    siteKey={site.data?.turnstile_site_key || ''}
                    onToken={setToken}
                  />
                )}
                <Button
                  busy={props.busy}
                  disabled={!!props.statusError || (verify && !token)}
                  onClick={() => props.onSubmit(token)}
                >
                  {t(verify ? 'Verify to check in' : 'Check in for credit')}
                </Button>
              </>
            )}
            <div className="checkin-summary">
              <div>
                <span>{t('Check-ins this month')}</span>
                <strong>{formatNumber(props.status.stats.checkin_count, locale)}</strong>
              </div>
              <div>
                <span>{t('Total rewards')}</span>
                <strong>{quota(props.status.stats.total_quota)}</strong>
              </div>
            </div>
            <Button
              variant="ghost"
              className="checkin-records-toggle"
              aria-expanded={recordsOpen}
              aria-controls="checkin-records"
              onClick={() => setRecordsOpen(!recordsOpen)}
            >
              {t('Check-in records')}
              <ChevronDown size={16} aria-hidden />
            </Button>
            {recordsOpen && (
              <section
                id="checkin-records"
                className="checkin-records"
                aria-label={t('Check-in records')}
              >
                {!!month && (
                  <div className="checkin-month">
                    <Button
                      variant="ghost"
                      aria-label={t('Previous month')}
                      disabled={month <= '2000-01' || props.busy}
                      onClick={() => changeMonth(-1)}
                    >
                      <ChevronLeft size={17} />
                    </Button>
                    <strong>
                      {new Intl.DateTimeFormat(locale, {
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      }).format(monthDate)}
                    </strong>
                    <Button
                      variant="ghost"
                      aria-label={t('Next month')}
                      disabled={month >= todayMonth || props.busy}
                      onClick={() => changeMonth(1)}
                    >
                      <ChevronRight size={17} />
                    </Button>
                  </div>
                )}
                {history.isError && month !== todayMonth && (
                  <ErrorState error={history.error} retry={() => void history.refetch()} />
                )}
                {history.isFetching && month !== todayMonth && (
                  <p role="status" className="muted">
                    {t('Loading your space…')}
                  </p>
                )}
                {records && (
                  <ul className="checkin-record-list">
                    {records.stats.records.map((record) => (
                      <li key={record.checkin_date}>
                        <time dateTime={record.checkin_date}>
                          {dateFormatter.format(new Date(`${record.checkin_date}T12:00:00Z`))}
                        </time>
                        <strong>+{quota(record.quota_awarded)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {records && !records.stats.records.length && (
                  <p className="muted">{t('No check-ins this month')}</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
