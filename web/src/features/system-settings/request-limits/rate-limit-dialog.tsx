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

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
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

const RATE_LIMIT_FORM_ID = 'rate-limit-form'

export type RateLimitEntryData = {
  name: string
  groupName?: string
  maxRequests: number
  maxSuccess: number
}

export type RateLimitEntity = 'group' | 'model' | 'group-model'

type RateLimitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: RateLimitEntryData) => void
  editData?: RateLimitEntryData | null
  entity?: RateLimitEntity
  groupNames?: string[]
  modelNames?: string[]
  existingEntries?: RateLimitEntryData[]
}

export function RateLimitDialog(props: RateLimitDialogProps) {
  const { t } = useTranslation()
  const entity = props.entity ?? 'group'
  const isGroupModel = entity === 'group-model'
  const isModel = entity === 'model' || isGroupModel
  const isEditMode = Boolean(props.editData)
  const schema = z
    .object({
      name: z.string().trim().min(1, t('Name is required')),
      groupName: z.string().trim(),
      unlimited: z.boolean(),
      maxRequests: z
        .number({ error: t('Amount must be a whole number') })
        .int(t('Amount must be a whole number'))
        .min(0, t('Must be ≥ 0'))
        .max(2147483647, t('Must be ≤ 2,147,483,647')),
      maxSuccess: z
        .number({ error: t('Amount must be a whole number') })
        .int(t('Amount must be a whole number'))
        .min(
          isGroupModel ? 0 : 1,
          isGroupModel ? t('Must be ≥ 0') : t('Must be ≥ 1')
        )
        .max(2147483647, t('Must be ≤ 2,147,483,647')),
    })
    .superRefine((values, ctx) => {
      if (!isGroupModel) return
      if (
        !values.unlimited &&
        values.maxRequests === 0 &&
        values.maxSuccess === 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['maxSuccess'],
          message: t('Must be ≥ 1'),
        })
      }
      if (!values.groupName) {
        ctx.addIssue({
          code: 'custom',
          path: ['groupName'],
          message: t('Name is required'),
        })
      }
      if (
        !isEditMode &&
        props.existingEntries?.some(
          (entry) =>
            entry.groupName === values.groupName && entry.name === values.name
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message: t('Rule already exists for this group and model.'),
        })
      }
    })
  type FormValues = z.infer<typeof schema>
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      groupName: '',
      unlimited: false,
      maxRequests: 0,
      maxSuccess: 1,
    },
  })
  const unlimited = isGroupModel && form.watch('unlimited')

  useEffect(() => {
    const entry = props.editData
    form.reset({
      name: entry?.name ?? '',
      groupName: entry?.groupName ?? '',
      unlimited:
        isGroupModel && entry?.maxRequests === 0 && entry.maxSuccess === 0,
      maxRequests: entry?.maxRequests ?? 0,
      maxSuccess: entry?.maxSuccess ?? 1,
    })
  }, [props.editData, props.open, isGroupModel, form])

  let title: string
  let description: string
  if (isGroupModel) {
    title = isEditMode
      ? t('Edit group-model rate limit')
      : t('Add group-model rate limit')
    description = t('Configure per-user model limits within a specific group.')
  } else if (isModel) {
    title = isEditMode ? t('Edit model rate limit') : t('Add model rate limit')
    description = t('Configure model request limits for each user.')
  } else {
    title = isEditMode ? t('Edit group rate limit') : t('Add group rate limit')
    description = t('Configure rate limiting rules for a specific user group.')
  }
  let nameDescription: string
  if (isGroupModel) {
    nameDescription = isEditMode
      ? t('Group and model names cannot be changed when editing.')
      : t('Unique model name within this group.')
  } else if (isEditMode) {
    nameDescription = isModel
      ? t('Model name cannot be changed when editing.')
      : t('Group name cannot be changed when editing.')
  } else {
    nameDescription = isModel
      ? t('Unique model name for this rule.')
      : t('Unique identifier for this group.')
  }

  const handleSubmit = (values: FormValues) => {
    props.onSave({
      name: values.name,
      ...(isGroupModel ? { groupName: values.groupName } : {}),
      maxRequests: unlimited ? 0 : values.maxRequests,
      maxSuccess: unlimited ? 0 : values.maxSuccess,
    })
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      description={description}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={RATE_LIMIT_FORM_ID}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={RATE_LIMIT_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          {isGroupModel && (
            <FormField
              control={form.control}
              name='groupName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Group Name')}</FormLabel>
                  <FormControl>
                    <ComboboxInput
                      options={(props.groupNames ?? []).map((value) => ({
                        value,
                        label: value,
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                      allowCustomValue
                      disabled={isEditMode}
                      placeholder={t('e.g., default, vip, premium')}
                      aria-label={t('Group Name')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t(isModel ? 'Model Name' : 'Group Name')}
                </FormLabel>
                <FormControl>
                  {isGroupModel ? (
                    <ComboboxInput
                      options={(props.modelNames ?? []).map((value) => ({
                        value,
                        label: value,
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                      allowCustomValue
                      disabled={isEditMode}
                      placeholder={t('e.g., gpt-4, claude-3')}
                      aria-label={t('Model Name')}
                    />
                  ) : (
                    <Input
                      placeholder={t(
                        isModel
                          ? 'e.g., gpt-4, claude-3'
                          : 'e.g., default, vip, premium'
                      )}
                      {...field}
                      disabled={isEditMode}
                    />
                  )}
                </FormControl>
                <FormDescription>{nameDescription}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {isGroupModel && (
            <FormField
              control={form.control}
              name='unlimited'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4'>
                  <div>
                    <FormLabel>{t('Unlimited')}</FormLabel>
                    <FormDescription>
                      {t(
                        'An unlimited group-model rule overrides model, group, and global limits.'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked)
                        if (checked) {
                          form.setValue('maxRequests', 0)
                          form.setValue('maxSuccess', 0)
                        } else if (
                          form.getValues('maxRequests') === 0 &&
                          form.getValues('maxSuccess') === 0
                        ) {
                          form.setValue('maxSuccess', 1)
                        }
                      }}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name='maxRequests'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Requests (including failures)')}</FormLabel>
                <div className='flex items-center gap-2'>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={2147483647}
                      step={1}
                      {...field}
                      disabled={unlimited}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <span className='text-muted-foreground text-sm'>
                    {t('times')}
                  </span>
                </div>
                <FormDescription>
                  {t('Total requests allowed per period. 0 = unlimited.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='maxSuccess'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Successful Requests')}</FormLabel>
                <div className='flex items-center gap-2'>
                  <FormControl>
                    <Input
                      type='number'
                      min={isGroupModel ? 0 : 1}
                      max={2147483647}
                      step={1}
                      {...field}
                      disabled={unlimited}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <span className='text-muted-foreground text-sm'>
                    {t('times')}
                  </span>
                </div>
                <FormDescription>
                  {t('Only successful requests count toward this limit.')}
                  {isGroupModel && <> {t('0 = unlimited')}</>}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
