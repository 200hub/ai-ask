<script lang="ts">
    /**
     * 顶部导航栏组件
     */
    import { X } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { updateStore } from "$lib/stores/update.svelte";
    import { i18n } from "$lib/i18n";
    import { log } from "$lib/utils/logger";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

    const t = i18n.t;
    const appWindow = getCurrentWebviewWindow();

    function dispatchHideWebviews() {
        window.dispatchEvent(new CustomEvent("hideAllWebviews"));
    }

    /**
     * 关闭窗口（实际是隐藏到托盘）
     */
    async function handleClose() {
        dispatchHideWebviews();
        try {
            await appWindow.hide();
        } catch (error) {
            log.error("Failed to hide window", error);
        }
    }

    async function handleManualCheck() {
        const status = updateStore.status;
        if (status === "checking" || status === "downloading" || status === "installing") {
            return;
        }
        await updateStore.checkForUpdates(true);
    }

    async function handleDownloadUpdate() {
        if (updateStore.status !== "available") {
            return;
        }
        await updateStore.startDownload();
    }

    async function handleCancelDownload() {
        if (updateStore.status !== "downloading") {
            return;
        }
        await updateStore.cancelDownload();
    }

    async function handleRestartAndInstall() {
        if (updateStore.status !== "downloaded") {
            return;
        }
        await updateStore.installAndRestart();
    }

    function handleDismissUpdate() {
        if (updateStore.status === "downloaded") {
            updateStore.acknowledgeInstalled();
        }
    }

    $: updateProgress = Math.max(0, Math.min(100, Math.round(updateStore.downloadProgress)));
    $: updateMessage = resolveUpdateMessage();
    $: showUpdateBanner = Boolean(updateMessage);

    function resolveUpdateMessage(): string | null {
        const status = updateStore.status;
        switch (status) {
            case "checking":
                return t("header.update.checking");
            case "available":
                if (updateStore.latestVersion) {
                    return t("header.update.availableWithVersion").replace(
                        "{version}",
                        updateStore.latestVersion,
                    );
                }
                return t("header.update.available");
            case "downloading":
                return t("header.update.downloading").replace(
                    "{progress}",
                    String(updateProgress),
                );
            case "downloaded":
                return t("header.update.downloaded");
            case "installing":
                return t("header.update.installing");
            case "error":
                if (updateStore.error) {
                    return t("header.update.error").replace(
                        "{message}",
                        updateStore.error,
                    );
                }
                return t("header.update.errorUnknown");
            default:
                return null;
        }
    }
</script>

<header class="header">
    <div class="header-left" data-tauri-drag-region>
        {#if appState.selectedPlatform}
            <img
                src={appState.selectedPlatform.icon}
                alt={appState.selectedPlatform.name}
                class="platform-icon"
                onerror={(e) => {
                    const target = e.currentTarget as HTMLImageElement;
                    target.src =
                        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E";
                }}
            />
            <h1 class="platform-name">{appState.selectedPlatform.name}</h1>
        {:else if appState.currentView === "translation"}
            <h1 class="platform-name">{t("header.translationTitle")}</h1>
        {:else if appState.currentView === "settings"}
            <h1 class="platform-name">{t("header.settingsTitle")}</h1>
        {:else}
            <h1 class="app-title">{t("app.name")}</h1>
        {/if}
    </div>

    <div class="header-right">
        <button
            class="text-btn"
            type="button"
            aria-label={t("header.update.actions.check")}
            title={t("header.update.actions.check")}
            onclick={() => void handleManualCheck()}
            disabled={
                updateStore.status === "checking" ||
                updateStore.status === "downloading" ||
                updateStore.status === "installing"
            }
        >
            {t("header.update.actions.check")}
        </button>
        <button
            class="icon-btn hover-close"
            onclick={() => void handleClose()}
            type="button"
            aria-label={t("header.close")}
            title={t("header.close")}
        >
            <X size={16} />
        </button>
    </div>
</header>

{#if showUpdateBanner}
    <div class="update-banner" role="status" aria-live="polite">
        <div class="update-message">{updateMessage}</div>

        {#if updateStore.status === "available"}
            <div class="update-actions">
                <button
                    class="update-action-btn primary"
                    type="button"
                    onclick={() => void handleDownloadUpdate()}
                >
                    {t("header.update.actions.download")}
                </button>
            </div>
        {:else if updateStore.status === "downloading"}
            <div class="update-actions">
                <button
                    class="update-action-btn ghost"
                    type="button"
                    onclick={() => void handleCancelDownload()}
                >
                    {t("header.update.actions.cancel")}
                </button>
            </div>
        {:else if updateStore.status === "downloaded"}
            <div class="update-actions">
                <button
                    class="update-action-btn primary"
                    type="button"
                    onclick={() => void handleRestartAndInstall()}
                >
                    {t("header.update.actions.restart")}
                </button>
                <button
                    class="update-action-btn ghost"
                    type="button"
                    onclick={handleDismissUpdate}
                >
                    {t("header.update.actions.later")}
                </button>
            </div>
        {:else if updateStore.status === "error"}
            <div class="update-actions">
                <button
                    class="update-action-btn primary"
                    type="button"
                    onclick={() => void updateStore.checkForUpdates(true)}
                >
                    {t("header.update.actions.retry")}
                </button>
            </div>
        {/if}
    </div>
{/if}

<style>
    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 44px;
        padding: 0 0.75rem;
        background-color: var(--bg-primary);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex: 1;
        min-width: 0;
        -webkit-app-region: drag;
    }

    .platform-icon {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .platform-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .app-title {
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
        background: linear-gradient(
            135deg,
            var(--accent-color) 0%,
            #8b5cf6 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
        -webkit-app-region: no-drag;
    }

    .text-btn {
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-size: 0.75rem;
        padding: 0.125rem 0.5rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        -webkit-app-region: no-drag !important;
    }

    .text-btn:hover {
        color: var(--text-primary);
        background-color: var(--bg-secondary);
    }

    .text-btn:disabled {
        opacity: 0.5;
        cursor: default;
        color: var(--text-secondary);
        background: transparent;
    }

    .icon-btn {
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        border-radius: 0.25rem;
        transition: all 0.15s ease;
        padding: 0;
        -webkit-app-region: no-drag !important;
        position: relative;
        z-index: 10;
    }

    .icon-btn:hover {
        color: var(--text-primary);
        background-color: var(--bg-secondary);
    }

    .icon-btn:active {
        transform: scale(0.92);
    }

    .hover-close:hover {
        background-color: #ef4444 !important;
        color: white !important;
    }

    .update-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
    }

    .update-message {
        flex: 1;
        min-width: 0;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-primary);
        word-break: break-word;
    }

    .update-actions {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
    }

    .update-action-btn {
        border: none;
        border-radius: 0.375rem;
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        -webkit-app-region: no-drag !important;
    }

    .update-action-btn.primary {
        background: var(--accent-color);
        color: #fff;
    }

    .update-action-btn.primary:hover {
        filter: brightness(1.05);
    }

    .update-action-btn.ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
    }

    .update-action-btn.ghost:hover {
        color: var(--text-primary);
        border-color: var(--text-secondary);
    }

    .update-action-btn:disabled {
        opacity: 0.6;
        cursor: default;
    }
</style>
