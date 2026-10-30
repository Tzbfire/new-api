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
import { useId } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { sideDrawerSwitchItemClassName } from '@/components/drawer-layout'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { ChannelFormValues } from '../lib/channel-form'
import { parseHeaderOverrideObject } from '../lib/header-passthrough'

const minimumHeader = 'X-New-Api-Compression-Min-Bytes'
const encodingsSupported = new Set(['gzip', 'zstd', 'br'])

export function RequestCompressionSetting(props: { disabled?: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ChannelFormValues>()
  const id = useId()

  return (
    <FormField
      control={form.control}
      name='header_override'
      render={({ field }) => {
        const headers = parseHeaderOverrideObject(field.value)
        const encodings = Object.entries(headers ?? {}).filter(
          ([key]) => key.trim().toLowerCase() === 'content-encoding'
        )
        const values = encodings.map(([, value]) =>
          typeof value === 'string' ? value.trim().toLowerCase() : ''
        )
        const conflictingEncoding =
          values.some((value) => !encodingsSupported.has(value)) ||
          new Set(values).size > 1
        const enabled = values.length > 0 && !conflictingEncoding
        const encoding = values[0] || 'gzip'
        const minimum = Object.entries(headers ?? {}).find(
          ([key]) => key.trim().toLowerCase() === minimumHeader.toLowerCase()
        )?.[1]
        const bytes = Number(minimum ?? 65536)
        const validMinimum = Number.isSafeInteger(bytes) && bytes >= 0
        const minimumKiB = minimum === '' || !validMinimum ? '' : bytes / 1024
        const disabled =
          props.disabled || headers === null || conflictingEncoding
        let description = t(
          'Enable only if the upstream accepts the selected encoding. JSON requests at or above the minimum are compressed only when smaller.'
        )
        if (headers === null) description = t('Invalid JSON format')
        else if (conflictingEncoding) {
          description = t(
            'Remove unsupported or conflicting Content-Encoding overrides before enabling compression.'
          )
        } else if (!validMinimum) {
          description = t('Invalid request compression minimum')
        }

        function updateHeader(name: string, value: string | null) {
          if (!headers || disabled) return
          const next = Object.fromEntries(
            Object.entries(headers).filter(
              ([key]) => key.trim().toLowerCase() !== name.toLowerCase()
            )
          )
          if (value !== null) next[name] = value
          field.onChange(
            Object.keys(next).length ? JSON.stringify(next, null, 2) : ''
          )
        }

        return (
          <FieldGroup>
            <FormItem className={sideDrawerSwitchItemClassName()}>
              <div className='space-y-0.5'>
                <FormLabel>{t('Compress upstream JSON requests')}</FormLabel>
                <FormDescription>{description}</FormDescription>
              </div>
              {/* The JSON editor owns validation and error focus for this field. */}
              <FormControl aria-invalid={false}>
                <Switch
                  checked={enabled}
                  disabled={disabled}
                  onBlur={field.onBlur}
                  onCheckedChange={(checked) =>
                    updateHeader('Content-Encoding', checked ? 'gzip' : null)
                  }
                />
              </FormControl>
            </FormItem>
            {enabled && (
              <FieldGroup className='grid gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor={`${id}-encoding`}>
                    {t('Request compression algorithm')}
                  </FieldLabel>
                  <Select
                    value={encoding}
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (value && encodingsSupported.has(value)) {
                        updateHeader('Content-Encoding', value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id={`${id}-encoding`}
                      aria-label={t('Request compression algorithm')}
                      className='w-full'
                    >
                      <SelectValue>
                        {encoding === 'br' ? 'Brotli (br)' : encoding}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value='gzip'>gzip</SelectItem>
                        <SelectItem value='zstd'>zstd</SelectItem>
                        <SelectItem value='br'>Brotli (br)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-minimum`}>
                    {t('Minimum JSON size (KiB)')}
                  </FieldLabel>
                  <Input
                    id={`${id}-minimum`}
                    type='number'
                    min={0}
                    step='any'
                    value={minimumKiB}
                    disabled={disabled}
                    placeholder='64'
                    onBlur={() => {
                      field.onBlur()
                      if (minimum === '') updateHeader(minimumHeader, null)
                    }}
                    onChange={(event) => {
                      const value = event.target.value
                      const nextBytes = Number(value) * 1024
                      if (
                        value === '' ||
                        (Number.isSafeInteger(nextBytes) && nextBytes >= 0)
                      ) {
                        updateHeader(
                          minimumHeader,
                          value === '' ? '' : String(nextBytes)
                        )
                      }
                    }}
                  />
                  <FieldDescription>
                    {t('Default: 64 KiB. Set 0 to try all JSON request sizes.')}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            )}
          </FieldGroup>
        )
      }}
    />
  )
}
