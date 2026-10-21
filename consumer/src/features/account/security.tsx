import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Card,
  CopyButton,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
} from '@/components/ui'
import { jsonBody, request } from '@/lib/api'
import { registerPasskey } from '@/lib/passkey'
import { useSession } from '@/lib/session'
import { SecurityDialog, type SecurityAction } from '@/features/auth/security-dialog'

interface TwoFASetup {
  secret: string
  qr_code_data: string
  backup_codes: string[]
  flow_token: string
  expires_at: number
}

export function AccountSecurity() {
  const { t } = useTranslation()
  const session = useSession()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<SecurityAction | null>(null)
  const [setup, setSetup] = useState<TwoFASetup | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [qr, setQR] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const factors = useQuery({
    queryKey: ['account-security', session.user?.id],
    queryFn: async () => {
      const [twoFA, passkey] = await Promise.all([
        request<{ enabled: boolean; locked: boolean; backup_codes_remaining?: number }>(
          '/api/user/2fa/status',
        ),
        request<{ enabled: boolean; last_used_at?: string }>('/api/user/passkey'),
      ])
      return { twoFA, passkey }
    },
    retry: false,
  })
  useEffect(() => {
    let active = true
    setQR('')
    if (setup)
      void import('qrcode')
        .then((module) => module.toDataURL(setup.qr_code_data, { width: 220, margin: 2 }))
        .then((url) => {
          if (active) setQR(url)
        })
        .catch(() => {
          /* 手动密钥输入始终可用。 */
        })
    return () => {
      active = false
    }
  }, [setup])

  async function changed() {
    await Promise.all([
      session.refreshUser(),
      queryClient.invalidateQueries({ queryKey: ['account-security'] }),
      queryClient.invalidateQueries({ queryKey: ['login-sessions'] }),
    ])
  }

  if (factors.isPending) return <LoadingState />
  if (factors.error)
    return (
      <ErrorState
        error={factors.error}
        retry={() => {
          void factors.refetch()
        }}
      />
    )
  return (
    <>
      <Card className="stack">
        <div className="row">
          <ShieldCheck size={22} aria-hidden="true" />
          <h2>{t('Two-step verification')}</h2>
          <Badge>{factors.data.twoFA.enabled ? t('Enabled') : t('Not enabled')}</Badge>
        </div>
        <p className="muted">
          {t('Add a second layer of protection with your authenticator app.')}
        </p>
        {factors.data.twoFA.enabled ? (
          <>
            <p className="muted">
              {t('{{count}} recovery codes remaining', {
                count: factors.data.twoFA.backup_codes_remaining ?? 0,
              })}
            </p>
            <div className="row">
              <Button
                variant="secondary"
                onClick={() =>
                  setAction({
                    title: t('Create new recovery codes'),
                    scope: '2fa.backup_codes.regenerate',
                    run: async (proof) => {
                      const result = await request<{ backup_codes: string[] }>(
                        '/api/user/2fa/backup_codes',
                        { method: 'POST', headers: { 'X-Security-Proof': proof } },
                      )
                      setCodes(result.backup_codes)
                      await changed()
                    },
                  })
                }
              >
                {t('New recovery codes')}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setAction({
                    title: t('Disable two-step verification'),
                    scope: '2fa.disable',
                    run: async (proof) => {
                      await request('/api/user/2fa/disable', {
                        method: 'POST',
                        headers: { 'X-Security-Proof': proof },
                      })
                      await changed()
                    },
                  })
                }
              >
                {t('Disable')}
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={() =>
              setAction({
                title: t('Set up two-step verification'),
                scope: '2fa.setup',
                run: async (proof) => {
                  const result = await request<TwoFASetup>('/api/user/2fa/setup', {
                    method: 'POST',
                    headers: { 'X-Security-Proof': proof },
                  })
                  setCode('')
                  setError(null)
                  setSetup(result)
                },
              })
            }
          >
            {t('Set up authenticator')}
          </Button>
        )}
      </Card>
      <Card className="stack">
        <div className="row">
          <Fingerprint size={22} aria-hidden="true" />
          <h2>{t('Passkey')}</h2>
          <Badge>{factors.data.passkey.enabled ? t('Enabled') : t('Not enabled')}</Badge>
        </div>
        <p className="muted">{t('Sign in with your fingerprint, face, or device screen lock.')}</p>
        {factors.data.passkey.enabled ? (
          <Button
            variant="secondary"
            onClick={() =>
              setAction({
                title: t('Remove Passkey'),
                scope: 'passkey.delete',
                run: async (proof) => {
                  await request('/api/user/passkey', {
                    method: 'DELETE',
                    headers: { 'X-Security-Proof': proof },
                  })
                  await changed()
                },
              })
            }
          >
            {t('Remove Passkey')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() =>
              setAction({
                title: t('Create a Passkey'),
                scope: 'passkey.register',
                run: async (proof) => {
                  await registerPasskey(proof)
                  await changed()
                },
              })
            }
          >
            {t('Create a Passkey')}
          </Button>
        )}
      </Card>
      <Modal
        open={Boolean(setup)}
        onClose={() => {
          if (!busy) {
            setSetup(null)
            setCode('')
            setError(null)
          }
        }}
        title={t('Connect your authenticator')}
        description={t(
          'Scan this code with your authenticator app, then enter the six-digit code.',
        )}
      >
        {setup && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              if (busy) return
              setBusy(true)
              setError(null)
              void request('/api/user/2fa/enable', {
                method: 'POST',
                ...jsonBody({ flow_token: setup.flow_token, code }),
              })
                .then(async () => {
                  setCodes(setup.backup_codes)
                  setSetup(null)
                  setCode('')
                  await changed()
                })
                .catch(setError)
                .finally(() => setBusy(false))
            }}
          >
            {qr && (
              <img
                className="auth-qr"
                src={qr}
                width={220}
                height={220}
                alt={t('Authenticator setup QR code')}
              />
            )}
            <p className="muted">{t('Or enter this setup key manually:')}</p>
            <code className="secret-value">{setup.secret}</code>
            <CopyButton value={setup.secret} label={t('Copy setup key')} />
            <Field label={t('Verification code')}>
              <Input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                disabled={busy}
              />
            </Field>
            {error ? <ErrorState error={error} /> : null}
            <Button type="submit" busy={busy}>
              {t('Enable two-step verification')}
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        open={codes.length > 0}
        onClose={() => setCodes([])}
        title={t('Save your recovery codes')}
        description={t(
          'Keep these codes somewhere safe. Each code works once. Your previous recovery codes no longer work.',
        )}
      >
        <div className="stack">
          <KeyRound aria-hidden="true" />
          <pre className="secret-value">{codes.join('\n')}</pre>
          <CopyButton value={codes.join('\n')} label={t('Copy recovery codes')} />
          <Button onClick={() => setCodes([])}>{t('I saved my codes')}</Button>
        </div>
      </Modal>
      <SecurityDialog
        key={action?.scope ?? 'closed'}
        action={action}
        onClose={() => setAction(null)}
      />
    </>
  )
}
