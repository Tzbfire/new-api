import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingState } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatNumber, formatBalance } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { getPlans, getSubscriptions } from './api'
import './active-plan-summary.css'

/** Each entitlement keeps its own balance and reset cycle; never sums separate plans. */
export function ActivePlanSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const plans = useQuery({ queryKey: ['plans'], queryFn: getPlans })
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
                  {subscription.allowed_token_groups || t('All available groups')}
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
    </section>
  )
}
