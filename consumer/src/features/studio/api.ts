import { request } from '@/lib/api'
import { validateStudioRequest, type StudioRequest, type StudioSubmission } from './contracts'

/** A submission is sent once: network uncertainty must not create a second billed batch. */
export async function submitStudioRequest(
  payload: StudioRequest,
  files: File[],
  maxCount: number,
): Promise<StudioSubmission> {
  validateStudioRequest(payload, maxCount)
  let result: StudioSubmission
  if (files.length) {
    const form = new FormData()
    for (const [key, value] of Object.entries(payload))
      if (value !== '') form.set(key, String(value))
    for (const file of files) form.append('image', file)
    result = await request<StudioSubmission>('/pg/image-studio/edits', {
      method: 'POST',
      body: form,
    })
  } else {
    result = await request<StudioSubmission>('/pg/image-studio/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }
  if (!result?.batch_id || !Array.isArray(result.tasks) || !result.total_count)
    throw new Error('The submission result is unclear. Check your library before trying again.')
  return result
}
