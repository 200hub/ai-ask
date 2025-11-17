/**
 * i18n 国际化模块
 * 提供多语言支持
 */

import { logger } from '$lib/utils/logger'
import { get, writable } from 'svelte/store'
import { zhCN } from './locales/zh-CN'

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

const translations = writable<TranslationStore>({
  'zh-CN': zhCN,
})

const loadedLocales = new Set<Locale>([DEFAULT_LOCALE])

const localeLoaders: Record<Locale, () => Promise<TranslationDict>> = {
  'zh-CN': async () => zhCN,
  'en-US': async () => (await import('./locales/en-US')).enUS,
  'ja-JP': async () => (await import('./locales/ja-JP')).jaJP,
  'ko-KR': async () => (await import('./locales/ko-KR')).koKR,
}

async function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) {
    return
  }

  try {
    const data = await localeLoaders[locale]?.()
    if (data) {
      translations.update(current => ({
        ...current,
        [locale]: data,
      }))
      loadedLocales.add(locale)
    }
  }
  catch (error) {
    logger.error('Failed to load locale', locale, error)
  }
}

// 当前语言
const currentLocale = writable<Locale>(DEFAULT_LOCALE)

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
 * 翻译函数 - 使用 get() 避免内存泄漏
 */
function createTranslator(): Translator {
  return (key: string, fallback?: string): string => {
    // 使用 get() 函数同步读取 store 值，避免创建订阅
    const locale = get(currentLocale)
    const translationData = get(translations)

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

/**
 * i18n 实例
 */
export const i18n = {
  // 当前语言
  locale: {
    subscribe: currentLocale.subscribe,
    set: (locale: Locale) => {
      if (!SUPPORTED_LOCALES.some(l => l.code === locale)) {
        return
      }

      if (loadedLocales.has(locale)) {
        currentLocale.set(locale)
        return
      }

      void ensureLocaleLoaded(locale).then(() => {
        currentLocale.set(locale)
      })
    },
    get: () => {
      let value: Locale = DEFAULT_LOCALE
      currentLocale.subscribe(v => (value = v))()
      return value
    },
  },

  // 翻译函数 - 直接暴露
  t,

  // 加载翻译数据
  loadTranslations: (locale: Locale, data: TranslationDict) => {
    translations.update(current => ({
      ...current,
      [locale]: {
        ...(current[locale] ?? {}),
        ...data,
      },
    }))
    loadedLocales.add(locale)
  },

  // 设置所有翻译数据
  setTranslations: (data: Partial<Record<Locale, TranslationDict>>) => {
    const next: TranslationStore = {
      ...data,
      [DEFAULT_LOCALE]: data[DEFAULT_LOCALE] ?? zhCN,
    }

    translations.set(next)

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
