import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { SearchSelect } from '@/components/search-select'
import { useTranslation } from 'react-i18next'
import { Button, CopyButton, Modal, LoadingState, ErrorState } from '@/components/ui'
import { useCatalog } from '@/lib/catalog'
import { useStatus } from '@/lib/status'
import { useSession } from '@/lib/session'
import { APIAddressSelector, useAPIAddress } from './APIAddressSelector'
import { protocolBaseURL } from './api-addresses'

/** 接入示例只使用占位环境变量，不读取或嵌入用户实际密钥。 */
export function IntegrationGuide() {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const site = useStatus()
  const session = useSession()
  const [open, setOpen] = useState(false)
  const { address } = useAPIAddress()
  const endpoint = address ? protocolBaseURL(address.url, 'openai') : ''
  const [selection, setSelection] = useState({ intentKey: '', group: '', model: '' })
  const chatModels = catalog.models.filter(
    (item) =>
      item.supported_endpoint_types.includes('openai') &&
      !item.supported_endpoint_types.some((endpoint) => /image|video|task/i.test(endpoint)) &&
      !/image|dall-e|flux|imagen|stable-diffusion|midjourney/i.test(item.model_name),
  )
  const preferred =
    selection.intentKey === catalog.intentKey && selection.group === catalog.group
      ? selection.model
      : catalog.requestedModel
  const model =
    !catalog.isPending && !catalog.error && chatModels.some((item) => item.model_name === preferred)
      ? preferred
      : ''
  const body = JSON.stringify(
    {
      model: model || 'YOUR_CHAT_MODEL',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: true,
    },
    null,
    2,
  )
  const command = [
    `curl '${endpoint.replaceAll("'", "'\\''")}/chat/completions'`,
    '  -H "Authorization: Bearer $NEW_API_KEY"',
    "  -H 'Content-Type: application/json'",
    `  --data '${body.replaceAll("'", "'\\''")}'`,
  ].join(' \\\n')
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <BookOpen size={16} aria-hidden />
        {t('Addresses and setup')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Connect your AI tools')}>
        <div className="stack">
          <p className="muted">{t('Choose an address or import a key into CC Switch.')}</p>
          {site.isPending && <LoadingState />}
          {site.error && <ErrorState error={site.error} retry={() => void site.refetch()} />}
          <APIAddressSelector />
          <p className="muted">
            {t(
              'Use this base URL in an OpenAI-compatible app. Store your API key in NEW_API_KEY and replace YOUR_MODEL with a model supported by your key’s service group.',
            )}
          </p>
          <div className="row">
            <div className="grow">
              <span className="field-label">{t('API base URL')}</span>
              <code className="secret-code">{endpoint}</code>
            </div>
            <CopyButton value={endpoint} />
          </div>
          <SearchSelect
            label={t('Example service group')}
            value={catalog.group}
            onValueChange={catalog.setGroup}
            options={catalog.groups.map((group) => ({
              value: group.id,
              label: group.id,
              description: group.desc,
            }))}
            disabled={catalog.isPending}
          />
          <SearchSelect
            label={t('Chat model for this example')}
            value={model}
            onValueChange={(value) =>
              setSelection({ intentKey: catalog.intentKey, group: catalog.group, model: value })
            }
            options={chatModels.map((item) => ({ value: item.model_name, label: item.model_name }))}
            placeholder={t('Choose a chat model explicitly')}
            disabled={catalog.isPending || !!catalog.error}
          />
          <p className="field-hint">
            {t(
              'Choose the same service group as your API key. This chat example excludes image and task models; use their documented endpoints instead.',
            )}
          </p>
          <details>
            <summary>{t('Try a request')}</summary>
            <pre className="code-block">
              <code>{command}</code>
            </pre>
            <CopyButton value={command} />
          </details>
          {session.user && session.user.role >= 10 && (
            <p className="field-hint">
              {t('Manage gateway addresses and descriptions in Admin → Content → API Addresses.')}
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
