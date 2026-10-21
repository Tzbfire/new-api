import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  decodeEnvelope,
  refreshAuthentication,
  resolveAuthentication,
  request,
} from './api'
import {
  acceptAuthBundle,
  clearAuth,
  getAuthSnapshot,
  hasSessionHint,
  subscribeAuth,
  updateAuthUser,
  type AuthBundle,
  type User,
} from './auth-state'

export type { User, AuthBundle, LoginSession } from './auth-state'
const SessionContext = createContext<{
  user: User | null
  sessionId: string | undefined
  status: 'loading' | 'authenticated' | 'anonymous'
  refreshUser: () => Promise<void>
  logout: () => Promise<void>
  authenticationError: unknown
  retryAuthentication: () => Promise<void>
} | null>(null)
let syncChannel: BroadcastChannel | null = null
const syncSource = globalThis.crypto?.randomUUID?.() ?? `consumer-${Math.random()}`

function publishSession(kind: 'authenticated' | 'signed_out', sid: string) {
  syncChannel?.postMessage({
    kind,
    sid,
    source: syncSource,
    nonce: globalThis.crypto?.randomUUID?.() ?? String(Math.random()),
    timestamp: Date.now(),
  })
}

export function completeLogin(bundle: AuthBundle) {
  acceptAuthBundle(bundle)
  publishSession('authenticated', bundle.session.sid)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot)
  const queryClient = useQueryClient()
  const bootstrap = useCallback(async () => {
    // Recovery failures are a separate state, not a confirmed sign-out.
    await resolveAuthentication().catch(() => undefined)
  }, [])
  const retryAuthentication = useCallback(async () => {
    await resolveAuthentication({ required: true, retry: true }).catch(() => undefined)
  }, [])

  useEffect(() => {
    let previous = getAuthSnapshot()
    return subscribeAuth(() => {
      const current = getAuthSnapshot()
      if (current.user?.id !== previous.user?.id || current.session?.sid !== previous.session?.sid)
        queryClient.clear()
      previous = current
    })
  }, [queryClient])
  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    // 广播只通知重新确认身份，永不传输 token、密码或可消费 proof。
    const reconcile = (required = false) => {
      if (document.visibilityState !== 'visible' || getAuthSnapshot().authenticationError) return
      const current = getAuthSnapshot()
      if (current.token && !hasSessionHint()) {
        // A missing hint can mean another frontend signed out. Ask the server;
        // the readable hint is never proof of authentication or its absence.
        void refreshAuthentication().catch(() => undefined)
        return
      }
      void resolveAuthentication({ required }).catch(() => undefined)
    }
    const onVisibilityChange = () => reconcile()
    const receive = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return
      const message = event.data as {
        kind?: unknown
        sid?: unknown
        source?: unknown
        timestamp?: unknown
      }
      if (
        (message.kind !== 'authenticated' && message.kind !== 'signed_out') ||
        typeof message.sid !== 'string' ||
        !message.sid ||
        message.source === syncSource ||
        typeof message.timestamp !== 'number' ||
        Math.abs(Date.now() - message.timestamp) > 60_000
      )
        return
      const current = getAuthSnapshot()
      if (message.kind === 'signed_out' && current.session?.sid !== message.sid) return
      if (message.kind === 'signed_out') {
        clearAuth({ verified: true })
        return
      }
      if (current.session?.sid !== message.sid) clearAuth()
      reconcile(true)
    }
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('new-api:auth-session')
      syncChannel.addEventListener('message', receive)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      syncChannel?.close()
      syncChannel = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    const user = await request<User>('/api/user/self')
    updateAuthUser(user)
  }, [])

  const logout = useCallback(async () => {
    const current = getAuthSnapshot()
    const headers = new Headers()
    if (current.token) headers.set('Authorization', `Bearer ${current.token}`)
    if (current.session) headers.set('X-Auth-Session', current.session.sid)
    // 不在失败时伪装成已退出；旧 token 已过期时服务端仍可用 refresh cookie 注销。
    const response = await fetch('/api/user/auth/logout', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
    await decodeEnvelope(response)
    if (
      current.user?.id !== getAuthSnapshot().user?.id ||
      current.session?.sid !== getAuthSnapshot().session?.sid
    )
      throw new ApiError('Your session has changed. Please try again.')
    clearAuth({ verified: true })
    queryClient.clear()
    if (current.session) publishSession('signed_out', current.session.sid)
  }, [queryClient])

  return (
    <SessionContext.Provider
      value={{
        user: state.user,
        sessionId: state.session?.sid,
        status: state.status,
        refreshUser,
        logout,
        authenticationError: state.authenticationError,
        retryAuthentication,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider is required')
  return value
}
