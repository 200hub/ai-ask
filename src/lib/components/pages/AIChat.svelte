<script lang="ts">
    /**
     * AI对话组件 - 使用 WebviewWindow 方案
     * 通过 Tauri 原生 WebviewWindow 加载外部网页，规避 iframe 限制
     */
    import { onMount, onDestroy } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import type { AIPlatform } from "$lib/types/platform";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

    // 当前主窗口
    const appWindow = getCurrentWebviewWindow();

    // Webview 窗口映射: platformId -> WebviewWindow
    let webviewWindows = $state<Map<string, WebviewWindow>>(new Map());
    let currentPlatformId = $state<string | null>(null);
    let layoutObserverCleanup: (() => void) | null = null;
    let resizeUnlisten: (() => void) | null = null;
    let moveUnlisten: (() => void) | null = null;
    let scaleUnlisten: (() => void) | null = null;
    let focusUnlisten: (() => void) | null = null;
    let blurUnlisten: (() => void) | null = null;
    let closeUnlisten: (() => void) | null = null;
    let windowEventUnlisten: (() => void) | null = null;
    let hideWebviewsUnlisten: (() => void) | null = null;
    let reflowPending = false;
    let pendingEnsureFrontActive = false;
    let appWindowFocused = $state(true);
    const clearedWebviewCacheLabels = new Set<string>();

    // 监听平台变化
    $effect(() => {
        if (appState.selectedPlatform) {
            currentPlatformId = appState.selectedPlatform.id;
            showPlatform(appState.selectedPlatform);
        } else {
            currentPlatformId = null;
            hideAllWebviews();
        }
    });

    /**
     * 显示指定平台的 Webview
     */
    async function showPlatform(platform: AIPlatform) {
        try {
            appState.setWebviewLoading(true);

            // 隐藏其他所有 webview
            for (const [id, window] of webviewWindows.entries()) {
                if (id !== platform.id) {
                    await window.hide();
                    try {
                        await window.setAlwaysOnTop(false);
                    } catch (error) {
                        console.error("取消置顶失败:", error);
                    }
                }
            }

            // 获取或创建 webview
            let webview = webviewWindows.get(platform.id);
            if (!webview) {
                webview = await createWebview(platform);
                webviewWindows.set(platform.id, webview);
            }

            await positionWebview(webview, {
                keepTop: true,
            });

            requestWebviewReflow({ ensureFrontActive: true, immediate: true });

            // 显示 webview
            await webview.show();
            await webview.setFocus();

            requestWebviewReflow({ ensureFrontActive: true });

            appState.setWebviewLoading(false);
        } catch (error) {
            console.error("显示平台 Webview 失败:", error);
            appState.setError(`加载 ${platform.name} 失败`);
            appState.setWebviewLoading(false);
        }
    }

    /**
     * 创建新的 Webview 窗口
     */
    async function createWebview(platform: AIPlatform): Promise<WebviewWindow> {
        const webview = new WebviewWindow(`ai-chat-${platform.id}`, {
            url: platform.url,
            title: platform.name,
            visible: false,
            decorations: false, // 无边框
            skipTaskbar: true, // 不显示在任务栏
            transparent: false,
            alwaysOnTop: true,
            shadow: false,
            resizable: false,
        });

        // 等待窗口创建完成
        await new Promise<void>((resolve) => {
            webview.once("tauri://created", () => {
                console.log(`${platform.name} 窗口已创建`);
                resolve();
            });
            webview.once("tauri://error", (e) => {
                console.error("Webview 创建失败:", e);
                resolve(); // 即使失败也 resolve，避免卡住
            });
        });

        try {
            await webview.clearAllBrowsingData();
            clearedWebviewCacheLabels.add(platform.id);
            console.log(`${platform.name} 浏览数据已清除`);
        } catch (error) {
            console.error(`清除 ${platform.name} 浏览数据失败:`, error);
        }

        // 监听窗口加载完成
        webview.once("tauri://loaded", async () => {
            console.log(`${platform.name} 加载完成`);
        });

        return webview;
    }

    /**
     * 计算 Webview 窗口的边界（位置和大小）
     */
    async function calculateWebviewBounds(): Promise<{
        positionLogical: { x: number; y: number };
        sizeLogical: { width: number; height: number };
        scaleFactor: number;
    }> {
        try {
            const scaleFactor = await appWindow.scaleFactor();

            const [outerPosition, outerSize, innerSize] = await Promise.all([
                appWindow.outerPosition(),
                appWindow.outerSize(),
                appWindow.innerSize(),
            ]);

            let innerPosition: Awaited<ReturnType<typeof appWindow.innerPosition>> | null = null;
            try {
                innerPosition = await appWindow.innerPosition();
            } catch (error) {
                console.warn("无法获取 innerPosition，使用 outerPosition 计算:", error);
            }

            const sidebarEl = document.querySelector(".sidebar") as HTMLElement | null;
            const headerEl = document.querySelector(".header") as HTMLElement | null;
            const mainContentEl = document.querySelector(".main-content") as HTMLElement | null;

            const sidebarLogical = sidebarEl?.offsetWidth ?? 56;
            const headerLogical = headerEl?.offsetHeight ?? 44;

            const rect = mainContentEl?.getBoundingClientRect();

            const offsetLeftLogical = rect?.left ?? sidebarLogical;
            const offsetTopLogical = rect?.top ?? headerLogical;
            const contentWidthLogical =
                rect?.width ?? Math.max(0, innerSize.width / scaleFactor - offsetLeftLogical);
            const contentHeightLogical =
                rect?.height ?? Math.max(0, innerSize.height / scaleFactor - offsetTopLogical);

            let basePhysicalX = innerPosition?.x ?? 0;
            let basePhysicalY = innerPosition?.y ?? 0;

            if (!innerPosition) {
                const horizontalBorderPhysical = Math.max(
                    0,
                    Math.round((outerSize.width - innerSize.width) / 2),
                );
                const verticalDiffPhysical = Math.max(0, outerSize.height - innerSize.height);
                const topInsetPhysical = Math.max(
                    0,
                    verticalDiffPhysical - horizontalBorderPhysical,
                );

                basePhysicalX = outerPosition.x + horizontalBorderPhysical;
                basePhysicalY = outerPosition.y + topInsetPhysical;

                console.log("outerPosition fallback:", {
                    horizontalBorderPhysical,
                    verticalDiffPhysical,
                    topInsetPhysical,
                });
            }

            const baseLogicalX = basePhysicalX / scaleFactor;
            const baseLogicalY = basePhysicalY / scaleFactor;

            const positionLogical = {
                x: baseLogicalX + offsetLeftLogical,
                y: baseLogicalY + offsetTopLogical,
            };
            const sizeLogical = {
                width: contentWidthLogical,
                height: contentHeightLogical,
            };

            const positionPhysical = {
                x: Math.round(positionLogical.x * scaleFactor),
                y: Math.round(positionLogical.y * scaleFactor),
            };
            const sizePhysical = {
                width: Math.round(sizeLogical.width * scaleFactor),
                height: Math.round(sizeLogical.height * scaleFactor),
            };

            console.log("计算 Webview 边界:", {
                scaleFactor,
                baseLogicalPosition: { x: baseLogicalX, y: baseLogicalY },
                offsetLogical: { left: offsetLeftLogical, top: offsetTopLogical },
                sizeLogical,
                positionLogical,
                positionPhysical,
                sizePhysical,
            });

            return { positionLogical, sizeLogical, scaleFactor };
        } catch (error) {
            console.error("计算 Webview 边界失败:", error);
            return {
                positionLogical: { x: 100, y: 100 },
                sizeLogical: { width: 800, height: 600 },
                scaleFactor: 1,
            };
        }
    }

    interface PositionOptions {
        keepTop?: boolean;
    }

    interface ReflowOptions {
        ensureFrontActive?: boolean;
        immediate?: boolean;
    }

    interface PositionAllOptions {
        ensureFrontActive?: boolean;
    }

    async function positionWebview(
        webview: WebviewWindow,
        { keepTop }: PositionOptions = {},
    ) {
        try {
            const { positionLogical, sizeLogical, scaleFactor } =
                await calculateWebviewBounds();

            const logicalPosition = new LogicalPosition(
                positionLogical.x,
                positionLogical.y,
            );
            const logicalSize = new LogicalSize(
                sizeLogical.width,
                sizeLogical.height,
            );

            const physicalPosition = logicalPosition.toPhysical(scaleFactor);
            const physicalSize = logicalSize.toPhysical(scaleFactor);

            await webview.setPosition(physicalPosition);
            await webview.setSize(physicalSize);

            const activeWebview =
                currentPlatformId ? webviewWindows.get(currentPlatformId) : null;
            const isActive = activeWebview === webview;
            const shouldKeepTop = keepTop ?? isActive;
            const shouldBeTop = shouldKeepTop && appWindowFocused;

            try {
                await webview.setAlwaysOnTop(shouldBeTop);
            } catch (error) {
                console.error("更新 Webview 置顶状态失败:", error);
            }

            console.log("Webview 位置已调整", {
                logicalPosition: positionLogical,
                logicalSize: sizeLogical,
                physicalPosition,
                physicalSize,
                shouldBeTop,
            });
        } catch (error) {
            console.error("调整 Webview 位置失败:", error);
        }
    }

    async function positionAllWebviews({ ensureFrontActive = false }: PositionAllOptions = {}) {
        if (webviewWindows.size === 0) {
            return;
        }

        const activeWebview =
            currentPlatformId ? webviewWindows.get(currentPlatformId) : null;

        const tasks: Promise<void>[] = [];

        for (const webview of webviewWindows.values()) {
            const isActive = webview === activeWebview;
            tasks.push(
                (async () => {
                    await positionWebview(webview, { keepTop: isActive });

                    if (ensureFrontActive && isActive && appWindowFocused) {
                        try {
                            await webview.show();
                            await webview.setFocus();
                        } catch (error) {
                            console.error("激活 Webview 失败:", error);
                        }
                    }
                })(),
            );
        }

        await Promise.all(tasks);
    }

    async function setAllWebviewsAlwaysOnTop(activeShouldBeTop: boolean) {
        const activeWebview =
            currentPlatformId ? webviewWindows.get(currentPlatformId) : null;

        const tasks: Promise<void>[] = [];

        for (const webview of webviewWindows.values()) {
            const shouldBeTop =
                activeShouldBeTop && appWindowFocused && webview === activeWebview;
            tasks.push(
                (async () => {
                    try {
                        await webview.setAlwaysOnTop(shouldBeTop);
                    } catch (error) {
                        console.error("更新 Webview 置顶状态失败:", error);
                    }
                })(),
            );
        }

        await Promise.all(tasks);
    }

    function requestWebviewReflow({
        ensureFrontActive = false,
        immediate = false,
    }: ReflowOptions = {}) {
        pendingEnsureFrontActive ||= ensureFrontActive;

        const execute = () => {
            const ensureFront = pendingEnsureFrontActive;
            pendingEnsureFrontActive = false;

            const promise = positionAllWebviews({ ensureFrontActive: ensureFront });
            void promise.catch((error) => {
                console.error("批量调整 Webview 失败:", error);
            });
        };

        if (immediate) {
            if (reflowPending) {
                reflowPending = false;
            }
            execute();
            return;
        }

        if (reflowPending) {
            return;
        }

        reflowPending = true;

        const run = () => {
            reflowPending = false;
            execute();
        };

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    /**
     * 隐藏所有 Webview
     */
    async function hideAllWebviews() {
        console.log(`[AIChat] hideAllWebviews 开始，共 ${webviewWindows.size} 个 webview`);
        for (const [id, webview] of webviewWindows.entries()) {
            try {
                console.log(`[AIChat] 正在隐藏 webview: ${id}`);
                await webview.hide();
                await webview.setAlwaysOnTop(false);
                console.log(`[AIChat] webview ${id} 隐藏成功`);
            } catch (error) {
                console.error(`[AIChat] 隐藏 Webview ${id} 失败:`, error);
            }
        }
        console.log("[AIChat] hideAllWebviews 完成");
    }

    async function closeAllWebviews() {
        const tasks: Promise<void>[] = [];

        for (const [id, webview] of webviewWindows.entries()) {
            tasks.push(
                (async () => {
                    try {
                        await webview.close();
                    } catch (error) {
                        console.error(`关闭 Webview ${id} 失败:`, error);
                    }
                })(),
            );
        }

        await Promise.all(tasks);
        webviewWindows = new Map();
    }

    /**
     * 刷新当前平台
     */
    export async function reload() {
        if (currentPlatformId && appState.selectedPlatform) {
            const webview = webviewWindows.get(currentPlatformId);
            if (webview) {
                try {
                    // 销毁旧窗口
                    await webview.close();
                    webviewWindows.delete(currentPlatformId);

                    // 重新创建
                    await showPlatform(appState.selectedPlatform);
                } catch (error) {
                    console.error("刷新 Webview 失败:", error);
                }
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

    function handleHideAllWebviewsEvent() {
        void hideAllWebviews();
    }

    function handleSuspendWebviewTopEvent() {
        void setAllWebviewsAlwaysOnTop(false);
    }

    function handleResumeWebviewTopEvent() {
        void setAllWebviewsAlwaysOnTop(true);
        requestWebviewReflow({ ensureFrontActive: true, immediate: true });
    }

    /**
     * 处理主窗口位置/大小变化
     */
    function handleMainWindowResize(size?: { width: number; height: number }) {
        if (size && (size.width === 0 || size.height === 0)) {
            void hideAllWebviews();
            return;
        }

        requestWebviewReflow({ ensureFrontActive: true, immediate: true });
    }

    function handleMainWindowMove() {
        requestWebviewReflow({ ensureFrontActive: true, immediate: true });
    }

    function setupLayoutObservers(): (() => void) | null {
        if (typeof ResizeObserver === "undefined") {
            return null;
        }

        const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
                ".main-content, .sidebar, .header",
            ),
        );

        if (elements.length === 0) {
            return null;
        }

        const observer = new ResizeObserver(() => {
            requestWebviewReflow();
        });

        elements.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }

    onMount(() => {
        // 监听刷新事件
        window.addEventListener(
            "refreshWebview",
            handleRefreshEvent as EventListener,
        );

        window.addEventListener(
            "hideAllWebviews",
            handleHideAllWebviewsEvent,
        );

        window.addEventListener(
            "suspendWebviewTop",
            handleSuspendWebviewTopEvent,
        );

        window.addEventListener(
            "resumeWebviewTop",
            handleResumeWebviewTopEvent,
        );

        // 监听主窗口大小变化
    const handleWindowResize = () => handleMainWindowResize();
    window.addEventListener("resize", handleWindowResize);

        // 监听布局元素尺寸变化
        layoutObserverCleanup?.();
        layoutObserverCleanup = setupLayoutObservers();

        let disposed = false;

        // 监听主窗口尺寸变化（原生事件）
        (async () => {
            try {
                try {
                    appWindowFocused = await appWindow.isFocused();
                    void setAllWebviewsAlwaysOnTop(appWindowFocused);
                } catch (error) {
                    console.error("获取窗口焦点状态失败:", error);
                }

                resizeUnlisten = await appWindow.onResized(({ payload }) => {
                    handleMainWindowResize(payload ?? undefined);
                });
                if (disposed && resizeUnlisten) {
                    resizeUnlisten();
                    resizeUnlisten = null;
                }

                moveUnlisten = await appWindow.onMoved(() => {
                    handleMainWindowMove();
                });
                if (disposed && moveUnlisten) {
                    moveUnlisten();
                    moveUnlisten = null;
                }

                scaleUnlisten = await appWindow.onScaleChanged(() => {
                    handleMainWindowResize();
                });
                if (disposed && scaleUnlisten) {
                    scaleUnlisten();
                    scaleUnlisten = null;
                }

                focusUnlisten = await appWindow.listen("tauri://focus", () => {
                    appWindowFocused = true;
                    void setAllWebviewsAlwaysOnTop(true);
                    requestWebviewReflow({ ensureFrontActive: true, immediate: true });
                });
                if (disposed && focusUnlisten) {
                    focusUnlisten();
                    focusUnlisten = null;
                }

                blurUnlisten = await appWindow.listen("tauri://blur", () => {
                    appWindowFocused = false;
                    void setAllWebviewsAlwaysOnTop(false);
                });
                if (disposed && blurUnlisten) {
                    blurUnlisten();
                    blurUnlisten = null;
                }

                closeUnlisten = await appWindow.onCloseRequested(async () => {
                    await closeAllWebviews();
                });
                if (disposed && closeUnlisten) {
                    closeUnlisten();
                    closeUnlisten = null;
                }

                // 监听来自 Rust 端的隐藏所有 webview 事件（托盘/快捷键触发）
                hideWebviewsUnlisten = await appWindow.listen("hideAllWebviews", () => {
                    console.log("[AIChat] 收到 Rust 端的 hideAllWebviews 事件");
                    void hideAllWebviews();
                });
                if (disposed && hideWebviewsUnlisten) {
                    hideWebviewsUnlisten();
                    hideWebviewsUnlisten = null;
                }

                windowEventUnlisten = await appWindow.listen(
                    "tauri://window-event",
                    (event) => {
                        const payload = event.payload as { event: string } | undefined;
                        if (payload?.event === "minimized" || payload?.event === "hidden") {
                            void hideAllWebviews();
                        }
                    },
                );
                if (disposed && windowEventUnlisten) {
                    windowEventUnlisten();
                    windowEventUnlisten = null;
                }
            } catch (error) {
                console.error("注册窗口事件失败:", error);
            }
        })();

        requestWebviewReflow({ ensureFrontActive: true });

        return () => {
            disposed = true;
            window.removeEventListener(
                "refreshWebview",
                handleRefreshEvent as EventListener,
            );
            window.removeEventListener(
                "hideAllWebviews",
                handleHideAllWebviewsEvent,
            );
            window.removeEventListener(
                "suspendWebviewTop",
                handleSuspendWebviewTopEvent,
            );
            window.removeEventListener(
                "resumeWebviewTop",
                handleResumeWebviewTopEvent,
            );
            window.removeEventListener("resize", handleWindowResize);

            layoutObserverCleanup?.();
            layoutObserverCleanup = null;

            if (resizeUnlisten) {
                resizeUnlisten();
                resizeUnlisten = null;
            }
            if (moveUnlisten) {
                moveUnlisten();
                moveUnlisten = null;
            }
            if (scaleUnlisten) {
                scaleUnlisten();
                scaleUnlisten = null;
            }
            if (focusUnlisten) {
                focusUnlisten();
                focusUnlisten = null;
            }
            if (blurUnlisten) {
                blurUnlisten();
                blurUnlisten = null;
            }
            if (closeUnlisten) {
                closeUnlisten();
                closeUnlisten = null;
            }
            if (hideWebviewsUnlisten) {
                hideWebviewsUnlisten();
                hideWebviewsUnlisten = null;
            }
            if (windowEventUnlisten) {
                windowEventUnlisten();
                windowEventUnlisten = null;
            }
        };
    });

    onDestroy(async () => {
        await closeAllWebviews();
    });
</script>

<div class="chat-container">
    {#if appState.selectedPlatform}
        <!-- Webview 在独立窗口中，这里只显示加载状态 -->
        {#if appState.webviewLoading}
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
                    <p class="loading-text">加载 {appState.selectedPlatform.name}...</p>
                </div>
            </div>
        {/if}
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
