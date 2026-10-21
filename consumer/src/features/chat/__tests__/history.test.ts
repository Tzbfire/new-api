import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadConversations,
  saveConversations,
  type Conversation,
  loadChatWorkspace,
  saveChatWorkspace,
} from '../history'

beforeEach(() => {
  vi.stubGlobal('localStorage', window.localStorage)
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())
const conversation: Conversation = {
  id: 'conversation-a',
  title: 'A useful idea',
  updatedAt: 1,
  messages: [
    { id: 'message-a', role: 'assistant', content: 'A partial answer', status: 'streaming' },
  ],
}

describe('local conversation history', () => {
  it('isolates users and recovers unfinished output as stopped', () => {
    expect(saveConversations(10, [conversation])).toBe(true)
    expect(loadConversations(11)).toEqual([])
    expect(loadConversations(10)[0]?.messages[0]?.status).toBe('stopped')
  })
  it('discards malformed browser storage', () => {
    localStorage.setItem(
      'new-api-consumer:chat:v1:10',
      '[{"id":"broken","messages":"not-an-array"}]',
    )
    expect(loadConversations(10)).toEqual([])
  })
  it('keeps failed partial responses marked as errors after reopening history', () => {
    const failed: Conversation = {
      ...conversation,
      messages: [
        {
          id: 'failed-response',
          role: 'assistant',
          content: 'An incomplete answer',
          status: 'error',
          error: 'Provider failure details',
        },
      ],
    }
    expect(saveConversations(10, [failed])).toBe(true)
    const restored = loadConversations(10)[0]?.messages[0]
    expect(restored?.content).toBe('An incomplete answer')
    expect(restored?.status).toBe('error')
    // Persist the failure state without retaining provider error metadata.
    expect(restored?.error).toBeUndefined()
    expect(localStorage.getItem('new-api-consumer:chat:v1:10')).not.toContain(
      'Provider failure details',
    )
  })
  it('returns an actionable storage failure without losing in-memory history', () => {
    const oversized: Conversation = {
      ...conversation,
      messages: Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        role: 'user',
        content: 'a'.repeat(64_000),
        status: 'complete',
      })),
    }
    expect(saveConversations(10, [oversized])).toBe(false)
    expect(oversized.messages).toHaveLength(20)
  })
})

it('restores the active conversation and separate unsent drafts without crossing accounts', () => {
  const workspace = { activeId: 'a', drafts: { a: 'Unsent follow up', new: 'A separate idea' } }
  expect(saveChatWorkspace(10, workspace)).toBe(true)
  expect(loadChatWorkspace(10)).toEqual(workspace)
  expect(loadChatWorkspace(11)).toEqual({ activeId: null, drafts: {} })
  localStorage.setItem('factory:chat-workspace:v1:11', '{broken')
  expect(loadChatWorkspace(11)).toEqual({ activeId: null, drafts: {} })
})
