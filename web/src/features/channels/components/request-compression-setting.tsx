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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { sideDrawerSwitchItemClassName } from '@/components/drawer-layout'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import type { ChannelFormValues } from '../lib/channel-form'
import { parseHeaderOverrideObject } from '../lib/header-passthrough'

export function RequestCompressionSetting(props: { disabled?: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ChannelFormValues>()

  return (
    <FormField
      control={form.control}
      name='header_override'
      render={({ field }) => {
        const headers = parseHeaderOverrideObject(field.value)
        const encodings = Object.entries(headers ?? {}).filter(
          ([key]) => key.trim().toLowerCase() === 'content-encoding'
        )
        const gzipEnabled = encodings.some(
          ([, value]) =>
            typeof value === 'string' && value.trim().toLowerCase() === 'gzip'
        )
        const conflictingEncoding = encodings.some(
          ([, value]) =>
            typeof value !== 'string' || value.trim().toLowerCase() !== 'gzip'
        )
        let description = t(
          'Enable only if the upstream accepts gzip-compressed requests. Large JSON requests are compressed when smaller.'
        )
        if (headers === null) description = t('Invalid JSON format')
        else if (conflictingEncoding) {
          description = t(
            'Remove the existing Content-Encoding override before enabling gzip.'
          )
        }

        return (
          <FormItem className={sideDrawerSwitchItemClassName()}>
            <div className='space-y-0.5'>
              <FormLabel>
                {t('Compress upstream JSON requests (gzip)')}
              </FormLabel>
              <FormDescription>{description}</FormDescription>
            </div>
            {/* The JSON editor owns validation and error focus for this field. */}
            <FormControl aria-invalid={false}>
              <Switch
                checked={gzipEnabled}
                disabled={
                  props.disabled || headers === null || conflictingEncoding
                }
                onBlur={field.onBlur}
                onCheckedChange={(enabled) => {
                  if (!headers || conflictingEncoding || props.disabled) return
                  const next = Object.fromEntries(
                    Object.entries(headers).filter(
                      ([key]) => key.trim().toLowerCase() !== 'content-encoding'
                    )
                  )
                  if (enabled) next['Content-Encoding'] = 'gzip'
                  field.onChange(
                    Object.keys(next).length
                      ? JSON.stringify(next, null, 2)
                      : ''
                  )
                }}
              />
            </FormControl>
          </FormItem>
        )
      }}
    />
  )
}
