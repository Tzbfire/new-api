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

import type { ImageStudioImage, NormalizedImageStudioTask } from '../types'
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

type TaskFilter = 'all' | 'active' | 'completed' | 'failed'

type TaskGalleryProps = {
  tasks: NormalizedImageStudioTask[]
  retentionDays: number
  activeBatchID?: string
  isLoading: boolean
  isRefreshing: boolean
  isDownloading: boolean
  isClearing: boolean
  deletingTaskID: string | null
  onRefresh: () => void
  onDelete: (taskID: string) => void
  onDownload: (
    task: NormalizedImageStudioTask,
    image: ImageStudioImage,
    index: number
  ) => void
  onDownloadBatch: (tasks: NormalizedImageStudioTask[]) => void
  onClearAll: (tasks: NormalizedImageStudioTask[]) => void
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

function matchesFilter(task: NormalizedImageStudioTask, filter: TaskFilter) {
  if (filter === 'active') return isActiveTask(task)
  if (filter === 'completed') return task.status === 'SUCCESS'
  if (filter === 'failed') return task.status === 'FAILURE'
  return true
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
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [preview, setPreview] = useState<{
    task: NormalizedImageStudioTask
    image: ImageStudioImage
    index: number
  } | null>(null)
  const visibleTasks = props.tasks.filter((task) => matchesFilter(task, filter))
  const activeTasks = props.activeBatchID
    ? props.tasks.filter(
        (task) =>
          task.request.batch_id === props.activeBatchID ||
          task.task_id === props.activeBatchID
      )
    : []
  const activeCompleted = activeTasks.filter(isTerminalTask).length
  const downloadableActiveTasks = activeTasks.filter(
    (task) => task.status === 'SUCCESS' && Boolean(task.images[0]?.download_url)
  )
  const downloadableTasks = props.tasks.filter(
    (task) => task.status === 'SUCCESS' && Boolean(task.images[0]?.download_url)
  )
  const clearableTasks = props.tasks.filter(isTerminalTask)
  const activeBatchDownloadReady =
    activeTasks.length > 0 &&
    activeCompleted === activeTasks.length &&
    downloadableActiveTasks.length > 0
  const activeProgress =
    activeTasks.length > 0
      ? Math.round(
          activeTasks.reduce((total, task) => total + taskProgress(task), 0) /
            activeTasks.length
        )
      : 0

  let gallery: ReactNode
  if (props.isLoading) {
    gallery = (
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} className='aspect-[4/5] rounded-xl' />
        ))}
      </div>
    )
  } else if (visibleTasks.length === 0) {
    gallery = (
      <Empty className='min-h-72 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <HugeiconsIcon icon={AiImageIcon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>
            {filter === 'all'
              ? t('No creations yet')
              : t('No matching creations')}
          </EmptyTitle>
          <EmptyDescription>
            {filter === 'all'
              ? t('Generated images will appear here.')
              : t('Try another status filter.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    gallery = (
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {visibleTasks.map((task) => {
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
      {activeTasks.length > 0 ? (
        <Card size='sm'>
          <CardHeader>
            <CardTitle>{t('Current batch')}</CardTitle>
            <CardDescription aria-live='polite'>
              {t('{{completed}} of {{total}} tasks finished', {
                completed: activeCompleted,
                total: activeTasks.length,
              })}
            </CardDescription>
            <CardAction>
              <Badge
                variant={
                  activeCompleted === activeTasks.length
                    ? 'outline'
                    : 'secondary'
                }
              >
                {activeProgress}%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Progress value={activeProgress} />
          </CardContent>
          <CardFooter className='justify-end'>
            <Button
              size='sm'
              disabled={
                !activeBatchDownloadReady ||
                props.isDownloading ||
                props.isClearing
              }
              onClick={() => props.onDownloadBatch(downloadableActiveTasks)}
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
              {t('Download all')}
            </Button>
          </CardFooter>
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
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={
              downloadableTasks.length === 0 ||
              props.isDownloading ||
              props.isClearing
            }
            onClick={() => props.onDownloadBatch(downloadableTasks)}
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
            {t('Download all')} ({downloadableTasks.length})
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={
              clearableTasks.length === 0 ||
              props.isClearing ||
              props.isDownloading
            }
            onClick={() => props.onClearAll(clearableTasks)}
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
            {t('Clear all')} ({clearableTasks.length})
          </Button>
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
        value={filter}
        onValueChange={(value) => setFilter(value as TaskFilter)}
      >
        <TabsList className='grid w-full grid-cols-4 sm:w-auto'>
          <TabsTrigger value='all'>{t('All')}</TabsTrigger>
          <TabsTrigger value='active'>{t('In progress')}</TabsTrigger>
          <TabsTrigger value='completed'>{t('Completed')}</TabsTrigger>
          <TabsTrigger value='failed'>{t('Failed')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {gallery}

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
