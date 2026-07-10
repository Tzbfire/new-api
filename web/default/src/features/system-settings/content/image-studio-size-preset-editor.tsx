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
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { ImageStudioSizePreset } from '@/features/image-studio/types'

import {
  MAX_SIZE_EDGE,
  MAX_SIZE_PRESETS,
  parseImageStudioSizePresetJSON,
} from './image-studio-size-preset-config'

type ImageStudioSizePresetEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function ImageStudioSizePresetEditor(
  props: ImageStudioSizePresetEditorProps
) {
  const { t } = useTranslation()
  const presets = parseImageStudioSizePresetJSON(props.value)
  const commit = (next: ImageStudioSizePreset[]) =>
    props.onChange(JSON.stringify(next))
  const updatePreset = (
    index: number,
    patch: Partial<ImageStudioSizePreset>
  ) => {
    commit(
      presets.map((preset, presetIndex) =>
        presetIndex === index ? { ...preset, ...patch } : preset
      )
    )
  }

  return (
    <div className='space-y-4'>
      {presets.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('No size presets configured')}</EmptyTitle>
            <EmptyDescription>
              {t('Add size presets to expose aspect ratios and resolutions.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {presets.length > 0 ? (
        <Accordion className='rounded-lg border px-3'>
          {presets.map((preset, index) => (
            <AccordionItem key={preset.id} value={preset.id}>
              <AccordionTrigger className='hover:no-underline'>
                <span className='flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-3'>
                  <span className='font-medium'>
                    {preset.group_pattern} · {preset.model_pattern} ·{' '}
                    {preset.aspect_ratio} · {t(preset.tier_label)}
                  </span>
                  <span className='text-muted-foreground font-normal'>
                    {preset.width} × {preset.height}
                  </span>
                  <Badge variant={preset.enabled ? 'secondary' : 'outline'}>
                    {preset.enabled ? t('Enabled') : t('Disabled')}
                  </Badge>
                  {preset.experimental ? (
                    <Badge variant='outline'>{t('Experimental')}</Badge>
                  ) : null}
                </span>
              </AccordionTrigger>
              <AccordionContent className='pt-3'>
                <FieldGroup>
                  <div className='grid gap-3 md:grid-cols-2'>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-group-${preset.id}`}>
                        {t('Group pattern')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-group-${preset.id}`}
                        value={preset.group_pattern}
                        maxLength={128}
                        placeholder='*'
                        onChange={(event) =>
                          updatePreset(index, {
                            group_pattern: event.target.value,
                          })
                        }
                      />
                      <FieldDescription>
                        {t(
                          'Use * for all groups or one wildcard to match group names.'
                        )}
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-model-${preset.id}`}>
                        {t('Model pattern')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-model-${preset.id}`}
                        value={preset.model_pattern}
                        maxLength={128}
                        placeholder='gpt-image-2*'
                        onChange={(event) =>
                          updatePreset(index, {
                            model_pattern: event.target.value,
                          })
                        }
                      />
                      <FieldDescription>
                        {t(
                          'Use one optional * wildcard to match model aliases.'
                        )}
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-ratio-${preset.id}`}>
                        {t('Aspect ratio')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-ratio-${preset.id}`}
                        value={preset.aspect_ratio}
                        maxLength={32}
                        placeholder='16:9'
                        onChange={(event) =>
                          updatePreset(index, {
                            aspect_ratio: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-tier-${preset.id}`}>
                        {t('Resolution key')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-tier-${preset.id}`}
                        value={preset.tier}
                        maxLength={32}
                        placeholder='4k'
                        onChange={(event) =>
                          updatePreset(index, { tier: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-label-${preset.id}`}>
                        {t('Resolution name')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-label-${preset.id}`}
                        value={preset.tier_label}
                        maxLength={32}
                        placeholder={t('High definition')}
                        onChange={(event) =>
                          updatePreset(index, {
                            tier_label: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-width-${preset.id}`}>
                        {t('Width')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-width-${preset.id}`}
                        type='number'
                        min={64}
                        max={MAX_SIZE_EDGE}
                        step={1}
                        value={preset.width}
                        onChange={(event) =>
                          updatePreset(index, {
                            width: Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`studio-size-height-${preset.id}`}>
                        {t('Height')}
                      </FieldLabel>
                      <Input
                        id={`studio-size-height-${preset.id}`}
                        type='number'
                        min={64}
                        max={MAX_SIZE_EDGE}
                        step={1}
                        value={preset.height}
                        onChange={(event) =>
                          updatePreset(index, {
                            height: Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <Field orientation='horizontal'>
                      <FieldLabel htmlFor={`studio-size-enabled-${preset.id}`}>
                        {t('Enabled')}
                      </FieldLabel>
                      <Switch
                        id={`studio-size-enabled-${preset.id}`}
                        checked={preset.enabled}
                        onCheckedChange={(enabled) =>
                          updatePreset(index, { enabled })
                        }
                      />
                    </Field>
                    <Field orientation='horizontal'>
                      <FieldLabel
                        htmlFor={`studio-size-experimental-${preset.id}`}
                      >
                        {t('Experimental')}
                      </FieldLabel>
                      <Switch
                        id={`studio-size-experimental-${preset.id}`}
                        checked={preset.experimental}
                        onCheckedChange={(experimental) =>
                          updatePreset(index, { experimental })
                        }
                      />
                    </Field>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    className='w-fit'
                    onClick={() =>
                      commit(
                        presets.filter(
                          (_, presetIndex) => presetIndex !== index
                        )
                      )
                    }
                  >
                    <Trash2 aria-hidden='true' data-icon='inline-start' />
                    {t('Delete size preset')}
                  </Button>
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : null}
      <Button
        type='button'
        variant='outline'
        disabled={presets.length >= MAX_SIZE_PRESETS}
        onClick={() => {
          const suffix = `${Date.now()}-${presets.length + 1}`
          commit([
            ...presets,
            {
              id: `size-${suffix}`,
              group_pattern: '*',
              model_pattern: 'gpt-image-2*',
              aspect_ratio: '1:1',
              tier: `custom-${presets.length + 1}`,
              tier_label: t('Custom'),
              width: 1024,
              height: 1024,
              enabled: true,
              experimental: false,
            },
          ])
        }}
      >
        <Plus aria-hidden='true' data-icon='inline-start' />
        {t('Add size preset')}
      </Button>
    </div>
  )
}
