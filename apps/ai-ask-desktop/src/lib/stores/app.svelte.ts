/**
 * 应用全局状态管理 - 使用 Svelte 5 Runes
 */
import type { ViewType } from '../types/config'
import type { AIPlatform } from '../types/platform'

import { logger } from '$lib/utils/logger'
import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * 应用状态类
 */
class AppState {
  // 当前视图
  currentView = $state<ViewType>('welcome')

  // 当前选中的AI平台
  selectedPlatform = $state<AIPlatform | null>(null)

  // 错误信息
  error = $state<string | null>(null)

  // WebView加载状态
  webviewLoading = $state<boolean>(false)

  /**
   * 切换到AI对话视图
   */
  switchToChatView(platform: AIPlatform) {
    this.selectedPlatform = platform
    this.currentView = 'chat'
  }

  /**
   * 切换到翻译视图
   */
  switchToTranslationView() {
    this.currentView = 'translation'
  }

  /**
   * 切换到欢迎页
   */
  switchToWelcomeView() {
    this.selectedPlatform = null
    this.currentView = 'welcome'
  }

  /**
   * 打开设置面板
   */
  async openSettings() {
    // 首先确保隐藏所有子 webviews
    if (isTauri()) {
      try {
        await invoke('hide_all_child_webviews')
        logger.debug('All child webviews hidden before opening settings')
      }
      catch (error) {
        logger.warn('Failed to invoke hide_all_child_webviews', error)
      }
    }

    // 触发 DOM 事件（用于前端组件清理）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('hideAllWebviews', {
          detail: { markForRestore: false },
        }),
      )
    }

    // 切换到设置视图
    this.currentView = 'settings'
  }

  /**
   * 关闭设置面板
   */
  closeSettings() {
    // 恢复之前的视图
    if (this.selectedPlatform) {
      this.currentView = 'chat'
    }
 else {
      this.currentView = 'welcome'
    }
  }

  /**
   * 切换到调试视图
   */
  switchToDebugView() {
    logger.info('Opening debug page')
    this.currentView = 'debug'
    // 触发事件隐藏所有活跃的子webview（聊天、翻译等）
    window.dispatchEvent(new CustomEvent('hideAllWebviews'))
  }

  /**
   * 设置WebView加载状态
   */
  setWebviewLoading(loading: boolean) {
    this.webviewLoading = loading
  }

  /**
   * 设置错误信息
   */
  setError(error: string | null) {
    this.error = error
    if (error) {
      // 5秒后自动清除错误
      setTimeout(() => {
        this.error = null
      }, 5000)
    }
  }

  /**
   * 清除错误信息
   */
  clearError() {
    this.error = null
  }

  /**
   * 重置状态
   */
  reset() {
    this.currentView = 'welcome'
    this.selectedPlatform = null
    this.error = null
    this.webviewLoading = false
  }
}

/**
 * 导出单例实例
 */
export const appState = new AppState()
