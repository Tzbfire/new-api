import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

// Opt-in integration test. Every request targets test-owned loopback processes.
// Credentials stay in memory; the only database/files removed are this run's mkdtemp directory.
const binary = process.env.NEW_API_TEST_BINARY
assert(
  binary && isAbsolute(binary),
  'Set NEW_API_TEST_BINARY to an absolute, freshly built New API binary',
)
await access(binary)
const keepRunning = process.argv.includes('--serve')
const localDirectory =
  process.env.NEW_API_TEST_OUTPUT_DIRECTORY ||
  fileURLToPath(new URL('../../.local-tests/factory-consumer/', import.meta.url))
assert(isAbsolute(localDirectory), 'Test output directory must be absolute')
if (keepRunning) await mkdir(localDirectory, { recursive: true, mode: 0o700 })
const directory = await mkdtemp(
  join(keepRunning ? localDirectory : tmpdir(), 'new-api-consumer-integration-'),
)
const processes = []
let token
let cleaned = false
const postgresDSN = process.env.NEW_API_TEST_POSTGRES_DSN
let postgresVersion
if (postgresDSN) {
  const connection = new URL(postgresDSN)
  assert(['postgres:', 'postgresql:'].includes(connection.protocol))
  assert(['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname))
  assert(
    /^\/factory_consumer_test_[a-z0-9_]+$/.test(connection.pathname),
    'Only a dedicated disposable PostgreSQL database is allowed',
  )
  try {
    const { stdout } = await promisify(execFile)(
      'psql',
      [
        '-X',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema'); SHOW server_version;",
      ],
      {
        env: {
          ...process.env,
          PGHOST: connection.hostname,
          PGPORT: connection.port || '5432',
          PGUSER: decodeURIComponent(connection.username),
          PGPASSWORD: decodeURIComponent(connection.password),
          PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
          PGCONNECT_TIMEOUT: '5',
        },
      },
    )
    const [tables, version] = stdout.trim().split('\n')
    assert.equal(tables, '0', 'PostgreSQL integration requires an empty database')
    postgresVersion = version
  } catch {
    throw new Error('PostgreSQL preflight failed; use an empty dedicated test database')
  }
}

async function freePort(preferred = 0) {
  const server = createServer()
  server.listen(preferred, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: directory, env, stdio: 'ignore' })
  processes.push(child)
  return child
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), delay(1500)])
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGKILL')
      await Promise.race([once(child, 'exit'), delay(1500)])
    }
  }
  if (!keepRunning) await rm(directory, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await cleanup()
    process.exit(1)
  })

const gatewayPort = await freePort(keepRunning ? Number(process.env.NEW_API_TEST_PORT || 3000) : 0)
const upstreamPort = await freePort(
  keepRunning ? Number(process.env.NEW_API_TEST_UPSTREAM_PORT || 3201) : 0,
)
const origin = `http://127.0.0.1:${gatewayPort}`
const upstream = `http://127.0.0.1:${upstreamPort}`

async function localFetch(path, options = {}) {
  const url = new URL(path, origin)
  assert.equal(url.origin, origin, 'Integration requests must stay on the owned gateway origin')
  const headers = new Headers(options.headers)
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && typeof options.body !== 'string') {
    options = { ...options, body: JSON.stringify(options.body) }
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await localFetch(path, { method, body })
  const result = await response.json()
  // Do not dump an envelope: it may contain a usable session or API key.
  assert(
    response.ok && result.success === true,
    `${method} ${path.split('?')[0]} failed with HTTP ${response.status}; code ${result.code || 'unspecified'}`,
  )
  return result
}

async function until(predicate, label, timeout = 45000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(200)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  const environment = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '',
    TMPDIR: directory,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    SQLITE_PATH: join(directory, 'gateway.db'),
    ...(postgresDSN ? { SQL_DSN: postgresDSN } : {}),
    IMAGE_STUDIO_STORAGE_PATH: join(directory, 'images'),
    IMAGE_STUDIO_MIN_FREE_GB: '0',
    GIN_MODE: 'release',
    DEFAULT_LANGUAGE: keepRunning ? 'zh-CN' : 'en',
    BATCH_UPDATE_ENABLED: 'false',
    MEMORY_CACHE_ENABLED: 'false',
    // Parallel browser QA shares one loopback IP. Production rate limits stay unchanged.
    ...(keepRunning
      ? { CRITICAL_RATE_LIMIT: '1000', GLOBAL_API_RATE_LIMIT: '10000', SEARCH_RATE_LIMIT: '1000' }
      : {}),
  }
  const fixture = start(
    process.execPath,
    [fileURLToPath(new URL('./fixture-upstream.mjs', import.meta.url))],
    {
      ...environment,
      NEW_API_FIXTURE_PORT: String(upstreamPort),
      FACTORY_FIXTURE_LANGUAGE: keepRunning ? 'zh' : 'en',
    },
  )
  const gateway = start(
    binary,
    ['--port', String(gatewayPort), '--log-dir', join(directory, 'logs')],
    environment,
  )
  await until(
    async () => {
      assert.equal(fixture.exitCode, null, 'Synthetic upstream exited unexpectedly')
      assert.equal(gateway.exitCode, null, 'Gateway exited unexpectedly')
      try {
        return (await fetch(`${upstream}/health`)).ok && (await localFetch('/api/status')).ok
      } catch {
        return false
      }
    },
    'gateway startup',
    60000,
  )

  const password = `TestOnly-${randomBytes(20).toString('hex')}`
  await api('/api/setup', {
    username: 'fixtureuser',
    password,
    confirmPassword: password,
    SelfUseModeEnabled: false,
    DemoSiteEnabled: false,
  })
  const login = await api('/api/user/login', { username: 'fixtureuser', password })
  token = login.data.access_token
  assert.equal(typeof token, 'string', 'Session login must return an access token')
  const initial = (await api('/api/user/self')).data
  await api('/api/channel/', {
    mode: 'single',
    channel: {
      type: 1,
      name: 'synthetic-only',
      key: 'synthetic-test-only',
      base_url: upstream,
      models: 'consumer-chat,gpt-image-1',
      group: 'default,premium',
      priority: 0,
      weight: 1,
      status: 1,
    },
  })
  const setOption = async (key, value) => {
    try {
      return await api(
        '/api/option/',
        { key, value: typeof value === 'string' ? value : JSON.stringify(value) },
        'PUT',
      )
    } catch {
      throw new Error(`Test configuration rejected: ${key}`)
    }
  }
  for (const [key, value] of [
    ['GroupRatio', { default: 1, premium: 2 }],
    [
      'UserUsableGroups',
      {
        default: '日常测试通路 · 1× 倍率 · 模拟上游',
        premium: '进阶测试通路 · 2× 倍率 · 模拟上游',
      },
    ],
    ['SystemName', 'New API · 本地功能测试'],
    // Only this disposable fixture gateway uses the relaxed disk threshold.
    // Generated files are a few small PNGs; production settings are never loaded.
    ['performance_setting.monitor_disk_threshold', '100'],
  ])
    await setOption(key, value)
  const pricing = (await api('/api/option/model_pricing?model=consumer-chat&model=gpt-image-1'))
    .data
  await api(
    '/api/option/model_pricing',
    {
      changes: pricing.entries.map((entry) => ({
        model_name: entry.model_name,
        expected_version: entry.version,
        pricing: {
          'billing_setting.billing_mode': 'tiered_expr',
          'billing_setting.billing_expr':
            entry.model_name === 'consumer-chat'
              ? 'tier("base", p * 2 + c * 4)'
              : 'tier("image", fixed(0.04)) * image_count',
        },
      })),
    },
    'PATCH',
  )

  const groups = (await api('/api/user/self/groups')).data
  assert.equal(groups.premium.ratio, 2)
  assert((await api('/api/user/models?group=premium')).data.includes('consumer-chat'))
  const catalog = await api('/api/pricing')
  assert(catalog.data.some((model) => model.model_name === 'gpt-image-1'))
  const ordinary = (await api('/api/pricing/quote?model=consumer-chat&group=default')).data
  const premium = (await api('/api/pricing/quote?model=consumer-chat&group=premium')).data
  assert.equal(ordinary.quotes[0].usd, 0.006)
  assert.equal(premium.quotes[0].usd, 0.012)
  const publicQuoteResponse = await fetch(
    `${origin}/api/pricing/quote?model=consumer-chat&group=default`,
    { redirect: 'error', signal: AbortSignal.timeout(10000) },
  )
  assert.equal(publicQuoteResponse.status, 200, 'Anonymous quote must share public catalog access')
  const publicQuote = await publicQuoteResponse.json()
  assert.equal(publicQuote.success, true)
  assert.equal(publicQuote.data.quotes[0].usd, ordinary.quotes[0].usd)

  await api('/api/token/', {
    name: 'integration key',
    group: 'premium',
    expired_time: -1,
    remain_quota: 100000,
    unlimited_quota: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    allow_user_quota_query: false,
  })
  const key = (await api('/api/token/?p=1&page_size=10')).data.items.find(
    (key) => key.name === 'integration key',
  )
  assert(key && key.group === 'premium')
  const revealed = (await api(`/api/token/${key.id}/key`, {})).data.key
  assert.equal(typeof revealed, 'string')
  assert(!key.key.includes(revealed), 'List response must mask the API key')
  await api('/api/token/?status_only=true', { id: key.id, status: 2 }, 'PUT')
  const disabled = await localFetch('/v1/models', {
    headers: { Authorization: `Bearer sk-${revealed}` },
  })
  assert.equal(disabled.status, 401, 'Disabled API key must not authorize model access')
  await api(
    '/api/token/',
    { ...key, key: undefined, name: 'renamed integration key', status: undefined },
    'PUT',
  )
  const edited = (await api(`/api/token/${key.id}`)).data
  assert.equal(edited.group, 'premium')
  assert.equal(edited.status, 2)

  const chat = await localFetch('/pg/chat/completions', {
    method: 'POST',
    body: {
      model: 'consumer-chat',
      group: 'default',
      messages: [{ role: 'user', content: 'Synthetic integration test' }],
      stream: true,
      stream_options: { include_usage: true },
    },
  })
  assert.equal(chat.status, 200)
  const stream = await chat.text()
  let content = ''
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    const event = JSON.parse(line.slice(6))
    content += event.choices?.[0]?.delta?.content || ''
  }
  assert(
    content.includes('local integration fixture response') && stream.includes('[DONE]'),
    'Chat SSE did not complete with the synthetic fixture content',
  )

  const studioRequest = {
    model: 'gpt-image-1',
    group: 'default',
    prompt: 'Synthetic fixture art',
    count: 2,
    size: '1024x1024',
    quality: '',
  }
  const estimate = (await api('/pg/image-studio/estimate?mode=generate', studioRequest)).data
  assert.equal(estimate.estimated_quota, 40000)
  const submission = (await api('/pg/image-studio/generations', studioRequest)).data
  assert.equal(submission.total_count, 2)
  await until(async () => {
    const batch = (await api(`/api/image-studio/batches/${submission.batch_id}`)).data
    assert.equal(batch.failure_count, 0, 'Synthetic image batch failed')
    return batch.success_count === 2
  }, 'image batch completion')
  const tasks = (
    await api(`/api/image-studio/batches/${submission.batch_id}/tasks?p=1&page_size=10`)
  ).data.items
  assert.equal(tasks.length, 2)
  assert(tasks.every((task) => task.status === 'SUCCESS'))
  assert.equal((await api('/api/image-studio/library/tasks?p=1&page_size=10')).data.items.length, 2)
  const ticket = (
    await api('/api/image-studio/download-ticket', {
      scope: 'tasks',
      task_ids: tasks.map((task) => task.task_id),
    })
  ).data
  const download = await localFetch(ticket.url)
  assert.equal(download.status, 200)
  assert((await download.arrayBuffer()).byteLength > 1000)

  await until(
    async () => (await api('/api/user/self')).data.used_quota - initial.used_quota === 40084,
    'accounting settlement',
  )
  const finalUser = (await api('/api/user/self')).data
  const logs = (await api('/api/log/self?type=2&p=1&page_size=10')).data.items
  assert.equal(
    logs.reduce((sum, log) => sum + log.quota, 0),
    40084,
  )
  assert.equal(initial.quota - finalUser.quota, 40084)
  const topup = (await api('/api/user/topup/info')).data
  assert.equal(
    typeof topup.request_min_topup?.epay,
    'number',
    'Fresh gateway must expose canonical payment minimums',
  )
  assert.equal(typeof topup.request_amount_unit, 'string')
  await api(`/api/token/${key.id}`, undefined, 'DELETE')

  // The following operations only affect synthetic balances in this owned database.
  await api('/api/user/self', { username: 'fixtureuser', display_name: 'Example 测试用户' }, 'PUT')
  assert.equal((await api('/api/user/self')).data.display_name, 'Example 测试用户')
  assert(Array.isArray((await api('/api/user/sessions')).data))
  assert.equal(typeof (await api('/api/user/2fa/status')).data.enabled, 'boolean')
  assert.equal((await api('/api/user/topup/self?p=1&page_size=10')).data.total, 0)
  assert.equal((await api('/api/subscription/plans')).data.length, 0)
  const disabledPayment = await localFetch('/api/subscription/balance/pay', {
    method: 'POST',
    body: { plan_id: 1 },
  })
  assert.equal((await disabledPayment.json()).success, false)
  // Test-only local feature switch; this is not acceptance for the live deployment.
  await api('/api/option/payment_compliance', { confirmed: true })
  const gift = (
    await api('/api/redemption/', {
      name: 'New API 本地测试',
      count: 1,
      quota: 500000,
      expired_time: 0,
    })
  ).data[0]
  const redeemed = await api('/api/user/topup', { key: gift })
  assert.equal(redeemed.data, 500000)
  const redeemedUser = (await api('/api/user/self')).data
  assert.equal(redeemedUser.quota - finalUser.quota, 500000)
  const replay = await localFetch('/api/user/topup', { method: 'POST', body: { key: gift } })
  assert.equal((await replay.json()).success, false, 'Redemption code must not be reusable')
  assert.equal((await api('/api/user/self')).data.quota, redeemedUser.quota)
  const plan = (
    await api('/api/subscription/admin/plans', {
      plan: {
        title: 'Example 测试套餐',
        subtitle: '仅本地功能验证，不是真实商品',
        price_amount: 1,
        currency: 'USD',
        duration_unit: 'day',
        duration_value: 7,
        enabled: true,
        total_amount: 500000,
        quota_reset_period: 'never',
        allowed_token_groups: 'default',
        allow_wallet_overflow: false,
        allow_balance_pay: true,
        max_purchase_per_user: 1,
      },
    })
  ).data
  assert((await api('/api/subscription/plans')).data.some((item) => item.plan.id === plan.id))
  await api('/api/subscription/balance/pay', { plan_id: plan.id })
  const subscribed = (await api('/api/subscription/self')).data
  assert(subscribed.subscriptions.some((item) => item.subscription.plan_id === plan.id))
  assert.equal((await api('/api/user/self')).data.quota, redeemedUser.quota - 500000)
  await api('/api/subscription/self/preference', { billing_preference: 'wallet_only' }, 'PUT')
  assert.equal((await api('/api/subscription/self')).data.billing_preference, 'wallet_only')
  const repeatedPurchase = await localFetch('/api/subscription/balance/pay', {
    method: 'POST',
    body: { plan_id: plan.id },
  })
  assert.equal(
    (await repeatedPurchase.json()).success,
    false,
    'Purchase limit must be server enforced',
  )
  assert.equal((await api('/api/user/self')).data.quota, redeemedUser.quota - 500000)
  const restrictedChat = {
    model: 'consumer-chat',
    group: 'default',
    messages: [{ role: 'user', content: 'Synthetic subscription billing test' }],
    stream: true,
    stream_options: { include_usage: true },
  }
  const rejectedChat = await localFetch('/pg/chat/completions', {
    method: 'POST',
    body: restrictedChat,
  })
  assert.equal(
    rejectedChat.status,
    403,
    'Wallet-only preference must not bypass a plan wallet restriction',
  )
  assert.equal((await api('/api/user/self')).data.quota, redeemedUser.quota - 500000)
  assert.equal((await api('/api/user/self')).data.used_quota, finalUser.used_quota)
  await api(
    '/api/subscription/self/preference',
    { billing_preference: 'subscription_first' },
    'PUT',
  )
  const subscriptionChat = await localFetch('/pg/chat/completions', {
    method: 'POST',
    body: restrictedChat,
  })
  assert.equal(subscriptionChat.status, 200)
  assert((await subscriptionChat.text()).includes('data: [DONE]'))
  await until(async () => {
    const current = (await api('/api/subscription/self')).data.subscriptions
    return (
      current.find((item) => item.subscription.plan_id === plan.id)?.subscription.amount_used === 84
    )
  }, 'subscription usage settlement')
  assert.equal(
    (await api('/api/user/self')).data.quota,
    redeemedUser.quota - 500000,
    'Plan usage must not also debit the wallet',
  )
  let databaseEvidence = { database: 'isolated PostgreSQL', postgres_version: postgresVersion }
  if (!postgresDSN) {
    const { stdout: buildInfo } = await promisify(execFile)('go', ['version', '-m', binary], {
      maxBuffer: 1024 * 1024,
    })
    const sqliteRuntime = buildInfo.match(/\bdep\s+modernc.org\/sqlite\s+(\S+)/)?.[1]
    assert(sqliteRuntime, 'Binary build info must identify the embedded SQLite runtime module')
    const buildOS = buildInfo.match(/\bGOOS=(\S+)/)?.[1]
    const buildArch = buildInfo.match(/\bGOARCH=(\S+)/)?.[1]
    const { stdout: moduleCache } = await promisify(execFile)('go', ['env', 'GOMODCACHE'])
    const sqliteSource = await readFile(
      join(
        moduleCache.trim(),
        `modernc.org/sqlite@${sqliteRuntime}`,
        'lib',
        `sqlite_${buildOS}_${buildArch}.go`,
      ),
      'utf8',
    )
    const sqliteVersion = sqliteSource.match(/const SQLITE_VERSION = "([0-9.]+)"/)?.[1]
    assert(sqliteVersion, 'Matching embedded SQLite runtime version must be identifiable')
    databaseEvidence = {
      database: 'isolated SQLite',
      sqlite_runtime_module: `modernc.org/sqlite@${sqliteRuntime}`,
      sqlite_embedded_version: sqliteVersion,
      sqlite_version_evidence:
        'Binary module version and matching generated SQLite library constant',
    }
  }
  console.log(
    JSON.stringify({
      success: true,
      backend: 'real Go gateway',
      ...databaseEvidence,
      upstream: 'synthetic loopback fixture',
      verified: [
        'service groups',
        'canonical prices',
        'API key lifecycle',
        'chat SSE',
        'image estimate and batch',
        'library and download',
        'consume logs and wallet settlement',
        'topup request metadata',
        'profile and security status',
        'disabled payment and empty orders',
        'redemption and replay rejection',
        'local balance plan purchase and purchase limit',
        'billing preference persistence',
        'subscription group wallet restriction and separate plan settlement',
      ],
      wallet_usage_quota: 40084,
      subscription_usage_quota: 84,
      external_provider_calls: 0,
      external_payment_requests: 0,
      synthetic_balance_purchases: 1,
    }),
  )
  if (keepRunning) {
    const accessFile = join(localDirectory, 'access.json')
    await writeFile(
      accessFile,
      JSON.stringify(
        {
          username: 'fixtureuser',
          password,
          gateway: origin,
          frontend: 'http://localhost:3100/app/',
          data_directory: directory,
          notice: '仅本地测试账户和模拟余额，不用于生产',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    )
    await writeFile(
      join(localDirectory, 'runtime.json'),
      JSON.stringify(
        {
          launcher_pid: process.pid,
          child_pids: processes.map((child) => child.pid),
          directory,
          gateway: origin,
          upstream,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    )
    console.log(
      `New API local gateway is running at ${origin}; synthetic upstream at ${upstream}. Test account saved in ${accessFile}`,
    )
    await new Promise(() => {})
  }
} catch (error) {
  // Assertion messages intentionally contain only known labels and aggregate values.
  console.error(error instanceof Error ? error.message : 'Integration failed')
  process.exitCode = 1
} finally {
  token = undefined
  await cleanup()
}
