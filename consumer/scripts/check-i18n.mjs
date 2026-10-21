import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
const langs = ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']
const dictionaries = Object.fromEntries(
  await Promise.all(
    langs.map(async (lang) => [
      lang,
      JSON.parse(await fs.readFile(`src/i18n/locales/${lang}.json`, 'utf8')).translation,
    ]),
  ),
)
const failures = []
for (const lang of langs) {
  for (const [key, source] of Object.entries(dictionaries.en)) {
    const value = dictionaries[lang][key]
    if (typeof value !== 'string' || !value.trim()) {
      failures.push(`${lang}: missing ${key}`)
      continue
    }
    const markers = (text) =>
      [...text.matchAll(/{{\s*([^}]+)\s*}}/g)]
        .map((match) => match[1].trim())
        .sort()
        .join('|')
    if (markers(source) !== markers(value)) failures.push(`${lang}: placeholders differ for ${key}`)
  }
}

// Verify literals at UI call sites as well as dictionary parity. Dynamic notices
// are stored as source keys, so include their setters before they reach t(value).
async function checkSource(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['locales', '__tests__'].includes(entry.name)) continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await checkSource(file)
      continue
    }
    if (!/\.tsx?$/.test(file)) continue
    const source = ts.createSourceFile(
      file,
      await fs.readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    function verifyLiteral(node) {
      if (!node) return
      if (ts.isStringLiteral(node) && node.text && !dictionaries.en[node.text])
        failures.push(`${file}: missing source key ${node.text}`)
      if (ts.isConditionalExpression(node)) {
        verifyLiteral(node.whenTrue)
        verifyLiteral(node.whenFalse)
      }
    }
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^(t|setValidation|setNotice|setDraftNotice|setNameNotice)$/.test(node.expression.text)
      )
        verifyLiteral(node.arguments[0])
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
await checkSource('src')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else
  console.log(
    `Verified ${Object.keys(dictionaries.en).length} keys in all seven locales, including interpolation placeholders.`,
  )
