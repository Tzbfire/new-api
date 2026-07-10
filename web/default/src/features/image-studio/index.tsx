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
import { Spinner } from '@/components/ui/spinner'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { useAuthStore } from '@/stores/auth-store'
import { useImageStudioPreferencesStore } from '@/stores/image-studio-preferences-store'

import {
  deleteImageTasks,
  downloadImageArchive,
  fetchImageBlob,
  fetchImageModelCatalog,
  fetchImageStudioConfig,
  fetchImageTasks,
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
  ImageStudioSubmission,
  ImageStudioTask,
  NormalizedImageStudioTask,
} from './types'
import {
  errorMessage,
  filterImageModels,
  imageFileExtension,
  isActiveTask,
  normalizeTask,
  selectImageStudioGroup,
} from './utils'

const TASK_QUERY_KEY = ['image-studio', 'tasks'] as const

type PendingDelete = {
  taskIDs: string[]
  scope: 'single' | 'all'
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

function mergeSubmittedTasks(
  current: ImageStudioTask[] | undefined,
  submission: ImageStudioSubmission
) {
  const submittedIDs = new Set(submission.tasks.map((task) => task.task_id))
  return [
    ...submission.tasks,
    ...(current ?? []).filter((task) => !submittedIDs.has(task.task_id)),
  ]
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
  const tasksQuery = useQuery({
    queryKey: TASK_QUERY_KEY,
    queryFn: fetchImageTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data
      return tasks?.some(isActiveTask) ? 3000 : 30_000
    },
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
  const tasks = useMemo(
    () => (tasksQuery.data ?? []).map(normalizeTask),
    [tasksQuery.data]
  )

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
          n: values.count,
          size: values.size === 'default' ? '' : values.size,
          quality: values.quality === 'default' ? '' : values.quality,
        })
      }

      const formData = new FormData()
      formData.set('group', values.group)
      formData.set('model', values.model)
      formData.set('prompt', values.prompt)
      formData.set('n', String(values.count))
      if (values.size !== 'default') formData.set('size', values.size)
      if (values.quality !== 'default') formData.set('quality', values.quality)
      images.forEach((image) => formData.append('image', image))
      return submitEdit(formData)
    },
    onSuccess: (submission) => {
      queryClient.setQueryData<ImageStudioTask[]>(TASK_QUERY_KEY, (current) =>
        mergeSubmittedTasks(current, submission)
      )
      setActiveBatchID(
        submission.batchId || submission.tasks[0]?.task_id || undefined
      )
      toast.success(t('Image task submitted.'))
      void queryClient.invalidateQueries({ queryKey: TASK_QUERY_KEY })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteImageTasks,
    onSuccess: (_, taskIDs) => {
      const deleted = new Set(taskIDs)
      queryClient.setQueryData<ImageStudioTask[]>(TASK_QUERY_KEY, (current) =>
        (current ?? []).filter((task) => !deleted.has(task.task_id))
      )
      toast.success(
        taskIDs.length === 1
          ? t('Task deleted.')
          : t('Cleared {{count}} tasks and their stored images.', {
              count: taskIDs.length,
            })
      )
      setPendingDelete(null)
      void queryClient.invalidateQueries({ queryKey: TASK_QUERY_KEY })
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setDeletingTaskID(null),
  })

  const downloadMutation = useMutation({
    mutationFn: async (batchTasks: NormalizedImageStudioTask[]) => ({
      archive: await downloadImageArchive(
        batchTasks.map((task) => task.task_id)
      ),
      count: batchTasks.length,
    }),
    onSuccess: ({ archive, count }) => {
      const url = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ai-studio-images-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      toast.success(t('Downloaded {{count}} images.', { count }))
    },
    onError: (error) => toast.error(errorMessage(error)),
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

  const downloadBatch = (batchTasks: NormalizedImageStudioTask[]) => {
    if (batchTasks.length === 0 || downloadMutation.isPending) return
    downloadMutation.mutate(batchTasks)
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
          <TaskGallery
            tasks={tasks}
            retentionDays={studioConfigQuery.data?.retention_days ?? 0}
            activeBatchID={activeBatchID}
            isLoading={tasksQuery.isLoading}
            isRefreshing={tasksQuery.isFetching}
            isDownloading={downloadMutation.isPending}
            isClearing={
              deleteMutation.isPending && pendingDelete?.scope === 'all'
            }
            deletingTaskID={deletingTaskID}
            onRefresh={() => void tasksQuery.refetch()}
            onDelete={(taskID) =>
              setPendingDelete({ taskIDs: [taskID], scope: 'single' })
            }
            onDownload={(task, image, index) =>
              downloadImage(task, image, index)
            }
            onDownloadBatch={downloadBatch}
            onClearAll={(clearableTasks) =>
              setPendingDelete({
                taskIDs: clearableTasks.map((task) => task.task_id),
                scope: 'all',
              })
            }
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
          if (!open && !deleteMutation.isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.scope === 'all'
                ? t('Clear all')
                : t('Delete result')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.scope === 'all'
                ? t(
                    'Delete {{count}} finished tasks and their stored images? Running tasks will be kept. This cannot be undone.',
                    { count: pendingDelete.taskIDs.length }
                  )
                : t('Delete this completed task and its stored images?')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!pendingDelete) return
                setDeletingTaskID(
                  pendingDelete.scope === 'single'
                    ? pendingDelete.taskIDs[0]
                    : null
                )
                deleteMutation.mutate(pendingDelete.taskIDs)
              }}
            >
              {deleteMutation.isPending ? (
                <Spinner data-icon='inline-start' />
              ) : null}
              {pendingDelete?.scope === 'all' ? t('Clear all') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
