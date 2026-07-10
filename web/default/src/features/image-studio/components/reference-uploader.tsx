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
import { Cancel01Icon, ImageUpload01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ReferenceUploaderProps = {
  files: File[]
  disabled?: boolean
  onChange: (files: File[]) => void
  onAddFiles: (files: File[]) => void
}

function ReferencePreview(props: {
  file: File
  index: number
  disabled?: boolean
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    const objectURL = URL.createObjectURL(props.file)
    setSource(objectURL)
    return () => URL.revokeObjectURL(objectURL)
  }, [props.file])

  return (
    <div className='group relative aspect-square overflow-hidden rounded-lg border'>
      {source ? (
        <img
          src={source}
          alt={t('Reference image {{index}}', { index: props.index + 1 })}
          className='size-full object-cover'
        />
      ) : null}
      <Button
        type='button'
        variant='secondary'
        size='icon-sm'
        className='absolute top-1 right-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100'
        disabled={props.disabled}
        aria-label={t('Remove reference image')}
        title={t('Remove reference image')}
        onClick={() => props.onRemove(props.index)}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

export function ReferenceUploader(props: ReferenceUploaderProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileKeys = useRef(new WeakMap<File, string>())
  const nextFileKey = useRef(0)

  const addFiles = (incoming: File[]) => {
    props.onAddFiles(incoming)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className='flex flex-col gap-3'>
      <button
        type='button'
        disabled={props.disabled}
        className={cn(
          'text-muted-foreground hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-center text-sm outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50',
          isDragging && 'bg-muted border-foreground/40'
        )}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDragging(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          addFiles([...event.dataTransfer.files])
        }}
      >
        <HugeiconsIcon icon={ImageUpload01Icon} strokeWidth={1.8} />
        <span className='text-foreground font-medium'>
          {t('Drop reference images here')}
        </span>
        <span>{t('PNG, JPEG, or WebP · up to 6 images')}</span>
      </button>
      <input
        ref={inputRef}
        className='sr-only'
        type='file'
        accept='image/png,image/jpeg,image/webp'
        multiple
        disabled={props.disabled}
        aria-label={t('Reference images')}
        onChange={(event) => addFiles([...(event.target.files ?? [])])}
      />
      {props.files.length > 0 ? (
        <div className='grid grid-cols-3 gap-2'>
          {props.files.map((file, index) => {
            let key = fileKeys.current.get(file)
            if (!key) {
              nextFileKey.current += 1
              key = `reference-${nextFileKey.current}`
              fileKeys.current.set(file, key)
            }
            return (
              <ReferencePreview
                key={key}
                file={file}
                index={index}
                disabled={props.disabled}
                onRemove={(removeIndex) =>
                  props.onChange(
                    props.files.filter(
                      (_, fileIndex) => fileIndex !== removeIndex
                    )
                  )
                }
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
