/**
 * WebView 事件管理模块
 *
 * 提供 WebView 相关的窗口事件监听管理功能，被 AIChatPage 和 TranslationPage 共享使用。
 * 统一处理主窗口的 resize、move、focus、blur、close 等事件。
 */

import type { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { logger } from './logger'

/**
 * WebView 事件处理器配置
 */
export interface WebviewEventHandlers {
  /** 窗口大小变化时触发 */
  onResize?: (size?: { width: number, height: number }) => void
  /** 窗口移动时触发 */
  onMove?: () => void
  /** 窗口获得焦点时触发 */
  onFocus?: () => void
  /** 窗口失去焦点时触发 */
  onBlur?: () => void
  /** 窗口关闭请求时触发 */
  onClose?: () => Promise<void>
  /** 收到隐藏所有 WebView 事件时触发 */
  onHideWebviews?: () => void
  /** 窗口最小化或隐藏时触发 */
  onMinimizedOrHidden?: () => void
  /** 窗口恢复或显示时触发 */
  onRestoredOrShown?: () => void
  /** 收到恢复 WebView 事件时触发 */
  onRestoreWebviews?: () => void
}

/**
 * 窗口事件监听器清理函数集合
 */
interface WindowEventUnlisteners {
  resize: (() => void) | null
  move: (() => void) | null
  scale: (() => void) | null
  focus: (() => void) | null
  blur: (() => void) | null
  close: (() => void) | null
  windowEvent: (() => void) | null
  hideWebviews: (() => void) | null
  restoreWebviews: (() => void) | null
}

/**
 * WebView 窗口事件管理器
 *
 * 用于统一注册和清理 Tauri 窗口事件监听器
 */
export class WebviewWindowEventManager {
  private unlisteners: WindowEventUnlisteners = {
    resize: null,
    move: null,
    scale: null,
    focus: null,
    blur: null,
    close: null,
    windowEvent: null,
    hideWebviews: null,
    restoreWebviews: null,
  }

  private isDisposed = false
  private readonly logPrefix: string

  /**
   * @param logPrefix - 日志前缀，用于区分不同页面的事件管理器
   */
  constructor(logPrefix: string) {
    this.logPrefix = logPrefix
  }

  /**
   * 注册所有 Tauri 窗口事件监听器
   *
   * @param mainWindow - 主窗口实例
   * @param handlers - 事件处理器配置
   * @returns 窗口是否获得焦点的初始状态
   */
  async register(
    mainWindow: WebviewWindow,
    handlers: WebviewEventHandlers,
  ): Promise<boolean> {
    let isMainWindowFocused = true

    try {
      // 获取窗口初始焦点状态
      try {
        isMainWindowFocused = await mainWindow.isFocused()
      }
      catch (error) {
        logger.error(`[${this.logPrefix}] Failed to get window focus state`, error)
      }

      // 注册窗口尺寸变化监听
      this.unlisteners.resize = await mainWindow.onResized(({ payload }) => {
        handlers.onResize?.(payload ?? undefined)
      })

      // 注册窗口移动监听
      this.unlisteners.move = await mainWindow.onMoved(() => {
        handlers.onMove?.()
      })

      // 注册缩放变化监听
      this.unlisteners.scale = await mainWindow.onScaleChanged(() => {
        handlers.onResize?.()
      })

      // 注册窗口获得焦点监听
      this.unlisteners.focus = await mainWindow.listen('tauri://focus', () => {
        handlers.onFocus?.()
      })

      // 注册窗口失去焦点监听
      this.unlisteners.blur = await mainWindow.listen('tauri://blur', () => {
        handlers.onBlur?.()
      })

      // 注册窗口关闭请求监听
      this.unlisteners.close = await mainWindow.onCloseRequested(async () => {
        await handlers.onClose?.()
      })

      // 注册来自 Rust 端的隐藏子 webview 事件（托盘/快捷键触发）
      this.unlisteners.hideWebviews = await mainWindow.listen('hideAllWebviews', () => {
        handlers.onHideWebviews?.()
      })

      // 注册窗口事件监听（最小化、隐藏等）
      this.unlisteners.windowEvent = await mainWindow.listen(
        'tauri://window-event',
        (event) => {
          const payload = event.payload as { event: string } | undefined
          if (payload?.event === 'minimized' || payload?.event === 'hidden') {
            handlers.onMinimizedOrHidden?.()
          }
          if (payload?.event === 'restored' || payload?.event === 'shown') {
            handlers.onRestoredOrShown?.()
          }
        },
      )

      // 注册恢复 WebView 事件
      this.unlisteners.restoreWebviews = await mainWindow.listen(
        'restoreWebviews',
        () => {
          handlers.onRestoreWebviews?.()
        },
      )

      // 如果组件已经被销毁，立即清理
      if (this.isDisposed) {
        this.cleanup()
      }
    }
    catch (error) {
      logger.error(`[${this.logPrefix}] Failed to register window events`, error)
    }

    return isMainWindowFocused
  }

  /**
   * 标记管理器已销毁，并清理所有监听器
   */
  dispose(): void {
    this.isDisposed = true
    this.cleanup()
  }

  /**
   * 清理所有事件监听器
   */
  private cleanup(): void {
    Object.entries(this.unlisteners).forEach(([key, unlisten]) => {
      if (unlisten) {
        unlisten()
        this.unlisteners[key as keyof WindowEventUnlisteners] = null
      }
    })
  }
}

/**
 * WebView 重排调度器
 *
 * 用于批量处理 WebView 位置更新，支持防抖优化
 */
export class WebviewReflowScheduler {
  private isPendingReflow = false
  private shouldEnsureActiveFront = false

  /**
   * 调度重排操作
   *
   * @param options - 调度选项
   * @param options.shouldEnsureActiveFront - 是否确保激活窗口在前台
   * @param options.immediate - 是否立即执行
   * @param executeReflow - 实际执行重排的回调函数
   */
  schedule(
    options: { shouldEnsureActiveFront?: boolean, immediate?: boolean },
    executeReflow: (shouldEnsureActiveFront: boolean) => void,
  ): void {
    const { shouldEnsureActiveFront: requestActiveFront = false, immediate = false } = options

    // 累积需要确保激活窗口在前台的标志
    this.shouldEnsureActiveFront ||= requestActiveFront

    const execute = () => {
      const needsFront = this.shouldEnsureActiveFront
      this.shouldEnsureActiveFront = false
      executeReflow(needsFront)
    }

    // 立即执行模式
    if (immediate) {
      if (this.isPendingReflow) {
        this.isPendingReflow = false
      }
      execute()
      return
    }

    // 防抖模式：如果已有待处理的操作，直接返回
    if (this.isPendingReflow) {
      return
    }

    this.isPendingReflow = true

    const run = () => {
      this.isPendingReflow = false
      execute()
    }

    // 优先使用 requestAnimationFrame 进行调度
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    }
    else {
      setTimeout(run, 16) // 约60FPS的降级方案
    }
  }
}
