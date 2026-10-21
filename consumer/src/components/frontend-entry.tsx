import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/session'

// These links intentionally leave the SPA so the gateway can select the interface.
export function FrontendEntry(props: { workspace?: boolean }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const returnTo = props.workspace ? '/dashboard' : '/'
  return (
    <span className="row frontend-entry">
      <a
        className="button button-ghost frontend-version-switch"
        href={`/frontend/switch?version=legacy&return_to=${encodeURIComponent(returnTo)}`}
        aria-label={t('Switch to legacy')}
      >
        <span>{t('Switch to legacy')}</span>
      </a>
      {user && user.role >= 10 && (
        <a className="button button-ghost" href="/system-settings">
          {t('Administration')}
        </a>
      )}
    </span>
  )
}
