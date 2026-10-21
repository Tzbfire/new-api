import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseEnv, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// Reuse this project's local PostgreSQL server credentials, never its business database.
const config = parseEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8'))
const source = new URL(config.SQL_DSN)
assert(['postgres:', 'postgresql:'].includes(source.protocol))
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname),
  'Only the configured local PostgreSQL instance is allowed',
)
const name = `factory_consumer_test_${Date.now()}_${randomBytes(4).toString('hex')}`
const environment = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
  PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
  PGCONNECT_TIMEOUT: '5',
}
let created = false
try {
  await promisify(execFile)(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${name}"`],
    { env: environment },
  )
  created = true
  const target = new URL(source)
  target.pathname = `/${name}`
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./gateway-integration.mjs', import.meta.url))],
    {
      env: { ...process.env, NEW_API_TEST_POSTGRES_DSN: target.href },
      stdio: 'inherit',
    },
  )
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  assert.equal(code, 0, 'PostgreSQL integration failed')
} catch {
  console.error('PostgreSQL integration failed; no business database was modified')
  process.exitCode = 1
} finally {
  if (created) {
    try {
      await promisify(execFile)(
        'psql',
        ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE "${name}"`],
        { env: environment },
      )
    } catch {
      console.error(`Could not remove owned test database ${name}`)
      process.exitCode = 1
    }
  }
}
