<script lang="ts">
    /**
     * AI Ask 主页面
     */
    import { onMount, onDestroy, tick } from "svelte";
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

    function waitForChatViewReady(targetPlatformId: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const handler = (event: Event) => {
                const detail = (event as CustomEvent<{ platformId?: string }>).detail;
                if (detail?.platformId === targetPlatformId) {
                    cleanup();
                    resolve();
                }
            };

            const pollId = window.setInterval(() => {
                const isReady =
                    appState.currentView === "chat" &&
                    appState.selectedPlatform?.id === targetPlatformId &&
                    !appState.webviewLoading;
                    
                if (isReady) {
                    cleanup();
                    resolve();
                }
            }, 100);

            const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error("CHAT_WEBVIEW_READY_TIMEOUT"));
            }, 8000);

            const cleanup = () => {
                window.removeEventListener("chatWebviewReady", handler as EventListener);
                clearInterval(pollId);
                clearTimeout(timeoutId);
            };

            window.addEventListener("chatWebviewReady", handler as EventListener);
        });
    }

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
            quickAskShowPlatformUnlisten = await listen<{ platformId: string; question: string }>("quick-ask-submit", async (event) => {
                console.log("Received quick-ask-submit event:", event.payload);
                const { platformId, question } = event.payload;
                const platform = platformsStore.getPlatformById(platformId);
                if (!platform) {
                    console.error("Platform not found:", platformId);
                    return;
                }

                console.log("Showing main window and switching to platform:", platform.name);

                try {
                    const appWindow = getCurrentWebviewWindow();
                    await appWindow.show();
                    await appWindow.setFocus();
                } catch (windowError) {
                    console.error("Failed to show main window:", windowError);
                }

                appState.switchToChatView(platform);

                await tick();

                window.dispatchEvent(
                    new CustomEvent("ensureChatVisible", {
                        detail: { platformId: platform.id },
                    }),
                );

                try {
                    await waitForChatViewReady(platform.id);
                    console.log("Chat webview ready, injecting question...");
                    
                    const { injectQuestionToPlatform } = await import("$lib/utils/injection");
                    
                    // Retry injection logic
                    const attemptInjection = async (retries: number): Promise<void> => {
                        try {
                            await injectQuestionToPlatform(platformId, question);
                            console.log("Question injected successfully");
                        } catch (error) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : typeof error === "string"
                                        ? error
                                        : JSON.stringify(error);

                            if (message === "NOT_LOGGED_IN") {
                                console.warn("Platform requires login", { platformId });
                                appState.setError(`请先登录 ${platform.name}`);
                                throw error;
                            }

                            if (retries > 0 && message.includes("子 webview 不存在")) {
                                console.warn("Target webview missing, retrying injection", {
                                    platformId,
                                    remainingRetries: retries,
                                });
                                await new Promise(resolve => setTimeout(resolve, 300));
                                await attemptInjection(retries - 1);
                                return;
                            }

                            throw error;
                        }
                    };

                    await new Promise(resolve => setTimeout(resolve, 100));
                    await attemptInjection(2);
                } catch (injectionError) {
                    console.error("Failed to inject question:", injectionError);
                    if (injectionError instanceof Error && injectionError.message !== "NOT_LOGGED_IN") {
                        appState.setError("注入问题失败，请重试");
                    }
                }
            });
        } catch (error) {
            console.error("Failed to listen for quick-ask-submit event:", error);
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
