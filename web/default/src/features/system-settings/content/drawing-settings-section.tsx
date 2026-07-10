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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { ImageStudioPromptPresetEditor } from './image-studio-prompt-preset-editor'
import { validateImageStudioSizePresetJSON } from './image-studio-size-preset-config'
import { ImageStudioSizePresetEditor } from './image-studio-size-preset-editor'

const createDrawingSchema = (t: (key: string) => string) =>
  z.object({
    DrawingEnabled: z.boolean(),
    ImageStudioBatchConcurrency: z.number().int().min(1).max(10),
    ImageStudioTaskTimeoutMinutes: z.number().int().min(1).max(120),
    ImageStudioRetentionDays: z.number().int().min(0).max(3650),
    ImageStudioBaseURL: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (value === '') return true
        try {
          const parsed = new URL(value)
          const hasOnlyOrigin =
            (parsed.pathname === '' || parsed.pathname === '/') &&
            parsed.search === '' &&
            parsed.hash === '' &&
            parsed.username === '' &&
            parsed.password === ''
          const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase()
          const isLoopback =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]'
          return (
            hasOnlyOrigin &&
            (parsed.protocol === 'https:' ||
              (parsed.protocol === 'http:' && isLoopback))
          )
        } catch {
          return false
        }
      }, t('Enter an HTTPS origin without a path, query, or fragment. HTTP is allowed only for localhost.')),
    ImageStudioPromptPresets: z.string().superRefine((value, context) => {
      try {
        const presets: unknown = JSON.parse(value || '[]')
        if (!Array.isArray(presets)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('Prompt presets must be a JSON array.'),
          })
          return
        }
        if (presets.length > 12) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('You can configure up to 12 prompt presets.'),
          })
          return
        }
        const ids = new Set<string>()
        for (const preset of presets) {
          if (
            preset === null ||
            typeof preset !== 'object' ||
            typeof preset.id !== 'string' ||
            typeof preset.title !== 'string' ||
            typeof preset.prompt !== 'string' ||
            preset.id.trim() === '' ||
            preset.title.trim() === '' ||
            preset.prompt.trim() === '' ||
            preset.id.length > 64 ||
            preset.title.length > 60 ||
            preset.prompt.length > 4000 ||
            ids.has(preset.id)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: t(
                'Each preset needs a unique ID, a name, and prompt content within the length limits.'
              ),
            })
            return
          }
          ids.add(preset.id)
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('Prompt presets contain invalid data.'),
        })
      }
    }),
    ImageStudioSizePresets: z
      .string()
      .refine(
        validateImageStudioSizePresetJSON,
        t(
          'Each size preset needs valid group, model, ratio, resolution, width, and height values within the safety limits.'
        )
      ),
    MjNotifyEnabled: z.boolean(),
    MjAccountFilterEnabled: z.boolean(),
    MjForwardUrlEnabled: z.boolean(),
    MjModeClearEnabled: z.boolean(),
    MjActionCheckSuccessEnabled: z.boolean(),
  })

type DrawingFormValues = z.infer<ReturnType<typeof createDrawingSchema>>
type DrawingSwitchName = Exclude<
  keyof DrawingFormValues,
  | 'ImageStudioBatchConcurrency'
  | 'ImageStudioTaskTimeoutMinutes'
  | 'ImageStudioRetentionDays'
  | 'ImageStudioBaseURL'
  | 'ImageStudioPromptPresets'
  | 'ImageStudioSizePresets'
>

type DrawingSettingsSectionProps = {
  defaultValues: DrawingFormValues
}

export function DrawingSettingsSection({
  defaultValues,
}: DrawingSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const drawingSchema = createDrawingSchema(t)
  const form = useForm<DrawingFormValues>({
    resolver: zodResolver(drawingSchema),
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (values: DrawingFormValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) => value !== defaultValues[key as keyof DrawingFormValues]
    )

    for (const [key, value] of updates) {
      await updateOption.mutateAsync({ key, value })
    }
  }

  const switches: Array<{
    name: DrawingSwitchName
    label: string
    description: string
  }> = [
    {
      name: 'DrawingEnabled',
      label: t('Enable drawing features'),
      description: t(
        'Required to expose MjProxy-style image generation to end users.'
      ),
    },
    {
      name: 'MjNotifyEnabled',
      label: t('Allow upstream callbacks'),
      description: t(
        'When enabled, MjProxy callbacks are accepted (reveals server IP).'
      ),
    },
    {
      name: 'MjAccountFilterEnabled',
      label: t('Allow accountFilter parameter'),
      description: t(
        'Keep enabled if you need to proxy requests for different upstream accounts.'
      ),
    },
    {
      name: 'MjForwardUrlEnabled',
      label: t('Rewrite callback URLs to the local server'),
      description: t(
        'Automatically replaces upstream callback URLs with the server address.'
      ),
    },
    {
      name: 'MjModeClearEnabled',
      label: t('Clear mode flags in prompts'),
      description: t(
        'Removes MjProxy flags such as --fast, --relax, and --turbo from user prompts.'
      ),
    },
    {
      name: 'MjActionCheckSuccessEnabled',
      label: t('Require job success before follow-up actions'),
      description: t(
        'Users must wait for a successful drawing before upscales or variations.'
      ),
    },
  ]

  return (
    <SettingsSection title={t('Drawing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save drawing settings'
          />
          <div className='space-y-4'>
            {switches.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{item.label}</FormLabel>
                      <FormDescription>{item.description}</FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </SettingsSwitchItem>
                )}
              />
            ))}
            <Separator />
            <div className='space-y-1'>
              <h3 className='text-sm font-medium'>{t('AI Studio')}</h3>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Configure AI Studio concurrency, timeouts, image retention, size presets, and prompt presets.'
                )}
              </p>
            </div>
            <FormField
              control={form.control}
              name='ImageStudioBatchConcurrency'
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('Batch concurrency')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={10}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Maximum number of images generated in parallel per batch (1-10).'
                    )}
                  </FormDescription>
                  <FormMessage>
                    {fieldState.error
                      ? t(
                          'Batch concurrency must be an integer between 1 and 10.'
                        )
                      : null}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ImageStudioTaskTimeoutMinutes'
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('Task timeout')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={120}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Maximum time an AI Studio task may run before it is failed and refunded (1-120 minutes).'
                    )}
                  </FormDescription>
                  <FormMessage>
                    {fieldState.error
                      ? t(
                          'Task timeout must be an integer between 1 and 120 minutes.'
                        )
                      : null}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ImageStudioRetentionDays'
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('Image retention')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={3650}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Days to keep newly generated images before local files are deleted (0 keeps them permanently).'
                    )}
                  </FormDescription>
                  <FormMessage>
                    {fieldState.error
                      ? t(
                          'Image retention must be an integer between 0 and 3650 days.'
                        )
                      : null}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ImageStudioBaseURL'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Image delivery Base URL')}</FormLabel>
                  <FormControl>
                    <Input
                      type='url'
                      inputMode='url'
                      autoComplete='off'
                      placeholder='https://img.example.com'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Optional HTTPS origin for cookie-free signed image URLs. Leave blank to use this site.'
                    )}{' '}
                    {t(
                      'The image domain must proxy /api/image-studio/assets/* to this server.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <FormField
              control={form.control}
              name='ImageStudioSizePresets'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Image size presets')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Configure the exact pixel dimensions available for each model, aspect ratio, and resolution level.'
                    )}
                  </FormDescription>
                  <FormControl>
                    <ImageStudioSizePresetEditor
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <FormField
              control={form.control}
              name='ImageStudioPromptPresets'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Prompt presets')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Create ready-to-use prompts that users can apply from the AI Studio creation console.'
                    )}
                  </FormDescription>
                  <FormControl>
                    <ImageStudioPromptPresetEditor
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
