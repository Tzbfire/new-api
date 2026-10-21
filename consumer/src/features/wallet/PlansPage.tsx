import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Select,
} from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { CatalogProvider, useCatalog } from '@/lib/catalog'
import { ModelPriceList } from '@/components/model-price-list'
import { request } from '@/lib/api'
import { formatDate, formatMoney, formatBalance } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { CheckoutDialog } from './CheckoutDialog'
import { PaymentMethods } from './PaymentMethods'
import { ActivePlanSummary } from './ActivePlanSummary'
import {
  createCheckout,
  enabledMethods,
  getPlans,
  getSubscriptions,
  getTopupInfo,
  type Checkout,
  type SubscriptionPlan,
} from './api'
import './wallet.css'

export default function PlansPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const cache = useQueryClient()
  const session = useSession()
  const site = useStatus()
  const plans = useQuery({ queryKey: ['plans'], queryFn: getPlans })
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const info = useQuery({ queryKey: ['topup-info'], queryFn: getTopupInfo })
  const activeIDs = new Set(
    subscriptions.data?.subscriptions.map(({ subscription }) => subscription.id),
  )
  const history =
    subscriptions.data?.all_subscriptions.filter(
      ({ subscription }) => !activeIDs.has(subscription.id),
    ) || []
  const [viewGroup, setViewGroup] = useState('')
  const [selected, setSelected] = useState<SubscriptionPlan | null>(null)
  const [method, setMethod] = useState('')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [notice, setNotice] = useState('')
  const refresh = async () => {
    await Promise.all([
      session.refreshUser(),
      cache.invalidateQueries({ queryKey: ['subscriptions'] }),
      cache.invalidateQueries({ queryKey: ['topup-orders'] }),
    ])
    setCheckout(null)
  }
  const preference = useMutation({
    mutationFn: (billing_preference: string) =>
      request('/api/subscription/self/preference', {
        method: 'PUT',
        body: JSON.stringify({ billing_preference }),
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['subscriptions'] }),
  })
  const paymentMethods =
    selected && info.data
      ? enabledMethods(info.data).filter((item) => {
          if (item.type === 'stripe') return !!selected.stripe_price_id
          if (item.type === 'waffo_pancake') return !!selected.waffo_pancake_product_id
          return item.type !== 'waffo' && item.type !== 'creem'
        })
      : []
  if (selected?.creem_product_id && info.data?.enable_creem_topup)
    paymentMethods.push({ type: 'creem', name: 'Creem' })
  if (selected?.allow_balance_pay !== false && selected)
    paymentMethods.unshift({ type: 'balance', name: t('Wallet balance') })
  const activeMethod = paymentMethods.some((item) => item.type === method)
    ? method
    : paymentMethods[0]?.type || ''
  const buy = useMutation({
    mutationFn: async () => {
      if (!selected || !activeMethod) throw new Error('Choose a payment method.')
      if (activeMethod === 'balance') {
        await request('/api/subscription/balance/pay', {
          method: 'POST',
          body: JSON.stringify({ plan_id: selected.id }),
        })
        setSelected(null)
        // The purchase already succeeded. A failed follow-up read must not
        // leave a purchase confirmation open and invite a second debit.
        setNotice('Your plan was purchased. Refresh your balance to see the latest amount.')
        try {
          await refresh()
          setNotice('Your plan is active. Your balance has been updated.')
        } catch {
          /* The purchase receipt remains authoritative; refreshing is safe to retry. */
        }
        return
      }
      let provider = 'epay'
      if (['stripe', 'creem'].includes(activeMethod)) provider = activeMethod
      if (activeMethod === 'waffo_pancake') provider = 'waffo-pancake'
      const result = await createCheckout(`/api/subscription/${provider}/pay`, {
        plan_id: selected.id,
        payment_method: activeMethod,
      })
      setSelected(null)
      setCheckout(result)
    },
  })
  return (
    <div className="page-stack page-compact plans-page">
      <PageHeader
        compact
        title={t('Plans')}
        description={t('Your current allowance comes first. Choose a plan when you need more.')}
        actions={
          subscriptions.data && (
            <div className="plans-preference">
              <Field
                label={t('Billing preference')}
                hint={t('The server applies your plan restrictions and available balance.')}
              >
                <Select
                  value={subscriptions.data.billing_preference}
                  disabled={preference.isPending}
                  onValueChange={(value) => preference.mutate(value)}
                  options={[
                    { value: 'subscription_first', label: t('Use plan first, then wallet') },
                    { value: 'wallet_first', label: t('Use wallet first, then plan') },
                    { value: 'subscription_only', label: t('Use plan only') },
                    { value: 'wallet_only', label: t('Use wallet only') },
                  ]}
                />
              </Field>
            </div>
          )
        }
      />
      {notice && <p role="status">{t(notice)}</p>}
      <ActivePlanSummary />
      {preference.error && <ErrorState error={preference.error} />}
      <h2>{t('Available plans')}</h2>
      {plans.isPending && <LoadingState />}
      {plans.error && <ErrorState error={plans.error} retry={() => void plans.refetch()} />}
      {plans.data?.length === 0 && (
        <EmptyState
          title={t('No plans available yet')}
          description={t('You can continue using your wallet balance.')}
        />
      )}
      <div className="card-grid plans-catalog">
        {plans.data?.map(({ plan }) => (
          <Card key={plan.id} className="plan-card">
            <div>
              <Badge>{plan.title}</Badge>
              <p className="plan-description muted">{plan.subtitle}</p>
            </div>
            <div>
              <strong className="plan-price">
                {formatMoney(plan.price_amount, plan.currency || 'USD', locale)}
              </strong>
              <p className="muted">
                {plan.duration_unit === 'custom'
                  ? t('{{count}} seconds', { count: plan.custom_seconds })
                  : t('{{count}} {{unit}}', {
                      count: plan.duration_value,
                      unit: t(plan.duration_unit),
                    })}
              </p>
            </div>
            <ul className="plan-details">
              <li>
                <Check size={17} />
                <span>
                  {plan.total_amount === 0
                    ? t('Unlimited allowance')
                    : formatBalance(plan.total_amount, site.data, locale)}
                </span>
              </li>
              <li>
                <Check size={17} />
                <span>
                  {t('Allowance reset')}: {t(plan.quota_reset_period)}
                </span>
              </li>
              <li>
                <Check size={17} />
                <span>
                  {t('Service groups')}:{' '}
                  {plan.allowed_token_groups
                    ? plan.allowed_token_groups
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                        .map((group) => (
                          <Button key={group} variant="ghost" onClick={() => setViewGroup(group)}>
                            {group}
                          </Button>
                        ))
                    : t('All available groups')}
                </span>
              </li>
              <li>
                <Check size={17} />
                <span>
                  {t(
                    plan.allow_wallet_overflow
                      ? 'Wallet pays when allowance runs out'
                      : 'Requests stop when allowance runs out',
                  )}
                </span>
              </li>
              {plan.upgrade_group && (
                <li>
                  <Check size={17} />
                  <span>
                    {t('Account group after purchase')}: {plan.upgrade_group}
                  </span>
                </li>
              )}
            </ul>
            <Button
              onClick={() => {
                setSelected(plan)
                setMethod('')
                buy.reset()
              }}
            >
              {t('Choose plan')}
            </Button>
          </Card>
        ))}
      </div>

      {!!history.length && (
        <details className="stack">
          <summary>{t('Your plan history')}</summary>
          {history.map(({ subscription }) => (
            <Card key={subscription.id}>
              <div className="row">
                <strong>
                  {plans.data?.find(({ plan }) => plan.id === subscription.plan_id)?.plan.title ||
                    t('Plan #{{id}}', { id: subscription.plan_id })}
                </strong>
                <Badge>{t(subscription.status)}</Badge>
              </div>
              <p className="muted">
                {formatDate(subscription.start_time, locale)} —{' '}
                {formatDate(subscription.end_time, locale)}
              </p>
              <p>
                {t('Remaining allowance')}:{' '}
                {subscription.amount_total === 0
                  ? t('Unlimited allowance')
                  : formatBalance(
                      Math.max(0, subscription.amount_total - subscription.amount_used),
                      site.data,
                      locale,
                    )}
              </p>
              {subscription.next_reset_time > 0 && (
                <p className="muted">
                  {t('Next reset')}: {formatDate(subscription.next_reset_time, locale)}
                </p>
              )}
            </Card>
          ))}
        </details>
      )}
      <Modal
        open={!!selected}
        onClose={() => {
          if (!buy.isPending) setSelected(null)
        }}
        title={t('Confirm your plan')}
        description={
          selected
            ? `${selected.title} · ${formatMoney(selected.price_amount, selected.currency || 'USD', locale)}`
            : undefined
        }
      >
        <div className="stack">
          {info.isPending && <LoadingState />}
          {info.error && <ErrorState error={info.error} retry={() => void info.refetch()} />}
          <PaymentMethods
            label={t('Payment method')}
            methods={paymentMethods}
            value={activeMethod}
            onChange={setMethod}
            disabled={buy.isPending}
          />
          {activeMethod === 'balance' && (
            <p className="muted">
              {t('The plan price will be deducted from your wallet immediately.')}
            </p>
          )}
          {buy.error && <ErrorState error={buy.error} />}
          <Button
            busy={buy.isPending}
            disabled={!activeMethod || info.isPending}
            onClick={() => buy.mutate()}
          >
            {t('Confirm purchase')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!viewGroup}
        onClose={() => setViewGroup('')}
        title={t('Models and pricing')}
        description={viewGroup}
        className="model-prices-modal"
      >
        {viewGroup && (
          <CatalogProvider scope="plan-models" intent={{ key: viewGroup, group: viewGroup }}>
            <PlanGroupModels group={viewGroup} />
          </CatalogProvider>
        )}
      </Modal>
      <CheckoutDialog
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onRefresh={() => {
          void refresh().catch(() => setNotice('Could not refresh your balance. Please try again.'))
        }}
      />
    </div>
  )
}

function PlanGroupModels(props: { group: string }) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  if (catalog.isPending) return <LoadingState />
  if (catalog.error) return <ErrorState error={catalog.error} retry={catalog.refetch} />
  if (catalog.group !== props.group || !catalog.models.length)
    return (
      <EmptyState
        title={t('No models available for this group')}
        description={t('Only models authorized for your account are shown.')}
      />
    )
  return <ModelPriceList models={catalog.models} group={props.group} />
}
