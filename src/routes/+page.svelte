<script lang="ts">
    /**
     * AI Ask 主页面
     */
    import { onMount, onDestroy } from "svelte";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { listen } from "@tauri-apps/api/event";
    import Header from "$lib/components/layout/Header.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";
    import MainContent from "$lib/components/layout/MainContent.svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import { logger } from "$lib/utils/logger";
    import "$lib/styles/base.css";

    let openSettingsUnlisten: UnlistenFn | null = null;
    let translationHotkeyUnlisten: UnlistenFn | null = null;

    onMount(() => {
        void registerOpenSettingsListener();
        void registerTranslationHotkeyListener();
        void initializeStores();
    });

    onDestroy(() => {
        openSettingsUnlisten?.();
        openSettingsUnlisten = null;
        
        translationHotkeyUnlisten?.();
        translationHotkeyUnlisten = null;
    });

    /**
     * 处理翻译快捷键触发
     */
    function handleTranslationHotkey() {
        logger.debug("Translation hotkey triggered, switching to translation view");
        appState.switchToTranslationView();
        window.dispatchEvent(new CustomEvent("ensureTranslationVisible"));
    }

    /**
     * 注册翻译快捷键监听器
     */
    async function registerTranslationHotkeyListener() {
        try {
            translationHotkeyUnlisten = await listen("translation-hotkey-triggered", () => {
                handleTranslationHotkey();
            });
        } catch (error) {
            logger.error("Failed to listen for translation-hotkey-triggered event:", error);
        }
    }

    async function initializeStores() {
        try {
            await configStore.init();
            await platformsStore.init();
            await translationStore.init();

            const translatorId = configStore.config.currentTranslator;
            if (translatorId) {
                translationStore.setCurrentPlatform(translatorId);
            } else if (!translationStore.currentPlatform && translationStore.enabledPlatforms.length > 0) {
                translationStore.setCurrentPlatform(translationStore.enabledPlatforms[0].id);
            }

            const lastPlatformId =
                configStore.config.lastUsedPlatform ||
                configStore.config.defaultPlatform;
            if (lastPlatformId) {
                const platform = platformsStore.getPlatformById(lastPlatformId);
                if (platform && platform.enabled) {
                    appState.switchToChatView(platform);
                }
            }
        } catch (error) {
            logger.error("Failed to initialize application stores:", error);
        }
    }

    async function registerOpenSettingsListener() {
        try {
            openSettingsUnlisten = await listen("open-settings", () => {
                appState.openSettings();
            });
        } catch (error) {
            logger.error("Failed to listen for open-settings event:", error);
        }
    }
</script>

<div class="app-container">
    <Header />
    <div class="app-body">
        <Sidebar />
        <MainContent />
    </div>
</div>

<style>
    .app-container {
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background-color: var(--bg-primary);
    }

    .app-body {
        flex: 1;
        display: flex;
        overflow: hidden;
    }
</style>
