import { queryOptions, useQuery } from '@tanstack/react-query'
import { request } from './api'
export interface SiteStatus {
  [key: string]: unknown
  frontend_available?: boolean
  frontend_enabled?: boolean
  system_name?: string
  logo?: string
  announcements_enabled?: boolean
  announcements?: unknown[]
  server_address?: string
  api_info_enabled?: boolean
  api_info?: Array<{ url: string; route: string; description: string }>
  quota_per_unit?: number
  quota_display_type?: 'USD' | 'CNY' | 'CUSTOM' | 'TOKENS'
  usd_exchange_rate?: number
  custom_currency_exchange_rate?: number
  custom_currency_symbol?: string
  password_login_enabled?: boolean
  password_register_enabled?: boolean
  register_enabled?: boolean
  password_login_encryption_enabled?: boolean
  email_verification?: boolean
  turnstile_check?: boolean
  turnstile_site_key?: string
  checkin_enabled?: boolean
  passkey_login?: boolean
  passkey_rp_id?: string
  passkey_rp_ids?: string[]
  user_agreement_enabled?: boolean
  privacy_policy_enabled?: boolean
  log_max_range_days?: number
  enable_drawing?: boolean
  enable_task?: boolean
}
export const statusQueryOptions = queryOptions({
  queryKey: ['status'],
  queryFn: () => request<SiteStatus>('/api/status'),
  staleTime: 60_000,
})
export function useStatus(options: { refetchOnWindowFocus?: boolean } = {}) {
  return useQuery({
    ...statusQueryOptions,
    ...options,
  })
}
