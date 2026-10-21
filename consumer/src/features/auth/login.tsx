import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Fingerprint, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorState, Field, Input, LoadingState } from '@/components/ui'
import { ApiError, jsonBody, request } from '@/lib/api'
import { isAuthBundle, type AuthBundle } from '@/lib/auth-state'
import { passwordFields } from '@/lib/password'
import { signInWithPasskey } from '@/lib/passkey'
import { completeLogin, useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import type { LoginChallenge } from '@/lib/security'
import { enabledOAuthProviders, startOAuth } from '@/lib/auth-oauth'
import { Turnstile } from './turnstile'
import { Brand } from '@/components/brand'
import './auth-account.css'
import { safeLoginDestination } from '@/lib/auth-navigation'

export { safeLoginDestination } from '@/lib/auth-navigation'

export default function LoginPage() {
  const { t } = useTranslation()
  const status = useStatus()
  const session = useSession()
  const navigate = useNavigate()
  const [destination] = useState(() =>
    safeLoginDestination(new URLSearchParams(window.location.search).get('next')),
  )
  const destinationURL = new URL(destination, window.location.origin)
  const destinationSearch = Object.fromEntries(destinationURL.searchParams)
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null)
  const [turnstile, setTurnstile] = useState('')
  const [captchaVersion, setCaptchaVersion] = useState(0)
  const login = useMutation({
    retry: false,
    mutationFn: async (form: HTMLFormElement) => {
      const data = new FormData(form)
      if (challenge) {
        if (challenge.expires_at <= Date.now() / 1000)
          throw new ApiError('Verification flow expired')
        return request<AuthBundle>('/api/user/login/verify', {
          method: 'POST',
          ...jsonBody({
            flow_token: challenge.flow_token,
            method: '2fa',
            code: String(data.get('code') ?? ''),
          }),
        })
      }
      const fields = await passwordFields(
        String(data.get('password') ?? ''),
        status.data?.password_login_encryption_enabled === true,
      )
      const result = await request<AuthBundle | LoginChallenge>(
        `/api/user/login?turnstile=${encodeURIComponent(turnstile)}`,
        {
          method: 'POST',
          ...jsonBody({ username: String(data.get('username') ?? '').trim(), ...fields }),
        },
      )
      form.reset()
      return result
    },
    onSuccess: (result) => {
      if (isAuthBundle(result)) {
        completeLogin(result)
        void navigate({
          to: destinationURL.pathname as '/keys',
          search: destinationSearch,
          hash: destinationURL.hash.slice(1),
        })
      } else if (
        result.require_verification === true &&
        result.flow_token &&
        Array.isArray(result.methods)
      )
        setChallenge(result)
      else throw new ApiError('Invalid authentication response')
    },
    onSettled: () => {
      setTurnstile('')
      setCaptchaVersion((value) => value + 1)
    },
  })
  const passkey = useMutation({
    retry: false,
    mutationFn: () => signInWithPasskey(challenge?.flow_token),
    onSuccess: (bundle) => {
      completeLogin(bundle)
      void navigate({
        to: destinationURL.pathname as '/keys',
        search: destinationSearch,
        hash: destinationURL.hash.slice(1),
      })
    },
  })
  const oauth = useMutation({
    retry: false,
    mutationFn: (provider: string) => {
      return startOAuth<AuthBundle | LoginChallenge>(provider, 'login')
    },
    onSuccess: (result) => {
      if (isAuthBundle(result)) {
        completeLogin(result)
        void navigate({
          to: destinationURL.pathname as '/keys',
          search: destinationSearch,
          hash: destinationURL.hash.slice(1),
        })
      } else if (
        result.require_verification === true &&
        result.flow_token &&
        Array.isArray(result.methods)
      )
        setChallenge(result)
      else throw new ApiError('Invalid authentication response')
    },
  })
  const busy = login.isPending || passkey.isPending || oauth.isPending
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
  const canUseCode =
    !challenge || challenge.methods.some((item) => item.method === '2fa' && item.available)
  const canUsePasskey = challenge
    ? challenge.methods.some((item) => item.method === 'passkey' && item.available)
    : status.data?.passkey_login === true
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy) login.mutate(event.currentTarget)
  }
  return (
    <div className="auth-page">
      <Card className="auth-card stack">
        <div className="auth-mark">
          <Sparkles size={26} aria-hidden="true" />
        </div>
        <div>
          <Brand />
          <h1>{challenge ? t('One more step') : t('Welcome back')}</h1>
          <p className="muted">
            {challenge
              ? t('Enter an authenticator or recovery code to finish signing in.')
              : t('Your ideas, with a little more possibility.')}
          </p>
        </div>
        {session.authenticationError ? (
          <ErrorState
            error={session.authenticationError}
            retry={() => {
              void session.retryAuthentication()
            }}
          />
        ) : null}
        {(challenge ? canUseCode : status.data?.password_login_enabled !== false) && (
          <form className="stack" onSubmit={submit}>
            {challenge ? (
              <Field label={t('Verification code')}>
                <Input
                  name="code"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  disabled={busy}
                />
              </Field>
            ) : (
              <>
                <Field label={t('Username')}>
                  <Input
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={20}
                    autoFocus
                    disabled={busy}
                  />
                </Field>
                <Field label={t('Password')}>
                  <Input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                  />
                </Field>
                <Link to="/reset" className="text-link">
                  {t('Forgot password?')}
                </Link>
                {status.data?.turnstile_check === true && (
                  <Turnstile
                    key={captchaVersion}
                    siteKey={String(status.data.turnstile_site_key ?? '')}
                    onToken={setTurnstile}
                  />
                )}
              </>
            )}
            <Button
              type="submit"
              busy={login.isPending}
              disabled={busy || (!challenge && status.data?.turnstile_check === true && !turnstile)}
            >
              {challenge ? t('Verify and sign in') : t('Sign in')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </form>
        )}
        {canUsePasskey && (
          <Button
            variant="secondary"
            busy={passkey.isPending}
            disabled={busy}
            onClick={() => passkey.mutate()}
          >
            <Fingerprint size={18} aria-hidden="true" />
            {t('Continue with Passkey')}
          </Button>
        )}
        {!challenge &&
          enabledOAuthProviders(status.data).map((provider) => (
            <Button
              key={provider.slug}
              variant="secondary"
              busy={oauth.isPending && oauth.variables === provider.slug}
              disabled={busy}
              onClick={() => oauth.mutate(provider.slug)}
            >
              {t('Continue with {{provider}}', { provider: provider.name })}
            </Button>
          ))}
        {(login.error || passkey.error || oauth.error) && (
          <ErrorState
            title={t('Sign-in failed')}
            error={login.error || passkey.error || oauth.error}
          />
        )}
        {challenge ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setChallenge(null)
              login.reset()
              passkey.reset()
            }}
          >
            {t('Use another account')}
          </Button>
        ) : (
          <>
            {status.data?.register_enabled !== false &&
              status.data?.password_register_enabled !== false && (
                <p className="muted">
                  {t('New here?')}{' '}
                  <Link className="text-link" to="/register" search={{ next: destination }}>
                    {t('Create an account')}
                  </Link>
                </p>
              )}
          </>
        )}
      </Card>
      <p className="auth-footer muted">{t('Built on New API by QuantumNous')}</p>
    </div>
  )
}
