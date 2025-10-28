<script lang="ts">
    /**
     * AI对话组件 - 使用iframe嵌入AI平台网页
     * 支持多个webview同时存在，切换时保持在后台
     * 使用LRU缓存策略限制iframe数量
     */
    import { onMount, onDestroy } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { open } from "@tauri-apps/plugin-shell";
    import type { AIPlatform } from "$lib/types/platform";

    // iframe信息接口
    interface IframeInfo {
        element: HTMLIFrameElement;
        isLoading: boolean;
        hasError: boolean;
        lastAccessTime: number;
    }

    // LRU缓存配置
    const MAX_IFRAME_CACHE = 5; // 最多缓存5个iframe

    // 存储所有已加载的iframe元素（按访问时间排序）
    const loadedIframes = new Map<string, IframeInfo>();
    const pendingAttachments = new Set<string>();

    let currentPlatformId = $state<string | null>(null);
    let containerElement = $state<HTMLElement | null>(null);

    // 监听平台变化
    $effect(() => {
        if (appState.selectedPlatform) {
            currentPlatformId = appState.selectedPlatform.id;

            // 更新访问时间（LRU）
            touchIframe(appState.selectedPlatform.id);

            // 如果该平台的iframe还未创建，创建它
            if (!loadedIframes.has(appState.selectedPlatform.id)) {
                createIframe(appState.selectedPlatform);
            } else {
                attachIframe(appState.selectedPlatform.id);
            }

            updateIframeVisibility();
        } else {
            currentPlatformId = null;
            updateIframeVisibility();
        }
    });

    $effect(() => {
        if (!containerElement) return;
        pendingAttachments.forEach((platformId) => {
            attachIframe(platformId);
        });
    });

    /**
     * LRU缓存清理：移除最久未使用的iframe
     */
    function evictLRUIframe() {
        if (loadedIframes.size <= MAX_IFRAME_CACHE) {
            return;
        }

        // 找到最久未访问的iframe（不包括当前显示的）
        let oldestId: string | null = null;
        let oldestTime = Date.now();

        for (const [id, info] of loadedIframes.entries()) {
            if (id !== currentPlatformId && info.lastAccessTime < oldestTime) {
                oldestTime = info.lastAccessTime;
                oldestId = id;
            }
        }

        // 移除最旧的iframe
        if (oldestId) {
            const iframeInfo = loadedIframes.get(oldestId);
            if (iframeInfo) {
                iframeInfo.element.remove();
                loadedIframes.delete(oldestId);
                console.log(`[LRU] Evicted iframe: ${oldestId}`);
            }
        }
    }

    /**
     * 更新iframe的访问时间（LRU）
     */
    function touchIframe(platformId: string) {
        const iframeInfo = loadedIframes.get(platformId);
        if (iframeInfo) {
            iframeInfo.lastAccessTime = Date.now();
        }
    }

    /**
     * 创建新的iframe
     */
    function createIframe(platform: AIPlatform) {
        // 创建前先检查并清理缓存
        evictLRUIframe();

        const iframe = document.createElement("iframe");
        iframe.src = platform.url;
        iframe.title = platform.name;
        iframe.className = "webview-iframe";
        iframe.allow = "clipboard-read; clipboard-write; microphone; camera";
        // 不设置 sandbox，避免站点在被 sandbox 时拒绝渲染或受限

        // 禁用右键上下文菜单
        iframe.oncontextmenu = (e) => {
            e.preventDefault();
            return false;
        };

        const iframeInfo: IframeInfo = {
            element: iframe,
            isLoading: true,
            hasError: false,
            lastAccessTime: Date.now(),
        };

        // 设置加载超时以检测被 X-Frame-Options 或 frame-ancestors 拒绝的情况
        const loadTimeout = window.setTimeout(() => {
            if (iframeInfo.isLoading) {
                iframeInfo.isLoading = false;
                iframeInfo.hasError = true;
                appState.setWebviewLoading(false);
                appState.setError(`无法在应用内显示 ${platform.name}，可能被站点拒绝嵌入。`);
            }
        }, 8000);

        iframe.onload = () => {
            iframeInfo.isLoading = false;
            iframeInfo.hasError = false;
            appState.setWebviewLoading(false);
            window.clearTimeout(loadTimeout);

            // 在iframe内禁用右键菜单
            try {
                const iframeDoc =
                    iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                    iframeDoc.addEventListener("contextmenu", (e) => {
                        e.preventDefault();
                        return false;
                    });
                }
            } catch (error) {
                // 跨域限制，无法访问iframe内容
                console.log("Cannot access iframe content due to CORS");
            }
        };

        iframe.onerror = () => {
            iframeInfo.isLoading = false;
            iframeInfo.hasError = true;
            appState.setWebviewLoading(false);
            appState.setError(
                `加载 ${platform.name} 失败，请检查网络连接或代理设置`,
            );
            window.clearTimeout(loadTimeout);
        };

        loadedIframes.set(platform.id, iframeInfo);

        attachIframe(platform.id);

        appState.setWebviewLoading(true);
    }

    function attachIframe(platformId: string) {
        const iframeInfo = loadedIframes.get(platformId);
        if (!iframeInfo) return;

        if (!containerElement) {
            pendingAttachments.add(platformId);
            return;
        }

        pendingAttachments.delete(platformId);

        if (iframeInfo.element.parentElement !== containerElement) {
            containerElement.appendChild(iframeInfo.element);
        }

        updateIframeVisibility();
    }

    /**
     * 更新iframe显示状态
     */
    function updateIframeVisibility() {
        loadedIframes.forEach((info, platformId) => {
            if (platformId === currentPlatformId) {
                info.element.style.display = "block";
                info.element.style.zIndex = "1";
            } else {
                info.element.style.display = "none";
                info.element.style.zIndex = "0";
            }
        });
    }

    /**
     * 重新加载当前平台
     */
    function reload() {
        if (!appState.selectedPlatform) return;

        const iframeInfo = loadedIframes.get(appState.selectedPlatform.id);
        if (iframeInfo) {
            iframeInfo.isLoading = true;
            iframeInfo.hasError = false;
            iframeInfo.element.src = iframeInfo.element.src;
            appState.setWebviewLoading(true);
        }
    }

    /**
     * 在外部浏览器中打开当前平台
     */
    async function openInBrowser() {
        if (appState.selectedPlatform) {
            try {
                await open(appState.selectedPlatform.url);
            } catch (error) {
                console.error("Failed to open in browser:", error);
            }
        }
    }

    /**
     * 处理来自Header的刷新事件
     */
    function handleRefreshEvent(event: Event) {
        const customEvent = event as CustomEvent;
        if (customEvent.detail?.platformId === currentPlatformId) {
            reload();
        }
    }

    /**
     * 获取当前iframe信息
     */
    function getCurrentIframeInfo() {
        if (!currentPlatformId) return null;
        return loadedIframes.get(currentPlatformId);
    }

    // 更新iframe可见性
    $effect(() => {
        updateIframeVisibility();
    });

    /**
     * 处理清理缓存事件
     */
    function handleClearCacheEvent() {
        clearIframeCache();
    }

    onMount(() => {
        appState.setWebviewLoading(true);

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

        // 清理函数
        return () => {
            window.removeEventListener(
                "refreshWebview",
                handleRefreshEvent as EventListener,
            );
            window.removeEventListener(
                "clearIframeCache",
                handleClearCacheEvent as EventListener,
            );
        };
    });

    onDestroy(() => {
        // 清理事件监听器
        window.removeEventListener(
            "refreshWebview",
            handleRefreshEvent as EventListener,
        );
        window.removeEventListener(
            "clearIframeCache",
            handleClearCacheEvent as EventListener,
        );

        // 清理所有iframe
        loadedIframes.forEach((info) => {
            info.element.remove();
        });
        loadedIframes.clear();
        pendingAttachments.clear();
    });

    /**
     * 导出清理函数供外部调用
     */
    export function clearIframeCache() {
        loadedIframes.forEach((info, id) => {
            if (id !== currentPlatformId) {
                info.element.remove();
                loadedIframes.delete(id);
            }
        });
        console.log("[Cache] Cleared all inactive iframes");
        pendingAttachments.clear();
    }

    /**
     * 获取缓存统计信息
     */
    export function getCacheStats() {
        return {
            total: loadedIframes.size,
            max: MAX_IFRAME_CACHE,
            current: currentPlatformId,
            cached: Array.from(loadedIframes.keys()),
        };
    }
</script>

<div class="chat-container">
    {#if appState.selectedPlatform}
        {@const currentInfo = getCurrentIframeInfo()}

        <!-- 加载状态 -->
        {#if currentInfo && currentInfo.isLoading}
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

        <!-- 错误状态 -->
        {#if currentInfo && currentInfo.hasError}
            <div class="error-overlay">
                <div class="error-content">
                    <svg
                        class="error-icon"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                    <h3 class="error-title">加载失败</h3>
                    <p class="error-message">
                        无法加载 {appState.selectedPlatform
                            .name}，请检查网络连接或代理设置
                    </p>
                    <div class="error-actions">
                        <button class="reload-btn" onclick={reload}>
                            重新加载
                        </button>
                        <button class="open-btn" onclick={openInBrowser}>
                            在浏览器中打开
                        </button>
                    </div>
                </div>
            </div>
        {/if}

        <!-- WebView iframe 容器 - 所有iframe都在这里，通过CSS控制显示 -->
        <div
            bind:this={containerElement}
            class="webview-container"
            role="region"
            aria-label="AI 平台内容"
            oncontextmenu={(e) => {
                e.preventDefault();
                return false;
            }}
        >
            <!-- iframe由JavaScript直接添加到这里 -->
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
    }

    :global(.webview-iframe) {
        width: 100%;
        height: 100%;
        border: none;
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        background-color: var(--bg-primary);
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

    .error-overlay {
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

    .error-content {
        text-align: center;
        max-width: 400px;
        padding: 2rem;
    }

    .error-icon {
        width: 64px;
        height: 64px;
        color: var(--error-color);
        margin: 0 auto 1rem;
    }

    .error-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
    }

    .error-message {
        font-size: 1rem;
        color: var(--text-secondary);
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
    }

    .reload-btn {
        padding: 0.75rem 1.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: white;
        background-color: var(--accent-color);
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .reload-btn:hover {
        background-color: var(--accent-hover);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
    }

    .reload-btn:active {
        transform: translateY(0);
    }

    .error-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
    }

    .open-btn {
        padding: 0.75rem 1.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .open-btn:hover {
        background-color: var(--bg-tertiary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
    }

    .open-btn:active {
        transform: translateY(0);
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
