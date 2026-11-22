import { core } from '@h-ai/core'
import enUS from '../../messages/en-US.json' with { type: 'json' }
import jaJP from '../../messages/ja-JP.json' with { type: 'json' }
import koKR from '../../messages/ko-KR.json' with { type: 'json' }
import zhCN from '../../messages/zh-CN.json' with { type: 'json' }

const messages = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP, 'ko-KR': koKR }

/** 保留应用已有的四语言能力；Hai 默认消息工厂仅内置中英日。 */
export function serverM(key: keyof typeof zhCN, locale = core.i18n.getGlobalLocale()): string {
  const code = locale.startsWith('en') ? 'en-US' : locale.startsWith('ja') ? 'ja-JP' : locale.startsWith('ko') ? 'ko-KR' : 'zh-CN'
  return messages[code][key]
}
