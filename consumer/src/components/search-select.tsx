import { Combobox } from '@base-ui/react/combobox'
import { useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'

export interface SelectOption {
  value: string
  label: string
  description?: string
  searchText?: string
}

/** Searchable single selection; Base UI owns focus, keyboard navigation and dismissal. */
export function SearchSelect(props: {
  label: string
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  loading?: boolean
  footer?: ReactNode
  popupClassName?: string
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const id = props.id || generatedId
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const selected = props.options.find((option) => option.value === props.value) || null
  return (
    <div className="field search-select">
      <label className="field-label" htmlFor={id}>
        {props.label}
      </label>
      <Combobox.Root
        items={props.options}
        value={selected}
        open={open && !props.disabled}
        inputValue={search}
        disabled={props.disabled}
        locale={toIntlLocale(i18n.resolvedLanguage)}
        isItemEqualToValue={(item, value) => item.value === value.value}
        filter={(option, query) =>
          `${option.label} ${option.description || ''} ${option.searchText || ''} ${option.value}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        }
        onInputValueChange={(value, details) => {
          if (details.reason === 'input-change') setSearch(value)
        }}
        onOpenChange={(value) => {
          setOpen(value)
          setSearch('')
        }}
        onValueChange={(option) => {
          if (option) props.onValueChange(option.value)
        }}
      >
        <Combobox.Trigger
          id={id}
          className="input search-select-trigger"
          aria-label={props.label}
          aria-describedby={props['aria-describedby']}
          aria-invalid={props['aria-invalid']}
        >
          <span>{selected?.label || props.placeholder || t('Choose an option')}</span>
          <ChevronDown size={16} aria-hidden />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} align="start" className="search-select-positioner">
            <Combobox.Popup
              className={`search-select-popup ${props.popupClassName || ''}`}
              aria-busy={props.loading}
            >
              <div className="search-select-search">
                <Search size={16} aria-hidden />
                <Combobox.Input
                  ref={inputRef}
                  className="input"
                  aria-label={t('Search {{label}}', { label: props.label })}
                  placeholder={props.searchPlaceholder || t('Type to search…')}
                />
              </div>
              <Combobox.Empty className="search-select-empty">
                {t('No matching options')}
              </Combobox.Empty>
              <Combobox.List className="search-select-list">
                {(option: SelectOption) => (
                  <Combobox.Item
                    className="search-select-option"
                    key={option.value}
                    value={option}
                    disabled={props.loading}
                  >
                    <span className="search-select-option-copy">
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                    <Combobox.ItemIndicator>
                      <Check size={16} aria-hidden />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
              {props.footer && (
                <div
                  className="search-select-footer"
                  onClickCapture={() => inputRef.current?.focus({ preventScroll: true })}
                >
                  {props.footer}
                </div>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  )
}
