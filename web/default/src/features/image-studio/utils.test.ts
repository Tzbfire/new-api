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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { GroupOption, ModelOption } from '@/features/playground/types'

import type { ImageModelCatalogItem } from './types'
import {
  activeTaskElapsedSeconds,
  filterImageModels,
  isImageStudioEditMode,
  selectImageStudioGroup,
  taskDurationSeconds,
} from './utils'

const groups: GroupOption[] = [
  { label: 'default', value: 'default', ratio: 1 },
  { label: 'images', value: 'images', ratio: 1 },
]
const catalog: ImageModelCatalogItem[] = [
  { modelName: 'gpt-image-1', enableGroups: ['images'] },
]

describe('image studio option selection', () => {
  test('skips a preferred group without an image-generation model', () => {
    assert.equal(
      selectImageStudioGroup(groups, catalog, ['default', 'images']),
      'images'
    )
  })

  test('treats catalog models enabled for all groups as image capable', () => {
    assert.equal(
      selectImageStudioGroup(
        groups,
        [{ modelName: 'gpt-image-1', enableGroups: ['all'] }],
        ['default']
      ),
      'default'
    )
  })

  test('strictly intersects the selected group models with the catalog', () => {
    const models: ModelOption[] = [
      { label: 'gpt-5', value: 'gpt-5' },
      { label: 'gpt-image-1', value: 'gpt-image-1' },
    ]

    assert.deepEqual(filterImageModels(models, catalog, 'images'), [
      { label: 'gpt-image-1', value: 'gpt-image-1' },
    ])
    assert.deepEqual(filterImageModels(models, catalog, 'default'), [])
  })

  test('keeps obvious image models when endpoint metadata is stale', () => {
    const models: ModelOption[] = [
      { label: 'gpt-5', value: 'gpt-5' },
      { label: 'gpt-image-2', value: 'gpt-image-2' },
    ]

    assert.deepEqual(filterImageModels(models, [], 'default'), [
      { label: 'gpt-image-2', value: 'gpt-image-2' },
    ])
  })
})

describe('image studio task duration', () => {
  test('uses the persisted generation start and finish timestamps', () => {
    assert.equal(taskDurationSeconds({ start_time: 100, finish_time: 137 }), 37)
    assert.equal(taskDurationSeconds({ start_time: 100, finish_time: 100 }), 1)
  })

  test('does not invent a duration for unfinished or invalid tasks', () => {
    assert.equal(taskDurationSeconds({ start_time: 100, finish_time: 0 }), null)
    assert.equal(
      taskDurationSeconds({ start_time: 101, finish_time: 100 }),
      null
    )
  })

  test('tracks queued time from creation and running time from start', () => {
    assert.equal(
      activeTaskElapsedSeconds(
        { status: 'QUEUED', created_at: 100, start_time: 0 },
        137
      ),
      37
    )
    assert.equal(
      activeTaskElapsedSeconds(
        { status: 'IN_PROGRESS', created_at: 100, start_time: 120 },
        137
      ),
      17
    )
  })

  test('stops live timing for terminal tasks and clamps future timestamps', () => {
    assert.equal(
      activeTaskElapsedSeconds(
        { status: 'SUCCESS', created_at: 100, start_time: 120 },
        137
      ),
      null
    )
    assert.equal(
      activeTaskElapsedSeconds(
        { status: 'QUEUED', created_at: 140, start_time: 0 },
        137
      ),
      0
    )
  })
})

describe('image studio task mode compatibility', () => {
  test('recognizes canonical and legacy image-edit task modes', () => {
    assert.equal(isImageStudioEditMode('edit'), true)
    assert.equal(isImageStudioEditMode('i2i'), true)
    assert.equal(isImageStudioEditMode('generation'), false)
    assert.equal(isImageStudioEditMode('t2i'), false)
    assert.equal(isImageStudioEditMode(undefined), false)
  })
})
