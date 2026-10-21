import { ApiError, authorizedFetch, decodeEnvelope, jsonBody, request } from './api'
import type { SecurityOperation } from './security'
import type { SiteStatus } from './status'
import { getAuthSnapshot } from './auth-state'

export interface OAuthProviderOption {
  slug: string
  name: string
}
interface OAuthStart {
  flow_token: string
  expires_at: number
  authorization_url: string
}
export interface OAuthCallback {
  kind: 'new-api-consumer-oauth'
  provider: string
  state: string
  code?: string
  error?: string
}
let oauthActive = false

export function enabledOAuthProviders(status?: SiteStatus): OAuthProviderOption[] {
  if (!status) return []
  const providers: OAuthProviderOption[] = []
  for (const [flag, slug, name] of [
    ['github_oauth', 'github', 'GitHub'],
    ['discord_oauth', 'discord', 'Discord'],
    ['oidc_enabled', 'oidc', String(status.oidc_display_name || 'OpenID Connect')],
    ['linuxdo_oauth', 'linuxdo', 'Linux DO'],
    ['telegram_oauth_configured', 'telegram', 'Telegram'],
  ])
    if (status[flag] === true) providers.push({ slug, name })
  if (Array.isArray(status.custom_oauth_providers)) {
    for (const item of status.custom_oauth_providers) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.slug === 'string' &&
        typeof item.name === 'string' &&
        /^[A-Za-z0-9_-]+$/.test(item.slug)
      )
        providers.push({ slug: item.slug, name: item.name })
    }
  }
  return providers
}

export function validOAuthCallback(
  event: MessageEvent,
  popup: Window,
  provider: string,
  state: string,
): event is MessageEvent<OAuthCallback> {
  const data: unknown = event.data
  if (
    event.origin !== window.location.origin ||
    event.source !== popup ||
    !data ||
    typeof data !== 'object'
  )
    return false
  const callback = data as Partial<OAuthCallback>
  return (
    callback.kind === 'new-api-consumer-oauth' &&
    callback.provider === provider &&
    callback.state === state &&
    ((typeof callback.code === 'string' && callback.code.length > 0) ||
      typeof callback.error === 'string')
  )
}

// 授权状态只保存在发起页内存；回调窗口必须同时匹配 origin、source、服务商与 state。
export async function startOAuth<T>(
  provider: string,
  intent: 'login' | 'bind' | 'verify',
  operation?: SecurityOperation,
  proof?: string,
): Promise<T> {
  const identity = getAuthSnapshot()
  if (oauthActive) throw new ApiError('An authorization window is already open')
  if (!/^[A-Za-z0-9_-]+$/.test(provider)) throw new ApiError('Unknown OAuth provider')
  const popup = window.open('about:blank', '_blank', 'popup,width=540,height=720')
  if (!popup) throw new ApiError('Allow pop-up windows to continue signing in')
  oauthActive = true
  let removeListener: () => void = () => undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const start = await request<OAuthStart>('/api/oauth/state', {
      method: 'POST',
      ...jsonBody({
        provider,
        intent,
        callback_target: 'consumer',
        ...(operation ? { scope: operation.scope, context: operation.context } : {}),
      }),
      headers: {
        'Content-Type': 'application/json',
        ...(proof ? { 'X-Security-Proof': proof } : {}),
      },
    })
    if (!start.authorization_url)
      throw new ApiError(
        'Third-party sign-in requires an updated server. Please contact the administrator.',
      )
    const authorization = new URL(start.authorization_url)
    const redirectURI = new URL(authorization.searchParams.get('redirect_uri') || '')
    if (
      authorization.protocol !== 'https:' ||
      authorization.username ||
      redirectURI.origin !== window.location.origin ||
      ![`/oauth/${provider}`, `/app/oauth/${provider}`].includes(redirectURI.pathname) ||
      authorization.searchParams.get('state') !== start.flow_token
    ) {
      throw new ApiError('Third-party sign-in is not configured for this website')
    }
    const callback = new Promise<OAuthCallback>((resolve, reject) => {
      const listener = (event: MessageEvent) => {
        if (!validOAuthCallback(event, popup, provider, start.flow_token)) return
        removeListener()
        if (interval) clearInterval(interval)
        resolve(event.data)
      }
      removeListener = () => window.removeEventListener('message', listener)
      window.addEventListener('message', listener)
      interval = setInterval(() => {
        if (popup.closed) reject(new ApiError('Authorization was cancelled'))
      }, 500)
      timer = setTimeout(
        () => reject(new ApiError('Verification flow expired')),
        Math.max(0, Math.min(600_000, start.expires_at * 1000 - Date.now())),
      )
    })
    popup.location.href = authorization.toString()
    const result = await callback
    if (
      identity.user?.id !== getAuthSnapshot().user?.id ||
      identity.session?.sid !== getAuthSnapshot().session?.sid
    ) {
      throw new ApiError('Your session has changed. Please try again.')
    }
    const search = new URLSearchParams({ state: result.state })
    if (result.code) search.set('code', result.code)
    if (result.error) search.set('error', result.error)
    // 回调会消费一次性 flow，不使用 GET 的自动重试路径。
    const response = await authorizedFetch(
      `/api/oauth/${provider}?${search}`,
      {},
      { userID: identity.user?.id, sessionID: identity.session?.sid },
    )
    return (await decodeEnvelope<T>(response)).data
  } finally {
    removeListener()
    if (interval) clearInterval(interval)
    if (timer) clearTimeout(timer)
    popup.close()
    oauthActive = false
  }
}
