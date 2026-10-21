import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageOff, LoaderCircle, Maximize2 } from 'lucide-react'
import { Badge, Checkbox, Button } from '@/components/ui'
import { formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { toIntlLocale } from '@/i18n/languages'
import { isRunning, studioTaskContent, type StudioTask } from './contracts'
import { TaskTiming } from './TaskTiming'

export function TaskCard(props: {
  task: StudioTask
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
  onPreview: () => void
}) {
  const { t, i18n } = useTranslation()
  const status = useStatus()
  const [imageFailed, setImageFailed] = useState(false)
  const content = studioTaskContent(props.task)
  const image = content.images[0]
  useEffect(() => setImageFailed(false), [image?.url])
  const running = isRunning(props.task)
  let label = t('Queued')
  if (props.task.status === 'IN_PROGRESS') label = t('Creating')
  if (props.task.status === 'SUCCESS') label = t('Completed')
  if (props.task.status === 'FAILURE') label = t('Failed')
  const available = image?.url && image.asset_status !== 'expired' && !imageFailed
  return (
    <article className="studio-task-card">
      <div className="studio-task-image">
        {available ? (
          <img
            src={image.url}
            alt={content.request.prompt || t('Generated image')}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="studio-image-placeholder">
            {running ? (
              <LoaderCircle className="studio-spinner" size={28} />
            ) : (
              <ImageOff size={28} />
            )}
            <span>{running ? label : t('Image unavailable')}</span>
          </div>
        )}
        {props.onSelect && (
          <Checkbox
            className="studio-task-checkbox"
            checked={props.selected || false}
            onCheckedChange={props.onSelect}
            disabled={running || props.disabled}
            aria-label={t('Select image task')}
          />
        )}
        <div className="studio-task-badge">
          <Badge>{label}</Badge>
          {content.images.length > 1 && (
            <Badge>{t('{{count}} images', { count: content.images.length })}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          className="studio-image-open"
          aria-label={t('View creation')}
          disabled={props.disabled}
          onClick={props.onPreview}
        >
          <span className="studio-preview-button">
            <Maximize2 size={16} aria-hidden />
          </span>
        </Button>
      </div>
      <div className="studio-task-caption">
        <p>{content.request.prompt || t('Untitled creation')}</p>
        <div className="row muted">
          <span>{content.request.model}</span>
          <span>
            {formatQuota(props.task.quota, status.data, toIntlLocale(i18n.resolvedLanguage))}
          </span>
        </div>
        <TaskTiming task={props.task} />
      </div>
    </article>
  )
}
