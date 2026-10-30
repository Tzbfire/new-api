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
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable, StaticRowActions } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { safeJsonParseWithValidation } from '../utils/json-parser'
import { isObjectRecord } from '../utils/json-validators'
import {
  RateLimitDialog,
  type RateLimitEntity,
  type RateLimitEntryData,
} from './rate-limit-dialog'

type RateLimitVisualEditorProps = {
  value: string
  onChange: (value: string) => void
  entity?: RateLimitEntity
  groupNames?: string[]
  modelNames?: string[]
}

export function RateLimitVisualEditor(props: RateLimitVisualEditorProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const entity = props.entity ?? 'group'
  const isGroupModel = entity === 'group-model'
  const isModel = entity === 'model'
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<RateLimitEntryData | null>(null)
  const parsed = useMemo(
    () =>
      safeJsonParseWithValidation<Record<string, unknown>>(props.value, {
        fallback: {},
        validator: isObjectRecord,
        silent: true,
      }),
    [props.value]
  )
  const rateLimits = useMemo(() => {
    const entries: RateLimitEntryData[] = []
    for (const [key, value] of Object.entries(parsed)) {
      const rules =
        isGroupModel && isObjectRecord(value) ? value : { [key]: value }
      if (isGroupModel && !isObjectRecord(value)) continue
      for (const [name, limits] of Object.entries(rules)) {
        if (
          !Array.isArray(limits) ||
          limits.length !== 2 ||
          !limits.every(Number.isInteger)
        ) {
          continue
        }
        entries.push({
          name,
          ...(isGroupModel ? { groupName: key } : {}),
          maxRequests: limits[0],
          maxSuccess: limits[1],
        })
      }
    }
    return entries
  }, [parsed, isGroupModel])
  const filteredRateLimits = useMemo(() => {
    const search = searchText.toLowerCase().trim()
    return rateLimits.filter(
      (limit) =>
        limit.name.toLowerCase().includes(search) ||
        limit.groupName?.toLowerCase().includes(search)
    )
  }, [rateLimits, searchText])
  const groupNames = [
    ...new Set([
      ...(props.groupNames ?? []),
      ...rateLimits.flatMap((entry) =>
        entry.groupName ? [entry.groupName] : []
      ),
    ]),
  ]
  const modelNames = [
    ...new Set([
      ...(props.modelNames ?? []),
      ...rateLimits.map((entry) => entry.name),
    ]),
  ]

  const handleSave = (data: RateLimitEntryData) => {
    let updated: Record<string, unknown>
    if (isGroupModel && data.groupName) {
      const existing = Object.hasOwn(parsed, data.groupName)
        ? parsed[data.groupName]
        : undefined
      const rules = isObjectRecord(existing) ? existing : {}
      updated = {
        ...parsed,
        [data.groupName]: {
          ...rules,
          [data.name]: [data.maxRequests, data.maxSuccess],
        },
      }
    } else {
      updated = { ...parsed, [data.name]: [data.maxRequests, data.maxSuccess] }
    }
    props.onChange(JSON.stringify(updated, null, 2))
  }
  const handleDelete = (entry: RateLimitEntryData) => {
    const updated = { ...parsed }
    if (isGroupModel && entry.groupName) {
      const rules = updated[entry.groupName]
      if (!isObjectRecord(rules)) return
      const remaining = { ...rules }
      delete remaining[entry.name]
      if (Object.keys(remaining).length) updated[entry.groupName] = remaining
      else delete updated[entry.groupName]
    } else delete updated[entry.name]
    props.onChange(JSON.stringify(updated, null, 2))
  }
  let searchPlaceholder: string
  let addLabel: string
  let emptyContent: string
  if (isGroupModel) {
    searchPlaceholder = t('Search groups or models...')
    addLabel = t('Add group-model rule')
    emptyContent = searchText
      ? t('No rules match your search')
      : t(
          'No group-model rate limits configured. Click "Add group-model rule" to get started.'
        )
  } else if (isModel) {
    searchPlaceholder = t('Search models...')
    addLabel = t('Add model')
    emptyContent = searchText
      ? t('No models match your search')
      : t(
          'No model-specific rate limits configured. Click "Add model" to get started.'
        )
  } else {
    searchPlaceholder = t('Search group names...')
    addLabel = t('Add group')
    emptyContent = searchText
      ? t('No groups match your search')
      : t(
          'No group-based rate limits configured. Click "Add group" to get started.'
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
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
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
          {addLabel}
        </Button>
      </div>
      <StaticDataTable
        data={filteredRateLimits}
        getRowKey={(limit) => JSON.stringify([limit.groupName, limit.name])}
        emptyContent={emptyContent}
        columns={[
          ...(isGroupModel
            ? [
                {
                  id: 'group',
                  header: t('Group Name'),
                  cellClassName: 'font-medium',
                  cell: (limit: RateLimitEntryData) => limit.groupName,
                },
              ]
            : []),
          {
            id: 'name',
            header: t(isModel || isGroupModel ? 'Model Name' : 'Group Name'),
            cellClassName: 'font-medium',
            cell: (limit) => limit.name,
          },
          {
            id: 'max-requests',
            header: t('Max Requests (incl. failures)'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (limit) => (
              <span className='font-mono'>
                {limit.maxRequests === 0
                  ? t('Unlimited')
                  : formatNumber(limit.maxRequests, locale)}
              </span>
            ),
          },
          {
            id: 'max-success',
            header: t('Max Success'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (limit) => (
              <span className='font-mono'>
                {limit.maxSuccess === 0
                  ? t('Unlimited')
                  : formatNumber(limit.maxSuccess, locale)}
              </span>
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (limit) => (
              <StaticRowActions
                editLabel={t('Edit')}
                deleteLabel={t('Delete')}
                menuLabel={t('Open menu')}
                onEdit={() => {
                  setEditData(limit)
                  setDialogOpen(true)
                }}
                onDelete={() => handleDelete(limit)}
              />
            ),
          },
        ]}
      />
      <RateLimitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editData={editData}
        entity={entity}
        groupNames={groupNames}
        modelNames={modelNames}
        existingEntries={rateLimits}
      />
    </div>
  )
}
