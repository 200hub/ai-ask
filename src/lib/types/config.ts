/**
 * 应用配置接口
 */
export interface AppConfig {
  // 主题设置
  theme: "system" | "light" | "dark";

  // 语言设置
  locale?: "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

  // 快捷键设置
  globalHotkey: string;
  translationHotkey: string;

  // 启动设置
  autoStart: boolean;

  // 平台设置
  defaultPlatform: string | null;
  lastUsedPlatform: string | null;

  // 翻译设置
  currentTranslator: string;

  // 代理设置
  proxy?: ProxyConfig | null;

  // 窗口设置
  windowSize: WindowSize;
  windowPosition: WindowPosition | null;

  // 其他设置
  firstRun: boolean;
}

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  type: "none" | "system" | "custom";
  host?: string;
  port?: string;
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
  proxy: null,
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
