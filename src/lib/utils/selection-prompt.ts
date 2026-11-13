import type { Locale } from '$lib/i18n'

const EXPLANATION_PROMPTS = {
  'zh-CN': '请解释以下内容：',
  'en-US': 'Please explain the following:',
  'ja-JP': '以下の内容を説明してください：',
  'ko-KR': '다음 내용을 설명해 주세요:',
} satisfies Record<Locale, string>

export function buildSelectionExplanationPrompt(text: string, locale?: Locale): string {
  const prefix = EXPLANATION_PROMPTS[locale ?? 'zh-CN']
  return `${prefix}\n\n${text}`
}
