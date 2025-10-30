<script lang="ts">
    /**
     * AI对话组件 - WebviewWindow 管理器
     * 
     * 核心功能:
     * 1. 管理多个 AI 平台的 WebviewWindow 实例
     * 2. 处理窗口的创建、定位、显示/隐藏
     * 3. 同步主窗口和子窗口的状态（位置、尺寸、置顶等）
     * 4. 响应窗口事件和用户交互
     */
    import { onMount, onDestroy } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import type { AIPlatform } from "$lib/types/platform";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

    // ========== 核心状态变量 ==========
    
    /** 主窗口实例 */
    const mainWindow = getCurrentWebviewWindow();
    
    /** WebView 窗口映射表: platformId -> WebviewWindow */
    let webviewWindows = $state<Map<string, WebviewWindow>>(new Map());
    
    /** 当前激活的平台ID */
    let activePlatformId = $state<string | null>(null);
    
    /** 主窗口是否获得焦点 */
    let isMainWindowFocused = $state(true);
    
    // ========== 重新布局相关状态 ==========
    
    /** 是否有待处理的重新布局请求 */
    let isPendingReflow = false;
    
    /** 是否需要确保激活窗口在前台 */
    let shouldEnsureActiveFront = false;
    
    // ========== 事件监听器清理函数 ==========
    
    /** 布局观察器清理函数 */
    let layoutObserverCleanup: (() => void) | null = null;
    
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
    };

    // ========== 响应式状态监听 ==========
    
    /** 监听选中平台变化，自动切换显示对应的WebView */
    $effect(() => {
        if (appState.selectedPlatform) {
            activePlatformId = appState.selectedPlatform.id;
            showPlatformWebview(appState.selectedPlatform);
        } else {
            activePlatformId = null;
            hideAllWebviews();
        }
    });

    // ========== WebView 管理核心方法 ==========
    
    /**
     * 显示指定平台的 WebView 窗口
     * 
     * 工作流程:
     * 1. 隐藏其他平台的 WebView
     * 2. 获取或创建目标平台的 WebView  
     * 3. 调整窗口位置和尺寸
     * 4. 显示窗口并获取焦点
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
            }

            // 3. 调整窗口位置和置顶状态
            await positionWebview(webview, { shouldKeepTop: true });
            scheduleWebviewReflow({ shouldEnsureActiveFront: true, immediate: true });

            // 4. 显示窗口并获取焦点
            await webview.show();
            await webview.setFocus();

            scheduleWebviewReflow({ shouldEnsureActiveFront: true });
            appState.setWebviewLoading(false);
        } catch (error) {
            console.error(`显示平台 ${platform.name} 的 WebView 失败:`, error);
            appState.setError(`加载 ${platform.name} 失败`);
            appState.setWebviewLoading(false);
        }
    }

    /**
     * 隐藏除指定平台外的所有 WebView
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
                            await webview.setAlwaysOnTop(false);
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
     * 为指定平台创建新的 WebView 窗口
     * 
     * WebView 配置特点:
     * - 无边框设计，与主窗口融合
     * - 不在任务栏显示，避免干扰
     * - 默认置顶，跟随主窗口
     * - 不可调整大小，由程序控制
     * 
     * @param platform - AI平台配置
     * @returns Promise<WebviewWindow> - 创建的WebView实例
     */
    async function createWebviewForPlatform(platform: AIPlatform): Promise<WebviewWindow> {
        const webview = new WebviewWindow(`ai-chat-${platform.id}`, {
            url: platform.url,
            title: platform.name,
            visible: false,          // 创建时隐藏，待定位完成后显示
            decorations: false,      // 无边框，与主窗口融合
            skipTaskbar: true,       // 不在任务栏显示
            transparent: false,      // 不透明背景
            alwaysOnTop: true,       // 默认置顶
            shadow: false,           // 无阴影效果
            resizable: false,        // 不可调整大小
        });

        // 等待窗口创建完成，使用Promise包装事件监听
        await new Promise<void>((resolve) => {
            webview.once("tauri://created", () => {
                console.log(`WebView 创建成功: ${platform.name}`);
                resolve();
            });
            webview.once("tauri://error", (error) => {
                console.error(`WebView 创建失败: ${platform.name}`, error);
                resolve(); // 即使失败也继续，避免阻塞
            });
        });

        // 清除浏览数据，确保干净的环境
        try {
            await webview.clearAllBrowsingData();
            console.log(`WebView 浏览数据已清除: ${platform.name}`);
        } catch (error) {
            console.error(`清除 WebView 浏览数据失败: ${platform.name}`, error);
        }

        // 监听页面加载完成事件
        webview.once("tauri://loaded", () => {
            console.log(`WebView 页面加载完成: ${platform.name}`);
        });

        return webview;
    }

    // ========== WebView 定位计算 ==========
    
    /**
     * 计算 WebView 窗口的精确边界信息
     * 
     * 计算逻辑:
     * 1. 获取主窗口的位置、尺寸和缩放比例
     * 2. 定位主内容区域（排除侧边栏和头部）
     * 3. 转换为物理坐标供 WebView 使用
     * 4. 处理各种边缘情况和降级方案
     * 
     * @returns WebView 窗口的位置、尺寸和缩放信息
     */
    async function calculateWebviewBounds(): Promise<{
        positionLogical: { x: number; y: number };
        sizeLogical: { width: number; height: number };
        scaleFactor: number;
    }> {
        try {
            // 获取缩放比例和窗口基础信息
            const scaleFactor = await mainWindow.scaleFactor();
            const [outerPosition, outerSize, innerSize] = await Promise.all([
                mainWindow.outerPosition(),
                mainWindow.outerSize(),
                mainWindow.innerSize(),
            ]);

            // 尝试获取精确的内容区域位置
            let innerPosition: Awaited<ReturnType<typeof mainWindow.innerPosition>> | null = null;
            try {
                innerPosition = await mainWindow.innerPosition();
            } catch (error) {
                console.warn("无法获取精确内容位置，使用外框位置计算:", error);
            }

            // 获取布局元素尺寸
            const layoutElements = {
                sidebar: document.querySelector(".sidebar") as HTMLElement | null,
                header: document.querySelector(".header") as HTMLElement | null,
                mainContent: document.querySelector(".main-content") as HTMLElement | null,
            };

            // 计算布局偏移量（逻辑像素）
            const sidebarWidth = layoutElements.sidebar?.offsetWidth ?? 56;  // 默认侧边栏宽度
            const headerHeight = layoutElements.header?.offsetHeight ?? 44;  // 默认头部高度

            // 获取主内容区域的精确边界
            const mainContentRect = layoutElements.mainContent?.getBoundingClientRect();
            
            const contentOffsetLeft = mainContentRect?.left ?? sidebarWidth;
            const contentOffsetTop = mainContentRect?.top ?? headerHeight;
            const contentWidth = mainContentRect?.width ?? 
                Math.max(0, innerSize.width / scaleFactor - contentOffsetLeft);
            const contentHeight = mainContentRect?.height ?? 
                Math.max(0, innerSize.height / scaleFactor - contentOffsetTop);

            // 计算 WebView 基础位置
            let baseX = innerPosition?.x ?? 0;
            let baseY = innerPosition?.y ?? 0;

            // 降级方案：通过外框位置推算内容位置
            if (!innerPosition) {
                const borderWidth = Math.max(0, Math.round((outerSize.width - innerSize.width) / 2));
                const verticalDiff = Math.max(0, outerSize.height - innerSize.height);
                const titleBarHeight = Math.max(0, verticalDiff - borderWidth);

                baseX = outerPosition.x + borderWidth;
                baseY = outerPosition.y + titleBarHeight;
            }

            // 转换为逻辑坐标
            const baseLogicalX = baseX / scaleFactor;
            const baseLogicalY = baseY / scaleFactor;

            // 计算最终的 WebView 位置和尺寸
            const webviewBounds = {
                positionLogical: {
                    x: baseLogicalX + contentOffsetLeft,
                    y: baseLogicalY + contentOffsetTop,
                },
                sizeLogical: {
                    width: contentWidth,
                    height: contentHeight,
                },
                scaleFactor,
            };

            console.log("WebView 边界计算完成:", {
                scaleFactor,
                baseLogical: { x: baseLogicalX, y: baseLogicalY },
                contentOffset: { left: contentOffsetLeft, top: contentOffsetTop },
                finalBounds: webviewBounds,
            });

            return webviewBounds;
        } catch (error) {
            console.error("WebView 边界计算失败，使用默认值:", error);
            return {
                positionLogical: { x: 100, y: 100 },
                sizeLogical: { width: 800, height: 600 },
                scaleFactor: 1,
            };
        }
    }

    // ========== WebView 定位和布局管理 ==========
    
    /** WebView 定位配置选项 */
    interface WebviewPositionOptions {
        /** 是否保持置顶状态 */
        shouldKeepTop?: boolean;
    }

    /** WebView 重排配置选项 */
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
     * 调整单个 WebView 的位置和尺寸
     * 
     * @param webview - 要调整的 WebView 实例
     * @param options - 定位选项
     */
    async function positionWebview(
        webview: WebviewWindow,
        { shouldKeepTop }: WebviewPositionOptions = {},
    ) {
        try {
            // 获取计算好的边界信息
            const { positionLogical, sizeLogical, scaleFactor } = await calculateWebviewBounds();

            // 转换为 Tauri 可用的位置和尺寸对象
            const logicalPosition = new LogicalPosition(positionLogical.x, positionLogical.y);
            const logicalSize = new LogicalSize(sizeLogical.width, sizeLogical.height);

            // 转换为物理坐标（考虑DPI缩放）
            const physicalPosition = logicalPosition.toPhysical(scaleFactor);
            const physicalSize = logicalSize.toPhysical(scaleFactor);

            // 应用位置和尺寸
            await Promise.all([
                webview.setPosition(physicalPosition),
                webview.setSize(physicalSize)
            ]);

            // 管理置顶状态
            const activeWebview = activePlatformId ? webviewWindows.get(activePlatformId) : null;
            const isCurrentlyActive = activeWebview === webview;
            const shouldMaintainTop = shouldKeepTop ?? isCurrentlyActive;
            const shouldSetTop = shouldMaintainTop && isMainWindowFocused;

            try {
                await webview.setAlwaysOnTop(shouldSetTop);
            } catch (error) {
                console.error("更新 WebView 置顶状态失败:", error);
            }

            console.log("WebView 位置调整完成:", {
                position: positionLogical,
                size: sizeLogical,
                physical: { position: physicalPosition, size: physicalSize },
                alwaysOnTop: shouldSetTop,
            });
        } catch (error) {
            console.error("调整 WebView 位置失败:", error);
        }
    }

    /**
     * 批量调整所有 WebView 的位置和状态
     * 
     * @param options - 批量定位选项
     */
    async function positionAllWebviews({ shouldEnsureActiveFront = false }: BatchPositionOptions = {}) {
        if (webviewWindows.size === 0) {
            return;
        }

        const activeWebview = activePlatformId ? webviewWindows.get(activePlatformId) : null;
        const positionTasks: Promise<void>[] = [];

        // 并行处理所有 WebView 的定位
        for (const webview of webviewWindows.values()) {
            const isCurrentlyActive = webview === activeWebview;
            
            positionTasks.push(
                (async () => {
                    // 调整位置和置顶状态
                    await positionWebview(webview, { shouldKeepTop: isCurrentlyActive });

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
     * 批量更新所有 WebView 的置顶状态
     * 
     * @param shouldActiveBeOnTop - 激活的 WebView 是否应该置顶
     */
    async function updateAllWebviewsTopState(shouldActiveBeOnTop: boolean) {
        if (webviewWindows.size === 0) {
            return;
        }

        const activeWebview = activePlatformId ? webviewWindows.get(activePlatformId) : null;
        const updateTasks: Promise<void>[] = [];

        for (const webview of webviewWindows.values()) {
            const shouldBeOnTop = shouldActiveBeOnTop && 
                                  isMainWindowFocused && 
                                  webview === activeWebview;
            
            updateTasks.push(
                (async () => {
                    try {
                        await webview.setAlwaysOnTop(shouldBeOnTop);
                    } catch (error) {
                        console.error("更新 WebView 置顶状态失败:", error);
                    }
                })()
            );
        }

        await Promise.all(updateTasks);
    }

    /**
     * 调度 WebView 重排操作（支持防抖）
     * 
     * 防抖机制可以避免频繁的窗口调整操作，提升性能。
     * 在窗口大小变化、移动等高频事件中特别有用。
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

    // ========== WebView 生命周期管理 ==========
    
    /**
     * 隐藏所有 WebView 窗口
     * 
     * 通常在以下情况调用：
     * - 主窗口失去焦点时
     * - 应用最小化到托盘时
     * - 切换到非聊天界面时
     */
    async function hideAllWebviews() {
        console.log(`开始隐藏所有 WebView，共 ${webviewWindows.size} 个`);
        
        const hideTasks: Promise<void>[] = [];

        for (const [platformId, webview] of webviewWindows.entries()) {
            hideTasks.push(
                (async () => {
                    try {
                        console.log(`隐藏 WebView: ${platformId}`);
                        await webview.hide();
                        await webview.setAlwaysOnTop(false);
                        console.log(`WebView ${platformId} 隐藏成功`);
                    } catch (error) {
                        console.error(`隐藏 WebView ${platformId} 失败:`, error);
                    }
                })()
            );
        }

        await Promise.all(hideTasks);
        console.log("所有 WebView 隐藏完成");
    }

    /**
     * 关闭所有 WebView 窗口并清理资源
     * 
     * 在应用退出时调用，确保所有子窗口正确关闭
     */
    async function closeAllWebviews() {
        console.log(`开始关闭所有 WebView，共 ${webviewWindows.size} 个`);
        
        const closeTasks: Promise<void>[] = [];

        for (const [platformId, webview] of webviewWindows.entries()) {
            closeTasks.push(
                (async () => {
                    try {
                        await webview.close();
                        console.log(`WebView ${platformId} 关闭成功`);
                    } catch (error) {
                        console.error(`关闭 WebView ${platformId} 失败:`, error);
                    }
                })()
            );
        }

        await Promise.all(closeTasks);
        
        // 清理映射表
        webviewWindows.clear();
        console.log("所有 WebView 关闭完成");
    }

    // ========== 公共接口方法 ==========
    
    /**
     * 刷新当前激活平台的 WebView
     * 
     * 通过关闭现有 WebView 并重新创建来实现完全刷新，
     * 可以解决页面卡住、登录失效等问题。
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
            console.log(`开始刷新平台: ${appState.selectedPlatform.name}`);
            
            // 关闭旧的 WebView
            await currentWebview.close();
            webviewWindows.delete(activePlatformId);

            // 重新创建并显示
            await showPlatformWebview(appState.selectedPlatform);
            
            console.log(`平台 ${appState.selectedPlatform.name} 刷新完成`);
        } catch (error) {
            console.error(`刷新平台 ${appState.selectedPlatform.name} 失败:`, error);
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

    /** 处理隐藏所有 WebView 的事件 */
    function handleHideAllWebviewsEvent() {
        void hideAllWebviews();
    }

    /** 处理暂停 WebView 置顶状态的事件 */
    function handleSuspendWebviewTopEvent() {
        void updateAllWebviewsTopState(false);
    }

    /** 处理恢复 WebView 置顶状态的事件 */
    function handleResumeWebviewTopEvent() {
        void updateAllWebviewsTopState(true);
        scheduleWebviewReflow({ shouldEnsureActiveFront: true, immediate: true });
    }

    /**
     * 处理主窗口尺寸变化事件
     * 
     * @param size - 新的窗口尺寸（可选）
     */
    function handleMainWindowResize(size?: { width: number; height: number }) {
        // 当窗口尺寸为0时（通常是最小化），隐藏所有WebView
        if (size && (size.width === 0 || size.height === 0)) {
            void hideAllWebviews();
            return;
        }

        // 正常尺寸变化时，立即重新布局所有WebView
        scheduleWebviewReflow({ shouldEnsureActiveFront: true, immediate: true });
    }

    /**
     * 处理主窗口位置移动事件
     */
    function handleMainWindowMove() {
        // 窗口移动时，立即调整所有WebView位置
        scheduleWebviewReflow({ shouldEnsureActiveFront: true, immediate: true });
    }

    /**
     * 设置布局观察器，监听关键布局元素的尺寸变化
     * 
     * 监听的元素包括：
     * - .main-content: 主内容区域
     * - .sidebar: 侧边栏
     * - .header: 顶部导航栏
     * 
     * @returns 清理函数，用于取消观察
     */
    function setupLayoutObservers(): (() => void) | null {
        // 检查浏览器支持
        if (typeof ResizeObserver === "undefined") {
            console.warn("浏览器不支持 ResizeObserver，布局监听已禁用");
            return null;
        }

        // 获取需要监听的布局元素
        const layoutElements = Array.from(
            document.querySelectorAll<HTMLElement>(".main-content, .sidebar, .header")
        );

        if (layoutElements.length === 0) {
            console.warn("未找到布局元素，跳过布局监听设置");
            return null;
        }

        // 创建观察器
        const resizeObserver = new ResizeObserver((entries) => {
            // 防抖处理布局变化
            scheduleWebviewReflow();
        });

        // 开始观察所有布局元素
        layoutElements.forEach((element) => {
            resizeObserver.observe(element);
        });

        console.log(`布局观察器已设置，监听 ${layoutElements.length} 个元素`);

        // 返回清理函数
        return () => {
            resizeObserver.disconnect();
            console.log("布局观察器已断开");
        };
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
        console.log("AIChat 组件挂载，开始设置事件监听器");

        // ========== DOM 事件监听器 ==========
        
        const domEventHandlers = [
            { event: "refreshWebview", handler: handleRefreshEvent as EventListener },
            { event: "hideAllWebviews", handler: handleHideAllWebviewsEvent },
            { event: "suspendWebviewTop", handler: handleSuspendWebviewTopEvent },
            { event: "resumeWebviewTop", handler: handleResumeWebviewTopEvent },
            { event: "resize", handler: () => handleMainWindowResize() },
        ];

        // 注册 DOM 事件监听器
        domEventHandlers.forEach(({ event, handler }) => {
            window.addEventListener(event, handler);
        });

        // 设置布局观察器
        layoutObserverCleanup?.();
        layoutObserverCleanup = setupLayoutObservers();

        // ========== Tauri 窗口事件监听器 ==========
        
        let isComponentDisposed = false;

        (async () => {
            try {
                // 初始化窗口焦点状态
                try {
                    isMainWindowFocused = await mainWindow.isFocused();
                    void updateAllWebviewsTopState(isMainWindowFocused);
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
                    void updateAllWebviewsTopState(true);
                    scheduleWebviewReflow({ shouldEnsureActiveFront: true, immediate: true });
                });

                // 注册窗口失去焦点监听
                windowEventUnlisteners.blur = await mainWindow.listen("tauri://blur", () => {
                    isMainWindowFocused = false;
                    void updateAllWebviewsTopState(false);
                });

                // 注册窗口关闭请求监听
                windowEventUnlisteners.close = await mainWindow.onCloseRequested(async () => {
                    await closeAllWebviews();
                });

                // 注册来自 Rust 端的隐藏 WebView 事件（托盘/快捷键触发）
                windowEventUnlisteners.hideWebviews = await mainWindow.listen("hideAllWebviews", () => {
                    console.log("收到 Rust 端的 hideAllWebviews 事件");
                    void hideAllWebviews();
                });

                // 注册窗口事件监听（最小化、隐藏等）
                windowEventUnlisteners.windowEvent = await mainWindow.listen(
                    "tauri://window-event",
                    (event) => {
                        const payload = event.payload as { event: string } | undefined;
                        if (payload?.event === "minimized" || payload?.event === "hidden") {
                            void hideAllWebviews();
                        }
                    }
                );

                // 检查组件是否已经被销毁
                if (isComponentDisposed) {
                    cleanupAllWindowEvents();
                    return;
                }

                console.log("Tauri 窗口事件监听器注册完成");
            } catch (error) {
                console.error("注册 Tauri 窗口事件失败:", error);
            }
        })();

        // 初始化 WebView 布局
        scheduleWebviewReflow({ shouldEnsureActiveFront: true });

        // ========== 清理函数 ==========
        
        return () => {
            console.log("AIChat 组件卸载，开始清理资源");
            isComponentDisposed = true;

            // 清理 DOM 事件监听器
            domEventHandlers.forEach(({ event, handler }) => {
                window.removeEventListener(event, handler);
            });

            // 清理布局观察器
            layoutObserverCleanup?.();
            layoutObserverCleanup = null;

            // 清理 Tauri 窗口事件监听器
            cleanupAllWindowEvents();

            console.log("AIChat 组件资源清理完成");
        };
    });

    onDestroy(async () => {
        console.log("AIChat 组件销毁，关闭所有 WebView");
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
