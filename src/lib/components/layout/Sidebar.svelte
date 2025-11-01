<script lang="ts">
    /**
     * 侧边栏组件 - 显示AI平台图标和功能入口
     */
    import { Settings, Languages } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { i18n } from "$lib/i18n";

    const t = i18n.t;

    /**
     * 选择AI平台
     */
    function selectPlatform(platform: any) {
        const alreadySelected =
            appState.currentView === "chat" && appState.selectedPlatform?.id === platform.id;

        if (alreadySelected) {
            appState.switchToWelcomeView();
            configStore.setLastUsedPlatform(null);
            return;
        }

        appState.switchToChatView(platform);
        configStore.setLastUsedPlatform(platform.id);
    }

    /**
     * 打开翻译功能
     */
    function openTranslation() {
        appState.switchToTranslationView();
    }

    /**
     * 打开设置
     */
    function openSettings() {
        // 隐藏所有子 WebView，避免遮挡设置页（不标记恢复）
        window.dispatchEvent(new Event("hideAllWebviewsNoRestore"));
        appState.openSettings();
    }

    /**
     * 检查是否是当前选中的平台
     */
    function isSelected(platformId: string): boolean {
        return appState.selectedPlatform?.id === platformId;
    }
</script>

<aside class="sidebar">
    <div class="platform-list">
        {#each platformsStore.enabledPlatforms as platform (platform.id)}
            <button
                class="platform-item tooltip"
                class:selected={isSelected(platform.id)}
                onclick={() => selectPlatform(platform)}
                data-tooltip={platform.name}
                title={platform.name}
                aria-label={platform.name}
            >
                <img
                    src={platform.icon}
                    alt={platform.name}
                    class="platform-icon"
                    onerror={(e) => {
                        const target = e.currentTarget as HTMLImageElement;
                        target.src =
                            "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E";
                    }}
                />
            </button>
        {/each}
    </div>

    <div class="bottom-actions">
        <button
            class="action-btn tooltip"
            class:selected={appState.currentView === "translation"}
            onclick={openTranslation}
            data-tooltip={t("sidebar.translation")}
            aria-label={t("sidebar.translation")}
        >
            <Languages size={20} />
        </button>

        <button
            class="action-btn tooltip"
            class:selected={appState.currentView === "settings"}
            onclick={openSettings}
            data-tooltip={t("sidebar.settings")}
            aria-label={t("sidebar.settings")}
        >
            <Settings size={20} />
        </button>
    </div>
</aside>

<style>
    .sidebar {
        width: 56px;
        height: 100%;
        background-color: var(--bg-secondary);
        border-right: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
    }

    .platform-list {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 12px 0;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .platform-list::-webkit-scrollbar {
        width: 4px;
    }

    .platform-item {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        border: none;
        background-color: var(--bg-primary);
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        position: relative;
        overflow: hidden;
    }

    .platform-item:hover {
        transform: scale(1.08);
        box-shadow: var(--shadow-md);
    }

    .platform-item.selected {
        background-color: var(--accent-color);
        box-shadow: 0 0 0 2px var(--accent-color);
    }

    .platform-item.selected::before {
        content: "";
        position: absolute;
        left: -3px;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
        height: 24px;
        background-color: var(--accent-color);
        border-radius: 0 2px 2px 0;
    }

    .platform-icon {
        width: 18px;
        height: 18px;
        border-radius: 6px;
        object-fit: cover;
    }

    .platform-item.selected .platform-icon {
        filter: brightness(1.2);
    }

    .bottom-actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 12px 0;
        border-top: 1px solid var(--border-color);
    }

    .action-btn {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        border: none;
        background-color: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .action-btn:hover {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        transform: scale(1.08);
    }

    .action-btn.selected {
        background-color: var(--accent-color);
        color: white;
    }

    /* Tooltip styles */
    .tooltip {
        position: relative;
    }

    .tooltip::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        margin-left: 0.5rem;
        padding: 0.375rem 0.75rem;
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
        font-size: 0.75rem;
        white-space: nowrap;
        border-radius: 0.25rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease-in-out;
        z-index: 1000;
        border: 1px solid var(--border-color);
        box-shadow: var(--shadow-md);
    }

    .tooltip:hover::after {
        opacity: 1;
    }
</style>
