/**
 * 存储工具类 - 用于配置的持久化
 */
import { Store } from '@tauri-apps/plugin-store';
import type { AppConfig } from '../types/config';
import type { AIPlatform, TranslationPlatform } from '../types/platform';
import { DEFAULT_CONFIG } from '../types/config';
import { BUILT_IN_AI_PLATFORMS, BUILT_IN_TRANSLATION_PLATFORMS } from './constants';

/**
 * 配置存储键
 */
const STORAGE_KEYS = {
  CONFIG: 'app_config',
  AI_PLATFORMS: 'ai_platforms',
  TRANSLATION_PLATFORMS: 'translation_platforms',
  CUSTOM_PLATFORMS: 'custom_platforms'
};

/**
 * Store实例
 */
let store: Store | null = null;

/**
 * 初始化Store
 */
export async function initStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('config.json');
  }
  return store;
}

/**
 * 获取应用配置
 */
export async function getConfig(): Promise<AppConfig> {
  try {
    const storeInstance = await initStore();
    const config = await storeInstance.get<AppConfig>(STORAGE_KEYS.CONFIG);

    if (!config) {
      // 首次运行，返回默认配置
      await saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    // 合并默认配置（防止新增配置项时出现undefined）
    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    console.error('Failed to get config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 保存应用配置
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    const storeInstance = await initStore();
    await storeInstance.set(STORAGE_KEYS.CONFIG, config);
    await storeInstance.save();
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

/**
 * 更新配置的部分字段
 */
export async function updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  try {
    const currentConfig = await getConfig();
    const newConfig = { ...currentConfig, ...updates };
    await saveConfig(newConfig);
    return newConfig;
  } catch (error) {
    console.error('Failed to update config:', error);
    throw error;
  }
}

/**
 * 获取AI平台列表
 */
export async function getAIPlatforms(): Promise<AIPlatform[]> {
  try {
    const storeInstance = await initStore();
    const platforms = await storeInstance.get<AIPlatform[]>(STORAGE_KEYS.AI_PLATFORMS);

    if (!platforms) {
      // 首次运行，返回内置平台
      await saveAIPlatforms(BUILT_IN_AI_PLATFORMS);
      return [...BUILT_IN_AI_PLATFORMS];
    }

    return platforms;
  } catch (error) {
    console.error('Failed to get AI platforms:', error);
    return [...BUILT_IN_AI_PLATFORMS];
  }
}

/**
 * 保存AI平台列表
 */
export async function saveAIPlatforms(platforms: AIPlatform[]): Promise<void> {
  try {
    const storeInstance = await initStore();
    await storeInstance.set(STORAGE_KEYS.AI_PLATFORMS, platforms);
    await storeInstance.save();
  } catch (error) {
    console.error('Failed to save AI platforms:', error);
    throw error;
  }
}

/**
 * 添加自定义AI平台
 */
export async function addCustomPlatform(platform: Omit<AIPlatform, 'id' | 'isCustom' | 'sortOrder'>): Promise<AIPlatform> {
  try {
    const platforms = await getAIPlatforms();
    const newPlatform: AIPlatform = {
      ...platform,
      id: `custom_${Date.now()}`,
      isCustom: true,
      sortOrder: platforms.length + 1
    };

    platforms.push(newPlatform);
    await saveAIPlatforms(platforms);
    return newPlatform;
  } catch (error) {
    console.error('Failed to add custom platform:', error);
    throw error;
  }
}

/**
 * 更新AI平台
 */
export async function updateAIPlatform(id: string, updates: Partial<AIPlatform>): Promise<void> {
  try {
    const platforms = await getAIPlatforms();
    const index = platforms.findIndex(p => p.id === id);

    if (index !== -1) {
      platforms[index] = { ...platforms[index], ...updates };
      await saveAIPlatforms(platforms);
    }
  } catch (error) {
    console.error('Failed to update AI platform:', error);
    throw error;
  }
}

/**
 * 删除AI平台（仅自定义平台）
 */
export async function deleteAIPlatform(id: string): Promise<void> {
  try {
    const platforms = await getAIPlatforms();
    const platform = platforms.find(p => p.id === id);

    if (platform && platform.isCustom) {
      const filtered = platforms.filter(p => p.id !== id);
      await saveAIPlatforms(filtered);
    }
  } catch (error) {
    console.error('Failed to delete AI platform:', error);
    throw error;
  }
}

/**
 * 获取翻译平台列表
 */
export async function getTranslationPlatforms(): Promise<TranslationPlatform[]> {
  try {
    const storeInstance = await initStore();
    const platforms = await storeInstance.get<TranslationPlatform[]>(STORAGE_KEYS.TRANSLATION_PLATFORMS);

    if (!platforms) {
      await saveTranslationPlatforms(BUILT_IN_TRANSLATION_PLATFORMS);
      return [...BUILT_IN_TRANSLATION_PLATFORMS];
    }

    return platforms;
  } catch (error) {
    console.error('Failed to get translation platforms:', error);
    return [...BUILT_IN_TRANSLATION_PLATFORMS];
  }
}

/**
 * 保存翻译平台列表
 */
export async function saveTranslationPlatforms(platforms: TranslationPlatform[]): Promise<void> {
  try {
    const storeInstance = await initStore();
    await storeInstance.set(STORAGE_KEYS.TRANSLATION_PLATFORMS, platforms);
    await storeInstance.save();
  } catch (error) {
    console.error('Failed to save translation platforms:', error);
    throw error;
  }
}

/**
 * 更新翻译平台
 */
export async function updateTranslationPlatform(id: string, updates: Partial<TranslationPlatform>): Promise<void> {
  try {
    const platforms = await getTranslationPlatforms();
    const index = platforms.findIndex(p => p.id === id);

    if (index !== -1) {
      platforms[index] = { ...platforms[index], ...updates };
      await saveTranslationPlatforms(platforms);
    }
  } catch (error) {
    console.error('Failed to update translation platform:', error);
    throw error;
  }
}

/**
 * 重置所有配置到默认值
 */
export async function resetToDefaults(): Promise<void> {
  try {
    await saveConfig(DEFAULT_CONFIG);
    await saveAIPlatforms(BUILT_IN_AI_PLATFORMS);
    await saveTranslationPlatforms(BUILT_IN_TRANSLATION_PLATFORMS);
  } catch (error) {
    console.error('Failed to reset to defaults:', error);
    throw error;
  }
}

/**
 * 导出配置（用于备份）
 */
export async function exportConfig(): Promise<string> {
  try {
    const config = await getConfig();
    const aiPlatforms = await getAIPlatforms();
    const translationPlatforms = await getTranslationPlatforms();

    return JSON.stringify({
      config,
      aiPlatforms,
      translationPlatforms
    }, null, 2);
  } catch (error) {
    console.error('Failed to export config:', error);
    throw error;
  }
}

/**
 * 导入配置（用于恢复备份）
 */
export async function importConfig(jsonString: string): Promise<void> {
  try {
    const data = JSON.parse(jsonString);

    if (data.config) {
      await saveConfig(data.config);
    }
    if (data.aiPlatforms) {
      await saveAIPlatforms(data.aiPlatforms);
    }
    if (data.translationPlatforms) {
      await saveTranslationPlatforms(data.translationPlatforms);
    }
  } catch (error) {
    console.error('Failed to import config:', error);
    throw error;
  }
}
