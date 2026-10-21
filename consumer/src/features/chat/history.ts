export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  image?: string
  imageName?: string
  superseded?: boolean
  status: 'complete' | 'streaming' | 'stopped' | 'error'
  error?: string
}

export type Conversation = {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

const storagePrefix = 'new-api-consumer:chat:v1:'

/** Validate local, user-scoped history; never import the old console's storage. */
export function loadConversations(userId: number): Conversation[] {
  try {
    const raw = localStorage.getItem(storagePrefix + userId)
    if (!raw || raw.length > 2_000_000) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 30).flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      const item = entry as Partial<Conversation>
      if (
        typeof item.id !== 'string' ||
        typeof item.title !== 'string' ||
        !Array.isArray(item.messages)
      )
        return []
      const messages = item.messages.slice(-100).flatMap((message: unknown): ChatMessage[] => {
        if (!message || typeof message !== 'object') return []
        const value = message as Partial<ChatMessage>
        if (
          typeof value.id !== 'string' ||
          typeof value.content !== 'string' ||
          (value.role !== 'user' && value.role !== 'assistant')
        )
          return []
        let status: ChatMessage['status'] = 'stopped'
        if (value.status === 'complete' || value.status === 'error') status = value.status
        return [
          {
            id: value.id,
            role: value.role,
            content: value.content.slice(0, 64_000),
            reasoning:
              typeof value.reasoning === 'string' ? value.reasoning.slice(0, 64_000) : undefined,
            status,
            superseded: value.superseded === true || undefined,
            imageName:
              typeof value.imageName === 'string' ? value.imageName.slice(0, 200) : undefined,
          },
        ]
      })
      return [
        {
          id: item.id,
          title: item.title.slice(0, 100),
          updatedAt: Number(item.updatedAt) || 0,
          messages,
        },
      ]
    })
  } catch {
    return []
  }
}

/** Bound history storage without saving credentials or provider metadata. */
export function saveConversations(userId: number, conversations: Conversation[]): boolean {
  try {
    const safe = conversations.slice(0, 30).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(-100).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content.slice(0, 64_000),
        reasoning: message.reasoning?.slice(0, 64_000),
        status: message.status,
        superseded: message.superseded,
        imageName: message.imageName?.slice(0, 200),
      })),
    }))
    let serialized = JSON.stringify(safe)
    while (serialized.length > 1_000_000 && safe.length > 1) {
      safe.pop()
      serialized = JSON.stringify(safe)
    }
    if (serialized.length > 1_000_000) return false
    localStorage.setItem(storagePrefix + userId, serialized)
    return true
  } catch {
    return false
  }
}

export interface ChatWorkspaceState {
  activeId: string | null
  drafts: Record<string, string>
}

/** Unsent text is separate from billable conversation messages and account-scoped. */
export function loadChatWorkspace(userId: number): ChatWorkspaceState {
  try {
    const value = JSON.parse(
      localStorage.getItem(`factory:chat-workspace:v1:${userId}`) || 'null',
    ) as Partial<ChatWorkspaceState> | null
    if (
      !value ||
      typeof value !== 'object' ||
      !value.drafts ||
      typeof value.drafts !== 'object' ||
      Array.isArray(value.drafts)
    )
      return { activeId: null, drafts: {} }
    return {
      activeId: typeof value.activeId === 'string' ? value.activeId : null,
      drafts: Object.fromEntries(
        Object.entries(value.drafts)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .slice(-31)
          .map(([key, text]) => [key, text.slice(0, 32_000)]),
      ),
    }
  } catch {
    return { activeId: null, drafts: {} }
  }
}

export function saveChatWorkspace(userId: number, state: ChatWorkspaceState): boolean {
  try {
    const drafts = Object.fromEntries(
      Object.entries(state.drafts)
        .filter(([, text]) => text)
        .slice(-31)
        .map(([key, text]) => [key, text.slice(0, 32_000)]),
    )
    localStorage.setItem(
      `factory:chat-workspace:v1:${userId}`,
      JSON.stringify({ activeId: state.activeId, drafts }),
    )
    return true
  } catch {
    return false
  }
}
