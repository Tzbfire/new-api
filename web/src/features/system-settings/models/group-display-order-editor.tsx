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
import { Reorder } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AutoGroupOrderItem } from '@/components/auto-group-order-item'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { safeJsonParse } from '../utils/json-parser'

type GroupDisplayOrderEditorProps = {
  value: string
  groupNames: string[]
  descriptions: Record<string, string>
  onChange: (value: string) => void
}

export function GroupDisplayOrderEditor(props: GroupDisplayOrderEditorProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const configuredOrder = useMemo(() => {
    const parsed = safeJsonParse<unknown>(props.value, {
      fallback: [],
      silent: true,
    })
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : []
  }, [props.value])
  const groups = useMemo(() => {
    const available = new Set(props.groupNames)
    const ordered = [...new Set(configuredOrder)].filter((name) =>
      available.has(name)
    )
    const included = new Set(ordered)
    return [
      ...ordered,
      ...props.groupNames.filter((name) => !included.has(name)).sort(),
    ]
  }, [configuredOrder, props.groupNames])

  const moveGroup = (index: number, direction: 'up' | 'down') => {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= groups.length) return
    const next = [...groups]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    props.onChange(JSON.stringify(next, null, 2))
  }

  return (
    <Card className='min-w-0 shadow-none'>
      <CardHeader className='gap-2 border-b'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <CardTitle>{t('Group display order')}</CardTitle>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={configuredOrder.length === 0}
            onClick={() => props.onChange('[]')}
          >
            {t('Restore default order')}
          </Button>
        </div>
        <CardDescription>
          {t(
            'Drag groups or use the arrow buttons to set the order users see. Group access, prices and automatic routing stay unchanged.'
          )}
        </CardDescription>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Users only see groups they can access. New groups appear at the end in name order.'
          )}
        </p>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <EmptyState
            className='min-h-40'
            title={t('No groups yet. Add a group to get started.')}
          />
        ) : (
          <Reorder.Group
            as='ol'
            axis='y'
            values={groups}
            onReorder={(next) => props.onChange(JSON.stringify(next, null, 2))}
            aria-label={t('Group display order')}
            className='flex flex-col gap-2'
          >
            {groups.map((group, index) => (
              <AutoGroupOrderItem
                key={group}
                group={group}
                index={index}
                count={groups.length}
                onMove={moveGroup}
                leading={
                  <span className='text-muted-foreground w-5 shrink-0 text-center text-sm tabular-nums'>
                    {formatNumber(index + 1, locale)}
                  </span>
                }
              >
                {props.descriptions[group] && (
                  <span
                    className='text-muted-foreground min-w-0 truncate text-xs'
                    title={props.descriptions[group]}
                  >
                    {props.descriptions[group]}
                  </span>
                )}
              </AutoGroupOrderItem>
            ))}
          </Reorder.Group>
        )}
      </CardContent>
    </Card>
  )
}
