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
  version: "0.0.1-alpha.3",
  description: "一个简洁高效的AI问答助手",
  author: "AI Ask Team",
  repository: "https://github.com/200hub/ai-ask",
};

/**
 * 更新相关事件常量
 */
export const UPDATE_EVENTS = {
  AVAILABLE: "update:available",
  DOWNLOADING: "update:downloading",
  DOWNLOADED: "update:downloaded",
  available: "update:available",
  downloading: "update:downloading",
  downloaded: "update:downloaded",
} as const;

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

/**
 * 时间相关常量（毫秒）
 */
export const TIMING = {
  /** 快捷键限流时间间隔 */
  SHORTCUT_THROTTLE_MS: 350,
  /** 隐藏窗口前等待时间 */
  HIDE_WINDOW_DELAY_MS: 100,
  /** 代理测试超时时间（秒）*/
  PROXY_TEST_TIMEOUT_SECS: 10,
  /** 错误消息自动清除时间 */
  ERROR_AUTO_CLEAR_MS: 5000,
  /** WebView 最小显示加载动画的时长（毫秒） */
  MIN_WEBVIEW_LOADING_MS: 600,
  /** WebView 聚焦后额外的就绪等待时间（毫秒） */
  WEBVIEW_READY_EXTRA_DELAY_MS: 150,
} as const;

/**
 * 网络相关常量
 */
export const NETWORK = {
  /** 代理测试目标 URL */
  PROXY_TEST_URL: 'https://www.example.com',
  /** HTTP 重定向限制次数 */
  HTTP_REDIRECT_LIMIT: 5,
} as const;

/**
 * 事件名称常量
 */
export const EVENTS = {
  /** 隐藏所有 webviews 事件 */
  HIDE_ALL_WEBVIEWS: 'hideAllWebviews',
  /** 恢复 webviews 事件 */
  RESTORE_WEBVIEWS: 'restoreWebviews',
  /** 打开设置事件 */
  OPEN_SETTINGS: 'open-settings',
  /** 翻译快捷键触发事件 */
  TRANSLATION_HOTKEY_TRIGGERED: 'translation-hotkey-triggered',
  /** 确保翻译可见事件 */
  ENSURE_TRANSLATION_VISIBLE: 'ensureTranslationVisible',
} as const;

/**
 * 后端配置常量（从 Rust update.rs 同步）
 * Note: These constants are defined in Rust (src-tauri/src/update.rs) and replicated here for reference.
 * The Rust code is the source of truth.
 */
export const BACKEND_CONFIG = {
  /** GitHub Releases API endpoint */
  GITHUB_RELEASES_API: 'https://api.github.com/repos/200hub/ai-ask/releases',
  /** Configuration store file name */
  STORE_FILE: 'config.json',
  /** Configuration store key for app config */
  STORE_KEY_CONFIG: 'app_config',
  /** Pending update file name */
  PENDING_UPDATE_FILE: 'pending-update.json',
  /** Update event: new version available */
  EVENT_UPDATE_AVAILABLE: 'update:available',
  /** Update event: download completed */
  EVENT_UPDATE_DOWNLOADED: 'update:downloaded',
} as const;
