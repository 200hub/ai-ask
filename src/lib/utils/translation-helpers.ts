/**
 * Translation platform helper functions
 */

import type { Locale } from '$lib/i18n'
import { TRANSLATION_LANG_CODES } from './constants'

/**
 * Build translation URL with source and target language codes
 *
 * @param platformId - Translation platform ID (google, deepl, etc.)
 * @param baseUrl - Base URL of the translation platform
 * @param targetLocale - Target language locale (from i18n)
 * @param sourceText - Optional source text to include in URL
 * @returns URL with appropriate language parameters
 */
export function buildTranslationUrl(
  platformId: keyof typeof TRANSLATION_LANG_CODES,
  baseUrl: string,
  targetLocale: Locale,
  sourceText?: string,
): string {
  const langMap = TRANSLATION_LANG_CODES[platformId]
  if (!langMap) {
    return baseUrl
  }

  const targetLang = langMap[targetLocale]
  if (!targetLang) {
    return baseUrl
  }

  // Source language is always auto-detect
  const sourceLang = 'auto'

  // Build URL based on platform
  switch (platformId) {
    case 'google':
      // https://translate.google.com/?sl=auto&tl=zh-CN&op=translate&text=...
      return `https://translate.google.com/?sl=${sourceLang}&tl=${targetLang}&op=translate${
        sourceText ? `&text=${encodeURIComponent(sourceText)}` : ''
      }`

    case 'deepl':
      // https://www.deepl.com/translator#auto/zh/...
      return `https://www.deepl.com/translator#${sourceLang}/${targetLang}/${
        sourceText ? encodeURIComponent(sourceText) : ''
      }`

    case 'youdao':
      // https://fanyi.youdao.com/?type=AUTO&doctype=text
      // Youdao doesn't support URL-based language selection reliably
      return baseUrl

    case 'baidu':
      // https://fanyi.baidu.com/#auto/zh
      return `https://fanyi.baidu.com/#${sourceLang}/${targetLang}`

    case 'bing':
      // https://www.bing.com/translator?from=auto-detect&to=zh-Hans
      return `https://www.bing.com/translator?from=auto-detect&to=${targetLang}${
        sourceText ? `&text=${encodeURIComponent(sourceText)}` : ''
      }`

    default:
      return baseUrl
  }
}

/**
 * Get target language code for a specific platform
 *
 * @param platformId - Translation platform ID
 * @param locale - Target language locale (from i18n)
 * @returns Platform-specific language code or undefined
 */
export function getTargetLangCode(
  platformId: keyof typeof TRANSLATION_LANG_CODES,
  locale: Locale,
): string | undefined {
  const langMap = TRANSLATION_LANG_CODES[platformId]
  return langMap?.[locale]
}

/**
 * Check if a platform supports a specific locale
 *
 * @param platformId - Translation platform ID
 * @param locale - Target language locale
 * @returns Whether the platform supports the locale
 */
export function isPlatformLocaleSupported(
  platformId: keyof typeof TRANSLATION_LANG_CODES,
  locale: Locale,
): boolean {
  const langMap = TRANSLATION_LANG_CODES[platformId]
  return langMap ? locale in langMap : false
}

/**
 * Retry translation injection with exponential backoff
 *
 * @param fn - Async function to execute (injection function)
 * @param maxRetries - Maximum number of retry attempts
 * @param baseDelay - Base delay in milliseconds between retries
 * @returns Promise resolving to the result
 */
export async function retryTranslation<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 600,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()

      // Check if result is empty string (translation not ready)
      if (typeof result === 'string' && result === '' && attempt < maxRetries) {
        throw new Error('Translation result empty, retrying')
      }

      return result
    }
    catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't delay after last attempt
      if (attempt < maxRetries) {
        // Exponential backoff: baseDelay * 2^attempt
        const delay = baseDelay * 2 ** attempt
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Translation failed after retries')
}
