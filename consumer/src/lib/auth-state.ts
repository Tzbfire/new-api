export interface User {
  id: number
  username: string
  display_name: string
  email: string
  has_password?: boolean
  role: number
  status?: number
  group: string
  quota: number
  used_quota: number
  request_count: number
  setting?: string
  github_id?: string
  discord_id?: string
  oidc_id?: string
  telegram_id?: string
  linux_do_id?: string
  [key: string]: unknown
}

export interface LoginSession {
  sid: string
  current: boolean
  login_method: string
  ip: string
  user_agent: string
  created_at: number
  last_active_at: number
  expires_at: number
}

export interface AuthBundle {
  access_token: string
  token_type: 'Bearer'
  access_expires_at: number
  session: LoginSession
  user: User
}

export interface AuthSnapshot {
  user: User | null
  session: LoginSession | null
  token: string | null
  expiresAt: number
  status: 'loading' | 'authenticated' | 'anonymous'
  verified: boolean
  authenticationError: unknown
  generation: number
}

let snapshot: AuthSnapshot = {
  user: null,
  session: null,
  token: null,
  expiresAt: 0,
  status: 'loading',
  generation: 0,
  verified: false,
  authenticationError: null,
}
const listeners = new Set<() => void>()

export const getAuthSnapshot = () => snapshot

export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isAuthBundle(value: unknown): value is AuthBundle {
  if (!value || typeof value !== 'object') return false
  const bundle = value as Partial<AuthBundle>
  return (
    bundle.token_type === 'Bearer' &&
    typeof bundle.access_token === 'string' &&
    bundle.access_token.length > 0 &&
    Number.isFinite(bundle.access_expires_at) &&
    Number(bundle.access_expires_at) > Date.now() / 1000 &&
    typeof bundle.session?.sid === 'string' &&
    bundle.session.sid.length > 0 &&
    bundle.session.current === true &&
    Number.isInteger(bundle.user?.id) &&
    Number(bundle.user?.id) > 0 &&
    typeof bundle.user?.username === 'string'
  )
}

// 凭据仅存在内存中；cookie 的生命周期与失效始终由后端管理。
export function acceptAuthBundle(bundle: AuthBundle) {
  if (!isAuthBundle(bundle)) throw new Error('Invalid authentication response')
  snapshot = {
    user: bundle.user,
    session: bundle.session,
    token: bundle.access_token,
    expiresAt: bundle.access_expires_at,
    status: 'authenticated',
    verified: true,
    authenticationError: null,
    generation: snapshot.generation + 1,
  }
  listeners.forEach((listener) => listener())
}

export function clearAuth(options?: { verified?: boolean }) {
  snapshot = {
    user: null,
    session: null,
    token: null,
    expiresAt: 0,
    status: 'anonymous',
    verified: options?.verified ?? false,
    authenticationError: null,
    generation: snapshot.generation + 1,
  }
  listeners.forEach((listener) => listener())
}

export function updateAuthUser(user: User) {
  if (snapshot.user?.id !== user.id) throw new Error('Your session has changed. Please try again.')
  snapshot = { ...snapshot, user }
  listeners.forEach((listener) => listener())
}

export function acceptAuthRotation(value: unknown) {
  if (!value || typeof value !== 'object' || !('access_token' in value)) return
  const bundle = { ...value, user: snapshot.user } as AuthBundle
  if (!isAuthBundle(bundle) || bundle.session.sid !== snapshot.session?.sid) {
    throw new Error('Invalid authentication response')
  }
  acceptAuthBundle(bundle)
}

export function hasSessionHint() {
  return (
    typeof document !== 'undefined' &&
    document.cookie.split(';').some((part) => part.trim() === 'new_api_has_session=1')
  )
}

export function suspendAuthentication(error: unknown) {
  snapshot = {
    user: null,
    session: null,
    token: null,
    expiresAt: 0,
    status: 'loading',
    verified: false,
    authenticationError: error,
    generation: snapshot.generation + 1,
  }
  listeners.forEach((listener) => listener())
}
