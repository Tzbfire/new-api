import { expect, it } from 'vitest'
import { dailyUsage, type UsagePoint, usageDetails, usageMetric, usageCache } from '../chart'

it('groups hourly usage into local calendar days and includes empty days without moving the period', () => {
  const first = new Date(2026, 9, 18, 12).getTime() / 1000
  const second = new Date(2026, 9, 19, 0).getTime() / 1000
  const end = new Date(2026, 9, 20, 12).getTime() / 1000
  const points = [
    { created_at: first - 3600, quota: 50 },
    { created_at: first, quota: 10 },
    { created_at: second - 1, quota: 15 },
    { created_at: second, quota: 20 },
    { created_at: end + 1, quota: 100 },
  ] as UsagePoint[]
  expect(dailyUsage(points, first, end)).toEqual([
    { date: new Date(2026, 9, 18).getTime() / 1000, quota: 25 },
    { date: new Date(2026, 9, 19).getTime() / 1000, quota: 20 },
    { date: new Date(2026, 9, 20).getTime() / 1000, quota: 0 },
  ])
})

it('labels legacy image logs as images without treating prompt_tokens as the image count', () => {
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      other: JSON.stringify({
        model_price: 0.5,
        model_ratio: 0,
        request_path: '/v1/images/generations',
      }),
    }),
  ).toEqual({ kind: 'images' })
})

it('uses an explicit bounded image count and ignores malformed counts', () => {
  const base = { prompt_tokens: 1, completion_tokens: 0 }
  expect(
    usageMetric({
      ...base,
      other: JSON.stringify({ request_path: '/v1/images/edits', image_count: 2 }),
    }),
  ).toEqual({ kind: 'images', count: 2 })
  expect(
    usageMetric({
      ...base,
      other: JSON.stringify({ request_path: '/v1/images/edits', image_count: 0 }),
    }),
  ).toEqual({ kind: 'images' })
})

it('reads the settled quantity from fixed-price image log messages and prefers the explicit field', () => {
  const log = { prompt_tokens: 1, completion_tokens: 0 }
  const details = {
    request_path: '/v1/images/generations',
    content_parts: [
      { key: 'Quality {{quality}}', params: { quality: 'high' } },
      { key: 'Image count {{count}}', params: { count: 3 } },
    ],
  }
  expect(usageMetric({ ...log, other: JSON.stringify(details) })).toEqual({
    kind: 'images',
    count: 3,
  })
  expect(usageMetric({ ...log, other: JSON.stringify({ ...details, image_count: 2 }) })).toEqual({
    kind: 'images',
    count: 2,
  })
})

it.each([
  null,
  [],
  {},
  { key: 'Other {{count}}', params: { count: 5 } },
  { key: 'Image count {{count}}', params: { count: '2' } },
  { key: 'Image count {{count}}', params: { count: -1 } },
  { key: 'Image count {{count}}', params: { count: 1.5 } },
])('does not invent quantities from malformed image metadata: %j', (part) => {
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      other: JSON.stringify({ request_path: '/v1/images/generations', content_parts: [part] }),
    }),
  ).toEqual({ kind: 'images' })
})

it('reads task usage facts without treating requested tokens as image quantities', () => {
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      other: JSON.stringify({ is_task: true, usage_facts: { image_count: 4 } }),
    }),
  ).toEqual({ kind: 'images', count: 4 })
})

it.each(['品质 standard, 生成数量 2', 'Quality standard, Image count 2'])(
  'reads the exact historical gateway image count field: %s',
  (content) => {
    expect(
      usageMetric({
        prompt_tokens: 1,
        completion_tokens: 0,
        content,
        other: '{"request_path":"/v1/images/generations"}',
      }),
    ).toEqual({ kind: 'images', count: 2 })
  },
)

it.each([
  'Generated 2 images',
  '生成数量 2.5',
  '生成数量 -1',
  '生成数量 2, 生成数量 3',
  'Image count 9007199254740992',
])('does not guess an image count from ambiguous historical text: %s', (content) => {
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      content,
      other: '{"request_path":"/v1/images/generations"}',
    }),
  ).toEqual({ kind: 'images' })
})

it('does not parse image-like text in chat logs or override conflicting structured quantities', () => {
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      content: 'Image count 2',
      other: '{"request_path":"/v1/chat/completions"}',
    }),
  ).toEqual({ kind: 'tokens', count: 1 })
  expect(
    usageMetric({
      prompt_tokens: 1,
      completion_tokens: 0,
      content: 'Image count 2',
      other: JSON.stringify({
        request_path: '/v1/images/edits',
        content_parts: [
          { key: 'Image count {{count}}', params: { count: 2 } },
          { key: 'Image count {{count}}', params: { count: 3 } },
        ],
      }),
    }),
  ).toEqual({ kind: 'images' })
})

it.each(['null', '[]', '{broken'])(
  'keeps historical logs readable when metadata is %s',
  (other) => {
    expect(usageMetric({ prompt_tokens: 16, completion_tokens: 10, other })).toEqual({
      kind: 'tokens',
      count: 26,
    })
    expect(usageDetails(other)).toEqual({})
  },
)

it('sums only server-provided request and token quantities in each local day', () => {
  const start = new Date(2026, 9, 18).getTime() / 1000
  expect(
    dailyUsage(
      [
        { created_at: start, quota: 10, count: 3, token_used: 120 },
        { created_at: start + 60, quota: 20, count: 2, token_used: 80 },
      ],
      start,
      start + 86400,
    ),
  ).toEqual([
    { date: start, quota: 30, count: 5, token_used: 200 },
    { date: start + 86400, quota: 0 },
  ])
})

it('uses recorded total seconds for streamed text speed and never invents latency or non-stream speed', async () => {
  const { usageTiming } = await import('../chart')
  const log = {
    type: 2,
    is_stream: true,
    use_time: 4,
    prompt_tokens: 1000,
    completion_tokens: 200,
    other: '{"frt":1000}',
  }
  expect(usageTiming(log)).toEqual({ duration: 4, firstResponse: 1, tokensPerSecond: 50 })
  expect(usageTiming({ ...log, is_stream: false }).tokensPerSecond).toBeUndefined()
  expect(usageTiming({ ...log, is_stream: undefined }).firstResponse).toBeUndefined()
  expect(usageTiming({ ...log, use_time: 0 }).tokensPerSecond).toBeUndefined()
  expect(usageTiming({ ...log, other: '{"frt":5000}' }).firstResponse).toBeUndefined()
  expect(usageTiming({ ...log, type: 5 }).tokensPerSecond).toBeUndefined()
  expect(usageTiming({ ...log, other: '{"is_task":true}' }).tokensPerSecond).toBeUndefined()
})

it('derives cache read share only from authoritative total input even when billable categories overlap', async () => {
  const { usageCache } = await import('../chart')
  expect(usageCache('{"billing_tokens":{"len":1000,"p":480,"cr":400,"cc":120}}')).toEqual({
    read: 400,
    write: 120,
    total: 1000,
    share: 40,
  })
  expect(usageCache('{"cache_tokens":400}')).toMatchObject({ read: 400, share: undefined })
  expect(usageCache('{"billing_tokens":{"p":0,"cr":0,"cc":0}}')?.share).toBeUndefined()
  expect(usageCache('{"billing_tokens":{"p":480,"cr":-1,"cc":120}}')?.read).toBeUndefined()
})

it('uses full input length when p includes cache and preserves image-cache reads', async () => {
  const { usageCache } = await import('../chart')
  expect(
    usageCache('{"cache_tokens":400,"billing_tokens":{"len":1000,"p":1000,"cr":400,"cc":100}}')
      ?.share,
  ).toBe(40)
  expect(
    usageCache('{"billing_tokens":{"len":1000,"p":300,"cr":100,"img_cr":300,"cc":0}}')?.read,
  ).toBe(400)
  expect(
    usageCache('{"cache_tokens":1200,"billing_tokens":{"len":1000,"p":1000}}')?.share,
  ).toBeUndefined()
  expect(usageCache('{"billing_tokens":{"p":500,"cr":400,"cc":100}}')?.share).toBeUndefined()
  expect(usageCache('{"input_tokens_total":1000,"cache_tokens":0}')?.share).toBe(0)
})

it('shows legacy OpenAI cache counts and share using the recorded prompt total', () => {
  expect(usageCache('{"cache_tokens":800}', 1000)).toEqual({
    read: 800,
    write: undefined,
    total: 1000,
    share: 80,
  })
  expect(usageCache('{"cache_tokens":0}', 1000)?.share).toBe(0)
})

it('includes separate Anthropic cache categories once and retains known counts without a denominator', () => {
  expect(
    usageCache(
      '{"usage_semantic":"anthropic","cache_tokens":600,"cache_creation_tokens":300,"cache_creation_tokens_5m":100,"cache_creation_tokens_1h":200}',
      100,
    ),
  ).toEqual({ read: 600, write: 300, total: 1000, share: 60 })
  expect(usageCache('{"claude":true,"cache_tokens":600}', 100)).toMatchObject({
    read: 600,
    total: undefined,
    share: undefined,
  })
  expect(usageCache('{"cache_tokens":400,"cache_creation_tokens_5m":120}', 1000)).toMatchObject({
    read: 400,
    write: 120,
    total: undefined,
    share: undefined,
  })
})

it('keeps aggregate cache writes above TTL splits and does not add overlapping OpenAI prefixes', () => {
  expect(
    usageCache(
      '{"claude":true,"cache_tokens":500,"cache_creation_tokens":400,"cache_creation_tokens_5m":100,"cache_creation_tokens_1h":200}',
      100,
    ),
  ).toMatchObject({ write: 400, total: 1000, share: 50 })
  expect(usageCache('{"cache_tokens":800,"cache_write_tokens":700}', 1000)).toMatchObject({
    read: 800,
    write: 700,
    total: 1000,
    share: 80,
  })
  expect(
    usageCache('{"cache_tokens":800,"cache_write_tokens":0,"cache_creation_tokens":700}', 1000)
      ?.write,
  ).toBe(0)
})

it('preserves missing, explicit zero and invalid cache data without inventing a percentage', () => {
  expect(usageCache('{}', 1000)).toBeUndefined()
  expect(usageCache('{"cache_tokens":0,"cache_write_tokens":0}', 1000)).toMatchObject({
    read: 0,
    write: 0,
    share: 0,
  })
  expect(usageCache('{"cache_tokens":400,"input_tokens_total":2000}', 1000)?.share).toBe(20)
  expect(
    usageCache('{"cache_tokens":400,"input_tokens_total":2000,"billing_tokens":{"len":1000}}', 3000)
      ?.share,
  ).toBe(40)
  expect(usageCache('{"cache_tokens":-10}', 1000)).toBeUndefined()
  expect(usageCache('{"cache_tokens":0}', 0)?.share).toBeUndefined()
  expect(usageCache('{"cache_tokens":1500}', 1000)).toMatchObject({ read: 1500, share: undefined })
})
