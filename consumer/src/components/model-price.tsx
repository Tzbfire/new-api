import { useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { getAuthSnapshot, subscribeAuth } from '@/lib/auth-state'
import './model-price.css'
import { request } from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/format'
import { Button, Field, Input, Badge } from './ui'
interface Quote {
  billing_explanation?: unknown
  supports_token_input?: boolean
  provider?: string
  label: string
  billing_mode: string
  billing_unit: string
  usd?: number
  base_price_usd?: number
  price_scope?: string
  quota?: number
  matched_tier?: string
  usage_facts?: Record<string, unknown>
  request_rules?: Array<{ cond: string; multiplier: number; matched: boolean }>
  unavailable_reason?: string
}
interface QuoteResponse {
  supports_image_count?: boolean
  group: string
  group_ratio: number
  quotes: Quote[]
  input_tokens: number
  output_tokens: number
  image_count: number
}

/** A server-issued request price, never derived from catalog ratios in the browser. */
export function RequestPrice(props: { quote: Quote; imageCount?: number; detailed?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const base = props.quote.price_scope === 'base'
  const amount = base ? props.quote.base_price_usd : props.quote.usd
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null
  return (
    <div className="request-price">
      <span className="request-price-label">
        {base ? t('Base price') : t('Per-request pricing')}
      </span>
      <div className="request-price-amount">
        <strong>{formatMoney(amount, 'USD', locale)}</strong>
        <span>{t('per request')}</span>
      </div>
      {base && <small>{t('One image · service plan multiplier included')}</small>}
      {!base && props.imageCount !== undefined && (
        <small>{t('One request · {{count}} image(s)', { count: props.imageCount })}</small>
      )}
      {base && props.detailed && (
        <p className="price-note muted">
          {t('Base price for one image. Quantity, size and quality may change the final charge.')}
        </p>
      )}
    </div>
  )
}
export function useModelQuote(
  model: string,
  group: string,
  sample = { input: 1000, output: 1000, images: 1 },
  enabled = true,
) {
  const identity = useSyncExternalStore(subscribeAuth, () => {
    const auth = getAuthSnapshot()
    return `${auth.user?.id || 'public'}:${auth.session?.sid || 'anonymous'}`
  })
  return useQuery<QuoteResponse>({
    queryKey: ['model-price', identity, model, group, sample],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === identity &&
      previousQuery.queryKey[2] === model &&
      previousQuery.queryKey[3] === group
        ? previous
        : undefined,
    queryFn: async ({ signal }) => {
      const response = await request<QuoteResponse>(
        `/api/pricing/quote?model=${encodeURIComponent(model)}&group=${encodeURIComponent(group)}&input_tokens=${sample.input}&output_tokens=${sample.output}&image_count=${sample.images}`,
        { signal },
      )
      return {
        ...response,
        input_tokens: response.input_tokens ?? sample.input,
        output_tokens: response.output_tokens ?? sample.output,
        image_count: response.image_count ?? sample.images,
      }
    },
    enabled: enabled && !!model && !!group && group !== 'auto',
    retry: false,
    staleTime: 30_000,
  })
}

export function ModelPrice(props: {
  model: string
  group: string
  compact?: boolean
  showUnitPrices?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [draft, setDraft] = useState({ input: 1000, output: 1000, images: 1 })
  const [sample, setSample] = useState(draft)
  const query = useModelQuote(props.model, props.group, sample)
  const sampleMatches =
    !query.isPlaceholderData &&
    Boolean(
      query.data &&
      query.data.input_tokens === sample.input &&
      query.data.output_tokens === sample.output &&
      query.data.image_count === sample.images,
    )
  const requestOnly =
    Boolean(query.data?.quotes.length) &&
    query.data!.quotes.every(
      (quote) => quote.billing_unit === 'request' && !quote.supports_token_input,
    )
  const baseOnly = requestOnly && query.data!.quotes.every((quote) => quote.price_scope === 'base')
  let statusText = ''
  if (query.isPending) statusText = t('Checking current prices…')
  else if (query.isFetching && !sampleMatches) statusText = t('Updating price for this example…')
  if (props.group === 'auto')
    return (
      <p className="muted price-note">
        {t(
          'Automatic routing chooses the final service group. Select a specific plan to compare prices.',
        )}
      </p>
    )
  return (
    <div
      aria-busy={query.isFetching}
      className={`model-price ${props.compact ? 'compact-price' : ''}`}
    >
      {!props.compact && !requestOnly && query.data && (
        <p className="muted price-note">
          {t(
            'Tokens measure text processed by the model. Your service plan multiplier adjusts its price.',
          )}
        </p>
      )}
      {!props.compact && query.data && !baseOnly && (
        <form
          className="quote-form"
          onSubmit={(e) => {
            e.preventDefault()
            setSample({ ...draft })
          }}
        >
          {!requestOnly && (
            <>
              <Field label={t('Input tokens')}>
                <Input
                  type="number"
                  min={0}
                  max={1000000}
                  required
                  value={draft.input}
                  onChange={(e) => setDraft({ ...draft, input: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('Output tokens')}>
                <Input
                  type="number"
                  min={0}
                  max={1000000}
                  required
                  value={draft.output}
                  onChange={(e) => setDraft({ ...draft, output: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
          {query.data?.supports_image_count && (
            <Field label={t('Images')}>
              <Input
                type="number"
                min={1}
                max={128}
                required
                value={draft.images}
                onChange={(e) => setDraft({ ...draft, images: Number(e.target.value) })}
              />
            </Field>
          )}
          <Button variant="secondary" type="submit" busy={query.isFetching}>
            {t('Calculate')}
          </Button>
        </form>
      )}
      <span className="muted quote-status" role="status">
        {statusText}
      </span>
      {query.error && (
        <div className="price-note" role="alert">
          <span>{t('Price preview is unavailable. Please try again.')}</span>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t('Try again')}
          </Button>
        </div>
      )}
      {query.data?.quotes.map((quote, index) => {
        let content
        if (
          quote.price_scope === 'base' &&
          quote.billing_unit === 'request' &&
          typeof quote.base_price_usd === 'number' &&
          Number.isFinite(quote.base_price_usd) &&
          quote.base_price_usd >= 0
        ) {
          content = (
            <>
              <RequestPrice quote={quote} detailed={!props.compact} />
              {!props.compact && (
                <p className="price-note muted">
                  {t('Includes {{ratio}}× service plan multiplier', {
                    ratio: query.data!.group_ratio,
                  })}
                </p>
              )}
            </>
          )
        } else if (
          quote.unavailable_reason ||
          typeof quote.usd !== 'number' ||
          !Number.isFinite(quote.usd) ||
          quote.usd < 0
        ) {
          content = (
            <p className="muted price-note">
              {t(quote.unavailable_reason || 'Price preview is unavailable. Please try again.')}
            </p>
          )
        } else {
          content = (
            <>
              {quote.billing_unit === 'request' ? (
                <RequestPrice
                  quote={quote}
                  imageCount={query.data?.supports_image_count ? query.data.image_count : undefined}
                />
              ) : (
                <div className="row quote-amount">
                  <strong>{formatMoney(quote.usd!, 'USD', locale)}</strong>
                  <span className="muted">{t('for this example')}</span>
                </div>
              )}
              {quote.billing_unit === 'token' && (
                <p className="price-note muted">
                  {t('{{input}} input + {{output}} output tokens', {
                    input: formatNumber(query.data?.input_tokens ?? sample.input, locale),
                    output: formatNumber(query.data?.output_tokens ?? sample.output, locale),
                  })}
                </p>
              )}
              {quote.billing_unit === 'usage' && (
                <p className="price-note muted">{t(quote.label)}</p>
              )}
              <p className="price-note">
                {t('Includes {{ratio}}× service plan multiplier', {
                  ratio: query.data!.group_ratio,
                })}
              </p>
              {!props.compact && quote.billing_unit === 'token' && (
                <PriceExplanation value={quote.billing_explanation} />
              )}
              {props.compact && props.showUnitPrices && quote.billing_unit === 'token' && (
                <details className="quote-unit-prices">
                  <summary>{t('Token unit prices')}</summary>
                  <PriceExplanation value={quote.billing_explanation} />
                </details>
              )}
              {quote.matched_tier && !props.compact && (
                <p className="price-note">
                  {t('Pricing tier')}: {quote.matched_tier}
                </p>
              )}
              {quote.usage_facts && (
                <dl className="details-list">
                  {Object.entries(quote.usage_facts).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!props.compact &&
                quote.request_rules?.map((rule, n) => (
                  <p className="price-note" key={n}>
                    {rule.cond} · {rule.multiplier}× ·{' '}
                    {rule.matched ? t('Applied') : t('Not applied')}
                  </p>
                ))}
            </>
          )
        }
        return (
          <div key={`${quote.provider || ''}-${index}`} className="quote-result">
            {quote.provider && <Badge>{quote.provider}</Badge>}
            {content}
          </div>
        )
      })}
      {!props.compact && !baseOnly && (
        <p className="muted price-note">
          {t(
            'A server-calculated example, not a fixed quote. Context, cache, tools and request options may change the final charge. Actual usage is settled by New API.',
          )}
        </p>
      )}
    </div>
  )
}

/** Read-only server explanation; this component never calculates a bill. */
export function PriceExplanation(props: { value: unknown; historical?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data =
    props.value && typeof props.value === 'object' && !Array.isArray(props.value)
      ? (props.value as Record<string, unknown>)
      : {}
  const prices = data.unit_prices
  const labels: Record<string, string> = {
    p: 'Input tokens',
    c: 'Output tokens',
    cr: 'Cache read tokens',
    cc: 'Cache write tokens',
    cc1h: 'Cache write tokens (1h)',
    img: 'Billable image input tokens',
    img_o: 'Billable image output tokens',
    img_cr: 'Image cache tokens',
    ai: 'Audio input tokens',
    ao: 'Billable audio output tokens',
  }
  if (
    data.status !== 'available' ||
    !prices ||
    typeof prices !== 'object' ||
    Array.isArray(prices)
  ) {
    return (
      <p className="muted price-note">
        {t(
          props.historical && (!data.status || data.status === 'snapshot_unavailable')
            ? 'Historical unit prices were not recorded. Current prices are not substituted.'
            : 'This pricing rule cannot be separated into token unit prices.',
        )}
      </p>
    )
  }
  return (
    <section aria-label={t('Token unit prices')}>
      <p className="price-note">
        {t(
          props.historical
            ? 'Recorded unit prices include the applied group multiplier.'
            : 'Current unit prices include the service plan multiplier.',
        )}
      </p>
      <dl className="details-list">
        {Object.entries(prices).map(([key, value]) => {
          if (!labels[key] || typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            return null
          return (
            <div key={key}>
              <dt>{t(labels[key])}</dt>
              <dd>
                {t('{{price}} per million tokens', { price: formatMoney(value, 'USD', locale) })}
              </dd>
            </div>
          )
        })}
      </dl>
      {Array.isArray(data.cache_included) && data.cache_included.length > 0 && (
        <p className="muted price-note">
          {t('Cache reads without a separate price use the input token price.')}
        </p>
      )}
    </section>
  )
}
