import { rawRequest, request } from '@/lib/api'

export interface PaymentMethod {
  name: string
  type: string
  min_topup?: string | number
}
export interface CreemProduct {
  productId: string
  name: string
  price: number
  currency: string
  quota: number
}
export interface TopupInfo {
  enable_online_topup: boolean
  enable_stripe_topup: boolean
  enable_creem_topup?: boolean
  enable_waffo_topup?: boolean
  enable_waffo_pancake_topup?: boolean
  enable_redemption?: boolean
  payment_compliance_confirmed?: boolean
  pay_methods: PaymentMethod[]
  min_topup: number
  stripe_min_topup: number
  waffo_min_topup: number
  waffo_pancake_min_topup: number
  request_min_topup?: Record<string, number>
  payment_currencies?: Record<string, string>
  request_amount_unit?: string
  waffo_pay_methods?: Array<{
    name: string
    payMethodType: string
    payMethodName: string
    icon?: string
  }>
  amount_options?: number[]
  creem_products?: string | CreemProduct[]
  topup_link?: string
}
export interface SubscriptionPlan {
  id: number
  title: string
  subtitle: string
  price_amount: number
  currency: string
  duration_unit: string
  duration_value: number
  custom_seconds: number
  total_amount: number
  quota_reset_period: string
  quota_reset_custom_seconds: number
  allowed_token_groups: string
  allow_wallet_overflow: boolean
  allow_balance_pay: boolean
  upgrade_group: string
  stripe_price_id?: string
  creem_product_id?: string
  waffo_pancake_product_id?: string
  max_purchase_per_user: number
}
export interface UserSubscription {
  id: number
  plan_id: number
  amount_total: number
  amount_used: number
  start_time: number
  end_time: number
  status: string
  next_reset_time: number
  allowed_token_groups: string
  allow_wallet_overflow: boolean
}
export interface SubscriptionSelf {
  billing_preference: string
  subscriptions: { subscription: UserSubscription }[]
  all_subscriptions: { subscription: UserSubscription }[]
}
export interface Checkout {
  url: string
  fields?: Record<string, string>
}

export function paymentURL(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('The payment provider did not return a checkout link.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('The payment link is invalid.')
  return url.href
}

/** 支付响应只保留结账所需信息；不缓存供应商会话 token，不在浏览器确认到账。 */
export async function createCheckout(
  path: string,
  payload: Record<string, unknown>,
): Promise<Checkout> {
  const response = await rawRequest<Record<string, unknown>>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (typeof response.url === 'string') {
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.data || {})) {
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new Error('The payment provider returned invalid checkout details.')
      fields[key] = String(value)
    }
    return { url: paymentURL(response.url), fields }
  }
  return {
    url: paymentURL(
      response.data?.pay_link || response.data?.checkout_url || response.data?.payment_url,
    ),
  }
}

export function quoteEndpoint(method: string) {
  if (method === 'stripe') return '/api/user/stripe/amount'
  if (method === 'waffo') return '/api/user/waffo/amount'
  if (method === 'waffo_pancake') return '/api/user/waffo-pancake/amount'
  return '/api/user/amount'
}
export function topupEndpoint(method: string) {
  if (method === 'stripe') return '/api/user/stripe/pay'
  if (method === 'creem') return '/api/user/creem/pay'
  if (method === 'waffo') return '/api/user/waffo/pay'
  if (method === 'waffo_pancake') return '/api/user/waffo-pancake/pay'
  return '/api/user/pay'
}
export function getTopupInfo() {
  return request<TopupInfo>('/api/user/topup/info')
}
export function getSubscriptions() {
  return request<SubscriptionSelf>('/api/subscription/self')
}
export function getPlans() {
  return request<{ plan: SubscriptionPlan }[]>('/api/subscription/plans')
}

export function enabledMethods(info: TopupInfo): PaymentMethod[] {
  const seen = new Set<string>()
  const methods: PaymentMethod[] = []
  for (const method of info.pay_methods || []) {
    if (typeof method?.type !== 'string' || typeof method.name !== 'string') continue
    const type = method.type.trim()
    const name = method.name.trim()
    if (!type || !name || seen.has(type)) continue
    let enabled = info.enable_online_topup === true
    if (type === 'stripe') enabled = info.enable_stripe_topup === true
    if (type === 'waffo') enabled = info.enable_waffo_topup === true
    if (type === 'waffo_pancake') enabled = info.enable_waffo_pancake_topup === true
    if (type === 'creem') enabled = info.enable_creem_topup === true
    if (!enabled) continue
    seen.add(type)
    methods.push({ ...method, type, name })
  }
  return methods
}
export function creemProducts(info?: TopupInfo): CreemProduct[] {
  if (!info?.enable_creem_topup) return []
  try {
    const value: unknown =
      typeof info.creem_products === 'string'
        ? JSON.parse(info.creem_products)
        : info.creem_products
    if (!Array.isArray(value)) return []
    return value.filter(
      (entry): entry is CreemProduct =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.productId === 'string' &&
        typeof entry.price === 'number' &&
        typeof entry.name === 'string' &&
        typeof entry.currency === 'string' &&
        typeof entry.quota === 'number',
    )
  } catch {
    return []
  }
}
