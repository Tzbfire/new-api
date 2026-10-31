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
import { Pencil, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable, StaticRowActions } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getRateLimitRuleKey,
  type RateLimitRule,
  type RateLimitSelection,
} from './lib/rate-limit-rules'
import { RateLimitDialog } from './rate-limit-dialog'

type RateLimitVisualEditorProps = {
  rules: RateLimitRule[]
  onChange: (rules: RateLimitRule[]) => void
  groupNames?: string[]
  modelNames?: string[]
}

export function RateLimitVisualEditor(props: RateLimitVisualEditorProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<RateLimitRule | null>(null)
  const allGroupsLabel = t('All groups')
  const allModelsLabel = t('All models')
  const filteredRules = useMemo(() => {
    const search = searchText.toLowerCase().trim()
    return props.rules.filter(
      (rule) =>
        (rule.group ?? allGroupsLabel).toLowerCase().includes(search) ||
        (rule.model ?? allModelsLabel).toLowerCase().includes(search)
    )
  }, [props.rules, searchText, allGroupsLabel, allModelsLabel])

  const handleSave = (selection: RateLimitSelection) => {
    const editKey = editData ? getRateLimitRuleKey(editData) : null
    const next = props.rules.filter(
      (rule) => getRateLimitRuleKey(rule) !== editKey
    )
    const groups = selection.groups.length ? selection.groups : [null]
    const models = selection.models.length ? selection.models : [null]
    for (const group of groups) {
      for (const model of models) {
        next.push({
          group,
          model,
          maxRequests: selection.maxRequests,
          maxSuccess: selection.maxSuccess,
        })
      }
    }
    props.onChange(next)
  }
  const handleDelete = (rule: RateLimitRule) => {
    if (rule.group === null && rule.model === null) return
    const key = getRateLimitRuleKey(rule)
    props.onChange(
      props.rules.filter((existing) => getRateLimitRuleKey(existing) !== key)
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-4'>
        <div className='relative flex-1'>
          <Search
            aria-hidden='true'
            className='text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4'
          />
          <Input
            aria-label={t('Search groups or models...')}
            placeholder={t('Search groups or models...')}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className='pl-9'
          />
        </div>
        <Button
          type='button'
          onClick={() => {
            setEditData(null)
            setDialogOpen(true)
          }}
        >
          <Plus className='mr-2 h-4 w-4' />
          {t('Add rule')}
        </Button>
      </div>
      <StaticDataTable
        data={filteredRules}
        getRowKey={getRateLimitRuleKey}
        emptyContent={t('No rules match your search')}
        columns={[
          {
            id: 'groups',
            header: t('Groups'),
            cellClassName: 'font-medium',
            cell: (rule) => rule.group ?? allGroupsLabel,
          },
          {
            id: 'models',
            header: t('Models'),
            cellClassName: 'font-medium',
            cell: (rule) => rule.model ?? allModelsLabel,
          },
          {
            id: 'max-requests',
            header: t('Max Requests (incl. failures)'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (rule) => (
              <span className='font-mono'>
                {rule.maxRequests === 0
                  ? t('Unlimited')
                  : formatNumber(rule.maxRequests, locale)}
              </span>
            ),
          },
          {
            id: 'max-success',
            header: t('Max Success'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (rule) => (
              <span className='font-mono'>
                {rule.maxSuccess === 0
                  ? t('Unlimited')
                  : formatNumber(rule.maxSuccess, locale)}
              </span>
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (rule) => {
              if (rule.group === null && rule.model === null) {
                return (
                  <div className='flex justify-end'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Edit')}
                      onClick={() => {
                        setEditData(rule)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                  </div>
                )
              }
              return (
                <StaticRowActions
                  editLabel={t('Edit')}
                  deleteLabel={t('Delete')}
                  menuLabel={t('Open menu')}
                  onEdit={() => {
                    setEditData(rule)
                    setDialogOpen(true)
                  }}
                  onDelete={() => handleDelete(rule)}
                />
              )
            },
          },
        ]}
      />
      <RateLimitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editData={editData}
        existingRules={props.rules}
        groupNames={props.groupNames}
        modelNames={props.modelNames}
      />
    </div>
  )
}
