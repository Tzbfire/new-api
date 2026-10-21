import { useState } from 'react'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorState, Field, Input, Modal } from '@/components/ui'
import { jsonBody, request } from '@/lib/api'
import { useSession } from '@/lib/session'
import { SecurityDialog, type SecurityAction } from '@/features/auth/security-dialog'

interface EmailBinding {
  flow_token: string
  email: string
  current_email?: string
  old_email_required: boolean
  expires_at: number
  resend_at: number
  notification_warning: boolean
}

export function AccountEmail() {
  const { t } = useTranslation()
  const session = useSession()
  const [email, setEmail] = useState('')
  const [action, setAction] = useState<SecurityAction | null>(null)
  const [flow, setFlow] = useState<EmailBinding | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [warning, setWarning] = useState(false)
  return (
    <Card className="stack">
      <div className="row">
        <Mail size={22} aria-hidden="true" />
        <h2>{t('Recovery email')}</h2>
      </div>
      <p className="muted">{session.user?.email || t('No email linked yet')}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          setSaved(false)
          const normalized = email.trim().toLowerCase()
          setAction({
            title: t('Update recovery email'),
            scope: 'account.binding.bind',
            context: { provider: 'email', email: normalized },
            run: async (proof) => {
              const result = await request<EmailBinding>('/api/oauth/email/bind/start', {
                method: 'POST',
                ...jsonBody({ email: normalized }),
                headers: { 'Content-Type': 'application/json', 'X-Security-Proof': proof },
              })
              setFlow(result)
              setError(null)
            },
          })
        }}
      >
        <Field label={t('New email address')}>
          <Input
            type="email"
            autoComplete="email"
            required
            maxLength={50}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Button variant="secondary" type="submit">
          {t('Update email')}
        </Button>
        {saved && <p role="status">{t('Email updated')}</p>}
        {warning && (
          <p role="status">
            {t('Your change was saved, but a security notification could not be delivered.')}
          </p>
        )}
      </form>
      <Modal
        open={Boolean(flow)}
        onClose={() => {
          if (!busy) setFlow(null)
        }}
        title={t('Verify your email addresses')}
        description={t('Enter the codes sent to your email to confirm this change.')}
      >
        {flow && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              if (busy) return
              const data = new FormData(event.currentTarget)
              setBusy(true)
              setError(null)
              void request<{ notification_warning?: boolean }>('/api/oauth/email/bind', {
                method: 'POST',
                ...jsonBody({
                  flow_token: flow.flow_token,
                  new_code: data.get('new_code'),
                  old_code: data.get('old_code') || '',
                }),
              })
                .then(async (result) => {
                  setWarning(result.notification_warning === true)
                  setFlow(null)
                  setEmail('')
                  setSaved(true)
                  await session.refreshUser()
                })
                .catch(setError)
                .finally(() => setBusy(false))
            }}
          >
            <Field label={t('Code sent to {{email}}', { email: flow.email })}>
              <Input name="new_code" autoComplete="one-time-code" required disabled={busy} />
            </Field>
            {flow.old_email_required && (
              <Field label={t('Code sent to {{email}}', { email: flow.current_email })}>
                <Input name="old_code" autoComplete="off" required disabled={busy} />
              </Field>
            )}
            {error ? <ErrorState error={error} /> : null}
            <Button type="submit" busy={busy}>
              {t('Confirm email change')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                void request<EmailBinding>('/api/oauth/email/bind/resend', {
                  method: 'POST',
                  ...jsonBody({ flow_token: flow.flow_token }),
                })
                  .then(setFlow)
                  .catch(setError)
                  .finally(() => setBusy(false))
              }}
            >
              {t('Resend codes')}
            </Button>
          </form>
        )}
      </Modal>
      <SecurityDialog
        key={action?.scope ?? 'closed'}
        action={action}
        onClose={() => setAction(null)}
      />
    </Card>
  )
}
