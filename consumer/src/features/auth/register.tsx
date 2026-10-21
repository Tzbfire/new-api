import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Checkbox, ErrorState, Field, Input, LoadingState } from '@/components/ui'
import { ApiError, jsonBody, request } from '@/lib/api'
import { useStatus } from '@/lib/status'
import { Turnstile } from './turnstile'
import { safeLoginDestination } from './login'
import { Brand } from '@/components/brand'
import './auth-account.css'

export default function RegisterPage() {
  const { t } = useTranslation()
  const status = useStatus()
  const next = safeLoginDestination(new URLSearchParams(window.location.search).get('next'))
  const [turnstile, setTurnstile] = useState('')
  const [captchaVersion, setCaptchaVersion] = useState(0)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [registered, setRegistered] = useState(false)
  const emailRequired = status.data?.email_verification === true
  const captchaRequired = status.data?.turnstile_check === true
  function resetCaptcha() {
    setTurnstile('')
    setCaptchaVersion((value) => value + 1)
  }
  const sendCode = useMutation({
    retry: false,
    mutationFn: () =>
      request(
        `/api/verification?email=${encodeURIComponent(email)}&turnstile=${encodeURIComponent(turnstile)}`,
      ),
    onSuccess: () => setSent(true),
    onSettled: resetCaptcha,
  })
  const register = useMutation({
    retry: false,
    mutationFn: async (form: HTMLFormElement) => {
      const data = new FormData(form)
      const password = String(data.get('password') ?? '')
      if (password !== data.get('confirm')) throw new ApiError('Passwords do not match')
      const aff = new URLSearchParams(window.location.search).get('aff')
      await request(`/api/user/register?turnstile=${encodeURIComponent(turnstile)}`, {
        method: 'POST',
        ...jsonBody({
          username: String(data.get('username') ?? '').trim(),
          password,
          ...(emailRequired ? { email, verification_code: data.get('code') } : {}),
          ...(aff && aff.length <= 32 ? { aff_code: aff } : {}),
        }),
      })
      form.reset()
    },
    onSuccess: () => setRegistered(true),
    onSettled: resetCaptcha,
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
  if (status.data?.register_enabled === false || status.data?.password_register_enabled === false)
    return (
      <Card className="auth-card stack">
        <h1>{t('Registration is currently closed')}</h1>
        <Link to="/login" search={{ next }}>
          {t('Back to sign in')}
        </Link>
      </Card>
    )
  if (registered)
    return (
      <Card className="auth-card stack">
        <CheckCircle2 size={32} aria-hidden="true" />
        <h1>{t('Your account is ready')}</h1>
        <p>{t('Sign in to start your first conversation.')}</p>
        <Link className="button primary" to="/login" search={{ next }}>
          {t('Sign in')}
        </Link>
      </Card>
    )
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!register.isPending) register.mutate(event.currentTarget)
  }
  const busy = register.isPending || sendCode.isPending
  return (
    <div className="auth-page">
      <Card className="auth-card stack">
        <Sparkles size={28} aria-hidden="true" />
        <div>
          <Brand />
          <h1>{t('Make room for your ideas')}</h1>
          <p className="muted">{t('One account for conversations, images, and more.')}</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <Field label={t('Username')}>
            <Input
              name="username"
              autoComplete="username"
              maxLength={20}
              required
              autoFocus
              disabled={busy}
            />
          </Field>
          <Field
            label={t('Password')}
            hint={t('Use a long, unique password you have not used elsewhere.')}
          >
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              disabled={busy}
            />
          </Field>
          <Field label={t('Confirm password')}>
            <Input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              disabled={busy}
            />
          </Field>
          {emailRequired && (
            <>
              <Field label={t('Email')}>
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setSent(false)
                  }}
                  required
                  maxLength={50}
                  disabled={busy}
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                busy={sendCode.isPending}
                disabled={busy || !email || (captchaRequired && !turnstile)}
                onClick={(event) => {
                  const input = event.currentTarget.form?.elements.namedItem('email')
                  if (input instanceof HTMLInputElement && input.reportValidity()) sendCode.mutate()
                }}
              >
                {sent ? t('Send another code') : t('Send verification code')}
              </Button>
              {sent && <p role="status">{t('Check your inbox for the verification code.')}</p>}
              <Field label={t('Email verification code')}>
                <Input name="code" autoComplete="one-time-code" required disabled={busy} />
              </Field>
            </>
          )}
          {captchaRequired && (
            <Turnstile
              key={captchaVersion}
              siteKey={String(status.data?.turnstile_site_key ?? '')}
              onToken={setTurnstile}
            />
          )}
          {(status.data?.user_agreement_enabled === true ||
            status.data?.privacy_policy_enabled === true) && (
            <label className="row">
              <Checkbox required disabled={busy} />
              <span>
                {t('I agree to the terms and privacy policy.')}{' '}
                <a href="/user-agreement" target="_blank" rel="noreferrer">
                  {t('Terms')}
                </a>
                {' · '}
                <a href="/privacy-policy" target="_blank" rel="noreferrer">
                  {t('Privacy')}
                </a>
              </span>
            </label>
          )}
          {(register.error || sendCode.error) && (
            <ErrorState error={register.error || sendCode.error} />
          )}
          <Button
            type="submit"
            busy={register.isPending}
            disabled={busy || (captchaRequired && !turnstile)}
          >
            {t('Create account')}
          </Button>
        </form>
        <p className="muted">
          {t('Already have an account?')}{' '}
          <Link className="text-link" to="/login" search={{ next }}>
            {t('Sign in')}
          </Link>
        </p>
      </Card>
    </div>
  )
}
