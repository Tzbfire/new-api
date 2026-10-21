import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatBalance } from '@/lib/format'
import { useStatus } from '@/lib/status'
import type { APIKey } from './types'

export function KeyQuota(props: { apiKey: APIKey }) {
  const { t, i18n } = useTranslation()
  const site = useStatus()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const used = Math.max(0, props.apiKey.used_quota || 0)
  const remaining = Math.max(0, props.apiKey.remain_quota || 0)
  const total = used + remaining
  const percent = total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0
  return (
    <div className="key-quota">
      <dl className="key-quota-values">
        <div>
          <dt>{t('Used')}</dt>
          <dd>{formatBalance(used, site.data, locale)}</dd>
        </div>
        <div>
          <dt>{t('Remaining')}</dt>
          <dd>
            {props.apiKey.unlimited_quota
              ? t('No key limit')
              : formatBalance(remaining, site.data, locale)}
          </dd>
        </div>
        {!props.apiKey.unlimited_quota && (
          <div>
            <dt>{t('Total key budget')}</dt>
            <dd>{formatBalance(total, site.data, locale)}</dd>
          </div>
        )}
      </dl>
      {props.apiKey.unlimited_quota ? (
        <p className="muted">{t('Your wallet balance still applies.')}</p>
      ) : (
        <>
          <div
            className="key-quota-track"
            role="progressbar"
            aria-label={t('Remaining key budget')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={t('{{percent}}% remaining', { percent: formatNumber(percent, locale) })}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="muted">
            {t('{{percent}}% remaining', { percent: formatNumber(percent, locale) })}
          </span>
        </>
      )}
    </div>
  )
}
