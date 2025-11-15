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
    import { logger } from "$lib/utils/logger";
    import { TIMING } from "$lib/utils/constants";

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
        isLoading = true;
        loadError = null;
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
                        logger.error("Failed to close translator WebView", { id, error });
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
            const start = Date.now();

            await hideOtherWebviews(platform.id);

            let webview = webviewWindows.get(platform.id);
                // 标记当前是否复用已存在的翻译 WebView：
                // - true：之前已经创建过，只是再次切换回来（暖启动）
                // - false：第一次打开该翻译平台（冷启动）
                const wasExistingWebview = Boolean(webview);
            const bounds = await calculateChildWebviewBounds(mainWindow);

            if (!webview) {
                const proxyUrl = resolveProxyUrl(configStore.config.proxy);
                webview = new ChildWebviewProxy(`translator-${platform.id}`, platform.url, proxyUrl);
                webviewWindows.set(platform.id, webview);
                await webview.ensure(bounds);
                // 等待页面真正加载完成再显示
                await webview.waitForLoadFinished();
            } else {
                await webview.updateBounds(bounds);
            }

            await webview.show();
            shouldRestoreWebviews = false;

            if (isMainWindowFocused) {
                await webview.setFocus();
                // 聚焦后稍作等待，避免页面尚未完成首帧渲染
                await new Promise((r) => setTimeout(r, TIMING.WEBVIEW_READY_EXTRA_DELAY_MS));
            }
            // 保证加载动画的最小显示时长
            {
                const elapsed = Date.now() - start;
                const minLoadingMs = wasExistingWebview
                    ? TIMING.MIN_WEBVIEW_LOADING_WARM_MS
                    : TIMING.MIN_WEBVIEW_LOADING_MS;
                const waitMs = Math.max(minLoadingMs - elapsed, 0);
                if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
            }
            isLoading = false;
        } catch (error) {
            logger.error("Failed to show translator WebView", { platform: platform.name, error });
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
                            logger.error("Failed to hide translator WebView", { id, error });
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
                            logger.error("Failed to activate translator WebView", error);
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
                logger.error("Translator WebView reflow failed", error);
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
                logger.error("Failed to hide translator WebView", error);
            }),
        );

        await Promise.all(hideTasks);
    }

    async function closeAllWebviews() {
        const closeTasks = Array.from(webviewWindows.values()).map((webview) =>
            webview.close().catch((error) => {
                logger.error("Failed to close translator WebView", error);
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
            logger.error("Failed to reload translator platform", error);
            appState.setError(t("translation.toastError"));
        }
    }

    function handleHideAllWebviewsEvent(event: Event) {
        const customEvent = event as CustomEvent<{ markForRestore?: boolean }>;
        const markForRestore = customEvent.detail?.markForRestore ?? true;
        void hideAllWebviews({ markForRestore });
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

    async function restoreActiveWebview() {
        if (!shouldRestoreWebviews) {
            return;
        }

        if (appState.currentView !== "translation") {
            shouldRestoreWebviews = false;
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
                    logger.error("Failed to get window focus state", error);
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
                        void restoreActiveWebview();
                    }
                });

                windowEventUnlisteners.restoreWebviews = await mainWindow.listen("restoreWebviews", () => {
                    void restoreActiveWebview();
                });

                if (isComponentDisposed) {
                    cleanupAllWindowEvents();
                    return;
                }
            } catch (error) {
                logger.error("Failed to register translator window events", error);
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
