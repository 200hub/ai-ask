/**
 * AI平台配置接口
 */
export interface AIPlatform {
  id: string;              // 唯一标识
  name: string;            // 平台名称
  icon: string;            // 图标URL或路径
  url: string;             // 访问网址
  enabled: boolean;        // 是否启用
  isCustom: boolean;       // 是否自定义平台
  sortOrder: number;       // 排序权重
  userAgent?: string;      // 自定义User Agent（可选）
}

/**
 * 翻译平台配置接口
 */
export interface TranslationPlatform {
  id: string;              // 唯一标识
  name: string;            // 平台名称
  icon: string;            // 图标URL或路径
  url: string;             // 访问网址
  enabled: boolean;        // 是否启用
  supportLanguages: string[]; // 支持的语言对
}

/**
 * 平台类型枚举
 */
export enum PlatformType {
  AI = 'ai',
  TRANSLATION = 'translation'
}

/**
 * 内置AI平台列表类型
 */
export type BuiltInPlatforms = readonly AIPlatform[];

/**
 * 内置翻译平台列表类型
 */
export type BuiltInTranslationPlatforms = readonly TranslationPlatform[];
