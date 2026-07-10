import { zodResolver } from '@hookform/resolvers/zod'
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
  AlertCircleIcon,
  ImageUpload01Icon,
  MagicWand01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { GroupOption, ModelOption } from '@/features/playground/types'
import { useDebounce } from '@/hooks/use-debounce'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { estimateImageStudioCost } from '../api'
import { imageStudioFormSchema } from '../form-schema'
import {
  appendReferenceImages,
  imageStudioModeForFiles,
} from '../reference-files'
import {
  imageStudioSizeValue,
  recommendedSizePreset,
  sizePresetsForSelection,
  uniquePresetValues,
} from '../size-presets'
import type {
  ImageStudioFormValues,
  ImageStudioPromptPreset,
  ImageStudioSizePreset,
} from '../types'
import { ReferenceUploader } from './reference-uploader'

function imageModelQualities(model: string) {
  const normalized = model.toLowerCase()
  if (normalized.includes('dall-e-3')) {
    return ['default', 'standard', 'hd']
  }
  if (normalized.includes('dall-e-2')) {
    return ['default']
  }
  if (normalized.includes('gpt-image')) {
    return ['default', 'low', 'medium', 'high']
  }
  return ['default']
}

type StudioFormProps = {
  groups: GroupOption[]
  models: ModelOption[]
  promptPresets: ImageStudioPromptPreset[]
  sizePresets: ImageStudioSizePreset[]
  selectedGroup: string
  selectedModel: string
  initialValues?: Partial<ImageStudioFormValues>
  initialFiles?: File[]
  isLoadingOptions: boolean
  optionsError?: 'groups' | 'models'
  isSubmitting: boolean
  onGroupChange: (group: string) => void
  onModelChange: (model: string) => void
  onSubmit: (values: ImageStudioFormValues, images: File[]) => Promise<void>
  onUploadError: (message: string) => void
  onRetryOptions: () => void
}

export function StudioForm(props: StudioFormProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<File[]>(props.initialFiles ?? [])
  const [isPromptDragging, setIsPromptDragging] = useState(false)
  const form = useForm<ImageStudioFormValues>({
    resolver: zodResolver(imageStudioFormSchema),
    defaultValues: {
      group: props.selectedGroup,
      model: props.selectedModel,
      prompt: props.initialValues?.prompt ?? '',
      size: props.initialValues?.size ?? 'default',
      quality: props.initialValues?.quality ?? 'default',
      count: props.initialValues?.count ?? 1,
    },
  })
  const mode = imageStudioModeForFiles(files)
  const selectedGroup = form.watch('group')
  const selectedModel = form.watch('model')
  const prompt = form.watch('prompt')
  const count = form.watch('count')
  const size = form.watch('size')
  const quality = form.watch('quality')
  const debouncedPrompt = useDebounce(prompt, 700)
  const canEstimate =
    selectedGroup !== '' &&
    selectedModel !== '' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 10
  const estimateQuery = useQuery({
    queryKey: [
      'image-studio',
      'estimate',
      mode,
      selectedGroup,
      selectedModel,
      debouncedPrompt,
      size,
      quality,
      count,
    ],
    queryFn: ({ signal }) =>
      estimateImageStudioCost(
        {
          mode,
          group: selectedGroup,
          model: selectedModel,
          prompt: debouncedPrompt,
          n: count,
          size: size === 'default' ? '' : size,
          quality: quality === 'default' ? '' : quality,
        },
        signal
      ),
    enabled: canEstimate,
    staleTime: 30_000,
    retry: false,
  })
  const compatibleSizePresets = useMemo(
    () =>
      sizePresetsForSelection(props.sizePresets, selectedGroup, selectedModel),
    [props.sizePresets, selectedGroup, selectedModel]
  )
  const selectedSizePreset = compatibleSizePresets.find(
    (preset) => imageStudioSizeValue(preset) === size
  )
  const selectedAspectRatio = selectedSizePreset?.aspect_ratio ?? 'default'
  const selectedTier = selectedSizePreset?.tier ?? 'default'
  const aspectRatioOptions = uniquePresetValues(
    compatibleSizePresets,
    'aspect_ratio'
  )
  const tierSource =
    selectedAspectRatio === 'default'
      ? compatibleSizePresets
      : compatibleSizePresets.filter(
          (preset) => preset.aspect_ratio === selectedAspectRatio
        )
  const tierOptions = uniquePresetValues(tierSource, 'tier').map((tier) => ({
    value: tier,
    label: t(
      tierSource.find((preset) => preset.tier === tier)?.tier_label ?? tier
    ),
  }))
  const qualityOptions = imageModelQualities(selectedModel).map((quality) => {
    let label = quality.charAt(0).toUpperCase() + quality.slice(1)
    if (quality === 'default') label = t('Automatic')
    if (quality === 'standard') label = t('Standard')
    if (quality === 'hd') label = t('High definition')
    return { value: quality, label }
  })

  const selectSizePreset = (candidates: ImageStudioSizePreset[]) => {
    const preferred = candidates.find((preset) => preset.tier === selectedTier)
    const next = preferred ?? candidates[0]
    form.setValue('size', next ? imageStudioSizeValue(next) : 'default', {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  useEffect(() => {
    if (form.getValues('group') !== props.selectedGroup) {
      form.setValue('group', props.selectedGroup, { shouldValidate: true })
    }
  }, [form, props.selectedGroup])

  useEffect(() => {
    const current = form.getValues('model')
    if (current !== props.selectedModel) {
      form.setValue('model', props.selectedModel, { shouldValidate: true })
    }
  }, [form, props.selectedModel])

  const addReferenceFiles = (incoming: File[]) => {
    if (props.isSubmitting || incoming.length === 0) return
    const result = appendReferenceImages(files, incoming)
    for (const error of result.errors) {
      props.onUploadError(t(error))
    }
    if (result.addedCount === 0) return
    setFiles(result.files)
  }

  const submit = form.handleSubmit(async (values) => {
    await props.onSubmit(values, files)
  })

  const submitLabel =
    mode === 'edit'
      ? t('Edit {{count}} images', {
          count: Number.isFinite(count) ? count : 1,
        })
      : t('Generate {{count}} images', {
          count: Number.isFinite(count) ? count : 1,
        })

  return (
    <Card className='lg:h-full'>
      <CardHeader className='lg:shrink-0'>
        <CardTitle className='flex items-center gap-2'>
          <HugeiconsIcon icon={MagicWand01Icon} strokeWidth={1.8} />
          {t('Creation console')}
        </CardTitle>
        <CardDescription>
          {t('Describe, generate, and refine without leaving this workspace.')}
        </CardDescription>
      </CardHeader>
      <CardContent className='lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain'>
        <form id='image-studio-form' onSubmit={submit}>
          <FieldGroup>
            {props.optionsError ? (
              <Alert>
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.8} />
                <AlertTitle>{t('Failed to load')}</AlertTitle>
                <AlertDescription className='flex flex-col items-start gap-2'>
                  <span>
                    {props.optionsError === 'groups'
                      ? t('Failed to load playground groups')
                      : t('Failed to load playground models')}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={props.onRetryOptions}
                  >
                    {t('Retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {!props.optionsError &&
            !props.isLoadingOptions &&
            props.models.length === 0 ? (
              <Alert>
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.8} />
                <AlertTitle>{t('No available models')}</AlertTitle>
                <AlertDescription>{t('No models available')}</AlertDescription>
              </Alert>
            ) : null}
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-1'>
              <Field data-invalid={Boolean(form.formState.errors.group)}>
                <FieldLabel htmlFor='image-studio-group'>
                  {t('Group')}
                </FieldLabel>
                <Select
                  items={props.groups}
                  value={selectedGroup || null}
                  onValueChange={(value) => {
                    if (value === null) return
                    form.setValue('group', value, { shouldValidate: true })
                    form.setValue('model', '')
                    form.setValue('size', 'default')
                    form.setValue('quality', 'default')
                    props.onGroupChange(value)
                  }}
                >
                  <SelectTrigger
                    id='image-studio-group'
                    className='w-full'
                    aria-invalid={Boolean(form.formState.errors.group)}
                  >
                    <SelectValue placeholder={t('Select a group')} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {props.groups.map((group) => (
                        <SelectItem key={group.value} value={group.value}>
                          {group.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError>
                  {form.formState.errors.group ? t('Select a group.') : null}
                </FieldError>
              </Field>

              <Field data-invalid={Boolean(form.formState.errors.model)}>
                <FieldLabel htmlFor='image-studio-model'>
                  {t('Model')}
                </FieldLabel>
                <Select
                  items={props.models}
                  value={selectedModel || null}
                  onValueChange={(value) => {
                    if (value === null) return
                    form.setValue('model', value, { shouldValidate: true })
                    form.setValue('size', 'default')
                    form.setValue('quality', 'default')
                    props.onModelChange(value)
                  }}
                >
                  <SelectTrigger
                    id='image-studio-model'
                    className='w-full'
                    aria-invalid={Boolean(form.formState.errors.model)}
                    disabled={
                      props.isLoadingOptions || props.models.length === 0
                    }
                  >
                    <SelectValue
                      placeholder={
                        props.isLoadingOptions
                          ? t('Loading models...')
                          : t('Select a model')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {props.models.map((model) => (
                        <SelectItem key={model.value} value={model.value}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError>
                  {form.formState.errors.model ? t('Select a model.') : null}
                </FieldError>
              </Field>
            </div>

            {props.promptPresets.length > 0 ? (
              <FieldSet>
                <FieldLegend variant='label'>{t('Prompt presets')}</FieldLegend>
                <div className='grid max-h-36 grid-cols-2 gap-2 overflow-y-auto pr-1'>
                  {props.promptPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      type='button'
                      variant='outline'
                      size='sm'
                      className='justify-start truncate'
                      title={preset.title}
                      onClick={() => {
                        form.setValue('prompt', preset.prompt, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                        const recommendedSize = recommendedSizePreset(
                          compatibleSizePresets,
                          preset.aspect_ratio,
                          preset.tier
                        )
                        if (recommendedSize) {
                          form.setValue(
                            'size',
                            imageStudioSizeValue(recommendedSize),
                            { shouldDirty: true, shouldValidate: true }
                          )
                        }
                      }}
                    >
                      {preset.title}
                    </Button>
                  ))}
                </div>
                <FieldDescription>
                  {t(
                    'Choose a preset, then adjust any detail before generating.'
                  )}
                </FieldDescription>
              </FieldSet>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.prompt)}>
              <FieldLabel htmlFor='image-studio-prompt'>
                {t('Prompt')}
              </FieldLabel>
              <Textarea
                id='image-studio-prompt'
                rows={6}
                maxLength={4000}
                placeholder={t('Describe the image you want to create')}
                aria-invalid={Boolean(form.formState.errors.prompt)}
                className={cn(
                  isPromptDragging && 'border-ring ring-ring/20 ring-3'
                )}
                {...form.register('prompt')}
                onPaste={(event) => {
                  const pastedFiles = [...event.clipboardData.items]
                    .filter((item) => item.kind === 'file')
                    .flatMap((item) => {
                      const file = item.getAsFile()
                      return file ? [file] : []
                    })
                  if (pastedFiles.length === 0) return
                  event.preventDefault()
                  addReferenceFiles(pastedFiles)
                }}
                onDragEnter={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return
                  event.preventDefault()
                  setIsPromptDragging(true)
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDragLeave={() => setIsPromptDragging(false)}
                onDrop={(event) => {
                  const droppedFiles = [...event.dataTransfer.files]
                  if (droppedFiles.length === 0) return
                  event.preventDefault()
                  setIsPromptDragging(false)
                  addReferenceFiles(droppedFiles)
                }}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === 'Enter'
                  ) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              <FieldDescription className='flex flex-col gap-1'>
                <span>
                  {t('Drop or paste images here to switch to image editing.')}
                </span>
                <span className='flex justify-between gap-3'>
                  <span>{t('Press Ctrl or Command + Enter to generate.')}</span>
                  <span>{prompt.length}/4000</span>
                </span>
              </FieldDescription>
              <FieldError>
                {form.formState.errors.prompt ? t('Prompt is required.') : null}
              </FieldError>
            </Field>

            <Field>
              <FieldLabel>{t('Reference images')}</FieldLabel>
              <ReferenceUploader
                files={files}
                disabled={props.isSubmitting}
                onChange={setFiles}
                onAddFiles={addReferenceFiles}
              />
            </Field>

            <div className='grid grid-cols-2 gap-3'>
              <Field>
                <FieldLabel htmlFor='image-studio-aspect-ratio'>
                  {t('Aspect ratio')}
                </FieldLabel>
                <Select
                  items={[
                    { value: 'default', label: t('Automatic') },
                    ...aspectRatioOptions.map((ratio) => ({
                      value: ratio,
                      label: ratio,
                    })),
                  ]}
                  value={selectedAspectRatio}
                  onValueChange={(value) => {
                    if (value === null) return
                    if (value === 'default') {
                      form.setValue('size', 'default', { shouldDirty: true })
                      return
                    }
                    selectSizePreset(
                      compatibleSizePresets.filter(
                        (preset) => preset.aspect_ratio === value
                      )
                    )
                  }}
                >
                  <SelectTrigger
                    id='image-studio-aspect-ratio'
                    className='w-full'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='default'>{t('Automatic')}</SelectItem>
                      {aspectRatioOptions.map((ratio) => (
                        <SelectItem key={ratio} value={ratio}>
                          {ratio}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor='image-studio-resolution'>
                  {t('Resolution')}
                </FieldLabel>
                <Select
                  items={[
                    { value: 'default', label: t('Automatic') },
                    ...tierOptions,
                  ]}
                  value={selectedTier}
                  onValueChange={(value) => {
                    if (value === null) return
                    if (value === 'default') {
                      form.setValue('size', 'default', { shouldDirty: true })
                      return
                    }
                    const next = compatibleSizePresets.find(
                      (preset) =>
                        preset.tier === value &&
                        (selectedAspectRatio === 'default' ||
                          preset.aspect_ratio === selectedAspectRatio)
                    )
                    form.setValue(
                      'size',
                      next ? imageStudioSizeValue(next) : 'default',
                      { shouldDirty: true, shouldValidate: true }
                    )
                  }}
                >
                  <SelectTrigger
                    id='image-studio-resolution'
                    className='w-full'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='default'>{t('Automatic')}</SelectItem>
                      {tierOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor='image-studio-quality'>
                  {t('Quality')}
                </FieldLabel>
                <Select
                  items={qualityOptions}
                  value={quality}
                  onValueChange={(value) =>
                    value !== null && form.setValue('quality', value)
                  }
                >
                  <SelectTrigger id='image-studio-quality' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {qualityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.count)}>
                <FieldLabel htmlFor='image-studio-count'>
                  {t('Count')}
                </FieldLabel>
                <Input
                  id='image-studio-count'
                  type='number'
                  min={1}
                  max={10}
                  aria-invalid={Boolean(form.formState.errors.count)}
                  {...form.register('count', { valueAsNumber: true })}
                />
                <FieldError>
                  {form.formState.errors.count
                    ? t('Count must be between 1 and 10.')
                    : null}
                </FieldError>
              </Field>
            </div>
            {selectedSizePreset ? (
              <FieldDescription>
                {t('Actual output: {{width}} × {{height}}', {
                  width: selectedSizePreset.width,
                  height: selectedSizePreset.height,
                })}
                {selectedSizePreset.experimental
                  ? ` · ${t('Experimental')}`
                  : null}
              </FieldDescription>
            ) : null}
            {canEstimate ? (
              <Alert>
                {estimateQuery.isPending ? <Spinner /> : null}
                <AlertTitle>{t('Estimated consumption')}</AlertTitle>
                <AlertDescription>
                  {estimateQuery.isPending
                    ? t('Calculating estimate...')
                    : null}
                  {estimateQuery.isError
                    ? t('Pricing estimate unavailable.')
                    : null}
                  {estimateQuery.data ? (
                    <div className='flex flex-col gap-1'>
                      <strong className='text-foreground text-base'>
                        {formatQuota(estimateQuery.data.estimated_quota)}
                      </strong>
                      <span>
                        {t('Estimated total for {{count}} images.', {
                          count: estimateQuery.data.count,
                        })}
                      </span>
                      <span>
                        {t(
                          'This is an estimate based on current pricing. Actual consumption may vary.'
                        )}
                      </span>
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className='lg:shrink-0'>
        <Button
          className='w-full'
          type='submit'
          form='image-studio-form'
          disabled={props.isSubmitting || props.models.length === 0}
        >
          {props.isSubmitting ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <HugeiconsIcon
              icon={mode === 'edit' ? ImageUpload01Icon : MagicWand01Icon}
              strokeWidth={1.8}
              data-icon='inline-start'
            />
          )}
          {submitLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}
