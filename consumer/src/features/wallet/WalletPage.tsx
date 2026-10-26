import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CreditCard, Layers, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorState, Field, Input, LoadingState, PageHeader } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { ApiError, request } from '@/lib/api'
import { formatMoney, formatNumber, formatBalance } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { CheckoutDialog } from './CheckoutDialog'
import { PaymentMethods } from './PaymentMethods'
import {
  createCheckout,
  creemProducts,
  enabledMethods,
  getSubscriptions,
  getTopupInfo,
  quoteEndpoint,
  topupEndpoint,
  type Checkout,
} from './api'
import './wallet.css'
import { PaymentReturnStatus } from './PaymentReturnStatus'
import { CheckinButton } from '@/features/checkin'

export default function WalletPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const session = useSession()
  const site = useStatus()
  const cache = useQueryClient()
  const info = useQuery({ queryKey: ['topup-info'], queryFn: getTopupInfo })
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const [methodChoice, setMethod] = useState('')
  const [waffoMethod, setWaffoMethod] = useState('')
  const [amount, setAmount] = useState('10')
  const [quoteAmount, setQuoteAmount] = useState(10)
  const [code, setCode] = useState('')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [notice, setNotice] = useState('')
  const methods = info.data
    ? enabledMethods(info.data).filter((method) => method.type !== 'creem')
    : []
  const method = methods.some((item) => item.type === methodChoice)
    ? methodChoice
    : methods[0]?.type || ''
  const paymentCurrency = info.data?.payment_currencies?.[method]
  const numericAmount = Number(amount)
  const provider = ['stripe', 'waffo', 'waffo_pancake'].includes(method) ? method : 'epay'
  const minimum = info.data?.request_min_topup?.[provider] || 1
  const validAmount = Number.isSafeInteger(numericAmount) && numericAmount >= minimum
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuoteAmount(numericAmount), 300)
    return () => window.clearTimeout(timeout)
  }, [numericAmount])
  const inputSettled = Object.is(quoteAmount, numericAmount)
  const quote = useQuery({
    queryKey: ['topup-quote', session.user?.id, session.sessionId, method, quoteAmount],
    queryFn: ({ signal }) =>
      request<string>(quoteEndpoint(method), {
        method: 'POST',
        body: JSON.stringify({ amount: quoteAmount }),
        signal,
      }),
    enabled: !!method && validAmount && inputSettled,
    retry: false,
    staleTime: 30_000,
  })
  const quoteUpdating = validAmount && (!inputSettled || quote.isFetching)
  const quoteVisible = validAmount && inputSettled && quote.isSuccess && !!quote.data
  const quoteReady = quoteVisible && !quote.isFetching
  let displayedQuote = '—'
  if (quoteVisible) {
    displayedQuote =
      paymentCurrency && /^[A-Z]{3}$/.test(paymentCurrency)
        ? formatMoney(Number(quote.data), paymentCurrency, locale)
        : `${quote.data} · ${t('Payment currency not provided by the server')}`
  }
  const creatingOrder = useRef(false)
  const checkoutWindow = useRef<Window | null>(null)
  const pay = useMutation({
    retry: false,
    mutationFn: async (payload?: { product_id: string }) => {
      if (creatingOrder.current) throw new Error('A checkout is already being created.')
      creatingOrder.current = true
      try {
        return await createCheckout(
          topupEndpoint(payload ? 'creem' : method),
          payload
            ? { ...payload, payment_method: 'creem' }
            : {
                amount: numericAmount,
                payment_method: method,
                ...(method === 'waffo' && waffoMethod !== ''
                  ? { pay_method_index: Number(waffoMethod) }
                  : {}),
              },
        )
      } finally {
        creatingOrder.current = false
      }
    },
    onSuccess: (result) => {
      setCheckout(result)
      const target = checkoutWindow.current
      checkoutWindow.current = null
      if (!target || target.closed) return
      // The window was reserved by the confirmation click, before the async POST.
      // A blocked/closed window leaves the existing checkout available in the dialog.
      try {
        if (result.fields) {
          const form = target.document.createElement('form')
          form.action = result.url
          form.method = 'POST'
          form.target = '_self'
          form.hidden = true
          for (const [name, value] of Object.entries(result.fields)) {
            const input = target.document.createElement('input')
            input.type = 'hidden'
            input.name = name
            input.value = value
            form.appendChild(input)
          }
          target.document.body.appendChild(form)
          form.submit()
          form.remove()
        } else {
          target.location.replace(result.url)
        }
      } catch {
        target.close()
      }
    },
    onError: () => {
      checkoutWindow.current?.close()
      checkoutWindow.current = null
    },
  })
  function confirmCheckout(payload?: { product_id: string }) {
    if (creatingOrder.current || pay.isPending || checkout) return
    // Reserve synchronously so popup blockers can associate it with the user gesture.
    // Null opener prevents provider content from navigating the consumer app.
    const target = window.open('', `new-api-checkout-${crypto.randomUUID()}`)
    if (target) target.opener = null
    checkoutWindow.current = target
    pay.mutate(payload)
  }
  const redeem = useMutation({
    mutationFn: () =>
      request<number>('/api/user/topup', {
        method: 'POST',
        body: JSON.stringify({ key: code.trim() }),
      }),
    onSuccess: async () => {
      setCode('')
      setNotice('Your code was redeemed. Refresh your balance to see the latest amount.')
      // Redemption has already succeeded; a failed read must not present it
      // as a failed write or invite the user to submit the code again.
      const results = await Promise.allSettled([
        session.refreshUser(),
        cache.invalidateQueries({ queryKey: ['topup-orders'] }),
      ])
      if (results[0].status === 'fulfilled')
        setNotice('Your code was redeemed. Your balance is updated.')
    },
  })
  const refresh = useMutation({
    mutationFn: async () => {
      await Promise.all([
        session.refreshUser(),
        cache.invalidateQueries({ queryKey: ['topup-orders'] }),
        cache.invalidateQueries({ queryKey: ['subscriptions'] }),
      ])
      setNotice('Your balance and orders have been refreshed.')
      setCheckout(null)
    },
  })
  const products = creemProducts(info.data)
  let planStatus = t('Checking plan status…')
  if (subscriptions.isError) planStatus = t('Plan status unavailable')
  else if (subscriptions.data) {
    planStatus = subscriptions.data.subscriptions.length
      ? t('Active plans: {{count}}', { count: subscriptions.data.subscriptions.length })
      : t('No active plan')
  }
  return (
    <div className="page-stack">
      <PaymentReturnStatus />
      <PageHeader
        eyebrow={t('YOUR EVERYDAY AI')}
        title={t('Wallet')}
        description={t('A clear view of your balance. More room for your next idea.')}
        actions={
          <div className="row">
            <Button variant="secondary" busy={refresh.isPending} onClick={() => refresh.mutate()}>
              {t('Refresh')}
            </Button>
            <Link to="/orders" className="button button-secondary">
              {t('View orders')}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        }
      />
      <Card className="wallet-overview">
        <div className="wallet-overview-main">
          <div className="wallet-balance">
            <span className="row">
              <Wallet size={19} aria-hidden />
              {t('Wallet balance')}
              <CheckinButton />
            </span>
            <strong className="balance-number">
              {formatBalance(session.user?.quota || 0, site.data, locale)}
            </strong>
            <span className="muted">
              {t('Pay for what you use. Your balance stays in your account.')}
            </span>
          </div>
          <div className="wallet-usage-summary">
            <span>{t('TOTAL USAGE')}</span>
            <strong>{formatBalance(session.user?.used_quota || 0, site.data, locale)}</strong>
            <Link to="/usage" className="text-link">
              {t('Explore usage')}
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
        <Link to="/plans" className="wallet-plan-link">
          <span className="row">
            <Layers size={16} aria-hidden />
            {planStatus}
          </span>
          <span className="row">
            {t('Manage plans')}
            <ArrowUpRight size={14} aria-hidden />
          </span>
        </Link>
      </Card>
      {notice && <p role="status">{t(notice)}</p>}
      {refresh.error && <ErrorState error={refresh.error} />}
      {info.isPending && <LoadingState />}
      {info.isError && <ErrorState error={info.error} retry={() => void info.refetch()} />}
      {info.data && (
        <div className="wallet-columns">
          <Card className="stack">
            <div className="row">
              <CreditCard size={20} />
              <h2>{t('Add balance')}</h2>
            </div>
            {!methods.length && !products.length && (
              <p className="muted">{t('Online payments are not available right now.')}</p>
            )}
            {!!methods.length && (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (quoteReady && !pay.isPending && !checkout && !creatingOrder.current)
                    confirmCheckout()
                }}
              >
                <Field
                  label={
                    info.data.request_amount_unit === 'TOKENS'
                      ? t('Recharge quota units')
                      : t('Recharge amount')
                  }
                  hint={t(
                    'The server applies your account discount and calculates the payment amount.',
                  )}
                >
                  <Input
                    type="number"
                    disabled={pay.isPending || !!checkout}
                    min={minimum}
                    step="1"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value)
                      setCheckout(null)
                    }}
                    required
                  />
                </Field>
                <p className="muted">
                  {t('Minimum recharge: {{amount}}', {
                    amount: formatNumber(minimum, locale),
                  })}
                </p>
                <div className="row preset-row">
                  {info.data.amount_options
                    ?.filter((value) => Number.isSafeInteger(value) && value >= minimum)
                    .slice(0, 6)
                    .map((value) => (
                      <Button
                        key={value}
                        variant={Number(amount) === value ? 'primary' : 'secondary'}
                        aria-pressed={numericAmount === value}
                        disabled={pay.isPending || !!checkout}
                        onClick={() => {
                          setAmount(String(value))
                          setQuoteAmount(value)
                          setCheckout(null)
                          pay.reset()
                        }}
                      >
                        {formatNumber(value, locale)}
                      </Button>
                    ))}
                </div>
                <PaymentMethods
                  label={t('Payment method')}
                  methods={methods}
                  value={method}
                  disabled={pay.isPending || !!checkout}
                  onChange={(value) => {
                    setMethod(value)
                    setCheckout(null)
                    pay.reset()
                  }}
                />
                {method === 'waffo' && !!info.data.waffo_pay_methods?.length && (
                  <PaymentMethods
                    label={t('Waffo payment option')}
                    methods={[
                      { type: '', name: t('Let the payment provider choose') },
                      ...info.data.waffo_pay_methods.map((item, index) => ({
                        type: String(index),
                        name: item.name,
                      })),
                    ]}
                    value={waffoMethod}
                    disabled={pay.isPending || !!checkout}
                    onChange={setWaffoMethod}
                  />
                )}
                <section
                  className="quote-total"
                  aria-label={t('Quoted payment amount')}
                  aria-busy={quoteUpdating}
                >
                  <span>{t('Quoted payment amount')}</span>
                  <strong>{displayedQuote}</strong>
                  <div className="query-status quote-status" role="status">
                    {quoteUpdating && t('Calculating your price…')}
                    {!validAmount &&
                      t('Minimum recharge: {{amount}}', { amount: formatNumber(minimum, locale) })}
                    {inputSettled && validAmount && quote.error && (
                      <>
                        <span>
                          {t(
                            quote.error.message,
                            quote.error instanceof ApiError ? quote.error.params : undefined,
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() => void quote.refetch()}
                          busy={quote.isFetching}
                        >
                          {t('Try again')}
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="quote-request">
                    <span>{t('Balance increase')}</span>
                    <span>
                      {validAmount ? formatNumber(numericAmount, locale) : '—'}{' '}
                      {info.data.request_amount_unit || ''}
                    </span>
                  </div>
                  <small>
                    {t(
                      'The server quote shows the payment amount. Your wallet receives the recharge amount shown above after payment is confirmed.',
                    )}
                  </small>
                </section>
                <Button type="submit" busy={pay.isPending} disabled={!quoteReady || !!checkout}>
                  {t('Confirm and continue to payment')}
                </Button>
              </form>
            )}
            {products.map((product) => (
              <div className="product-option" key={product.productId}>
                <div>
                  <strong>{product.name}</strong>
                  <p className="muted">{formatMoney(product.price, product.currency, locale)}</p>
                  <p className="muted">
                    {t('Balance increase')}: {formatBalance(product.quota, site.data, locale)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!!checkout}
                  busy={pay.isPending}
                  onClick={() => confirmCheckout({ product_id: product.productId })}
                >
                  {t('Confirm and continue to payment')}
                </Button>
              </div>
            ))}
            {pay.error && <ErrorState error={pay.error} />}
          </Card>
          <div className="stack">
            {info.data.enable_redemption && (
              <Card>
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (code.trim()) redeem.mutate()
                  }}
                >
                  <h2>{t('Have a gift code?')}</h2>
                  <Field label={t('Redemption code')}>
                    <Input
                      autoComplete="off"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      required
                    />
                  </Field>
                  <Button type="submit" variant="secondary" busy={redeem.isPending}>
                    {t('Redeem code')}
                  </Button>
                  {redeem.error && <ErrorState error={redeem.error} />}
                </form>
              </Card>
            )}
          </div>
        </div>
      )}
      <CheckoutDialog
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onRefresh={() => refresh.mutate()}
      />
    </div>
  )
}
