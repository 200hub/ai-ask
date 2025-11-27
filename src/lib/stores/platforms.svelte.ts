/**
 * AI平台状态管理 - 使用 Svelte 5 Runes
 */
import type { AIPlatform } from '../types/platform'
import { i18n } from '$lib/i18n'
import { logger } from '../utils/logger'
import {
  addCustomPlatform,
  deleteAIPlatform,
  getAIPlatforms,
  saveAIPlatforms,
  updateAIPlatform,
} from '../utils/storage'

/**
 * AI平台管理类
 */
class PlatformsStore {
  // 所有AI平台列表
  platforms = $state<AIPlatform[]>([])

  private normalizeOrder(platforms: AIPlatform[]): AIPlatform[] {
    return [...platforms]
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder
        }
        return a.name.localeCompare(b.name)
      })
      .map((platform, index) => ({
        ...platform,
        sortOrder: index + 1,
      }))
  }

  // 已启用的平台列表
  get enabledPlatforms(): AIPlatform[] {
    return this.platforms.filter(p => p.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  // 可用于划词工具栏的平台列表（需启用且允许）
  get selectionToolbarPlatforms(): AIPlatform[] {
    return this.enabledPlatforms.filter(platform => platform.selectionToolbarAvailable ?? true)
  }

  // 自定义平台列表
  get customPlatforms(): AIPlatform[] {
    return this.platforms.filter(p => p.isCustom)
  }

  // 内置平台列表
  get builtInPlatforms(): AIPlatform[] {
    return this.platforms.filter(p => !p.isCustom)
  }

  /**
   * 初始化平台列表
   */
  async init() {
    try {
      const platforms = await getAIPlatforms()
      this.platforms = this.normalizeOrder(platforms)
    }
 catch (error) {
      logger.error('Failed to initialize platforms', error)
    }
  }

  /**
   * 获取平台by ID
   */
  getPlatformById(id: string): AIPlatform | undefined {
    return this.platforms.find(p => p.id === id)
  }

  /**
   * 切换平台启用状态
   */
  async togglePlatform(id: string) {
    const platform = this.getPlatformById(id)
    if (!platform)
return

    try {
      await updateAIPlatform(id, { enabled: !platform.enabled })
      platform.enabled = !platform.enabled
    }
 catch (error) {
      logger.error('Failed to toggle platform', error)
      throw error
    }
  }

  /**
   * 添加自定义平台
   */
  async addPlatform(platform: Omit<AIPlatform, 'id' | 'isCustom' | 'sortOrder'>) {
    try {
      const newPlatform = await addCustomPlatform(platform)
      this.platforms = this.normalizeOrder([...this.platforms, newPlatform])
      return newPlatform
    }
 catch (error) {
      logger.error('Failed to add platform', error)
      throw error
    }
  }

  /**
   * 更新平台信息
   */
  async updatePlatform(id: string, updates: Partial<AIPlatform>) {
    try {
      await updateAIPlatform(id, updates)
      const index = this.platforms.findIndex(p => p.id === id)
      if (index !== -1) {
        this.platforms[index] = { ...this.platforms[index], ...updates }
      }
    }
 catch (error) {
      logger.error('Failed to update platform', error)
      throw error
    }
  }

  /**
   * 删除平台（仅自定义平台）
   */
  async removePlatform(id: string) {
    const platform = this.getPlatformById(id)
    if (!platform || !platform.isCustom) {
      const t = i18n.t
      throw new Error(t('platforms.onlyCustomDeletable'))
    }

    try {
      await deleteAIPlatform(id)
      this.platforms = this.platforms.filter(p => p.id !== id)
    }
 catch (error) {
      logger.error('Failed to remove platform', error)
      throw error
    }
  }

  /**
   * 更新平台排序
   */
  async reorderPlatforms(platforms: AIPlatform[]) {
    try {
      const normalized = this.normalizeOrder(platforms)
      this.platforms = normalized
      await saveAIPlatforms(normalized)
    }
 catch (error) {
      logger.error('Failed to reorder platforms', error)
      throw error
    }
  }

  /**
   * 移动平台顺序
   *
   * @param id - 平台ID
   * @param direction - 移动方向（'up' 向上, 'down' 向下）
   */
  async movePlatform(id: string, direction: 'up' | 'down'): Promise<void> {
    const platform = this.platforms.find(p => p.id === id)
    if (!platform) {
      logger.warn('Platform not found for move', { id })
      return
    }

    // 按 sortOrder 排序获取所有平台
    const sorted = [...this.platforms].sort((a, b) => a.sortOrder - b.sortOrder)
    const currentIndex = sorted.findIndex(p => p.id === id)

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= sorted.length) {
      return
    }

    // 交换两个平台的 sortOrder
    const targetPlatform = sorted[targetIndex]
    const tempOrder = platform.sortOrder
    platform.sortOrder = targetPlatform.sortOrder
    targetPlatform.sortOrder = tempOrder

    // 触发响应式更新
    this.platforms = [...this.platforms]

    try {
      await saveAIPlatforms(this.platforms)
    }
    catch (error) {
      logger.error('Failed to save platform order', error)
      throw error
    }
  }

  /**
   * 重新加载平台列表
   */
  async reload() {
    await this.init()
  }
}

/**
 * 导出单例实例
 */
export const platformsStore = new PlatformsStore()
