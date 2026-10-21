// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, it } from 'vitest'

const locales = ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']
let root: string
let application: string
let script: string
let patchFile: string
let patch: Record<string, Record<string, string>>

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'consumer-translations-'))
  application = path.join(root, 'consumer')
  await fs.mkdir(path.join(application, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(application, 'src/i18n/locales'), { recursive: true })
  script = path.join(application, 'scripts/add-missing-keys.mjs')
  await fs.copyFile(new URL('../add-missing-keys.mjs', import.meta.url), script)
  patchFile = path.join(root, 'patch.json')
  patch = Object.fromEntries(
    locales.map((locale) => [locale, { 'Hello {{name}}': `Hello {{name}} ${locale}` }]),
  )
  patch.en!['Hello {{name}}'] = 'Hello {{name}}'
  for (const locale of locales)
    await fs.writeFile(
      path.join(application, `src/i18n/locales/${locale}.json`),
      `${JSON.stringify({ translation: { Existing: `Existing ${locale}` } }, null, 2)}\n`,
    )
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function runPatch(args: string[] = []) {
  await fs.writeFile(patchFile, JSON.stringify(patch))
  return spawnSync(process.execPath, [script, patchFile, ...args], { encoding: 'utf8' })
}

async function localeContents() {
  return Promise.all(
    locales.map((locale) =>
      fs.readFile(path.join(application, `src/i18n/locales/${locale}.json`), 'utf8'),
    ),
  )
}

it('validates a patch in check mode without writing locales or backups', async () => {
  const before = await localeContents()
  expect((await runPatch(['--check'])).status).toBe(0)
  expect(await localeContents()).toEqual(before)
  expect(await fs.stat(path.join(root, '.local-tests')).catch(() => null)).toBeNull()
})

it('applies all seven translations, preserves existing keys, backs up originals, and is idempotent', async () => {
  const before = await localeContents()
  expect((await runPatch()).status).toBe(0)
  const after = await localeContents()
  for (const [index, locale] of locales.entries()) {
    expect(JSON.parse(after[index]!).translation).toEqual({
      Existing: `Existing ${locale}`,
      'Hello {{name}}': patch[locale]!['Hello {{name}}'],
    })
  }
  const backups = path.join(root, '.local-tests/consumer-i18n/backups')
  const names = await fs.readdir(backups)
  expect(names).toHaveLength(1)
  expect(
    await Promise.all(
      locales.map((locale) => fs.readFile(path.join(backups, names[0]!, `${locale}.json`), 'utf8')),
    ),
  ).toEqual(before)
  expect((await runPatch()).status).toBe(0)
  expect(await localeContents()).toEqual(after)
  expect(await fs.readdir(backups)).toEqual(names)
})

it.each(['missing-language', 'missing-key', 'empty-value', 'placeholder', 'english-source'])(
  'rejects %s before touching any locale',
  async (failure) => {
    const before = await localeContents()
    if (failure === 'missing-language') delete patch.vi
    if (failure === 'missing-key') patch.vi = {}
    if (failure === 'empty-value') patch.vi!['Hello {{name}}'] = ' '
    if (failure === 'placeholder') patch.vi!['Hello {{name}}'] = 'Hello {{other}}'
    if (failure === 'english-source') patch.en!['Hello {{name}}'] = 'Hi {{name}}'
    expect((await runPatch()).status).not.toBe(0)
    expect(await localeContents()).toEqual(before)
  },
)

it('rejects a concurrent update lock without touching locale files', async () => {
  const before = await localeContents()
  await fs.writeFile(path.join(application, 'src/i18n/locales/.translation-update.lock'), '')
  expect((await runPatch()).status).not.toBe(0)
  expect(await localeContents()).toEqual(before)
})

it('restores already replaced locales if a later filesystem rename fails', async () => {
  const before = await localeContents()
  await fs.writeFile(patchFile, JSON.stringify(patch))
  const preload = path.join(root, 'fail-rename.mjs')
  await fs.writeFile(
    preload,
    `import fs from 'node:fs/promises'; const rename = fs.rename; let count = 0; fs.rename = async (...args) => { if (++count === 2) throw new Error('Injected rename failure'); return rename(...args) }`,
  )
  const result = spawnSync(process.execPath, ['--import', preload, script, patchFile], {
    encoding: 'utf8',
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Injected rename failure')
  expect(await localeContents()).toEqual(before)
  expect((await fs.readdir(path.join(application, 'src/i18n/locales'))).sort()).toEqual(
    locales.map((locale) => `${locale}.json`).sort(),
  )
})
