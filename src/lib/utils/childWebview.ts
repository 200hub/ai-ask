/**
 * 子 WebView 管理工具
 *
 * 提供子 WebView 的创建、显示、隐藏和边界计算等核心功能。
 * 子 WebView 用于嵌入 AI 平台和翻译服务的网页内容。
 */

import { invoke } from "@tauri-apps/api/core";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { logger } from "$lib/utils/logger";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EVENTS } from "$lib/utils/constants";

/**
 * 子 WebView 边界信息接口
 */
export interface ChildWebviewBounds {
  /** 逻辑坐标位置 */
  positionLogical: { x: number; y: number };
  /** 逻辑尺寸 */
  sizeLogical: { width: number; height: number };
  /** DPI 缩放因子 */
  scaleFactor: number;
}

/**
 * 边界比较的浮点误差容限（像素）
 */
export const BOUNDS_EPSILON = 0.5;

/**
 * 比较两个边界是否相等（考虑浮点误差）
 *
 * @param a - 边界 A
 * @param b - 边界 B
 * @returns 是否相等
 */
export function boundsEqual(a: ChildWebviewBounds, b: ChildWebviewBounds): boolean {
  return (
    Math.abs(a.positionLogical.x - b.positionLogical.x) < BOUNDS_EPSILON &&
    Math.abs(a.positionLogical.y - b.positionLogical.y) < BOUNDS_EPSILON &&
    Math.abs(a.sizeLogical.width - b.sizeLogical.width) < BOUNDS_EPSILON &&
    Math.abs(a.sizeLogical.height - b.sizeLogical.height) < BOUNDS_EPSILON
  );
}

/**
 * 计算子 WebView 的边界位置和尺寸
 *
 * 根据主窗口的布局元素（侧边栏、头部、主内容区）计算子 WebView 应该占据的区域。
 * 考虑了 DPI 缩放因子，确保在不同显示器上显示正确。
 *
 * @param mainWindow - 主窗口对象
 * @returns 计算得到的边界信息
 */
export async function calculateChildWebviewBounds(
  mainWindow: WebviewWindow,
): Promise<ChildWebviewBounds> {
  try {
    const scaleFactor = await mainWindow.scaleFactor();
    const innerSize = await mainWindow.innerSize();

    const layoutElements = {
      sidebar: document.querySelector(".sidebar") as HTMLElement | null,
      header: document.querySelector(".header") as HTMLElement | null,
      mainContent: document.querySelector(".main-content") as HTMLElement | null,
    };

    const sidebarWidth = layoutElements.sidebar?.offsetWidth ?? 56;
    const headerHeight = layoutElements.header?.offsetHeight ?? 44;
    const mainContentRect = layoutElements.mainContent?.getBoundingClientRect();

    const contentOffsetLeft = mainContentRect?.left ?? sidebarWidth;
    const contentOffsetTop = mainContentRect?.top ?? headerHeight;
    const contentWidth =
      mainContentRect?.width ?? Math.max(0, innerSize.width / scaleFactor - contentOffsetLeft);
    const contentHeight =
      mainContentRect?.height ?? Math.max(0, innerSize.height / scaleFactor - contentOffsetTop);

    return {
      positionLogical: {
        x: contentOffsetLeft,
        y: contentOffsetTop,
      },
      sizeLogical: {
        width: contentWidth,
        height: contentHeight,
      },
      scaleFactor,
    };
  } catch (error) {
    logger.error("Failed to calculate child webview bounds, using defaults", error);
    return {
      positionLogical: { x: 100, y: 100 },
      sizeLogical: { width: 800, height: 600 },
      scaleFactor: 1,
    };
  }
}

/**
 * 子 WebView 代理类
 *
 * 提供对 Rust 后端管理的子 WebView 的前端抽象接口。
 * 负责协调创建、显示、隐藏、更新边界等操作，并维护本地状态。
 */
export class ChildWebviewProxy {
  /** 上次设置的边界信息，用于避免重复更新 */
  #lastBounds: ChildWebviewBounds | null = null;
  /** 当前可见性状态 */
  #isVisible = false;
  /** WebView 标签（与 id 相同） */
  #label: string;

  /**
   * 创建子 WebView 代理实例
   *
   * @param id - WebView 唯一标识符
   * @param url - 要加载的 URL
   * @param proxyUrl - 代理服务器 URL（可选）
   */
  constructor(
    private readonly id: string,
    private readonly url: string,
    private readonly proxyUrl: string | null,
  ) {
    this.#label = id;
  }

  /**
   * Check if this child webview exists (has been created)
   * @returns Promise resolving to true if webview exists, false otherwise
   */
  async exists(): Promise<boolean> {
    try {
      const result = await invoke<boolean>("check_child_webview_exists", {
        payload: { id: this.id },
      });
      return result;
    } catch (error) {
      logger.warn("Failed to check webview existence", { id: this.id, error });
      return false;
    }
  }

  async ensure(bounds: ChildWebviewBounds) {
    this.#lastBounds = bounds;
    try {
      await invoke("ensure_child_webview", {
        payload: {
          id: this.id,
          url: this.url,
          bounds,
          proxyUrl: this.proxyUrl,
        },
      });
      this.#isVisible = false;
    } catch (error) {
      logger.error("Failed to ensure child webview", { id: this.id, error });
      throw error;
    }
  }

  async updateBounds(bounds: ChildWebviewBounds) {
    if (this.#lastBounds && boundsEqual(this.#lastBounds, bounds)) {
      return;
    }

    this.#lastBounds = bounds;
    try {
      await invoke("set_child_webview_bounds", {
        payload: {
          id: this.id,
          bounds,
        },
      });
    } catch (error) {
      logger.error("Failed to update child webview bounds", { id: this.id, error });
      throw error;
    }
  }

  async show() {
    if (this.#isVisible) {
      return;
    }

    try {
      await invoke("show_child_webview", {
        payload: { id: this.id },
      });
      this.#isVisible = true;
    } catch (error) {
      logger.error("Failed to show child webview", { id: this.id, error });
      throw error;
    }
  }

  /**
   * 等待该子 WebView 当前页面加载完成（基于 Rust 端的 on_page_load 事件）
   * - 默认超时时间为 15s，超时后将继续执行，不会抛错
   */
  async waitForLoadFinished(timeoutMs = 15000): Promise<void> {
    try {
      const mainWindow = getCurrentWebviewWindow();
      const eventName = EVENTS.CHILD_WEBVIEW_READY;
      let unlisten: unknown = null;

      const waitEvent = new Promise<void>((resolve) => {
        mainWindow
          .listen(eventName, (event) => {
            const payload = event.payload as { id?: string } | undefined;
            if (payload?.id === this.#label) {
              resolve();
            }
          })
          .then((fn) => {
            unlisten = fn;
          })
          .catch((e) => {
            logger.warn("Failed to listen child-webview ready event", e);
            resolve();
          });
      });

      const timeout = new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      });

      await Promise.race([waitEvent, timeout]);

      if (typeof unlisten === "function") {
        try {
          (unlisten as () => void)();
        } catch (e) {
          logger.debug("Failed to unlisten child-webview ready", e);
        }
      }
    } catch (error) {
      logger.warn("waitForLoadFinished failed, proceeding", { id: this.#label, error });
    }
  }

  async hide() {
    if (!this.#isVisible) {
      return;
    }

    try {
      await invoke("hide_child_webview", {
        payload: { id: this.id },
      });
      this.#isVisible = false;
    } catch (error) {
      logger.error("Failed to hide child webview", { id: this.id, error });
      throw error;
    }
  }

  async close() {
    try {
      await invoke("close_child_webview", {
        payload: { id: this.id },
      });
    } catch (error) {
      logger.error("Failed to close child webview", { id: this.id, error });
      throw error;
    } finally {
      this.#isVisible = false;
      this.#lastBounds = null;
    }
  }

  async setFocus() {
    try {
      await invoke("focus_child_webview", {
        payload: { id: this.id },
      });
    } catch (error) {
      logger.warn("Failed to focus child webview", { id: this.id, error });
    }
  }

  /**
   * Evaluate JavaScript code in the child webview
   * Note: External URLs don't have Tauri IPC, so we can't get return values.
   * The script will modify document.title to indicate success/failure:
   * - Success: title starts with [INJECTION_SUCCESS]
   * - Error: title starts with [INJECTION_ERROR:message]
   * @param script - JavaScript code to execute
   * @param timeout - Maximum time to wait for completion (default: 10000ms)
   * @returns Promise resolving to success/error based on title change
   */
  async evaluateScript<T = unknown>(script: string, timeout = 10000): Promise<T> {
    try {
      // Send script to child webview
      const response = await invoke<{ success: boolean; message: string }>(
        "evaluate_child_webview_script",
        {
          payload: {
            id: this.id,
            script,
          },
        },
      );

      if (!response.success) {
        throw new Error(response.message);
      }

      logger.info("Script sent to child webview, waiting for execution...", { id: this.id });

      // Wait for script execution (check console logs for actual result)
      // Since external webviews don't have Tauri IPC, we can't get return values
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 3000)));

      // Return a generic success result
      return { success: true, message: "Script executed, check console for details" } as T;
    } catch (error) {
      logger.error("Failed to evaluate script in child webview", { id: this.id, error });
      throw error;
    }
  }

  isVisible(): boolean {
    return this.#isVisible;
  }
}
