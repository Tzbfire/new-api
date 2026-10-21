import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import './plan-group-links.css'

export function PlanGroupLinks(props: { value: string; onSelect: (group: string) => void }) {
  const { t } = useTranslation()
  const groups = [
    ...new Set(
      (props.value || '')
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean),
    ),
  ]
  return (groups.length ? groups : ['']).map((group) => (
    <Button
      key={group}
      variant="secondary"
      className="plan-group-link"
      title={t('View supported models and prices')}
      onClick={() => props.onSelect(group)}
    >
      {group || t('All available groups')} <ArrowUpRight size={12} aria-hidden />
    </Button>
  ))
}
