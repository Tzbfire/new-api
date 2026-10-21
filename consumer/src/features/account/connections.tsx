import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Card, EmptyState, ErrorState, Modal } from '@/components/ui'
import { request } from '@/lib/api'
import { enabledOAuthProviders, startOAuth } from '@/lib/auth-oauth'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { SecurityDialog, type SecurityAction } from '@/features/auth/security-dialog'

interface LinkedProvider {
  provider_id: number
  provider_name: string
  provider_slug: string
  provider_user_id: string
}
const bindingFields: Record<string, string> = {
  github: 'github_id',
  discord: 'discord_id',
  oidc: 'oidc_id',
  linuxdo: 'linux_do_id',
  telegram: 'telegram_id',
}

export function AccountConnections() {
  const { t } = useTranslation()
  const session = useSession()
  const status = useStatus()
  const [action, setAction] = useState<SecurityAction | null>(null)
  const [pending, setPending] = useState<{ provider: string; proof: string } | null>(null)
  const bindings = useQuery({
    queryKey: ['account-connections', session.user?.id],
    queryFn: () => request<LinkedProvider[]>('/api/user/oauth/bindings'),
    retry: false,
  })
  const connect = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!pending) return
      const authorization = pending
      setPending(null)
      await startOAuth(authorization.provider, 'bind', undefined, authorization.proof)
      await Promise.all([session.refreshUser(), bindings.refetch()])
    },
  })
  const available = enabledOAuthProviders(status.data)
  const all = [
    ...available,
    ...(bindings.data ?? [])
      .filter((binding) => !available.some((provider) => provider.slug === binding.provider_slug))
      .map((binding) => ({ slug: binding.provider_slug, name: binding.provider_name })),
  ]
  return (
    <Card className="stack">
      <div className="row">
        <Link2 size={22} aria-hidden="true" />
        <h2>{t('Linked accounts')}</h2>
      </div>
      <p className="muted">
        {t(
          'Connect another secure way to sign in. Your existing security verification still applies.',
        )}
      </p>
      {bindings.error && (
        <ErrorState
          error={bindings.error}
          retry={() => {
            void bindings.refetch()
          }}
        />
      )}
      {!all.length && !bindings.isPending && (
        <EmptyState title={t('No sign-in providers are available')} />
      )}
      {all.map((provider) => {
        const custom = bindings.data?.find((binding) => binding.provider_slug === provider.slug)
        const linked = Boolean(custom || session.user?.[bindingFields[provider.slug]])
        return (
          <div className="row" key={provider.slug}>
            <strong>{provider.name}</strong>
            {linked ? (
              <>
                <Badge>{t('Linked')}</Badge>
                {custom ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setAction({
                        title: t('Unlink {{provider}}', { provider: provider.name }),
                        scope: 'account.binding.unbind',
                        context: { provider_id: custom.provider_id },
                        run: async (proof) => {
                          await request(`/api/user/oauth/bindings/${custom.provider_id}`, {
                            method: 'DELETE',
                            headers: { 'X-Security-Proof': proof },
                          })
                          await bindings.refetch()
                        },
                      })
                    }
                  >
                    {t('Unlink')}
                  </Button>
                ) : (
                  <span className="muted">
                    {t('Contact support to change this linked account.')}
                  </span>
                )}
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  setAction({
                    title: t('Link {{provider}}', { provider: provider.name }),
                    scope: 'account.binding.bind',
                    context: { provider: provider.slug },
                    run: async (proof) => {
                      setPending({ provider: provider.slug, proof })
                      connect.reset()
                    },
                  })
                }
              >
                {t('Connect')}
              </Button>
            )}
          </div>
        )
      })}
      {connect.error && <ErrorState error={connect.error} />}
      {connect.isSuccess && <p role="status">{t('Account linked successfully')}</p>}
      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={t('Continue to your sign-in provider')}
        description={t('Identity verified. Continue to authorize the account you want to link.')}
      >
        <Button busy={connect.isPending} onClick={() => connect.mutate()}>
          {t('Open authorization window')}
        </Button>
      </Modal>
      <SecurityDialog
        key={action?.scope ?? 'closed'}
        action={action}
        onClose={() => setAction(null)}
      />
    </Card>
  )
}
