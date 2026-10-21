import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'

interface TurnstileAPI {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileAPI
  }
}
let turnstileScript: Promise<void> | undefined

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (!turnstileScript) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        script.remove()
        turnstileScript = undefined
        reject(new Error('Unable to load verification'))
      }
      document.head.appendChild(script)
    })
  }
  return turnstileScript
}

export function Turnstile(props: { siteKey: string; onToken: (token: string) => void }) {
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  const callback = useRef(props.onToken)
  callback.current = props.onToken
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let disposed = false
    let id: string | undefined
    setFailed(false)
    callback.current('')
    void loadTurnstile()
      .then(() => {
        if (disposed || !target.current || !window.turnstile) return
        id = window.turnstile.render(target.current, {
          sitekey: props.siteKey,
          theme: 'auto',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(''),
          'error-callback': () => {
            callback.current('')
            setFailed(true)
          },
        })
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      if (id) window.turnstile?.remove(id)
    }
  }, [props.siteKey, attempt])
  return (
    <div className="stack">
      <div ref={target} />
      {failed && (
        <>
          <p role="alert">{t('Verification could not load. Please try again.')}</p>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('Retry verification')}
          </Button>
        </>
      )}
    </div>
  )
}
