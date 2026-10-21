import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { formatMoney, formatNumber } from '@/lib/format'
import { PriceExplanation } from '@/components/model-price'
import { usageCache, usageDetails } from './chart'

/** Explicit public field list: never render arbitrary metadata or privileged scopes. */
export function BillingDetails(props: { other: string }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const details = usageDetails(props.other)
  const cache = usageCache(props.other)
  const quantities = [
    ['input_tokens_total', 'Total input tokens'],
    ['cache_tokens', 'Cache read tokens'],
    ['cache_write_tokens', 'Cache write tokens'],
    ['cache_creation_tokens_5m', 'Cache write tokens (5m)'],
    ['cache_creation_tokens_1h', 'Cache write tokens (1h)'],
    ['image_cache_tokens', 'Image cache tokens'],
    ['image_output', 'Image tokens'],
    ['audio_input_token_count', 'Audio input tokens'],
  ] as const
  const ratios = [
    ['model_ratio', 'Model multiplier'],
    ['completion_ratio', 'Output multiplier'],
    ['group_ratio', 'Group multiplier'],
    ['user_group_ratio', 'User group multiplier'],
    ['cache_ratio', 'Cache read multiplier'],
    ['cache_creation_ratio', 'Cache write multiplier'],
    ['cache_creation_ratio_5m', 'Cache write multiplier (5m)'],
    ['cache_creation_ratio_1h', 'Cache write multiplier (1h)'],
  ] as const
  let mode = t('Not recorded')
  if (details.billing_mode === 'tiered_expr') mode = t('Dynamic pricing')
  else if (typeof details.model_price === 'number' && details.model_price >= 0)
    mode = t('Fixed price')
  else if (typeof details.model_ratio === 'number') mode = t('Token pricing')
  const billingTokens = details.billing_tokens
  const tokenFields = [
    ['p', 'Billable input tokens'],
    ['c', 'Billable output tokens'],
    ['cr', 'Billable cache read tokens'],
    ['cc', 'Billable cache write tokens'],
    ['cc1h', 'Billable cache write tokens (1h)'],
    ['img', 'Billable image input tokens'],
    ['img_o', 'Billable image output tokens'],
    ['img_cr', 'Billable image cache tokens'],
    ['ai', 'Billable audio input tokens'],
    ['ao', 'Billable audio output tokens'],
  ] as const
  return (
    <section className="stack billing-details" aria-label={t('Billing details')}>
      <dl className="details-list">
        <div>
          <dt>{t('Pricing mode')}</dt>
          <dd>{mode}</dd>
        </div>
        {(details.billing_unit === 'request' || details.billing_unit === 'token') && (
          <div>
            <dt>{t('Billing unit')}</dt>
            <dd>{t(details.billing_unit === 'token' ? 'Tokens' : 'Request')}</dd>
          </div>
        )}
        {typeof details.matched_tier === 'string' && (
          <div>
            <dt>{t('Pricing tier')}</dt>
            <dd>{details.matched_tier}</dd>
          </div>
        )}
        {quantities.map(([key, label]) => {
          let value = details[key]
          if (key === 'cache_write_tokens') value = cache?.write
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{formatNumber(value, locale)}</dd>
            </div>
          )
        })}
        {ratios.map(([key, label]) => {
          if (
            details.billing_mode === 'tiered_expr' &&
            key !== 'group_ratio' &&
            key !== 'user_group_ratio'
          )
            return null
          const value = details[key]
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{formatNumber(value, locale)}×</dd>
            </div>
          )
        })}
        {(['model_price', 'fixed_price'] as const).map((key) => {
          if (key === 'model_price' && details.billing_mode === 'tiered_expr') return null
          const value = details[key]
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>
                {t(
                  key === 'fixed_price'
                    ? 'Matched fixed price (USD)'
                    : 'Recorded model price (USD)',
                )}
              </dt>
              <dd>{formatMoney(value, 'USD', locale)}</dd>
            </div>
          )
        })}
      </dl>
      {details.billing_mode === 'tiered_expr' && (
        <PriceExplanation value={details.billing_explanation} historical />
      )}
      {typeof details.request_path === 'string' && (
        <p>
          {t('Request path')}: <code>{details.request_path}</code>
        </p>
      )}
      {!!details.usage_facts &&
        typeof details.usage_facts === 'object' &&
        !Array.isArray(details.usage_facts) && (
          <section aria-label={t('Recorded usage facts')}>
            <h3>{t('Recorded usage facts')}</h3>
            <dl className="details-list">
              {Object.entries(details.usage_facts).map(([key, value]) => {
                if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
                return (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{formatNumber(value, locale)}</dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )}
      {!!billingTokens && typeof billingTokens === 'object' && !Array.isArray(billingTokens) && (
        <section aria-label={t('Billable token breakdown')}>
          <h3>{t('Billable token breakdown')}</h3>
          <dl className="details-list">
            {tokenFields.map(([key, label]) => {
              const value = (billingTokens as Record<string, unknown>)[key]
              if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
              return (
                <div key={key}>
                  <dt>{t(label)}</dt>
                  <dd>{formatNumber(value, locale)}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      )}
      {Array.isArray(details.request_rules) && details.request_rules.length > 0 && (
        <details>
          <summary>{t('Request pricing rules')}</summary>
          {details.request_rules.map((item: unknown, index) => {
            if (!item || typeof item !== 'object') return null
            const rule = item as Record<string, unknown>
            if (
              typeof rule.cond !== 'string' ||
              typeof rule.multiplier !== 'number' ||
              !Number.isFinite(rule.multiplier) ||
              typeof rule.matched !== 'boolean'
            )
              return null
            return (
              <p key={index}>
                {rule.cond} · {formatNumber(rule.multiplier, locale)}× ·{' '}
                {t(rule.matched ? 'Applied' : 'Not applied')}
              </p>
            )
          })}
        </details>
      )}
      <p className="muted">
        {t(
          'Recorded server billing data. Cache categories may overlap input tokens; amounts are not recalculated here.',
        )}
      </p>
    </section>
  )
}
