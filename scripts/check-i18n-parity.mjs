/**
 * 检查四个 locale 文件的 key 是否完全一致
 * 用法: node scripts/check-i18n-parity.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/ai-ask-desktop/messages')

function loadLocale(file) {
  return JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'))
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out)
    }
    else {
      out[key] = true
    }
  }
  return out
}

const locales = {
  'zh-CN': flatten(loadLocale('zh-CN.json')),
  'en-US': flatten(loadLocale('en-US.json')),
  'ja-JP': flatten(loadLocale('ja-JP.json')),
  'ko-KR': flatten(loadLocale('ko-KR.json')),
}

const reference = Object.keys(locales['zh-CN']).sort()
let totalIssues = 0

for (const [code, keys] of Object.entries(locales)) {
  const missing = reference.filter(k => !(k in keys))
  const extra = Object.keys(keys).filter(k => !locales['zh-CN'][k])
  console.log(`${code}: missing=${missing.length}, extra=${extra.length}`)
  if (missing.length) {
    console.log(`  missing (first 20):`, missing.slice(0, 20))
    totalIssues += missing.length
  }
  if (extra.length) {
    console.log(`  extra (first 20):`, extra.slice(0, 20))
    totalIssues += extra.length
  }
}

if (totalIssues > 0) {
  console.error(`\n❌ i18n parity check failed: ${totalIssues} issues`)
  process.exit(1)
}
else {
  console.log('\n✅ All locales have identical key sets')
}
