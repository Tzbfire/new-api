import { Check, CreditCard, Wallet } from 'lucide-react'
import { Button } from '@/components/ui'

export function PaymentMethods(props: {
  label: string
  methods: { type: string; name: string }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="stack" role="group" aria-label={props.label}>
      <span className="field-label">{props.label}</span>
      <div className="payment-method-grid">
        {props.methods.map((method) => (
          <Button
            key={method.type}
            variant="secondary"
            className="payment-method-card"
            aria-pressed={method.type === props.value}
            disabled={props.disabled}
            onClick={() => props.onChange(method.type)}
          >
            <span className={`payment-brand payment-brand-${method.type}`} aria-hidden="true">
              {method.type === 'balance' || method.type === 'vip' ? (
                <Wallet size={21} />
              ) : (
                <CreditCard size={21} />
              )}
            </span>
            <span>{method.name}</span>
            {method.type === props.value && <Check size={17} aria-hidden="true" />}
          </Button>
        ))}
      </div>
    </div>
  )
}
