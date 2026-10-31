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
import { useEffect, useId } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
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

import {
  getRateLimitRuleKey,
  type RateLimitRule,
  type RateLimitSelection,
} from './lib/rate-limit-rules'

type RateLimitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (selection: RateLimitSelection) => void
  editData?: RateLimitRule | null
  existingRules: RateLimitRule[]
  groupNames?: string[]
  modelNames?: string[]
}

export function RateLimitDialog(props: RateLimitDialogProps) {
  const { t } = useTranslation()
  const formId = useId()
  const isEditMode = Boolean(props.editData)
  const isGlobalEdit = Boolean(
    props.editData &&
    props.editData.group === null &&
    props.editData.model === null
  )
  const schema = z
    .object({
      allGroups: z.boolean(),
      allModels: z.boolean(),
      groups: z.array(z.string().trim().min(1, t('Name is required'))),
      models: z.array(z.string().trim().min(1, t('Name is required'))),
      unlimited: z.boolean(),
      maxRequests: z
        .number({ error: t('Amount must be a whole number') })
        .int(t('Amount must be a whole number'))
        .min(0, t('Must be ≥ 0'))
        .max(2147483647, t('Must be ≤ 2,147,483,647')),
      maxSuccess: z
        .number({ error: t('Amount must be a whole number') })
        .int(t('Amount must be a whole number'))
        .min(0, t('Must be ≥ 0'))
        .max(2147483647, t('Must be ≤ 2,147,483,647')),
    })
    .superRefine((values, ctx) => {
      if (!values.allGroups && values.groups.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups'],
          message: t('Select at least one group or enable All groups.'),
        })
      }
      if (!values.allModels && values.models.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['models'],
          message: t('Select at least one model or enable All models.'),
        })
      }
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
      const editKey = props.editData
        ? getRateLimitRuleKey(props.editData)
        : null
      const existingKeys = new Set(
        props.existingRules
          .filter((rule) => getRateLimitRuleKey(rule) !== editKey)
          .map(getRateLimitRuleKey)
      )
      const groups = values.allGroups ? [null] : values.groups
      const models = values.allModels ? [null] : values.models
      for (const group of groups) {
        for (const model of models) {
          if (existingKeys.has(getRateLimitRuleKey({ group, model }))) {
            ctx.addIssue({
              code: 'custom',
              path: ['models'],
              message: t('Rule already exists for this group and model.'),
            })
            return
          }
        }
      }
    })
  type FormValues = z.infer<typeof schema>
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      allGroups: false,
      allModels: false,
      groups: [],
      models: [],
      unlimited: false,
      maxRequests: 0,
      maxSuccess: 1,
    },
  })
  const allGroups = form.watch('allGroups')
  const allModels = form.watch('allModels')
  const unlimited = form.watch('unlimited')

  useEffect(() => {
    const entry = props.editData
    form.reset({
      allGroups: entry?.group === null,
      allModels: entry?.model === null,
      groups: entry?.group == null ? [] : [entry.group],
      models: entry?.model == null ? [] : [entry.model],
      unlimited: entry?.maxRequests === 0 && entry.maxSuccess === 0,
      maxRequests: entry?.maxRequests ?? 0,
      maxSuccess: entry?.maxSuccess ?? 1,
    })
  }, [props.editData, props.open, form])

  const groupOptions = [
    ...new Set([
      ...(props.groupNames ?? []),
      ...props.existingRules.flatMap((rule) =>
        rule.group === null ? [] : [rule.group]
      ),
    ]),
  ].map((value) => ({ value, label: value }))
  const modelOptions = [
    ...new Set([
      ...(props.modelNames ?? []),
      ...props.existingRules.flatMap((rule) =>
        rule.model === null ? [] : [rule.model]
      ),
    ]),
  ].map((value) => ({ value, label: value }))

  const handleSubmit = (values: FormValues) => {
    props.onSave({
      groups: values.allGroups || isGlobalEdit ? [] : values.groups,
      models: values.allModels || isGlobalEdit ? [] : values.models,
      maxRequests: values.unlimited ? 0 : values.maxRequests,
      maxSuccess: values.unlimited ? 0 : values.maxSuccess,
    })
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={isEditMode ? t('Edit rate limit rule') : t('Add rate limit rule')}
      description={t(
        'Selected groups and models create a separate rule for every combination.'
      )}
      contentClassName='sm:max-w-[560px]'
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
          <Button type='submit' form={formId}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={formId}
          onSubmit={(event) => {
            event.stopPropagation()
            void form.handleSubmit(handleSubmit)(event)
          }}
          className='space-y-4'
        >
          <div className='space-y-2'>
            <FormField
              control={form.control}
              name='allGroups'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4'>
                  <FormLabel>{t('All groups')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isGlobalEdit}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='groups'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Groups')}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={groupOptions}
                      selected={field.value}
                      onChange={field.onChange}
                      allowCreate
                      maxVisibleChips={5}
                      placeholder={t('Select groups')}
                      disabled={allGroups || isGlobalEdit}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className='space-y-2'>
            <FormField
              control={form.control}
              name='allModels'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4'>
                  <FormLabel>{t('All models')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isGlobalEdit}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='models'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Models')}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={modelOptions}
                      selected={field.value}
                      onChange={field.onChange}
                      allowCreate
                      maxVisibleChips={5}
                      placeholder={t('Select models')}
                      disabled={allModels || isGlobalEdit}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {isGlobalEdit && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'The global rule always applies to all groups and all models.'
              )}
            </p>
          )}
          <FormField
            control={form.control}
            name='unlimited'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-4'>
                <div>
                  <FormLabel>{t('Unlimited')}</FormLabel>
                  <FormDescription>
                    {t('An unlimited rule overrides less specific limits.')}
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
                  {t('Only successful requests count toward this limit.')}{' '}
                  {t('0 = unlimited')}
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
