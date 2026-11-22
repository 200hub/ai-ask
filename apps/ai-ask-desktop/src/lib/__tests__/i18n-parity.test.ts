import type { TranslationDict } from '../i18n'
import { core } from '@h-ai/core'
/**
 * i18n key 一致性测试
 * 确保四种 locale 的 key 集合完全相同，避免漏翻译。
 */
import { describe, expect, it } from 'vitest'
import enUS from '../../../messages/en-US.json'
import jaJP from '../../../messages/ja-JP.json'
import koKR from '../../../messages/ko-KR.json'
import zhCN from '../../../messages/zh-CN.json'
import { i18n } from '../i18n'

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
  it('loads the configured task editor labels before the locale promise resolves', async () => {
    try {
      await i18n.locale.set('en-US')
      expect(i18n.t('desktopNotes.todo.deadline')).toBe('Due date')
      await i18n.locale.set('ja-JP')
      expect(i18n.t('desktopNotes.todo.deadline')).toBe('期限')
      await i18n.locale.set('ko-KR')
      expect(i18n.t('desktopNotes.todo.deadline')).toBe('마감일')
      expect(core.i18n.getGlobalLocale()).toBe('ko-KR')
    }
    finally {
      await i18n.locale.set('zh-CN')
    }
  })
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
