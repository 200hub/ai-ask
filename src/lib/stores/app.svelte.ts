/**
 * 应用全局状态管理 - 使用 Svelte 5 Runes
 */
import type { ViewType } from '../types/config'
import type { AIPlatform } from '../types/platform'
import { logger } from '$lib/utils/logger'
import { onUpdateAvailable, onUpdateDownloaded } from '$lib/utils/update'
import { invoke } from '@tauri-apps/api/core'

/**
 * 应用状态类
 */
class AppState {
  // 当前视图
  currentView = $state<ViewType>('welcome')

  // 当前选中的AI平台
  selectedPlatform = $state<AIPlatform | null>(null)

  // 是否显示设置面板
  showSettings = $state<boolean>(false)

  // 是否正在加载
  isLoading = $state<boolean>(false)

  // 错误信息
  error = $state<string | null>(null)

  // WebView加载状态
  webviewLoading = $state<boolean>(false)

  // 更新提示信息
  updateVersion = $state<string | null>(null)
  updateReleaseNotes = $state<string | null>(null)
  updateReleaseUrl = $state<string | null>(null)
  updatePublishedAt = $state<string | null>(null)

  /**
   * 切换到AI对话视图
   */
  switchToChatView(platform: AIPlatform) {
    this.selectedPlatform = platform
    this.currentView = 'chat'
    this.showSettings = false
  }

  /**
   * 切换到翻译视图
   */
  switchToTranslationView() {
    this.currentView = 'translation'
    this.showSettings = false
  }

  /**
   * 切换到欢迎页
   */
  switchToWelcomeView() {
    this.selectedPlatform = null
    this.currentView = 'welcome'
    this.showSettings = false
  }

  /**
   * 打开设置面板
   */
  async openSettings() {
    // 首先确保隐藏所有子 webviews
    if (
      typeof window !== 'undefined'
      && typeof (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function'
    ) {
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
    this.showSettings = true
    this.currentView = 'settings'
  }

  /**
   * 关闭设置面板
   */
  closeSettings() {
    this.showSettings = false
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
    this.showSettings = false
    // 触发事件隐藏所有活跃的子webview（聊天、翻译等）
    window.dispatchEvent(new CustomEvent('hideAllWebviews'))
  }

  /**
   * 设置加载状态
   */
  setLoading(loading: boolean) {
    this.isLoading = loading
  }

  /**
   * 设置WebView加载状态
   */
  setWebviewLoading(loading: boolean) {
    this.webviewLoading = loading
  }

  setUpdateInfo(info: {
    version: string
    releaseNotes?: string | null
    releaseUrl?: string | null
    publishedAt?: string | null
  }) {
    this.updateVersion = info.version
    this.updateReleaseNotes = info.releaseNotes ?? null
    this.updateReleaseUrl = info.releaseUrl ?? null
    this.updatePublishedAt = info.publishedAt ?? null
  }

  clearUpdateInfo() {
    this.updateVersion = null
    this.updateReleaseNotes = null
    this.updateReleaseUrl = null
    this.updatePublishedAt = null
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
    this.showSettings = false
    this.isLoading = false
    this.error = null
    this.webviewLoading = false
  }
}

/**
 * 导出单例实例
 */
export const appState = new AppState()

// 初始化更新事件监听（模块加载时）
if (typeof window !== 'undefined') {
  void (async () => {
    try {
      await onUpdateAvailable(({ version, releaseNotes, releaseUrl, publishedAt }) => {
        logger.info('Update available', version)
        appState.setUpdateInfo({
          version,
          releaseNotes,
          releaseUrl,
          publishedAt,
        })
      })
      await onUpdateDownloaded(({ version, taskId }) => {
        logger.info('Update downloaded', version, taskId)
        if (version) {
          appState.updateVersion = version
        }
      })
    }
 catch (err) {
      logger.warn('Failed to register update listeners', err as unknown as string)
    }
  })()
}
