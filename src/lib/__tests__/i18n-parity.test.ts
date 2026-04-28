import type { TranslationDict } from '../i18n'
/**
 * i18n key 一致性测试
 * 确保四种 locale 的 key 集合完全相同，避免漏翻译。
 */
import { describe, expect, it } from 'vitest'
import { enUS } from '../i18n/locales/en-US'
import { jaJP } from '../i18n/locales/ja-JP'
import { koKR } from '../i18n/locales/ko-KR'
import { zhCN } from '../i18n/locales/zh-CN'

/** 将嵌套字典展开为扁平 key 集合（点号路径） */
function flatten(dict: TranslationDict, prefix = '', out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(dict)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      flatten(value as TranslationDict, fullKey, out)
    }
    else {
      out.add(fullKey)
    }
  }
  return out
}

describe('i18n locale parity', () => {
  const zh = flatten(zhCN as unknown as TranslationDict)
  const en = flatten(enUS as unknown as TranslationDict)
  const ja = flatten(jaJP as unknown as TranslationDict)
  const ko = flatten(koKR as unknown as TranslationDict)

  function diff(a: Set<string>, b: Set<string>): string[] {
    return [...a].filter(k => !b.has(k)).sort()
  }

  it('en-US has same keys as zh-CN', () => {
    expect(diff(zh, en)).toEqual([])
    expect(diff(en, zh)).toEqual([])
  })

  it('ja-JP has same keys as zh-CN', () => {
    expect(diff(zh, ja)).toEqual([])
    expect(diff(ja, zh)).toEqual([])
  })

  it('ko-KR has same keys as zh-CN', () => {
    expect(diff(zh, ko)).toEqual([])
    expect(diff(ko, zh)).toEqual([])
  })
})
