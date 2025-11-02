/**
 * 内置AI平台配置
 */
import type { AIPlatform, TranslationPlatform } from "../types/platform";

// 引入静态图标，确保 Tauri 安全策略下也能正常显示
import chatgptIcon from "$lib/assets/platform-icons/chatgpt.svg";
import anthropicIcon from "$lib/assets/platform-icons/anthropic.svg";
import geminiIcon from "$lib/assets/platform-icons/gemini.svg";
import copilotIcon from "$lib/assets/platform-icons/copilot.svg";
import grokIcon from "$lib/assets/platform-icons/grok.svg";
import metaIcon from "$lib/assets/platform-icons/meta.svg";
import deepseekIcon from "$lib/assets/platform-icons/deepseek.svg";
import kimiIcon from "$lib/assets/platform-icons/kimi.svg";
import tongyiIcon from "$lib/assets/platform-icons/alibabacloud.svg";
import wenxinIcon from "$lib/assets/platform-icons/baidu.svg";
import doubaoIcon from "$lib/assets/platform-icons/bytedance.svg";
import yuanbaoIcon from "$lib/assets/platform-icons/tencent.svg";

/**
 * 内置AI平台列表
 */
export const BUILT_IN_AI_PLATFORMS: AIPlatform[] = [
  // 国际平台
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: chatgptIcon,
    url: 'https://chat.openai.com',
    enabled: true,
    isCustom: false,
    sortOrder: 1,
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: anthropicIcon,
    url: 'https://claude.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 2,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: geminiIcon,
    url: 'https://gemini.google.com',
    enabled: true,
    isCustom: false,
    sortOrder: 3,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    icon: copilotIcon,
    url: 'https://copilot.microsoft.com',
    enabled: true,
    isCustom: false,
    sortOrder: 4,
  },
  {
    id: 'grok',
    name: 'Grok',
    icon: grokIcon,
    url: 'https://grok.x.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 5,
  },
  {
    id: 'metaai',
    name: 'Meta AI',
    icon: metaIcon,
    url: 'https://www.meta.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 6,
  },
  // 国内平台
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: deepseekIcon,
    url: 'https://chat.deepseek.com',
    enabled: true,
    isCustom: false,
    sortOrder: 7,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: kimiIcon,
    url: 'https://kimi.moonshot.cn',
    enabled: true,
    isCustom: false,
    sortOrder: 8,
  },
  {
    id: 'tongyi',
    name: '通义千问',
    icon: tongyiIcon,
    url: 'https://tongyi.aliyun.com/qianwen',
    enabled: true,
    isCustom: false,
    sortOrder: 9,
  },
  {
    id: 'wenxin',
    name: '文心一言',
    icon: wenxinIcon,
    url: 'https://yiyan.baidu.com',
    enabled: true,
    isCustom: false,
    sortOrder: 10,
  },
  {
    id: 'doubao',
    name: '豆包',
    icon: doubaoIcon,
    url: 'https://www.doubao.com',
    enabled: true,
    isCustom: false,
    sortOrder: 11,
  },
  {
    id: 'yuanbao',
    name: '腾讯元宝',
    icon: yuanbaoIcon,
    url: 'https://yuanbao.tencent.com',
    enabled: true,
    isCustom: false,
    sortOrder: 12,
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
    url: 'https://translate.google.com/?sl=auto&tl=zh-CN&op=translate',
    enabled: true,
    supportLanguages: ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    icon: 'https://www.deepl.com/img/favicon/favicon_96.png',
    url: 'https://www.deepl.com/translator#auto/zh/',
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
  version: "0.0.2",
  description: "一个简洁高效的AI问答助手",
  author: "AI Ask Team",
  repository: "https://github.com/200hub/ai-ask",
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
