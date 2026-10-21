import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
} from '@/components/ui'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { formatDate } from '@/lib/format'
import { Pagination } from '@/components/pagination'
import { toIntlLocale } from '@/i18n/languages'
import { useStatus } from '@/lib/status'
import { useSession } from '@/lib/session'
import '../wallet/wallet.css'
import { KeyEditor } from './KeyEditor'
import { KeyModelsDialog } from './KeyModelsDialog'
import { IntegrationGuide } from './IntegrationGuide'
import { CCSwitchImport } from './CCSwitchImport'
import type { APIKey } from './types'
import { KeyQuota } from './KeyQuota'
import './keys.css'

interface KeyPage {
  items: APIKey[]
  total: number
  page: number
  page_size: number
}

export default function KeysPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const site = useStatus()
  const catalog = useCatalog()
  const session = useSession()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [exactSearch, setExactSearch] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [editing, setEditing] = useState<APIKey | null | undefined>(undefined)
  const [viewingModels, setViewingModels] = useState<APIKey | null>(null)
  const [importing, setImporting] = useState<APIKey | null>(null)
  const [deleting, setDeleting] = useState<APIKey | null>(null)
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [revealing, setRevealing] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const keys = useQuery({
    queryKey: ['consumer-keys', session.user?.id || 'public', page, filter, pageSize],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === (session.user?.id || 'public') &&
      previousQuery?.queryKey[3] === filter
        ? previous
        : undefined,
    queryFn: () =>
      request<KeyPage>(
        `/api/token/${filter ? 'search' : ''}?p=${page}&page_size=${pageSize}&keyword=${encodeURIComponent(filter)}`,
      ),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['consumer-keys'] })
  const status = useMutation({
    mutationFn: (key: APIKey) =>
      request('/api/token/?status_only=true', {
        method: 'PUT',
        body: JSON.stringify({ id: key.id, status: key.status === 1 ? 2 : 1 }),
      }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (key: APIKey) => request(`/api/token/${key.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleting(null)
      if (page > 1 && keys.data?.items.length === 1) setPage(page - 1)
      await refresh()
    },
  })
  async function reveal(key: APIKey) {
    setError(null)
    setRevealing(key.id)
    try {
      const result = await request<{ key: string }>(`/api/token/${key.id}/key`, { method: 'POST' })
      setSecret({
        name: key.name,
        value: result.key.startsWith('sk-') ? result.key : `sk-${result.key}`,
      })
    } catch (failure) {
      setError(failure)
    } finally {
      setRevealing(null)
    }
  }
  return (
    <div className="page-stack page-compact keys-page">
      <PageHeader
        compact
        title={t('API keys')}
        description={t('Each key uses a service group. Its models and prices follow that group.')}
        actions={
          <>
            <IntegrationGuide />
            <Button
              disabled={!site.data?.quota_per_unit}
              onClick={() => {
                setEditing(null)
                setNotice('')
              }}
            >
              <Plus size={16} />
              {t('Create a key')}
            </Button>
          </>
        }
      />
      {catalog.requestedModel &&
        catalog.models.some((model) => model.model_name === catalog.requestedModel) && (
          <div className="keys-context-note">
            <strong>{t('Connect {{model}} with a key', { model: catalog.requestedModel })}</strong>
            <span className="muted">
              {t(
                'Review the selected service group and prices, create a key, then copy it into your app.',
              )}
            </span>
          </div>
        )}
      <form
        role="search"
        aria-label={t('Search keys')}
        className="keys-toolbar"
        onSubmit={(event) => {
          event.preventDefault()
          const name = search.trim()
          setSearchError('')
          if (
            name.includes('%') ||
            (!exactSearch && name && new TextEncoder().encode(name).length < 2)
          ) {
            setSearchError(
              'Use at least two characters for partial search. The % wildcard is not accepted here.',
            )
            return
          }
          setFilter(name && !exactSearch ? `%${name}%` : name)
          setPage(1)
        }}
      >
        <Input
          className="keys-search-input"
          aria-label={t('Search keys')}
          placeholder={t('Search by name')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="secondary" type="submit">
          {t('Search')}
        </Button>
        <label className="row keys-exact-search">
          <Checkbox checked={exactSearch} onCheckedChange={setExactSearch} />
          {t('Exact name match')}
        </label>
        <span role="status" className="keys-search-status" data-testid="keys-page-status">
          {keys.isPlaceholderData ? t('Loading…') : null}
        </span>
      </form>
      {searchError && (
        <p role="alert" className="field-error">
          {t(searchError)}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      {(error || status.error || remove.error) && (
        <ErrorState error={error || status.error || remove.error} />
      )}
      {keys.isPending && <LoadingState />}
      {keys.isError && <ErrorState error={keys.error} retry={() => void keys.refetch()} />}
      {keys.data?.items.length === 0 && (
        <EmptyState
          title={filter ? t('No keys found') : t('Your first connection starts here')}
          description={
            filter
              ? t('Try another key name.')
              : t('Create an API key, choose a service group, and connect your app.')
          }
        />
      )}
      <div className="stack">
        {keys.data?.items.map((key) => {
          const expired =
            key.status === 3 || (key.expired_time !== -1 && key.expired_time <= Date.now() / 1000)
          const exhausted = key.status === 4 || (!key.unlimited_quota && key.remain_quota <= 0)
          let state = 'Active'
          if (key.status === 2) state = 'Inactive'
          else if (expired) state = 'Expired'
          else if (exhausted) state = 'Budget exhausted'
          return (
            <Card key={key.id} className="key-card">
              <div className="row">
                <KeyRound size={22} />
                <div className="grow">
                  <strong>{key.name || t('Untitled key')}</strong>
                  <p className="muted key-mask">sk-{key.key}</p>
                </div>
                <div className="key-statuses">
                  <Badge>{t(state)}</Badge>
                </div>
              </div>
              <div className="key-facts">
                <span>
                  {t('Service group')}: <strong>{key.group || t('Account default')}</strong>
                </span>
                <span className={expired ? 'key-expired' : undefined}>
                  {t('Expires')}:{' '}
                  {key.expired_time === -1
                    ? t('Never')
                    : formatDate(
                        key.expired_time,
                        toIntlLocale(i18n.resolvedLanguage || i18n.language),
                      )}
                </span>
              </div>
              <KeyQuota apiKey={key} />
              <div className="row key-actions">
                <Button
                  variant="secondary"
                  disabled={keys.isPlaceholderData}
                  onClick={() => setViewingModels(key)}
                >
                  {t('View supported models and prices')}
                </Button>
                <Button
                  variant="secondary"
                  busy={revealing === key.id}
                  disabled={revealing !== null || keys.isPlaceholderData}
                  onClick={() => void reveal(key)}
                >
                  {t('Reveal key')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={key.status !== 1 || expired || exhausted}
                  onClick={() => setImporting(key)}
                >
                  {t('Import into CC Switch')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!site.data?.quota_per_unit || keys.isPlaceholderData}
                  onClick={() => {
                    setEditing(key)
                    catalog.setGroup(key.group || session.user?.group || 'default')
                  }}
                >
                  {t('Edit')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    keys.isPlaceholderData ||
                    status.isPending ||
                    (key.status !== 1 && (expired || exhausted))
                  }
                  onClick={() => status.mutate(key)}
                >
                  {t(key.status === 1 ? 'Disable' : 'Enable')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={keys.isPlaceholderData}
                  onClick={() => setDeleting(key)}
                >
                  {t('Delete')}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
      {keys.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={keys.data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          pageSizes={[12, 24, 48]}
        />
      )}
      {editing !== undefined && (
        <KeyEditor
          existing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            setNotice('Key saved. Reveal it when you are ready to connect your app.')
            void refresh()
          }}
        />
      )}
      {viewingModels && (
        <KeyModelsDialog
          group={viewingModels.group || session.user?.group || 'default'}
          modelLimits={viewingModels.model_limits_enabled ? viewingModels.model_limits : undefined}
          onClose={() => setViewingModels(null)}
        />
      )}
      {importing && <CCSwitchImport apiKey={importing} onClose={() => setImporting(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('Delete this key?')}
        description={t('Apps using this key will lose access immediately. This cannot be undone.')}
        busy={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
      />
      <Modal
        open={!!secret}
        onClose={() => setSecret(null)}
        title={t('Your API key')}
        description={t('Keep this key private. Anyone with it can spend your balance.')}
      >
        {secret && (
          <div className="stack">
            <strong>{secret.name}</strong>
            <code className="secret-code">{secret.value}</code>
            <CopyButton value={secret.value} />
            <Button variant="secondary" onClick={() => setSecret(null)}>
              {t('Done')}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
