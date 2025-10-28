<script lang="ts">
    /**
     * 设置模态框组件 - 多标签页设置界面
     */
    import { X } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import type { SettingsTab } from "$lib/types/config";
    import GeneralSettings from "./GeneralSettings.svelte";
    import PlatformSettings from "./PlatformSettings.svelte";
    import ProxySettings from "./ProxySettings.svelte";
    import TranslationSettings from "./TranslationSettings.svelte";
    import AboutSettings from "./AboutSettings.svelte";
    import Button from "../common/Button.svelte";

    let currentTab = $state<SettingsTab>("general");

    const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
        { id: "general", label: "通用", icon: "⚙️" },
        { id: "platforms", label: "AI平台", icon: "🤖" },
        { id: "proxy", label: "代理", icon: "🌐" },
        { id: "translation", label: "翻译", icon: "🌍" },
        { id: "about", label: "关于", icon: "ℹ️" },
    ];

    /**
     * 关闭设置
     */
    function handleClose() {
        appState.closeSettings();
    }

    /**
     * 点击遮罩关闭
     */
    function handleOverlayClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            handleClose();
        }
    }

    /**
     * 切换标签页
     */
    function switchTab(tabId: SettingsTab) {
        currentTab = tabId;
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal-container">
        <!-- 标题栏 -->
        <div class="modal-header">
            <h2 class="modal-title">设置</h2>
            <Button variant="icon" onclick={handleClose}>
                <X size={20} />
            </Button>
        </div>

        <!-- 标签导航 -->
        <div class="tabs-nav">
            {#each tabs as tab (tab.id)}
                <button
                    class="tab-button"
                    class:active={currentTab === tab.id}
                    onclick={() => switchTab(tab.id)}
                >
                    <span class="tab-icon">{tab.icon}</span>
                    <span class="tab-label">{tab.label}</span>
                </button>
            {/each}
        </div>

        <!-- 标签内容 -->
        <div class="modal-content">
            {#if currentTab === "general"}
                <GeneralSettings />
            {:else if currentTab === "platforms"}
                <PlatformSettings />
            {:else if currentTab === "proxy"}
                <ProxySettings />
            {:else if currentTab === "translation"}
                <TranslationSettings />
            {:else if currentTab === "about"}
                <AboutSettings />
            {/if}
        </div>
    </div>
</div>

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .modal-container {
        width: 90vw;
        max-width: 900px;
        height: 80vh;
        max-height: 700px;
        background-color: var(--bg-primary);
        border-radius: 12px;
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
        from {
            transform: translateY(-20px);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.5rem;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .modal-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .tabs-nav {
        display: flex;
        gap: 0.25rem;
        padding: 1rem 1.5rem 0;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .tab-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
        background-color: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
    }

    .tab-button:hover {
        color: var(--text-primary);
        background-color: var(--bg-secondary);
        border-radius: 0.5rem 0.5rem 0 0;
    }

    .tab-button.active {
        color: var(--accent-color);
        border-bottom-color: var(--accent-color);
    }

    .tab-icon {
        font-size: 1.125rem;
    }

    .tab-label {
        white-space: nowrap;
    }

    .modal-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
    }

    .modal-content::-webkit-scrollbar {
        width: 8px;
    }

    .modal-content::-webkit-scrollbar-track {
        background: var(--bg-secondary);
    }

    .modal-content::-webkit-scrollbar-thumb {
        background: var(--border-color);
        border-radius: 4px;
    }

    .modal-content::-webkit-scrollbar-thumb:hover {
        background: var(--text-tertiary);
    }

    /* 响应式设计 */
    @media (max-width: 768px) {
        .modal-container {
            width: 95vw;
            height: 90vh;
        }

        .modal-header {
            padding: 1rem;
        }

        .tabs-nav {
            padding: 0.75rem 1rem 0;
            overflow-x: auto;
        }

        .tab-button {
            padding: 0.5rem 1rem;
            font-size: 0.8125rem;
        }

        .modal-content {
            padding: 1rem;
        }
    }
</style>
