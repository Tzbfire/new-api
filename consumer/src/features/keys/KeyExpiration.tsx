import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { DateTimePicker } from '@/components/date-time-picker'

/** Presets change only the draft; saving the key remains an explicit action. */
export function KeyExpiration(props: { value: string; onChange: (value: string) => void }) {
  const { t, i18n } = useTranslation()
  const [preset, setPreset] = useState<number | null>(null)
  const value = props.value ? new Date(props.value) : null
  const label =
    value && Number.isFinite(value.getTime())
      ? value.toLocaleString(toIntlLocale(i18n.resolvedLanguage || i18n.language))
      : t('Never')
  return (
    <div className="stack key-expiration">
      <span className="field-label">{t('Expiration time')}</span>
      <div className="row key-expiration-presets">
        <Button
          variant="secondary"
          aria-pressed={!props.value}
          onClick={() => {
            setPreset(null)
            props.onChange('')
          }}
        >
          {t('Never')}
        </Button>
        {[7, 30, 90].map((days) => (
          <Button
            key={days}
            variant="secondary"
            aria-pressed={preset === days}
            onClick={() => {
              setPreset(days)
              const next = new Date(Date.now() + days * 86400000)
              const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000)
              props.onChange(local.toISOString().slice(0, 16))
            }}
          >
            {t('{{count}} days', { count: days })}
          </Button>
        ))}
        <DateTimePicker
          value={props.value}
          onChange={(next) => {
            setPreset(null)
            props.onChange(next)
          }}
          label={t('Expiration time')}
          hideLabel
          triggerLabel={t('Custom date')}
          title={t('Choose expiration date')}
          min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 60000)
            .toISOString()
            .slice(0, 16)}
          validationMessage={t('Choose an expiration time in the future.')}
        />
      </div>
      <p role="status" className="field-hint">
        {label}
      </p>
    </div>
  )
}
