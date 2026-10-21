import { useState } from 'react'
import { Check, ChevronDown, Layers3, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Input, LoadingState, Modal } from '@/components/ui'
import { ModelPrice } from '@/components/model-price'
import { supportsKind } from '@/components/service-picker'
import { useCatalog } from '@/lib/catalog'
import { useSession } from '@/lib/session'
import './chat-model-picker.css'

/** Chat-specific composition of the shared dialog and authoritative catalog. */
export function ChatModelPicker(props: {
  model: string
  onModelChange: (model: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState({ group: '', model: '' })
  const group = catalog.groups.find((item) => item.id === catalog.group)
  const available = catalog.models.filter((item) => supportsKind(item, 'chat'))
  const selected = available.find((item) => item.model_name === props.model)
  const previewName = preview.group === catalog.group ? preview.model : props.model
  const previewModel = available.find((item) => item.model_name === previewName) || selected
  const query = search.trim().toLocaleLowerCase()
  const models = available.filter((item) =>
    `${item.model_name} ${item.description || ''}`.toLocaleLowerCase().includes(query),
  )
  return (
    <>
      <Button
        variant="ghost"
        className="chat-model-trigger"
        aria-label={t('Choose your chat model')}
        aria-haspopup="dialog"
        aria-expanded={open && !props.disabled}
        disabled={props.disabled}
        onClick={() => {
          setSearch('')
          setPreview({ group: catalog.group, model: props.model })
          setOpen(true)
        }}
      >
        <Sparkles size={18} aria-hidden />
        <span className="chat-model-trigger-copy">
          <strong>{selected?.model_name || t('Choose a model')}</strong>
          <span>
            {group?.id || t('Service plan')} ·{' '}
            {group?.ratio === 'auto' ? t('Automatic routing') : `${group?.ratio ?? '—'}×`}
          </span>
        </span>
        <ChevronDown size={15} aria-hidden />
      </Button>
      <Modal
        open={open && !props.disabled}
        onClose={() => setOpen(false)}
        title={t('Choose your chat model')}
        description={t(
          'Choose a service plan, then a model. Availability and prices follow your account.',
        )}
        className="chat-model-modal"
      >
        <div className="chat-model-layout">
          <section className="chat-model-plans" aria-label={t('Service plans')}>
            <span className="eyebrow">
              <Layers3 size={14} aria-hidden />
              {t('Service plans')}
            </span>
            {catalog.groups.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className={`chat-model-plan ${item.id === catalog.group ? 'is-selected' : ''}`}
                aria-pressed={item.id === catalog.group}
                disabled={props.disabled}
                onClick={() => {
                  catalog.setGroup(item.id)
                  setSearch('')
                }}
              >
                <span className="chat-model-plan-heading">
                  <strong>{item.id}</strong>
                  <span>{item.ratio === 'auto' ? t('Automatic routing') : `${item.ratio}×`}</span>
                </span>
                {item.desc && <span className="chat-model-plan-description">{item.desc}</span>}
                {item.id === session.user?.group && (
                  <span className="chat-model-default">{t('Your account default')}</span>
                )}
              </Button>
            ))}
          </section>
          <section className="chat-model-options" aria-label={t('Chat models')}>
            <div className="chat-model-search">
              <Search size={16} aria-hidden />
              <Input
                aria-label={t('Search chat models')}
                placeholder={t('Search chat models')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={props.disabled}
              />
            </div>
            <div className="chat-model-results">
              {catalog.isPending ? (
                <LoadingState />
              ) : catalog.error ? (
                <EmptyState
                  compact
                  title={t('Models could not be loaded.')}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => catalog.refetch()}
                      disabled={props.disabled}
                    >
                      {t('Try again')}
                    </Button>
                  }
                />
              ) : !models.length ? (
                <EmptyState
                  compact
                  title={
                    available.length
                      ? t('No matching models')
                      : t('This service plan has no chat models available.')
                  }
                  description={
                    available.length
                      ? t('Try a different search.')
                      : t('Choose another service plan to continue. Prices may differ.')
                  }
                />
              ) : (
                models.map((item) => (
                  <Button
                    key={item.model_name}
                    variant="ghost"
                    className={`chat-model-option ${item.model_name === previewModel?.model_name ? 'is-selected' : ''}`}
                    aria-pressed={item.model_name === previewModel?.model_name}
                    disabled={props.disabled}
                    onClick={() => {
                      setPreview({ group: catalog.group, model: item.model_name })
                    }}
                  >
                    <span>
                      <strong>{item.model_name}</strong>
                      {item.description && (
                        <span className="chat-model-description">{item.description}</span>
                      )}
                    </span>
                    {item.model_name === previewModel?.model_name && (
                      <Check size={17} aria-hidden />
                    )}
                  </Button>
                ))
              )}
            </div>
            {!catalog.isPending && !catalog.error && previewModel && (
              <div className="chat-model-price">
                <div className="chat-model-price-heading">
                  <span className="eyebrow">{t('Price for the selected model')}</span>
                  <strong>{previewModel.model_name}</strong>
                </div>
                <ModelPrice
                  key={`${catalog.group}:${previewModel.model_name}`}
                  model={previewModel.model_name}
                  group={catalog.group}
                  compact
                  showUnitPrices
                />
              </div>
            )}
          </section>
        </div>
        <div className="chat-model-confirm">
          <p className="muted">
            {t('Service plan changes are saved immediately. Preview a model before confirming.')}
          </p>
          <Button
            disabled={
              props.disabled || catalog.isPending || Boolean(catalog.error) || !previewModel
            }
            onClick={() => {
              if (!previewModel || props.disabled || catalog.isPending || catalog.error) return
              props.onModelChange(previewModel.model_name)
              setOpen(false)
            }}
          >
            {t('Use this model')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
