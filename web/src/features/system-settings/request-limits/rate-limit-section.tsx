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
import { useQuery } from '@tanstack/react-query'
import { Code2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { JsonCodeEditor } from '@/components/json-code-editor'
import { Button } from '@/components/ui/button'
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
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeJsonParseWithValidation } from '../utils/json-parser'
import { isObjectRecord } from '../utils/json-validators'
import { RateLimitVisualEditor } from './rate-limit-visual-editor'

const isValidJSON = (value: string | undefined, groupModel = false) => {
  if (!value || value.trim() === '') return true
  try {
    const parsed = JSON.parse(value)
    if (!isObjectRecord(parsed)) {
      return false
    }
    for (const [name, val] of Object.entries(parsed)) {
      if (!name.trim()) return false
      if (groupModel) {
        if (name !== name.trim()) return false
        if (!isObjectRecord(val)) return false
        for (const [model, limits] of Object.entries(val)) {
          if (
            !model.trim() ||
            model !== model.trim() ||
            !Array.isArray(limits) ||
            limits.length !== 2
          ) {
            return false
          }
          if (
            !limits.every(
              (count) =>
                Number.isInteger(count) && count >= 0 && count <= 2147483647
            )
          ) {
            return false
          }
        }
      } else {
        if (!Array.isArray(val) || val.length !== 2) return false
        if (!val.every(Number.isInteger)) return false
        if (val[0] < 0 || val[1] < 1) return false
        if (val[0] > 2147483647 || val[1] > 2147483647) return false
      }
    }
    return true
  } catch {
    return false
  }
}

const createRateLimitSchema = (t: (key: string) => string) =>
  z.object({
    ModelRequestRateLimitEnabled: z.boolean(),
    ModelRequestRateLimitDurationMinutes: z.number().min(0),
    ModelRequestRateLimitCount: z.number().min(0).max(100000000),
    ModelRequestRateLimitSuccessCount: z.number().min(1).max(100000000),
    ModelRequestRateLimitGroup: z
      .string()
      .optional()
      .refine((value) => isValidJSON(value), {
        message: t('Invalid JSON format or values out of allowed range'),
      }),
    ModelRequestRateLimitModel: z
      .string()
      .optional()
      .refine((value) => isValidJSON(value), {
        message: t('Invalid JSON format or values out of allowed range'),
      }),
    ModelRequestRateLimitGroupModel: z
      .string()
      .optional()
      .refine((value) => isValidJSON(value, true), {
        message: t('Invalid JSON format or values out of allowed range'),
      }),
  })

type RateLimitFormValues = z.infer<ReturnType<typeof createRateLimitSchema>>

type RateLimitSectionProps = {
  defaultValues: RateLimitFormValues
}

export function RateLimitSection({ defaultValues }: RateLimitSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
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
  const [useVisualEditor, setUseVisualEditor] = useState(true)
  const [useModelVisualEditor, setUseModelVisualEditor] = useState(true)
  const [useGroupModelVisualEditor, setUseGroupModelVisualEditor] =
    useState(true)

  const rateLimitSchema = createRateLimitSchema(t)

  const form = useForm<RateLimitFormValues>({
    resolver: zodResolver(rateLimitSchema),
    mode: 'onChange', // Enable real-time validation
    defaultValues,
  })
  const groupRules = safeJsonParseWithValidation<Record<string, unknown>>(
    form.watch('ModelRequestRateLimitGroup'),
    { fallback: {}, validator: isObjectRecord, silent: true }
  )
  const modelRules = safeJsonParseWithValidation<Record<string, unknown>>(
    form.watch('ModelRequestRateLimitModel'),
    { fallback: {}, validator: isObjectRecord, silent: true }
  )

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (values: RateLimitFormValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) =>
        value !== defaultValues[key as keyof RateLimitFormValues]
    )

    for (const [key, value] of updates) {
      const nextValue =
        key === 'ModelRequestRateLimitGroupModel' && !value?.toString().trim()
          ? '{}'
          : (value ?? '')
      await updateOption.mutateAsync({ key, value: nextValue })
    }
  }

  return (
    <SettingsSection title={t('Rate Limiting')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save rate limits'
          />

          <p className='text-muted-foreground text-sm'>
            {t(
              'Rule priority: group + model > model > group > global. All rules use the same period.'
            )}
          </p>
          <FormField
            control={form.control}
            name='ModelRequestRateLimitEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable rate limiting')}</FormLabel>
                  <FormDescription>
                    {t(
                      'This controls model request rate limiting. Web/API route throttling is configured by environment variables and may still return 429.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='grid gap-4 md:grid-cols-3'>
            <FormField
              control={form.control}
              name='ModelRequestRateLimitDurationMinutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Limit period')}</FormLabel>
                  <div className='flex items-center gap-2'>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <span className='text-muted-foreground text-sm'>
                      {t('minutes')}
                    </span>
                  </div>
                  <FormDescription>
                    {t('Time window for rate limiting')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ModelRequestRateLimitCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max requests per period')}</FormLabel>
                  <div className='flex items-center gap-2'>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        max={100000000}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                  <FormDescription>
                    {t('Including failed requests, 0 = unlimited')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ModelRequestRateLimitSuccessCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max successful requests')}</FormLabel>
                  <div className='flex items-center gap-2'>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        max={100000000}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 1)
                        }
                      />
                    </FormControl>
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                  <FormDescription>
                    {t('Only successful requests')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='ModelRequestRateLimitGroupModel'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between gap-4'>
                  <FormLabel>{t('Group and model rate limits')}</FormLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() =>
                      setUseGroupModelVisualEditor(!useGroupModelVisualEditor)
                    }
                  >
                    {useGroupModelVisualEditor ? (
                      <>
                        <Code2 className='mr-2 h-4 w-4' />
                        {t('JSON Mode')}
                      </>
                    ) : (
                      <>
                        <Palette className='mr-2 h-4 w-4' />
                        {t('Visual Mode')}
                      </>
                    )}
                  </Button>
                </div>
                <FormDescription>
                  {t(
                    'Rules are counted separately for each user, group, and model.'
                  )}{' '}
                  {t(
                    'An unlimited group-model rule overrides model, group, and global limits.'
                  )}
                </FormDescription>
                <FormControl>
                  {useGroupModelVisualEditor ? (
                    <RateLimitVisualEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      entity='group-model'
                      groupNames={[
                        ...(availableGroups?.data ?? []),
                        ...Object.keys(groupRules),
                      ]}
                      modelNames={[
                        ...(availableModels?.data?.map((model) => model.id) ??
                          []),
                        ...Object.keys(modelRules),
                      ]}
                    />
                  ) : (
                    <JsonCodeEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      textareaRef={field.ref}
                      ariaLabel={t('Group and model rate limits')}
                      placeholder={`{\n  "default": {"gpt-6-luna": [3000, 2000]},\n  "Luna-Pro": {"gpt-6-luna": [0, 0]}\n}`}
                      aria-invalid={Boolean(
                        form.formState.errors.ModelRequestRateLimitGroupModel
                      )}
                    />
                  )}
                </FormControl>
                {!useGroupModelVisualEditor && (
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Use [0, 0] for unlimited requests. Other values must be integers from 0 to 2,147,483,647.'
                    )}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ModelRequestRateLimitGroup'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between'>
                  <FormLabel>{t('Group-based rate limits')}</FormLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setUseVisualEditor(!useVisualEditor)}
                  >
                    {useVisualEditor ? (
                      <>
                        <Code2 className='mr-2 h-4 w-4' />
                        {t('JSON Mode')}
                      </>
                    ) : (
                      <>
                        <Palette className='mr-2 h-4 w-4' />
                        {t('Visual Mode')}
                      </>
                    )}
                  </Button>
                </div>
                <FormControl>
                  {useVisualEditor ? (
                    <RateLimitVisualEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                    />
                  ) : (
                    <JsonCodeEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      textareaRef={field.ref}
                      placeholder={`{\n  "default": [200, 100],\n  "vip": [0, 1000]\n}`}
                      aria-invalid={Boolean(
                        form.formState.errors.ModelRequestRateLimitGroup
                      )}
                    />
                  )}
                </FormControl>
                {!useVisualEditor && (
                  <FormDescription>
                    <div className='space-y-1 text-xs'>
                      <p className='font-semibold'>{t('Format:')}</p>
                      <ul className='list-inside list-disc space-y-0.5 pl-2'>
                        <li>
                          {t('JSON object:')}{' '}
                          {`{"groupName": [maxRequests, maxSuccess]}`}
                        </li>
                        <li>
                          {t('Example:')}{' '}
                          {`{"default": [200, 100], "vip": [0, 1000]}`}
                        </li>
                        <li>
                          {t(
                            'maxRequests ≥ 0, maxSuccess ≥ 1, both ≤ 2,147,483,647'
                          )}
                        </li>
                        <li>
                          {t(
                            'Group config overrides global limits, shares the same period'
                          )}
                        </li>
                      </ul>
                    </div>
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ModelRequestRateLimitModel'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between'>
                  <FormLabel>{t('Model-specific rate limits')}</FormLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() =>
                      setUseModelVisualEditor(!useModelVisualEditor)
                    }
                  >
                    {useModelVisualEditor ? (
                      <>
                        <Code2 className='mr-2 h-4 w-4' />
                        {t('JSON Mode')}
                      </>
                    ) : (
                      <>
                        <Palette className='mr-2 h-4 w-4' />
                        {t('Visual Mode')}
                      </>
                    )}
                  </Button>
                </div>
                <FormControl>
                  {useModelVisualEditor ? (
                    <RateLimitVisualEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      entity='model'
                    />
                  ) : (
                    <JsonCodeEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      textareaRef={field.ref}
                      ariaLabel={t('Model-specific rate limits')}
                      placeholder={`{
  "gpt-6-luna": [60, 60]
}`}
                      aria-invalid={Boolean(
                        form.formState.errors.ModelRequestRateLimitModel
                      )}
                    />
                  )}
                </FormControl>
                {!useModelVisualEditor && (
                  <FormDescription>
                    <div className='space-y-1 text-xs'>
                      <p>
                        {t('Configure per-user limits for selected models.')}
                      </p>
                      <p>
                        {t(
                          'Model rules override group and global limits and use the same period.'
                        )}
                      </p>
                      <p className='font-semibold'>{t('Format:')}</p>
                      <ul className='list-inside list-disc space-y-0.5 pl-2'>
                        <li>
                          {t('JSON object:')}{' '}
                          {`{"model-name": [maxRequests, maxSuccess]}`}
                        </li>
                        <li>
                          {t('Example:')} {`{"gpt-6-luna": [60, 60]}`}
                        </li>
                        <li>
                          {t(
                            'Rules are counted separately for each user and model.'
                          )}
                        </li>
                        <li>
                          {t(
                            'maxRequests ≥ 0, maxSuccess ≥ 1, both ≤ 2,147,483,647'
                          )}
                        </li>
                      </ul>
                    </div>
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
