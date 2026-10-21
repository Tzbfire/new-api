import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, Field, Input, LoadingState, Modal, Select } from '@/components/ui'
import { request } from '@/lib/api'
import { verifySecurity, type SecurityOperation, type SecurityRequirements } from '@/lib/security'
import { startOAuth } from '@/lib/auth-oauth'
import type { SecurityProof } from '@/lib/security'

export interface SecurityAction extends SecurityOperation {
  title: string
  run: (proof: string) => Promise<void>
}

export function SecurityDialog(props: { action: SecurityAction | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState('')
  const requirements = useQuery({
    queryKey: ['security-methods', props.action?.scope],
    queryFn: () =>
      request<SecurityRequirements>(
        `/api/verify/methods?scope=${encodeURIComponent(props.action!.scope)}`,
      ),
    enabled: Boolean(props.action),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const methods =
    requirements.data?.methods.filter(
      (item) =>
        item.available && ['password', '2fa', 'passkey', 'session', 'oauth'].includes(item.method),
    ) ?? []
  const method = methods.some((item) => item.method === selected)
    ? selected
    : (methods[0]?.method ?? '')
  const labels: Record<string, string> = {
    password: t('Password'),
    '2fa': t('Authenticator or recovery code'),
    passkey: t('Passkey'),
    session: t('Current session'),
    oauth: t('Linked account'),
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!props.action || !requirements.data || !method || busy) return
    const action = props.action
    setBusy(true)
    setError(null)
    try {
      let proof: string
      if (method === 'oauth') {
        const selectedProvider = provider || requirements.data.oauth_providers?.[0]?.slug
        if (!selectedProvider) throw new Error(t('No linked provider is available'))
        const result = await startOAuth<SecurityProof>(selectedProvider, 'verify', {
          scope: action.scope,
          context: action.context,
        })
        if (
          !result.proof_token ||
          result.scope !== action.scope ||
          result.expires_at <= Date.now() / 1000
        )
          throw new Error(t('Verification flow expired'))
        proof = result.proof_token
      } else proof = await verifySecurity(action, requirements.data, method, value)
      setValue('')
      await action.run(proof)
      props.onClose()
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={Boolean(props.action)}
      onClose={() => {
        if (!busy) props.onClose()
      }}
      title={props.action?.title ?? t('Verify your identity')}
      description={t('Confirm it is you before changing account security.')}
    >
      {requirements.isPending ? (
        <LoadingState />
      ) : requirements.error ? (
        <ErrorState
          error={requirements.error}
          retry={() => {
            void requirements.refetch()
          }}
        />
      ) : (
        <form className="stack" onSubmit={submit}>
          {methods.length > 0 ? (
            <>
              <Field label={t('Verification method')}>
                <Select
                  value={method}
                  disabled={busy}
                  onValueChange={(value) => {
                    setSelected(value)
                    setValue('')
                  }}
                  options={methods.map((item) => ({
                    value: item.method,
                    label: labels[item.method],
                  }))}
                />
              </Field>
              {(method === 'password' || method === '2fa') && (
                <Field
                  label={method === 'password' ? t('Current password') : t('Verification code')}
                >
                  <Input
                    type={method === 'password' ? 'password' : 'text'}
                    autoComplete={method === 'password' ? 'current-password' : 'one-time-code'}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    required
                    disabled={busy}
                    autoFocus
                  />
                </Field>
              )}
              {method === 'oauth' && (
                <Field label={t('Linked account')}>
                  <Select
                    value={provider || requirements.data?.oauth_providers?.[0]?.slug || ''}
                    onValueChange={setProvider}
                    disabled={busy}
                    options={
                      requirements.data?.oauth_providers?.map((item) => ({
                        value: item.slug,
                        label: item.name,
                      })) || []
                    }
                  />
                </Field>
              )}
              {error ? <ErrorState error={error} /> : null}
              <Button type="submit" busy={busy}>
                {method === 'passkey' ? t('Verify with Passkey') : t('Verify and continue')}
              </Button>
            </>
          ) : (
            <p role="alert">
              {t('No verification method is available. Contact the site administrator.')}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
