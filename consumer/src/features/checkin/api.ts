import { authorizedFetch, decodeEnvelope, request } from '@/lib/api'

export interface CheckinClock {
  today: string
  server_time: number
  next_reset_at: number
  timezone: string
}
export interface CheckinStatus extends CheckinClock {
  enabled: boolean
  min_quota: number
  max_quota: number
  stats: {
    checked_in_today: boolean
    checkin_count: number
    total_checkins: number
    total_quota: number
    records: { checkin_date: string; quota_awarded: number }[]
  }
}
export interface CheckinReward extends CheckinClock {
  quota_awarded: number
  checkin_date: string
}

export function getCheckinStatus(signal: AbortSignal, month?: string) {
  const query = month ? `?month=${encodeURIComponent(month)}` : ''
  return request<CheckinStatus>(`/api/user/checkin${query}`, { signal })
}

export async function claimCheckin(
  token: string,
  identity: { userID: number | undefined; sessionID: string | undefined },
) {
  const query = token ? `?turnstile=${encodeURIComponent(token)}` : ''
  const response = await authorizedFetch(`/api/user/checkin${query}`, { method: 'POST' }, identity)
  return (await decodeEnvelope<CheckinReward>(response)).data
}
