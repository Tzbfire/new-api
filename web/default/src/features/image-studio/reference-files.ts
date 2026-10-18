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
const MAX_REFERENCE_IMAGES = 6
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_REFERENCE_TOTAL_BYTES = 60 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type ReferenceImageErrorKey =
  | 'Only PNG, JPEG, and WebP images are supported.'
  | 'Each reference image must be 20 MB or smaller.'
  | 'You can upload up to 6 reference images.'
  | 'Reference images must be 60 MB or smaller in total.'

type AppendReferenceImagesResult = {
  files: File[]
  addedCount: number
  errors: ReferenceImageErrorKey[]
}

export function imageStudioModeForFiles(
  files: readonly File[]
): 'generation' | 'edit' {
  return files.length > 0 ? 'edit' : 'generation'
}

export function appendReferenceImages(
  current: File[],
  incoming: File[]
): AppendReferenceImagesResult {
  const accepted: File[] = []
  const errors: ReferenceImageErrorKey[] = []
  let totalBytes = current.reduce((total, file) => total + file.size, 0)
  const addError = (error: ReferenceImageErrorKey) => {
    if (!errors.includes(error)) errors.push(error)
  }

  for (const file of incoming) {
    if (!ACCEPTED_TYPES.has(file.type)) {
      addError('Only PNG, JPEG, and WebP images are supported.')
      continue
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      addError('Each reference image must be 20 MB or smaller.')
      continue
    }
    if (current.length + accepted.length >= MAX_REFERENCE_IMAGES) {
      addError('You can upload up to 6 reference images.')
      break
    }
    if (totalBytes + file.size > MAX_REFERENCE_TOTAL_BYTES) {
      addError('Reference images must be 60 MB or smaller in total.')
      break
    }
    totalBytes += file.size
    accepted.push(file)
  }

  return {
    files: accepted.length > 0 ? [...current, ...accepted] : current,
    addedCount: accepted.length,
    errors,
  }
}
