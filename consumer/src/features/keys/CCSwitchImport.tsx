import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, Field, Input, LoadingState, Modal, Select } from '@/components/ui'
import { SearchSelect } from '@/components/search-select'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useStatus } from '@/lib/status'
import { useSiteBrand } from '@/lib/use-site-brand'
import { useSession } from '@/lib/session'
import { APIAddressSelector, useAPIAddress } from './APIAddressSelector'
import { ccSwitchLink, protocolBaseURL, type CCSwitchApp } from './api-addresses'
import type { APIKey } from './types'

export function CCSwitchImport(props: { apiKey: APIKey; onClose: () => void }) {
  const { t } = useTranslation()
  const site = useStatus()
  const brand = useSiteBrand()
  const session = useSession()
  const catalog = useCatalog()
  const [app, setApp] = useState<CCSwitchApp>('codex')
  const [name, setName] = useState<string | null>(null)
  const connectionName = name ?? `${brand.name} · ${props.apiKey.name}`
  const [model, setModel] = useState('')
  const { address } = useAPIAddress()
  const [secret, setSecret] = useState('')
  const [loadingKey, setLoadingKey] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [opened, setOpened] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const group = props.apiKey.group || session.user?.group || ''
  const models = useQuery({
    queryKey: ['key-import-models', session.user?.id, group],
    queryFn: () => request<string[]>(`/api/user/models?group=${encodeURIComponent(group)}`),
    enabled: !!group && group !== 'auto',
    staleTime: 30000,
  })
  const restricted = new Set(
    (props.apiKey.model_limits || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const endpoint = { claude: 'anthropic', gemini: 'gemini', codex: 'openai-response' }[app]
  const options = catalog.allModels.filter(
    (item) =>
      models.data?.includes(item.model_name) &&
      !item.supported_endpoint_types.includes('image-generation') &&
      !/^(?:gpt-image(?:-|$)|dall-e(?:-|$))/i.test(item.model_name) &&
      item.supported_endpoint_types.includes(endpoint) &&
      (!props.apiKey.model_limits_enabled || restricted.has(item.model_name)),
  )
  const selectedModel = options.some((item) => item.model_name === model) ? model : ''
  const loadingModels = models.isPending || catalog.isPending
  const ready = Boolean(
    address &&
    selectedModel &&
    connectionName.trim() &&
    !site.error &&
    !models.error &&
    !catalog.error,
  )
  const locked = loadingKey || !!secret
  function close() {
    active.current = false
    setSecret('')
    props.onClose()
  }
  async function prepare() {
    if (!ready) return
    setLoadingKey(true)
    setOpened(false)
    setError(null)
    try {
      const value = await request<{ key: string }>(`/api/token/${props.apiKey.id}/key`, {
        method: 'POST',
      })
      if (active.current) setSecret(value.key)
    } catch (failure) {
      if (active.current) setError(failure)
    } finally {
      if (active.current) setLoadingKey(false)
    }
  }
  return (
    <Modal open onClose={close} title={t('Import into CC Switch')}>
      <div className="stack">
        <p>
          {t('Import this key and the selected gateway into the CC Switch app on this device.')}
        </p>
        <p className="field-hint">
          {t('Service group')}: {group} · {props.apiKey.name}
        </p>
        <Field label={t('Application')}>
          <Select
            value={app}
            disabled={locked}
            onValueChange={(value) => {
              setApp(value as CCSwitchApp)
              setModel('')
            }}
            options={[
              { value: 'codex', label: 'Codex' },
              { value: 'claude', label: 'Claude Code' },
              { value: 'gemini', label: 'Gemini CLI' },
            ]}
          />
        </Field>
        <Field label={t('Connection name')}>
          <Input
            value={connectionName}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            disabled={locked}
          />
        </Field>
        <APIAddressSelector disabled={locked} />
        {address && (
          <>
            <code className="secret-code">
              {protocolBaseURL(address.url, app === 'codex' ? 'openai' : 'native')}
            </code>
          </>
        )}
        <SearchSelect
          label={t('Model')}
          value={selectedModel}
          onValueChange={setModel}
          disabled={locked || loadingModels || !options.length}
          options={options.map((item) => ({ value: item.model_name, label: item.model_name }))}
        />
        {group === 'auto' && (
          <p role="status">
            {t('Use a key with a specific service group to choose compatible models.')}
          </p>
        )}
        {group !== 'auto' && loadingModels && <LoadingState />}
        {group !== 'auto' && !loadingModels && !options.length && (
          <p role="status">
            {t(
              'This key has no model with the selected app’s native API. Choose another app or key.',
            )}
          </p>
        )}
        {models.error && <ErrorState error={models.error} retry={() => void models.refetch()} />}
        {error ? <ErrorState error={error} /> : null}
        {catalog.error ? <ErrorState error={catalog.error} retry={catalog.refetch} /> : null}
        {site.error ? <ErrorState error={site.error} retry={() => void site.refetch()} /> : null}
        <p className="field-hint">
          {t(
            'The key is passed only to your local CC Switch app. Import does not switch your active provider automatically.',
          )}
        </p>
        <a href="https://github.com/farion1231/cc-switch/releases" target="_blank" rel="noreferrer">
          {t('Install CC Switch')}
        </a>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={close}>
            {t('Cancel')}
          </Button>
          {!secret ? (
            <Button
              onClick={() => void prepare()}
              disabled={!ready || loadingKey}
              busy={loadingKey}
            >
              {t('Prepare import')}
            </Button>
          ) : (
            <Button
              disabled={!ready || opened}
              onClick={() => {
                if (!address || !ready) return
                // Keep the credential-bearing URI out of rendered links, query caches and storage.
                window.open(
                  ccSwitchLink({
                    app,
                    name: connectionName.trim(),
                    address: address.url,
                    model: selectedModel,
                    key: secret,
                  }),
                  '_blank',
                  'noopener,noreferrer',
                )
                setSecret('')
                setOpened(true)
              }}
            >
              {t('Open CC Switch')}
            </Button>
          )}
        </div>
        {opened && (
          <p role="status">
            {t(
              'Complete the import in CC Switch. If it did not open, install the app and try again.',
            )}
          </p>
        )}
      </div>
    </Modal>
  )
}
