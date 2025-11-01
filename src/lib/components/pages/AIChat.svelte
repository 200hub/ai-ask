<script lang="ts">
    /**
     * AI对话组件 - 子 Webview 管理器
     * 
     * 核心功能:
     * 1. 管理多个 AI 平台的子 webview 实例
     * 2. 处理子 webview 的创建、定位、显示/隐藏
     * 3. 同步主窗口和子 webview 的状态（位置、尺寸）
     * 4. 响应窗口事件和用户交互
     */
    import { onMount, onDestroy } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import type { AIPlatform } from "$lib/types/platform";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { calculateChildWebviewBounds, ChildWebviewProxy } from "$lib/utils/childWebview";
    import { createProxySignature, resolveProxyUrl } from "$lib/utils/proxy";

    type ManagedWebview = ChildWebviewProxy;

    // ========== 核心状态变量 ==========
    
    /** 主窗口实例 */
    const mainWindow = getCurrentWebviewWindow();
    
    /** 子 webview 映射表: platformId -> 子 webview 代理 */
    let webviewWindows = $state<Map<string, ManagedWebview>>(new Map());
    
    /** 当前激活的平台ID */
    let activePlatformId = $state<string | null>(null);
    
    /** 主窗口是否获得焦点 */
    let isMainWindowFocused = $state(true);

    /** 当前代理配置签名，用于监听变更 */
    let proxySignature = $state(createProxySignature(configStore.config.proxy));
    
    // ========== 重新布局相关状态 ==========
    
    /** 是否有待处理的重新布局请求 */
    let isPendingReflow = false;
    
    /** 是否需要确保激活窗口在前台 */
    let shouldEnsureActiveFront = false;
    
    // ========== 事件监听器清理函数 ==========
    
    /** Tauri 窗口事件监听器清理函数集合 */
    const windowEventUnlisteners = {
        resize: null as (() => void) | null,
        move: null as (() => void) | null,
        scale: null as (() => void) | null,
        focus: null as (() => void) | null,
        blur: null as (() => void) | null,
        close: null as (() => void) | null,
        windowEvent: null as (() => void) | null,
        hideWebviews: null as (() => void) | null,
        hideWebviewsNoRestore: null as (() => void) | null,
        restoreWebviews: null as (() => void) | null,
    };

    /** 标记是否需要在恢复主窗口时恢复 WebView */
    let shouldRestoreWebviews = false;

    /** 是否抑制下一次 WebView 恢复 */
    let suppressNextRestore = false;

    // ========== 响应式状态监听 ==========

    /** 监听代理配置变化，必要时重建 WebView */
    $effect(() => {
        const signature = createProxySignature(configStore.config.proxy);
        if (signature !== proxySignature) {
            proxySignature = signature;
            void handleProxyConfigChange();
        }
    });
    
    /** 监听选中平台变化，自动切换显示对应的WebView */
    $effect(() => {
        const platform = appState.selectedPlatform;
        const currentView = appState.currentView;

        if (!platform) {
            activePlatformId = null;
            appState.setWebviewLoading(false);
            void hideAllWebviews();
            return;
        }

        activePlatformId = platform.id;

        if (currentView !== "chat") {
            appState.setWebviewLoading(false);
            void hideAllWebviews();
            return;
        }

        showPlatformWebview(platform);
    });

    // ========== WebView 管理核心方法 ==========
    
    async function handleProxyConfigChange() {
        if (webviewWindows.size === 0) {
            return;
        }

        const closeTasks: Promise<void>[] = [];

        for (const [id, webview] of webviewWindows.entries()) {
            closeTasks.push(
                webview
                    .close()
                    .catch((error) => {
                        console.error(`关闭 WebView ${id} 失败:`, error);
                    }),
            );
        }

        await Promise.all(closeTasks);
        webviewWindows = new Map();
        shouldRestoreWebviews = false;

        if (appState.currentView === "chat" && appState.selectedPlatform) {
            await showPlatformWebview(appState.selectedPlatform);
        }
    }

    /**
     * 显示指定平台的子 webview
     * 
     * 工作流程:
     * 1. 隐藏其他平台的子 webview
     * 2. 获取或创建目标平台的子 webview
     * 3. 调整位置和尺寸
     * 4. 显示并获取焦点
     * 
     * @param platform - 要显示的AI平台配置
     */
    async function showPlatformWebview(platform: AIPlatform) {
        try {
            appState.setWebviewLoading(true);

            // 1. 隐藏其他平台的WebView
            await hideOtherWebviews(platform.id);

            // 2. 获取或创建目标WebView
            let webview = webviewWindows.get(platform.id);
            
            if (!webview) {
                webview = await createWebviewForPlatform(platform);
                webviewWindows.set(platform.id, webview);
                
                // 3. 显示窗口并获取焦点
                await webview.show();
                await webview.setFocus();
                notifyWebviewReady(platform.id);
                shouldRestoreWebviews = false;
                appState.setWebviewLoading(false);
            } else if (webview.isVisible() && !shouldRestoreWebviews) {
                await webview.setFocus();
                notifyWebviewReady(platform.id);
                scheduleWebviewReflow({ shouldEnsureActiveFront: true });
                appState.setWebviewLoading(false);
            } else {
                // 已存在的 webview，更新位置并显示
                const bounds = await calculateChildWebviewBounds(mainWindow);
                await webview.updateBounds(bounds);
                await webview.show();
                await webview.setFocus();
                notifyWebviewReady(platform.id);
                shouldRestoreWebviews = false;
                appState.setWebviewLoading(false);
            }
        } catch (error) {
            console.error(`显示平台 ${platform.name} 的 WebView 失败:`, error);
            appState.setError(`加载 ${platform.name} 失败`);
            appState.setWebviewLoading(false);
        }
    }

    /**
     * 隐藏除指定平台外的所有子 webview
     * 
     * @param excludePlatformId - 需要保持显示的平台ID
     */
    async function hideOtherWebviews(excludePlatformId: string) {
        const hidePromises: Promise<void>[] = [];

        for (const [id, webview] of webviewWindows.entries()) {
            if (id !== excludePlatformId) {
                hidePromises.push(
                    (async () => {
                        try {
                            await webview.hide();
                        } catch (error) {
                            console.error(`隐藏 WebView ${id} 失败:`, error);
                        }
                    })()
                );
            }
        }

        await Promise.all(hidePromises);
    }

    /**
     * 为指定平台创建新的子 webview
     * 
     * @param platform - AI平台配置
     * @returns Promise<ManagedWebview> - 创建的子 webview 代理实例
     */
    async function createWebviewForPlatform(platform: AIPlatform): Promise<ManagedWebview> {
    const bounds = await calculateChildWebviewBounds(mainWindow);
    const proxyUrl = resolveProxyUrl(configStore.config.proxy);
        const webview = new ChildWebviewProxy(`ai-chat-${platform.id}`, platform.url, proxyUrl);
        await webview.ensure(bounds);
        return webview;
    }

    // ========== WebView 定位计算 ==========
    
    /**
     * 计算子 webview 的精确边界信息
     * 
     * @returns 子 webview 的位置、尺寸和缩放信息
     */

    // ========== 子 webview 定位和布局管理 ==========
    
    /** 重排配置选项 */
    interface WebviewReflowOptions {
        /** 是否确保激活窗口显示在前台 */
        shouldEnsureActiveFront?: boolean;
        /** 是否立即执行，不进行防抖 */
        immediate?: boolean;
    }

    /** 批量定位配置选项 */
    interface BatchPositionOptions {
        /** 是否确保激活窗口显示在前台 */
        shouldEnsureActiveFront?: boolean;
    }

    /**
     * 批量调整所有子 webview 的位置和状态
     * 
     * @param options - 批量定位选项
     */
    async function positionAllWebviews({ shouldEnsureActiveFront = false }: BatchPositionOptions = {}) {
        if (webviewWindows.size === 0) {
            return;
        }

    const bounds = await calculateChildWebviewBounds(mainWindow);
        const activeWebview = activePlatformId ? webviewWindows.get(activePlatformId) : null;
        const positionTasks: Promise<void>[] = [];

        // 并行处理所有 WebView 的定位
        for (const webview of webviewWindows.values()) {
            const isCurrentlyActive = webview === activeWebview;
            
            positionTasks.push(
                (async () => {
                    // 调整位置
                    await webview.updateBounds(bounds);

                    // 如果需要确保激活窗口在前台且当前窗口是激活的
                    if (shouldEnsureActiveFront && isCurrentlyActive && isMainWindowFocused) {
                        try {
                            await webview.show();
                            await webview.setFocus();
                        } catch (error) {
                            console.error("激活 WebView 失败:", error);
                        }
                    }
                })()
            );
        }

        await Promise.all(positionTasks);
    }

    /**
     * 调度子 webview 重排操作（支持防抖）
     * 
     * @param options - 重排配置选项
     */
    function scheduleWebviewReflow({
        shouldEnsureActiveFront: requestActiveFront = false,
        immediate = false,
    }: WebviewReflowOptions = {}) {
        // 累积需要确保激活窗口在前台的标志
        shouldEnsureActiveFront ||= requestActiveFront;

        /** 执行实际的重排操作 */
        const executeReflow = () => {
            const needsActiveFront = shouldEnsureActiveFront;
            shouldEnsureActiveFront = false;

            // 异步执行，避免阻塞
            positionAllWebviews({ shouldEnsureActiveFront: needsActiveFront })
                .catch((error) => {
                    console.error("WebView 批量重排失败:", error);
                });
        };

        // 立即执行模式
        if (immediate) {
            if (isPendingReflow) {
                isPendingReflow = false; // 取消之前的防抖操作
            }
            executeReflow();
            return;
        }

        // 防抖模式：如果已有待处理的操作，直接返回
        if (isPendingReflow) {
            return;
        }

        isPendingReflow = true;

        /** 防抖执行包装器 */
        const debouncedExecute = () => {
            isPendingReflow = false;
            executeReflow();
        };

        // 优先使用 requestAnimationFrame 进行调度
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(debouncedExecute);
        } else {
            setTimeout(debouncedExecute, 16); // 约60FPS的降级方案
        }
    }

    // ========== 子 webview 生命周期管理 ==========
    
    /**
     * 隐藏所有子 webview
     */
    interface HideAllOptions {
        markForRestore?: boolean;
    }

    async function hideAllWebviews({ markForRestore = false }: HideAllOptions = {}) {
        shouldRestoreWebviews = markForRestore;
        if (!markForRestore) {
            suppressNextRestore = true;
        }

        const hideTasks = Array.from(webviewWindows.values()).map((webview) =>
            webview.hide().catch((error) => {
                console.error("隐藏 WebView 失败:", error);
            })
        );

        await Promise.all(hideTasks);
    }

    /**
     * 关闭所有子 webview 并清理资源
     */
    async function closeAllWebviews() {
        const closeTasks = Array.from(webviewWindows.values()).map((webview) =>
            webview.close().catch((error) => {
                console.error("关闭 WebView 失败:", error);
            })
        );

        await Promise.all(closeTasks);
        
        webviewWindows.clear();
        shouldRestoreWebviews = false;
    }

    // ========== 公共接口方法 ==========
    
    /**
     * 刷新当前激活平台的子 webview
     * 
     * @exposed 供父组件调用
     */
    export async function reloadCurrentPlatform() {
        if (!activePlatformId || !appState.selectedPlatform) {
            console.warn("没有激活的平台，无法刷新");
            return;
        }

        const currentWebview = webviewWindows.get(activePlatformId);
        if (!currentWebview) {
            console.warn(`未找到平台 ${activePlatformId} 的 WebView`);
            return;
        }

        try {
            await currentWebview.close();
            webviewWindows.delete(activePlatformId);
            await showPlatformWebview(appState.selectedPlatform);
        } catch (error) {
            console.error(`刷新平台失败:`, error);
            appState.setError(`刷新 ${appState.selectedPlatform.name} 失败`);
        }
    }

    // ========== 事件处理器 ==========
    
    /**
     * 处理来自 Header 组件的刷新事件
     * 只有当刷新事件的平台ID匹配当前激活平台时才执行刷新
     */
    function handleRefreshEvent(event: Event) {
        const customEvent = event as CustomEvent<{ platformId?: string }>;
        if (customEvent.detail?.platformId === activePlatformId) {
            void reloadCurrentPlatform();
        }
    }

    /** 处理隐藏所有子 webview 的事件 */
    function handleHideAllWebviewsEvent() {
        void hideAllWebviews({ markForRestore: true });
    }

    /** 无恢复隐藏（用于设置/Quick Ask 这类覆盖 UI） */
    function handleHideAllWebviewsNoRestoreEvent() {
        suppressNextRestore = true;
        void hideAllWebviews({ markForRestore: false });
    }

    function handleEnsureChatVisible(event?: Event) {
        const detail = (event as CustomEvent<{ platformId?: string }> | undefined)?.detail;
        const targetPlatformId = detail?.platformId;
        const currentPlatform = appState.selectedPlatform;

        if (!currentPlatform) {
            return;
        }

        if (targetPlatformId && targetPlatformId !== currentPlatform.id) {
            return;
        }

        void showPlatformWebview(currentPlatform);
    }

    function handleMainWindowResize(size?: { width: number; height: number }) {
        if (size && (size.width === 0 || size.height === 0)) {
            void hideAllWebviews({ markForRestore: true });
            return;
        }

        scheduleWebviewReflow({ shouldEnsureActiveFront: false, immediate: false });
    }

    function handleMainWindowMove() {
        scheduleWebviewReflow({ shouldEnsureActiveFront: false, immediate: false });
    }

    async function restoreActiveWebview(force = false) {
        if (suppressNextRestore) {
            suppressNextRestore = false;
            return;
        }

        if (!(force || shouldRestoreWebviews)) {
            return;
        }

        if (!appState.selectedPlatform) {
            shouldRestoreWebviews = false;
            return;
        }

        shouldRestoreWebviews = false;

        try {
            const platform = appState.selectedPlatform;
            const existing = webviewWindows.get(platform.id);

            if (existing) {
                const bounds = await calculateChildWebviewBounds(mainWindow);
                await existing.updateBounds(bounds);
                await existing.show();
                await existing.setFocus();
                notifyWebviewReady(platform.id);
            } else {
                await showPlatformWebview(platform);
            }

            scheduleWebviewReflow({ shouldEnsureActiveFront: true });
        } catch (error) {
            console.error("恢复 WebView 失败:", error);
        }
    }

    function notifyWebviewReady(platformId: string) {
        if (typeof window === "undefined") {
            return;
        }

        window.dispatchEvent(
            new CustomEvent("chatWebviewReady", {
                detail: { platformId },
            })
        );
    }

    // ========== 组件生命周期 ==========
    
    /**
     * 清理单个事件监听器的工具函数
     */
    function cleanupEventListener(
        key: keyof typeof windowEventUnlisteners,
        unlisten: (() => void) | null
    ) {
        if (unlisten) {
            unlisten();
            windowEventUnlisteners[key] = null;
        }
    }

    /**
     * 清理所有 Tauri 窗口事件监听器
     */
    function cleanupAllWindowEvents() {
        Object.entries(windowEventUnlisteners).forEach(([key, unlisten]) => {
            cleanupEventListener(key as keyof typeof windowEventUnlisteners, unlisten);
        });
    }

    onMount(() => {
        // ========== DOM 事件监听器 ==========
        
        const domEventHandlers = [
            { event: "refreshWebview", handler: handleRefreshEvent as EventListener },
            { event: "hideAllWebviews", handler: handleHideAllWebviewsEvent },
            { event: "hideAllWebviewsNoRestore", handler: handleHideAllWebviewsNoRestoreEvent },
            { event: "ensureChatVisible", handler: handleEnsureChatVisible as EventListener },
            { event: "resize", handler: () => handleMainWindowResize() },
        ];

        // 注册 DOM 事件监听器
        domEventHandlers.forEach(({ event, handler }) => {
            window.addEventListener(event, handler);
        });

        // ========== Tauri 窗口事件监听器 ==========
        
        let isComponentDisposed = false;

        (async () => {
            try {
                // 初始化窗口焦点状态
                try {
                    isMainWindowFocused = await mainWindow.isFocused();
                } catch (error) {
                    console.error("获取窗口焦点状态失败:", error);
                }

                // 注册窗口尺寸变化监听
                windowEventUnlisteners.resize = await mainWindow.onResized(({ payload }) => {
                    handleMainWindowResize(payload ?? undefined);
                });

                // 注册窗口移动监听
                windowEventUnlisteners.move = await mainWindow.onMoved(() => {
                    handleMainWindowMove();
                });

                // 注册缩放变化监听
                windowEventUnlisteners.scale = await mainWindow.onScaleChanged(() => {
                    handleMainWindowResize();
                });

                // 注册窗口获得焦点监听
                windowEventUnlisteners.focus = await mainWindow.listen("tauri://focus", () => {
                    isMainWindowFocused = true;
                });

                // 注册窗口失去焦点监听
                windowEventUnlisteners.blur = await mainWindow.listen("tauri://blur", () => {
                    isMainWindowFocused = false;
                });

                // 注册窗口关闭请求监听
                windowEventUnlisteners.close = await mainWindow.onCloseRequested(async () => {
                    await closeAllWebviews();
                });

                // 注册来自 Rust 端的隐藏子 webview 事件（托盘/快捷键触发，标记恢复）
                windowEventUnlisteners.hideWebviews = await mainWindow.listen("hideAllWebviews", () => {
                    void hideAllWebviews({ markForRestore: true });
                });

                // 注册不标记恢复的隐藏事件（设置/Quick Ask 覆盖 UI）
                windowEventUnlisteners.hideWebviewsNoRestore = await mainWindow.listen(
                    "hideAllWebviewsNoRestore",
                    () => {
                        suppressNextRestore = true;
                        void hideAllWebviews({ markForRestore: false });
                    }
                );

                // 注册窗口事件监听（最小化、隐藏等）
                windowEventUnlisteners.windowEvent = await mainWindow.listen(
                    "tauri://window-event",
                    (event) => {
                        const payload = event.payload as { event: string } | undefined;
                        if (payload?.event === "minimized" || payload?.event === "hidden") {
                            void hideAllWebviews({ markForRestore: true });
                        }

                        if (payload?.event === "restored" || payload?.event === "shown") {
                            void restoreActiveWebview(true);
                        }
                    }
                );

                windowEventUnlisteners.restoreWebviews = await mainWindow.listen(
                    "restoreWebviews",
                    () => {
                        void restoreActiveWebview(true);
                    }
                );

                // 检查组件是否已经被销毁
                if (isComponentDisposed) {
                    cleanupAllWindowEvents();
                    return;
                }
            } catch (error) {
                console.error("注册 Tauri 窗口事件失败:", error);
            }
        })();

        // 初始化 WebView 布局
        scheduleWebviewReflow({ shouldEnsureActiveFront: true });

        // ========== 清理函数 ==========
        
        return () => {
            isComponentDisposed = true;

            // 清理 DOM 事件监听器
            domEventHandlers.forEach(({ event, handler }) => {
                window.removeEventListener(event, handler);
            });

            // 清理 Tauri 窗口事件监听器
            cleanupAllWindowEvents();
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
