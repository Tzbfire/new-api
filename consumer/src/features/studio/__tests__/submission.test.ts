import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { submitStudioRequest } from '../api'
import { readStudioDraft, saveStudioDraft } from '../draft'
import {
  matchingSizePresets,
  safeImageURL,
  selectedVisibleTasks,
  studioTaskContent,
  type StudioConfig,
  type StudioRequest,
  type StudioTask,
} from '../contracts'

const payload: StudioRequest = {
  group: 'everyday',
  model: 'image-model',
  prompt: 'A warm reading nook',
  count: 12,
  size: '1024x1024',
  quality: '',
}
beforeEach(() => {
  vi.stubGlobal('localStorage', window.localStorage)
  localStorage.clear()
  document.cookie = 'new_api_session=; Max-Age=0'
})
afterEach(() => vi.unstubAllGlobals())

describe('studio contracts', () => {
  it('submits product count once and preserves total count beyond the returned first ten tasks', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          batch_id: 'batch-a',
          tasks: Array.from({ length: 10 }, (_, index) => ({ task_id: String(index) })),
          total_count: 12,
        },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await submitStudioRequest(payload, [], 1000)
    expect(result.total_count).toBe(12)
    expect(fetch).toHaveBeenCalledOnce()
    const [path, options] = fetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/pg/image-studio/generations')
    expect(JSON.parse(options.body as string)).toEqual(payload)
    expect(JSON.parse(options.body as string)).not.toHaveProperty('n')
  })
  it('does not retry a failed billed submission', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'))
    vi.stubGlobal('fetch', fetch)
    await expect(submitStudioRequest(payload, [], 1000)).rejects.toThrow('Network unavailable')
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('rejects invalid batch counts before sending a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(submitStudioRequest({ ...payload, count: 0 }, [], 1000)).rejects.toThrow(
      'Choose a valid number of images.',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses multipart image fields for reference edits without forcing a content type', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: { batch_id: 'batch-edit', tasks: [{ task_id: 'task-edit' }], total_count: 1 },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await submitStudioRequest(
      { ...payload, count: 1 },
      [new File(['image'], 'reference.png', { type: 'image/png' })],
      1000,
    )
    const [path, options] = fetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/pg/image-studio/edits')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('count')).toBe('1')
    expect((options.body as FormData).getAll('image')).toHaveLength(1)
    expect(new Headers(options.headers).has('Content-Type')).toBe(false)
  })
  it('limits selection actions to visible terminal tasks', () => {
    const tasks = [
      { task_id: 'done', status: 'SUCCESS' },
      { task_id: 'active', status: 'IN_PROGRESS' },
      { task_id: 'failed', status: 'FAILURE' },
    ] as StudioTask[]
    expect(selectedVisibleTasks(tasks, new Set(['done', 'active', 'another-page']))).toEqual([
      tasks[0],
    ])
  })
  it('normalizes legacy JSON payloads without activating unsafe image URLs', () => {
    const task = {
      data: JSON.stringify({
        request: { prompt: 'A sketch' },
        response: {
          data: [
            { url: 'javascript:alert(1)', asset_status: 'expired' },
            {
              url: '/api/image-studio/assets/1/2/signature',
              download_url: '/api/image-studio/assets/1/2/signature/download',
              asset_status: 'ready',
            },
          ],
        },
      }),
    } as StudioTask
    const result = studioTaskContent(task)
    expect(result.request.prompt).toBe('A sketch')
    expect(result.images[0]?.url).toBeUndefined()
    expect(result.images[1]?.url).toBe('/api/image-studio/assets/1/2/signature')
    expect(safeImageURL('//foreign.invalid/file')).toBeUndefined()
  })
  it('uses group-specific size recommendations over generic model presets', () => {
    const base = {
      id: 'generic',
      group_pattern: '*',
      model_pattern: 'image-*',
      aspect_ratio: '1:1',
      tier: 'standard',
      tier_label: 'Standard',
      width: 1024,
      height: 1024,
      enabled: true,
      experimental: false,
    }
    const config = {
      size_presets: [
        base,
        { ...base, id: 'specific', group_pattern: 'everyday', width: 2048, height: 2048 },
      ],
    } as StudioConfig
    expect(
      matchingSizePresets(config, 'everyday', 'image-model').map((preset) => preset.id),
    ).toEqual(['specific'])
    expect(matchingSizePresets(config, 'other', 'text-model')).toEqual([])
  })
})

it('restores an account-scoped draft without persisting reference file contents', () => {
  const draft = { ...payload, needsReferences: true }
  saveStudioDraft(101, {
    ...draft,
    files: ['synthetic-file-bytes'],
    imageURL: 'synthetic-signed-url',
  } as typeof draft)
  expect(localStorage.getItem('factory:studio:101:draft')).not.toContain('synthetic-file-bytes')
  expect(localStorage.getItem('factory:studio:101:draft')).not.toContain('synthetic-signed-url')
  expect(readStudioDraft(101)).toEqual(draft)
  expect(readStudioDraft(202)).toBeNull()
  localStorage.setItem('factory:studio:101:draft', '{broken')
  expect(readStudioDraft(101)).toBeNull()
})
