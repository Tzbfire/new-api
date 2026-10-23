import { describe, expect, it } from 'vitest'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatBalance,
  formatDate,
  formatDurationMilliseconds,
  formatMoney,
  formatNumber,
  formatQuota,
} from '../format'

const locales = [
  ['zh', 'zh-CN'],
  ['zhCN', 'zh-CN'],
  ['zhTW', 'zh-TW'],
  ['zh-TW', 'zh-TW'],
  ['en', 'en-US'],
  ['ja', 'ja-JP'],
  ['fr', 'fr-FR'],
  ['ru', 'ru-RU'],
  ['vi', 'vi-VN'],
] as const

describe('display locales and quota units', () => {
  it.each(locales)(
    'accepts %s and preserves %s through repeated normalization',
    (language, canonical) => {
      expect(toIntlLocale(language)).toBe(canonical)
      expect(toIntlLocale(toIntlLocale(language))).toBe(canonical)
      expect(formatNumber(1234.5678, language)).toBe(
        new Intl.NumberFormat(canonical, { maximumFractionDigits: 4 }).format(1234.5678),
      )
      expect(formatMoney(12.3456, 'USD', toIntlLocale(language))).toBe(
        new Intl.NumberFormat(canonical, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 6,
          minimumFractionDigits: 2,
        }).format(12.3456),
      )
      expect(formatDate(1_700_000_000, canonical)).toBe(
        new Intl.DateTimeFormat(canonical, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(1_700_000_000_000),
        ),
      )
    },
  )

  it('falls back safely for malformed interface locale values', () => {
    for (const language of [
      '',
      'not-a-supported-locale',
      'bad_locale',
      'constructor',
      'toString',
      '__proto__',
      undefined,
    ]) {
      expect(toIntlLocale(language)).toBe('en-US')
      expect(() => formatMoney(1, 'USD', language)).not.toThrow()
    }
  })

  it('uses the server quota unit and preserves zero rather than assuming a fixed conversion', () => {
    expect(formatQuota(0, { quota_per_unit: 250_000 }, 'en')).toBe('$0.00')
    expect(formatQuota(500_000, { quota_per_unit: 250_000 }, 'en')).toBe('$2.00')
    expect(formatQuota(500_000, undefined, 'en')).toBe('500,000 quota')
  })

  it('converts display currency only with the server supplied exchange setting', () => {
    expect(
      formatQuota(
        500_000,
        { quota_per_unit: 500_000, quota_display_type: 'CNY', usd_exchange_rate: 7.25 },
        'zhCN',
      ),
    ).toBe(
      new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 6,
        minimumFractionDigits: 2,
      }).format(7.25),
    )
    expect(
      formatQuota(
        500_000,
        {
          quota_per_unit: 500_000,
          quota_display_type: 'CUSTOM',
          custom_currency_exchange_rate: 3,
          custom_currency_symbol: '¤',
        },
        'en',
      ),
    ).toBe('¤3')
  })
})

describe('duration display', () => {
  it.each([
    [0, '0 ms'],
    [500, '500 ms'],
    [1000, '1 sec'],
    [1302, '1.3 sec'],
    [60000, '1 min'],
    [90000, '1.5 min'],
    [3600000, '1 hr'],
    [5400000, '1.5 hr'],
  ])('formats %s ms as %s', (value, expected) => {
    expect(formatDurationMilliseconds(value, 'en')).toBe(expected)
  })
  it.each(locales)('uses a valid localized unit for %s', (language, canonical) => {
    expect(formatDurationMilliseconds(1500, language)).toBe(
      new Intl.NumberFormat(canonical, {
        style: 'unit',
        unit: 'second',
        unitDisplay: 'short',
        maximumFractionDigits: 2,
      }).format(1.5),
    )
  })
  it('retains missing and invalid duration as unknown', () => {
    for (const value of [undefined, null, NaN, Infinity, -1])
      expect(formatDurationMilliseconds(value, 'zhCN')).toBe('—')
  })
})

describe('balance display precision', () => {
  it.each(locales)('shows two decimal currency balances in %s', (language, canonical) => {
    expect(formatBalance(6172839, { quota_per_unit: 500000 }, language)).toBe(
      new Intl.NumberFormat(canonical, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(12.345678),
    )
  })
  it('uses server exchange rates for CNY and custom balance displays', () => {
    expect(
      formatBalance(
        6172839,
        { quota_per_unit: 500000, quota_display_type: 'CNY', usd_exchange_rate: 7 },
        'en',
      ),
    ).toBe('CN¥86.42')
    expect(
      formatBalance(
        6172839,
        {
          quota_per_unit: 500000,
          quota_display_type: 'CUSTOM',
          custom_currency_exchange_rate: 3,
          custom_currency_symbol: '¤',
        },
        'en',
      ),
    ).toBe('¤37.04')
  })
  it('preserves quota units and fine grained request charges', () => {
    expect(
      formatBalance(12.3456, { quota_per_unit: 500000, quota_display_type: 'TOKENS' }, 'en'),
    ).toBe('12.3456 quota')
    expect(formatBalance(1234, undefined, 'bad_locale')).toBe('1,234 quota')
    expect(formatQuota(1, { quota_per_unit: 500000 }, 'en')).toBe('$0.000002')
    expect(formatMoney(0.000002, 'USD', 'en')).toBe('$0.000002')
    expect(formatBalance(0, { quota_per_unit: 500000 }, 'en')).toBe('$0.00')
  })
})
