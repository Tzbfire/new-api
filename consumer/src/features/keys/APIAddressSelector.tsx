import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchSelect } from '@/components/search-select'
import { CopyButton } from '@/components/ui'
import { readPreference, savePreference } from '@/lib/preferences'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { apiAddresses } from './api-addresses'

const addressChange = 'consumer-api-address-change'

/** A non-secret account preference shared by setup and explicit imports. */
export function useAPIAddress() {
  const site = useStatus()
  const session = useSession()
  const preferenceKey = `${session.user?.id || 'public'}:api-address`
  const [choice, setChoice] = useState(() => ({
    key: preferenceKey,
    url: readPreference(preferenceKey),
  }))
  useEffect(() => {
    function changed(event: Event) {
      if (event instanceof CustomEvent) {
        const detail = event.detail as { key: string; url: string }
        if (detail.key === preferenceKey) setChoice(detail)
      } else setChoice({ key: preferenceKey, url: readPreference(preferenceKey) })
    }
    window.addEventListener(addressChange, changed)
    window.addEventListener('storage', changed)
    return () => {
      window.removeEventListener(addressChange, changed)
      window.removeEventListener('storage', changed)
    }
  }, [preferenceKey])
  const addresses = apiAddresses(site.data, window.location.origin)
  const chosenURL = choice.key === preferenceKey ? choice.url : readPreference(preferenceKey)
  const address = addresses.find((item) => item.url === chosenURL) || addresses[0]
  function selectAddress(url: string) {
    if (!addresses.some((item) => item.url === url)) return
    const next = { key: preferenceKey, url }
    setChoice(next)
    savePreference(preferenceKey, url)
    window.dispatchEvent(new CustomEvent(addressChange, { detail: next }))
  }
  return { site, addresses, address, selectAddress }
}

export function APIAddressSelector(props: { inline?: boolean; disabled?: boolean }) {
  const { t } = useTranslation()
  const { site, addresses, address, selectAddress } = useAPIAddress()
  return (
    <div className={props.inline ? 'api-address-bar' : 'stack'}>
      <SearchSelect
        label={t('API address')}
        value={address?.url || ''}
        options={addresses.map((item) => ({
          value: item.url,
          label: item.label || t('Default API address'),
          description: [item.url, item.description].filter(Boolean).join(' · '),
        }))}
        onValueChange={selectAddress}
        disabled={props.disabled || site.isPending || !addresses.length}
      />
      {address && (
        <div className="api-address-details">
          <code>{address.url}</code>
          {address.description && <p className="muted">{address.description}</p>}
        </div>
      )}
      {props.inline && address && <CopyButton value={address.url} />}
    </div>
  )
}
