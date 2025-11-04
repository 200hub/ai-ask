import { invoke } from "@tauri-apps/api/core";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { logger } from "$lib/utils/logger";

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
        console.error("计算子 WebView 边界失败，使用默认值:", error);
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

    constructor(
        private readonly id: string,
        private readonly url: string,
        private readonly proxyUrl: string | null,
    ) {}

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

    isVisible(): boolean {
        return this.#isVisible;
    }
}
