/**
 * i18n 国际化模块
 * 提供多语言支持
 */

import type { InterpolationParams } from '@h-ai/core'
import { logger } from '$lib/utils/logger'
import { core } from '@h-ai/core'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import zhCN from '../../../messages/zh-CN.json'

// 支持的语言类型
export type Locale = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR'

// 翻译键类型
export type TranslationKey = string

// 翻译字典类型
export interface TranslationDict {
  [key: string]: string | TranslationDict
}

// 翻译函数类型
export type Translator = (key: string, fallback?: string) => string

// 语言配置
export interface LocaleConfig {
  code: Locale
  name: string
  nativeName: string
}

// 支持的语言列表
export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어' },
]

// 默认语言
export const DEFAULT_LOCALE: Locale = 'zh-CN'

// 翻译数据存储（按需加载各语言）
type TranslationStore = Partial<Record<Locale, TranslationDict>>

let translations = $state<TranslationStore>({ 'zh-CN': zhCN })

const loadedLocales = new SvelteSet<Locale>([DEFAULT_LOCALE])
const pendingLoads = new SvelteMap<Locale, Promise<void>>()
let localeRequest = 0

const localeLoaders: Record<Locale, () => Promise<TranslationDict>> = {
  'zh-CN': async () => zhCN,
  'en-US': async () => (await import('../../../messages/en-US.json')).default,
  'ja-JP': async () => (await import('../../../messages/ja-JP.json')).default,
  'ko-KR': async () => (await import('../../../messages/ko-KR.json')).default,
}

async function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) {
    return
  }

  const pending = pendingLoads.get(locale)
  if (pending) {
    return pending
  }
  const load = (async () => {
    try {
      const data = await localeLoaders[locale]()
      translations = { ...translations, [locale]: data }
      loadedLocales.add(locale)
    }
    catch (error) {
      logger.error('Failed to load locale', { locale, error })
      throw error
    }
    finally {
      pendingLoads.delete(locale)
    }
  })()
  pendingLoads.set(locale, load)
  return load
}

// 当前语言
let currentLocale = $state<Locale>(DEFAULT_LOCALE)

/**
 * 获取嵌套对象的值
 */
function getNestedValue(obj: TranslationDict, path: string): string | undefined {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current && typeof current === 'object' && current !== null && key in current) {
      current = (current as Record<string, unknown>)[key]
    }
    else {
      return undefined
    }
  }

  return typeof current === 'string' ? current : undefined
}

/**
 * 同步读取 Runes 状态，组件内调用时保留响应性。
 * Core 消息获取器仅支持中英日语言，业务门面保留韩语和嵌套字典回退。
 */
function createTranslator(): Translator {
  return (key: string, fallback?: string): string => {
    const locale = currentLocale
    const translationData = translations

    const localeData = translationData[locale]
    const translation = localeData ? getNestedValue(localeData, key) : undefined
    if (translation) {
      return translation
    }

    // 尝试使用默认语言
    if (locale !== DEFAULT_LOCALE) {
      const defaultData = translationData[DEFAULT_LOCALE]
      const defaultTranslation = getNestedValue(defaultData ?? zhCN, key)
      if (defaultTranslation) {
        return defaultTranslation
      }
    }

    // 返回 fallback 或 key
    return fallback || key
  }
}

// 创建翻译器
const t = createTranslator()

/** 沿用 Hai 占位符语义，补齐四语言及嵌套业务字典的参数格式化。 */
function format(key: string, params?: InterpolationParams): string {
  const template = t(key)
  if (!params)
    return template
  return template.replace(/\{(\w+)\}/g, (placeholder, paramKey: string) => {
    return Object.hasOwn(params, paramKey) ? String(params[paramKey]) : placeholder
  })
}

/**
 * i18n 实例
 */
export const i18n = {
  // 当前语言
  locale: {
    set: async (locale: Locale) => {
      if (!SUPPORTED_LOCALES.some(l => l.code === locale)) {
        return
      }

      const request = ++localeRequest
      await ensureLocaleLoaded(locale)
      if (request !== localeRequest) {
        return
      }
      currentLocale = locale
      core.i18n.setGlobalLocale(locale)
    },
    get: () => currentLocale,
  },

  // 翻译函数 - 直接暴露
  t,
  format,

  // 加载翻译数据
  loadTranslations: (locale: Locale, data: TranslationDict) => {
    translations = { ...translations, [locale]: { ...(translations[locale] ?? {}), ...data } }
    loadedLocales.add(locale)
  },

  // 设置所有翻译数据
  setTranslations: (data: Partial<Record<Locale, TranslationDict>>) => {
    const next: TranslationStore = {
      ...data,
      [DEFAULT_LOCALE]: data[DEFAULT_LOCALE] ?? zhCN,
    }

    translations = next

    loadedLocales.clear()
    loadedLocales.add(DEFAULT_LOCALE)

    Object.keys(next).forEach((code) => {
      loadedLocales.add(code as Locale)
    })
  },

  // 获取支持的语言列表
  getSupportedLocales: () => SUPPORTED_LOCALES,

  // 检测浏览器语言
  detectLocale: (): Locale => {
    if (typeof navigator === 'undefined') {
      return DEFAULT_LOCALE
    }

    const browserLang = navigator.language

    // 精确匹配
    const exactMatch = SUPPORTED_LOCALES.find(l => l.code === browserLang)
    if (exactMatch) {
      return exactMatch.code
    }

    // 部分匹配（例如 en 匹配 en-US）
    const langCode = browserLang.split('-')[0]
    const partialMatch = SUPPORTED_LOCALES.find(l => l.code.startsWith(langCode))
    if (partialMatch) {
      return partialMatch.code
    }

    return DEFAULT_LOCALE
  },
}

// 默认导出
export default i18n
