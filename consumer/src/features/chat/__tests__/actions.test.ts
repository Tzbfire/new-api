import { describe, expect, it } from 'vitest'
import { conversationMarkdown, responseContext } from '../actions'
import { readStudyAttachment } from '../attachments'
import { saveConversations } from '../history'
import type { ChatMessage } from '../history'

const messages: ChatMessage[] = [
  { id: 'u', role: 'user', content: 'Explain this', status: 'complete' },
  { id: 'a', role: 'assistant', content: 'Partial **answer**', status: 'stopped' },
]
describe('explicit chat actions', () => {
  it('regenerates from the original user turn without repeating the failed answer', () => {
    expect(responseContext(messages, 'regenerate')).toEqual([messages[0]])
    expect(messages).toHaveLength(2)
  })
  it('continues with the partial response in context and an explicit continuation instruction', () => {
    const context = responseContext(messages, 'continue')
    expect(context.slice(0, 2)).toEqual(messages)
    expect(context[2]?.role).toBe('user')
    expect(context[2]?.content).toContain('without repeating')
  })
  it('keeps the translated continuation instruction in both visible history and request context', () => {
    expect(responseContext(messages, 'continue', '请继续回答。').at(-1)?.content).toBe(
      '请继续回答。',
    )
  })
  it('exports the whole conversation with original Markdown and partial status', () => {
    const output = conversationMarkdown({ id: 'c', title: 'Study', updatedAt: 1, messages })
    expect(output).toContain('Explain this')
    expect(output).toContain('Partial **answer**')
    expect(output).toContain('stopped')
  })
  it('rejects oversized files before reading them', async () => {
    const file = new File([], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 })
    await expect(readStudyAttachment(file)).rejects.toThrow('smaller than 8 MB')
  })
  it('does not persist image bytes into browser history', () => {
    localStorage.clear()
    expect(
      saveConversations(88, [
        {
          id: 'c',
          title: 'Image',
          updatedAt: 1,
          messages: [
            {
              ...messages[0]!,
              image: 'data:image/png;base64,privatebytes',
              imageName: 'question.png',
            },
          ],
        },
      ]),
    ).toBe(true)
    const stored = localStorage.getItem('new-api-consumer:chat:v1:88')
    expect(stored).not.toContain('privatebytes')
    expect(stored).toContain('question.png')
  })
})
