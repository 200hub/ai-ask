/**
 * 内置AI平台配置
 */
import type { AIPlatform, TranslationPlatform } from '../types/platform'

import anthropicIcon from '$lib/assets/platform-icons/anthropic.svg'
import wenxinIcon from '$lib/assets/platform-icons/baidu.svg'
import doubaoIcon from '$lib/assets/platform-icons/bytedance.svg'
// 引入静态图标，确保 Tauri 安全策略下也能正常显示
import chatgptIcon from '$lib/assets/platform-icons/chatgpt.svg'
import copilotIcon from '$lib/assets/platform-icons/copilot.svg'
import deepseekIcon from '$lib/assets/platform-icons/deepseek.svg'
import geminiIcon from '$lib/assets/platform-icons/gemini.svg'
import githubCopilotIcon from '$lib/assets/platform-icons/github-copilot.svg'
import grokIcon from '$lib/assets/platform-icons/grok.svg'
import kimiIcon from '$lib/assets/platform-icons/kimi.svg'
import qianwenIcon from '$lib/assets/platform-icons/qianwen.svg'
import yuanbaoIcon from '$lib/assets/platform-icons/tencent.svg'

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
    selectionToolbarAvailable: true,
    preload: false,
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: anthropicIcon,
    url: 'https://claude.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 2,
    selectionToolbarAvailable: true,
    preload: false,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: geminiIcon,
    url: 'https://gemini.google.com',
    enabled: true,
    isCustom: false,
    sortOrder: 3,
    selectionToolbarAvailable: true,
    preload: false,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    icon: copilotIcon,
    url: 'https://copilot.microsoft.com',
    enabled: true,
    isCustom: false,
    sortOrder: 4,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'grok',
    name: 'Grok',
    icon: grokIcon,
    url: 'https://grok.x.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 5,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    icon: githubCopilotIcon,
    url: 'https://github.com/copilot',
    enabled: true,
    isCustom: false,
    sortOrder: 6,
    selectionToolbarAvailable: false,
    preload: false,
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
    selectionToolbarAvailable: true,
    preload: false,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: kimiIcon,
    url: 'https://kimi.moonshot.cn',
    enabled: true,
    isCustom: false,
    sortOrder: 8,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'wenxin',
    name: '文心一言',
    icon: wenxinIcon,
    url: 'https://yiyan.baidu.com',
    enabled: true,
    isCustom: false,
    sortOrder: 10,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'doubao',
    name: '豆包',
    icon: doubaoIcon,
    url: 'https://www.doubao.com',
    enabled: true,
    isCustom: false,
    sortOrder: 11,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'yuanbao',
    name: '腾讯元宝',
    icon: yuanbaoIcon,
    url: 'https://yuanbao.tencent.com',
    enabled: true,
    isCustom: false,
    sortOrder: 12,
    selectionToolbarAvailable: false,
    preload: false,
  },
  {
    id: 'qianwen',
    name: '千问',
    icon: qianwenIcon,
    url: 'https://qianwen.com',
    enabled: true,
    isCustom: false,
    sortOrder: 13,
    selectionToolbarAvailable: true,
    preload: false,
  },
]

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
    supportLanguages: ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    icon: 'https://www.deepl.com/img/favicon/favicon_96.png',
    url: 'https://www.deepl.com/translator#auto/zh/',
    enabled: true,
    supportLanguages: ['zh-CN', 'en', 'ja', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ru'],
  },
  {
    id: 'youdao',
    name: '有道翻译',
    icon: 'https://shared.ydstatic.com/images/favicon.ico',
    url: 'https://fanyi.youdao.com',
    enabled: true,
    supportLanguages: ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'],
  },
  {
    id: 'baidu',
    name: '百度翻译',
    icon: 'https://fanyi.baidu.com/favicon.ico',
    url: 'https://fanyi.baidu.com',
    enabled: true,
    supportLanguages: ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'th', 'ar'],
  },
  {
    id: 'bing',
    name: '微软翻译',
    icon: 'https://www.bing.com/favicon.ico',
    url: 'https://www.bing.com/translator',
    enabled: true,
    supportLanguages: ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'ar', 'hi'],
  },
]

/**
 * 应用信息
 */
export const APP_INFO = {
  name: 'AI Ask',
  version: '0.0.1-alpha.23',
  description: '一个简洁高效的AI问答助手',
  author: 'AI Ask Team',
  repository: 'https://github.com/200hub/ai-ask',
  /** 缺陷反馈（Issues）页面地址 */
  issues: 'https://github.com/200hub/ai-ask/issues',
}

/**
 * 更新相关事件常量
 */
export const UPDATE_EVENTS = {
  AVAILABLE: 'update:available',
  DOWNLOADING: 'update:downloading',
  DOWNLOADED: 'update:downloaded',
  available: 'update:available',
  downloading: 'update:downloading',
  downloaded: 'update:downloaded',
} as const

/**
 * 快捷键列表（用于配置界面展示）
 */
export const AVAILABLE_SHORTCUTS = [
  'CommandOrControl+Shift+A',
  'CommandOrControl+Shift+Q',
  'CommandOrControl+Shift+W',
  'CommandOrControl+Shift+E',
  'CommandOrControl+Alt+A',
  'CommandOrControl+Alt+Q',
  'Alt+Shift+A',
  'Alt+Shift+Q',
]

/**
 * 翻译快捷键列表
 */
export const TRANSLATION_SHORTCUTS = [
  'CommandOrControl+Shift+T',
  'CommandOrControl+Shift+Y',
  'CommandOrControl+Alt+T',
  'Alt+Shift+T',
]

/**
 * 划词工具栏快捷键列表
 */
export const SELECTION_TOOLBAR_SHORTCUTS = [
  'CommandOrControl+Shift+S',
  'CommandOrControl+Shift+D',
  'CommandOrControl+Alt+S',
  'Alt+Shift+S',
]

/**
 * 默认窗口配置
 */
export const DEFAULT_WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  minWidth: 900,
  minHeight: 600,
}

/**
 * 侧边栏配置
 */
export const SIDEBAR_CONFIG = {
  width: 70,
  iconSize: 40,
  gap: 12,
}

/**
 * 时间相关常量（毫秒）
 */
export const TIMING = {
  /** 快捷键限流时间间隔 */
  SHORTCUT_THROTTLE_MS: 350,
  /** 隐藏窗口前等待时间 */
  HIDE_WINDOW_DELAY_MS: 100,
  /** 代理测试超时时间（秒） */
  PROXY_TEST_TIMEOUT_SECS: 10,
  /** 错误消息自动清除时间 */
  ERROR_AUTO_CLEAR_MS: 5000,
  /** WebView 最小显示加载动画的时长（毫秒） */
  MIN_WEBVIEW_LOADING_MS: 800,
  /** WebView 复用场景下的最小加载动画时长（毫秒），用于加速已存在窗口的切换体验 */
  /** WebView 复用场景下的最小时长（毫秒） */
  MIN_WEBVIEW_LOADING_WARM_MS: 120,
  /** WebView 聚焦后额外的就绪等待时间（毫秒） */
  WEBVIEW_READY_EXTRA_DELAY_MS: 200,
  /** 等待子 WebView 加载完成的最长时间（毫秒） - 用于新创建的 WebView */
  CHILD_WEBVIEW_READY_TIMEOUT_MS: 8000,
  /** 等待已存在的子 WebView 就绪的超时时间（毫秒） - 更短的超时用于已创建的 WebView */
  EXISTING_WEBVIEW_READY_TIMEOUT_MS: 2000,
  /** 显示加载状态的最小延迟（毫秒） - 如果 WebView 很快就绪，不显示加载动画 */
  LOADING_INDICATOR_MIN_DELAY_MS: 500,
} as const

/**
 * 网络相关常量
 */
export const NETWORK = {
  /** 代理测试目标 URL */
  PROXY_TEST_URL: 'https://www.example.com',
  /** HTTP 重定向限制次数 */
  HTTP_REDIRECT_LIMIT: 5,
} as const

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
  /** 划词工具栏临时禁用状态更新事件 */
  SELECTION_TOOLBAR_TEMP_DISABLE_CHANGED: 'selection-toolbar:temporary-disable-changed',
} as const

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
  /** 默认提取输出格式 */
  DEFAULT_EXTRACT_OUTPUT_FORMAT: 'text' as const,
} as const

// Export individual constants for convenience
export const DEFAULT_INJECTION_TIMEOUT = INJECTION.DEFAULT_TIMEOUT_MS
export const DEFAULT_MAX_RETRIES = INJECTION.DEFAULT_MAX_RETRIES
export const INJECTION_RETRY_DELAY = INJECTION.RETRY_DELAY_MS
export const DEFAULT_EXTRACT_OUTPUT_FORMAT = INJECTION.DEFAULT_EXTRACT_OUTPUT_FORMAT

/**
 * 代码语言识别相关常量
 */
export const KNOWN_CODE_LANGUAGES = [
  // 以下列表为统一支持的代码语言关键字，用于：
  // 1. 语言识别归一化校验（见 injection-format.ts）
  // 2. 生成 fenced code block 的语言前缀
  // 3. 后续扩展时可直接在此追加，避免散落硬编码
  'assembly',
  'bash',
  'c',
  'csharp',
  'cpp',
  'css',
  'dart',
  'elixir',
  'erlang',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'lua',
  'markdown',
  'objective-c',
  'perl',
  'php',
  'plaintext',
  'powershell',
  'python',
  'r',
  'ruby',
  'rust',
  'scala',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const

export const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  // 常用别名映射：兼容平台 DOM 中常出现的缩写/变体，统一到 KNOWN_CODE_LANGUAGES
  'js': 'javascript',
  'jsx': 'javascript',
  'node': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'py': 'python',
  'sh': 'bash',
  'shell': 'bash',
  'shellscript': 'bash',
  'zsh': 'bash',
  'bash': 'bash',
  'ps': 'powershell',
  'ps1': 'powershell',
  'powershell': 'powershell',
  'cplusplus': 'cpp',
  'c++': 'cpp',
  'c#': 'csharp',
  'cs': 'csharp',
  'golang': 'go',
  'objc': 'objective-c',
  'objectivec': 'objective-c',
  'yml': 'yaml',
  'plain': 'plaintext',
  'plaintext': 'plaintext',
  'text': 'plaintext',
}

export const CODE_LANGUAGE_LABEL_MAX_LENGTH = 32
// 语言标签最大长度：防止把整段描述性文字误识别为语言（仅接受短 token）

/**
 * 剪贴板相关常量（Clipboard related constants）
 */
export const CLIPBOARD = {
  /** 复制后等待剪贴板内容变化的最长时间（毫秒） */
  WAIT_TIMEOUT_MS: 5000,
  /** 轮询检测剪贴板变化的时间间隔（毫秒） */
  POLL_INTERVAL_MS: 120,
  /** 认为剪贴板内容有效所需的最少非空白字符数 */
  MIN_NON_WHITESPACE: 1,
  /** 使用 execCommand 回退方案时隐藏 textarea 的屏幕位置（像素） */
  OFFSCREEN_POSITION_PX: -9999,
} as const

/**
 * 调试 / 注入 UI 相关常量
 * 为顶部浮动调试控件预留的逻辑像素高度
 */
export const DEBUG_FLOATING_CONTROLS_OFFSET = 120

/**
 * 划词工具栏配置常量
 */
export const SELECTION_TOOLBAR = {
  /** 工具栏窗口宽度（逻辑像素） */
  WINDOW_WIDTH: 120,
  /** 工具栏窗口高度（逻辑像素） */
  WINDOW_HEIGHT: 38,
  /** 相对于光标位置的水平偏移量（逻辑像素） */
  CURSOR_OFFSET_X: 10,
  /** 相对于光标位置的垂直偏移量（逻辑像素） */
  CURSOR_OFFSET_Y: 12,
  /** 触发工具栏显示所需的最小选中文本长度 */
  MIN_SELECTION_LENGTH: 2,
  /** 工具栏显示后在无操作时自动隐藏的时间（毫秒） */
  AUTO_HIDE_DELAY_MS: 2000,
  /** 文本选择事件的防抖时间（毫秒） */
  SELECTION_DEBOUNCE_MS: 300,
  /** 选区清空后隐藏工具栏前的防抖时间（毫秒） */
  SELECTION_CLEAR_DEBOUNCE_MS: 120,
  /** 临时禁用默认时长（毫秒） */
  TEMP_DISABLE_DURATION_MS: 15 * 60 * 1000,
  /** 临时禁用预设时长列表（毫秒） */
  TEMP_DISABLE_PRESETS_MS: [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000] as const,
} as const

/**
 * 翻译平台语言代码映射
 * 将内部 locale 代码映射到各翻译平台的语言代码
 */
export const TRANSLATION_LANG_CODES = {
  /** Google Translate 语言代码 */
  google: {
    'zh-CN': 'zh-CN',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** DeepL 语言代码 */
  deepl: {
    'zh-CN': 'zh',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** 有道翻译语言代码 */
  youdao: {
    'zh-CN': 'zh-CHS',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
  /** 百度翻译语言代码 */
  baidu: {
    'zh-CN': 'zh',
    'en-US': 'en',
    'ja-JP': 'jp',
    'ko-KR': 'kor',
  },
  /** Bing Translator 语言代码 */
  bing: {
    'zh-CN': 'zh-Hans',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
  },
} as const

/**
 * 翻译注入相关常量（Translation injection）
 */
export const TRANSLATION_INJECTION = {
  /** 翻译结果提取超时时间（毫秒，比聊天略长） */
  EXTRACT_TIMEOUT_MS: 15000,
  /** 轮询翻译结果的时间间隔（毫秒） */
  POLL_INTERVAL_MS: 800,
  /** 填充文本操作的超时时间（毫秒） */
  FILL_TIMEOUT_MS: 5000,
  /** 点击操作的超时时间（毫秒） */
  CLICK_TIMEOUT_MS: 3000,
  /** 填充文本前的延迟时间（毫秒） */
  FILL_DELAY_MS: 300,
  /** 翻译操作的最大重试次数 */
  MAX_RETRIES: 3,
  /** 重试之间的等待时间（毫秒） */
  RETRY_DELAY_MS: 600,
} as const
