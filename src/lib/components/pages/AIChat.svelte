<script lang="ts">
    /**
     * AI对话组件 - 使用 Tauri Webview 内嵌方式
     * 通过在当前窗口内创建多个 Webview 视图来规避 iframe 限制
     * 每个平台的内容保持在后台，仅通过显示/隐藏切换
     */
    import { onMount, onDestroy, tick } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { Webview } from "@tauri-apps/api/webview";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
    import type { AIPlatform } from "$lib/types/platform";

    // 主窗口句柄
    const appWindow = getCurrentWindow();

    // Webview 信息接口
    interface WebViewBounds {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    interface WebViewInfo {
        view: Webview;
        isLoading: boolean;
        hasError: boolean;
        isVisible: boolean;
        lastAccessTime: number;
        lastBounds: WebViewBounds | null;
    }

    // LRU 缓存配置
    const MAX_WEBVIEW_CACHE = 5; // 最多缓存5个webview

    // 存储所有已创建的 webview
    const loadedWebViews = new Map<string, WebViewInfo>();

    let currentPlatformId = $state<string | null>(null);
    let isCreatingWebView = $state(false);

    // 主窗口容器的位置和大小
    let containerRect = $state<DOMRect | null>(null);
    let containerElement = $state<HTMLElement | null>(null);
    let containerRectUpdateScheduled = false;
    let boundsUpdateScheduled = false;

    const isWindows =
        typeof navigator !== "undefined" &&
        navigator.userAgent.toLowerCase().includes("windows");
    let cursorEventsIgnored = false;
    let removeGlobalPointerMove: (() => void) | null = null;

    // 监听平台变化
    $effect(() => {
        if (appState.selectedPlatform) {
            currentPlatformId = appState.selectedPlatform.id;
            touchWebView(appState.selectedPlatform.id);
            const existing = loadedWebViews.get(appState.selectedPlatform.id);

            if (!existing) {
                createWebView(appState.selectedPlatform);
            } else {
                appState.setWebviewLoading(existing.isLoading);
            }

            updateWebViewVisibility();
        } else {
            currentPlatformId = null;
            updateWebViewVisibility();
            appState.setWebviewLoading(false);
        }
    });

    $effect(() => {
        if (!appState.selectedPlatform) {
            void toggleCursorForwarding(false);
        }
    });

    // 监听容器大小变化
    $effect(() => {
        if (!containerElement) return;

        const resizeObserver = new ResizeObserver(() => {
            scheduleContainerRectUpdate();
        });

        resizeObserver.observe(containerElement);

        // 初始化时获取位置
        updateContainerRect();

        return () => {
            resizeObserver.disconnect();
        };
    });

    /**
     * 更新容器的位置信息
     */
    function updateContainerRect() {
        if (containerElement) {
            const nextRect = containerElement.getBoundingClientRect();
            const previous = containerRect;
            containerRect = nextRect;

            if (
                previous &&
                Math.abs(previous.x - nextRect.x) < 0.5 &&
                Math.abs(previous.y - nextRect.y) < 0.5 &&
                Math.abs(previous.width - nextRect.width) < 0.5 &&
                Math.abs(previous.height - nextRect.height) < 0.5
            ) {
                return;
            }

            updateAllWebViewBounds();
        }
    }

    function scheduleContainerRectUpdate() {
        if (containerRectUpdateScheduled) return;
        containerRectUpdateScheduled = true;

        requestAnimationFrame(() => {
            containerRectUpdateScheduled = false;
            updateContainerRect();
        });
    }

    async function toggleCursorForwarding(ignore: boolean) {
        if (!isWindows) {
            return;
        }

        if (cursorEventsIgnored === ignore) {
            return;
        }

        cursorEventsIgnored = ignore;

        try {
            if (ignore) {
                if (!removeGlobalPointerMove) {
                    const handler = (event: PointerEvent) => {
                        if (!cursorEventsIgnored) {
                            return;
                        }

                        if (!containerElement) {
                            void toggleCursorForwarding(false);
                            return;
                        }

                        const rect = containerElement.getBoundingClientRect();
                        const { clientX, clientY } = event;
                        const outside =
                            clientX < rect.left ||
                            clientX > rect.right ||
                            clientY < rect.top ||
                            clientY > rect.bottom;

                        if (outside) {
                            void toggleCursorForwarding(false);
                        }
                    };

                    window.addEventListener("pointermove", handler, true);
                    removeGlobalPointerMove = () => {
                        window.removeEventListener("pointermove", handler, true);
                        removeGlobalPointerMove = null;
                    };
                }

                await appWindow.setIgnoreCursorEvents(true);
            } else {
                if (removeGlobalPointerMove) {
                    removeGlobalPointerMove();
                }
                await appWindow.setIgnoreCursorEvents(false);
            }
        } catch (error) {
            console.error("Failed to toggle cursor forwarding:", error);
        }
    }

    function handlePointerEnter() {
        if (!appState.selectedPlatform) {
            return;
        }

        void toggleCursorForwarding(true);
    }

    function handlePointerLeave() {
        if (!cursorEventsIgnored) {
            return;
        }

        void toggleCursorForwarding(false);
    }

    /**
    * LRU 缓存清理：移除最久未使用的 webview
     */
    async function evictLRUWebView() {
        if (loadedWebViews.size <= MAX_WEBVIEW_CACHE) {
            return;
        }

        // 找到最久未访问的 webview（不包括当前显示的）
        let oldestId: string | null = null;
        let oldestTime = Date.now();

        for (const [id, info] of loadedWebViews.entries()) {
            if (id !== currentPlatformId && info.lastAccessTime < oldestTime) {
                oldestTime = info.lastAccessTime;
                oldestId = id;
            }
        }

        // 移除最旧的 webview
        if (oldestId) {
            const webViewInfo = loadedWebViews.get(oldestId);
            if (webViewInfo) {
                try {
                    await webViewInfo.view.close();
                } catch (error) {
                    console.error(`Failed to close webview ${oldestId}:`, error);
                }
                loadedWebViews.delete(oldestId);
                console.log(`[LRU] Evicted webview: ${oldestId}`);
            }
        }
    }

    /**
     * 更新 webview 的访问时间（LRU）
     */
    function touchWebView(platformId: string) {
        const webViewInfo = loadedWebViews.get(platformId);
        if (webViewInfo) {
            webViewInfo.lastAccessTime = Date.now();
        }
    }

    /**
     * 创建新的内嵌 Webview
     */
    async function createWebView(platform: AIPlatform) {
        if (isCreatingWebView) return;
        isCreatingWebView = true;

        try {
            // 创建前先检查并清理缓存
            await evictLRUWebView();

            appState.setWebviewLoading(true);

            // 获取容器位置
            if (!containerRect) {
                await tick();
                updateContainerRect();
            }

            if (!containerRect) {
                throw new Error("Container not ready");
            }

            const webviewLabel = `ai-platform-${platform.id}`;

            const webview = new Webview(appWindow, webviewLabel, {
                url: platform.url,
                x: containerRect.x,
                y: containerRect.y,
                width: containerRect.width,
                height: containerRect.height,
                focus: false,
                dragDropEnabled: false,
            });

            const webViewInfo: WebViewInfo = {
                view: webview,
                isLoading: true,
                hasError: false,
                isVisible: false,
                lastAccessTime: Date.now(),
                lastBounds: null,
            };

            loadedWebViews.set(platform.id, webViewInfo);

            webview.once("tauri://created", async () => {
                webViewInfo.isLoading = false;
                webViewInfo.hasError = false;
                await webview.setAutoResize(false);
                await applyBounds(webViewInfo);

                if (appState.selectedPlatform?.id === platform.id) {
                    await webview.show();
                    await webview.setFocus();
                    appState.setWebviewLoading(false);
                    webViewInfo.isVisible = true;
                } else {
                    await webview.hide();
                    webViewInfo.isVisible = false;
                }
            });

            webview.once("tauri://error", (error) => {
                console.error(`Webview error: ${platform.id}`, error);
                webViewInfo.isLoading = false;
                webViewInfo.hasError = true;
                appState.setWebviewLoading(false);
                appState.setError(
                    `加载 ${platform.name} 失败。请检查网络连接或代理设置。`,
                );
            });
        } catch (error) {
            console.error(`Failed to create webview for ${platform.id}:`, error);
            appState.setWebviewLoading(false);
            appState.setError(
                `创建 ${platform.name} 窗口失败：${error}`,
            );
        } finally {
            isCreatingWebView = false;
        }
    }

    /**
     * 显示指定的 webview
     */
    async function showWebView(platformId: string) {
        const webViewInfo = loadedWebViews.get(platformId);
        if (webViewInfo) {
            if (webViewInfo.isVisible) {
                return;
            }
            if (webViewInfo.isLoading) {
                return;
            }
            try {
                await applyBounds(webViewInfo);
                await webViewInfo.view.show();
                await webViewInfo.view.setFocus();
                webViewInfo.isLoading = false;
                webViewInfo.isVisible = true;
                appState.setWebviewLoading(false);
            } catch (error) {
                console.error(`Failed to show webview ${platformId}:`, error);
            }
        }
    }

    /**
     * 隐藏指定的 webview
     */
    async function hideWebView(platformId: string) {
        const webViewInfo = loadedWebViews.get(platformId);
        if (webViewInfo) {
            if (!webViewInfo.isVisible) {
                return;
            }
            try {
                await webViewInfo.view.hide();
                webViewInfo.isVisible = false;
            } catch (error) {
                console.error(`Failed to hide webview ${platformId}:`, error);
            }
        }
    }

    /**
     * 更新所有 webview 的位置和大小
     */
    function updateAllWebViewBounds() {
        if (!containerRect) return;
        scheduleBoundsUpdate();
    }

    /**
     * 应用当前容器的边界到指定 webview
     */
    async function applyBounds(info: WebViewInfo) {
        if (!containerRect) return;

        try {
            const pos = new LogicalPosition(
                Math.round(containerRect.x),
                Math.round(containerRect.y),
            );
            const size = new LogicalSize(
                Math.round(containerRect.width),
                Math.round(containerRect.height),
            );

            const nextBounds: WebViewBounds = {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
            };

            if (
                info.lastBounds &&
                info.lastBounds.x === nextBounds.x &&
                info.lastBounds.y === nextBounds.y &&
                info.lastBounds.width === nextBounds.width &&
                info.lastBounds.height === nextBounds.height
            ) {
                return;
            }

            await info.view.setPosition(pos);
            await info.view.setSize(size);

            info.lastBounds = nextBounds;
        } catch (error) {
            console.error("Failed to apply webview bounds:", error);
        }
    }

    function scheduleBoundsUpdate() {
        if (boundsUpdateScheduled) return;
        boundsUpdateScheduled = true;

        requestAnimationFrame(() => {
            boundsUpdateScheduled = false;
            if (!containerRect) return;

            void (async () => {
                for (const webViewInfo of loadedWebViews.values()) {
                    try {
                        await applyBounds(webViewInfo);
                    } catch (error) {
                        console.error("Failed to update webview position:", error);
                    }
                }
            })();
        });
    }

    /**
     * 更新 webview 显示状态
     */
    async function updateWebViewVisibility() {
        for (const [platformId, webViewInfo] of loadedWebViews) {
            if (platformId === currentPlatformId) {
                await showWebView(platformId);
            } else {
                await hideWebView(platformId);
            }
        }
    }

    /**
     * 重新加载当前平台
     */
    async function reload() {
        if (!appState.selectedPlatform) return;

        const webViewInfo = loadedWebViews.get(appState.selectedPlatform.id);
        if (webViewInfo) {
            try {
                // 关闭旧窗口
                await webViewInfo.view.close();
                loadedWebViews.delete(appState.selectedPlatform.id);
                
                // 创建新窗口
                await createWebView(appState.selectedPlatform);
            } catch (error) {
                console.error("Failed to reload:", error);
            }
        }
    }

    /**
     * 处理来自 Header 的刷新事件
     */
    function handleRefreshEvent(event: Event) {
        const customEvent = event as CustomEvent;
        if (customEvent.detail?.platformId === currentPlatformId) {
            reload();
        }
    }

    /**
     * 处理清理缓存事件
     */
    async function handleClearCacheEvent() {
        await clearWebViewCache();
    }

    /**
     * 清理 webview 缓存
     */
    export async function clearWebViewCache() {
        for (const [id, webViewInfo] of loadedWebViews.entries()) {
            if (id !== currentPlatformId) {
                try {
                    await webViewInfo.view.close();
                } catch (error) {
                    console.error(`Failed to close webview ${id}:`, error);
                }
                loadedWebViews.delete(id);
            }
        }
        console.log("[Cache] Cleared all inactive webviews");
        await updateWebViewVisibility();
    }

    /**
     * 获取缓存统计信息
     */
    export function getCacheStats() {
        return {
            total: loadedWebViews.size,
            max: MAX_WEBVIEW_CACHE,
            current: currentPlatformId,
            cached: Array.from(loadedWebViews.keys()),
        };
    }

    onMount(() => {
        // 监听刷新事件
        window.addEventListener(
            "refreshWebview",
            handleRefreshEvent as EventListener,
        );

        // 监听清理缓存事件
        window.addEventListener(
            "clearIframeCache",
            handleClearCacheEvent as EventListener,
        );

        // 监听窗口大小变化
    window.addEventListener("resize", scheduleContainerRectUpdate);

        return () => {
            window.removeEventListener(
                "refreshWebview",
                handleRefreshEvent as EventListener,
            );
            window.removeEventListener(
                "clearIframeCache",
                handleClearCacheEvent as EventListener,
            );
            window.removeEventListener("resize", scheduleContainerRectUpdate);
        };
    });

    onDestroy(async () => {
        if (isWindows && cursorEventsIgnored) {
            try {
                await appWindow.setIgnoreCursorEvents(false);
            } catch (error) {
                console.error("Failed to restore cursor events:", error);
            }
            cursorEventsIgnored = false;
        }

        if (removeGlobalPointerMove) {
            removeGlobalPointerMove();
        }

        // 清理所有 webview
        for (const [_, webViewInfo] of loadedWebViews) {
            try {
                await webViewInfo.view.close();
            } catch (error) {
                console.error("Failed to close webview:", error);
            }
        }
        loadedWebViews.clear();
    });
</script>

<div class="chat-container">
    {#if appState.selectedPlatform}
        <!-- WebView 容器 - webview 窗口会覆盖在这个位置 -->
        <div
            bind:this={containerElement}
            class="webview-container"
            role="region"
            aria-label="AI 平台内容"
            onpointerenter={handlePointerEnter}
            onpointerleave={handlePointerLeave}
        >
            {#if isCreatingWebView || appState.webviewLoading}
                <div class="loading-overlay">
                    <div class="loading-spinner">
                        <svg class="spinner" viewBox="0 0 50 50">
                            <circle
                                class="path"
                                cx="25"
                                cy="25"
                                r="20"
                                fill="none"
                                stroke-width="4"
                            ></circle>
                        </svg>
                        <p class="loading-text">加载中...</p>
                    </div>
                </div>
            {/if}
        </div>
    {:else}
        <div class="no-platform">
            <p>请选择一个AI平台</p>
        </div>
    {/if}
</div>

<style>
    .chat-container {
        width: 100%;
        height: 100%;
        position: relative;
        background-color: var(--bg-primary);
        overflow: hidden;
    }

    .webview-container {
        width: 100%;
        height: 100%;
        position: relative;
        background-color: transparent;
    }

    .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--bg-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        pointer-events: none;
    }

    .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .spinner {
        width: 50px;
        height: 50px;
        animation: rotate 2s linear infinite;
    }

    .path {
        stroke: var(--accent-color);
        stroke-linecap: round;
        animation: dash 1.5s ease-in-out infinite;
    }

    @keyframes rotate {
        100% {
            transform: rotate(360deg);
        }
    }

    @keyframes dash {
        0% {
            stroke-dasharray: 1, 150;
            stroke-dashoffset: 0;
        }
        50% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -35;
        }
        100% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -124;
        }
    }

    .loading-text {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .no-platform {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .no-platform p {
        font-size: 1rem;
        color: var(--text-secondary);
    }
</style>
