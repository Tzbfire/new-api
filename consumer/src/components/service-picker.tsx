import { useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { useCatalog, type PricingModel } from '@/lib/catalog'
import { request } from '@/lib/api'
import { useSession } from '@/lib/session'
import { Button, EmptyState } from './ui'
import { SearchSelect } from './search-select'

export function supportsKind(
  model: PricingModel,
  kind: 'chat' | 'text' | 'image' | 'all',
): boolean {
  if (kind === 'all') return true
  const endpoints = model.supported_endpoint_types || []
  if (kind === 'image') return endpoints.includes('image-generation')
  // Image-generation endpoints and legacy image models are not chat completion models.
  if (
    endpoints.includes('image-generation') ||
    /(?:^|[/:])(?:gpt-image(?:-|$)|dall-e(?:-|$))/i.test(model.model_name)
  )
    return false
  // External text clients can use Responses-only models; the chat page still
  // requires one of the formats supported by its chat-completions transport.
  return endpoints.some(
    (e) =>
      ['openai', 'anthropic', 'gemini'].includes(e) || (kind === 'text' && e === 'openai-response'),
  )
}
export function ServicePicker(props: {
  kind?: 'chat' | 'image' | 'all'
  model: string
  onModelChange: (model: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const session = useSession()
  const kind = props.kind || 'all'
  const models = catalog.models.filter((model) => supportsKind(model, kind))
  const empty = !catalog.isPending && !catalog.error && models.length === 0
  const otherGroups =
    empty && session.status === 'authenticated'
      ? catalog.groups.filter((group) => group.id !== catalog.group)
      : []
  const alternatives = useQueries({
    queries: otherGroups.map((group) => ({
      queryKey: ['allowed-models', session.user?.id, group.id],
      queryFn: () => request<string[]>(`/api/user/models?group=${encodeURIComponent(group.id)}`),
      staleTime: 30_000,
      retry: false,
    })),
  })
  const suggestions = otherGroups.filter((_, index) => {
    const result = alternatives[index]
    if (!result?.isSuccess) return false
    return catalog.allModels.some(
      (model) => supportsKind(model, kind) && result.data.includes(model.model_name),
    )
  })
  let placeholder = t('Choose a model')
  if (catalog.isPending) placeholder = t('Loading models…')
  else if (empty) placeholder = t('No models available')
  let emptyMessage = t('This service plan has no models available.')
  if (kind === 'image') emptyMessage = t('This service plan has no image models available.')
  if (kind === 'chat') emptyMessage = t('This service plan has no chat models available.')
  const model = models.some((m) => m.model_name === props.model) ? props.model : ''
  useEffect(() => {
    if (!catalog.isPending && model !== props.model) props.onModelChange(model)
  }, [catalog.isPending, model, props.model, props.onModelChange])
  const selected = catalog.groups.find((g) => g.id === catalog.group)
  return (
    <div className="service-picker">
      <div className="service-picker-fields">
        <SearchSelect
          label={t('Service plan')}
          value={catalog.group}
          disabled={props.disabled || catalog.isPending}
          placeholder={t('Choose a service plan')}
          onValueChange={(value) => {
            catalog.setGroup(value)
          }}
          options={catalog.groups.map((group) => ({
            value: group.id,
            label: `${group.id} · ${group.ratio === 'auto' ? t('Automatic routing') : `${group.ratio}×`}`,
            description: group.desc,
          }))}
        />
        <SearchSelect
          label={t('Model')}
          value={model}
          disabled={props.disabled || catalog.isPending || empty || Boolean(catalog.error)}
          placeholder={placeholder}
          onValueChange={props.onModelChange}
          options={models.map((item) => ({
            value: item.model_name,
            label: item.model_name,
            description: item.description,
          }))}
        />
      </div>
      <div className="service-picker-note">
        <span>{selected?.desc || t('Availability and prices follow your service plan.')}</span>
        <Link
          to="/model-pricing"
          search={{ group: catalog.group, model: props.model || undefined }}
        >
          {t('Compare prices')}
          <ArrowUpRight size={13} />
        </Link>
      </div>
      {empty && (
        <div className="service-picker-empty" role="status">
          <EmptyState
            compact
            title={emptyMessage}
            description={t('Choose another service plan to continue. Prices may differ.')}
            action={
              <>
                {alternatives.some((result) => result.isPending) && (
                  <p className="muted">{t('Checking other service plans…')}</p>
                )}
                {suggestions.length > 0 && (
                  <div className="service-picker-alternatives">
                    {suggestions.map((group) => (
                      <Button
                        key={group.id}
                        type="button"
                        variant="secondary"
                        disabled={props.disabled}
                        onClick={() => {
                          props.onModelChange('')
                          catalog.setGroup(group.id)
                        }}
                      >
                        {t('Switch to {{group}}', { group: group.id })}
                        {' · '}
                        {group.ratio === 'auto' ? t('Automatic routing') : `${group.ratio}×`}
                      </Button>
                    ))}
                  </div>
                )}
              </>
            }
          />
        </div>
      )}
      {catalog.error && (
        <p className="field-error" role="alert">
          {t('Models could not be loaded. Open Explore to try again.')}
        </p>
      )}
    </div>
  )
}
