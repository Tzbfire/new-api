import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, Image, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import type { PricingModel } from '@/lib/catalog'
import { formatMoney, formatNumber } from '@/lib/format'
import { ModelPrice, RequestPrice, useModelQuote } from './model-price'
import { Button, EmptyState, Input } from './ui'
import './model-price-list.css'

const priceColumns = [
  { key: 'p', label: 'Input price' },
  { key: 'c', label: 'Output price' },
  { key: 'cr', label: 'Cache read price' },
  { key: 'cc', label: 'Cache write price' },
] as const

/** Compare server-issued rates; the existing calculator owns all request examples. */
export function ModelPriceList(props: { models: PricingModel[]; group: string }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState('')
  const models = props.models
    .filter((model) => model.model_name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.model_name.localeCompare(b.model_name, locale, { numeric: true }))
  return (
    <div className="price-comparison">
      <div className="price-comparison-toolbar">
        <div className="search-field">
          <Search size={17} aria-hidden />
          <Input
            type="search"
            aria-label={t('Search models')}
            placeholder={t('Search models')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setExpanded('')
            }}
          />
        </div>
        <span className="muted">{t('{{count}} models', { count: models.length })}</span>
      </div>
      <div className="price-comparison-unit">
        <span>{t('Current unit prices include the service plan multiplier.')}</span>
      </div>
      <div className="price-comparison-head" aria-hidden>
        <span>{t('Model')}</span>
        <span>{t('Models and pricing')}</span>
        <span />
      </div>
      {!models.length && <EmptyState compact title={t('No models found')} />}
      {props.group === 'auto' ? (
        <p className="muted">
          {t(
            'Automatic routing chooses the final service group. Select a specific plan to compare prices.',
          )}
        </p>
      ) : (
        models.map((model) => (
          <ModelPriceRow
            key={`${props.group}:${model.model_name}`}
            model={model}
            group={props.group}
            expanded={expanded === model.model_name}
            onToggle={() => setExpanded(expanded === model.model_name ? '' : model.model_name)}
          />
        ))
      )}
      <p className="price-comparison-footnote">
        {t('Prices follow each model’s billing unit. Expand a model for pricing details.')}{' '}
        {t('A dash means no separate unit price is available.')}
      </p>
    </div>
  )
}

export function ModelPriceSummary(props: {
  model: string
  group: string
  enabled?: boolean
  compact?: boolean
  showExample?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useModelQuote(props.model, props.group, undefined, props.enabled !== false)
  const quotes = props.enabled === false || query.error ? [] : query.data?.quotes || []
  const quote = quotes.length === 1 ? quotes[0] : undefined
  const explanation = quote?.billing_explanation
  const data =
    explanation && typeof explanation === 'object' && !Array.isArray(explanation)
      ? (explanation as Record<string, unknown>)
      : {}
  const rates =
    data.status === 'available' &&
    data.unit_prices &&
    typeof data.unit_prices === 'object' &&
    !Array.isArray(data.unit_prices)
      ? (data.unit_prices as Record<string, unknown>)
      : null
  let content: ReactNode
  if (props.enabled === false) {
    content = (
      <span className="price-comparison-message">
        {t('Unavailable in this group. Compare other groups.')}
      </span>
    )
  } else if (props.group === 'auto') {
    content = (
      <span className="price-comparison-message">
        {t(
          'Automatic routing chooses the final service group. Select a specific plan to compare prices.',
        )}
      </span>
    )
  } else if (query.isPending) {
    content = (
      <span className="price-comparison-message" role="status">
        {t('Checking current prices…')}
      </span>
    )
  } else if (query.error) {
    content = (
      <div className="price-comparison-message" role="alert">
        <span>{t('Price preview is unavailable. Please try again.')}</span>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          {t('Try again')}
        </Button>
      </div>
    )
  } else if (
    quote?.billing_unit === 'request' &&
    quote.price_scope === 'base' &&
    typeof quote.base_price_usd === 'number' &&
    Number.isFinite(quote.base_price_usd) &&
    quote.base_price_usd >= 0
  ) {
    content = <RequestPrice quote={quote} />
  } else if (rates && quote?.billing_unit === 'token' && !quote.unavailable_reason) {
    content = (
      <dl className="price-comparison-values">
        {(props.compact ? priceColumns.slice(0, 2) : priceColumns).map((column) => {
          const value = rates[column.key]
          return (
            <div key={column.key}>
              <dt>{t(column.label)}</dt>
              <dd>
                {typeof value === 'number' && Number.isFinite(value) && value >= 0
                  ? formatMoney(value, 'USD', locale)
                  : '—'}
              </dd>
            </div>
          )
        })}
      </dl>
    )
  } else if (
    quote &&
    !quote.unavailable_reason &&
    typeof quote.usd === 'number' &&
    Number.isFinite(quote.usd) &&
    quote.usd >= 0
  ) {
    content =
      quote.billing_unit === 'request' ? (
        <RequestPrice quote={quote} />
      ) : (
        <div className="price-comparison-message">
          <strong>{formatMoney(quote.usd, 'USD', locale)}</strong>
          <span>{t('for this example')}</span>
        </div>
      )
  } else {
    let message = t('Priced by request options')
    if (quotes.length > 1) message = t('Multiple pricing rules')
    else if (!quotes.length) message = t('Price preview is unavailable. Please try again.')
    else if (
      quote?.unavailable_reason &&
      [
        'pricing_not_configured',
        'invalid_pricing',
        'request_parameters_required',
        'usage_example_required',
      ].includes(quote.unavailable_reason)
    )
      message = t(quote.unavailable_reason)
    content = <span className="price-comparison-message">{message}</span>
  }
  return (
    <div className={`model-price-summary ${props.compact ? 'is-compact' : ''}`}>
      {content}
      {rates && quote?.billing_unit === 'token' && !quote.unavailable_reason && (
        <span className="price-summary-unit">{t('USD per million tokens')}</span>
      )}
      {props.showExample &&
        quote?.billing_unit === 'token' &&
        rates &&
        !quote.unavailable_reason &&
        typeof quote.usd === 'number' &&
        Number.isFinite(quote.usd) &&
        quote.usd >= 0 && (
          <div className="price-summary-example">
            <span>
              {t('for this example')} <strong>{formatMoney(quote.usd, 'USD', locale)}</strong>
            </span>
            <small>
              {t('{{input}} input + {{output}} output tokens', {
                input: formatNumber(query.data?.input_tokens || 0, locale),
                output: formatNumber(query.data?.output_tokens || 0, locale),
              })}
            </small>
            {props.compact && (
              <small>
                {t(
                  'Tokens measure text processed by the model. Your service plan multiplier adjusts its price.',
                )}
              </small>
            )}
          </div>
        )}
    </div>
  )
}

function ModelPriceRow(props: {
  model: PricingModel
  group: string
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const isImage = props.model.supported_endpoint_types?.includes('image-generation')
  const Icon = isImage ? Image : Sparkles
  return (
    <article
      className="price-comparison-item"
      aria-labelledby={`${id}-name`}
      data-expanded={props.expanded || undefined}
    >
      <div className="price-comparison-row">
        <div className="price-comparison-model">
          <span className={`price-comparison-icon ${isImage ? 'image' : ''}`}>
            <Icon size={17} aria-hidden />
          </span>
          <div>
            <h3 id={`${id}-name`}>{props.model.model_name}</h3>
            <span>{isImage ? t('Image creation') : t('AI model')}</span>
          </div>
        </div>
        <ModelPriceSummary model={props.model.model_name} group={props.group} />
        <Button
          variant="ghost"
          className="price-comparison-toggle icon-button"
          aria-label={t('View pricing for {{model}}', { model: props.model.model_name })}
          aria-expanded={props.expanded}
          aria-controls={props.expanded ? `${id}-detail` : undefined}
          onClick={props.onToggle}
        >
          <ChevronDown size={17} aria-hidden />
        </Button>
      </div>
      {props.expanded && (
        <div id={`${id}-detail`} className="price-comparison-detail">
          <p className="price-comparison-detail-title">{t('Usage estimate and billing details')}</p>
          <ModelPrice model={props.model.model_name} group={props.group} />
        </div>
      )}
    </article>
  )
}
