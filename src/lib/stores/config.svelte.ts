/**
 * 应用配置状态管理 - 使用 Svelte 5 Runes
 */
import type { AppConfig } from '../types/config';
import { getConfig, saveConfig, updateConfig } from '../utils/storage';
import { DEFAULT_CONFIG } from '../types/config';
import { logger } from '../utils/logger';

/**
 * 配置管理类
 */
class ConfigStore {
  // 应用配置
  config = $state<AppConfig>(DEFAULT_CONFIG);

  // 是否已初始化
  initialized = $state<boolean>(false);

  /**
   * 初始化配置
   */
  async init() {
    try {
      this.config = await getConfig();
      this.initialized = true;

      // 应用主题
      this.applyTheme();
      
      // 同步自启动状态
      await this.syncAutoLaunchStatus();
    } catch (error) {
      logger.error('Failed to initialize config', error);
      this.config = DEFAULT_CONFIG;
    }
  }

  /**
   * 同步自启动状态（确保配置与系统设置一致）
   */
  async syncAutoLaunchStatus() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const isEnabled = await invoke<boolean>('is_auto_launch_enabled');
      
      // 如果配置与系统状态不一致，更新配置
      if (this.config.autoStart !== isEnabled) {
        logger.info('Syncing auto launch status', { 
          configValue: this.config.autoStart, 
          systemValue: isEnabled 
        });
        this.config = await updateConfig({ autoStart: isEnabled });
      }
    } catch (error) {
      logger.error('Failed to sync auto launch status', error);
    }
  }

  /**
   * 更新配置
   * 
   * @param updates - 要更新的配置字段
   */
  async update(updates: Partial<AppConfig>): Promise<void> {
    try {
      this.config = await updateConfig(updates);

      // 如果更新了主题，应用主题
      if (updates.theme !== undefined) {
        this.applyTheme();
      }
    } catch (error) {
      logger.error('Failed to update config', error);
      throw error;
    }
  }

  /**
   * 设置主题
   */
  async setTheme(theme: 'system' | 'light' | 'dark') {
    await this.update({ theme });
  }

  /**
   * 应用主题到DOM
   */
  applyTheme() {
    const theme = this.config.theme;
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  /**
   * 设置全局快捷键
   */
  async setGlobalHotkey(hotkey: string) {
    await this.update({ globalHotkey: hotkey });
  }

  /**
   * 设置翻译快捷键
   */
  async setTranslationHotkey(hotkey: string) {
    await this.update({ translationHotkey: hotkey });
  }

  /**
   * 设置自动启动
   */
  async setAutoStart(autoStart: boolean) {
    const { invoke } = await import('@tauri-apps/api/core');
    
    try {
      if (autoStart) {
        await invoke('enable_auto_launch');
        logger.info('Auto launch enabled');
      } else {
        await invoke('disable_auto_launch');
        logger.info('Auto launch disabled');
      }
      
      await this.update({ autoStart });
    } catch (error) {
      logger.error('Failed to set auto launch', error);
      throw error;
    }
  }

  /**
   * 设置自动更新开关
   */
  async setAutoUpdateEnabled(enabled: boolean) {
    await this.update({ autoUpdateEnabled: enabled });
  }

  /**
   * 设置默认平台
   */
  async setDefaultPlatform(platformId: string | null) {
    await this.update({ defaultPlatform: platformId });
  }

  /**
   * 设置最后使用的平台
   */
  async setLastUsedPlatform(platformId: string | null) {
    await this.update({ lastUsedPlatform: platformId });
  }

  /**
   * 设置当前翻译平台
   */
  async setCurrentTranslator(translatorId: string) {
    await this.update({ currentTranslator: translatorId });
  }

  /**
   * 设置窗口尺寸
   */
  async setWindowSize(width: number, height: number) {
    await this.update({
      windowSize: { width, height }
    });
  }

  /**
   * 设置窗口位置
   */
  async setWindowPosition(x: number, y: number) {
    await this.update({
      windowPosition: { x, y }
    });
  }

  /**
   * 标记首次运行完成
   */
  async completeFirstRun() {
    await this.update({ firstRun: false });
  }

  /**
   * 重置配置
   */
  async reset() {
    try {
      await saveConfig(DEFAULT_CONFIG);
      this.config = DEFAULT_CONFIG;
      this.applyTheme();
    } catch (error) {
      logger.error('Failed to reset config', error);
      throw error;
    }
  }

  /**
   * 重新加载配置
   */
  async reload() {
    await this.init();
  }
}

/**
 * 导出单例实例
 */
export const configStore = new ConfigStore();

/**
 * 监听系统主题变化
 */
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (configStore.config.theme === 'system') {
      configStore.applyTheme();
    }
  });
}
