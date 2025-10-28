/**
 * 应用配置接口
 */
export interface AppConfig {
  // 主题设置
  theme: "system" | "light" | "dark";

  // 语言设置
  locale?: "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

  // 快捷键设置
  globalHotkey: string; // 显示/隐藏窗口快捷键
  translationHotkey: string; // 翻译快捷键

  // 启动设置
  autoStart: boolean; // 开机自启动

  // 平台设置
  defaultPlatform: string | null; // 默认AI平台ID
  lastUsedPlatform: string | null; // 最后使用的AI平台ID

  // 翻译设置
  currentTranslator: string; // 当前选中的翻译平台ID

  // 代理设置
  proxy?: ProxyConfig;

  // 窗口设置
  windowSize: WindowSize;
  windowPosition: WindowPosition | null;

  // 其他设置
  firstRun: boolean; // 是否首次运行
}

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  type: "none" | "system" | "custom";
  host: string;
  port: string;
}

/**
 * 窗口尺寸接口
 */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * 窗口位置接口
 */
export interface WindowPosition {
  x: number;
  y: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: AppConfig = {
  theme: "system",
  locale: "zh-CN",
  globalHotkey: "CommandOrControl+Shift+A",
  translationHotkey: "CommandOrControl+Shift+T",
  autoStart: false,
  defaultPlatform: null,
  lastUsedPlatform: null,
  currentTranslator: "google",
  windowSize: {
    width: 1200,
    height: 800,
  },
  windowPosition: null,
  firstRun: true,
};

/**
 * 设置标签页类型
 */
export type SettingsTab =
  | "general"
  | "platforms"
  | "proxy"
  | "translation"
  | "about";

/**
 * 视图类型
 */
export type ViewType = "welcome" | "chat" | "translation" | "settings";
