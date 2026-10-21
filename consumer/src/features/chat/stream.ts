export type ChatDelta = { content: string; reasoning: string }

type CompletionPayload = {
  error?: { message?: string }
  choices?: {
    delta?: { content?: string; reasoning_content?: string; reasoning?: string }
    message?: { content?: string; reasoning_content?: string }
  }[]
}

/** Consume complete SSE frames, including frames split across UTF-8 network chunks. */
export async function consumeChatStream(
  response: Response,
  onDelta: (delta: ChatDelta) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as CompletionPayload
    throw new Error(payload.error?.message || `Request failed (${response.status})`)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = (await response.json()) as CompletionPayload
    if (payload.error)
      throw new Error(payload.error.message || 'The response could not be completed.')
    const message = payload.choices?.[0]?.message
    if (!message?.content) throw new Error('The response could not be completed.')
    onDelta({ content: message.content, reasoning: message.reasoning_content || '' })
    return
  }
  if (!response.body) throw new Error('The response could not be completed.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (!done) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      buffer += decoder.decode(part.value, { stream: !part.done })
      // Normalize CRLF after combining chunks so a split CR/LF is preserved.
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data.trim() === '[DONE]') {
          done = true
          break
        }
        if (data) {
          const payload = JSON.parse(data) as CompletionPayload
          if (payload.error)
            throw new Error(payload.error.message || 'The response could not be completed.')
          const delta = payload.choices?.[0]?.delta
          if (delta)
            onDelta({
              content: delta.content || '',
              reasoning: delta.reasoning_content ?? delta.reasoning ?? '',
            })
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (part.done && !done)
        throw new Error('The connection ended before the response was complete.')
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
