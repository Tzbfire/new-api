import { toIntlLocale } from '@/i18n/languages'
import type { SiteStatus } from './status'
export function formatNumber(value: number, locale?: string, digits?: FractionDigits): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 4,
    ...digits,
  }).format(value)
}
type FractionDigits = Pick<
  Intl.NumberFormatOptions,
  'minimumFractionDigits' | 'maximumFractionDigits'
>

export function formatMoney(
  value: number,
  currency = 'USD',
  locale?: string,
  digits?: FractionDigits,
): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'currency',
    currency,
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    ...digits,
  }).format(value)
}
/** 只转换服务端额度的展示单位，不参与报价、支付或实际结算。 */
export function formatQuota(
  quota: number,
  status?: SiteStatus,
  locale?: string,
  digits?: FractionDigits,
): string {
  if (!status?.quota_per_unit || status.quota_display_type === 'TOKENS')
    return `${formatNumber(quota, locale)} quota`
  const usd = quota / status.quota_per_unit
  if (status.quota_display_type === 'CNY')
    return formatMoney(usd * (status.usd_exchange_rate || 1), 'CNY', locale, digits)
  if (status.quota_display_type === 'CUSTOM')
    return `${status.custom_currency_symbol || ''}${new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: 4, ...digits }).format(usd * (status.custom_currency_exchange_rate || 1))}`
  return formatMoney(usd, 'USD', locale, digits)
}
/** Monetary balance and allowance summaries use cents; request charges retain their precision. */
export function formatBalance(quota: number, status?: SiteStatus, locale?: string): string {
  return formatQuota(quota, status, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatDate(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

/** Display an observed duration; missing measurements remain distinct from a recorded zero. */
export function formatDurationMilliseconds(
  milliseconds: number | null | undefined,
  locale?: string,
): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0)
    return '—'
  let divisor = 1
  let unit = 'millisecond'
  if (milliseconds >= 3_600_000) {
    divisor = 3_600_000
    unit = 'hour'
  } else if (milliseconds >= 60_000) {
    divisor = 60_000
    unit = 'minute'
  } else if (milliseconds >= 1000) {
    divisor = 1000
    unit = 'second'
  }
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 2,
  }).format(milliseconds / divisor)
}
