import { useState } from 'react'
import { ArrowUpRight, ImagePlus, MessageCircle, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCatalog } from '@/lib/catalog'
import { toIntlLocale } from '@/i18n/languages'
import { supportsKind } from '@/components/service-picker'
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
} from '@/components/ui'
import { ServiceGroupOptions } from '@/components/service-group-options'
import { Pagination } from '@/components/pagination'
import { ModelPriceSummary } from '@/components/model-price-list'
import { ModelHealth } from './ModelHealth'
import { ModelDetails } from './ModelDetails'
import './explore.css'

export default function ExplorePage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const catalog = useCatalog()
  const [searchSelection, setSearchSelection] = useState({ intentKey: '', value: '' })
  const search =
    searchSelection.intentKey === catalog.intentKey ? searchSelection.value : catalog.requestedModel
  const [kind, setKind] = useState<'all' | 'chat' | 'image'>('all')
  const [listing, setListing] = useState({
    intentKey: catalog.intentKey,
    group: catalog.group,
    onlyAvailable: true,
    page: 1,
  })
  // Derive a fresh list state during navigation so old filters never flash for a new group.
  const listingContextChanged =
    listing.intentKey !== catalog.intentKey || listing.group !== catalog.group
  const effectiveListing = listingContextChanged
    ? { intentKey: catalog.intentKey, group: catalog.group, onlyAvailable: true, page: 1 }
    : listing
  const { onlyAvailable, page } = effectiveListing
  function updateListing(patch: Partial<typeof effectiveListing>) {
    setListing({ ...effectiveListing, ...patch })
  }
  const [detailSelection, setDetailSelection] = useState<{
    intentKey: string
    model: string | null
  } | null>(null)
  const detailName =
    detailSelection?.intentKey === catalog.intentKey
      ? detailSelection.model
      : catalog.requestedModel
  const detail = catalog.allModels.find((model) => model.model_name === detailName)
  const available = new Set(catalog.models.map((model) => model.model_name))
  const vendors = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor.name]))
  const term = search.trim().toLowerCase()
  const filtered = catalog.allModels
    .filter((model) => {
      const vendor = vendors.get(model.vendor_id ?? 0)
      return (
        (!onlyAvailable || available.has(model.model_name)) &&
        supportsKind(model, kind) &&
        `${model.model_name} ${model.description || ''} ${model.tags || ''} ${vendor || ''} ${model.supported_endpoint_types?.join(' ') || ''}`
          .toLowerCase()
          .includes(term)
      )
    })
    .sort((a, b) => a.model_name.localeCompare(b.model_name, locale, { numeric: true }))
  const pageSize = 12
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  let results = (
    <div className="model-catalog-grid">
      {filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map((model) => {
        const isAvailable = available.has(model.model_name)
        const isImage = supportsKind(model, 'image')
        const description = model.description?.trim()
        let availability = t(
          isAvailable ? 'Available in this group' : 'Not available in this group',
        )
        let price = (
          <ModelPriceSummary
            model={model.model_name}
            group={catalog.group}
            enabled={isAvailable}
            compact
          />
        )
        if (catalog.accessPending) {
          availability = t('Checking model access…')
          price = (
            <p className="price-comparison-message" role="status">
              {t('Checking model access…')}
            </p>
          )
        } else if (catalog.accessError) {
          availability = t('Could not verify model access.')
          price = (
            <div className="price-comparison-message" role="alert">
              {t('Could not verify model access.')}
              <Button variant="ghost" onClick={catalog.refetch}>
                {t('Try again')}
              </Button>
            </div>
          )
        }
        let Icon = Sparkles
        if (isImage) Icon = ImagePlus
        else if (supportsKind(model, 'chat')) Icon = MessageCircle
        return (
          <article
            key={model.model_name}
            className="model-catalog-card"
            aria-label={model.model_name}
            data-has-description={Boolean(description)}
          >
            <div className="model-catalog-identity">
              <span className={`model-catalog-icon ${isImage ? 'is-image' : ''}`}>
                <Icon size={18} aria-hidden />
              </span>
              <div>
                <h2>
                  <Button
                    variant="ghost"
                    className="model-card-title"
                    onClick={() =>
                      setDetailSelection({
                        intentKey: catalog.intentKey,
                        model: model.model_name,
                      })
                    }
                  >
                    {model.model_name}
                  </Button>
                </h2>
                <span className="model-catalog-vendor">
                  {vendors.get(model.vendor_id ?? 0) || t(isImage ? 'Image creation' : 'AI model')}
                </span>
              </div>
              <span className={`model-catalog-availability ${isAvailable ? 'is-available' : ''}`}>
                {availability}
              </span>
            </div>
            <p className="model-catalog-description">
              {description || t('No model description has been provided.')}
            </p>
            {price}
            <div className="model-catalog-footer">
              <div className="model-card-health">
                {isAvailable && <ModelHealth model={model.model_name} group={catalog.group} />}
              </div>
              <Button
                variant="ghost"
                className="model-card-open"
                aria-label={t('View model details for {{model}}', { model: model.model_name })}
                onClick={() =>
                  setDetailSelection({ intentKey: catalog.intentKey, model: model.model_name })
                }
              >
                {t('View details')}
                <ArrowUpRight size={14} aria-hidden />
              </Button>
            </div>
          </article>
        )
      })}
    </div>
  )
  if (catalog.metadataPending) results = <LoadingState />
  else if (catalog.metadataError)
    results = <ErrorState error={catalog.metadataError} retry={catalog.refetch} />
  else if (onlyAvailable && catalog.accessPending) results = <LoadingState />
  else if (onlyAvailable && catalog.accessError)
    results = <ErrorState error={catalog.accessError} retry={catalog.refetch} />
  else if (!filtered.length)
    results = (
      <EmptyState
        title={t('No models found')}
        description={t('Try another search or service plan.')}
      />
    )
  return (
    <div className="page-stack model-discovery">
      <div className="catalog-heading">
        <PageHeader
          title={t('Models and pricing')}
          description={t('Find your model. Choose your service plan. Know what you pay.')}
        />
      </div>
      <ServiceGroupOptions
        value={catalog.group}
        groups={catalog.groups}
        onValueChange={catalog.setGroup}
      />
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search size={18} aria-hidden />
          <Input
            type="search"
            aria-label={t('Search models')}
            placeholder={t('Search models or capabilities…')}
            value={search}
            onChange={(event) => {
              setSearchSelection({ intentKey: catalog.intentKey, value: event.target.value })
              updateListing({ page: 1 })
            }}
          />
        </div>
        <div className="catalog-kind-filter" aria-label={t('Model type')}>
          {(['all', 'chat', 'image'] as const).map((value) => (
            <Button
              variant="ghost"
              key={value}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value)
                updateListing({ page: 1 })
              }}
            >
              {t({ all: 'All models', chat: 'Conversation', image: 'Image creation' }[value])}
            </Button>
          ))}
        </div>
        <label className="row catalog-available-filter">
          <Checkbox
            checked={onlyAvailable}
            onCheckedChange={(checked) => {
              updateListing({ onlyAvailable: checked, page: 1 })
            }}
          />
          {t('Only available in this group')}
        </label>
      </div>
      <div className="catalog-results-context">
        <span>
          {catalog.accessPending
            ? t('Checking model access…')
            : t('{{count}} models', { count: filtered.length })}
        </span>
        <span>{t('Prices and performance below are for the selected service group.')}</span>
      </div>
      {results}
      {!catalog.metadataPending &&
        !catalog.metadataError &&
        !(onlyAvailable && (catalog.accessPending || catalog.accessError)) &&
        filtered.length > pageSize && (
          <Pagination
            page={visiblePage}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={(page) => updateListing({ page })}
          />
        )}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetailSelection({ intentKey: catalog.intentKey, model: null })}
        title={detail?.model_name || t('Model details')}
        className="model-details-modal"
      >
        {detail && (
          <ModelDetails
            key={`${catalog.intentKey}:${detail.model_name}`}
            model={detail}
            onGroupChange={(group) => {
              setDetailSelection({ intentKey: catalog.intentKey, model: detail.model_name })
              catalog.setGroup(group)
            }}
          />
        )}
      </Modal>
    </div>
  )
}
