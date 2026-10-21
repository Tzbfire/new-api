import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ModelPriceList } from '@/components/model-price-list'
import { Badge, EmptyState, ErrorState, LoadingState, Modal } from '@/components/ui'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useSession } from '@/lib/session'

/** Read-only access preview shared by key cards and the editor. */
export function KeyModelsDialog(props: {
  group: string
  modelLimits?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const session = useSession()
  const allowed = useQuery({
    queryKey: ['allowed-models', session.user?.id || 'public', props.group],
    queryFn: ({ signal }) =>
      request<string[]>(`/api/user/models?group=${encodeURIComponent(props.group)}`, { signal }),
    enabled: !!props.group,
    staleTime: 30_000,
  })
  const permitted = new Set(allowed.data || [])
  const limits =
    props.modelLimits !== undefined
      ? new Set(
          props.modelLimits
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean),
        )
      : null
  const models = catalog.allModels.filter(
    (model) => permitted.has(model.model_name) && (!limits || limits.has(model.model_name)),
  )
  const error = allowed.error || catalog.metadataError
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('View supported models and prices')}
      className="model-prices-modal"
    >
      <div className="row">
        <span>{t('Service group')}</span>
        <Badge>{props.group || t('Account default')}</Badge>
      </div>
      <section className="key-model-preview" aria-label={t('View supported models and prices')}>
        {allowed.isPending || catalog.metadataPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState
            error={error}
            retry={() => {
              void allowed.refetch()
              catalog.refetch()
            }}
          />
        ) : !models.length ? (
          <EmptyState
            compact
            title={t('No models in this group yet')}
            description={t('Choose another service group to see available models and prices.')}
          />
        ) : (
          <ModelPriceList models={models} group={props.group} />
        )}
      </section>
    </Modal>
  )
}
