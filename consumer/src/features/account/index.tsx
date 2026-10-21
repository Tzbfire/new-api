import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { LockKeyhole, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
} from '@/components/ui'
import { ApiError, jsonBody, request } from '@/lib/api'
import { clearAuth } from '@/lib/auth-state'
import { useSession } from '@/lib/session'
import { SecurityDialog, type SecurityAction } from '@/features/auth/security-dialog'
import { AccountSecurity } from './security'
import { AccountEmail } from './email'
import { AccountSessions } from './sessions'
import { AccountConnections } from './connections'
import '@/features/auth/auth-account.css'

export default function AccountPage() {
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState(session.user?.display_name ?? '')
  const [profileNameInvalid, setProfileNameInvalid] = useState(false)
  const [action, setAction] = useState<SecurityAction | null>(null)
  const [passwordError, setPasswordError] = useState<unknown>(null)
  const [deleteProof, setDeleteProof] = useState('')
  const [deleteName, setDeleteName] = useState('')
  const [deletionError, setDeletionError] = useState<unknown>(null)
  const deletion = useMutation({
    retry: false,
    mutationFn: async () => {
      const proof = deleteProof
      setDeleteProof('')
      if (!proof) throw new Error('Verify your identity before deleting your account.')
      await request('/api/user/self', { method: 'DELETE', headers: { 'X-Security-Proof': proof } })
      clearAuth()
      void navigate({ to: '/login' })
    },
    onError: (error) => setDeletionError(error),
  })
  const [passwordSaved, setPasswordSaved] = useState(false)
  useEffect(() => {
    setDisplayName(session.user?.display_name ?? '')
  }, [session.user?.display_name])
  const profile = useMutation({
    retry: false,
    mutationFn: async () => {
      await request('/api/user/self', {
        method: 'PUT',
        ...jsonBody({ username: session.user!.username, display_name: displayName.trim() }),
      })
      await session.refreshUser()
    },
  })
  const signOut = useMutation({
    retry: false,
    mutationFn: session.logout,
    onSuccess: () => {
      void navigate({ to: '/login' })
    },
  })
  if (session.status === 'loading') return <LoadingState />
  if (!session.user)
    return (
      <Card>
        <Link to="/login">{t('Sign in to manage your account')}</Link>
      </Card>
    )
  return (
    <div className="page-stack account-page">
      <PageHeader
        eyebrow={t('Your space')}
        title={t('Account & security')}
        description={t('A few thoughtful settings to make this space yours.')}
        actions={
          <Button variant="secondary" busy={signOut.isPending} onClick={() => signOut.mutate()}>
            {t('Sign out')}
          </Button>
        }
      />
      {signOut.error && <ErrorState error={signOut.error} />}
      <div className="card-grid">
        <Card className="stack">
          <div className="row">
            <UserRound size={22} aria-hidden="true" />
            <h2>{t('Profile')}</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              if (!displayName.trim()) {
                setProfileNameInvalid(true)
                return
              }
              profile.mutate()
            }}
          >
            <Field label={t('Username')} hint={t('Your permanent sign-in name')}>
              <Input value={session.user.username} readOnly />
            </Field>
            <Field
              label={t('What should we call you?')}
              error={
                profileNameInvalid
                  ? t('Enter a name with at least one non-space character.')
                  : undefined
              }
            >
              <Input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setProfileNameInvalid(false)
                  profile.reset()
                }}
                autoComplete="nickname"
                maxLength={20}
                required
                disabled={profile.isPending}
              />
            </Field>
            <Button type="submit" variant="secondary" busy={profile.isPending}>
              {t('Save profile')}
            </Button>
            {profile.isSuccess && <p role="status">{t('Profile saved')}</p>}
            {profile.error && <ErrorState error={profile.error} />}
          </form>
        </Card>
        <AccountEmail />
        <Card className="stack">
          <div className="row">
            <LockKeyhole size={22} aria-hidden="true" />
            <h2>{session.user.has_password ? t('Change password') : t('Set a password')}</h2>
          </div>
          <p className="muted">{t('Changing your password signs out your other devices.')}</p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              setPasswordError(null)
              setPasswordSaved(false)
              const form = event.currentTarget
              const data = new FormData(form)
              if (data.get('password') !== data.get('confirm')) {
                setPasswordError(new ApiError('Passwords do not match'))
                return
              }
              const body = {
                username: session.user!.username,
                display_name: session.user!.display_name,
                password: String(data.get('password') ?? ''),
                original_password: String(data.get('original_password') ?? ''),
              }
              setAction({
                title: t('Confirm password change'),
                scope: session.user!.has_password
                  ? 'account.password.change'
                  : 'account.password.set',
                run: async (proof) => {
                  await request('/api/user/self', {
                    method: 'PUT',
                    ...jsonBody(body),
                    headers: { 'Content-Type': 'application/json', 'X-Security-Proof': proof },
                  })
                  body.password = ''
                  body.original_password = ''
                  form.reset()
                  setPasswordSaved(true)
                  await session.refreshUser()
                },
              })
            }}
          >
            {session.user.has_password && (
              <Field label={t('Current password')}>
                <Input
                  name="original_password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
            )}
            <Field label={t('New password')} hint={t('Use at least 15 characters.')}>
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={128}
                required
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
              />
            </Field>
            <Button type="submit" variant="secondary">
              {t('Update password')}
            </Button>
            {passwordError ? <ErrorState error={passwordError} /> : null}
            {passwordSaved && <p role="status">{t('Password updated')}</p>}
          </form>
        </Card>
        <AccountSecurity />
        <AccountConnections />
      </div>
      <AccountSessions />
      <Card className="stack">
        <details>
          <summary>{t('Close your account')}</summary>
          <div className="stack">
            <p className="muted">
              {t(
                'Deleting your account removes access to your balance, API keys, and account data. This cannot be undone.',
              )}
            </p>
            <p>
              {t(
                'Identity verification is required. You will review a final confirmation before deletion.',
              )}
            </p>
            {deletionError ? <ErrorState error={deletionError} /> : null}
            <Button
              variant="danger"
              disabled={deletion.isPending}
              onClick={() => {
                setDeletionError(null)
                setDeleteName('')
                setAction({
                  title: t('Verify before closing your account'),
                  scope: 'account.delete',
                  run: async (proof) => {
                    setDeleteProof(proof)
                  },
                })
              }}
            >
              {t('Verify your identity')}
            </Button>
          </div>
        </details>
      </Card>
      <Modal
        open={!!deleteProof}
        onClose={() => setDeleteProof('')}
        title={t('Permanently delete account')}
        description={t('This is the final step. Your account cannot be recovered.')}
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (new FormData(event.currentTarget).get('confirmation') === session.user!.username)
              deletion.mutate()
          }}
        >
          <p>
            {t(
              'Deleting your account removes access to your balance, API keys, and account data. This cannot be undone.',
            )}
          </p>
          <Field label={t('Type your username to confirm')}>
            <Input
              name="confirmation"
              value={deleteName}
              onChange={(event) => setDeleteName(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Button
            variant="danger"
            type="submit"
            busy={deletion.isPending}
            disabled={deleteName !== session.user.username}
          >
            {t('Delete account')}
          </Button>
          <Button variant="secondary" onClick={() => setDeleteProof('')}>
            {t('Cancel')}
          </Button>
        </form>
      </Modal>
      <SecurityDialog
        key={action?.scope ?? 'closed'}
        action={action}
        onClose={() => setAction(null)}
      />
    </div>
  )
}
