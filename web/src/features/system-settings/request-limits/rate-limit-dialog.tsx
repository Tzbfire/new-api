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

const rateLimitDialogSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  maxRequests: z
    .number()
    .min(0, 'Must be ≥ 0')
    .max(2147483647, 'Must be ≤ 2,147,483,647'),
  maxSuccess: z
    .number()
    .min(1, 'Must be ≥ 1')
    .max(2147483647, 'Must be ≤ 2,147,483,647'),
})

type RateLimitDialogFormValues = z.infer<typeof rateLimitDialogSchema>

const RATE_LIMIT_FORM_ID = 'rate-limit-form'

export type RateLimitEntryData = {
  name: string
  maxRequests: number
  maxSuccess: number
}

export type RateLimitEntity = 'group' | 'model'

type RateLimitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: RateLimitEntryData) => void
  editData?: RateLimitEntryData | null
  entity?: RateLimitEntity
}

export function RateLimitDialog({
  open,
  onOpenChange,
  onSave,
  editData,
  entity = 'group',
}: RateLimitDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editData
  const isModel = entity === 'model'
  let dialogTitle: string
  if (isModel) {
    dialogTitle = isEditMode
      ? t('Edit model rate limit')
      : t('Add model rate limit')
  } else {
    dialogTitle = isEditMode
      ? t('Edit group rate limit')
      : t('Add group rate limit')
  }
  const dialogDescription = isModel
    ? t('Configure model request limits for each user.')
    : t('Configure rate limiting rules for a specific user group.')
  const nameLabel = t(isModel ? 'Model Name' : 'Group Name')
  const namePlaceholder = t(
    isModel ? 'e.g., gpt-4, claude-3' : 'e.g., default, vip, premium'
  )
  let nameDescription: string
  if (isEditMode) {
    nameDescription = isModel
      ? t('Model name cannot be changed when editing.')
      : t('Group name cannot be changed when editing.')
  } else {
    nameDescription = isModel
      ? t('Unique model name for this rule.')
      : t('Unique identifier for this group.')
  }

  const form = useForm<RateLimitDialogFormValues>({
    resolver: zodResolver(rateLimitDialogSchema),
    defaultValues: {
      name: '',
      maxRequests: 0,
      maxSuccess: 1,
    },
  })

  useEffect(() => {
    if (editData) {
      form.reset(editData)
    } else {
      form.reset({
        name: '',
        maxRequests: 0,
        maxSuccess: 1,
      })
    }
  }, [editData, form, open])

  const handleSubmit = (values: RateLimitDialogFormValues) => {
    onSave(values)
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={dialogTitle}
      description={dialogDescription}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
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
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{nameLabel}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={namePlaceholder}
                    {...field}
                    disabled={isEditMode}
                  />
                </FormControl>
                <FormDescription>{nameDescription}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='maxRequests'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Requests (including failures)')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={0}
                      max={2147483647}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value) || 0)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
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
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={1}
                      max={2147483647}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value) || 1)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
                <FormDescription>
                  {t('Only successful requests count toward this limit.')}
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
