import fs from 'node:fs/promises'
import path from 'node:path'
const directory = path.resolve('src/i18n/locales')
for (const locale of ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']) {
  const file = path.join(directory, `${locale}.json`)
  const json = JSON.parse(await fs.readFile(file, 'utf8'))
  json.translation = Object.fromEntries(
    Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b)),
  )
  await fs.writeFile(file, JSON.stringify(json, null, 2) + '\n')
}
console.log('Seven independent consumer locales normalized.')
