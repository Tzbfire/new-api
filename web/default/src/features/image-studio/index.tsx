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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { useAuthStore } from '@/stores/auth-store'
import { useImageStudioPreferencesStore } from '@/stores/image-studio-preferences-store'

import {
  deleteFailedImageBatchTasks,
  deleteFailedImageLibraryTasks,
  deleteImageBatch,
  deleteImageLibrary,
  deleteImageTasks,
  fetchImageBatchTasks,
  imageBatchDownloadURL,
  imageLibraryDownloadURL,
  imageTaskDownloadURL,
  fetchImageBatches,
  fetchImageLibraryTasks,
  fetchImageBlob,
  fetchImageModelCatalog,
  fetchImageStudioConfig,
  submitEdit,
  submitGeneration,
} from './api'
import { StudioForm } from './components/studio-form'
import { TaskGallery } from './components/task-gallery'
import { imageStudioModeForFiles } from './reference-files'
import type {
  ImageStudioDraft,
  ImageStudioFormValues,
  ImageStudioImage,
  ImageStudioTaskFilter,
  NormalizedImageStudioTask,
} from './types'
import {
  errorMessage,
  filterImageModels,
  formatTaskTime,
  imageFileExtension,
  normalizeTask,
  selectImageStudioGroup,
} from './utils'

const ALL_STUDIO_SCOPE = '__all__'

type PendingDelete = {
  taskIDs: string[]
  scope: 'single' | 'all' | 'failed'
  batchID?: string
  library?: boolean
  totalCount?: number
}

function startArchiveDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function valuesFromTask(
  task: NormalizedImageStudioTask
): ImageStudioFormValues {
  return {
    group: task.request.group || task.group,
    model: task.request.model || '',
    prompt: task.request.prompt || '',
    size: task.request.size || 'default',
    quality: task.request.quality || 'default',
    count: task.request.batch_size || task.request.n || 1,
  }
}

export function ImageStudio() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const savedPreference = useImageStudioPreferencesStore((state) =>
    user ? state.preferencesByUser[String(user.id)] : undefined
  )
  const preferencesHydrated = useImageStudioPreferencesStore(
    (state) => state.hasHydrated
  )
  const savePreference = useImageStudioPreferencesStore(
    (state) => state.setPreference
  )
  const migrateLegacyPreference = useImageStudioPreferencesStore(
    (state) => state.migrateLegacyPreference
  )
  const [group, setGroup] = useState('')
  const [model, setModel] = useState('')
  const [selectionUserID, setSelectionUserID] = useState<number | null>(null)
  const [activeBatchID, setActiveBatchID] = useState<string>()
  const [taskFilter, setTaskFilter] = useState<ImageStudioTaskFilter>('all')
  const [taskPage, setTaskPage] = useState(1)
  const [draft, setDraft] = useState<ImageStudioDraft>({
    revision: 0,
    values: {},
    files: [],
  })
  const [deletingTaskID, setDeletingTaskID] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const groupsQuery = useQuery({
    queryKey: ['image-studio', 'groups'],
    queryFn: getUserGroups,
  })
  const modelsQuery = useQuery({
    queryKey: ['image-studio', 'models', group],
    queryFn: () => getUserModels(group),
    enabled: group !== '',
  })
  const pricingQuery = useQuery({
    queryKey: ['image-studio', 'image-model-catalog'],
    queryFn: fetchImageModelCatalog,
    staleTime: 5 * 60 * 1000,
  })
  const studioConfigQuery = useQuery({
    queryKey: ['image-studio', 'config'],
    queryFn: fetchImageStudioConfig,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  })
  const batchesQuery = useQuery({
    queryKey: ['image-studio', 'batches'],
    queryFn: () => fetchImageBatches(1),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (batch) => batch.status === 'queued' || batch.status === 'running'
      )
        ? 3000
        : 30_000,
  })
  const selectedBatch = useMemo(() => {
    if (!activeBatchID) return undefined
    return batchesQuery.data?.items.find(
      (batch) => batch.batch_id === activeBatchID
    )
  }, [activeBatchID, batchesQuery.data?.items])
  const libraryTasksQuery = useQuery({
    queryKey: ['image-studio', 'library-tasks', taskFilter, taskPage],
    queryFn: () => fetchImageLibraryTasks(taskPage, taskFilter),
    enabled: !activeBatchID,
    refetchInterval: (query) => {
      const summary = query.state.data?.summary
      return summary && (summary.active_count > 0 || summary.queued_count > 0)
        ? 3000
        : 30_000
    },
  })
  useEffect(() => {
    if (
      activeBatchID &&
      !batchesQuery.isLoading &&
      batchesQuery.data &&
      !selectedBatch
    ) {
      setActiveBatchID(undefined)
      setTaskFilter('all')
      setTaskPage(1)
    }
  }, [activeBatchID, batchesQuery.data, batchesQuery.isLoading, selectedBatch])

  const batchTasksQuery = useQuery({
    queryKey: [
      'image-studio',
      'batch-tasks',
      selectedBatch?.batch_id,
      taskFilter,
      taskPage,
    ],
    queryFn: () =>
      fetchImageBatchTasks(selectedBatch?.batch_id ?? '', taskPage, taskFilter),
    enabled: Boolean(selectedBatch?.batch_id),
    refetchInterval:
      selectedBatch?.status === 'queued' || selectedBatch?.status === 'running'
        ? 3000
        : false,
  })

  const models = useMemo(
    () =>
      filterImageModels(
        modelsQuery.data ?? [],
        pricingQuery.data ?? null,
        group
      ),
    [group, modelsQuery.data, pricingQuery.data]
  )
  const librarySummary = libraryTasksQuery.data?.summary
  const taskPageData = selectedBatch
    ? batchTasksQuery.data
    : libraryTasksQuery.data
  const tasks = useMemo(
    () => (taskPageData?.items ?? []).map(normalizeTask),
    [taskPageData?.items]
  )
  const taskPageSize = taskPageData?.page_size ?? 60
  const taskTotal = taskPageData?.total ?? 0
  const taskTotalPages = Math.max(1, Math.ceil(taskTotal / taskPageSize))

  useEffect(() => {
    if (taskPageData && taskPage > taskTotalPages) {
      setTaskPage(taskTotalPages)
    }
  }, [taskPage, taskPageData, taskTotalPages])

  useEffect(() => {
    if (
      !user ||
      !preferencesHydrated ||
      !groupsQuery.data ||
      pricingQuery.isPending ||
      selectionUserID === user.id
    ) {
      return
    }

    const preference = savedPreference ?? migrateLegacyPreference(user.id)
    const selectedGroup = selectImageStudioGroup(
      groupsQuery.data,
      pricingQuery.data ?? null,
      [preference?.group, user.group, 'default']
    )
    setGroup(selectedGroup)
    setModel(preference?.group === selectedGroup ? preference.model : '')
    setSelectionUserID(user.id)
  }, [
    groupsQuery.data,
    migrateLegacyPreference,
    pricingQuery.data,
    pricingQuery.isPending,
    preferencesHydrated,
    savedPreference,
    selectionUserID,
    user,
  ])

  useEffect(() => {
    if (
      !user ||
      selectionUserID !== user.id ||
      !group ||
      modelsQuery.isPending
    ) {
      return
    }

    const currentModelIsValid = models.some((item) => item.value === model)
    const savedModelIsValid =
      savedPreference?.group === group &&
      models.some((item) => item.value === savedPreference.model)
    let selectedModel = currentModelIsValid ? model : ''
    if (!selectedModel && savedModelIsValid) {
      selectedModel = savedPreference.model
    }
    if (!selectedModel) {
      selectedModel = models[0]?.value ?? ''
    }
    if (selectedModel !== model) {
      setModel(selectedModel)
    }
    if (
      selectedModel &&
      (savedPreference?.group !== group ||
        savedPreference.model !== selectedModel)
    ) {
      savePreference(user.id, { group, model: selectedModel })
    }
  }, [
    group,
    model,
    models,
    modelsQuery.isPending,
    savePreference,
    savedPreference,
    selectionUserID,
    user,
  ])
  let optionsError: 'groups' | 'models' | undefined
  if (groupsQuery.isError) optionsError = 'groups'
  else if (modelsQuery.isError) optionsError = 'models'

  const submitMutation = useMutation({
    mutationFn: async ({
      values,
      images,
    }: {
      values: ImageStudioFormValues
      images: File[]
    }) => {
      if (imageStudioModeForFiles(images) === 'generation') {
        return submitGeneration({
          group: values.group,
          model: values.model,
          prompt: values.prompt,
          count: values.count,
          size: values.size === 'default' ? '' : values.size,
          quality: values.quality === 'default' ? '' : values.quality,
        })
      }

      const formData = new FormData()
      formData.set('group', values.group)
      formData.set('model', values.model)
      formData.set('prompt', values.prompt)
      formData.set('count', String(values.count))
      if (values.size !== 'default') formData.set('size', values.size)
      if (values.quality !== 'default') formData.set('quality', values.quality)
      images.forEach((image) => formData.append('image', image))
      return submitEdit(formData)
    },
    onSuccess: () => {
      setActiveBatchID(undefined)
      setTaskFilter('all')
      setTaskPage(1)
      toast.success(t('Image task submitted.'))
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'batches'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'library-tasks'],
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteImageTasks,
    onSuccess: (_, taskIDs) => {
      toast.success(
        taskIDs.length === 1
          ? t('Task deleted.')
          : t('Cleared {{count}} tasks and their stored images.', {
              count: taskIDs.length,
            })
      )
      setPendingDelete(null)
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'batches'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'library-tasks'],
      })
      if (selectedBatch) {
        void queryClient.invalidateQueries({
          queryKey: ['image-studio', 'batch-tasks', selectedBatch.batch_id],
        })
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setDeletingTaskID(null),
  })

  const libraryDeleteMutation = useMutation({
    mutationFn: deleteImageLibrary,
    onSuccess: () => {
      toast.success(t('Creation library cleared.'))
      setPendingDelete(null)
      setActiveBatchID(undefined)
      setTaskFilter('all')
      setTaskPage(1)
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'batches'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'library-tasks'],
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const batchDeleteMutation = useMutation({
    mutationFn: deleteImageBatch,
    onSuccess: () => {
      toast.success(t('Batch deleted.'))
      setPendingDelete(null)
      setActiveBatchID(undefined)
      setTaskFilter('all')
      setTaskPage(1)
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'batches'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'library-tasks'],
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const failedCleanupMutation = useMutation({
    mutationFn: async ({ batchID }: { batchID?: string; count: number }) => {
      if (batchID) {
        await deleteFailedImageBatchTasks(batchID)
        return
      }
      await deleteFailedImageLibraryTasks()
    },
    onSuccess: (_, scope) => {
      toast.success(
        t('Cleared {{count}} failed tasks.', { count: scope.count })
      )
      setPendingDelete(null)
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'batches'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['image-studio', 'library-tasks'],
      })
      if (scope.batchID) {
        void queryClient.invalidateQueries({
          queryKey: ['image-studio', 'batch-tasks', scope.batchID],
        })
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const pageDownloadMutation = useMutation({
    mutationFn: async ({
      taskIDs,
      filename,
    }: {
      taskIDs: string[]
      filename: string
    }) => {
      startArchiveDownload(imageTaskDownloadURL(taskIDs), filename)
    },
  })

  const allDownloadMutation = useMutation({
    mutationFn: async ({
      batchID,
      filename,
    }: {
      batchID?: string
      filename: string
    }) => {
      startArchiveDownload(
        batchID ? imageBatchDownloadURL(batchID) : imageLibraryDownloadURL(),
        filename
      )
    },
  })

  const applyDraft = (
    values: Partial<ImageStudioFormValues>,
    files: File[] = []
  ) => {
    setDraft((current) => ({
      revision: current.revision + 1,
      values,
      files,
    }))
    if (values.group) {
      setGroup(values.group)
      setModel(values.model ?? '')
    }
    window.requestAnimationFrame(() => {
      document
        .querySelector('#image-studio-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleUseAsReference = async (
    task: NormalizedImageStudioTask,
    image: ImageStudioImage
  ) => {
    try {
      const blob = await fetchImageBlob(image)
      const extension = imageFileExtension(image)
      const file = new File([blob], `studio-${task.task_id}.${extension}`, {
        type: blob.type || image.mime_type || 'image/png',
      })
      applyDraft(valuesFromTask(task), [file])
      toast.success(t('Image added as a reference.'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const downloadImage = (
    task: NormalizedImageStudioTask,
    image: ImageStudioImage,
    index: number
  ) => {
    const href = image.download_url || image.url
    if (!href) return
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `image-${task.task_id}-${index + 1}.${imageFileExtension(image)}`
    anchor.click()
  }

  const changeTaskPage = (page: number) => {
    setTaskPage(page)
    window.requestAnimationFrame(() => {
      document
        .querySelector('#studio-results-title')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  let pendingDeleteTitle = t('Delete result')
  let pendingDeleteActionLabel = t('Delete')
  let pendingDeleteDescription = t(
    'Delete this completed task and its stored images?'
  )
  if (pendingDelete?.scope === 'failed') {
    pendingDeleteTitle = t('Clear failed tasks')
    pendingDeleteActionLabel = t('Clear failed tasks')
    pendingDeleteDescription = pendingDelete.batchID
      ? t(
          'Delete all {{count}} failed tasks from this batch? Successful and running tasks will be kept. This cannot be undone.',
          { count: pendingDelete.totalCount ?? 0 }
        )
      : t(
          'Delete all {{count}} failed tasks from your Studio library? Successful and running tasks will be kept. This cannot be undone.',
          { count: pendingDelete.totalCount ?? 0 }
        )
  } else if (pendingDelete?.scope === 'all') {
    pendingDeleteTitle = t('Clear all')
    pendingDeleteActionLabel = t('Clear all')
    if (pendingDelete.library) {
      pendingDeleteDescription = t(
        'Delete all {{count}} completed Studio results? This cannot be undone.',
        { count: pendingDelete.totalCount ?? 0 }
      )
    } else if (pendingDelete.batchID) {
      pendingDeleteDescription = t(
        'Delete this completed batch and all {{count}} stored image results? This cannot be undone.',
        { count: pendingDelete.totalCount ?? 0 }
      )
    } else {
      pendingDeleteDescription = t(
        'Delete {{count}} finished tasks and their stored images? Running tasks will be kept. This cannot be undone.',
        { count: pendingDelete.taskIDs.length }
      )
    }
  }

  return (
    <div className='mx-auto flex w-full max-w-[100rem] flex-col gap-6 p-4 sm:p-6 lg:h-full lg:min-h-0 lg:overflow-hidden'>
      <header className='flex flex-col justify-between gap-3 sm:flex-row sm:items-end'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {t('AI Studio')}
          </h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Create, save, and iterate on images in one focused workspace.')}
          </p>
        </div>
        <Badge variant='outline'>{t('Private local image library')}</Badge>
      </header>

      <div className='grid items-start gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[23.5rem_minmax(0,1fr)]'>
        <StudioForm
          key={draft.revision}
          groups={groupsQuery.data ?? []}
          models={models}
          promptPresets={studioConfigQuery.data?.prompt_presets ?? []}
          sizePresets={studioConfigQuery.data?.size_presets ?? []}
          selectedGroup={group}
          selectedModel={model}
          initialValues={draft.values}
          initialFiles={draft.files}
          maxBatchSize={studioConfigQuery.data?.max_batch_size ?? 1000}
          interactiveBatchLimit={
            studioConfigQuery.data?.interactive_batch_limit ?? 10
          }
          isLoadingOptions={
            groupsQuery.isLoading ||
            pricingQuery.isLoading ||
            !preferencesHydrated ||
            Boolean(user && selectionUserID !== user.id) ||
            Boolean(group && modelsQuery.isLoading)
          }
          optionsError={optionsError}
          isSubmitting={submitMutation.isPending}
          onGroupChange={(nextGroup) => {
            setGroup(nextGroup)
            setModel('')
            if (user) {
              savePreference(user.id, { group: nextGroup, model: '' })
            }
          }}
          onModelChange={(nextModel) => {
            setModel(nextModel)
            if (user && group) {
              savePreference(user.id, { group, model: nextModel })
            }
          }}
          onUploadError={(message) => toast.error(message)}
          onRetryOptions={() => {
            void groupsQuery.refetch()
            if (group) void modelsQuery.refetch()
            void pricingQuery.refetch()
          }}
          onSubmit={(values, images) =>
            submitMutation.mutateAsync({ values, images }).then(() => undefined)
          }
        />

        <div className='min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1'>
          <div className='mb-3 flex flex-col gap-1.5 sm:max-w-sm'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('View scope')}
            </span>
            <Select
              items={[
                {
                  value: ALL_STUDIO_SCOPE,
                  label: `${t('All creations')} (${librarySummary?.total_count ?? 0})`,
                },
                ...(batchesQuery.data?.items ?? []).map((batch) => ({
                  value: batch.batch_id,
                  label: `${formatTaskTime(batch.created_at)} · ${t('{{count}} images', { count: batch.total_count })} · ${t('{{count}} completed', { count: batch.success_count })}`,
                })),
              ]}
              value={activeBatchID ?? ALL_STUDIO_SCOPE}
              onValueChange={(value) => {
                setTaskFilter('all')
                setTaskPage(1)
                if (value === null || value === ALL_STUDIO_SCOPE) {
                  setActiveBatchID(undefined)
                  return
                }
                setActiveBatchID(value)
              }}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value={ALL_STUDIO_SCOPE}>
                    {t('All creations')} ({librarySummary?.total_count ?? 0})
                  </SelectItem>
                  {(batchesQuery.data?.items ?? []).map((batch) => (
                    <SelectItem key={batch.batch_id} value={batch.batch_id}>
                      {formatTaskTime(batch.created_at)} ·{' '}
                      {t('{{count}} images', { count: batch.total_count })} ·{' '}
                      {t('{{count}} completed', {
                        count: batch.success_count,
                      })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <TaskGallery
            key={selectedBatch?.batch_id ?? ALL_STUDIO_SCOPE}
            tasks={tasks}
            retentionDays={studioConfigQuery.data?.retention_days ?? 0}
            activeBatch={selectedBatch}
            librarySummary={selectedBatch ? undefined : librarySummary}
            filter={taskFilter}
            page={taskPage}
            pageSize={taskPageSize}
            total={taskTotal}
            isLoading={
              batchesQuery.isLoading ||
              Boolean(activeBatchID && !selectedBatch) ||
              (selectedBatch
                ? batchTasksQuery.isLoading
                : libraryTasksQuery.isLoading)
            }
            isRefreshing={
              selectedBatch
                ? batchTasksQuery.isFetching
                : libraryTasksQuery.isFetching
            }
            isDownloading={
              pageDownloadMutation.isPending || allDownloadMutation.isPending
            }
            isClearing={
              batchDeleteMutation.isPending ||
              libraryDeleteMutation.isPending ||
              (deleteMutation.isPending && pendingDelete?.scope === 'all')
            }
            isClearingFailed={failedCleanupMutation.isPending}
            deletingTaskID={deletingTaskID}
            onRefresh={() => {
              void batchesQuery.refetch()
              if (selectedBatch) {
                void batchTasksQuery.refetch()
              } else {
                void libraryTasksQuery.refetch()
              }
            }}
            onDelete={(taskID) =>
              setPendingDelete({ taskIDs: [taskID], scope: 'single' })
            }
            onDownload={(task, image, index) =>
              downloadImage(task, image, index)
            }
            downloadAllEnabled={
              studioConfigQuery.data?.download_all_enabled ?? false
            }
            onDownloadPage={() => {
              if (
                pageDownloadMutation.isPending ||
                allDownloadMutation.isPending
              ) {
                return
              }
              const taskIDs = tasks
                .filter(
                  (task) =>
                    task.status === 'SUCCESS' && Boolean(task.images[0]?.url)
                )
                .map((task) => task.task_id)
              if (taskIDs.length === 0) return
              const scope = selectedBatch ? selectedBatch.batch_id : 'all'
              pageDownloadMutation.mutate({
                taskIDs,
                filename: `ai-studio-${scope}-page-${taskPage}.zip`,
              })
            }}
            onDownloadAll={() => {
              if (
                pageDownloadMutation.isPending ||
                allDownloadMutation.isPending
              ) {
                return
              }
              if (selectedBatch) {
                allDownloadMutation.mutate({
                  batchID: selectedBatch.batch_id,
                  filename: `ai-studio-${selectedBatch.batch_id}.zip`,
                })
                return
              }
              if (librarySummary) {
                allDownloadMutation.mutate({
                  filename: 'ai-studio-all.zip',
                })
              }
            }}
            onFilterChange={(filter) => {
              setTaskFilter(filter)
              setTaskPage(1)
            }}
            onPageChange={changeTaskPage}
            onClearAll={() => {
              if (selectedBatch) {
                setPendingDelete({
                  taskIDs: [],
                  scope: 'all',
                  batchID: selectedBatch.batch_id,
                  totalCount: selectedBatch.total_count,
                })
                return
              }
              setPendingDelete({
                taskIDs: [],
                scope: 'all',
                library: true,
                totalCount: librarySummary?.total_count ?? 0,
              })
            }}
            onClearFailed={() => {
              const failureCount =
                selectedBatch?.failure_count ??
                librarySummary?.failure_count ??
                0
              if (failureCount <= 0) return
              setPendingDelete({
                taskIDs: [],
                scope: 'failed',
                batchID: selectedBatch?.batch_id,
                library: !selectedBatch,
                totalCount: failureCount,
              })
            }}
            onReuse={(task) => applyDraft(valuesFromTask(task))}
            onUseAsReference={(task, image) =>
              void handleUseAsReference(task, image)
            }
            onRetry={(task) =>
              submitMutation.mutate({
                values: { ...valuesFromTask(task), count: 1 },
                images: [],
              })
            }
          />
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (
            !open &&
            !deleteMutation.isPending &&
            !batchDeleteMutation.isPending &&
            !libraryDeleteMutation.isPending &&
            !failedCleanupMutation.isPending
          ) {
            setPendingDelete(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                deleteMutation.isPending ||
                batchDeleteMutation.isPending ||
                libraryDeleteMutation.isPending ||
                failedCleanupMutation.isPending
              }
            >
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleteMutation.isPending ||
                batchDeleteMutation.isPending ||
                libraryDeleteMutation.isPending ||
                failedCleanupMutation.isPending
              }
              onClick={() => {
                if (!pendingDelete) return
                if (pendingDelete.scope === 'failed') {
                  failedCleanupMutation.mutate({
                    batchID: pendingDelete.batchID,
                    count: pendingDelete.totalCount ?? 0,
                  })
                  return
                }
                if (pendingDelete.library) {
                  libraryDeleteMutation.mutate()
                  return
                }
                if (pendingDelete.batchID) {
                  batchDeleteMutation.mutate(pendingDelete.batchID)
                  return
                }
                setDeletingTaskID(
                  pendingDelete.scope === 'single'
                    ? pendingDelete.taskIDs[0]
                    : null
                )
                deleteMutation.mutate(pendingDelete.taskIDs)
              }}
            >
              {deleteMutation.isPending ||
              batchDeleteMutation.isPending ||
              libraryDeleteMutation.isPending ||
              failedCleanupMutation.isPending ? (
                <Spinner data-icon='inline-start' />
              ) : null}
              {pendingDeleteActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
