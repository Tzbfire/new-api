/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import {
  Clock,
  Copy,
  Download,
  FileImage,
  ImagePlus,
  Images,
  Loader2,
  Maximize2,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SectionPageLayout } from '@/components/layout'
import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  deleteImageStudioTasks,
  getImageStudioGroups,
  getImageStudioModels,
  getImageStudioPricing,
  getImageStudioTasks,
  refreshImageStudioUser,
  submitImageEdit,
  submitImageGeneration,
} from './api'
import {
  ASPECT_KEYS,
  ASPECT_OPTIONS,
  IMAGE_TASK_POLL_INTERVAL,
  IMAGE_TASK_SSE_POLL_INTERVAL,
  IMAGE_TASK_SSE_REFRESH_DEBOUNCE,
  LS_HIDDEN_RESULTS,
  LS_LAST_GROUP,
  LS_LAST_MODEL,
  MAX_IMAGE_COUNT,
  MAX_REFERENCE_IMAGES,
  PROMPT_PRESETS,
  SIZE_TO_ASPECT,
  SIZE_TO_TIER,
  TIER_ASPECT_TO_SIZE,
  TIER_KEYS,
} from './constants'
import {
  computeSizeRatio,
  downloadOneResult,
  formatDuration,
  getQuotaPerUnit,
  getTaskElapsedSeconds,
  imageResultToBlob,
  imageStudioTaskEventURL,
  isDownloadableResult,
  pickPreferredModel,
  taskToItems,
  triggerDownload,
  zipImageResults,
} from './utils'
import type {
  AspectKey,
  GroupOption,
  ImageSizePrices,
  ImageSizeTier,
  ImageStudioMode,
  ImageStudioResult,
  ModelOption,
  PricingEntry,
} from './types'

type HiddenResultIds = string[]

type ApiErrorShape = {
  response?: {
    data?: {
      error?: { message?: string }
      message?: string
    }
  }
  message?: string
}

type QuotaStatProps = {
  label: string
  value: string
  tone?: 'default' | 'success' | 'danger'
}

type ResultCardProps = {
  item: ImageStudioResult
  elapsedSeconds: number | null
  onDownload: (item: ImageStudioResult) => void
  onPreview: (item: ImageStudioResult) => void
  onRemove: (item: ImageStudioResult) => void
  onReusePrompt: (item: ImageStudioResult) => void
  onUseAsReference: (item: ImageStudioResult) => void
}

function readLocalStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value)
    }
  } catch {
    /* empty */
  }
}

function readHiddenResultIds(): HiddenResultIds {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(LS_HIDDEN_RESULTS)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function getSavedUserGroup(fallback: string | undefined): string | undefined {
  if (fallback) return fallback
  try {
    const raw = readLocalStorage('user')
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { group?: unknown }
    return typeof parsed.group === 'string' ? parsed.group : undefined
  } catch {
    return undefined
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback
  if (!error || typeof error !== 'object') return fallback

  const shaped = error as ApiErrorShape
  return (
    shaped.response?.data?.error?.message ||
    shaped.response?.data?.message ||
    shaped.message ||
    fallback
  )
}

function clampImageCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.floor(value)))
}

function groupOptionLabel(group: GroupOption): string {
  if (group.ratio == null) return group.label
  return `${group.label} ×${group.ratio}`
}

function QuotaStat(props: QuotaStatProps) {
  return (
    <div className='rounded-xl border bg-background/60 px-3 py-2 shadow-xs'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div
        className={cn(
          'mt-1 truncate text-sm font-semibold',
          props.tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
          props.tone === 'danger' && 'text-rose-600 dark:text-rose-400'
        )}
      >
        {props.value}
      </div>
    </div>
  )
}

function ResultCard(props: ResultCardProps) {
  const { t } = useTranslation()
  const item = props.item
  const isPending = item.status === 'pending'
  const isFailed = item.status === 'failed'

  return (
    <Card className='group overflow-hidden py-0' size='sm'>
      <div className='bg-muted/40 relative aspect-square overflow-hidden'>
        {isPending ? (
          <div className='flex size-full flex-col items-center justify-center gap-3 p-4'>
            <Skeleton className='absolute inset-0 size-full rounded-none' />
            <div className='bg-background/80 relative z-10 rounded-full p-3 shadow-sm ring-1 ring-foreground/10 backdrop-blur'>
              <Loader2 className='size-5 animate-spin text-primary' />
            </div>
            <div className='relative z-10 text-center text-xs text-muted-foreground'>
              {t('Generating...')}
              {props.elapsedSeconds != null && (
                <span className='mt-1 block'>
                  {t('Elapsed')} {formatDuration(props.elapsedSeconds)}
                </span>
              )}
            </div>
          </div>
        ) : null}

        {isFailed ? (
          <div className='flex size-full flex-col items-center justify-center gap-3 p-5 text-center'>
            <div className='rounded-full bg-destructive/10 p-3 text-destructive'>
              <X className='size-5' />
            </div>
            <div className='text-sm font-medium text-destructive'>
              {t('Generation failed')}
            </div>
            <div className='line-clamp-4 text-xs text-muted-foreground'>
              {item.error || '-'}
            </div>
          </div>
        ) : null}

        {!isPending && !isFailed ? (
          <button
            type='button'
            className='block size-full cursor-zoom-in'
            onClick={() => props.onPreview(item)}
          >
            <img
              src={item.src}
              alt={item.prompt || item.model || t('Generated image')}
              className='size-full object-cover transition-transform duration-300 group-hover:scale-105'
              loading='lazy'
            />
          </button>
        ) : null}

        <div className='absolute top-2 left-2 flex flex-wrap gap-1'>
          <Badge variant={isFailed ? 'destructive' : 'secondary'}>
            {item.mode === 'i2i' ? t('Image to image') : t('Text to image')}
          </Badge>
          {item.size ? <Badge variant='outline'>{item.size}</Badge> : null}
        </div>

        <div className='absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'>
          {!isPending && !isFailed ? (
            <>
              <Button
                aria-label={t('Preview')}
                className='bg-background/85 backdrop-blur'
                size='icon-sm'
                variant='outline'
                onClick={() => props.onPreview(item)}
              >
                <Maximize2 className='size-3.5' />
              </Button>
              <Button
                aria-label={t('Download')}
                className='bg-background/85 backdrop-blur'
                size='icon-sm'
                variant='outline'
                onClick={() => props.onDownload(item)}
              >
                <Download className='size-3.5' />
              </Button>
            </>
          ) : null}
          <Button
            aria-label={t('Remove')}
            className='bg-background/85 backdrop-blur'
            size='icon-sm'
            variant='outline'
            onClick={() => props.onRemove(item)}
          >
            <X className='size-3.5' />
          </Button>
        </div>
      </div>

      <div className='space-y-3 p-3'>
        <div className='flex items-center justify-between gap-2'>
          <div className='min-w-0 truncate text-sm font-medium'>{item.model}</div>
          <div className='text-muted-foreground shrink-0 text-xs'>#{item.index}</div>
        </div>
        <div className='text-muted-foreground line-clamp-2 min-h-8 text-xs leading-relaxed'>
          {item.prompt || t('No prompt')}
        </div>
        <div className='flex flex-wrap gap-1.5'>
          <Button size='xs' variant='outline' onClick={() => props.onReusePrompt(item)}>
            <Copy className='size-3' />
            {t('Reuse')}
          </Button>
          {!isPending && !isFailed ? (
            <Button
              size='xs'
              variant='outline'
              onClick={() => props.onUseAsReference(item)}
            >
              <ImagePlus className='size-3' />
              {t('Reference')}
            </Button>
          ) : null}
          {item.cost != null ? (
            <Badge variant='ghost'>
              {item.costIsBatchTotal ? t('Batch') : t('Cost')}: {formatQuota(item.cost)}
            </Badge>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

export function ImageStudio() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const setUser = useAuthStore((state) => state.auth.setUser)

  const [groups, setGroups] = useState<GroupOption[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [group, setGroup] = useState('')
  const [model, setModel] = useState('')
  const [imageModelsByGroup, setImageModelsByGroup] = useState<
    Record<string, ModelOption[]>
  >({})
  const [groupHasNoImageModel, setGroupHasNoImageModel] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [n, setN] = useState(1)
  const [mode, setMode] = useState<ImageStudioMode>('t2i')
  const [refFiles, setRefFiles] = useState<File[]>([])
  const [refPreviews, setRefPreviews] = useState<string[]>([])
  const [pricingMap, setPricingMap] = useState<Record<string, PricingEntry>>({})
  const [groupRatioMap, setGroupRatioMap] = useState<Record<string, number | string>>({})
  const [results, setResults] = useState<ImageStudioResult[]>([])
  const [hiddenResultIds, setHiddenResultIds] = useState<HiddenResultIds>(() =>
    readHiddenResultIds()
  )
  const [lastCost, setLastCost] = useState<number | null>(null)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [bootstrapLoading, setBootstrapLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [hasPendingTask, setHasPendingTask] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [nowMs, setNowMs] = useState(Date.now())
  const [isDragOver, setIsDragOver] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [previewResult, setPreviewResult] = useState<ImageStudioResult | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragCounterRef = useRef(0)
  const taskEventsConnectedRef = useRef(false)
  const taskLastRefreshAtRef = useRef(0)

  useEffect(() => {
    const urls = refFiles.map((file) => URL.createObjectURL(file))
    setRefPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [refFiles])

  const hiddenResultSet = useMemo(
    () => new Set(hiddenResultIds),
    [hiddenResultIds]
  )

  const downloadableResults = useMemo(
    () => results.filter(isDownloadableResult),
    [results]
  )

  const sizePrices = useMemo<ImageSizePrices | null>(() => {
    const pricing = pricingMap[model]
    if (!pricing?.size_prices) return null
    if (Object.keys(pricing.size_prices).length === 0) return null
    return pricing.size_prices
  }, [pricingMap, model])

  const currentTier = useMemo<ImageSizeTier>(
    () => SIZE_TO_TIER[size] || '2K',
    [size]
  )
  const currentAspect = useMemo<AspectKey>(
    () => SIZE_TO_ASPECT[size] || '1:1',
    [size]
  )

  const tierEstimates = useMemo(() => {
    if (!sizePrices) return null
    const quotaPerUnit = getQuotaPerUnit()
    const groupRatio = Number(groupRatioMap[group] ?? 1) || 1
    return TIER_KEYS.reduce<Partial<Record<ImageSizeTier, number>>>(
      (acc, tier) => {
        const price = sizePrices[tier]
        if (typeof price === 'number' && price > 0) {
          acc[tier] = price * quotaPerUnit * groupRatio
        }
        return acc
      },
      {}
    )
  }, [sizePrices, groupRatioMap, group])

  const estimatedQuota = useMemo(() => {
    const pricing = pricingMap[model]
    if (!pricing) return null

    const quotaPerUnit = getQuotaPerUnit()
    const groupRatio = Number(groupRatioMap[group] ?? 1) || 1
    const count = clampImageCount(n)

    if (sizePrices) {
      const tierPrice = sizePrices[currentTier]
      if (typeof tierPrice === 'number' && tierPrice > 0) {
        return tierPrice * quotaPerUnit * groupRatio * count
      }
    }

    const sizeRatio = computeSizeRatio(model, size)
    if (pricing.quota_type === 1 && Number(pricing.model_price) > 0) {
      return Number(pricing.model_price) * quotaPerUnit * groupRatio * sizeRatio * count
    }

    if (pricing.quota_type === 0 && pricing.image_ratio && pricing.model_ratio) {
      return (
        Number(pricing.image_ratio) *
        Number(pricing.model_ratio) *
        quotaPerUnit *
        groupRatio *
        count
      )
    }

    return null
  }, [pricingMap, groupRatioMap, model, group, size, n, sizePrices, currentTier])

  const canGenerate = useMemo(() => {
    if (submitting || !model || !prompt.trim()) return false
    if (mode === 'i2i' && refFiles.length === 0) return false
    return true
  }, [submitting, model, prompt, mode, refFiles.length])

  const candidateGroups = useMemo(
    () =>
      Object.entries(imageModelsByGroup)
        .filter(([, list]) => list.length > 0)
        .map(([key]) => key),
    [imageModelsByGroup]
  )

  const appendRefFiles = useCallback(
    (rawFiles: FileList | File[], options?: { silent?: boolean }) => {
      const files = [...rawFiles].filter((file) =>
        file.type.startsWith('image/')
      )
      if (files.length === 0) return 0

      const room = MAX_REFERENCE_IMAGES - refFiles.length
      if (room <= 0) {
        toast.error(t('Reference images are limited to {{count}}', { count: MAX_REFERENCE_IMAGES }))
        return 0
      }

      const selected = files.slice(0, room)
      setRefFiles((current) => [...current, ...selected].slice(0, MAX_REFERENCE_IMAGES))
      setMode('i2i')

      if (files.length > room) {
        toast.error(t('Only {{count}} reference images can be used; extra files were ignored', { count: MAX_REFERENCE_IMAGES }))
      } else if (!options?.silent) {
        toast.success(t('Added {{count}} reference image(s)', { count: selected.length }))
      }

      return selected.length
    },
    [refFiles.length, t]
  )

  const handlePickFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) appendRefFiles(event.target.files, { silent: true })
      event.target.value = ''
    },
    [appendRefFiles]
  )

  const removeRef = useCallback((index: number) => {
    setRefFiles((current) => current.filter((_, idx) => idx !== index))
  }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = [...(event.clipboardData?.items || [])]
      const imagesFromClipboard: File[] = []
      items.forEach((item) => {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imagesFromClipboard.push(file)
        }
      })
      if (imagesFromClipboard.length === 0) return
      event.preventDefault()
      appendRefFiles(imagesFromClipboard)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [appendRefFiles])

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragCounterRef.current += 1
    setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      appendRefFiles(event.dataTransfer.files)
    },
    [appendRefFiles]
  )

  const loadImageTasks = useCallback(
    async (silent = false) => {
      if (!silent) setTasksLoading(true)
      try {
        const tasks = await getImageStudioTasks()
        const mapped = tasks
          .flatMap((task) => taskToItems(task, t))
          .filter(
            (item) =>
              !hiddenResultSet.has(item.taskId || '') && !hiddenResultSet.has(item.id)
          )
        setResults(mapped)
        setHasPendingTask(mapped.some((item) => item.status === 'pending'))

        const lastDone = tasks.find(
          (task) => task.status === 'SUCCESS' && typeof task.quota === 'number'
        )
        setLastCost(lastDone?.quota ?? null)
        return mapped
      } catch (error) {
        if (!silent) toast.error(getErrorMessage(error, t('Failed to load tasks')))
      } finally {
        if (!silent) setTasksLoading(false)
      }
      return []
    },
    [hiddenResultSet, t]
  )

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setBootstrapLoading(true)
      try {
        const userGroup = getSavedUserGroup(user?.group)
        const [pricing, loadedGroups] = await Promise.all([
          getImageStudioPricing(),
          getImageStudioGroups(userGroup),
        ])

        if (cancelled) return
        setPricingMap(pricing.pricingMap)
        setGroupRatioMap(pricing.groupRatioMap)
        setGroups(loadedGroups)

        if (loadedGroups.length === 0) return

        const modelPairs = await Promise.all(
          loadedGroups.map(async (groupOption) => ({
            group: groupOption.value,
            models: await getImageStudioModels(groupOption.value),
          }))
        )
        if (cancelled) return

        const modelsByGroup = modelPairs.reduce<Record<string, ModelOption[]>>(
          (acc, pair) => {
            acc[pair.group] = pair.models
            return acc
          },
          {}
        )
        setImageModelsByGroup(modelsByGroup)

        const lastGroup = readLocalStorage(LS_LAST_GROUP)
        const hasImageModels = (value: string) =>
          Array.isArray(modelsByGroup[value]) && modelsByGroup[value].length > 0

        let chosenGroup = loadedGroups[0].value
        if (
          lastGroup &&
          loadedGroups.some((item) => item.value === lastGroup) &&
          hasImageModels(lastGroup)
        ) {
          chosenGroup = lastGroup
        } else if (
          userGroup &&
          loadedGroups.some((item) => item.value === userGroup) &&
          hasImageModels(userGroup)
        ) {
          chosenGroup = userGroup
        } else {
          chosenGroup =
            loadedGroups.find((item) => hasImageModels(item.value))?.value ||
            loadedGroups[0].value
        }

        const selectedModels = modelsByGroup[chosenGroup] || []
        setGroup(chosenGroup)
        setModels(selectedModels)
        setGroupHasNoImageModel(selectedModels.length === 0)
        setModel(pickPreferredModel(selectedModels))
      } catch (error) {
        toast.error(getErrorMessage(error, t('Failed to initialize AI Studio')))
      } finally {
        if (!cancelled) setBootstrapLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [user?.group, t])

  useEffect(() => {
    if (!group) return
    writeLocalStorage(LS_LAST_GROUP, group)
    if (Object.keys(imageModelsByGroup).length === 0) return

    const nextModels = imageModelsByGroup[group] || []
    setModels(nextModels)
    setGroupHasNoImageModel(nextModels.length === 0)

    if (nextModels.length === 0) {
      setModel('')
      return
    }

    const modelStillAvailable = nextModels.some((item) => item.value === model)
    if (!modelStillAvailable) setModel(pickPreferredModel(nextModels))
  }, [group, imageModelsByGroup, model])

  useEffect(() => {
    if (model) writeLocalStorage(LS_LAST_MODEL, model)
  }, [model])

  useEffect(() => {
    const uid = user?.id
    if (uid == null) return undefined

    let stopped = false
    let refreshTimer: number | null = null
    let eventSource: EventSource | null = null
    taskEventsConnectedRef.current = false
    taskLastRefreshAtRef.current = 0

    const refresh = async (silent = false) => {
      const mapped = await loadImageTasks(silent)
      taskLastRefreshAtRef.current = Date.now()
      if (stopped) return
      setHasPendingTask(mapped.some((item) => item.status === 'pending'))
    }

    const scheduleRefresh = () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => refresh(true), IMAGE_TASK_SSE_REFRESH_DEBOUNCE)
    }

    refresh(false)
    const timer = window.setInterval(() => {
      const interval = taskEventsConnectedRef.current
        ? IMAGE_TASK_SSE_POLL_INTERVAL
        : IMAGE_TASK_POLL_INTERVAL
      if (Date.now() - taskLastRefreshAtRef.current >= interval) {
        refresh(true)
      }
    }, IMAGE_TASK_POLL_INTERVAL)

    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource(imageStudioTaskEventURL(), {
        withCredentials: true,
      })
      eventSource.addEventListener('connected', () => {
        taskEventsConnectedRef.current = true
      })
      eventSource.addEventListener('image_studio_task', scheduleRefresh)
      eventSource.addEventListener('error', () => {
        taskEventsConnectedRef.current = false
      })
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      eventSource?.close()
      taskEventsConnectedRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [loadImageTasks, user?.id])

  useEffect(() => {
    if (!hasPendingTask) return undefined
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasPendingTask])

  const applyTierAspect = useCallback((tier: ImageSizeTier, aspect: AspectKey) => {
    const map = TIER_ASPECT_TO_SIZE[tier]
    const nextSize = map[aspect] || map['1:1']
    setSize(nextSize)
  }, [])

  const hideResultIds = useCallback((ids: string[]) => {
    const cleanIds = ids.filter(Boolean)
    if (cleanIds.length === 0) return

    setHiddenResultIds((current) => {
      const merged = [...new Set([...current, ...cleanIds])]
      writeLocalStorage(LS_HIDDEN_RESULTS, JSON.stringify(merged))
      return merged
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return

    const requestCount = clampImageCount(n)
    if (requestCount !== n) setN(requestCount)

    const trimmedPrompt = prompt.trim()
    setGenerationError('')
    setLastCost(null)
    setSubmitting(true)

    try {
      if (mode === 'i2i') {
        await submitImageEdit({
          group,
          model,
          prompt: trimmedPrompt,
          n: requestCount,
          size,
          files: refFiles,
        })
      } else {
        await submitImageGeneration({
          group,
          model,
          prompt: trimmedPrompt,
          n: requestCount,
          size,
        })
      }

      toast.success(t('Task submitted'))
      await loadImageTasks(true)
      const refreshedUser = await refreshImageStudioUser()
      if (refreshedUser) setUser(refreshedUser)
    } catch (error) {
      const message = getErrorMessage(error, t('Submission failed'))
      setGenerationError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }, [canGenerate, n, prompt, mode, group, model, size, refFiles, t, loadImageTasks, setUser])

  const handleDownloadOne = useCallback(
    async (item: ImageStudioResult) => {
      if (!isDownloadableResult(item)) return
      try {
        await downloadOneResult(item)
      } catch {
        triggerDownload(item.src, `${item.model}-${item.id}.${item.ext || 'png'}`)
        toast.success(t('Download started. If a new tab opens, save the image manually.'))
      }
    },
    [t]
  )

  const handleDownloadAll = useCallback(async () => {
    if (downloadableResults.length === 0 || downloadingAll) return
    setDownloadingAll(true)
    try {
      const result = await zipImageResults(downloadableResults, t)
      if (result.okCount === 0) {
        toast.error(t('All images failed to download. Please save them manually.'))
      } else if (result.failedCount === 0) {
        toast.success(t('Packed {{count}} image(s) into ZIP', { count: result.okCount }))
      } else {
        toast.success(
          t('Packed {{ok}} image(s), {{fail}} failed. See manifest.txt.', {
            ok: result.okCount,
            fail: result.failedCount,
          })
        )
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('Failed to create ZIP')))
    } finally {
      setDownloadingAll(false)
    }
  }, [downloadableResults, downloadingAll, t])

  const reusePrompt = useCallback(
    (item: ImageStudioResult) => {
      setPrompt(item.prompt)
      if (item.size) setSize(item.size)
      if (item.model) setModel(item.model)
      toast.success(t('Parameters restored'))
    },
    [t]
  )

  const removeOne = useCallback(
    async (item: ImageStudioResult) => {
      const taskId = item.taskId || item.id
      if (!taskId) return

      let deleted = false
      try {
        await deleteImageStudioTasks([taskId])
        deleted = true
      } catch (error) {
        hideResultIds([taskId, item.id])
        toast.error(getErrorMessage(error, t('Delete failed')))
      }

      setResults((current) =>
        current.filter((candidate) => (candidate.taskId || candidate.id) !== taskId)
      )
      if (deleted) await loadImageTasks(true)
    },
    [hideResultIds, loadImageTasks, t]
  )

  const useAsReference = useCallback(
    async (item: ImageStudioResult) => {
      if (!isDownloadableResult(item)) return
      try {
        const blob = await imageResultToBlob(item)
        const ext = item.ext || 'png'
        const file = new File([blob], `ref-${item.id}.${ext}`, {
          type: blob.type || `image/${ext}`,
        })
        appendRefFiles([file])
      } catch {
        toast.error(t('This image cannot be picked because of cross-origin restrictions. Please download and upload it manually.'))
      }
    },
    [appendRefFiles, t]
  )

  const clearAll = useCallback(async () => {
    const taskIds = [
      ...new Set(
        results.map((item) => item.taskId).filter((id): id is string => Boolean(id))
      ),
    ]

    try {
      await deleteImageStudioTasks(taskIds)
    } catch (error) {
      hideResultIds(results.map((item) => item.taskId || item.id))
      toast.error(getErrorMessage(error, t('Delete failed')))
    }

    setResults([])
    await loadImageTasks(true)
  }, [results, hideResultIds, loadImageTasks, t])

  const handleImageCountChange = useCallback((value: string) => {
    setN(clampImageCount(Number(value)))
  }, [])

  const showNoModelWarning = groupHasNoImageModel && !bootstrapLoading

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm'>
            <Palette className='size-4' />
          </span>
          <span className='truncate'>{t('AI Studio')}</span>
        </div>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button variant='outline' size='sm' onClick={() => loadImageTasks(false)}>
          <RefreshCw className={cn('size-3.5', tasksLoading && 'animate-spin')} />
          {t('Refresh')}
        </Button>
        {downloadableResults.length > 0 ? (
          <Button
            variant='outline'
            size='sm'
            onClick={handleDownloadAll}
            disabled={downloadingAll}
          >
            {downloadingAll ? (
              <Loader2 className='size-3.5 animate-spin' />
            ) : (
              <Download className='size-3.5' />
            )}
            {t('Download all')} ({downloadableResults.length})
          </Button>
        ) : null}
        {results.length > 0 ? (
          <Button variant='destructive' size='sm' onClick={clearAll}>
            <Trash2 className='size-3.5' />
            {t('Clear')}
          </Button>
        ) : null}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div
          className='relative mx-auto grid w-full max-w-[1600px] gap-4 xl:grid-cols-[380px_1fr]'
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver ? (
            <div className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6'>
              <div className='absolute inset-4 rounded-3xl border-2 border-dashed border-primary/70 bg-primary/10 backdrop-blur-sm' />
              <div className='relative flex items-center gap-3 rounded-2xl border bg-background/90 px-5 py-4 shadow-xl ring-1 ring-foreground/10 backdrop-blur'>
                <span className='flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white'>
                  <UploadCloud className='size-5' />
                </span>
                <div>
                  <div className='font-medium'>{t('Drop to add as reference images')}</div>
                  <div className='text-muted-foreground text-xs'>
                    {t('Up to {{count}} images are supported', { count: MAX_REFERENCE_IMAGES })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className='space-y-4 xl:sticky xl:top-4 xl:self-start'>
            <Card className='border-primary/10 bg-gradient-to-br from-card via-card to-primary/5'>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Sparkles className='size-4 text-primary' />
                  {t('Create images')}
                </CardTitle>
                <CardDescription>
                  {t('Describe a scene, choose model and resolution, then generate images asynchronously.')}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-3 gap-2'>
                  <QuotaStat
                    label={t('Balance')}
                    value={formatQuota(user?.quota || 0)}
                    tone='success'
                  />
                  <QuotaStat label={t('Used')} value={formatQuota(user?.used_quota || 0)} />
                  <QuotaStat
                    label={t('Last cost')}
                    value={lastCost == null ? '-' : `-${formatQuota(lastCost)}`}
                    tone='danger'
                  />
                </div>

                <Tabs
                  value={mode}
                  onValueChange={(value) => setMode(value as ImageStudioMode)}
                >
                  <TabsList className='grid w-full grid-cols-2'>
                    <TabsTrigger value='t2i'>
                      <WandSparkles className='size-3.5' />
                      {t('Text to image')}
                    </TabsTrigger>
                    <TabsTrigger value='i2i'>
                      <ImagePlus className='size-3.5' />
                      {t('Image to image')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value='t2i' className='mt-0 space-y-4' />
                  <TabsContent value='i2i' className='mt-0 space-y-4' />
                </Tabs>

                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2'>
                  <div className='space-y-1.5'>
                    <Label>{t('Group')}</Label>
                    <Select
                      items={groups.map((item) => ({ value: item.value, label: groupOptionLabel(item) }))}
                      value={group}
                      onValueChange={(value) => value !== null && setGroup(value)}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder={t('Select group')} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {groups.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {groupOptionLabel(item)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <Label>{t('Image model')}</Label>
                    <Select
                      items={models.map((item) => ({ value: item.value, label: item.label || item.value }))}
                      value={model}
                      onValueChange={(value) => value !== null && setModel(value)}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder={t('Select image model')} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {models.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label || item.value}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {showNoModelWarning ? (
                  <div className='rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm'>
                    <div className='font-medium text-amber-700 dark:text-amber-300'>
                      {t('The current group has no available image model.')}
                    </div>
                    {candidateGroups.length > 0 ? (
                      <div className='mt-2 flex flex-wrap gap-1.5'>
                        {candidateGroups.map((candidate) => (
                          <Button
                            key={candidate}
                            size='xs'
                            variant='outline'
                            onClick={() => setGroup(candidate)}
                          >
                            {candidate}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className='text-muted-foreground mt-1 text-xs'>
                        {t('Please contact an administrator to enable image models.')}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className='space-y-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <Label htmlFor='image-studio-prompt'>{t('Prompt')}</Label>
                    <span className='text-muted-foreground text-xs'>{prompt.length}/4000</span>
                  </div>
                  <Textarea
                    id='image-studio-prompt'
                    value={prompt}
                    maxLength={4000}
                    rows={7}
                    className='min-h-36 resize-y bg-background/60'
                    placeholder={t('Describe the image you want to create...')}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                  <div className='flex flex-wrap gap-1.5'>
                    {PROMPT_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type='button'
                        size='xs'
                        variant='outline'
                        className='h-auto whitespace-normal py-1 text-left text-xs'
                        onClick={() => setPrompt(preset)}
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                </div>

                {mode === 'i2i' ? (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <Label>{t('Reference images')}</Label>
                      <span className='text-muted-foreground text-xs'>
                        {refFiles.length}/{MAX_REFERENCE_IMAGES}
                      </span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type='file'
                      accept='image/*'
                      multiple
                      className='hidden'
                      onChange={handlePickFiles}
                    />
                    <button
                      type='button'
                      className='hover:bg-muted/50 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-background/50 px-4 py-5 text-center transition-colors'
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadCloud className='size-6 text-muted-foreground' />
                      <div className='text-sm font-medium'>{t('Upload, paste, or drop images')}</div>
                      <div className='text-muted-foreground text-xs'>
                        {t('Reference images help guide edits and style transfer.')}
                      </div>
                    </button>
                    {refPreviews.length > 0 ? (
                      <div className='grid grid-cols-3 gap-2'>
                        {refPreviews.map((src, index) => (
                          <div key={src} className='group/ref relative aspect-square overflow-hidden rounded-lg border bg-muted'>
                            <img src={src} alt={t('Reference image')} className='size-full object-cover' />
                            <Button
                              aria-label={t('Remove')}
                              size='icon-xs'
                              variant='destructive'
                              className='absolute top-1 right-1 opacity-0 transition-opacity group-hover/ref:opacity-100'
                              onClick={() => removeRef(index)}
                            >
                              <X className='size-3' />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className='space-y-3 rounded-xl border bg-background/50 p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <Label>{t('Resolution')}</Label>
                    <Badge variant='outline'>{size}</Badge>
                  </div>

                  {sizePrices ? (
                    <div className='space-y-3'>
                      <div className='grid grid-cols-3 gap-2'>
                        {TIER_KEYS.map((tier) => (
                          <Button
                            key={tier}
                            type='button'
                            size='sm'
                            variant={currentTier === tier ? 'default' : 'outline'}
                            className='h-auto flex-col gap-1 py-2'
                            onClick={() => applyTierAspect(tier, currentAspect)}
                          >
                            <span>{tier}</span>
                            {tierEstimates?.[tier] != null ? (
                              <span className='text-[10px] opacity-80'>
                                {formatQuota(tierEstimates[tier] || 0)} / {t('image')}
                              </span>
                            ) : null}
                          </Button>
                        ))}
                      </div>
                      <div className='grid grid-cols-3 gap-2'>
                        {ASPECT_KEYS.map((aspect) => (
                          <Button
                            key={aspect.key}
                            type='button'
                            size='xs'
                            variant={currentAspect === aspect.key ? 'default' : 'outline'}
                            onClick={() => applyTierAspect(currentTier, aspect.key)}
                          >
                            {t(aspect.label)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Select
                      items={ASPECT_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                      value={size}
                      onValueChange={(value) => value !== null && setSize(value)}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder={t('Select aspect ratio')} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {ASPECT_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {t(item.label)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}

                  <div className='grid grid-cols-[1fr_auto] items-end gap-3'>
                    <div className='space-y-1.5'>
                      <Label htmlFor='image-studio-count'>{t('Image count')}</Label>
                      <Input
                        id='image-studio-count'
                        min={1}
                        max={MAX_IMAGE_COUNT}
                        type='number'
                        value={n}
                        onChange={(event) => handleImageCountChange(event.target.value)}
                      />
                    </div>
                    <div className='rounded-lg border bg-muted/40 px-3 py-2 text-right'>
                      <div className='text-muted-foreground text-xs'>{t('Estimated')}</div>
                      <div className='text-sm font-semibold'>
                        {estimatedQuota == null ? '-' : formatQuota(estimatedQuota)}
                      </div>
                    </div>
                  </div>
                </div>

                {generationError ? (
                  <div className='rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
                    {generationError}
                  </div>
                ) : null}

                <Button
                  type='button'
                  size='lg'
                  className='h-10 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white hover:opacity-95'
                  disabled={!canGenerate || bootstrapLoading}
                  onClick={handleGenerate}
                >
                  {submitting ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <Zap className='size-4' />
                  )}
                  {mode === 'i2i' ? t('Generate from reference') : t('Generate images')}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className='min-h-[520px]'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Images className='size-4 text-primary' />
                {t('Gallery')}
              </CardTitle>
              <CardDescription>
                {t('Tasks are refreshed automatically. Completed images can be reused as references.')}
              </CardDescription>
              <CardAction>
                {hasPendingTask ? (
                  <Badge variant='secondary'>
                    <Clock className='size-3' />
                    {t('Processing')}
                  </Badge>
                ) : null}
              </CardAction>
            </CardHeader>
            <CardContent>
              {tasksLoading && results.length === 0 ? (
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
                  {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className='aspect-square rounded-xl' />
                  ))}
                </div>
              ) : null}

              {!tasksLoading && results.length === 0 ? (
                <Empty className='min-h-[430px] border'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon' className='size-12 rounded-2xl bg-primary/10 text-primary'>
                      <FileImage className='size-6' />
                    </EmptyMedia>
                    <EmptyTitle>{t('No images yet')}</EmptyTitle>
                    <EmptyDescription>
                      {t('Start with a prompt on the left. Your generated images will appear here.')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}

              {results.length > 0 ? (
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
                  {results.map((item) => (
                    <ResultCard
                      key={item.id}
                      item={item}
                      elapsedSeconds={getTaskElapsedSeconds(item, nowMs)}
                      onDownload={handleDownloadOne}
                      onPreview={setPreviewResult}
                      onRemove={removeOne}
                      onReusePrompt={reusePrompt}
                      onUseAsReference={useAsReference}
                    />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Dialog
          open={previewResult != null}
          onOpenChange={(open) => {
            if (!open) setPreviewResult(null)
          }}
          title={previewResult?.model || t('Image preview')}
          description={previewResult?.size || undefined}
          contentClassName='sm:max-w-5xl'
          bodyClassName='space-y-3'
          contentHeight='auto'
        >
          {previewResult ? (
            <div className='space-y-3'>
              <div className='overflow-hidden rounded-xl border bg-muted'>
                <img
                  src={previewResult.src}
                  alt={previewResult.prompt || t('Generated image')}
                  className='max-h-[70vh] w-full object-contain'
                />
              </div>
              <div className='text-muted-foreground rounded-lg border bg-muted/30 p-3 text-sm'>
                {previewResult.prompt || t('No prompt')}
              </div>
            </div>
          ) : null}
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
