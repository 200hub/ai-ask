import { invoke } from "@tauri-apps/api/core";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { logger } from "$lib/utils/logger";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EVENTS } from "$lib/utils/constants";

export interface ChildWebviewBounds {
    positionLogical: { x: number; y: number };
    sizeLogical: { width: number; height: number };
    scaleFactor: number;
}

export const BOUNDS_EPSILON = 0.5;

export function boundsEqual(a: ChildWebviewBounds, b: ChildWebviewBounds): boolean {
    return (
        Math.abs(a.positionLogical.x - b.positionLogical.x) < BOUNDS_EPSILON &&
        Math.abs(a.positionLogical.y - b.positionLogical.y) < BOUNDS_EPSILON &&
        Math.abs(a.sizeLogical.width - b.sizeLogical.width) < BOUNDS_EPSILON &&
        Math.abs(a.sizeLogical.height - b.sizeLogical.height) < BOUNDS_EPSILON
    );
}

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

export class ChildWebviewProxy {
    #lastBounds: ChildWebviewBounds | null = null;
    #isVisible = false;
    #label: string;

    constructor(
        private readonly id: string,
        private readonly url: string,
        private readonly proxyUrl: string | null,
    ) {
        this.#label = id;
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
     * Evaluate JavaScript code in the child webview and return the result
     * @param script - JavaScript code to execute (should return a value)
     * @param timeout - Maximum time to wait for result in milliseconds (default: 10000)
     * @returns Promise resolving to the result of the script execution
     */
    async evaluateScript<T = unknown>(script: string, timeout = 10000): Promise<T> {
        try {
            const mainWindow = getCurrentWebviewWindow();
            
            // Invoke the command to execute the script
            const response = await invoke<{ success: boolean; requestId: string; message: string }>(
                "evaluate_child_webview_script",
                {
                    payload: {
                        id: this.id,
                        script,
                    },
                }
            );

            if (!response.success) {
                throw new Error(response.message);
            }

            const requestId = response.requestId;
            const eventName = `injection-result-${requestId}`;

            // Wait for the result event from the child webview
            return new Promise<T>((resolve, reject) => {
                let unlisten: (() => void) | null = null;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;

                const cleanup = () => {
                    if (unlisten) {
                        unlisten();
                    }
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                };

                // Set up timeout
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Script evaluation timed out after ${timeout}ms`));
                }, timeout);

                // Listen for the result event
                mainWindow
                    .listen<{ success: boolean; result?: T; error?: string }>(eventName, (event) => {
                        cleanup();
                        
                        if (event.payload.success && event.payload.result !== undefined) {
                            resolve(event.payload.result);
                        } else {
                            reject(new Error(event.payload.error || "Script evaluation failed"));
                        }
                    })
                    .then((fn) => {
                        unlisten = fn;
                    })
                    .catch((err) => {
                        cleanup();
                        reject(new Error(`Failed to listen for result event: ${err}`));
                    });
            });
        } catch (error) {
            logger.error("Failed to evaluate script in child webview", { id: this.id, error });
            throw error;
        }
    }

    isVisible(): boolean {
        return this.#isVisible;
    }
}
