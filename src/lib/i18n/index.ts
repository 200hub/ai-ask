/**
 * i18n 国际化模块
 * 提供多语言支持
 */

import { writable, derived } from "svelte/store";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";
import { jaJP } from "./locales/ja-JP";
import { koKR } from "./locales/ko-KR";

// 支持的语言类型
export type Locale = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

// 翻译键类型
export type TranslationKey = string;

// 翻译字典类型
export interface TranslationDict {
  [key: string]: string | TranslationDict;
}

// 语言配置
export interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
}

// 支持的语言列表
export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "en-US", name: "English (US)", nativeName: "English" },
  { code: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { code: "ko-KR", name: "Korean", nativeName: "한국어" },
];

// 默认语言
export const DEFAULT_LOCALE: Locale = "zh-CN";

// 翻译数据存储（预加载所有语言）
const translations = writable<Record<Locale, TranslationDict>>({
  "zh-CN": zhCN,
  "en-US": enUS,
  "ja-JP": jaJP,
  "ko-KR": koKR,
});

// 当前语言
const currentLocale = writable<Locale>(DEFAULT_LOCALE);

/**
 * 获取嵌套对象的值
 */
function getNestedValue(
  obj: TranslationDict,
  path: string,
): string | undefined {
  const keys = path.split(".");
  let current: any = obj;

  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

/**
 * 翻译函数
 */
function createTranslator() {
  return derived([currentLocale, translations], ([$locale, $translations]) => {
    return (key: string, fallback?: string): string => {
      const translation = getNestedValue($translations[$locale], key);
      if (translation) {
        return translation;
      }

      // 尝试使用默认语言
      if ($locale !== DEFAULT_LOCALE) {
        const defaultTranslation = getNestedValue(
          $translations[DEFAULT_LOCALE],
          key,
        );
        if (defaultTranslation) {
          return defaultTranslation;
        }
      }

      // 返回 fallback 或 key
      return fallback || key;
    };
  });
}

// 创建翻译器
const t = createTranslator();

/**
 * i18n 实例
 */
export const i18n = {
  // 当前语言
  locale: {
    subscribe: currentLocale.subscribe,
    set: (locale: Locale) => {
      if (SUPPORTED_LOCALES.some((l) => l.code === locale)) {
        currentLocale.set(locale);
      }
    },
    get: () => {
      let value: Locale = DEFAULT_LOCALE;
      currentLocale.subscribe((v) => (value = v))();
      return value;
    },
  },

  // 翻译函数
  t: {
    subscribe: t.subscribe,
  },

  // 加载翻译数据
  loadTranslations: (locale: Locale, data: TranslationDict) => {
    translations.update((current) => ({
      ...current,
      [locale]: { ...current[locale], ...data },
    }));
  },

  // 设置所有翻译数据
  setTranslations: (data: Record<Locale, TranslationDict>) => {
    translations.set(data);
  },

  // 获取支持的语言列表
  getSupportedLocales: () => SUPPORTED_LOCALES,

  // 检测浏览器语言
  detectLocale: (): Locale => {
    if (typeof navigator === "undefined") {
      return DEFAULT_LOCALE;
    }

    const browserLang = navigator.language;

    // 精确匹配
    const exactMatch = SUPPORTED_LOCALES.find((l) => l.code === browserLang);
    if (exactMatch) {
      return exactMatch.code;
    }

    // 部分匹配（例如 en 匹配 en-US）
    const langCode = browserLang.split("-")[0];
    const partialMatch = SUPPORTED_LOCALES.find((l) =>
      l.code.startsWith(langCode),
    );
    if (partialMatch) {
      return partialMatch.code;
    }

    return DEFAULT_LOCALE;
  },
};

// 默认导出
export default i18n;
