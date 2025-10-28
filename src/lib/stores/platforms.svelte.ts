/**
 * AI平台状态管理 - 使用 Svelte 5 Runes
 */
import type { AIPlatform } from '../types/platform';
import { getAIPlatforms, saveAIPlatforms, addCustomPlatform, updateAIPlatform, deleteAIPlatform } from '../utils/storage';

/**
 * AI平台管理类
 */
class PlatformsStore {
  // 所有AI平台列表
  platforms = $state<AIPlatform[]>([]);

  // 已启用的平台列表
  get enabledPlatforms(): AIPlatform[] {
    return this.platforms
      .filter(p => p.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // 自定义平台列表
  get customPlatforms(): AIPlatform[] {
    return this.platforms.filter(p => p.isCustom);
  }

  // 内置平台列表
  get builtInPlatforms(): AIPlatform[] {
    return this.platforms.filter(p => !p.isCustom);
  }

  /**
   * 初始化平台列表
   */
  async init() {
    try {
      this.platforms = await getAIPlatforms();
    } catch (error) {
      console.error('Failed to initialize platforms:', error);
    }
  }

  /**
   * 获取平台by ID
   */
  getPlatformById(id: string): AIPlatform | undefined {
    return this.platforms.find(p => p.id === id);
  }

  /**
   * 切换平台启用状态
   */
  async togglePlatform(id: string) {
    const platform = this.getPlatformById(id);
    if (!platform) return;

    try {
      await updateAIPlatform(id, { enabled: !platform.enabled });
      platform.enabled = !platform.enabled;
    } catch (error) {
      console.error('Failed to toggle platform:', error);
      throw error;
    }
  }

  /**
   * 添加自定义平台
   */
  async addPlatform(platform: Omit<AIPlatform, 'id' | 'isCustom' | 'sortOrder'>) {
    try {
      const newPlatform = await addCustomPlatform(platform);
      this.platforms.push(newPlatform);
      return newPlatform;
    } catch (error) {
      console.error('Failed to add platform:', error);
      throw error;
    }
  }

  /**
   * 更新平台信息
   */
  async updatePlatform(id: string, updates: Partial<AIPlatform>) {
    try {
      await updateAIPlatform(id, updates);
      const index = this.platforms.findIndex(p => p.id === id);
      if (index !== -1) {
        this.platforms[index] = { ...this.platforms[index], ...updates };
      }
    } catch (error) {
      console.error('Failed to update platform:', error);
      throw error;
    }
  }

  /**
   * 删除平台（仅自定义平台）
   */
  async removePlatform(id: string) {
    const platform = this.getPlatformById(id);
    if (!platform || !platform.isCustom) {
      throw new Error('只能删除自定义平台');
    }

    try {
      await deleteAIPlatform(id);
      this.platforms = this.platforms.filter(p => p.id !== id);
    } catch (error) {
      console.error('Failed to remove platform:', error);
      throw error;
    }
  }

  /**
   * 更新平台排序
   */
  async reorderPlatforms(platforms: AIPlatform[]) {
    try {
      // 更新sortOrder
      platforms.forEach((p, index) => {
        p.sortOrder = index + 1;
      });
      this.platforms = platforms;
      await saveAIPlatforms(platforms);
    } catch (error) {
      console.error('Failed to reorder platforms:', error);
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
export const platformsStore = new PlatformsStore();
