export interface APIKey {
  id: number
  name: string
  key: string
  status: number
  group: string
  expired_time: number
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string | null
  cross_group_retry: boolean
  auto_groups: string[] | null
  allow_user_quota_query: boolean
}
