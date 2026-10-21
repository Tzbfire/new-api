import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, MessageCircle, KeyRound, ImagePlus } from 'lucide-react'
import { useCatalog, type PricingModel } from '@/lib/catalog'
import { useSession } from '@/lib/session'
import { request } from '@/lib/api'
import { Button, Badge, CopyButton } from '@/components/ui'
import { ServiceGroupOptions } from '@/components/service-group-options'
import { ModelPrice } from '@/components/model-price'
import { ModelPriceSummary } from '@/components/model-price-list'
import { supportsKind } from '@/components/service-picker'
import { ModelHealth, PerformanceValues } from './ModelHealth'
import { useModelMetrics } from './performance'
import { formatNumber } from '@/lib/format'
import { toIntlLocale } from '@/i18n/languages'

export function ModelDetails(props: {
  model: PricingModel
  onGroupChange: (group: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const catalog = useCatalog()
  const session = useSession()
  const [view, setView] = useState<'overview' | 'groups' | 'performance'>('overview')
  const permissions = useQueries({
    queries: catalog.groups.map((group) => ({
      queryKey: ['allowed-models', session.user?.id || 'public', group.id],
      queryFn: () => request<string[]>(`/api/user/models?group=${encodeURIComponent(group.id)}`),
      enabled: session.status === 'authenticated',
      staleTime: 30_000,
      retry: false,
    })),
  })
  const groups = catalog.groups.map((group, index) => {
    const permission = permissions[index]!
    let allowed =
      props.model.enable_groups?.includes('all') || props.model.enable_groups?.includes(group.id)
    if (group.id === 'auto')
      allowed =
        props.model.enable_groups?.includes('all') ||
        props.model.enable_groups?.some((id) => catalog.autoGroups.includes(id))
    return {
      ...group,
      allowed:
        session.status === 'authenticated'
          ? permission.isSuccess && permission.data.includes(props.model.model_name)
          : Boolean(allowed),
      pending: session.status === 'authenticated' && permission.isPending,
      error: session.status === 'authenticated' ? permission.error : null,
      retry: permission.refetch,
    }
  })
  const selected = groups.find((group) => group.id === catalog.group)
  const metrics = useModelMetrics(props.model.model_name)
  const vendor = catalog.vendors.find((vendor) => vendor.id === props.model.vendor_id)
  let accessStatus = (
    <strong>
      {t(selected?.allowed ? 'Available in this group' : 'Not available in this group')}
    </strong>
  )
  if (selected?.pending) accessStatus = <span role="status">{t('Checking model access…')}</span>
  else if (selected?.error)
    accessStatus = (
      <div role="alert" className="row">
        <span>{t('Could not verify model access.')}</span>
        <Button variant="ghost" onClick={() => void selected.retry()}>
          {t('Try again')}
        </Button>
      </div>
    )
  return (
    <div className="model-details-body">
      <div className="model-details-controls">
        <div className="model-selected-context">
          <ServiceGroupOptions
            label={t('Selected service group')}
            value={catalog.group}
            onValueChange={props.onGroupChange}
            groups={groups.map((group) => {
              let status: string | undefined
              if (group.pending) status = t('Checking model access…')
              else if (group.error) status = t('Could not verify model access.')
              else if (!group.allowed) status = t('Not available in this group')
              return { ...group, disabled: !group.allowed, status }
            })}
            status={accessStatus}
          />
        </div>
        <div className="model-details-sections" aria-label={t('Model details')}>
          <Button
            variant="ghost"
            aria-pressed={view === 'overview'}
            onClick={() => setView('overview')}
          >
            {t('Overview')}
          </Button>
          <Button
            variant="ghost"
            aria-pressed={view === 'groups'}
            onClick={() => setView('groups')}
          >
            {t('Prices and groups')}
          </Button>
          <Button
            variant="ghost"
            aria-pressed={view === 'performance'}
            onClick={() => setView('performance')}
          >
            {t('Performance trends')}
          </Button>
        </div>
      </div>
      <div key={view} className="model-details-scroll">
        {view === 'overview' && (
          <div className="model-overview">
            <div className="model-details-intro">
              <div className="row model-tags">
                {vendor && <Badge>{vendor.name}</Badge>}
                {(props.model.tags || '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
              </div>
              <p>{props.model.description || t('No model description has been provided.')}</p>
            </div>
            <div className="model-overview-summary">
              <section className="model-overview-pricing" aria-label={t('Current prices')}>
                <div className="model-section-heading">
                  <h3>{t('Current prices')}</h3>
                </div>
                {selected?.allowed ? (
                  <ModelPriceSummary
                    model={props.model.model_name}
                    group={catalog.group}
                    compact
                    showExample
                  />
                ) : (
                  <p className="muted">
                    {t('Select a group that supports this model to view its price.')}
                  </p>
                )}
                <p className="model-overview-price-note">
                  {t('Current unit prices include the service plan multiplier.')}
                </p>
                <Button
                  variant="ghost"
                  className="model-compare-link"
                  onClick={() => setView('groups')}
                >
                  {t('Compare service groups')}
                  <ArrowRight size={14} aria-hidden />
                </Button>
              </section>
              <section className="model-overview-performance">
                <div className="model-section-heading">
                  <h3>{t('Model performance')}</h3>
                  <Button variant="ghost" onClick={() => setView('performance')}>
                    {t('Performance trends')}
                    <ArrowRight size={13} aria-hidden />
                  </Button>
                </div>
                {selected?.allowed ? (
                  <ModelHealth
                    key={`${props.model.model_name}:${catalog.group}`}
                    model={props.model.model_name}
                    group={catalog.group}
                    summaryOnly
                  />
                ) : (
                  <p className="muted">
                    {t('Performance is shown after model access is confirmed.')}
                  </p>
                )}
              </section>
            </div>
            <p className="model-overview-method-note">
              {t(
                'Request success rate is not time-based uptime. No samples means unknown, not offline. Open performance trends for definitions and sample times.',
              )}
            </p>
            <details className="model-endpoints">
              <summary>{t('Model information and API endpoints')}</summary>
              <div className="row">
                <code>{props.model.model_name}</code>
                <CopyButton value={props.model.model_name} label={t('Copy model name')} />
              </div>
              {props.model.supported_endpoint_types?.length ? (
                <dl className="details-list">
                  {props.model.supported_endpoint_types.map((endpoint) => (
                    <div key={endpoint}>
                      <dt>{endpoint}</dt>
                      <dd>
                        <code>
                          {catalog.endpoints[endpoint]?.method}{' '}
                          {catalog.endpoints[endpoint]?.path || t('Endpoint path not provided')}
                        </code>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{t('No endpoint information has been provided.')}</p>
              )}
              <p className="muted">
                {t(
                  'Descriptions, tags and endpoints come from the model catalog. Endpoints alone do not confirm vision, tools or context limits.',
                )}
              </p>
            </details>
          </div>
        )}
        {view === 'groups' && (
          <section className="model-group-comparison" aria-label={t('Compare service groups')}>
            <p className="muted">
              {t(
                'Compare this model across service groups. Prices include each group’s multiplier; the billing unit is shown beside each price.',
              )}
            </p>
            <div className="model-comparison-unit">
              <strong>{t('Current prices')}</strong>
              <span>{t('Current unit prices include the service plan multiplier.')}</span>
            </div>
            <div className="model-group-header" aria-hidden>
              <span>{t('Service plan')}</span>
              <span>{t('Current prices')}</span>
              <span>{t('Last 24 hours')}</span>
              <span />
            </div>
            {groups.map((group) => {
              const sample = metrics.error
                ? undefined
                : metrics.data?.groups?.find((item) => item.group === group.id)
              let sampleStatus = t('No recent samples')
              if (metrics.isPending) sampleStatus = t('Loading performance…')
              else if (metrics.error) sampleStatus = t('Performance unavailable')
              else if (typeof sample?.request_count === 'number')
                sampleStatus = t('{{samples}} recorded requests', {
                  samples: formatNumber(sample.request_count, locale),
                })
              else if (sample) sampleStatus = t('Sample count not recorded')
              let groupPrice = (
                <ModelPriceSummary
                  model={props.model.model_name}
                  group={group.id}
                  enabled={group.allowed}
                  showExample
                />
              )
              if (group.pending) groupPrice = <p className="muted">{t('Checking model access…')}</p>
              else if (group.error)
                groupPrice = (
                  <div role="alert">
                    <span>{t('Could not verify model access.')}</span>
                    <Button variant="ghost" onClick={() => void group.retry()}>
                      {t('Try again')}
                    </Button>
                  </div>
                )
              return (
                <article
                  key={group.id}
                  className={`model-group-row ${group.id === catalog.group ? 'selected' : ''}`}
                  aria-label={group.id}
                >
                  <div className="model-group-name">
                    <strong>{group.id}</strong>
                    <span>{group.desc}</span>
                    <small>
                      {group.ratio === 'auto' ? t('Automatic routing') : `${group.ratio}×`}
                    </small>
                  </div>
                  {groupPrice}
                  <div className="model-comparison-performance">
                    {group.allowed && group.id !== 'auto' ? (
                      <>
                        <PerformanceValues sample={sample} />
                        <small className="muted">{sampleStatus}</small>
                      </>
                    ) : (
                      <p className="muted">
                        {group.id === 'auto'
                          ? t('View performance by the actual serving group.')
                          : t('Performance is shown after model access is confirmed.')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={group.id === catalog.group ? 'secondary' : 'primary'}
                    disabled={!group.allowed || group.pending || Boolean(group.error)}
                    aria-pressed={group.id === catalog.group}
                    onClick={() => props.onGroupChange(group.id)}
                  >
                    {group.id === catalog.group ? (
                      <>
                        <Check size={14} />
                        {t('Selected')}
                      </>
                    ) : (
                      t('Use this group')
                    )}
                  </Button>
                </article>
              )
            })}
            <p className="muted">
              {t(
                'Request success rate is not time-based uptime. No samples means unknown, not offline. Open performance trends for definitions and sample times.',
              )}
            </p>
            <details className="model-detailed-pricing">
              <summary>{t('Usage estimate and billing details')}</summary>
              {selected?.allowed ? (
                <ModelPrice
                  key={`${props.model.model_name}:${catalog.group}`}
                  model={props.model.model_name}
                  group={catalog.group}
                />
              ) : (
                <p className="muted">
                  {t('Select a group that supports this model to view its price.')}
                </p>
              )}
              {props.model.billing_expr && (
                <details>
                  <summary>{t('Advanced pricing rules')}</summary>
                  <pre className="code-block">{props.model.billing_expr}</pre>
                </details>
              )}
            </details>
          </section>
        )}
        {view === 'performance' &&
          (selected?.allowed ? (
            <ModelHealth
              key={`${props.model.model_name}:${catalog.group}`}
              model={props.model.model_name}
              group={catalog.group}
              expanded
            />
          ) : (
            <p className="muted">{t('Performance is shown after model access is confirmed.')}</p>
          ))}
      </div>
      <div className="model-details-actions">
        <span className="model-details-action-context">
          {t('Service plan')}: <strong>{catalog.group || '—'}</strong>
        </span>
        {selected?.allowed ? (
          <div className="row">
            {supportsKind(props.model, 'chat') && (
              <Link
                className="button button-primary"
                to="/chat"
                search={{ group: catalog.group, model: props.model.model_name }}
              >
                <MessageCircle size={16} />
                {t('Start a conversation')}
              </Link>
            )}
            {supportsKind(props.model, 'image') && (
              <Link
                className="button button-primary"
                to="/studio"
                search={{ group: catalog.group, model: props.model.model_name }}
              >
                <ImagePlus size={16} />
                {t('Create an image')}
              </Link>
            )}
            <Link
              className="button button-secondary"
              to="/keys"
              search={{ group: catalog.group, model: props.model.model_name }}
            >
              <KeyRound size={16} />
              {t('Get your API key')}
            </Link>
          </div>
        ) : (
          <span className="muted">{t('Choose an available group above to continue.')}</span>
        )}
      </div>
    </div>
  )
}
