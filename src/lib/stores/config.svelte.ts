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

  // 辅助功能权限状态（macOS）
  accessibilityPermissionGranted = $state<boolean>(true);

  /**
   * 初始化配置
   */
  async init() {
    try {
      this.config = await getConfig();
      this.initialized = true;

      // 应用主题
      this.applyTheme();

  await this.refreshSelectionToolbarTemporaryDisableIfExpired();
  await this.syncSelectionToolbarPolicies();

      // 同步自启动状态
      await this.syncAutoLaunchStatus();

      // 检查辅助功能权限
      await this.checkAccessibilityPermission();
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
   * 同步划词工具栏启用状态到后端
   */
  async syncSelectionToolbarEnabled() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_selection_toolbar_enabled', {
        enabled: this.config.selectionToolbarEnabled,
      });
    } catch (error) {
      logger.error('Failed to sync selection toolbar state', error);
    }
  }

  async syncSelectionToolbarPolicies() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_selection_toolbar_enabled', {
        enabled: this.config.selectionToolbarEnabled,
      });
      await invoke('set_selection_toolbar_ignored_apps', {
        apps: this.buildIgnoredAppPayload(this.config.selectionToolbarIgnoredApps),
      });
      await invoke('set_selection_toolbar_temporary_disabled_until', {
        until: this.config.selectionToolbarTemporaryDisabledUntil,
      });
    } catch (error) {
      logger.error('Failed to sync selection toolbar policies', error);
    }
  }

  private sanitizeIgnoredApps(apps: string[]): string[] {
    return apps.map((item) => item.trim()).filter((item) => item.length > 0);
  }

  private buildIgnoredAppPayload(apps: string[]): string[] {
    return this
      .sanitizeIgnoredApps(apps)
      .map((item) => item.toLowerCase());
  }

  async setSelectionToolbarIgnoredApps(apps: string[]) {
    const sanitized = this.sanitizeIgnoredApps(apps);
    const payload = this.buildIgnoredAppPayload(sanitized);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_selection_toolbar_ignored_apps', { apps: payload });
    } catch (error) {
      logger.error('Failed to update selection toolbar ignored apps in backend', error);
      throw error;
    }

    await this.update({ selectionToolbarIgnoredApps: sanitized });
  }

  async setSelectionToolbarTemporaryDisabledUntil(until: number | null) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_selection_toolbar_temporary_disabled_until', { until });
    } catch (error) {
      logger.error('Failed to update selection toolbar temporary disable state', error);
      throw error;
    }

    await this.update({ selectionToolbarTemporaryDisabledUntil: until });
  }

  async setSelectionToolbarTemporaryDisableDuration(duration: number) {
    await this.update({ selectionToolbarTemporaryDisableDurationMs: duration });
  }

  async applySelectionToolbarTemporaryDisableSnapshot(until: number | null) {
    this.config = await updateConfig({ selectionToolbarTemporaryDisabledUntil: until });
  }

  async refreshSelectionToolbarTemporaryDisableIfExpired() {
    const until = this.config.selectionToolbarTemporaryDisabledUntil;
    if (!until) {
      return;
    }

    if (until <= Date.now()) {
      logger.info('Selection toolbar temporary disable expired, restoring');
      await this.setSelectionToolbarTemporaryDisabledUntil(null);
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
    
    // 通知所有窗口主题已更改
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('theme-changed', { theme });
    } catch (error) {
      logger.error('Failed to emit theme-changed event', error);
    }
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
   * 设置划词工具栏快捷键
   */
  async setSelectionToolbarHotkey(hotkey: string) {
    await this.update({ selectionToolbarHotkey: hotkey });
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
   * 设置划词工具栏开关
   */
  async setSelectionToolbarEnabled(enabled: boolean) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_selection_toolbar_enabled', { enabled });
    } catch (error) {
      logger.error('Failed to update selection toolbar state in backend', error);
      throw error;
    }

    await this.update({ selectionToolbarEnabled: enabled });
  }

  /**
   * 设置划词默认平台
   */
  async setSelectionToolbarDefaultPlatformId(platformId: string | null) {
    await this.update({ selectionToolbarDefaultPlatformId: platformId });
  }

  /**
   * 设置平台预加载开关
   */
  async setPreloadDefaultPlatforms(enabled: boolean) {
    await this.update({ preloadDefaultPlatforms: enabled });
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
  await this.syncSelectionToolbarPolicies();
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

  /**
   * 检查辅助功能权限状态
   */
  async checkAccessibilityPermission(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const granted = await invoke<boolean>('check_accessibility_permission');
      this.accessibilityPermissionGranted = granted;

      if (!granted) {
        logger.warn('Accessibility permission not granted');
      } else {
        logger.info('Accessibility permission verified');
      }

      return granted;
    } catch (error) {
      logger.error('Failed to check accessibility permission', error);
      return true; // 假设已授权，避免在不支持的平台上显示警告
    }
  }

  /**
   * 请求辅助功能权限
   */
  async requestAccessibilityPermission(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const granted = await invoke<boolean>('request_accessibility_permission');
      this.accessibilityPermissionGranted = granted;

      if (granted) {
        logger.info('Accessibility permission granted after request');
      } else {
        logger.warn('Accessibility permission denied or prompt shown');
      }

      return granted;
    } catch (error) {
      logger.error('Failed to request accessibility permission', error);
      throw error;
    }
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
