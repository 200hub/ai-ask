<script lang="ts">
    /**
     * 主内容区域组件 - 根据当前视图显示不同内容
     */
    import { appState } from "$lib/stores/app.svelte";
    import WelcomePage from "../pages/WelcomePage.svelte";
    import AIChat from "../pages/AIChat.svelte";
    import TranslationPage from "../pages/TranslationPage.svelte";
    import SettingsModal from "../settings/SettingsModal.svelte";
</script>

<main class="main-content">
    {#if appState.currentView === "welcome"}
        <WelcomePage />
    {:else if appState.currentView === "chat"}
        <AIChat />
    {:else if appState.currentView === "translation"}
        <TranslationPage />
    {/if}

    {#if appState.showSettings}
        <SettingsModal />
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
                aria-label="关闭错误提示"
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
</style>
