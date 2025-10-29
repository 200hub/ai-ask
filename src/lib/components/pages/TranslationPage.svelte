<script lang="ts">
    /**
     * 翻译页面组件 - 嵌入翻译平台网页
     */
    import { onMount } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { i18n } from "$lib/i18n";

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

    let iframeElement = $state<HTMLIFrameElement | null>(null);
    let isLoading = $state(true);
    let loadError = $state(false);

    /**
     * 切换翻译平台
     */
    function switchPlatform(platformId: string) {
        translationStore.setCurrentPlatform(platformId);
        configStore.setCurrentTranslator(platformId);
        isLoading = true;
        loadError = false;
    }

    /**
     * iframe加载完成
     */
    function handleLoad() {
        isLoading = false;
        loadError = false;
    }

    /**
     * iframe加载失败
     */
    function handleError() {
        isLoading = false;
        loadError = true;
        appState.setError(t("translation.toastError"));
    }

    /**
     * 重新加载
     */
    function reload() {
        if (iframeElement && translationStore.currentPlatform) {
            isLoading = true;
            loadError = false;
            iframeElement.src = translationStore.currentPlatform.url;
        }
    }

    onMount(() => {
        // 确保有选中的翻译平台
        if (
            !translationStore.currentPlatform &&
            translationStore.enabledPlatforms.length > 0
        ) {
            translationStore.setCurrentPlatform(
                translationStore.enabledPlatforms[0].id,
            );
        }
    });
</script>

<div class="translation-container">
    <!-- 翻译平台选择器 -->
    <div class="platform-selector">
        <div class="selector-label">{t("translation.selectorLabel")}</div>
        <div class="platform-buttons">
            {#each translationStore.enabledPlatforms as platform (platform.id)}
                <button
                    class="platform-btn"
                    class:active={translationStore.currentPlatform?.id ===
                        platform.id}
                    onclick={() => switchPlatform(platform.id)}
                >
                    <img
                        src={platform.icon}
                        alt={platform.name}
                        class="platform-btn-icon"
                        onerror={(e) =>
                            ((
                                e.currentTarget as HTMLImageElement
                            ).style.display = "none")}
                    />
                    <span>{platform.name}</span>
                </button>
            {/each}
        </div>
    </div>

    <!-- 翻译内容区域 -->
    <div class="translation-content">
        {#if translationStore.currentPlatform}
            <!-- 加载状态 -->
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

            <!-- 错误状态 -->
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
                            {translate("translation.loadErrorMessage", {
                                name: translationStore.currentPlatform.name,
                            })}
                        </p>
                        <button class="reload-btn" onclick={reload}>
                            {t("translation.reload")}
                        </button>
                    </div>
                </div>
            {/if}

            <!-- WebView iframe -->
            <iframe
                bind:this={iframeElement}
                src={translationStore.currentPlatform.url}
                title={translationStore.currentPlatform.name}
                class="translation-iframe"
                class:hidden={isLoading || loadError}
                onload={handleLoad}
                onerror={handleError}
                allow="clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            ></iframe>
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

    .platform-selector {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.5rem;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .selector-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .platform-buttons {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        flex: 1;
        overflow-x: auto;
    }

    .platform-buttons::-webkit-scrollbar {
        height: 4px;
    }

    .platform-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        color: var(--text-primary);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
    }

    .platform-btn:hover {
        border-color: var(--accent-color);
        background-color: var(--bg-tertiary);
    }

    .platform-btn.active {
        background-color: var(--accent-color);
        color: white;
        border-color: var(--accent-color);
    }

    .platform-btn-icon {
        width: 16px;
        height: 16px;
        border-radius: 2px;
    }

    .translation-content {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    .translation-iframe {
        width: 100%;
        height: 100%;
        border: none;
        display: block;
    }

    .translation-iframe.hidden {
        display: none;
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
