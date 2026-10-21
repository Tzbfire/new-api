export const languages = [
  { id: 'zh', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'fr', label: 'Français' },
  { id: 'ru', label: 'Русский' },
  { id: 'vi', label: 'Tiếng Việt' },
] as const
/** 将界面语言转换为 Intl 支持的 BCP 47 标签，未知语言安全回退。 */
export function toIntlLocale(language?: string): string {
  const locales: Record<string, string> = {
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
  if (language && Object.values(locales).includes(language)) return language
  return locales[language || 'en'] || 'en-US'
}
