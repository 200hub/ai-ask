/**
 * 应用全局状态管理 - 使用 Svelte 5 Runes
 */
import type { ViewType } from '../types/config';
import type { AIPlatform, TranslationPlatform } from '../types/platform';

/**
 * 应用状态类
 */
class AppState {
  // 当前视图
  currentView = $state<ViewType>('welcome');

  // 当前选中的AI平台
  selectedPlatform = $state<AIPlatform | null>(null);

  // 当前选中的翻译平台
  selectedTranslator = $state<TranslationPlatform | null>(null);

  // 是否显示设置面板
  showSettings = $state<boolean>(false);

  // 是否正在加载
  isLoading = $state<boolean>(false);

  // 错误信息
  error = $state<string | null>(null);

  // WebView加载状态
  webviewLoading = $state<boolean>(false);

  /**
   * 切换到AI对话视图
   */
  switchToChatView(platform: AIPlatform) {
    this.selectedPlatform = platform;
    this.currentView = 'chat';
    this.showSettings = false;
  }

  /**
   * 切换到翻译视图
   */
  switchToTranslationView(translator?: TranslationPlatform) {
    if (translator) {
      this.selectedTranslator = translator;
    }
    this.currentView = 'translation';
    this.showSettings = false;
  }

  /**
   * 切换到欢迎页
   */
  switchToWelcomeView() {
    this.selectedPlatform = null;
    this.currentView = 'welcome';
    this.showSettings = false;
  }

  /**
   * 打开设置面板
   */
  openSettings() {
    this.showSettings = true;
    this.currentView = 'settings';
  }

  /**
   * 关闭设置面板
   */
  closeSettings() {
    this.showSettings = false;
    // 恢复之前的视图
    if (this.selectedPlatform) {
      this.currentView = 'chat';
    } else {
      this.currentView = 'welcome';
    }
  }

  /**
   * 设置加载状态
   */
  setLoading(loading: boolean) {
    this.isLoading = loading;
  }

  /**
   * 设置WebView加载状态
   */
  setWebviewLoading(loading: boolean) {
    this.webviewLoading = loading;
  }

  /**
   * 设置错误信息
   */
  setError(error: string | null) {
    this.error = error;
    if (error) {
      // 5秒后自动清除错误
      setTimeout(() => {
        this.error = null;
      }, 5000);
    }
  }

  /**
   * 清除错误信息
   */
  clearError() {
    this.error = null;
  }

  /**
   * 重置状态
   */
  reset() {
    this.currentView = 'welcome';
    this.selectedPlatform = null;
    this.selectedTranslator = null;
    this.showSettings = false;
    this.isLoading = false;
    this.error = null;
    this.webviewLoading = false;
  }
}

/**
 * 导出单例实例
 */
export const appState = new AppState();
