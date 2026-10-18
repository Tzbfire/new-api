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
import { test } from 'node:test'

import {
  appendReferenceImages,
  imageStudioModeForFiles,
} from './reference-files'

function imageFile(name: string, type = 'image/png', size = 1024): File {
  return { name, type, size, lastModified: 1 } as File
}

test('derives generation mode exclusively from attached images', () => {
  assert.equal(imageStudioModeForFiles([]), 'generation')
  assert.equal(imageStudioModeForFiles([imageFile('reference.png')]), 'edit')
})

test('accepts supported dropped or pasted images', () => {
  const first = imageFile('first.png')
  const second = imageFile('second.webp', 'image/webp')
  const result = appendReferenceImages([first], [second])

  assert.deepEqual(result.files, [first, second])
  assert.equal(result.addedCount, 1)
  assert.deepEqual(result.errors, [])
})

test('applies the shared type, size, count, and total-size limits', () => {
  const current = Array.from({ length: 5 }, (_, index) =>
    imageFile(`current-${index}.png`, 'image/png', 10 * 1024 * 1024)
  )
  const result = appendReferenceImages(current, [
    imageFile('unsupported.gif', 'image/gif'),
    imageFile('too-large.png', 'image/png', 21 * 1024 * 1024),
    imageFile('accepted.png', 'image/png', 1024),
    imageFile('over-count.png'),
  ])

  assert.equal(result.addedCount, 1)
  assert.deepEqual(result.errors, [
    'Only PNG, JPEG, and WebP images are supported.',
    'Each reference image must be 20 MB or smaller.',
    'You can upload up to 6 reference images.',
  ])
})

test('rejects an image that would exceed the total-size limit', () => {
  const result = appendReferenceImages(
    [imageFile('current.png', 'image/png', 55 * 1024 * 1024)],
    [imageFile('next.png', 'image/png', 6 * 1024 * 1024)]
  )

  assert.equal(result.addedCount, 0)
  assert.deepEqual(result.errors, [
    'Reference images must be 60 MB or smaller in total.',
  ])
})
