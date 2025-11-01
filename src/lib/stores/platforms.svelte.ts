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

  private normalizeOrder(platforms: AIPlatform[]): AIPlatform[] {
    return [...platforms]
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      })
      .map((platform, index) => ({
        ...platform,
        sortOrder: index + 1,
      }));
  }

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
      const platforms = await getAIPlatforms();
      this.platforms = this.normalizeOrder(platforms);
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
      this.platforms = this.normalizeOrder([...this.platforms, newPlatform]);
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
      const normalized = this.normalizeOrder(platforms);
      this.platforms = normalized;
      await saveAIPlatforms(normalized);
    } catch (error) {
      console.error('Failed to reorder platforms:', error);
      throw error;
    }
  }

  /**
   * 移动平台顺序
   * 
   * @param id - 平台ID
   * @param direction - 移动方向（'up' 向上, 'down' 向下）
   */
  async movePlatform(id: string, direction: 'up' | 'down'): Promise<void> {
    const { log } = await import('$lib/utils/logger');
    
    log.debug('[PlatformsStore] 开始移动平台', { id, direction });
    log.debug('[PlatformsStore] 当前平台列表', 
      this.platforms.map(p => ({ id: p.id, name: p.name, sortOrder: p.sortOrder }))
    );

    const platform = this.platforms.find(p => p.id === id);
    if (!platform) {
      log.error('[PlatformsStore] 未找到平台', { id });
      return;
    }

    // 按 sortOrder 排序获取所有平台
    const sorted = [...this.platforms].sort((a, b) => a.sortOrder - b.sortOrder);
    const currentIndex = sorted.findIndex(p => p.id === id);
    
    log.debug('[PlatformsStore] 当前位置', { currentIndex, total: sorted.length });

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) {
      log.debug('[PlatformsStore] 无法移动 - 超出边界', { currentIndex, targetIndex });
      return;
    }

    // 交换两个平台的 sortOrder
    const targetPlatform = sorted[targetIndex];
    const tempOrder = platform.sortOrder;
    platform.sortOrder = targetPlatform.sortOrder;
    targetPlatform.sortOrder = tempOrder;

    log.debug('[PlatformsStore] 交换 sortOrder', {
      platform: { id: platform.id, name: platform.name, sortOrder: platform.sortOrder },
      target: { id: targetPlatform.id, name: targetPlatform.name, sortOrder: targetPlatform.sortOrder }
    });

    // 触发响应式更新
    this.platforms = [...this.platforms];
    
    log.debug('[PlatformsStore] 更新后的平台列表', 
      this.platforms.map(p => ({ id: p.id, name: p.name, sortOrder: p.sortOrder }))
    );

    try {
      await saveAIPlatforms(this.platforms);
      log.info('[PlatformsStore] 平台顺序保存成功');
    } catch (error) {
      log.error('[PlatformsStore] 保存平台顺序失败', { error });
      throw error;
    }
  }

  /**
   * 重新加载平台列表
   */
  async reload() {
    await this.init();
  }

  /**
   * 设置快速问答平台（单选）
   * 
   * @param id - 平台ID，null表示取消选择
   */
  async setQuickAskPlatform(id: string | null): Promise<void> {
    const { logger } = await import('$lib/utils/logger');
    const { quickAskStore } = await import('$lib/stores/quick-ask.svelte');
    
    logger.debug('[PlatformsStore] 设置快速问答平台', { id });
    
    try {
      await quickAskStore.setSelectedPlatform(id);
      logger.info('[PlatformsStore] 快速问答平台已更新', { platformId: id });
    } catch (error) {
      logger.error('[PlatformsStore] 设置快速问答平台失败', { error });
      throw error;
    }
  }

  /**
   * 获取当前快速问答平台
   * 从 quickAskStore 读取 selectedPlatformId 并返回对应平台
   * 
   * @param selectedPlatformId - 当前选中的平台ID（来自 quickAskStore）
   * @returns 当前快速问答平台，如果未设置则返回null
   */
  getQuickAskPlatform(selectedPlatformId: string | null): AIPlatform | null {
    if (!selectedPlatformId) return null;
    return this.getPlatformById(selectedPlatformId) || null;
  }
}

/**
 * 导出单例实例
 */
export const platformsStore = new PlatformsStore();
