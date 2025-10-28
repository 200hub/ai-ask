/**
 * 内置AI平台配置
 */
import type { AIPlatform, TranslationPlatform } from "../types/platform";

/**
 * 内置AI平台列表
 */
export const BUILT_IN_AI_PLATFORMS: AIPlatform[] = [
  // 国际平台
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: 'https://cdn.oaistatic.com/_next/static/media/apple-touch-icon.59f2e898.png',
    url: 'https://chat.openai.com',
    enabled: true,
    isCustom: false,
    sortOrder: 1,
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: 'https://claude.ai/favicon.ico',
    url: 'https://claude.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 2,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: 'https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06b.png',
    url: 'https://gemini.google.com',
    enabled: true,
    isCustom: false,
    sortOrder: 3,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    icon: 'https://www.perplexity.ai/favicon.svg',
    url: 'https://www.perplexity.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 4,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    icon: 'https://copilot.microsoft.com/favicon.ico',
    url: 'https://copilot.microsoft.com',
    enabled: true,
    isCustom: false,
    sortOrder: 5,
  },
  {
    id: 'poe',
    name: 'Poe',
    icon: 'https://poe.com/pwa/icon-256x256.png',
    url: 'https://poe.com',
    enabled: true,
    isCustom: false,
    sortOrder: 6,
  },
  // 国内平台
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: 'https://chat.deepseek.com/favicon.ico',
    url: 'https://chat.deepseek.com',
    enabled: true,
    isCustom: false,
    sortOrder: 7,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: 'https://statics.moonshot.cn/kimi-chat/favicon.ico',
    url: 'https://kimi.moonshot.cn',
    enabled: true,
    isCustom: false,
    sortOrder: 8,
  },
  {
    id: 'tongyi',
    name: '通义千问',
    icon: 'https://img.alicdn.com/imgextra/i1/O1CN01Yt3QXn1EyVkW3xXLu_!!6000000000419-2-tps-128-128.png',
    url: 'https://tongyi.aliyun.com/qianwen',
    enabled: true,
    isCustom: false,
    sortOrder: 9,
  },
  {
    id: 'wenxin',
    name: '文心一言',
    icon: 'https://nlp-eb.cdn.bcebos.com/logo/favicon.ico',
    url: 'https://yiyan.baidu.com',
    enabled: true,
    isCustom: false,
    sortOrder: 10,
  },
  {
    id: 'doubao',
    name: '豆包',
    icon: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/logo-icon.png',
    url: 'https://www.doubao.com',
    enabled: true,
    isCustom: false,
    sortOrder: 11,
  },
  {
    id: 'chatglm',
    name: '智谱清言',
    icon: 'https://chatglm.cn/favicon.ico',
    url: 'https://chatglm.cn',
    enabled: true,
    isCustom: false,
    sortOrder: 12,
  },
  {
    id: 'xinghuo',
    name: '讯飞星火',
    icon: 'https://xinghuo.xfyun.cn/favicon.ico',
    url: 'https://xinghuo.xfyun.cn',
    enabled: true,
    isCustom: false,
    sortOrder: 13,
  },
  {
    id: 'yuanbao',
    name: '腾讯元宝',
    icon: 'https://yuanbao.tencent.com/favicon.ico',
    url: 'https://yuanbao.tencent.com',
    enabled: true,
    isCustom: false,
    sortOrder: 14,
  },
];

/**
 * 内置翻译平台列表
 */
export const BUILT_IN_TRANSLATION_PLATFORMS: TranslationPlatform[] = [
  {
    id: 'google',
    name: 'Google翻译',
    icon: 'https://ssl.gstatic.com/translate/favicon.ico',
    url: 'https://translate.google.com',
    enabled: true,
    supportLanguages: ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    icon: 'https://www.deepl.com/img/favicon/favicon_96.png',
    url: 'https://www.deepl.com/translator',
    enabled: true,
    supportLanguages: [
      "zh-CN",
      "en",
      "ja",
      "de",
      "fr",
      "es",
      "it",
      "nl",
      "pl",
      "pt",
      "ru",
    ],
  },
  {
    id: 'youdao',
    name: '有道翻译',
    icon: 'https://shared.ydstatic.com/images/favicon.ico',
    url: 'https://fanyi.youdao.com',
    enabled: true,
    supportLanguages: ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"],
  },
  {
    id: 'baidu',
    name: '百度翻译',
    icon: 'https://fanyi.baidu.com/favicon.ico',
    url: 'https://fanyi.baidu.com',
    enabled: true,
    supportLanguages: [
      "zh-CN",
      "en",
      "ja",
      "ko",
      "fr",
      "de",
      "es",
      "ru",
      "th",
      "ar",
    ],
  },
  {
    id: 'bing',
    name: '微软翻译',
    icon: 'https://www.bing.com/favicon.ico',
    url: 'https://www.bing.com/translator',
    enabled: true,
    supportLanguages: [
      "zh-CN",
      "en",
      "ja",
      "ko",
      "fr",
      "de",
      "es",
      "ru",
      "ar",
      "hi",
    ],
  },
];

/**
 * 应用信息
 */
export const APP_INFO = {
  name: "AI Ask",
  version: "1.0.0",
  description: "一个简洁高效的AI问答助手",
  author: "AI Ask Team",
  repository: "https://github.com/yourusername/ai-ask",
};

/**
 * 快捷键列表（用于配置界面展示）
 */
export const AVAILABLE_SHORTCUTS = [
  "CommandOrControl+Shift+A",
  "CommandOrControl+Shift+Q",
  "CommandOrControl+Shift+W",
  "CommandOrControl+Shift+E",
  "CommandOrControl+Alt+A",
  "CommandOrControl+Alt+Q",
  "Alt+Shift+A",
  "Alt+Shift+Q",
];

/**
 * 翻译快捷键列表
 */
export const TRANSLATION_SHORTCUTS = [
  "CommandOrControl+Shift+T",
  "CommandOrControl+Shift+Y",
  "CommandOrControl+Alt+T",
  "Alt+Shift+T",
];

/**
 * 默认窗口配置
 */
export const DEFAULT_WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  minWidth: 900,
  minHeight: 600,
};

/**
 * 侧边栏配置
 */
export const SIDEBAR_CONFIG = {
  width: 70,
  iconSize: 40,
  gap: 12
};
