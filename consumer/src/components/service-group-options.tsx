import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ServiceGroup } from '@/lib/catalog'
import { toIntlLocale } from '@/i18n/languages'
import { Button } from './ui'
import './service-group-options.css'

/** Visible service choices using the same authoritative groups as the catalog. */
export function ServiceGroupOptions(props: {
  label?: string
  value: string
  groups: Array<ServiceGroup & { disabled?: boolean; status?: string }>
  onValueChange: (value: string) => void
  status?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // Multipliers need more precision than the ordinary four-decimal number display.
  const ratioFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 })
  const selected = props.groups.find((group) => group.id === props.value)
  return (
    <fieldset className="service-group-options">
      <legend>{props.label || t('Service plan')}</legend>
      <div className="service-group-options-list">
        {props.groups.map((group) => (
          <Button
            key={group.id}
            variant="secondary"
            className="service-group-option"
            disabled={group.disabled}
            aria-pressed={group.id === props.value}
            onClick={() => props.onValueChange(group.id)}
          >
            <span className="service-group-option-label">
              {group.id === props.value && <Check size={14} aria-hidden />}
              <strong>{group.id}</strong>
              <span className="service-group-option-ratio">
                {group.ratio === 'auto'
                  ? t('Automatic routing')
                  : `${ratioFormatter.format(group.ratio)}×`}
              </span>
            </span>
            {group.status && <small>{group.status}</small>}
          </Button>
        ))}
      </div>
      {(props.status || selected?.desc) && (
        <div className="service-group-options-note">
          {props.status}
          {selected?.desc && <span>{selected.desc}</span>}
        </div>
      )}
    </fieldset>
  )
}
