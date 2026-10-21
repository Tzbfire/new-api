import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@/components/ui'
import type { Checkout } from './api'

export function CheckoutDialog(props: {
  checkout: Checkout | null
  onClose: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open={!!props.checkout}
      onClose={props.onClose}
      title={t('Your checkout is ready')}
      description={t(
        'Complete payment with the provider, then return here to refresh your balance.',
      )}
    >
      {props.checkout && (
        <div className="stack">
          {props.checkout.fields ? (
            <form
              action={props.checkout.url}
              method="POST"
              target="_blank"
              rel="noopener noreferrer"
            >
              {Object.entries(props.checkout.fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit">{t('Open secure checkout')}</Button>
            </form>
          ) : (
            <a
              className="button button-primary"
              href={props.checkout.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Open secure checkout')}
            </a>
          )}
          <p className="muted">
            {t(
              'Payment is confirmed only after the provider notifies the server. A successful redirect alone does not confirm payment.',
            )}
          </p>
          <Button variant="secondary" onClick={props.onRefresh}>
            {t('I have paid · Refresh')}
          </Button>
        </div>
      )}
    </Modal>
  )
}
