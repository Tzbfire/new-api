import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorState } from '@/components/ui'
import { useSession } from '@/lib/session'
import { paymentReturnSearch } from './payment-return'

export function PaymentReturnStatus() {
  const { t } = useTranslation()
  const location = useLocation()
  const session = useSession()
  const cache = useQueryClient()
  const { pay } = paymentReturnSearch(location.search)
  const refresh = useMutation({
    mutationFn: async () => {
      await Promise.all([
        session.refreshUser(),
        cache.invalidateQueries({ queryKey: ['topup-orders'] }),
        cache.invalidateQueries({ queryKey: ['subscriptions'] }),
      ])
    },
  })
  if (!pay) return null
  return (
    <Card className="stack">
      <p role="status">
        {pay === 'fail'
          ? t('The payment return reported a failure. Check your orders before trying again.')
          : t('Your payment result is being checked. Order records determine the final status.')}
      </p>
      <p className="muted">
        {t('A payment redirect does not confirm that your balance has been credited.')}
      </p>
      <div className="row">
        <Button variant="secondary" busy={refresh.isPending} onClick={() => refresh.mutate()}>
          {t('Refresh')}
        </Button>
        {location.pathname !== '/orders' && (
          <Link to="/orders" search={{ pay }} className="button button-secondary">
            {t('View orders')}
          </Link>
        )}
      </div>
      {refresh.error && <ErrorState error={refresh.error} />}
    </Card>
  )
}
