import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { Button, Input, Select } from './ui'

export function Pagination(props: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizes?: number[]
  compact?: boolean
  disabled?: boolean
  label?: string
}) {
  const { t, i18n } = useTranslation()
  const [jump, setJump] = useState<string | null>(null)
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize))
  const locale = toIntlLocale(i18n.resolvedLanguage)
  const numbers = [
    ...new Set([
      1,
      props.page - 2,
      props.page - 1,
      props.page,
      props.page + 1,
      props.page + 2,
      pages,
    ]),
  ]
    .filter((value) => value > 0 && value <= pages)
    .sort((a, b) => a - b)
  const target = Number(jump ?? props.page)
  const validTarget = Number.isInteger(target) && target >= 1 && target <= pages
  function go() {
    if (props.disabled || !validTarget) return
    props.onPageChange(target)
    setJump(null)
  }
  return (
    <nav
      className={`table-pagination${props.compact ? ' pagination-compact' : ''}`}
      aria-label={props.label || t('Pagination')}
    >
      <span className="pagination-count">
        {t('{{start}}–{{end}} of {{total}}', {
          start: formatNumber(props.total ? (props.page - 1) * props.pageSize + 1 : 0, locale),
          end: formatNumber(Math.min(props.page * props.pageSize, props.total), locale),
          total: formatNumber(props.total, locale),
        })}
      </span>
      <div className="pagination-pages">
        <Button
          variant="ghost"
          className="icon-button"
          disabled={props.disabled || props.page <= 1}
          onClick={() => props.onPageChange(1)}
          aria-label={t('First page')}
        >
          <ChevronsLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          className="icon-button"
          disabled={props.disabled || props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
          aria-label={t('Previous page')}
        >
          <ChevronLeft size={16} />
        </Button>
        {!props.compact &&
          numbers.map((page, index) => (
            <span className="pagination-page-item" key={page}>
              {index > 0 && page - numbers[index - 1]! > 1 && <span aria-hidden>…</span>}
              <Button
                variant={page === props.page ? 'primary' : 'ghost'}
                disabled={props.disabled}
                aria-current={page === props.page ? 'page' : undefined}
                aria-label={t('Page {{page}}', { page })}
                onClick={() => props.onPageChange(page)}
              >
                {formatNumber(page, locale)}
              </Button>
            </span>
          ))}
        <Button
          variant="ghost"
          className="icon-button"
          disabled={props.disabled || props.page >= pages}
          onClick={() => props.onPageChange(props.page + 1)}
          aria-label={t('Next page')}
        >
          <ChevronRight size={16} />
        </Button>
        <Button
          variant="ghost"
          className="icon-button"
          disabled={props.disabled || props.page >= pages}
          onClick={() => props.onPageChange(pages)}
          aria-label={t('Last page')}
        >
          <ChevronsRight size={16} />
        </Button>
      </div>
      {!props.compact && (
        <div className="pagination-settings">
          {props.onPageSizeChange && (
            <label>
              {t('Rows per page')}
              <Select
                aria-label={t('Rows per page')}
                disabled={props.disabled}
                value={props.pageSize}
                onValueChange={(value) => {
                  setJump(null)
                  props.onPageSizeChange?.(Number(value))
                }}
                options={(props.pageSizes || [15, 30, 60]).map((size) => ({
                  value: size,
                  label: formatNumber(size, locale),
                }))}
              />
            </label>
          )}
          {pages > 1 && (
            <label className="pagination-jump">
              {t('Go to page')}
              <Input
                type="number"
                disabled={props.disabled}
                min={1}
                max={pages}
                step={1}
                aria-label={t('Go to page')}
                aria-invalid={!validTarget || undefined}
                value={jump ?? props.page}
                onChange={(event) => setJump(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    go()
                  }
                }}
              />
              <Button variant="secondary" disabled={props.disabled || !validTarget} onClick={go}>
                {t('Go')}
              </Button>
            </label>
          )}
        </div>
      )}
    </nav>
  )
}
