import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const locales = ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']
const applicationRoot = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(applicationRoot, 'src/i18n/locales')
const [patchFile, option, ...extra] = process.argv.slice(2)
if (!patchFile || (option && option !== '--check') || extra.length)
  throw new Error('Usage: node scripts/add-missing-keys.mjs <seven-language-patch.json> [--check]')

function dictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object of translation strings.`)
  for (const [key, text] of Object.entries(value)) {
    if (!key.trim() || typeof text !== 'string' || !text.trim())
      throw new Error(`${label}: each key and translation must be a non-empty string.`)
  }
  return value
}

function placeholders(text) {
  return [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)]
    .map((match) => match[1].trim())
    .sort()
    .join('|')
}

const patch = JSON.parse(await fs.readFile(path.resolve(patchFile), 'utf8'))
if (
  !patch ||
  typeof patch !== 'object' ||
  Array.isArray(patch) ||
  Object.keys(patch).length !== locales.length ||
  locales.some((locale) => !Object.hasOwn(patch, locale))
)
  throw new Error('The patch must contain exactly en, zh, zh-TW, fr, ja, ru and vi objects.')

const source = dictionary(patch.en, 'en')
const keys = Object.keys(source)
for (const locale of locales) {
  const translations = dictionary(patch[locale], locale)
  if (
    Object.keys(translations).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(translations, key))
  )
    throw new Error(`${locale}: every locale must contain the same patch keys.`)
  for (const key of keys) {
    if (source[key] !== key) throw new Error(`en: source value must match its English key: ${key}`)
    if (placeholders(source[key]) !== placeholders(translations[key]))
      throw new Error(`${locale}: interpolation placeholders differ for ${key}`)
  }
}

// Read and validate every existing locale before preparing any writes.
const files = []
for (const locale of locales) {
  const file = path.join(directory, `${locale}.json`)
  const original = await fs.readFile(file, 'utf8')
  const document = JSON.parse(original)
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error(`${locale}: locale document must be an object.`)
  const current = dictionary(document.translation, `${locale}.translation`)
  const updated = Object.fromEntries([...Object.entries(current), ...Object.entries(patch[locale])])
  document.translation = Object.fromEntries(
    Object.entries(updated).sort(([a], [b]) => a.localeCompare(b)),
  )
  const next = `${JSON.stringify(document, null, 2)}\n`
  files.push({ locale, file, original, next, changed: next !== original })
}

const changed = files.filter((file) => file.changed)
if (option === '--check' || !changed.length) {
  console.log(
    `Validated ${keys.length} patch keys in seven locales; ${changed.length} files would change.`,
  )
} else {
  const lockPath = path.join(directory, '.translation-update.lock')
  let lock
  try {
    lock = await fs.open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another translation update is running. Verify it has stopped before removing the locale lock.',
      )
    throw error
  }
  const temporaryFiles = []
  const applied = []
  try {
    const backupRoot = path.resolve(applicationRoot, '../.local-tests/consumer-i18n/backups')
    await fs.mkdir(backupRoot, { recursive: true })
    const backup = await fs.mkdtemp(path.join(backupRoot, 'update-'))
    // Keep all seven original files, even when only their ordering would change.
    for (const file of files)
      await fs.writeFile(path.join(backup, `${file.locale}.json`), file.original, {
        flag: 'wx',
        mode: 0o600,
      })
    console.log(`Original locales backed up to ${backup}`)
    for (const file of changed) {
      const temporary = `${file.file}.${path.basename(backup)}.tmp`
      await fs.writeFile(temporary, file.next, {
        flag: 'wx',
        mode: (await fs.stat(file.file)).mode,
      })
      temporaryFiles.push(temporary)
      file.temporary = temporary
    }
    // Detect an editor or another tool modifying a locale since the initial read.
    for (const file of files) {
      if ((await fs.readFile(file.file, 'utf8')) !== file.original)
        throw new Error(
          `${file.locale}: locale changed while preparing the update. No patch was applied.`,
        )
    }
    try {
      for (const file of changed) {
        await fs.rename(file.temporary, file.file)
        applied.push(file)
      }
    } catch (error) {
      // A filesystem cannot atomically rename seven files together. Restore each
      // completed rename if the batch fails; the backup survives process interruption.
      for (const file of applied.toReversed()) {
        await fs.writeFile(file.temporary, file.original, {
          flag: 'wx',
          mode: (await fs.stat(file.file)).mode,
        })
        await fs.rename(file.temporary, file.file)
      }
      throw error
    }
    console.log(
      `Applied ${keys.length} patch keys across ${changed.length} locale files. Run bun run i18n:sync and bun run i18n:check.`,
    )
  } finally {
    for (const temporary of temporaryFiles) await fs.rm(temporary, { force: true })
    await lock.close()
    await fs.rm(lockPath, { force: true })
  }
}
