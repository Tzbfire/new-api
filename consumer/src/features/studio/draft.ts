import type { StudioRequest } from './contracts'

export type StudioDraft = StudioRequest & { needsReferences: boolean }

/** Store text and parameters only. File bytes and signed asset URLs never enter the draft. */
export function saveStudioDraft(userId: number, draft: StudioDraft): boolean {
  try {
    localStorage.setItem(
      `factory:studio:${userId}:draft`,
      JSON.stringify({
        version: 1,
        group: draft.group,
        model: draft.model,
        prompt: draft.prompt,
        count: draft.count,
        size: draft.size,
        quality: draft.quality,
        needsReferences: draft.needsReferences,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function readStudioDraft(userId: number): StudioDraft | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`factory:studio:${userId}:draft`) || 'null',
    )
    if (!value || typeof value !== 'object') return null
    const draft = value as Record<string, unknown>
    if (draft.version !== 1) return null
    if (
      !['group', 'model', 'prompt', 'size', 'quality'].every(
        (key) => typeof draft[key] === 'string',
      )
    )
      return null
    if (
      (draft.prompt as string).length > 16000 ||
      !Number.isInteger(draft.count) ||
      Number(draft.count) < 1 ||
      Number(draft.count) > 1000
    )
      return null
    return {
      group: draft.group as string,
      model: draft.model as string,
      prompt: draft.prompt as string,
      size: draft.size as string,
      quality: draft.quality as string,
      count: draft.count as number,
      needsReferences: draft.needsReferences === true,
    }
  } catch {
    return null
  }
}
