import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { languages } from '@/i18n/languages'
import { Button, Modal, Select } from './ui'

export function Preferences() {
  const { t, i18n } = useTranslation()
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('new-api-consumer:theme') || 'system'
    } catch {
      return 'system'
    }
  })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const syncTheme = (event: Event) => {
      const value = (event as CustomEvent<string>).detail
      if (['system', 'light', 'dark'].includes(value)) setTheme(value)
    }
    window.addEventListener('factory:theme-change', syncTheme)
    return () => window.removeEventListener('factory:theme-change', syncTheme)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    try {
      localStorage.setItem('new-api-consumer:theme', theme)
    } catch {
      /* Preferences are optional on restricted browsers. */
    }
    return () => media.removeEventListener('change', apply)
  }, [theme])
  return (
    <>
      <Button
        variant="ghost"
        className="icon-button"
        aria-label={t('Appearance and language')}
        onClick={() => setOpen(true)}
      >
        {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Make yourself at home')}>
        <div className="stack">
          <label className="field">
            <span>{t('Appearance')}</span>
            <Select
              value={theme}
              onValueChange={(value) =>
                window.dispatchEvent(new CustomEvent('factory:theme-change', { detail: value }))
              }
              options={[
                { value: 'system', label: t('Follow system') },
                { value: 'light', label: t('Light') },
                { value: 'dark', label: t('Dark') },
              ]}
            />
          </label>
          <label className="field">
            <span>{t('Language')}</span>
            <Select
              value={i18n.resolvedLanguage || i18n.language}
              onValueChange={(value) => void i18n.changeLanguage(value)}
              options={languages.map((lang) => ({ value: lang.id, label: lang.label }))}
            />
          </label>
        </div>
      </Modal>
    </>
  )
}
