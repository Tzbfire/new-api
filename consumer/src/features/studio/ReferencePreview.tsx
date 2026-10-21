import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'

export function ReferencePreview(props: { file: File; onRemove: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  useEffect(() => {
    const preview = URL.createObjectURL(props.file)
    setUrl(preview)
    return () => URL.revokeObjectURL(preview)
  }, [props.file])
  return (
    <div className="row studio-reference-preview">
      {url && <img src={url} alt={props.file.name} />}
      <span className="studio-file-name">{props.file.name}</span>
      <Button variant="ghost" aria-label={t('Remove reference image')} onClick={props.onRemove}>
        <X size={15} aria-hidden />
      </Button>
    </div>
  )
}
