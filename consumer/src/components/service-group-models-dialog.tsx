import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ModelPriceList } from '@/components/model-price-list'
import { Badge, EmptyState, ErrorState, LoadingState, Modal } from '@/components/ui'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useSession } from '@/lib/session'

/** Read-only current-account model access, shared by keys and active plans. */
export function ServiceGroupModelsDialog(props: {
  group: string
  modelLimits?: string
  description?: string
  groupPicker?: ReactNode
  onClose: () => void
}) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const session = useSession()
  const hasAccess = catalog.groups.some((group) => group.id === props.group)
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
  let content: ReactNode
  if ((allowed.isPending && !!props.group) || catalog.metadataPending) {
    content = <LoadingState />
  } else if (!catalog.metadataError && !hasAccess && (!models.length || allowed.error)) {
    content = (
      <EmptyState
        compact
        title={t(
          'This service group is not available to your account. Contact the administrator to check access.',
        )}
      />
    )
  } else if (error) {
    content = (
      <ErrorState
        error={error}
        retry={() => {
          void allowed.refetch()
          catalog.refetch()
        }}
      />
    )
  } else if (!models.length) {
    content = (
      <EmptyState
        compact
        title={t('No models in this group yet')}
        description={t('Choose another service group to see available models and prices.')}
      />
    )
  } else {
    content = <ModelPriceList models={models} group={props.group} />
  }
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('View supported models and prices')}
      description={props.description}
      className="model-prices-modal"
    >
      {props.groupPicker || (
        <div className="row">
          <span>{t('Service group')}</span>
          <Badge>{props.group || t('Account default')}</Badge>
        </div>
      )}
      <section
        className="service-group-model-preview"
        aria-label={t('View supported models and prices')}
      >
        {content}
      </section>
    </Modal>
  )
}
