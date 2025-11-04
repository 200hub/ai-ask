<script lang="ts">
    /**
     * 主内容区域组件 - 根据当前视图显示不同内容
     */
    import { onMount } from "svelte";
    import { appState } from "$lib/stores/app.svelte";
    import WelcomePage from "../pages/WelcomePage.svelte";
    import LoadingSpinner from "../common/LoadingSpinner.svelte";
    import { i18n } from "$lib/i18n";
    import { logger } from "$lib/utils/logger";

    // 懒加载 AIChat，避免未进入聊天视图时的任何潜在副作用
    type AIChatComponent = typeof import("../pages/AIChat.svelte").default;
    let AIChatComp = $state<AIChatComponent | null>(null);

    // 懒加载翻译页，降低初始包体积
    type TranslationComponent = typeof import("../pages/TranslationPage.svelte").default;
    let TranslationComp = $state<TranslationComponent | null>(null);

    // 懒加载设置模态框，按需加载设置相关依赖
    type SettingsModalComponent = typeof import("../settings/SettingsModal.svelte").default;
    let SettingsModalComp = $state<SettingsModalComponent | null>(null);

    // 懒加载调试页面
    type DebugInjectionPageComponent = typeof import("../pages/DebugInjectionPage.svelte").default;
    let DebugInjectionPageComp = $state<DebugInjectionPageComponent | null>(null);

    const t = i18n.t;

    $effect(() => {
        if (appState.currentView === "chat" && !AIChatComp) {
            (async () => {
                const mod = await import("../pages/AIChat.svelte");
                AIChatComp = mod.default;
            })();
        }
    });

    $effect(() => {
        if (appState.currentView === "translation" && !TranslationComp) {
            (async () => {
                const mod = await import("../pages/TranslationPage.svelte");
                TranslationComp = mod.default;
            })();
        }
    });

    $effect(() => {
        if (appState.showSettings && !SettingsModalComp) {
            (async () => {
                try {
                    const mod = await import("../settings/SettingsModal.svelte");
                    SettingsModalComp = mod.default;
                } catch (error) {
                    logger.error("Failed to load settings modal on demand:", error);
                }
            })();
        }
    });

    $effect(() => {
        if (appState.currentView === "debug" && !DebugInjectionPageComp) {
            (async () => {
                try {
                    const mod = await import("../pages/DebugInjectionPage.svelte");
                    DebugInjectionPageComp = mod.default;
                } catch (error) {
                    logger.error("Failed to load debug page:", error);
                }
            })();
        }
    });

    onMount(() => {
        const timer = window.setTimeout(() => {
            if (!SettingsModalComp) {
                void import("../settings/SettingsModal.svelte")
                    .then((mod) => {
                        SettingsModalComp = mod.default;
                    })
                    .catch((error) => {
                        logger.error("Failed to preload settings modal:", error);
                    });
            }
        }, 300);

        return () => {
            window.clearTimeout(timer);
        };
    });
</script>

<main class="main-content">
    <div class="view welcome" class:active={appState.currentView === "welcome"}>
        <WelcomePage />
    </div>

    <div class="view chat" class:active={appState.currentView === "chat"}>
        {#if AIChatComp}
            <AIChatComp />
        {:else}
            <div class="loading-container">
                <LoadingSpinner size="large" message={t("chat.loading")} />
            </div>
        {/if}
    </div>

    <div class="view translation" class:active={appState.currentView === "translation"}>
        {#if TranslationComp}
            <TranslationComp />
        {:else}
            <div class="loading-container">
                <LoadingSpinner size="large" message={t("common.loading")} />
            </div>
        {/if}
    </div>

    <div class="view debug" class:active={appState.currentView === "debug"}>
        {#if DebugInjectionPageComp}
            <DebugInjectionPageComp />
        {:else}
            <div class="loading-container">
                <LoadingSpinner size="large" message={t("common.loading")} />
            </div>
        {/if}
    </div>

    {#if appState.showSettings}
        {#if SettingsModalComp}
            <SettingsModalComp />
        {:else}
            <div class="settings-loading-backdrop">
                <LoadingSpinner size="large" message={t("common.loading")} />
            </div>
        {/if}
    {/if}

    {#if appState.error}
        <div class="error-toast">
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
            <span>{appState.error}</span>
            <button
                class="close-toast"
                onclick={() => appState.clearError()}
                aria-label={t("common.close")}
            >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </div>
    {/if}
</main>

<style>
    .main-content {
        flex: 1;
        position: relative;
        overflow: hidden;
        background-color: var(--bg-primary);
    }

    .view {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: none;
    }

    .view.active {
        display: block;
    }

    .error-toast {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1.25rem;
        background-color: var(--error-color);
        color: white;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideUp 0.3s ease-out;
        max-width: 90%;
    }

    @keyframes slideUp {
        from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
        }
        to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }

    .error-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .error-toast span {
        font-size: 0.875rem;
        font-weight: 500;
    }

    .close-toast {
        width: 20px;
        height: 20px;
        padding: 0;
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        flex-shrink: 0;
        opacity: 0.8;
        transition: opacity 0.2s ease;
    }

    .close-toast:hover {
        opacity: 1;
    }

    .close-toast svg {
        width: 100%;
        height: 100%;
    }

    .loading-container {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .settings-loading-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.45);
        z-index: 9998;
    }
</style>
