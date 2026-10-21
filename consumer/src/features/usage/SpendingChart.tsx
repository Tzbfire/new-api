import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { formatNumber, formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { toIntlLocale } from '@/i18n/languages'
import type { DailyUsage } from './chart'

export function SpendingChart(props: { daily: DailyUsage[] }) {
  const { t, i18n } = useTranslation()
  const site = useStatus()
  const detailID = useId()
  const keyboardNavigation = useRef(false)
  const [selectedDate, setSelectedDate] = useState<number | null>(null)
  const selected = props.daily.find((day) => day.date === selectedDate) || props.daily.at(-1)
  const peak = Math.max(0, ...props.daily.map((day) => day.quota))
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const dateFormat = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const shortDateFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  if (!selected) return null
  return (
    <div className="spending-chart">
      <p className="muted">{t('Hover, focus or tap a day to inspect spending.')}</p>
      <div
        className="spending-plot"
        role="group"
        aria-label={t('Daily spending chart')}
        onKeyDown={() => {
          keyboardNavigation.current = true
        }}
        onPointerMove={() => {
          keyboardNavigation.current = false
        }}
      >
        <div className="spending-axis" aria-label={t('Cost')}>
          {[1, 0.5, 0].map((ratio) => (
            <span key={ratio}>{formatQuota(peak * ratio, site.data, locale)}</span>
          ))}
        </div>
        <div
          className="spending-bars"
          style={{ minWidth: `${Math.max(260, props.daily.length * 16)}px` }}
        >
          {props.daily.map((day, index) => (
            <Button
              variant="ghost"
              className="spending-day"
              key={day.date}
              aria-label={`${dateFormat.format(day.date * 1000)}: ${formatQuota(day.quota, site.data, locale)}`}
              aria-pressed={selected.date === day.date}
              aria-describedby={detailID}
              onMouseEnter={() => {
                if (!keyboardNavigation.current) setSelectedDate(day.date)
              }}
              onFocus={() => setSelectedDate(day.date)}
              onClick={() => setSelectedDate(day.date)}
            >
              <span className="spending-bar-track" aria-hidden>
                <span
                  className="spending-bar"
                  style={{ height: `${peak ? Math.max(1, (day.quota / peak) * 100) : 1}%` }}
                />
              </span>
              <span className="spending-date" aria-hidden>
                {index % Math.ceil(props.daily.length / 6) === 0 || index === props.daily.length - 1
                  ? shortDateFormat.format(day.date * 1000)
                  : '\u00a0'}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div
        id={detailID}
        className="spending-selection"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>{dateFormat.format(selected.date * 1000)}</strong>
        <span>
          {t('Cost')}: <strong>{formatQuota(selected.quota, site.data, locale)}</strong>
        </span>
        {selected.count !== undefined && (
          <span>
            {t('Requests')}: {formatNumber(selected.count, locale)}
          </span>
        )}
        {selected.token_used !== undefined && (
          <span>
            {t('Tokens')}: {formatNumber(selected.token_used, locale)}
          </span>
        )}
      </div>
    </div>
  )
}
