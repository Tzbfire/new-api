import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { DayPicker } from 'react-day-picker'
import { enUS, zhCN, zhTW, fr, ja, ru, vi } from 'react-day-picker/locale'
import { SearchSelect } from '@/components/search-select'
import 'react-day-picker/style.css'

import './date-time-picker.css'

export interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  label: string
  min?: string
  max?: string
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  allowClear?: boolean
  disabled?: boolean
  triggerLabel?: string
  title?: string
  validationMessage?: string
  hideLabel?: boolean
}

/** Local date/time draft. Cancel never applies changes; min/max include the selected time. */
export function DateTimePicker(props: DateTimePickerProps) {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<Date | undefined>()
  const [time, setTime] = useState('12:00')
  const [error, setError] = useState(false)
  const value = props.value ? new Date(props.value) : null
  return (
    <div className="date-time-picker">
      <label
        htmlFor={props.id || generatedId}
        className={props.hideLabel ? 'sr-only' : 'field-label'}
      >
        {props.label}
      </label>
      <Button
        id={props.id || generatedId}
        variant="secondary"
        disabled={props.disabled}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        onClick={() => {
          setDate(value && Number.isFinite(value.getTime()) ? value : undefined)
          setTime(props.value.slice(11, 16) || '12:00')
          setError(false)
          setOpen(true)
        }}
      >
        {props.triggerLabel ||
          (value && Number.isFinite(value.getTime())
            ? value.toLocaleString(toIntlLocale(i18n.resolvedLanguage || i18n.language))
            : t('Choose date and time'))}
      </Button>
      <Modal
        className="date-time-picker-modal"
        open={open}
        onClose={() => setOpen(false)}
        title={props.title || props.label}
      >
        <div className="stack">
          <DayPicker
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={setDate}
            locale={
              ({ zh: zhCN, 'zh-TW': zhTW, fr, ja, ru, vi } as Record<string, typeof enUS>)[
                i18n.resolvedLanguage || i18n.language
              ] || enUS
            }
            disabled={[
              ...(props.min
                ? [{ before: new Date(new Date(props.min).setHours(0, 0, 0, 0)) }]
                : []),
              ...(props.max ? [{ after: new Date(new Date(props.max).setHours(0, 0, 0, 0)) }] : []),
            ]}
          />
          <SearchSelect
            label={t('Time')}
            value={time}
            onValueChange={setTime}
            options={[
              ...(!/^[0-2][0-9]:(00|30)$/.test(time) ? [{ value: time, label: time }] : []),
              ...Array.from({ length: 48 }, (_, index) => {
                const value = `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`
                return { value, label: value }
              }),
            ]}
          />
          <p className="field-hint">{t('Uses your device time zone.')}</p>
          {error && (
            <p role="alert" className="field-error">
              {props.validationMessage ||
                t('Choose a valid date and time within the allowed range.')}
            </p>
          )}
          <div className="dialog-actions">
            {props.allowClear && (
              <Button
                variant="ghost"
                onClick={() => {
                  props.onChange('')
                  setOpen(false)
                }}
              >
                {t('Clear date')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => {
                const nextDate = date ? new Date(date) : null
                const [hours, minutes] = time.split(':').map(Number)
                if (nextDate) nextDate.setHours(hours!, minutes!, 0, 0)
                if (
                  !nextDate ||
                  !Number.isFinite(nextDate.getTime()) ||
                  (props.min && nextDate.getTime() < new Date(props.min).getTime()) ||
                  (props.max && nextDate.getTime() > new Date(props.max).getTime())
                ) {
                  setError(true)
                  return
                }
                const local = new Date(nextDate.getTime() - nextDate.getTimezoneOffset() * 60000)
                props.onChange(local.toISOString().slice(0, 16))
                setOpen(false)
              }}
            >
              {t('Apply date')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
