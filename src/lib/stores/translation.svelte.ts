/**
 * 翻译平台状态管理 - 使用 Svelte 5 Runes
 */
import type { TranslationPlatform } from '../types/platform';
import { getTranslationPlatforms, saveTranslationPlatforms, updateTranslationPlatform } from '../utils/storage';

/**
 * 翻译平台管理类
 */
class TranslationStore {
  // 所有翻译平台列表
  platforms = $state<TranslationPlatform[]>([]);

  // 当前选中的翻译平台
  currentPlatform = $state<TranslationPlatform | null>(null);

  // 已启用的平台列表
  get enabledPlatforms(): TranslationPlatform[] {
    return this.platforms.filter(p => p.enabled);
  }

  /**
   * 初始化翻译平台列表
   */
  async init() {
    try {
      this.platforms = await getTranslationPlatforms();
      // 设置默认选中第一个启用的平台
      if (!this.currentPlatform && this.enabledPlatforms.length > 0) {
        this.currentPlatform = this.enabledPlatforms[0];
      }
    } catch (error) {
      console.error('Failed to initialize translation platforms:', error);
    }
  }

  /**
   * 获取平台by ID
   */
  getPlatformById(id: string): TranslationPlatform | undefined {
    return this.platforms.find(p => p.id === id);
  }

  /**
   * 切换平台启用状态
   */
  async togglePlatform(id: string) {
    const platform = this.getPlatformById(id);
    if (!platform) return;

    try {
      await updateTranslationPlatform(id, { enabled: !platform.enabled });
      platform.enabled = !platform.enabled;
    } catch (error) {
      console.error('Failed to toggle translation platform:', error);
      throw error;
    }
  }

  /**
   * 设置当前翻译平台
   */
  setCurrentPlatform(id: string) {
    const platform = this.getPlatformById(id);
    if (platform && platform.enabled) {
      this.currentPlatform = platform;
    }
  }

  /**
   * 更新平台信息
   */
  async updatePlatform(id: string, updates: Partial<TranslationPlatform>) {
    try {
      await updateTranslationPlatform(id, updates);
      const index = this.platforms.findIndex(p => p.id === id);
      if (index !== -1) {
        this.platforms[index] = { ...this.platforms[index], ...updates };
      }
    } catch (error) {
      console.error('Failed to update translation platform:', error);
      throw error;
    }
  }

  /**
   * 保存所有平台
   */
  async saveAll() {
    try {
      await saveTranslationPlatforms(this.platforms);
    } catch (error) {
      console.error('Failed to save translation platforms:', error);
      throw error;
    }
  }

  /**
   * 重新加载平台列表
   */
  async reload() {
    await this.init();
  }
}

/**
 * 导出单例实例
 */
export const translationStore = new TranslationStore();
