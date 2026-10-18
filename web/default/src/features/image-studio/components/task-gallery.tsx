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
  AiImageIcon,
  Delete02Icon,
  Download01Icon,
  ImageUpload01Icon,
  MagicWand01Icon,
  RefreshIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatQuota } from '@/lib/format'
import { getPageNumbers } from '@/lib/utils'

import type {
  ImageStudioBatchSummary,
  ImageStudioImage,
  ImageStudioLibrarySummary,
  ImageStudioTaskFilter,
  NormalizedImageStudioTask,
} from '../types'
import {
  activeTaskElapsedSeconds,
  formatTaskTime,
  imageSource,
  isActiveTask,
  isImageStudioEditMode,
  isTerminalTask,
  taskProgress,
  taskDurationSeconds,
  taskStatusKey,
} from '../utils'

type TaskGalleryProps = {
  tasks: NormalizedImageStudioTask[]
  retentionDays: number
  activeBatch?: ImageStudioBatchSummary
  librarySummary?: ImageStudioLibrarySummary
  filter: ImageStudioTaskFilter
  page: number
  pageSize: number
  total: number
  isLoading: boolean
  isRefreshing: boolean
  isDownloading: boolean
  isClearing: boolean
  isClearingFailed?: boolean
  deletingTaskID: string | null
  onRefresh: () => void
  onDelete: (taskID: string) => void
  onDownload: (
    task: NormalizedImageStudioTask,
    image: ImageStudioImage,
    index: number
  ) => void
  downloadAllEnabled: boolean
  onDownloadPage: () => void
  onDownloadAll: () => void
  onFilterChange: (filter: ImageStudioTaskFilter) => void
  onPageChange: (page: number) => void
  onClearAll: () => void
  onClearFailed?: () => void
  onReuse: (task: NormalizedImageStudioTask) => void
  onUseAsReference: (
    task: NormalizedImageStudioTask,
    image: ImageStudioImage
  ) => void
  onRetry: (task: NormalizedImageStudioTask) => void
}

function statusVariant(
  status: string
): 'secondary' | 'destructive' | 'outline' {
  if (status === 'FAILURE') return 'destructive'
  if (status === 'SUCCESS') return 'outline'
  return 'secondary'
}

const SKELETON_KEYS = ['first', 'second', 'third', 'fourth']

function ActiveTaskElapsed(props: { task: NormalizedImageStudioTask }) {
  const { t } = useTranslation()
  const [nowSeconds, setNowSeconds] = useState(() => Date.now() / 1000)

  useEffect(() => {
    const interval = window.setInterval(
      () => setNowSeconds(Date.now() / 1000),
      1000
    )
    return () => window.clearInterval(interval)
  }, [])

  const elapsed = activeTaskElapsedSeconds(props.task, nowSeconds)
  if (elapsed === null) return null
  const duration = t('{{value}}s', { value: elapsed })
  return (
    <span>
      {props.task.status === 'IN_PROGRESS'
        ? t('Generating for {{duration}}', { duration })
        : t('Waiting for {{duration}}', { duration })}
    </span>
  )
}

function TaskImage(props: {
  image: ImageStudioImage
  imageIndex: number
  onPreview: () => void
}) {
  const { t } = useTranslation()
  const source = imageSource(props.image)
  if (!source) {
    return (
      <div className='bg-muted text-muted-foreground flex aspect-square items-center justify-center rounded-lg p-6 text-center text-sm'>
        {props.image.asset_status === 'expired'
          ? t('This image has expired.')
          : t('Image content is unavailable.')}
      </div>
    )
  }
  return (
    <button
      type='button'
      className='bg-muted focus-visible:ring-ring/50 group relative aspect-square w-full overflow-hidden rounded-lg outline-none focus-visible:ring-3'
      onClick={props.onPreview}
    >
      <img
        src={source}
        alt={t('Generated image {{index}}', { index: props.imageIndex + 1 })}
        loading='lazy'
        crossOrigin='anonymous'
        referrerPolicy='no-referrer'
        className='size-full object-cover transition-transform duration-200 motion-reduce:transition-none sm:group-hover:scale-[1.02]'
      />
      <span className='bg-background/90 text-foreground absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100'>
        <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
        {t('Preview')}
      </span>
    </button>
  )
}

export function TaskGallery(props: TaskGalleryProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<{
    task: NormalizedImageStudioTask
    image: ImageStudioImage
    index: number
  } | null>(null)
  const scopeSummary = props.activeBatch ?? props.librarySummary
  const activeCompleted =
    scopeSummary?.finished_count ?? props.tasks.filter(isTerminalTask).length
  const activeTotal = scopeSummary?.total_count ?? props.tasks.length
  const clearableTasks = props.tasks.filter(isTerminalTask)
  const clearAllCount = scopeSummary?.total_count ?? clearableTasks.length
  const clearAllAvailable = scopeSummary
    ? scopeSummary.total_count > 0 &&
      scopeSummary.finished_count === scopeSummary.total_count
    : clearableTasks.length > 0
  const pageDownloadCount = props.tasks.filter(
    (task) => task.status === 'SUCCESS' && Boolean(task.images[0]?.url)
  ).length
  const pageDownloadReady = pageDownloadCount > 0
  const scopeDownloadReady = (scopeSummary?.success_count ?? 0) > 0
  const failureCount =
    scopeSummary?.failure_count ??
    props.tasks.filter((task) => task.status === 'FAILURE').length
  const activeProgress =
    props.activeBatch?.progress ??
    (activeTotal > 0 ? Math.round((activeCompleted / activeTotal) * 100) : 0)
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize))
  const pageNumbers = getPageNumbers(props.page, totalPages)
  let ellipsisCount = 0
  const paginationItems = pageNumbers.map((value) => ({
    key:
      typeof value === 'number'
        ? `page-${value}`
        : `ellipsis-${++ellipsisCount}`,
    value,
  }))
  const firstVisible =
    props.total > 0 ? (props.page - 1) * props.pageSize + 1 : 0
  const lastVisible = Math.min(props.page * props.pageSize, props.total)

  let gallery: ReactNode
  if (props.isLoading) {
    gallery = (
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} className='aspect-[4/5] rounded-xl' />
        ))}
      </div>
    )
  } else if (props.tasks.length === 0) {
    gallery = (
      <Empty className='min-h-72 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <HugeiconsIcon icon={AiImageIcon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>
            {props.filter === 'all'
              ? t('No creations yet')
              : t('No matching creations')}
          </EmptyTitle>
          <EmptyDescription>
            {props.filter === 'all'
              ? t('Generated images will appear here.')
              : t('Try another status filter.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    gallery = (
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {props.tasks.map((task) => {
          const request = task.request
          const image = task.images[0]
          const isDeleting = props.deletingTaskID === task.task_id
          const durationSeconds = taskDurationSeconds(task)
          let timing: ReactNode = null
          if (durationSeconds !== null) {
            timing = (
              <span>
                {t('Generation time: {{duration}}', {
                  duration: t('{{value}}s', { value: durationSeconds }),
                })}
              </span>
            )
          } else if (isActiveTask(task)) {
            timing = <ActiveTaskElapsed task={task} />
          }
          let result: ReactNode
          if (image) {
            result = (
              <TaskImage
                image={image}
                imageIndex={0}
                onPreview={() => setPreview({ task, image, index: 0 })}
              />
            )
          } else if (task.status === 'FAILURE') {
            result = (
              <div className='bg-muted flex aspect-square items-center justify-center rounded-lg p-6'>
                <p className='text-destructive text-center text-sm'>
                  {task.fail_reason || t('Image generation failed.')}
                </p>
              </div>
            )
          } else if (task.status === 'SUCCESS') {
            result = (
              <div className='bg-muted text-muted-foreground flex aspect-square items-center justify-center rounded-lg p-6 text-center text-sm'>
                {t('No image result is available for this completed task.')}
              </div>
            )
          } else {
            result = (
              <div className='bg-muted flex aspect-square flex-col items-center justify-center gap-3 rounded-lg p-6'>
                <Spinner />
                <p className='text-muted-foreground text-sm' aria-live='polite'>
                  {task.status === 'IN_PROGRESS'
                    ? t('Generating and saving locally...')
                    : t('Waiting for a generation slot...')}
                </p>
                <Progress value={taskProgress(task)} className='w-full' />
              </div>
            )
          }
          return (
            <Card
              key={task.task_id}
              size='sm'
              className='[contain-intrinsic-size:auto_420px] [content-visibility:auto]'
            >
              <CardHeader>
                <CardTitle className='line-clamp-2 min-h-10'>
                  {request.prompt || task.task_id}
                </CardTitle>
                <CardDescription className='truncate'>
                  {request.model || task.action} ·{' '}
                  {formatTaskTime(task.created_at)}
                </CardDescription>
                <CardAction>
                  <Badge variant={statusVariant(task.status)}>
                    {t(taskStatusKey(task.status))}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {result}
                <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
                  {request.size ? <span>{request.size}</span> : null}
                  {request.quality ? <span>{request.quality}</span> : null}
                  {task.quota > 0 ? (
                    <span>{formatQuota(task.quota)}</span>
                  ) : null}
                  {timing}
                  {request.batch_size && request.batch_size > 1 ? (
                    <span>
                      {t('Batch {{current}} of {{total}}', {
                        current: request.batch_index,
                        total: request.batch_size,
                      })}
                    </span>
                  ) : null}
                </div>
              </CardContent>
              <CardFooter className='flex flex-wrap justify-end gap-1'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={!image?.url || props.isClearing}
                  aria-label={t('Preview image')}
                  title={t('Preview image')}
                  onClick={() => image && setPreview({ task, image, index: 0 })}
                >
                  <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Reuse settings')}
                  title={t('Reuse settings')}
                  onClick={() => props.onReuse(task)}
                >
                  <HugeiconsIcon icon={MagicWand01Icon} strokeWidth={2} />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={!image?.url || props.isClearing}
                  aria-label={t('Use as reference image')}
                  title={t('Use as reference image')}
                  onClick={() => image && props.onUseAsReference(task, image)}
                >
                  <HugeiconsIcon icon={ImageUpload01Icon} strokeWidth={2} />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={!image?.url || props.isClearing}
                  aria-label={t('Download image')}
                  title={t('Download image')}
                  onClick={() => image && props.onDownload(task, image, 0)}
                >
                  <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
                </Button>
                {task.status === 'FAILURE' &&
                !isImageStudioEditMode(request.mode) ? (
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Retry generation')}
                    title={t('Retry generation')}
                    onClick={() => props.onRetry(task)}
                  >
                    <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
                  </Button>
                ) : null}
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={
                    !isTerminalTask(task) ||
                    isDeleting ||
                    props.isClearing ||
                    props.isDownloading
                  }
                  aria-label={t('Delete result')}
                  title={t('Delete result')}
                  onClick={() => props.onDelete(task.task_id)}
                >
                  {isDeleting ? (
                    <Spinner />
                  ) : (
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  )}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    )
  }

  return (
    <section
      className='flex min-w-0 flex-col gap-5 p-5'
      aria-labelledby='studio-results-title'
    >
      {activeTotal > 0 ? (
        <Card size='sm'>
          <CardHeader>
            <CardTitle>
              {props.activeBatch ? t('Current batch') : t('All creations')}
            </CardTitle>
            <CardDescription aria-live='polite'>
              {t('{{completed}} of {{total}} tasks finished', {
                completed: activeCompleted,
                total: activeTotal,
              })}
            </CardDescription>
            <CardAction>
              <Badge
                variant={
                  activeCompleted === activeTotal ? 'outline' : 'secondary'
                }
              >
                {activeProgress}%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            <Progress value={activeProgress} />
            {scopeSummary ? (
              <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
                <span>
                  {t('Completed')}: {scopeSummary.success_count}
                </span>
                <span>
                  {t('Failed')}: {scopeSummary.failure_count}
                </span>
                <span>
                  {t('In progress')}: {scopeSummary.active_count}
                </span>
                <span>
                  {t('Waiting')}: {scopeSummary.queued_count}
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-end'>
        <div>
          <h2 id='studio-results-title' className='text-xl font-semibold'>
            {t('Creation workspace')}
          </h2>
          <p className='text-muted-foreground text-sm'>
            {t('Preview, download, reuse, or continue editing every result.')}
          </p>
          <p className='text-muted-foreground/80 mt-1 text-xs'>
            <span className='font-medium'>{t('Local image retention')}:</span>{' '}
            {props.retentionDays > 0
              ? t(
                  'Images are stored locally for {{count}} days. Download important images before they expire.',
                  { count: props.retentionDays }
                )
              : t('Images are stored locally until you delete them.')}
          </p>
          {props.total > 0 ? (
            <p className='text-muted-foreground/80 mt-1 text-xs'>
              {t('Showing {{first}}–{{last}} of {{total}} results.', {
                first: firstVisible,
                last: lastVisible,
                total: props.total,
              })}
            </p>
          ) : null}
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            disabled={
              !pageDownloadReady || props.isDownloading || props.isClearing
            }
            onClick={props.onDownloadPage}
          >
            {props.isDownloading ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <HugeiconsIcon
                icon={Download01Icon}
                strokeWidth={2}
                data-icon='inline-start'
              />
            )}
            {t('Download current page')} ({pageDownloadCount})
          </Button>
          {props.downloadAllEnabled ? (
            <Button
              variant='outline'
              size='sm'
              disabled={
                !scopeDownloadReady || props.isDownloading || props.isClearing
              }
              onClick={props.onDownloadAll}
            >
              {props.isDownloading ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <HugeiconsIcon
                  icon={Download01Icon}
                  strokeWidth={2}
                  data-icon='inline-start'
                />
              )}
              {t('Download all')} ({scopeSummary?.success_count ?? 0})
            </Button>
          ) : null}
          {props.filter === 'failed' ? (
            <Button
              variant='outline'
              size='sm'
              disabled={
                failureCount === 0 ||
                props.isClearing ||
                props.isClearingFailed ||
                props.isDownloading
              }
              onClick={props.onClearFailed}
            >
              {props.isClearingFailed ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <HugeiconsIcon
                  icon={Delete02Icon}
                  strokeWidth={2}
                  data-icon='inline-start'
                />
              )}
              {t('Clear failed tasks')} ({failureCount})
            </Button>
          ) : (
            <Button
              variant='outline'
              size='sm'
              disabled={
                !clearAllAvailable || props.isClearing || props.isDownloading
              }
              onClick={props.onClearAll}
            >
              {props.isClearing ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <HugeiconsIcon
                  icon={Delete02Icon}
                  strokeWidth={2}
                  data-icon='inline-start'
                />
              )}
              {t('Clear all')} ({clearAllCount})
            </Button>
          )}
          <Button variant='outline' size='sm' onClick={props.onRefresh}>
            {props.isRefreshing ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                data-icon='inline-start'
              />
            )}
            {t('Refresh')}
          </Button>
        </div>
      </div>

      <Tabs
        value={props.filter}
        onValueChange={(value) =>
          props.onFilterChange(value as ImageStudioTaskFilter)
        }
      >
        <TabsList className='grid w-full grid-cols-4 sm:w-auto'>
          <TabsTrigger value='all'>
            {t('All')}
            <span className='hidden sm:inline'>
              {' '}
              ({scopeSummary?.total_count ?? props.total})
            </span>
          </TabsTrigger>
          <TabsTrigger value='active'>
            {t('In progress')}
            <span className='hidden sm:inline'>
              {' '}
              (
              {(scopeSummary?.active_count ?? 0) +
                (scopeSummary?.queued_count ?? 0)}
              )
            </span>
          </TabsTrigger>
          <TabsTrigger value='completed'>
            {t('Completed')}
            <span className='hidden sm:inline'>
              {' '}
              ({scopeSummary?.success_count ?? 0})
            </span>
          </TabsTrigger>
          <TabsTrigger value='failed'>
            {t('Failed')}
            <span className='hidden sm:inline'> ({failureCount})</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {gallery}
      {props.total > 0 && totalPages > 1 ? (
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={props.page <= 1 || props.isLoading}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            {t('Previous')}
          </Button>
          <span className='text-muted-foreground text-sm sm:hidden'>
            {props.page} / {totalPages}
          </span>
          <div className='hidden items-center gap-1 sm:flex'>
            {paginationItems.map((item) =>
              typeof item.value === 'number' ? (
                <Button
                  key={item.key}
                  variant={item.value === props.page ? 'secondary' : 'outline'}
                  size='sm'
                  className='min-w-9 px-2'
                  disabled={props.isLoading}
                  aria-current={item.value === props.page ? 'page' : undefined}
                  onClick={() => props.onPageChange(item.value as number)}
                >
                  {item.value}
                </Button>
              ) : (
                <span
                  key={item.key}
                  className='text-muted-foreground px-2 text-sm'
                >
                  …
                </span>
              )
            )}
          </div>
          <Button
            variant='outline'
            size='sm'
            disabled={props.page >= totalPages || props.isLoading}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className='max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl'>
          <DialogHeader>
            <DialogTitle>
              {preview?.task.request.prompt || t('Generated image')}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.task.request.model || preview.task.action} · ${formatTaskTime(preview.task.created_at)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <img
              src={imageSource(preview.image)}
              alt={t('Generated image {{index}}', { index: preview.index + 1 })}
              crossOrigin='anonymous'
              referrerPolicy='no-referrer'
              className='bg-muted max-h-[70vh] w-full rounded-lg object-contain'
            />
          ) : null}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                if (!preview) return
                props.onReuse(preview.task)
                setPreview(null)
              }}
            >
              <HugeiconsIcon
                icon={MagicWand01Icon}
                strokeWidth={2}
                data-icon='inline-start'
              />
              {t('Reuse settings')}
            </Button>
            <Button
              variant='outline'
              onClick={() => {
                if (!preview) return
                props.onUseAsReference(preview.task, preview.image)
                setPreview(null)
              }}
            >
              <HugeiconsIcon
                icon={ImageUpload01Icon}
                strokeWidth={2}
                data-icon='inline-start'
              />
              {t('Use as reference')}
            </Button>
            <Button
              onClick={() =>
                preview &&
                props.onDownload(preview.task, preview.image, preview.index)
              }
            >
              <HugeiconsIcon
                icon={Download01Icon}
                strokeWidth={2}
                data-icon='inline-start'
              />
              {t('Download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
