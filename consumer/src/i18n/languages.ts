export const languages = [
  { id: 'zh', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'fr', label: 'Français' },
  { id: 'ru', label: 'Русский' },
  { id: 'vi', label: 'Tiếng Việt' },
] as const

const intlLocales: Record<string, string> = {
  zh: 'zh-CN',
  zhCN: 'zh-CN',
  'zh-CN': 'zh-CN',
  zhTW: 'zh-TW',
  'zh-TW': 'zh-TW',
  en: 'en-US',
  fr: 'fr-FR',
  ru: 'ru-RU',
  ja: 'ja-JP',
  vi: 'vi-VN',
}

/** Resolve each preference before i18next compares the ordered detector results. */
export function toSupportedLanguage(
  language?: string,
): (typeof languages)[number]['id'] | undefined {
  if (!language) return undefined
  const alias = Object.prototype.hasOwnProperty.call(intlLocales, language)
    ? intlLocales[language]
    : language
  const locale = alias.replace(/_/g, '-').toLowerCase()
  const [base, ...subtags] = locale.split('-')
  if (base === 'zh') {
    if (subtags.includes('hant')) return 'zh-TW'
    if (subtags.includes('hans')) return 'zh'
    return subtags.some((tag) => ['tw', 'hk', 'mo'].includes(tag)) ? 'zh-TW' : 'zh'
  }
  return languages.find(({ id }) => id === base)?.id
}

/** 将界面语言转换为 Intl 支持的 BCP 47 标签，未知语言安全回退。 */
export function toIntlLocale(language?: string): string {
  if (language && Object.values(intlLocales).includes(language)) return language
  if (language && Object.prototype.hasOwnProperty.call(intlLocales, language))
    return intlLocales[language]
  return 'en-US'
}
