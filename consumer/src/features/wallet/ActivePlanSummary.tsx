import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingState } from '@/components/ui'
import { CatalogProvider, useCatalog } from '@/lib/catalog'
import { ServiceGroupOptions } from '@/components/service-group-options'
import { ServiceGroupModelsDialog } from '@/components/service-group-models-dialog'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatNumber, formatBalance } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { getPlans, getSubscriptions } from './api'
import { PlanGroupLinks } from './PlanGroupLinks'
import './active-plan-summary.css'

/** Each entitlement keeps its own balance and reset cycle; never sums separate plans. */
export function ActivePlanSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const plans = useQuery({ queryKey: ['plans'], queryFn: getPlans })
  const [preview, setPreview] = useState<{ group: string; title: string } | null>(null)
  return (
    <section className="active-plan-summary" aria-label={t('Your active plans')}>
      <h2>{t('Your active plans')}</h2>
      {subscriptions.isPending && <LoadingState />}
      {subscriptions.error && (
        <ErrorState error={subscriptions.error} retry={() => void subscriptions.refetch()} />
      )}
      {subscriptions.data?.subscriptions.length === 0 && (
        <p className="muted">
          {t('No active plan. Wallet balance and plan allowances are separate.')}
        </p>
      )}
      <div className="active-plan-list">
        {subscriptions.data?.subscriptions.map(({ subscription }) => {
          const remaining = Math.max(0, subscription.amount_total - subscription.amount_used)
          const unlimited = subscription.amount_total === 0
          const title = plans.data?.find(({ plan }) => plan.id === subscription.plan_id)?.plan.title
          const progress = unlimited
            ? 0
            : Math.min(100, Math.max(0, (remaining / subscription.amount_total) * 100))
          return (
            <section
              className="active-plan-item"
              key={subscription.id}
              aria-label={title || t('Plan #{{id}}', { id: subscription.plan_id })}
            >
              <div className="active-plan-heading">
                <h3>{title || t('Plan #{{id}}', { id: subscription.plan_id })}</h3>
                <span className="active-plan-status">{t('active')}</span>
              </div>
              <div className="active-plan-body">
                <div className="active-plan-balance">
                  <div className="active-plan-remaining">
                    <span>
                      {t(
                        subscription.next_reset_time > 0
                          ? 'Remaining allowance this cycle'
                          : 'Remaining plan allowance',
                      )}
                    </span>
                    <strong>
                      {unlimited
                        ? t('Unlimited allowance')
                        : formatBalance(remaining, site.data, locale)}
                    </strong>
                  </div>
                  {!unlimited && (
                    <div className="active-plan-progress">
                      <progress
                        max={100}
                        value={progress}
                        aria-label={t('Remaining plan allowance')}
                        aria-valuetext={t('{{percent}}% remaining', {
                          percent: formatNumber(progress, locale),
                        })}
                      />
                      <span>
                        {t('{{percent}}% remaining', { percent: formatNumber(progress, locale) })}
                      </span>
                    </div>
                  )}
                  <dl className="active-plan-usage">
                    <div>
                      <dt>{t('Used allowance')}</dt>
                      <dd>{formatBalance(subscription.amount_used, site.data, locale)}</dd>
                    </div>
                    <div>
                      <dt>
                        {t(
                          subscription.next_reset_time > 0
                            ? 'Total allowance this cycle'
                            : 'Total allowance',
                        )}
                      </dt>
                      <dd>
                        {unlimited
                          ? t('Unlimited allowance')
                          : formatBalance(subscription.amount_total, site.data, locale)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <dl className="active-plan-facts">
                  <div>
                    <dt>{t('Next reset')}</dt>
                    <dd>
                      {subscription.next_reset_time > 0
                        ? formatDate(subscription.next_reset_time, locale)
                        : t('No scheduled reset')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Expires')}</dt>
                    <dd>{formatDate(subscription.end_time, locale)}</dd>
                  </div>
                </dl>
              </div>
              <div className="active-plan-footer">
                <p className="muted active-plan-scope">
                  {t('Service groups')}:{' '}
                  <PlanGroupLinks
                    value={subscription.allowed_token_groups}
                    onSelect={(group) =>
                      setPreview({
                        group,
                        title: title || t('Plan #{{id}}', { id: subscription.plan_id }),
                      })
                    }
                  />
                </p>
                <p className="muted active-plan-scope">
                  {t(
                    subscription.allow_wallet_overflow
                      ? 'Wallet pays when allowance runs out'
                      : 'Requests stop when allowance runs out',
                  )}
                </p>
              </div>
            </section>
          )
        })}
      </div>
      {preview && (
        <CatalogProvider
          scope="active-plan-preview"
          intent={{ key: `${preview.title}:${preview.group}`, group: preview.group }}
        >
          <ActivePlanModels
            group={preview.group}
            title={preview.title}
            onClose={() => setPreview(null)}
          />
        </CatalogProvider>
      )}
    </section>
  )
}

function ActivePlanModels(props: { group: string; title: string; onClose: () => void }) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  return (
    <ServiceGroupModelsDialog
      group={props.group || catalog.group}
      description={`${props.title} · ${t('Only models authorized for your account are shown.')}`}
      onClose={props.onClose}
      groupPicker={
        !props.group ? (
          <ServiceGroupOptions
            label={t('Service groups')}
            groups={catalog.groups}
            value={catalog.group}
            onValueChange={catalog.setGroup}
          />
        ) : undefined
      }
    />
  )
}
