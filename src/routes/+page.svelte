<script lang="ts">
    /**
     * AI Ask 主页面
     */
    import { onMount, onDestroy } from "svelte";
    import Header from "$lib/components/layout/Header.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";
    import MainContent from "$lib/components/layout/MainContent.svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import { updateStore } from "$lib/stores/update.svelte";
    import type {
        UpdateAvailablePayload,
        UpdateDownloadedPayload,
        UpdateErrorPayload,
        UpdateProgressPayload,
    } from "$lib/stores/update.svelte";
    import { log } from "$lib/utils/logger";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { listen } from "@tauri-apps/api/event";
    import { getVersion } from "@tauri-apps/api/app";
    import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import "$lib/styles/base.css";

    let openSettingsUnlisten: UnlistenFn | null = null;
    let registeredTranslationHotkey: string | null = null;
    let updateEventUnlisten: UnlistenFn[] = [];

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

        await initializeUpdateFlow();

        try {
            openSettingsUnlisten = await listen("open-settings", () => {
                appState.openSettings();
            });
        } catch (error) {
            log.error("Failed to listen for open-settings event", error);
        }
    });

    function cleanupUpdateListeners() {
        for (const unlisten of updateEventUnlisten) {
            try {
                unlisten();
            } catch (error) {
                log.warn("Failed to remove update listener", error);
            }
        }
        updateEventUnlisten = [];
    }

    async function registerUpdateEventListeners() {
        if (updateEventUnlisten.length > 0) {
            return;
        }

        const registrations: Array<Promise<UnlistenFn>> = [
            listen("update:available", (event) => {
                updateStore.handleUpdateAvailable(
                    (event.payload as UpdateAvailablePayload | undefined) ?? undefined,
                );
            }),
            listen("update:progress", (event) => {
                updateStore.handleUpdateProgress(
                    (event.payload as UpdateProgressPayload | undefined) ?? undefined,
                );
            }),
            listen("update:downloaded", (event) => {
                updateStore.handleUpdateDownloaded(
                    (event.payload as UpdateDownloadedPayload | undefined) ?? undefined,
                );
            }),
            listen("update:error", (event) => {
                updateStore.handleUpdateError(
                    (event.payload as UpdateErrorPayload | undefined) ?? undefined,
                );
            }),
        ];

        const results = await Promise.all(
            registrations.map(async (registration) => {
                try {
                    return await registration;
                } catch (error) {
                    log.error("Failed to register update listener", error);
                    return null;
                }
            }),
        );

        updateEventUnlisten = results.filter(
            (fn): fn is UnlistenFn => typeof fn === "function",
        );
    }

    async function initializeUpdateFlow() {
        try {
            const currentVersion = await getVersion();
            await updateStore.init({
                currentVersion,
                autoUpdate: configStore.config.autoUpdate,
                proxy: configStore.config.proxy,
            });
        } catch (error) {
            log.error("Failed to initialize auto update", error);
        }

        await registerUpdateEventListeners();
    }

    onDestroy(() => {
        openSettingsUnlisten?.();
        openSettingsUnlisten = null;
        cleanupUpdateListeners();

        if (registeredTranslationHotkey) {
            const hotkey = registeredTranslationHotkey;
            registeredTranslationHotkey = null;
            void (async () => {
                try {
                    if (await isRegistered(hotkey)) {
                        await unregister(hotkey);
                    }
                } catch (error) {
                    log.error("Failed to unregister translation hotkey", error);
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

            if (!registeredTranslationHotkey) {
                await register(hotkey, () => {
                    void handleTranslationHotkey();
                });
                registeredTranslationHotkey = hotkey;
            }
        } catch (error) {
            log.error("Failed to register translation hotkey", error);
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
            log.error("Failed to handle translation hotkey", error);
        }
    }

    $effect(() => {
        if (!configStore.initialized) {
            return;
        }

        const hotkey = configStore.config.translationHotkey;
        void ensureTranslationHotkeyRegistered(hotkey);

        updateStore.syncConfig({
            autoUpdate: configStore.config.autoUpdate,
            proxy: configStore.config.proxy,
        });
    });
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
