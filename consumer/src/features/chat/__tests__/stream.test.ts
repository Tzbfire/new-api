import { describe, expect, it } from 'vitest'
import { consumeChatStream, type ChatDelta } from '../stream'

function responseFromChunks(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('chat transport', () => {
  it('preserves partial UTF-8 and SSE frames with reasoning and completion', async () => {
    const data = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n',
    )
    const deltas: ChatDelta[] = []
    await consumeChatStream(
      responseFromChunks([
        data.slice(0, 55),
        data.slice(55, 59),
        data.slice(59, 60),
        data.slice(60, 110),
        data.slice(110),
      ]),
      (delta) => deltas.push(delta),
      new AbortController().signal,
    )
    expect(deltas).toEqual([
      { content: '', reasoning: '思考' },
      { content: '你好', reasoning: '' },
    ])
  })

  it('surfaces upstream stream errors after preserving partial output', async () => {
    const deltas: ChatDelta[] = []
    const response = responseFromChunks([
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":{"message":"Insufficient balance"}}\n\n',
      ),
    ])
    await expect(
      consumeChatStream(response, (delta) => deltas.push(delta), new AbortController().signal),
    ).rejects.toThrow('Insufficient balance')
    expect(deltas).toEqual([{ content: 'Partial', reasoning: '' }])
  })

  it('does not silently mark an interrupted response complete', async () => {
    const response = responseFromChunks([
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'),
    ])
    await expect(
      consumeChatStream(response, () => undefined, new AbortController().signal),
    ).rejects.toThrow('The connection ended before the response was complete.')
  })

  it('cancels a blocked stream when the user stops generation', async () => {
    const abort = new AbortController()
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        pull() {
          abort.abort()
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
    await expect(consumeChatStream(response, () => undefined, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(cancelled).toBe(true)
  })

  it('handles providers returning a nonstreaming completion', async () => {
    const deltas: ChatDelta[] = []
    const response = Response.json({ choices: [{ message: { content: 'Hello' } }] })
    await consumeChatStream(response, (delta) => deltas.push(delta), new AbortController().signal)
    expect(deltas).toEqual([{ content: 'Hello', reasoning: '' }])
  })
})
