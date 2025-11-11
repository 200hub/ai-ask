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
  version: "0.0.1-alpha.10",
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
 * 划词工具栏快捷键列表
 */
export const SELECTION_TOOLBAR_SHORTCUTS = [
  "CommandOrControl+Shift+S",
  "CommandOrControl+Shift+D",
  "CommandOrControl+Alt+S",
  "Alt+Shift+S",
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
  MIN_WEBVIEW_LOADING_MS: 800,
  /** WebView 聚焦后额外的就绪等待时间（毫秒） */
  WEBVIEW_READY_EXTRA_DELAY_MS: 200,
  /** 等待子 WebView 加载完成的最长时间（毫秒） - 用于新创建的 WebView */
  CHILD_WEBVIEW_READY_TIMEOUT_MS: 8000,
  /** 等待已存在的子 WebView 就绪的超时时间（毫秒） - 更短的超时用于已创建的 WebView */
  EXISTING_WEBVIEW_READY_TIMEOUT_MS: 2000,
  /** 显示加载状态的最小延迟（毫秒） - 如果 WebView 很快就绪，不显示加载动画 */
  LOADING_INDICATOR_MIN_DELAY_MS: 500,
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
  /** 子 WebView 页面开始加载 */
  CHILD_WEBVIEW_LOAD_STARTED: 'child-webview:load-started',
  /** 子 WebView 页面加载完成 */
  CHILD_WEBVIEW_READY: 'child-webview:ready',
  /** 注入结果（通过特殊导航传回） */
  CHILD_WEBVIEW_INJECTION_RESULT: 'child-webview:injection-result',
} as const;

/**
 * 注入相关常量
 */
export const INJECTION = {
  /** 默认选择器超时时间（毫秒） */
  DEFAULT_TIMEOUT_MS: 5000,
  /** 默认最大重试次数 */
  DEFAULT_MAX_RETRIES: 3,
  /** 重试延迟时间（毫秒） */
  RETRY_DELAY_MS: 1000,
  /** AI 聊天提取超时时间（毫秒） */
  CHAT_EXTRACT_TIMEOUT_MS: 30000,
  /** AI 聊天轮询间隔（毫秒） */
  CHAT_POLL_INTERVAL_MS: 1000,
} as const;

// Export individual constants for convenience
export const DEFAULT_INJECTION_TIMEOUT = INJECTION.DEFAULT_TIMEOUT_MS;
export const DEFAULT_MAX_RETRIES = INJECTION.DEFAULT_MAX_RETRIES;
export const INJECTION_RETRY_DELAY = INJECTION.RETRY_DELAY_MS;

/**
 * Debug/Injection UI constants
 */
export const DEBUG_FLOATING_CONTROLS_OFFSET = 120; // logical px reserved at top for floating controls

/**
 * Selection Toolbar constants
 */
export const SELECTION_TOOLBAR = {
  /** Toolbar window width (logical pixels) */
  WINDOW_WIDTH: 120,
  /** Toolbar window height (logical pixels) */
  WINDOW_HEIGHT: 38,
  /** Offset from cursor position (logical pixels) */
  CURSOR_OFFSET_X: 10,
  CURSOR_OFFSET_Y: 12,
  /** Minimum text selection length to show toolbar */
  MIN_SELECTION_LENGTH: 2,
  /** Auto-hide delay after showing (milliseconds) */
  AUTO_HIDE_DELAY_MS: 10000,
  /** Debounce delay for text selection events (milliseconds) */
  SELECTION_DEBOUNCE_MS: 300,
  /** Debounce delay before hiding when selection clears (milliseconds) */
  SELECTION_CLEAR_DEBOUNCE_MS: 120,
} as const;

/**
 * Translation language code mapping
 * Maps internal locale codes to platform-specific language codes
 */
export const TRANSLATION_LANG_CODES = {
  /** Google Translate language codes */
  google: {
    'zh-CN': 'zh-CN',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** DeepL language codes */
  deepl: {
    'zh-CN': 'zh',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** Youdao Translate language codes */
  youdao: {
    'zh-CN': 'zh-CHS',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** Baidu Translate language codes */
  baidu: {
    'zh-CN': 'zh',
    'en-US': 'en',
    'ja-JP': 'jp',
    'ko-KR': 'kor',
  },
  /** Bing Translator language codes */
  bing: {
    'zh-CN': 'zh-Hans',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
} as const;

/**
 * Translation-specific injection constants
 */
export const TRANSLATION_INJECTION = {
  /** Translation result extraction timeout (longer than chat) */
  EXTRACT_TIMEOUT_MS: 15000,
  /** Translation polling interval */
  POLL_INTERVAL_MS: 800,
  /** Fill action timeout */
  FILL_TIMEOUT_MS: 5000,
  /** Click action timeout */
  CLICK_TIMEOUT_MS: 3000,
  /** Delay before filling text */
  FILL_DELAY_MS: 300,
  /** Maximum retry attempts for translation */
  MAX_RETRIES: 3,
  /** Delay between retries */
  RETRY_DELAY_MS: 600,
} as const;
