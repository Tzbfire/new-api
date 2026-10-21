import type { ChatMessage, Conversation } from './history'

/** Regenerate removes only the latest assistant attempt, retaining its original user turn. */
export function responseContext(
  messages: ChatMessage[],
  action: 'regenerate' | 'continue',
  continuation = 'Continue from where you stopped without repeating the previous response.',
): ChatMessage[] {
  messages = messages.filter((message) => !message.superseded)
  if (action === 'regenerate' && messages.at(-1)?.role === 'assistant') return messages.slice(0, -1)
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: continuation,
      status: 'complete',
    },
  ]
}

export function conversationMarkdown(conversation: Conversation): string {
  return `# ${conversation.title}\n\n${conversation.messages.map((message) => `## ${message.role}\n\n${message.content}${message.reasoning ? `\n\n<details><summary>Thinking process</summary>\n\n${message.reasoning}\n\n</details>` : ''}\n\n<!-- ${message.status} -->`).join('\n\n')}\n`
}

export function downloadConversations(conversations: Conversation[]): void {
  const url = URL.createObjectURL(
    new Blob([conversations.map(conversationMarkdown).join('\n\n---\n\n')], {
      type: 'text/markdown;charset=utf-8',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'conversations.md'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
