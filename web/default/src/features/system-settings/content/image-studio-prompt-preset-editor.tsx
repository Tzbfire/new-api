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

import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type ImageStudioPromptPreset = {
  id: string
  title: string
  prompt: string
}

function parseImageStudioPromptPresetJSON(
  value: string
): ImageStudioPromptPreset[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ImageStudioPromptPreset =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ImageStudioPromptPreset).id === 'string' &&
        typeof (item as ImageStudioPromptPreset).title === 'string' &&
        typeof (item as ImageStudioPromptPreset).prompt === 'string'
    )
  } catch {
    return []
  }
}

type ImageStudioPromptPresetEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function ImageStudioPromptPresetEditor(
  props: ImageStudioPromptPresetEditorProps
) {
  const { t } = useTranslation()
  const presets = parseImageStudioPromptPresetJSON(props.value)
  const commit = (next: ImageStudioPromptPreset[]) =>
    props.onChange(JSON.stringify(next))
  const updatePreset = (
    index: number,
    patch: Partial<ImageStudioPromptPreset>
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
            <EmptyTitle>{t('No prompt presets configured')}</EmptyTitle>
            <EmptyDescription>
              {t('Add presets that users can apply in AI Studio.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {presets.map((preset, index) => (
        <Card key={preset.id} size='sm'>
          <CardHeader>
            <CardTitle>
              {t('Prompt preset {{index}}', { index: index + 1 })}
            </CardTitle>
            <CardAction>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t('Delete prompt preset')}
                title={t('Delete prompt preset')}
                onClick={() =>
                  commit(
                    presets.filter((_, presetIndex) => presetIndex !== index)
                  )
                }
              >
                <Trash2 aria-hidden='true' />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`image-studio-preset-title-${preset.id}`}>
                  {t('Preset name')}
                </FieldLabel>
                <Input
                  id={`image-studio-preset-title-${preset.id}`}
                  value={preset.title}
                  maxLength={60}
                  onChange={(event) =>
                    updatePreset(index, { title: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`image-studio-preset-prompt-${preset.id}`}>
                  {t('Prompt content')}
                </FieldLabel>
                <Textarea
                  id={`image-studio-preset-prompt-${preset.id}`}
                  rows={5}
                  value={preset.prompt}
                  maxLength={4000}
                  onChange={(event) =>
                    updatePreset(index, { prompt: event.target.value })
                  }
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
      <Button
        type='button'
        variant='outline'
        disabled={presets.length >= 12}
        onClick={() => {
          const id = `preset-${Date.now()}-${presets.length + 1}`
          commit([...presets, { id, title: '', prompt: '' }])
        }}
      >
        <Plus aria-hidden='true' data-icon='inline-start' />
        {t('Add prompt preset')}
      </Button>
    </div>
  )
}
