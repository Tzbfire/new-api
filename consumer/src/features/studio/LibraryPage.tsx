import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Download, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Badge,
  Checkbox,
  Button,
  CopyButton,
  Input,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
} from '@/components/ui'
import { request } from '@/lib/api'
import { SearchSelect, type SelectOption } from '@/components/search-select'
import { Pagination } from '@/components/pagination'
import { useSession } from '@/lib/session'
import { readPreference, savePreference } from '@/lib/preferences'
import { saveStudioDraft, type StudioDraft } from './draft'
import { formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { toIntlLocale } from '@/i18n/languages'
import {
  isRunning,
  safeImageURL,
  selectedVisibleTasks,
  studioTaskContent,
  type StudioBatchPage,
  type StudioConfig,
  type StudioFilter,
  type StudioTaskPage,
} from './contracts'
import { TaskCard } from './TaskCard'
import { TaskTiming } from './TaskTiming'
import { useStudioSettlement } from './useStudioSettlement'
import './studio.css'
import './gallery.css'

type DeleteScope = 'selected' | 'failed' | 'scope'

export default function LibraryPage() {
  return <CreationsGallery />
}

type GalleryProps = {
  embedded?: boolean
  onReuse?: (request: StudioDraft) => void
}

export function CreationsGallery(props: GalleryProps) {
  const session = useSession()
  return <GalleryWorkspace key={session.user?.id || 'public'} {...props} />
}

function GalleryWorkspace(props: GalleryProps) {
  const { t, i18n } = useTranslation()
  const status = useStatus()
  const client = useQueryClient()
  const session = useSession()
  const routeSearch = useSearch({ strict: false }) as { batch?: string }
  const navigate = useNavigate()
  const identity = session.user?.id || 'public'
  const [page, setPage] = useState(1)
  const [batchPage, setBatchPage] = useState(1)
  const [batchId, setBatchId] = useState(() => routeSearch.batch || '')
  const [selectedCollection, setSelectedCollection] = useState<SelectOption | undefined>()
  const [names, setNames] = useState<Record<string, string>>({})
  const [collectionName, setCollectionName] = useState('')
  const [nameNotice, setNameNotice] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [filter, setFilter] = useState<StudioFilter>('all')
  useEffect(() => {
    if (!routeSearch.batch) return
    setBatchId(routeSearch.batch)
    setFilter('all')
    setPage(1)
    setSelected(new Set())
  }, [routeSearch.batch])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [deleteScope, setDeleteScope] = useState<DeleteScope | null>(null)
  const config = useQuery({
    queryKey: ['studio', 'config'],
    queryFn: ({ signal }) => request<StudioConfig>('/pg/image-studio/config', { signal }),
  })
  const batches = useQuery<StudioBatchPage>({
    queryKey: ['studio', 'batches', batchPage],
    meta: { identity },
    placeholderData: (previous, query) =>
      query?.meta?.identity === identity ? previous : undefined,
    queryFn: ({ signal }) =>
      request<StudioBatchPage>(`/api/image-studio/batches?p=${batchPage}&page_size=100`, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some((batch) =>
        ['submitting', 'running', 'queued'].includes(batch.status),
      )
        ? 5000
        : false,
  })
  useEffect(() => {
    const loaded: Record<string, string> = {}
    for (const item of batches.data?.items || [])
      loaded[item.batch_id] = readPreference(`${identity}:studio:name:${item.batch_id}`)
    setNames((current) => ({ ...current, ...loaded }))
  }, [identity, batches.data])
  const collectionOptions: SelectOption[] = (batches.data?.items || []).map((item) => ({
    value: item.batch_id,
    label:
      names[item.batch_id] || item.prompt.replace(/\s+/g, ' ').trim().slice(0, 64) || item.model,
    description: [
      item.model,
      item.created_at > 0
        ? new Date(item.created_at * 1000).toLocaleString(toIntlLocale(i18n.resolvedLanguage), {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
    searchText: item.prompt,
  }))
  if (batchId && !collectionOptions.some((option) => option.value === batchId)) {
    collectionOptions.unshift({
      value: batchId,
      label:
        names[batchId] ||
        (selectedCollection?.value === batchId ? selectedCollection.label : t('Current batch')),
      searchText: selectedCollection?.value === batchId ? selectedCollection.searchText : undefined,
    })
  }
  collectionOptions.unshift({ value: '', label: t('All creations') })
  const scopePath = batchId
    ? `/api/image-studio/batches/${encodeURIComponent(batchId)}`
    : '/api/image-studio/library'
  const tasks = useQuery<StudioTaskPage>({
    queryKey: ['studio', 'library', batchId, filter, page],
    meta: { identity },
    placeholderData: (previous, query) =>
      query?.meta?.identity === identity &&
      query.queryKey[2] === batchId &&
      query.queryKey[3] === filter
        ? previous
        : undefined,
    queryFn: ({ signal }) =>
      request<StudioTaskPage>(`${scopePath}/tasks?p=${page}&page_size=60&status=${filter}`, {
        signal,
      }),
    refetchInterval: (query) => {
      const summary = query.state.data?.summary
      if (summary && (summary.active_count > 0 || summary.queued_count > 0)) return 3000
      if (query.state.data?.items.some(isRunning)) return 3000
      const selectedBatch = batches.data?.items.find((batch) => batch.batch_id === batchId)
      return selectedBatch && ['submitting', 'queued', 'running'].includes(selectedBatch.status)
        ? 3000
        : false
    },
  })
  const changingPage = tasks.isPlaceholderData || batches.isPlaceholderData
  const visible = tasks.data?.items || []
  const selectedTasks = selectedVisibleTasks(visible, selected)
  const completed = selectedTasks.filter((task) => task.status === 'SUCCESS')
  const downloadable = completed.filter((task) =>
    studioTaskContent(task).images.some(
      (image) => image.url && (!image.asset_status || image.asset_status === 'ready'),
    ),
  )
  const finished = visible.filter((task) => !isRunning(task))
  const batch = batches.data?.items.find((item) => item.batch_id === batchId)
  const summary = tasks.data?.summary || batch
  const deletedCount = summary?.deleted_count || 0
  const creationCount = Math.max(0, (summary?.total_count || 0) - deletedCount)
  const batchFinished = Boolean(
    summary && summary.total_count > 0 && summary.finished_count >= summary.total_count,
  )
  let batchTitle = t('Your idea is taking shape.')
  if (batchFinished) {
    batchTitle = t('Your creations are ready.')
    if (creationCount === 0) batchTitle = t('All creations in this collection were deleted.')
    else if (summary?.failure_count === creationCount)
      batchTitle = t('Your images could not be created.')
    else if (summary?.failure_count) batchTitle = t('Some images could not be created.')
  }
  const settledCount = summary?.finished_count ?? finished.length
  const settledKey = settledCount > 0 ? `${scopePath}:${settledCount}` : ''
  useStudioSettlement(settledKey)
  const preview = visible.find((task) => task.task_id === previewId)
  const previewContent = preview ? studioTaskContent(preview) : null

  const download = useMutation({
    mutationFn: async (scope: 'selected' | 'scope') => {
      let body: Record<string, unknown> = {
        scope: 'tasks',
        task_ids: downloadable.map((task) => task.task_id),
      }
      if (scope === 'scope')
        body = batchId ? { scope: 'batch', batch_id: batchId } : { scope: 'library' }
      const result = await request<{ url: string }>('/api/image-studio/download-ticket', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const url = safeImageURL(result.url)
      if (!url) throw new Error('The download link is unavailable.')
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noreferrer'
      anchor.click()
    },
    retry: false,
  })
  const remove = useMutation({
    mutationFn: async () => {
      if (deleteScope === 'selected')
        return request<{ batch_deleted?: boolean }>('/api/task/image-studio', {
          method: 'DELETE',
          body: JSON.stringify({ task_ids: selectedTasks.map((task) => task.task_id) }),
        })
      return request<{ batch_deleted?: boolean }>(
        `${scopePath}${deleteScope === 'failed' ? '/failed' : ''}`,
        {
          method: 'DELETE',
        },
      )
    },
    retry: false,
    onError: () => setDeleteScope(null),
    onSuccess: (result) => {
      if (deleteScope === 'scope' || result.batch_deleted) {
        setBatchId('')
        setFilter('all')
        if (routeSearch.batch)
          void navigate({
            to: '.',
            search: (current) => ({ ...current, batch: undefined }),
            replace: true,
          })
      }
      setDeleteScope(null)
      setSelected(new Set())
      setPage(1)
      void client.invalidateQueries({ queryKey: ['studio', 'library'] })
      void client.invalidateQueries({ queryKey: ['studio', 'batches'] })
    },
  })

  function changeScope(nextBatch: string, nextFilter: StudioFilter) {
    setBatchId(nextBatch)
    setFilter(nextFilter)
    setPage(1)
    setSelected(new Set())
  }
  function changePage(next: number) {
    setPreviewId(null)
    setDeleteScope(null)
    setPage(next)
    setSelected(new Set())
  }
  let deleteDescription = t(
    'Selected finished tasks and their stored images will be permanently deleted.',
  )
  if (deleteScope === 'failed')
    deleteDescription = batchId
      ? t(
          'All failed tasks in this collection will be deleted, regardless of the current status filter. Successful and running tasks will be kept.',
        )
      : t(
          'All failed tasks in your library will be deleted, regardless of the current status filter. Successful and running tasks will be kept.',
        )
  if (deleteScope === 'scope')
    deleteDescription = batchId
      ? t(
          'All finished creations in this collection and their stored files will be permanently deleted, regardless of the current status filter. Running batches cannot be deleted.',
        )
      : t(
          'All finished creations in your library and their stored files will be permanently deleted, regardless of the current status filter. Running batches cannot be deleted.',
        )

  return (
    <div className="page-stack library-page" aria-busy={changingPage}>
      {props.embedded ? (
        <header className="studio-results-heading">
          <div>
            <h2>{t('My creations')}</h2>
          </div>
          {(summary?.total_count || 0) > 0 && (
            <Button
              className="library-options-button"
              aria-label={t('Collection options')}
              variant="ghost"
              disabled={changingPage}
              onClick={() => setOptionsOpen(true)}
            >
              <MoreHorizontal size={18} aria-hidden />
            </Button>
          )}
        </header>
      ) : (
        <PageHeader
          title={t('My creations')}
          actions={
            <>
              {(summary?.total_count || 0) > 0 && (
                <Button
                  className="library-options-button"
                  aria-label={t('Collection options')}
                  variant="ghost"
                  disabled={changingPage}
                  onClick={() => setOptionsOpen(true)}
                >
                  <MoreHorizontal size={18} aria-hidden />
                </Button>
              )}
              <Link to="/studio" className="button button-primary">
                <Plus size={16} />
                {t('Create images')}
              </Link>
            </>
          }
        />
      )}
      <div className="library-toolbar">
        <SearchSelect
          label={t('Collection')}
          loading={batches.isPlaceholderData}
          popupClassName="collection-picker-popup"
          footer={
            (batches.data?.total || 0) > 100 ? (
              <Pagination
                compact
                label={t('Collection')}
                page={batchPage}
                pageSize={100}
                total={batches.data?.total || 0}
                onPageChange={setBatchPage}
                disabled={batches.isPlaceholderData}
              />
            ) : undefined
          }
          value={batchId}
          options={collectionOptions}
          onValueChange={(value) => {
            setSelectedCollection(collectionOptions.find((option) => option.value === value))
            changeScope(value, filter)
          }}
        />
        <div className="library-filter-tabs" role="group" aria-label={t('Creation status')}>
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'all'}
            onClick={() => changeScope(batchId, 'all')}
          >
            {t('All')}
          </Button>
          <Button
            variant={filter === 'active' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'active'}
            onClick={() => changeScope(batchId, 'active')}
          >
            {t('In progress')}
          </Button>
          <Button
            variant={filter === 'completed' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'completed'}
            onClick={() => changeScope(batchId, 'completed')}
          >
            {t('Completed')}
          </Button>
          <Button
            variant={filter === 'failed' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'failed'}
            onClick={() => changeScope(batchId, 'failed')}
          >
            {t('Failed')}
          </Button>
        </div>
        <Button
          variant="ghost"
          aria-label={t('Refresh creations')}
          busy={tasks.isFetching}
          onClick={() => {
            void tasks.refetch()
            void batches.refetch()
          }}
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      {batches.error && (
        <ErrorState
          error={batches.error}
          retry={() => {
            void batches.refetch()
          }}
        />
      )}
      {batchId && summary && (
        <div
          className={`studio-batch-card studio-inline-progress library-batch-progress ${batchFinished ? 'is-finished' : ''}`}
          role="status"
          aria-live="polite"
        >
          <Badge>{batchFinished ? t('Batch finished') : t('Creation in progress')}</Badge>
          <h3 className="library-batch-title">{batchTitle}</h3>
          {!batchFinished && (
            <progress
              aria-label={t('Batch progress')}
              max={summary.total_count || 1}
              value={summary.finished_count}
            />
          )}
          <span>
            {t('{{completed}} of {{total}} finished', {
              completed: summary.finished_count,
              total: summary.total_count,
            })}
          </span>
          {deletedCount > 0 && (
            <p>
              {t('{{count}} deleted tasks are included in the original batch progress.', {
                count: deletedCount,
              })}
            </p>
          )}
        </div>
      )}
      <div className="library-summary-row">
        {visible.length > 0 && (
          <div className="library-selection">
            <label className="row">
              <Checkbox
                checked={finished.length > 0 && selectedTasks.length === finished.length}
                disabled={changingPage || !finished.length}
                onCheckedChange={(checked) =>
                  setSelected(new Set(checked ? finished.map((task) => task.task_id) : []))
                }
              />
              {t('Select finished creations')}
            </label>
            {selectedTasks.length > 0 && (
              <div className="row">
                <Button
                  variant="secondary"
                  disabled={changingPage || !downloadable.length}
                  busy={download.isPending}
                  onClick={() => download.mutate('selected')}
                >
                  <Download size={15} />
                  {downloadable.length === selectedTasks.length
                    ? t('Download selected')
                    : t('Download available {{count}}', { count: downloadable.length })}
                </Button>
                <Button
                  variant="ghost"
                  disabled={changingPage || !selectedTasks.length || remove.isPending}
                  onClick={() => {
                    remove.reset()
                    setDeleteScope('selected')
                  }}
                >
                  <Trash2 size={15} />
                  {t('Delete selected')}
                </Button>
              </div>
            )}
            {selectedTasks.length > 0 && downloadable.length !== selectedTasks.length && (
              <p className="muted library-selection-notice" role="status">
                {t('Only selected creations with available images will be downloaded.')}
              </p>
            )}
          </div>
        )}
        {summary && (
          <div className="library-summary">
            <span>{t('{{count}} creations', { count: creationCount })}</span>
            <span className="muted">
              {t('{{success}} completed · {{failed}} failed', {
                success: summary.success_count,
                failed: summary.failure_count,
              })}
            </span>
            {summary.queued_count + summary.active_count > 0 && (
              <Badge>
                {t('{{count}} in progress', { count: summary.queued_count + summary.active_count })}
              </Badge>
            )}
          </div>
        )}
        <p className="studio-page-status" data-testid="studio-page-status" aria-live="polite">
          {changingPage ? t('Loading…') : ''}
        </p>
      </div>
      {tasks.isPending && <LoadingState />}
      {tasks.error && (
        <ErrorState
          error={tasks.error}
          retry={() => {
            void tasks.refetch()
          }}
        />
      )}
      {!tasks.isPending && !tasks.error && visible.length === 0 && (
        <EmptyState
          title={
            filter === 'all'
              ? t('Your next favorite image starts here.')
              : t('No creations match this filter')
          }
          description={
            filter === 'all'
              ? t('Create your first image and it will appear in this collection.')
              : t('There are no creations with this status.')
          }
          action={
            filter !== 'all' ? (
              <Button variant="secondary" onClick={() => changeScope(batchId, 'all')}>
                {t('Clear filters')}
              </Button>
            ) : props.embedded ? undefined : (
              <Link to="/studio" className="button button-primary">
                {t('Create an image')}
                <ArrowRight size={16} />
              </Link>
            )
          }
        />
      )}
      {visible.length > 0 && (
        <>
          <div className="studio-gallery">
            {visible.map((task) => (
              <TaskCard
                key={task.task_id}
                task={task}
                selected={selected.has(task.task_id)}
                disabled={changingPage}
                onSelect={() =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(task.task_id)) next.delete(task.task_id)
                    else next.add(task.task_id)
                    return next
                  })
                }
                onPreview={() => setPreviewId(task.task_id)}
              />
            ))}
          </div>
        </>
      )}
      {!tasks.isPending && ((tasks.data?.total || 0) > 60 || page > 1) && (
        <Pagination
          page={page}
          pageSize={60}
          total={tasks.data?.total || 0}
          onPageChange={changePage}
        />
      )}
      {download.error && <ErrorState error={download.error} />}
      <Modal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title={t('Collection options')}
      >
        <div className="library-maintenance">
          <div className="row">
            {batchId && (
              <Button
                variant="secondary"
                onClick={() => {
                  setOptionsOpen(false)
                  setCollectionName(readPreference(`${identity}:studio:name:${batchId}`))
                  setNameNotice('')
                  setRenameOpen(true)
                }}
              >
                {t('Rename collection')}
              </Button>
            )}
            {config.data?.download_all_enabled && (
              <Button
                variant="secondary"
                busy={download.isPending}
                disabled={changingPage || !summary?.success_count}
                onClick={() => download.mutate('scope')}
              >
                <Download size={15} />
                {batchId ? t('Download collection') : t('Download all creations')}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={changingPage || !summary?.failure_count}
              onClick={() => {
                setOptionsOpen(false)
                remove.reset()
                setDeleteScope('failed')
              }}
            >
              {t('Clear failed tasks')}
            </Button>
            <Button
              variant="danger"
              disabled={
                changingPage || Boolean(summary && (summary.active_count || summary.queued_count))
              }
              onClick={() => {
                setOptionsOpen(false)
                remove.reset()
                setDeleteScope('scope')
              }}
            >
              {batchId ? t('Delete collection') : t('Delete all creations')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title={t('Rename collection')}>
        <div className="stack">
          <Field
            label={t('Collection name on this device')}
            hint={t(
              'Only saved on this device for this account. Other devices keep the original collection name.',
            )}
          >
            <Input
              maxLength={100}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              savePreference(`${identity}:studio:name:${batchId}`, collectionName.trim())
              const saved = readPreference(`${identity}:studio:name:${batchId}`)
              setNames((current) => ({ ...current, [batchId]: saved }))
              setNameNotice(
                saved === collectionName.trim()
                  ? 'Collection name saved on this device.'
                  : 'Could not save the collection name on this device.',
              )
            }}
          >
            {t('Save collection name')}
          </Button>
          {nameNotice && <p role="status">{t(nameNotice)}</p>}
        </div>
      </Modal>
      <Modal
        open={Boolean(preview)}
        onClose={() => setPreviewId(null)}
        title={t('Creation details')}
        className="studio-preview-modal"
      >
        {preview && previewContent && (
          <div className="stack">
            {previewContent.images.map((image, index) =>
              image.url ? (
                <img
                  className="studio-preview-image"
                  src={image.url}
                  alt={previewContent.request.prompt || t('Generated image')}
                  key={index}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <p className="muted" key={index}>
                  {t('This image is no longer available. Keep local copies of your favorites.')}
                </p>
              ),
            )}
            <p className="studio-preview-prompt">{previewContent.request.prompt}</p>
            <CopyButton value={previewContent.request.prompt || ''} label={t('Copy prompt')} />
            <details className="studio-preview-metadata">
              <summary>{t('Creation settings and identifiers')}</summary>
              <dl className="detail-grid">
                <TaskTiming task={preview} detailed />
                <dt>{t('Image size')}</dt>
                <dd>{previewContent.request.size || t('Model default')}</dd>
                <dt>{t('Quality')}</dt>
                <dd>{previewContent.request.quality || t('Model default')}</dd>
                <dt>{t('Images in batch')}</dt>
                <dd>{previewContent.request.batch_size || previewContent.request.count || 1}</dd>
                <dt>{t('Creation mode')}</dt>
                <dd>
                  {previewContent.request.mode === 'edit'
                    ? t('With references')
                    : t('Text to image')}
                </dd>
                <dt>{t('Collection')}</dt>
                <dd>{previewContent.request.batch_id || '—'}</dd>
                <dt>{t('Task ID')}</dt>
                <dd>{preview.task_id}</dd>
                {previewContent.request.request_id && (
                  <>
                    <dt>{t('Request ID')}</dt>
                    <dd>{previewContent.request.request_id}</dd>
                  </>
                )}
              </dl>
            </details>
            {previewContent.request.prompt &&
              (props.onReuse ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    props.onReuse?.({
                      group: preview.group,
                      model: previewContent.request.model || '',
                      prompt: previewContent.request.prompt || '',
                      count: previewContent.request.batch_size || previewContent.request.count || 1,
                      size: previewContent.request.size || '',
                      quality: previewContent.request.quality || '',
                      needsReferences: previewContent.request.mode === 'edit',
                    })
                    setPreviewId(null)
                  }}
                >
                  {t('Create again with these settings')}
                </Button>
              ) : (
                <Link
                  to="/studio"
                  className="button button-secondary"
                  onClick={(event) => {
                    if (
                      !session.user ||
                      !saveStudioDraft(session.user.id, {
                        group: preview.group,
                        model: previewContent.request.model || '',
                        prompt: previewContent.request.prompt || '',
                        count:
                          previewContent.request.batch_size || previewContent.request.count || 1,
                        size: previewContent.request.size || '',
                        quality: previewContent.request.quality || '',
                        needsReferences: previewContent.request.mode === 'edit',
                      })
                    ) {
                      event.preventDefault()
                      setNameNotice('Draft storage is unavailable. Keep a copy before leaving.')
                    }
                  }}
                >
                  {t('Create again with these settings')}
                </Link>
              ))}
            <p className="muted studio-note">
              {t(
                'Reusing settings does not submit a request. Review the estimate and attach reference images again if needed.',
              )}
            </p>
            <div className="row">
              <Badge>{previewContent.request.model || '—'}</Badge>
              <Badge>{preview.group}</Badge>
              <span>
                {formatQuota(preview.quota, status.data, toIntlLocale(i18n.resolvedLanguage))}
              </span>
            </div>
            {previewContent.request.request_id && (
              <Link
                to="/usage"
                search={{ request_id: previewContent.request.request_id, from: preview.created_at }}
                className="button button-secondary"
              >
                {t('View usage for this creation')}
              </Link>
            )}
            {preview.fail_reason && <p role="alert">{preview.fail_reason}</p>}
            {previewContent.images.map(
              (image, index) =>
                image.download_url && (
                  <a
                    key={image.download_url}
                    className="button button-primary"
                    href={image.download_url}
                    rel="noreferrer"
                  >
                    <Download size={16} />
                    {previewContent.images.length > 1
                      ? t('Download image {{number}}', { number: index + 1 })
                      : t('Download image')}
                  </a>
                ),
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleteScope !== null}
        onClose={() => {
          if (!remove.isPending) setDeleteScope(null)
        }}
        title={t('Delete these creations?')}
        description={deleteDescription}
        busy={remove.isPending}
        onConfirm={() => {
          if (!changingPage) remove.mutate()
        }}
      />
      {remove.error && <ErrorState error={remove.error} />}
    </div>
  )
}
