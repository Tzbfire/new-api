import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ImagePlus, Lightbulb, Plus, Sparkles } from 'lucide-react'
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from '@/components/ui'
import { ServicePicker } from '@/components/service-picker'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { usePreferredModel } from '@/lib/use-preferred-model'
import { readStudioDraft, saveStudioDraft } from './draft'
import { formatQuota } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { toIntlLocale } from '@/i18n/languages'
import { submitStudioRequest } from './api'
import { CreationsGallery } from './LibraryPage'
import {
  matchingSizePresets,
  type StudioTaskPage,
  type StudioConfig,
  type StudioEstimate,
  type StudioRequest,
} from './contracts'
import { ReferencePreview } from './ReferencePreview'
import './studio.css'

export default function StudioPage() {
  const session = useSession()
  if (!session.user) return <LoadingState />
  return <StudioWorkspace key={session.user.id} userId={session.user.id} />
}

function StudioWorkspace(props: { userId: number }) {
  const { t, i18n } = useTranslation()
  const catalog = useCatalog()
  const status = useStatus()
  const session = useSession()
  const client = useQueryClient()
  const [draft] = useState(() => readStudioDraft(props.userId))
  const [model, setModel] = usePreferredModel('image')
  const [prompt, setPrompt] = useState(draft?.prompt || '')
  const [count, setCount] = useState(draft?.count || 1)
  const [size, setSize] = useState(draft?.size || '')
  const [quality, setQuality] = useState(draft?.quality || '')
  const [needsReferences, setNeedsReferences] = useState(draft?.needsReferences || false)
  const [restored, setRestored] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const [pendingReuse, setPendingReuse] = useState<StudioRequest | null>(null)
  useEffect(() => {
    if (restored || catalog.isPending || catalog.error) return
    if (
      draft &&
      !new URLSearchParams(window.location.search).has('group') &&
      !new URLSearchParams(window.location.search).has('model')
    ) {
      if (catalog.groups.some((item) => item.id === draft.group) && catalog.group !== draft.group) {
        catalog.setGroup(draft.group)
        return
      }
      if (!catalog.groups.some((item) => item.id === draft.group))
        setDraftNotice(
          'The original service group is unavailable. Review the selected group and model.',
        )
      if (catalog.models.some((item) => item.model_name === draft.model)) setModel(draft.model)
      else if (draft.model)
        setDraftNotice('The saved model is unavailable. Review the selected model and parameters.')
    }
    setRestored(true)
  }, [catalog, draft, restored, setModel])
  useEffect(() => {
    if (!pendingReuse || catalog.isPending || catalog.error) return
    if (catalog.group !== pendingReuse.group) {
      setDraftNotice(
        'The original service group is unavailable. Review the selected group and model.',
      )
    } else if (catalog.models.some((item) => item.model_name === pendingReuse.model)) {
      setModel(pendingReuse.model)
    } else {
      setDraftNotice('The saved model is unavailable. Review the selected model and parameters.')
    }
    setPendingReuse(null)
  }, [catalog, pendingReuse, setModel])
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [ideasOpen, setIdeasOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState('')
  const config = useQuery({
    queryKey: ['studio', 'config'],
    queryFn: ({ signal }) => request<StudioConfig>('/pg/image-studio/config', { signal }),
  })
  const presets = matchingSizePresets(config.data, catalog.group, model)
  const validSize = presets.some((preset) => `${preset.width}x${preset.height}` === size)
    ? size
    : ''
  const mode = files.length ? 'edit' : 'generation'
  const payload: StudioRequest = {
    group: catalog.group,
    model,
    prompt,
    count,
    size: validSize,
    quality,
  }
  useEffect(() => {
    if (!restored || !model || pendingReuse) return
    setStorageFailed(
      !saveStudioDraft(props.userId, {
        ...payload,
        size,
        needsReferences: needsReferences || files.length > 0,
      }),
    )
  }, [
    props.userId,
    restored,
    model,
    prompt,
    count,
    size,
    quality,
    catalog.group,
    needsReferences,
    files.length,
    pendingReuse,
  ])
  const [quotePayload, setQuotePayload] = useState(payload)
  const serializedPayload = JSON.stringify(payload)
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setQuotePayload(JSON.parse(serializedPayload) as StudioRequest),
      400,
    )
    return () => window.clearTimeout(timeout)
  }, [serializedPayload])
  const estimate = useQuery({
    queryKey: ['studio', 'estimate', quotePayload, mode],
    queryFn: ({ signal }) =>
      request<StudioEstimate>(`/pg/image-studio/estimate?mode=${mode}`, {
        method: 'POST',
        body: JSON.stringify(quotePayload),
        signal,
      }),
    enabled: Boolean(
      restored &&
      quotePayload.model &&
      quotePayload.group &&
      quotePayload.prompt.trim() &&
      Number.isInteger(quotePayload.count) &&
      quotePayload.count > 0 &&
      quotePayload.count <= (config.data?.max_batch_size || 1000),
    ),
    retry: false,
    staleTime: 0,
  })
  const quoteCurrent =
    serializedPayload === JSON.stringify(quotePayload) &&
    !estimate.isFetching &&
    Boolean(estimate.data)
  const canCreate = Boolean(
    restored &&
    !pendingReuse &&
    quoteCurrent &&
    prompt.trim() &&
    config.data &&
    model &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= config.data.max_batch_size &&
    (!size || validSize) &&
    (!needsReferences || files.length) &&
    status.data?.enable_drawing !== false,
  )
  const submit = useMutation({
    mutationFn: (submitted: StudioRequest) =>
      submitStudioRequest(submitted, files, config.data?.max_batch_size || 1000),
    retry: false,
    onSuccess: (result, submitted) => {
      setPrompt((current) => (current === submitted.prompt ? '' : current))
      const finished = result.tasks.filter((task) => ['SUCCESS', 'FAILURE'].includes(task.status))
      client.setQueryData<StudioTaskPage>(['studio', 'library', result.batch_id, 'all', 1], {
        items: result.tasks,
        total: result.total_count,
        page: 1,
        page_size: 60,
        summary: {
          total_count: result.total_count,
          queued_count: result.total_count - finished.length,
          active_count: 0,
          success_count: finished.filter((task) => task.status === 'SUCCESS').length,
          failure_count: finished.filter((task) => task.status === 'FAILURE').length,
          finished_count: finished.length,
        },
      })
      void client.invalidateQueries({ queryKey: ['studio', 'library'] })
      void client.invalidateQueries({ queryKey: ['studio', 'batches'] })
      void session.refreshUser().catch(() => undefined)
    },
  })

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return
    const next = [...files]
    let error = ''
    for (const file of Array.from(incoming)) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        error = 'Only PNG, JPEG, and WebP images are supported.'
        continue
      }
      if (file.size > 20 * 1024 * 1024) {
        error = 'Each reference image must be 20 MB or smaller.'
        continue
      }
      if (
        next.length >= 6 ||
        next.reduce((sum, value) => sum + value.size, 0) + file.size > 60 * 1024 * 1024
      ) {
        error = 'Add up to 6 reference images, with 60 MB in total.'
        break
      }
      next.push(file)
    }
    setFiles(next)
    setFileError(error)
  }

  let quoteStatus = ''
  if (
    prompt.trim() &&
    model &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= (config.data?.max_batch_size || 1000) &&
    !quoteCurrent &&
    !estimate.error
  )
    quoteStatus = t('Calculating…')
  else if (estimate.data && quoteCurrent && estimate.data.resolved_group !== catalog.group)
    quoteStatus = `${t('Service group')}: ${estimate.data.resolved_group}`

  return (
    <div className="page-stack studio-page">
      <PageHeader
        title={t('Image studio')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={16} aria-hidden />
              {t('Creation help')}
            </Button>
            <a className="button button-secondary studio-jump-link" href="#studio-creations">
              {t('My creations')}
            </a>
          </>
        }
      />
      <div className="studio-layout">
        <Card className="studio-create-card">
          <form
            className={`stack studio-reference-target ${dragging ? 'is-dragging' : ''}`}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/'),
              )
              if (!images.length) return
              event.preventDefault()
              addFiles(images)
            }}
            onDragEnter={(event) => {
              if (!Array.from(event.dataTransfer.types).includes('Files')) return
              event.preventDefault()
              dragDepth.current += 1
              setDragging(true)
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (!dragDepth.current) setDragging(false)
            }}
            onDrop={(event) => {
              if (!Array.from(event.dataTransfer.types).includes('Files')) return
              event.preventDefault()
              dragDepth.current = 0
              setDragging(false)
              addFiles(event.dataTransfer.files)
            }}
            onSubmit={(event) => {
              event.preventDefault()
              if (canCreate && !submit.isPending) submit.mutate(payload)
            }}
          >
            {dragging && (
              <div className="studio-drop-indicator" role="status">
                <ImagePlus size={24} aria-hidden />
                {t('Drop reference images here')}
              </div>
            )}
            {storageFailed && (
              <p role="alert">{t('Draft storage is unavailable. Keep a copy before leaving.')}</p>
            )}
            {draftNotice && <p role="status">{t(draftNotice)}</p>}
            {needsReferences && !files.length && (
              <div role="status">
                <p>{t('Reference images are not saved. Attach them again before creating.')}</p>
                <Button variant="ghost" onClick={() => setNeedsReferences(false)}>
                  {t('Continue without reference images')}
                </Button>
              </div>
            )}
            {size && config.data && !validSize && (
              <p role="status">
                {t('The saved size is unavailable for this model. Choose an image size again.')}
              </p>
            )}
            <Field label={t('Your idea')}>
              <Textarea
                rows={4}
                maxLength={16_000}
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t(
                  'A quiet bookshop on a rainy evening, warm lights spilling onto the street, cinematic photography…',
                )}
              />
            </Field>
            <div className="studio-prompt-tools">
              <Button
                variant="secondary"
                aria-label={t('Choose reference images')}
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={16} aria-hidden />
                {t('Reference images')}
              </Button>
              <span className="muted">{t('Paste or drop images')}</span>
              {!!config.data?.prompt_presets.length && (
                <Button variant="ghost" onClick={() => setIdeasOpen(true)}>
                  <Lightbulb size={15} aria-hidden />
                  {t('Prompt ideas')}
                </Button>
              )}
              <input
                ref={fileInput}
                className="studio-hidden-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                aria-label={t('Reference images')}
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
            {fileError && (
              <p role="alert" className="field-error">
                {t(fileError)}
              </p>
            )}
            {files.length > 0 && (
              <div className="studio-reference-list">
                {files.map((file, index) => (
                  <ReferencePreview
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() => {
                      setFiles((current) => current.filter((_, position) => index !== position))
                      setFileError('')
                    }}
                  />
                ))}
              </div>
            )}
            <section
              className="studio-advanced studio-settings"
              aria-label={t('Creation settings')}
            >
              <div className="stack">
                <ServicePicker kind="image" model={model} onModelChange={setModel} />
                <div className="studio-options-row">
                  <Field label={t('Image size')}>
                    <Select
                      value={validSize}
                      onValueChange={setSize}
                      options={[
                        { value: '', label: t('Model default') },
                        ...presets.map((preset) => ({
                          value: `${preset.width}x${preset.height}`,
                          label: `${preset.aspect_ratio} · ${preset.tier_label}${preset.experimental ? ` · ${t('Experimental')}` : ''}`,
                        })),
                      ]}
                    />
                  </Field>
                </div>
                <fieldset className="studio-count">
                  <legend>{t('Images')}</legend>
                  <div className="studio-count-presets">
                    {[1, 2, 4, 8]
                      .filter((value) => value <= (config.data?.max_batch_size || 1000))
                      .map((value) => (
                        <Button
                          key={value}
                          variant="secondary"
                          aria-label={t('{{count}} images', { count: value })}
                          aria-pressed={count === value}
                          onClick={() => setCount(value)}
                        >
                          {value}
                        </Button>
                      ))}
                    <Field label={t('custom')}>
                      <Input
                        aria-label={t('Images')}
                        type="number"
                        min={1}
                        max={config.data?.max_batch_size || 1000}
                        step={1}
                        required
                        value={Number.isNaN(count) ? '' : count}
                        onChange={(event) => setCount(event.target.valueAsNumber)}
                      />
                    </Field>
                  </div>
                </fieldset>
                <fieldset className="studio-quality">
                  <legend>{t('Quality')}</legend>
                  <div className="studio-quality-options">
                    {['', 'low', 'medium', 'high', 'standard', 'hd'].map((value) => (
                      <Button
                        key={value}
                        variant="secondary"
                        aria-pressed={quality === value}
                        onClick={() => setQuality(value)}
                      >
                        {t(
                          (
                            {
                              '': 'Model default',
                              low: 'Low',
                              medium: 'Medium',
                              high: 'High',
                              standard: 'Standard',
                              hd: 'HD',
                            } as Record<string, string>
                          )[value]!,
                        )}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>
            {count > (config.data?.interactive_batch_limit || 10) && (
              <p className="muted studio-note">
                {t(
                  'Large batches run in the background. You can leave this page and find them in your library.',
                )}
              </p>
            )}
            {estimate.error && (
              <ErrorState
                error={estimate.error}
                retry={() => {
                  void estimate.refetch()
                }}
              />
            )}
            {submit.error && (
              <>
                <ErrorState error={submit.error} />
                <p className="studio-note">
                  {t(
                    'If the connection was interrupted, check your library before submitting again.',
                  )}
                </p>
              </>
            )}
            {config.error && (
              <ErrorState
                error={config.error}
                retry={() => {
                  void config.refetch()
                }}
              />
            )}
            {status.data?.enable_drawing === false && (
              <p role="status" className="field-error">
                {t('Image creation is currently unavailable.')}
              </p>
            )}
            <div className="studio-submit-area">
              <div className="studio-submit-row">
                <div className="studio-estimate" aria-live="polite">
                  <span>{t('Estimated total')}</span>
                  <strong>
                    {quoteCurrent && estimate.data
                      ? formatQuota(
                          estimate.data.estimated_quota,
                          status.data,
                          toIntlLocale(i18n.resolvedLanguage),
                        )
                      : '—'}
                  </strong>
                </div>
                <Button type="submit" busy={submit.isPending} disabled={!canCreate}>
                  <Sparkles size={17} />
                  {files.length ? t('Create with references') : t('Create images')}
                </Button>
              </div>
              <div className="studio-submit-context">
                <span className="studio-batch-note">
                  {t('{{count}} images', {
                    count: Number.isInteger(count) && count > 0 ? count : '—',
                  })}
                </span>
                <span
                  className="muted studio-quote-status"
                  data-testid="studio-quote-status"
                  aria-live="polite"
                  title={quoteStatus || undefined}
                >
                  {quoteStatus || '\u00a0'}
                </span>
              </div>
            </div>
          </form>
        </Card>
        <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t('Creation help')}>
          <div className="stack studio-help-content">
            <p>{t('Be specific about the subject, mood, lighting, and style.')}</p>
            <p>{t('PNG, JPEG or WebP. Up to 6 images, 20 MB each and 60 MB total.')}</p>
            <p>{t('Available quality options depend on the selected model.')}</p>
            <p>{t('Your draft is saved on this device for this account.')}</p>
            <p>
              {t(
                'The server reserves an estimate when you submit. Final cost follows actual usage and your service group.',
              )}
            </p>
          </div>
        </Modal>
        <Modal open={ideasOpen} onClose={() => setIdeasOpen(false)} title={t('Prompt ideas')}>
          <div className="studio-presets">
            {config.data?.prompt_presets.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="ghost"
                onClick={() => {
                  setPrompt(preset.prompt)
                  setIdeasOpen(false)
                  const recommended = presets.find(
                    (item) =>
                      item.aspect_ratio === preset.aspect_ratio &&
                      (!preset.tier || item.tier === preset.tier),
                  )
                  if (recommended) setSize(`${recommended.width}x${recommended.height}`)
                  else if (preset.aspect_ratio)
                    setDraftNotice(
                      'This prompt preset has no available matching size. Choose the image size manually.',
                    )
                }}
              >
                <Plus size={13} />
                {preset.title}
              </Button>
            ))}
          </div>
        </Modal>
        <section
          id="studio-creations"
          tabIndex={-1}
          className="studio-results"
          aria-label={t('My creations')}
        >
          <CreationsGallery
            embedded
            onReuse={(request) => {
              if (catalog.groups.some((item) => item.id === request.group))
                catalog.setGroup(request.group)
              setPrompt(request.prompt)
              setSize(request.size)
              setQuality(request.quality)
              setCount(request.count)
              setPendingReuse(request)
              saveStudioDraft(props.userId, request)
              setFiles([])
              setNeedsReferences(request.needsReferences)
              setDraftNotice('Creation settings copied. Review the new estimate before creating.')
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        </section>
      </div>
    </div>
  )
}
