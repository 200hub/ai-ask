<script lang="ts">
    /**
     * AI Ask 主页面
     */
    import { onMount, onDestroy } from "svelte";
    import Header from "$lib/components/layout/Header.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";
    import MainContent from "$lib/components/layout/MainContent.svelte";
    import QuickAsk from "$lib/components/pages/QuickAsk.svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { listen } from "@tauri-apps/api/event";
    import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import "$lib/styles/base.css";

    let openSettingsUnlisten: UnlistenFn | null = null;
    let quickAskShowPlatformUnlisten: UnlistenFn | null = null;
    let registeredTranslationHotkey: string | null = null;

    onMount(async () => {
        // 初始化所有 stores
        await configStore.init();
        await platformsStore.init();
        await translationStore.init();

        const translatorId = configStore.config.currentTranslator;
        if (translatorId) {
            translationStore.setCurrentPlatform(translatorId);
        } else if (!translationStore.currentPlatform && translationStore.enabledPlatforms.length > 0) {
            translationStore.setCurrentPlatform(translationStore.enabledPlatforms[0].id);
        }

        // 如果有默认平台或上次使用的平台，自动选择
        const lastPlatformId =
            configStore.config.lastUsedPlatform ||
            configStore.config.defaultPlatform;
        if (lastPlatformId) {
            const platform = platformsStore.getPlatformById(lastPlatformId);
            if (platform && platform.enabled) {
                appState.switchToChatView(platform);
            }
        }

        try {
            openSettingsUnlisten = await listen("open-settings", () => {
                appState.openSettings();
            });
        } catch (error) {
            console.error("Failed to listen for open-settings event:", error);
        }

        // 监听快速问答提交事件
        try {
            quickAskShowPlatformUnlisten = await listen<{ platformId: string }>("quick-ask-show-platform", async (event) => {
                console.log("Received quick-ask-show-platform event:", event.payload);
                const { platformId } = event.payload;
                const platform = platformsStore.getPlatformById(platformId);
                if (platform) {
                    console.log("Showing main window and switching to platform:", platform.name);
                    // 显示主窗口
                    const appWindow = getCurrentWebviewWindow();
                    await appWindow.show();
                    await appWindow.setFocus();
                    
                    // 切换到聊天视图并显示对应平台
                    appState.switchToChatView(platform);
                } else {
                    console.error("Platform not found:", platformId);
                }
            });
        } catch (error) {
            console.error("Failed to listen for quick-ask-show-platform event:", error);
        }
    });

    onDestroy(() => {
        openSettingsUnlisten?.();
        openSettingsUnlisten = null;

        quickAskShowPlatformUnlisten?.();
        quickAskShowPlatformUnlisten = null;

        if (registeredTranslationHotkey) {
            const hotkey = registeredTranslationHotkey;
            registeredTranslationHotkey = null;
            void (async () => {
                try {
                    if (await isRegistered(hotkey)) {
                        await unregister(hotkey);
                    }
                } catch (error) {
                    console.error("Failed to unregister translation hotkey:", error);
                }
            })();
        }
    });

    async function ensureTranslationHotkeyRegistered(hotkey: string) {
        if (!hotkey) {
            return;
        }

        try {
            if (registeredTranslationHotkey && registeredTranslationHotkey !== hotkey) {
                if (await isRegistered(registeredTranslationHotkey)) {
                    await unregister(registeredTranslationHotkey);
                }
                registeredTranslationHotkey = null;
            }

            if (registeredTranslationHotkey === hotkey) {
                // Ensure cached state与实际注册状态一致
                if (!(await isRegistered(hotkey))) {
                    registeredTranslationHotkey = null;
                } else {
                    return;
                }
            }

            if (await isRegistered(hotkey)) {
                registeredTranslationHotkey = hotkey;
                return;
            }

            if (!registeredTranslationHotkey) {
                await register(hotkey, () => {
                    void handleTranslationHotkey();
                });
                registeredTranslationHotkey = hotkey;
            }
        } catch (error) {
            console.error("Failed to register translation hotkey:", error);
            registeredTranslationHotkey = null;
        }
    }

    async function handleTranslationHotkey() {
        try {
            appState.switchToTranslationView();

            const appWindow = getCurrentWebviewWindow();
            const [isVisible, isMinimized] = await Promise.all([
                appWindow.isVisible().catch(() => false),
                appWindow.isMinimized().catch(() => false),
            ]);

            if (isMinimized) {
                await appWindow.unminimize().catch(() => {});
            }

            if (!isVisible) {
                await appWindow.show().catch(() => {});
            }

            await appWindow.setFocus().catch(() => {});

            window.dispatchEvent(new CustomEvent("ensureTranslationVisible"));
        } catch (error) {
            console.error("Failed to handle translation hotkey:", error);
        }
    }

    $effect(() => {
        if (!configStore.initialized) {
            return;
        }

        const hotkey = configStore.config.translationHotkey;
        void ensureTranslationHotkeyRegistered(hotkey);
    });
</script>

<div class="app-container">
    <Header />
    <div class="app-body">
        <Sidebar />
        <MainContent />
    </div>
</div>

<QuickAsk />

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
