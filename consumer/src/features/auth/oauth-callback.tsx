import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui'
import './auth-account.css'

export default function OAuthCallbackPage() {
  const { t } = useTranslation()
  const [sent, setSent] = useState(false)
  useEffect(() => {
    const provider = window.location.pathname.split('/').at(-1) || ''
    const params = new URLSearchParams(window.location.search)
    const state = params.get('state') || ''
    const code = params.get('code') || undefined
    const error = params.get('error') || undefined
    window.history.replaceState(window.history.state, '', window.location.pathname)
    if (!window.opener || !state || !/^[A-Za-z0-9_-]+$/.test(provider) || (!code && !error)) return
    window.opener.postMessage(
      { kind: 'new-api-consumer-oauth', provider, state, code, error },
      window.location.origin,
    )
    setSent(true)
    // 发起页消费 API flow 后关闭此窗口；此处不先关闭，以免产生取消竞态。
  }, [])
  return (
    <div className="auth-page">
      <Card className="auth-card stack">
        <h1>
          {sent ? t('Return to your sign-in window') : t('This sign-in link is no longer valid')}
        </h1>
        <p className="muted">
          {sent
            ? t('Your authorization has been received. You can return to the original window.')
            : t('Start sign-in again from this website. Do not share authorization links.')}
        </p>
        {!sent && (
          <Link to="/login" className="text-link">
            {t('Back to sign in')}
          </Link>
        )}
      </Card>
    </div>
  )
}
