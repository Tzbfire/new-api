import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, Card, CopyButton, ErrorState, Field, Input, LoadingState } from '@/components/ui'
import { jsonBody, request } from '@/lib/api'
import { useStatus } from '@/lib/status'
import { Turnstile } from './turnstile'
import './auth-account.css'

export default function PasswordResetPage() {
  const { t } = useTranslation()
  const status = useStatus()
  const [turnstile, setTurnstile] = useState('')
  const [captchaVersion, setCaptchaVersion] = useState(0)
  const [flow, setFlow] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return { email: params.get('email') ?? '', token: params.get('token') ?? '' }
  })
  const [newPassword, setNewPassword] = useState('')
  useEffect(() => {
    if (flow.token) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [flow.token])
  const reset = useMutation({
    retry: false,
    mutationFn: async (form: HTMLFormElement) => {
      if (flow.token) {
        const password = await request<string>('/api/user/reset', {
          method: 'POST',
          ...jsonBody(flow),
        })
        setNewPassword(password)
        setFlow({ email: '', token: '' })
      } else {
        const email = String(new FormData(form).get('email') ?? '')
        await request(
          `/api/reset_password?callback_target=consumer&email=${encodeURIComponent(email)}&turnstile=${encodeURIComponent(turnstile)}`,
        )
      }
    },
    onSettled: () => {
      setTurnstile('')
      setCaptchaVersion((value) => value + 1)
    },
  })
  if (status.isPending) return <LoadingState />
  if (status.error)
    return (
      <ErrorState
        error={status.error}
        retry={() => {
          void status.refetch()
        }}
      />
    )
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reset.isPending) reset.mutate(event.currentTarget)
  }
  return (
    <div className="auth-page">
      <Card className="auth-card stack">
        <h1>{t('Find your way back')}</h1>
        <p className="muted">{t('Recover access using the email linked to your account.')}</p>
        {newPassword ? (
          <div className="stack">
            <p>
              {t(
                'Your password has been reset. Save this password, then sign in and change it in account settings.',
              )}
            </p>
            <code className="secret-value">{newPassword}</code>
            <CopyButton value={newPassword} label={t('Copy password')} />
          </div>
        ) : reset.isSuccess ? (
          <p role="status">
            {t('If an account uses that email, you will receive a recovery link shortly.')}
          </p>
        ) : (
          <form className="stack" onSubmit={submit}>
            {flow.token ? (
              <p>
                {t('Continue to reset your password. Your existing sessions will be signed out.')}
              </p>
            ) : (
              <>
                <Field label={t('Email')}>
                  <Input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={reset.isPending}
                  />
                </Field>
                {status.data?.turnstile_check === true && (
                  <Turnstile
                    key={captchaVersion}
                    siteKey={String(status.data.turnstile_site_key ?? '')}
                    onToken={setTurnstile}
                  />
                )}
              </>
            )}
            {reset.error && <ErrorState error={reset.error} />}
            <Button
              type="submit"
              busy={reset.isPending}
              disabled={!flow.token && status.data?.turnstile_check === true && !turnstile}
            >
              {flow.token ? t('Reset password') : t('Send recovery link')}
            </Button>
          </form>
        )}
        <Link to="/login" className="text-link">
          {t('Back to sign in')}
        </Link>
      </Card>
    </div>
  )
}
