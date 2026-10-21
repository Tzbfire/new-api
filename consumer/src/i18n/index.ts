import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'
import { languages } from './languages'

const languageDetector = new LanguageDetector()
languageDetector.addDetector({
  name: 'deploymentDefault',
  lookup() {
    const language = process.env.PUBLIC_DEFAULT_LANGUAGE
    return languages.some(({ id }) => id === language) ? language : undefined
  },
})
languageDetector.addDetector({
  name: 'legacyPreference',
  lookup() {
    try {
      // Preserve explicit choices saved by earlier consumer builds.
      return localStorage.getItem('factory:language') || undefined
    } catch {
      return undefined
    }
  },
})

const loaders: Record<string, () => Promise<{ default: { translation: Record<string, string> } }>> =
  {
    'zh-TW': () => import('./locales/zh-TW.json'),
    ja: () => import('./locales/ja.json'),
    fr: () => import('./locales/fr.json'),
    ru: () => import('./locales/ru.json'),
    vi: () => import('./locales/vi.json'),
  }
const localeBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const loader = loaders[language]
    if (!loader) {
      callback(null, {})
      return
    }
    void loader().then(
      (data) => callback(null, data.default.translation),
      (error) => callback(error, false),
    )
  },
}
void i18n
  .use(localeBackend)
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, zh },
    partialBundledLanguages: true,
    supportedLngs: ['en', 'zh', 'zh-TW', 'ja', 'fr', 'ru', 'vi'],
    fallbackLng: 'en',
    load: 'currentOnly',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'legacyPreference', 'deploymentDefault', 'navigator'],
      lookupLocalStorage: 'new-api-consumer:language',
      caches: ['localStorage'],
    },
  })
  .then(() => {
    document.documentElement.lang =
      i18n.resolvedLanguage === 'zh' ? 'zh-CN' : i18n.resolvedLanguage || 'en'
  })
i18n.on('languageChanged', (lang) => {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
})
export default i18n
