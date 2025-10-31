<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { i18n } from "$lib/i18n";
    import type { TranslationPlatform } from "$lib/types/platform";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import {
        calculateChildWebviewBounds,
        ChildWebviewProxy,
    } from "$lib/utils/childWebview";
    import { createProxySignature, resolveProxyUrl } from "$lib/utils/proxy";

    const t = i18n.t;

    function translate(key: string, params?: Record<string, string>) {
        let value = t(key);
        if (params) {
            for (const [paramKey, paramValue] of Object.entries(params)) {
                value = value.replace(`{${paramKey}}`, paramValue);
            }
        }
        return value;
    }

    const mainWindow = getCurrentWebviewWindow();

    let webviewWindows = $state<Map<string, ChildWebviewProxy>>(new Map());
    let activeTranslatorId = $state<string | null>(null);
    let isMainWindowFocused = $state(true);
    let proxySignature = $state(createProxySignature(configStore.config.proxy));

    let isPendingReflow = false;
    let shouldEnsureActiveFront = false;
    let shouldRestoreWebviews = false;
    let isShowingWebview = false;

    let isLoading = $state(false);
    let loadError = $state<string | null>(null);

    const windowEventUnlisteners = {
        resize: null as (() => void) | null,
        move: null as (() => void) | null,
        scale: null as (() => void) | null,
        focus: null as (() => void) | null,
        blur: null as (() => void) | null,
        close: null as (() => void) | null,
        windowEvent: null as (() => void) | null,
        hideWebviews: null as (() => void) | null,
        restoreWebviews: null as (() => void) | null,
    };

    const domEventHandlers = [
        { event: "hideAllWebviews", handler: handleHideAllWebviewsEvent },
        { event: "resize", handler: () => handleMainWindowResize() },
        { event: "ensureTranslationVisible", handler: handleEnsureTranslationVisible },
    ];

    $effect(() => {
        const signature = createProxySignature(configStore.config.proxy);
        if (signature !== proxySignature) {
            proxySignature = signature;
            void handleProxyConfigChange();
        }
    });

    $effect(() => {
        const translator = translationStore.currentPlatform;
        const currentView = appState.currentView;

        if (!translator || !translator.enabled) {
            const fallback = translationStore.enabledPlatforms[0];
            if (fallback) {
                translationStore.setCurrentPlatform(fallback.id);
                return;
            }

            activeTranslatorId = null;
            isLoading = false;
            loadError = null;
            void hideAllWebviews();
            return;
        }

        if (currentView !== "translation") {
            activeTranslatorId = null;
            isLoading = false;
            loadError = null;
            void hideAllWebviews();
            return;
        }

        activeTranslatorId = translator.id;
        void showTranslatorWebview(translator);
    });



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
                        console.error(`关闭翻译 WebView ${id} 失败:`, error);
                    }),
            );
        }

        await Promise.all(closeTasks);
        webviewWindows = new Map();
        shouldRestoreWebviews = false;

        if (appState.currentView === "translation" && translationStore.currentPlatform) {
            await showTranslatorWebview(translationStore.currentPlatform);
        }
    }

    async function showTranslatorWebview(platform: TranslationPlatform) {
        if (isShowingWebview) {
            return;
        }

        isShowingWebview = true;

        try {
            isLoading = true;
            loadError = null;

            await hideOtherWebviews(platform.id);

            let webview = webviewWindows.get(platform.id);
            const bounds = await calculateChildWebviewBounds(mainWindow);

            if (!webview) {
                const proxyUrl = resolveProxyUrl(configStore.config.proxy);
                webview = new ChildWebviewProxy(`translator-${platform.id}`, platform.url, proxyUrl);
                webviewWindows.set(platform.id, webview);
                await webview.ensure(bounds);
            } else {
                await webview.updateBounds(bounds);
            }

            await webview.show();
            shouldRestoreWebviews = false;

            if (isMainWindowFocused) {
                await webview.setFocus();
            }

            isLoading = false;
        } catch (error) {
            console.error(`显示翻译平台 ${platform.name} 失败:`, error);
            isLoading = false;
            loadError = platform.name;
            appState.setError(t("translation.toastError"));
        } finally {
            isShowingWebview = false;
        }
    }

    async function hideOtherWebviews(excludeId: string) {
        const hidePromises: Promise<void>[] = [];

        for (const [id, webview] of webviewWindows.entries()) {
            if (id !== excludeId) {
                hidePromises.push(
                    (async () => {
                        try {
                            await webview.hide();
                        } catch (error) {
                            console.error(`隐藏翻译 WebView ${id} 失败:`, error);
                        }
                    })(),
                );
            }
        }

        await Promise.all(hidePromises);
    }

    async function positionAllWebviews({ shouldEnsureActiveFront = false }: { shouldEnsureActiveFront?: boolean } = {}) {
        if (webviewWindows.size === 0) {
            return;
        }

        const bounds = await calculateChildWebviewBounds(mainWindow);
        const activeWebview = activeTranslatorId ? webviewWindows.get(activeTranslatorId) : null;
        const tasks: Promise<void>[] = [];

        for (const [, webview] of webviewWindows.entries()) {
            const isActive = webview === activeWebview;

            tasks.push(
                (async () => {
                    await webview.updateBounds(bounds);

                    if (shouldEnsureActiveFront && isActive && isMainWindowFocused) {
                        try {
                            await webview.show();
                            await webview.setFocus();
                        } catch (error) {
                            console.error("显示翻译 WebView 失败:", error);
                        }
                    }
                })(),
            );
        }

        await Promise.all(tasks);
    }

    function scheduleWebviewReflow({ shouldEnsureActiveFront: requestActiveFront = false, immediate = false } = {}) {
        shouldEnsureActiveFront ||= requestActiveFront;

        const execute = () => {
            const needsFront = shouldEnsureActiveFront;
            shouldEnsureActiveFront = false;

            positionAllWebviews({ shouldEnsureActiveFront: needsFront }).catch((error) => {
                console.error("翻译 WebView 重排失败:", error);
            });
        };

        if (immediate) {
            if (isPendingReflow) {
                isPendingReflow = false;
            }
            execute();
            return;
        }

        if (isPendingReflow) {
            return;
        }

        isPendingReflow = true;

        const run = () => {
            isPendingReflow = false;
            execute();
        };

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    interface HideAllOptions {
        markForRestore?: boolean;
    }

    async function hideAllWebviews({ markForRestore = false }: HideAllOptions = {}) {
        shouldRestoreWebviews = markForRestore;

        const hideTasks = Array.from(webviewWindows.values()).map((webview) =>
            webview.hide().catch((error) => {
                console.error("隐藏翻译 WebView 失败:", error);
            }),
        );

        await Promise.all(hideTasks);
    }

    async function closeAllWebviews() {
        const closeTasks = Array.from(webviewWindows.values()).map((webview) =>
            webview.close().catch((error) => {
                console.error("关闭翻译 WebView 失败:", error);
            }),
        );

        await Promise.all(closeTasks);
        webviewWindows.clear();
        shouldRestoreWebviews = false;
    }

    async function reloadCurrentTranslator() {
        if (!activeTranslatorId) {
            return;
        }

        const platform = translationStore.getPlatformById(activeTranslatorId);
        if (!platform) {
            return;
        }

        const currentWebview = webviewWindows.get(activeTranslatorId);

        try {
            if (currentWebview) {
                await currentWebview.close();
                webviewWindows.delete(activeTranslatorId);
            }

            await showTranslatorWebview(platform);
        } catch (error) {
            console.error("刷新翻译平台失败:", error);
            appState.setError(t("translation.toastError"));
        }
    }

    function handleHideAllWebviewsEvent() {
        void hideAllWebviews({ markForRestore: true });
    }

    function handleEnsureTranslationVisible() {
        const translator = translationStore.currentPlatform;
        if (translator && translator.enabled && appState.currentView === "translation") {
            void showTranslatorWebview(translator);
        }
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
        if (!(force || shouldRestoreWebviews)) {
            return;
        }

        if (!translationStore.currentPlatform) {
            shouldRestoreWebviews = false;
            return;
        }

        if (isShowingWebview) {
            shouldRestoreWebviews = false;
            return;
        }

        shouldRestoreWebviews = false;

        const platform = translationStore.currentPlatform;
        await showTranslatorWebview(platform);
        scheduleWebviewReflow({ shouldEnsureActiveFront: true });
    }

    onMount(() => {
        domEventHandlers.forEach(({ event, handler }) => {
            window.addEventListener(event, handler as EventListener);
        });

        let isComponentDisposed = false;

        (async () => {
            try {
                try {
                    isMainWindowFocused = await mainWindow.isFocused();
                } catch (error) {
                    console.error("获取窗口焦点状态失败:", error);
                }

                windowEventUnlisteners.resize = await mainWindow.onResized(({ payload }) => {
                    handleMainWindowResize(payload ?? undefined);
                });

                windowEventUnlisteners.move = await mainWindow.onMoved(() => {
                    handleMainWindowMove();
                });

                windowEventUnlisteners.scale = await mainWindow.onScaleChanged(() => {
                    handleMainWindowResize();
                });

                windowEventUnlisteners.focus = await mainWindow.listen("tauri://focus", () => {
                    isMainWindowFocused = true;
                });

                windowEventUnlisteners.blur = await mainWindow.listen("tauri://blur", () => {
                    isMainWindowFocused = false;
                });

                windowEventUnlisteners.close = await mainWindow.onCloseRequested(async () => {
                    await closeAllWebviews();
                });

                windowEventUnlisteners.hideWebviews = await mainWindow.listen("hideAllWebviews", () => {
                    void hideAllWebviews({ markForRestore: true });
                });

                windowEventUnlisteners.windowEvent = await mainWindow.listen("tauri://window-event", (event) => {
                    const payload = event.payload as { event: string } | undefined;
                    if (payload?.event === "minimized" || payload?.event === "hidden") {
                        void hideAllWebviews({ markForRestore: true });
                    }

                    if (payload?.event === "restored" || payload?.event === "shown") {
                        void restoreActiveWebview(true);
                    }
                });

                windowEventUnlisteners.restoreWebviews = await mainWindow.listen("restoreWebviews", () => {
                    void restoreActiveWebview(true);
                });

                if (isComponentDisposed) {
                    cleanupAllWindowEvents();
                    return;
                }
            } catch (error) {
                console.error("注册翻译窗口事件失败:", error);
            }
        })();

        scheduleWebviewReflow({ shouldEnsureActiveFront: true });

        return () => {
            isComponentDisposed = true;
            domEventHandlers.forEach(({ event, handler }) => {
                window.removeEventListener(event, handler as EventListener);
            });
            cleanupAllWindowEvents();
        };
    });

    onDestroy(async () => {
        await closeAllWebviews();
    });

    function cleanupEventListener(
        key: keyof typeof windowEventUnlisteners,
        unlisten: (() => void) | null,
    ) {
        if (unlisten) {
            unlisten();
            windowEventUnlisteners[key] = null;
        }
    }

    function cleanupAllWindowEvents() {
        Object.entries(windowEventUnlisteners).forEach(([key, unlisten]) => {
            cleanupEventListener(key as keyof typeof windowEventUnlisteners, unlisten);
        });
    }

    function reload() {
        void reloadCurrentTranslator();
    }
</script>

<div class="translation-container">

    <!-- 翻译内容区域 -->
    <div class="translation-content">
        {#if translationStore.currentPlatform}
            {#if isLoading}
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
                        <p class="loading-text">{t("translation.loading")}</p>
                    </div>
                </div>
            {/if}

            {#if loadError}
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
                        <h3 class="error-title">{t("translation.loadErrorTitle")}</h3>
                        <p class="error-message">
                            {translate("translation.loadErrorMessage", { name: loadError })}
                        </p>
                        <button class="reload-btn" onclick={reload}>
                            {t("translation.reload")}
                        </button>
                    </div>
                </div>
            {:else if !isLoading}
                <div class="translation-placeholder">
                    <svg
                        class="placeholder-icon"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                        />
                    </svg>
                    <p class="placeholder-text">
                        {translate("translation.externalWindowHint", {
                            name: translationStore.currentPlatform.name,
                        })}
                    </p>
                </div>
            {/if}
        {:else}
            <div class="no-platform">
                <svg
                    class="no-platform-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                    />
                </svg>
                <p>{t("translation.noPlatforms")}</p>
                <p class="hint">{t("translation.emptyHint")}</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .translation-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--bg-primary);
        overflow: hidden;
    }

    .translation-content {
        flex: 1;
        position: relative;
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

    .translation-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        color: var(--text-secondary);
        padding: 0 2rem;
        text-align: center;
    }

    .placeholder-icon {
        width: 48px;
        height: 48px;
        color: var(--text-tertiary);
    }

    .placeholder-text {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.5;
    }

    .no-platform {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
    }

    .no-platform-icon {
        width: 64px;
        height: 64px;
        color: var(--text-tertiary);
    }

    .no-platform p {
        font-size: 1rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .no-platform .hint {
        font-size: 0.875rem;
        color: var(--text-tertiary);
    }
</style>
