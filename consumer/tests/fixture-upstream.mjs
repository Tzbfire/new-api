import http from 'node:http'
import { deflateSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'

// Local integration fixture only. Never accepts a non-loopback listener and never logs request bodies or headers.
const port = Number(process.env.NEW_API_FIXTURE_PORT || 3201)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port')
const counters = { chat: 0, images: 0, models: 0 }

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}

// A deterministic 512px gradient identifies fixture output without remote media or image dependencies.
const edge = 512
const header = Buffer.alloc(13)
header.writeUInt32BE(edge, 0)
header.writeUInt32BE(edge, 4)
header[8] = 8
header[9] = 2
const pixels = Buffer.alloc(edge * (1 + edge * 3))
for (let y = 0; y < edge; y++) {
  for (let x = 0; x < edge; x++) {
    const offset = y * (1 + edge * 3) + 1 + x * 3
    pixels[offset] = Math.round(238 - (x / edge) * 80)
    pixels[offset + 1] = Math.round(170 + (y / edge) * 50)
    pixels[offset + 2] = Math.round(130 + (x / edge) * 85)
  }
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(pixels)),
  pngChunk('IEND', Buffer.alloc(0)),
])

function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname
  if (request.method === 'GET' && path === '/health')
    return json(response, { fixture: true, counters })
  if (request.method === 'GET' && (path === '/v1/models' || path === '/models')) {
    counters.models++
    return json(response, {
      object: 'list',
      data: ['consumer-chat', 'gpt-image-1', 'consumer-image'].map((id) => ({
        id,
        object: 'model',
        created: 1,
        owned_by: 'local-fixture',
      })),
    })
  }
  if (request.method !== 'POST')
    return json(
      response,
      { error: { message: 'Fixture route not found', type: 'invalid_request_error' } },
      404,
    )
  let body = Buffer.alloc(0)
  try {
    for await (const chunk of request) {
      if (body.length + chunk.length > 64 * 1024 * 1024)
        return json(response, { error: { message: 'Fixture request too large' } }, 413)
      body = Buffer.concat([body, chunk])
    }
  } catch {
    return response.destroy()
  }
  let payload = {}
  if (request.headers['content-type']?.includes('application/json')) {
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      return json(response, { error: { message: 'Fixture request is not JSON' } }, 400)
    }
  }
  if (path === '/v1/chat/completions' || path === '/chat/completions') {
    counters.chat++
    const prompt = payload.messages?.at(-1)?.content || ''
    if (typeof prompt === 'string' && prompt.includes('QA_FAIL'))
      return json(
        response,
        {
          error: {
            message: 'QA synthetic failure. Please try a different prompt.',
            type: 'server_error',
          },
        },
        503,
      )
    const model = typeof payload.model === 'string' ? payload.model : 'consumer-chat'
    let content =
      process.env.FACTORY_FIXTURE_LANGUAGE === 'zh'
        ? '你好！这是 **New API 本地功能测试**的模拟回答。\n\n请求已通过：New API 用户界面 → New API 网关 → 本地测试上游。\n\n未调用外部模型，不产生真实费用。\n\n> local integration fixture response'
        : 'This is a local integration fixture response.\n\n**Verified path:** consumer UI → New API relay → local fixture.\n\nNo external AI provider was contacted.'
    if (typeof prompt === 'string' && prompt.includes('QA_CODE'))
      content += '\n\n```javascript\nconst greeting = "Example";\nconsole.log(greeting);\n```'
    if (typeof prompt === 'string' && prompt.includes('QA_LINK'))
      content += '\n\n[Example models](http://127.0.0.1:3121/app/explore)'
    if (!payload.stream)
      return json(response, {
        id: 'chatcmpl-local-fixture',
        object: 'chat.completion',
        created: 1,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 36, total_tokens: 48 },
      })
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const base = {
      id: 'chatcmpl-local-fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model,
    }
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Checking the local integration path.' }, finish_reason: null }] })}\n\n`,
    )
    for (const part of [content.slice(0, 40), content.slice(40, 95), content.slice(95)]) {
      if (response.destroyed) return
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`,
      )
      if (typeof prompt === 'string' && prompt.includes('QA_SLOW')) await delay(4000)
      if (typeof prompt === 'string' && prompt.includes('QA_PARTIAL')) await delay(15000)
    }
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 36, total_tokens: 48 } })}\n\n`,
    )
    return response.end('data: [DONE]\n\n')
  }
  if (
    ['/v1/images/generations', '/images/generations', '/v1/images/edits', '/images/edits'].includes(
      path,
    )
  ) {
    counters.images++
    if (payload.prompt?.includes('QA_FAIL'))
      return json(
        response,
        { error: { message: 'QA synthetic image failure', type: 'server_error' } },
        503,
      )
    if (payload.prompt?.includes('QA_SLOW')) await delay(5000)
    return json(response, {
      created: 1,
      data: [
        {
          b64_json: png.toString('base64'),
          revised_prompt: 'Synthetic local integration fixture image',
        },
      ],
      usage: {
        total_tokens: 24,
        input_tokens: 12,
        output_tokens: 12,
        input_tokens_details: { text_tokens: 12, image_tokens: 0 },
        output_tokens_details: { image_tokens: 12 },
      },
    })
  }
  return json(
    response,
    { error: { message: 'Fixture route not found', type: 'invalid_request_error' } },
    404,
  )
})

server.listen(port, '127.0.0.1', () =>
  process.stdout.write(`Local synthetic upstream listening on http://127.0.0.1:${port}\n`),
)
process.on('SIGTERM', () => server.close())
process.on('SIGINT', () => server.close())
