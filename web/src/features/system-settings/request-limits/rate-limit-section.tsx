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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'
import { getAllModels } from '@/features/channels/api'
import { getGroups } from '@/features/users/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { updateSystemOption } from '../api'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import {
  rateLimitOptionsFromRules,
  rateLimitRulesFromOptions,
  type RateLimitOptions,
} from './lib/rate-limit-rules'
import { RateLimitVisualEditor } from './rate-limit-visual-editor'

const createRateLimitSchema = (t: TFunction) =>
  z.object({
    enabled: z.boolean(),
    period: z
      .number({ error: t('Amount must be a whole number') })
      .int(t('Amount must be a whole number'))
      .min(
        1,
        t('Count must be between {{min}} and {{max}}', { min: 1, max: 1440 })
      )
      .max(
        1440,
        t('Count must be between {{min}} and {{max}}', { min: 1, max: 1440 })
      ),
    rules: z.array(
      z.object({
        group: z.string().nullable(),
        model: z.string().nullable(),
        maxRequests: z
          .number()
          .int(t('Amount must be a whole number'))
          .min(0, t('Must be ≥ 0')),
        maxSuccess: z
          .number()
          .int(t('Amount must be a whole number'))
          .min(0, t('Must be ≥ 0')),
      })
    ),
  })
type RateLimitFormValues = z.infer<ReturnType<typeof createRateLimitSchema>>
type RateLimitSectionProps = {
  defaultValues: RateLimitOptions & {
    ModelRequestRateLimitEnabled: boolean
    ModelRequestRateLimitDurationMinutes: number
  }
}

export function RateLimitSection(props: RateLimitSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: availableGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
    staleTime: 5 * 60 * 1000,
    meta: { errorToast: false },
  })
  const { data: availableModels } = useQuery({
    queryKey: ['channel_models'],
    queryFn: async () => requireServerSuccess(await getAllModels()),
    staleTime: 5 * 60 * 1000,
    meta: { errorToast: false },
  })
  const initial = useMemo(() => {
    try {
      return {
        rules: rateLimitRulesFromOptions(props.defaultValues),
        invalid: false,
      }
    } catch {
      return { rules: [], invalid: true }
    }
  }, [props.defaultValues])
  const form = useForm<RateLimitFormValues>({
    resolver: zodResolver(createRateLimitSchema(t)),
    defaultValues: {
      enabled: props.defaultValues.ModelRequestRateLimitEnabled,
      period: props.defaultValues.ModelRequestRateLimitDurationMinutes,
      rules: initial.rules,
    },
  })
  const update = useMutation({
    mutationFn: async (values: RateLimitFormValues) => {
      const serialized = rateLimitOptionsFromRules(
        values.rules,
        props.defaultValues
      )
      const settings = {
        ModelRequestRateLimitGroupModel:
          serialized.ModelRequestRateLimitGroupModel,
        ModelRequestRateLimitModel: serialized.ModelRequestRateLimitModel,
        ModelRequestRateLimitGroup: serialized.ModelRequestRateLimitGroup,
        ModelRequestRateLimitCount: serialized.ModelRequestRateLimitCount,
        ModelRequestRateLimitSuccessCount:
          serialized.ModelRequestRateLimitSuccessCount,
        ModelRequestRateLimitDurationMinutes: values.period,
        ModelRequestRateLimitEnabled: values.enabled,
      }
      const updates = Object.entries(settings).filter(
        ([key, value]) =>
          value !==
          props.defaultValues[
            key as keyof RateLimitSectionProps['defaultValues']
          ]
      )
      // Disable before changing rules; enable only after every rule is saved.
      if (!values.enabled) {
        updates.sort(
          ([left], [right]) =>
            Number(right === 'ModelRequestRateLimitEnabled') -
            Number(left === 'ModelRequestRateLimitEnabled')
        )
      }
      for (const [key, value] of updates) {
        requireServerSuccess(await updateSystemOption({ key, value }))
      }
    },
    onSuccess: (_, values) => {
      form.reset(values)
      toast.success(t('Setting updated successfully'))
      void queryClient.invalidateQueries({ queryKey: ['system-options'] })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to update setting'))
      void queryClient.invalidateQueries({ queryKey: ['system-options'] })
    },
  })
  const fingerprint = JSON.stringify(props.defaultValues)
  const seen = useRef(fingerprint)
  const dirty = form.formState.isDirty
  useEffect(() => {
    if (seen.current === fingerprint) return
    seen.current = fingerprint
    if (dirty || update.isPending) return
    form.reset({
      enabled: props.defaultValues.ModelRequestRateLimitEnabled,
      period: props.defaultValues.ModelRequestRateLimitDurationMinutes,
      rules: initial.rules,
    })
  }, [
    fingerprint,
    dirty,
    update.isPending,
    form,
    props.defaultValues,
    initial.rules,
  ])

  const onSubmit = (values: RateLimitFormValues) => {
    if (!initial.invalid) update.mutate(values)
  }
  return (
    <SettingsSection title={t('Rate Limiting')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={update.isPending}
            isSaveDisabled={initial.invalid}
            saveLabel='Save rate limits'
          />
          {initial.invalid && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'The saved rate limit configuration is invalid. It has been preserved; correct it before editing rules.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {update.isError && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Some settings may have been saved. Your changes are kept; save again to finish.'
                )}
              </AlertDescription>
            </Alert>
          )}
          <fieldset
            disabled={initial.invalid || update.isPending}
            className='space-y-6'
          >
            <div className='grid gap-6 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Enable rate limiting')}</FormLabel>
                      <FormDescription>
                        {t('Limits apply separately to each user.')}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={initial.invalid || update.isPending}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
              <FormField
                control={form.control}
                name='period'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Limit period')}</FormLabel>
                    <div className='flex items-center gap-2'>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          max={1440}
                          step={1}
                          {...field}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                      </FormControl>
                      <span className='text-muted-foreground text-sm'>
                        {t('minutes')}
                      </span>
                    </div>
                    <FormDescription>
                      {t('All rules use this period.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='rules'
              render={({ field }) => (
                <FormItem>
                  <p className='text-sm font-medium'>{t('Rate limit rules')}</p>
                  <FormDescription>
                    {t(
                      'Choose groups and models in one rule. More specific rules override broader rules.'
                    )}
                  </FormDescription>
                  <RateLimitVisualEditor
                    rules={field.value}
                    onChange={field.onChange}
                    groupNames={availableGroups?.data ?? []}
                    modelNames={
                      availableModels?.data?.map((model) => model.id) ?? []
                    }
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
