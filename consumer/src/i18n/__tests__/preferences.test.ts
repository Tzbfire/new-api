import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', '')
  localStorage.clear()
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('uses the browser language when the deployment has no default', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('fr'))
  expect(document.documentElement.lang).toBe('fr')
})

it('uses the configured Chinese default even when the browser is English', async () => {
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'zh')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('zh'))
  expect(language.t('AI model platform')).toBe('AI 模型平台')
  expect(document.documentElement.lang).toBe('zh-CN')
})

it('preserves a manual language selection over the deployment default after reload', async () => {
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'zh')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.isInitialized).toBe(true))
  await language.changeLanguage('en')
  expect(localStorage.getItem('new-api-consumer:language')).toBe('en')
  vi.resetModules()
  const reloaded = (await import('../index')).default
  await waitFor(() => expect(reloaded.resolvedLanguage).toBe('en'))
  expect(document.documentElement.lang).toBe('en')
})

it('migrates a saved legacy language choice instead of applying the deployment default', async () => {
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'zh')
  localStorage.setItem('factory:language', 'ja')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('ja'))
  expect(localStorage.getItem('new-api-consumer:language')).toBe('ja')
})

it('prefers the current saved selection over a legacy selection', async () => {
  localStorage.setItem('new-api-consumer:language', 'vi')
  localStorage.setItem('factory:language', 'ja')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('vi'))
})

it.each(['invalid-locale', 'constructor', 'toString', '__proto__'])(
  'ignores unsupported saved and configured language %s and falls back to English',
  async (unsupported) => {
    vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', unsupported)
    localStorage.setItem('new-api-consumer:language', unsupported)
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const { default: language } = await import('../index')
    await waitFor(() => expect(language.resolvedLanguage).toBe('en'))
  },
)

it('retains the Traditional Chinese browser locale', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-TW')
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-TW'])
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('zh-TW'))
  expect(document.documentElement.lang).toBe('zh-TW')
})

it.each([
  { browser: ['zh-CN', 'en'], expected: 'zh' },
  { browser: ['zh-Hans-CN', 'en-US', 'en'], expected: 'zh' },
  { browser: ['zh-Hant-TW', 'en'], expected: 'zh-TW' },
  { browser: ['zh-HK', 'en'], expected: 'zh-TW' },
  { browser: ['zh-Hans-HK', 'en'], expected: 'zh' },
  { browser: ['en-GB', 'zh'], expected: 'en' },
  { browser: ['de-DE', 'zh-CN', 'en'], expected: 'zh' },
])('respects the first supported browser preference in $browser', async ({ browser, expected }) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(browser)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(browser[0])
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe(expected))
})

it.each([
  { saved: 'zhCN', expected: 'zh' },
  { saved: 'zhTW', expected: 'zh-TW' },
  { saved: 'fr-CA', expected: 'fr' },
])(
  'keeps saved $saved ahead of the browser and deployment default',
  async ({ saved, expected }) => {
    vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'en')
    localStorage.setItem('new-api-consumer:language', saved)
    const { default: language } = await import('../index')
    await waitFor(() => expect(language.resolvedLanguage).toBe(expected))
    expect(localStorage.getItem('new-api-consumer:language')).toBe(expected)
  },
)

it('migrates a legacy Traditional Chinese alias before the deployment default', async () => {
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'en')
  localStorage.setItem('factory:language', 'zhTW')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('zh-TW'))
})

it('uses navigator.language when the preferred language list is empty', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([])
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('zh'))
})

it('keeps the explicit deployment default ahead of a supported browser preference', async () => {
  vi.stubEnv('PUBLIC_DEFAULT_LANGUAGE', 'en')
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN', 'zh'])
  const { default: language } = await import('../index')
  await waitFor(() => expect(language.resolvedLanguage).toBe('en'))
})
