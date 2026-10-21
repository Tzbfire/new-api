import { Dialog } from '@base-ui/react/dialog'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  Minus,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ComponentProps,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    busy?: boolean
  },
) {
  const { variant = 'primary', busy, className = '', children, ...rest } = props
  return (
    <button
      {...rest}
      type={props.type || 'button'}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`button button-${variant} ${className}`}
    >
      {busy && <LoaderCircle className="spin" size={16} aria-hidden />}
      {children}
    </button>
  )
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />
}
export function Select(props: {
  value: string | number
  onValueChange: (value: string) => void
  options: { value: string | number; label: ReactNode; disabled?: boolean }[]
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const items = props.options.map((option) => ({ ...option, value: String(option.value) }))
  return (
    <SelectPrimitive.Root
      value={String(props.value)}
      items={items}
      disabled={props.disabled}
      required={props.required}
      name={props.name}
      onValueChange={(value) => {
        if (value !== null) props.onValueChange(value)
      }}
    >
      <SelectPrimitive.Trigger
        id={props.id}
        className={`input select-trigger ${props.className || ''}`}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={16} aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          sideOffset={6}
          align="start"
          className="select-positioner"
        >
          <SelectPrimitive.Popup className="select-popup">
            <SelectPrimitive.List>
              {items.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="select-option"
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check size={16} aria-hidden />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
export function Checkbox(
  props: Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'className' | 'children'> & {
    className?: string
  },
) {
  return (
    <CheckboxPrimitive.Root {...props} className={`checkbox ${props.className || ''}`}>
      <CheckboxPrimitive.Indicator>
        {props.indeterminate ? <Minus size={14} aria-hidden /> : <Check size={14} aria-hidden />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`input textarea ${props.className || ''}`} />
}
export function Field(props: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  const generatedID = useId()
  const child = isValidElement(props.children)
    ? (props.children as ReactElement<{
        id?: string
        'aria-describedby'?: string
        'aria-invalid'?: boolean
      }>)
    : null
  const inputID = child?.props.id || generatedID
  const describedBy =
    [
      child?.props['aria-describedby'],
      props.hint ? `${generatedID}-hint` : '',
      props.error ? `${generatedID}-error` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={inputID} className="field-label">
        {props.label}
      </label>
      {child
        ? cloneElement(child, {
            id: inputID,
            'aria-describedby': describedBy,
            'aria-invalid': props.error ? true : child.props['aria-invalid'],
          })
        : props.children}
      {props.hint && (
        <span id={`${generatedID}-hint`} className="field-hint">
          {props.hint}
        </span>
      )}
      {props.error && (
        <span id={`${generatedID}-error`} className="field-error" role="alert">
          {props.error}
        </span>
      )}
    </div>
  )
}
export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`card ${props.className || ''}`} />
}
export function Badge(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`badge ${props.className || ''}`} />
}
export function PageHeader(props: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  compact?: boolean
}) {
  return (
    <header className={`page-header${props.compact ? ' page-header-compact' : ''}`}>
      <div>
        {props.eyebrow && <span className="eyebrow">{props.eyebrow}</span>}
        <h1>{props.title}</h1>
        {props.description && <p className="muted">{props.description}</p>}
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </header>
  )
}
export function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="state" role="status">
      <LoaderCircle className="spin" size={25} aria-hidden />
      <p>{t('Loading your space…')}</p>
    </div>
  )
}
export function ErrorState(props: { error: unknown; retry?: () => void; title?: string }) {
  const { t } = useTranslation()
  const message =
    props.error instanceof Error
      ? props.error.message
      : t('Something went wrong. Please try again.')
  return (
    <div className="state error-state" role="alert">
      <AlertCircle aria-hidden />
      <h3>{props.title || t('Could not load this content')}</h3>
      <p>
        {t(
          message,
          props.error instanceof Error && 'params' in props.error
            ? (props.error.params as Record<string, unknown>)
            : {},
        )}
      </p>
      {props.retry && (
        <Button variant="secondary" onClick={props.retry}>
          {t('Try again')}
        </Button>
      )}
    </div>
  )
}
export function EmptyState(props: {
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={props.compact ? 'state state-compact' : 'state'}>
      {!props.compact && (
        <span className="empty-icon">
          <Sparkles aria-hidden />
        </span>
      )}
      <h3>{props.title}</h3>
      {props.description && <p className="muted">{props.description}</p>}
      {props.action}
    </div>
  )
}
export function Modal(props: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className={`modal ${props.className || ''}`}
          aria-describedby={props.description ? id : undefined}
        >
          <div className="row modal-heading">
            <Dialog.Title>{props.title}</Dialog.Title>
            <Dialog.Close className="button button-ghost icon-button" aria-label={t('Close')}>
              <X size={19} />
            </Dialog.Close>
          </div>
          {props.description && (
            <Dialog.Description id={id} className="muted">
              {props.description}
            </Dialog.Description>
          )}
          {props.children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function ConfirmDialog(props: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  busy?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Modal {...props}>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose} disabled={props.busy}>
          {t('Cancel')}
        </Button>
        <Button variant="danger" onClick={props.onConfirm} busy={props.busy}>
          {t('Confirm')}
        </Button>
      </div>
    </Modal>
  )
}
export function CopyButton(props: { value: string; label?: string }) {
  const { t } = useTranslation()
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const copied = copiedValue === props.value
  const [error, setError] = useState(false)
  return (
    <span className="copy-control">
      <Button
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.value)
            setCopiedValue(props.value)
            setError(false)
          } catch {
            setCopiedValue(null)
            setError(true)
          }
        }}
        aria-label={copied ? t('Copied') : props.label || t('Copy')}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {props.label || (copied ? t('Copied') : t('Copy'))}
      </Button>
      {error && (
        <span role="alert" className="field-error">
          {t('Copy failed. Select and copy the text manually.')}
        </span>
      )}
    </span>
  )
}
