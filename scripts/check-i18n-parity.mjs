/**
 * 检查四个 locale 文件的 key 是否完全一致
 * 用法: node scripts/check-i18n-parity.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(process.cwd(), 'src/lib/i18n/locales')

/** 用极简 TS->JS 转换：去掉 `as const`、export 关键字、类型注解后用 eval 解析对象字面量 */
function loadLocale(file) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  // 提取 `export const xxxX = { ... }`（结构形如对象字面量）
  const match = src.match(/export\s+const\s+\w+\s*(?::[^=]+)?=\s*(\{[\s\S]*?\})\s*(?:as\s+const\s*)?;?\s*$/m)
  if (!match)
    throw new Error(`Cannot parse: ${file}`)
  // 在严格模式下使用 Function 构造而非 eval
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[1]});`)()
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
  'zh-CN': flatten(loadLocale('zh-CN.ts')),
  'en-US': flatten(loadLocale('en-US.ts')),
  'ja-JP': flatten(loadLocale('ja-JP.ts')),
  'ko-KR': flatten(loadLocale('ko-KR.ts')),
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
