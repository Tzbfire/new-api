import {
  acceptAuthBundle,
  acceptAuthRotation,
  clearAuth,
  getAuthSnapshot,
  hasSessionHint,
  isAuthBundle,
  suspendAuthentication,
} from './auth-state'

export interface ApiEnvelope<T> {
  success?: boolean
  message?: string
  message_key?: string
  message_params?: Record<string, unknown>
  code?: string
  data: T
  [key: string]: unknown
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code?: string,
    public params?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const anonymousEndpoints =
  /^(?:\/api\/(?:status|notice|about|user-agreement|privacy-policy|verification|reset_password)(?:\?|$)|\/api\/user\/(?:login(?:\/.*)?|register|reset|passkey\/login\/.*)(?:\?|$))/
let refreshPromise: Promise<boolean> | null = null

function localPath(path: string) {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\r\n]/.test(path)
  ) {
    throw new ApiError('Only requests to this website are allowed')
  }
  return path
}

export async function decodeEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let body: ApiEnvelope<T>
  try {
    body = (await response.json()) as ApiEnvelope<T>
  } catch {
    if (response.status === 429)
      throw new ApiError('Too many requests. Please try again later.', 429)
    throw new ApiError('The server returned an unreadable response', response.status)
  }
  if (!body || typeof body !== 'object')
    throw new ApiError('The server returned an unreadable response', response.status)
  // EPay 和部分订阅接口用 message: success 表示成功，保留其顶层支付字段。
  if (
    !response.ok ||
    body.success === false ||
    (body.success !== true && body.message !== 'success')
  ) {
    throw new ApiError(
      body.message_key || body.message || 'Request failed. Please try again.',
      response.status,
      body.code,
      body.message_params,
    )
  }
  return body
}

async function performRefresh(generation: number): Promise<boolean> {
  let expectedSID = getAuthSnapshot().session?.sid
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (generation !== getAuthSnapshot().generation)
      return getAuthSnapshot().status === 'authenticated'
    let response: Response
    try {
      response = await fetch('/api/user/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: expectedSID ? { 'X-Auth-Session': expectedSID } : undefined,
      })
    } catch {
      throw new ApiError('Unable to restore your session. Please try again.')
    }
    if (generation !== getAuthSnapshot().generation)
      return getAuthSnapshot().status === 'authenticated'
    if (response.status === 401) {
      clearAuth({ verified: true })
      return false
    }
    if (response.status === 429) {
      throw new ApiError('Too many sign-in attempts. Please try again later.', 429)
    }
    let body: ApiEnvelope<unknown>
    try {
      body = (await response.json()) as ApiEnvelope<unknown>
      if (!body || typeof body !== 'object') throw new Error('Invalid response')
    } catch {
      throw new ApiError('Unable to restore your session. Please try again.', response.status)
    }
    if (generation !== getAuthSnapshot().generation)
      return getAuthSnapshot().status === 'authenticated'
    if (response.status === 409 && body.code === 'AUTH_SESSION_MISMATCH' && expectedSID) {
      // 同源另一个标签页已切换账户；只由刷新接口的 cookie 重新确定身份。
      expectedSID = undefined
      continue
    }
    if (response.status === 409 && body.code === 'AUTH_REFRESH_RACE' && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, [80, 200, 500][attempt]))
      continue
    }
    if (response.ok && body.success === true && isAuthBundle(body.data)) {
      acceptAuthBundle(body.data)
      return true
    }
    throw new ApiError(
      body.message_key || 'Unable to restore your session. Please try again.',
      response.status,
      body.code,
    )
  }
  throw new ApiError('Your session has changed. Please try again.', 409, 'AUTH_SESSION_MISMATCH')
}

// 同一标签页合并刷新，并与旧控制台共用浏览器锁以避免 refresh cookie 竞争。
export function refreshAuthentication(): Promise<boolean> {
  if (!refreshPromise) {
    const generation = getAuthSnapshot().generation
    const operation = async (): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request('new-api:auth-refresh', { mode: 'exclusive' }, () =>
          performRefresh(generation),
        )
      }
      return performRefresh(generation)
    }
    refreshPromise = operation()
      .catch((error: unknown) => {
        if (generation !== getAuthSnapshot().generation)
          return getAuthSnapshot().status === 'authenticated'
        suspendAuthentication(error)
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export async function resolveAuthentication(options?: {
  required?: boolean
  retry?: boolean
}): Promise<boolean> {
  const current = getAuthSnapshot()
  if (current.token && current.expiresAt > Date.now() / 1000 + 60) return true
  if (refreshPromise) return refreshPromise
  if (current.authenticationError && !options?.retry) throw current.authenticationError
  if (current.verified && current.status === 'anonymous' && !options?.retry) return false
  if (!options?.required && !hasSessionHint()) {
    if (current.status === 'loading' && !current.authenticationError) clearAuth()
    return false
  }
  return refreshAuthentication()
}

export async function ensureFreshAuthentication() {
  const current = getAuthSnapshot()
  if (current.token && current.expiresAt > Date.now() / 1000 + 60) return
  if (!(await resolveAuthentication({ required: true })))
    throw new ApiError('Please sign in to continue', 401, 'AUTH_UNAUTHORIZED')
  if (
    current.user &&
    (current.user.id !== getAuthSnapshot().user?.id ||
      current.session?.sid !== getAuthSnapshot().session?.sid)
  ) {
    throw new ApiError('Your session has changed. Please try again.', 409, 'AUTH_SESSION_CHANGED')
  }
}

// 写入和一次性授权请求从不自动重放；流式请求也只发送一次。
export async function authorizedFetch(
  path: string,
  options: RequestInit = {},
  expectedIdentity?: { userID: number | undefined; sessionID: string | undefined },
  internal?: { defer401?: boolean },
): Promise<Response> {
  localPath(path)
  const anonymous = anonymousEndpoints.test(path)
  if (!anonymous && (getAuthSnapshot().token || hasSessionHint())) await ensureFreshAuthentication()
  const current = getAuthSnapshot()
  if (
    expectedIdentity &&
    (expectedIdentity.userID !== current.user?.id ||
      expectedIdentity.sessionID !== current.session?.sid)
  ) {
    throw new ApiError('Your session has changed. Please try again.', 409, 'AUTH_SESSION_CHANGED')
  }
  const headers = new Headers(options.headers)
  if (current.token && !anonymous) headers.set('Authorization', `Bearer ${current.token}`)
  if (typeof options.body === 'string' && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  })
  if (
    !anonymous &&
    current.token &&
    (current.user?.id !== getAuthSnapshot().user?.id ||
      current.session?.sid !== getAuthSnapshot().session?.sid)
  ) {
    throw new ApiError('Your session has changed. Please try again.', 409, 'AUTH_SESSION_CHANGED')
  }
  if (
    !anonymous &&
    response.status === 401 &&
    !internal?.defer401 &&
    current.generation === getAuthSnapshot().generation
  )
    clearAuth({ verified: true })
  return response
}

export async function rawRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const identity = getAuthSnapshot()
  const headers = new Headers(options.headers)
  const canRetry =
    (!options.method || options.method.toUpperCase() === 'GET') &&
    !headers.has('X-Security-Proof') &&
    !anonymousEndpoints.test(path)
  let response = await authorizedFetch(path, options, undefined, { defer401: canRetry })
  if (response.status === 401 && canRetry && (await refreshAuthentication())) {
    response = await authorizedFetch(path, options, {
      userID: identity.user?.id,
      sessionID: identity.session?.sid,
    })
  }
  const envelope = await decodeEnvelope<T>(response)
  if (!anonymousEndpoints.test(path)) acceptAuthRotation(envelope.data)
  return envelope
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await rawRequest<T>(path, options)).data
}

export const jsonBody = (value: unknown): Pick<RequestInit, 'body' | 'headers'> => ({
  body: JSON.stringify(value),
  headers: { 'Content-Type': 'application/json' },
})
