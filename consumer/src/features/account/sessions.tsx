import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Laptop } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui'
import { clearAuth } from '@/lib/auth-state'
import { request } from '@/lib/api'
import { useSession, type LoginSession } from '@/lib/session'
import { formatDate } from '@/lib/format'

export function AccountSessions() {
  const { t, i18n } = useTranslation()
  const session = useSession()
  const [revoke, setRevoke] = useState<LoginSession | 'others' | null>(null)
  const sessions = useQuery({
    queryKey: ['login-sessions', session.user?.id],
    queryFn: () => request<LoginSession[]>('/api/user/sessions'),
    retry: false,
  })
  const remove = useMutation({
    retry: false,
    mutationFn: async () => {
      if (revoke === 'others') await request('/api/user/sessions/revoke-others', { method: 'POST' })
      else if (revoke) {
        await request(`/api/user/sessions/${encodeURIComponent(revoke.sid)}`, { method: 'DELETE' })
        if (revoke.current) clearAuth()
      }
    },
    onSuccess: () => {
      setRevoke(null)
      void sessions.refetch()
    },
  })
  return (
    <Card className="stack">
      <div className="row">
        <Laptop size={22} aria-hidden="true" />
        <h2>{t('Signed-in devices')}</h2>
      </div>
      <p className="muted">
        {t('Review where your account is signed in. Sign out devices you do not recognize.')}
      </p>
      {sessions.isPending ? (
        <LoadingState />
      ) : sessions.error ? (
        <ErrorState
          error={sessions.error}
          retry={() => {
            void sessions.refetch()
          }}
        />
      ) : !sessions.data?.length ? (
        <EmptyState title={t('No active sessions')} />
      ) : (
        <div className="stack">
          {sessions.data.map((item) => (
            <div className="session-row" key={item.sid}>
              <div className="stack">
                <strong>{item.user_agent || t('Unknown device')}</strong>
                <p className="muted">
                  {item.ip} · {formatDate(item.last_active_at, i18n.language)}
                </p>
                {item.current && <Badge>{t('This device')}</Badge>}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  remove.reset()
                  setRevoke(item)
                }}
              >
                {t('Sign out')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          remove.reset()
          setRevoke('others')
        }}
      >
        {t('Sign out other devices')}
      </Button>
      {remove.error && <ErrorState error={remove.error} />}
      <ConfirmDialog
        open={Boolean(revoke)}
        onClose={() => {
          if (!remove.isPending) setRevoke(null)
        }}
        onConfirm={() => remove.mutate()}
        title={revoke === 'others' ? t('Sign out other devices?') : t('Sign out this device?')}
        description={t('This device will need to sign in again to access your account.')}
        busy={remove.isPending}
      />
    </Card>
  )
}
