<script lang="ts">
    /**
     * 头部栏组件
     */
    import { X } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import UpdateBanner from "$lib/components/common/UpdateBanner.svelte";
    import type { ReleaseAsset } from "$lib/types/update";
    import {
        checkUpdate,
        downloadUpdate,
        getDownloadStatus,
        onUpdateAvailable,
        onUpdateDownloaded,
        installUpdateNow,
        selectAssetForUserAgent
    } from "$lib/utils/update";
    import { configStore } from "$lib/stores/config.svelte";
    import { i18n } from "$lib/i18n";
    import { logger } from "$lib/utils/logger";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { onDestroy } from "svelte";

    const appWindow = getCurrentWebviewWindow();

    function dispatchHideWebviews() {
        window.dispatchEvent(
            new CustomEvent("hideAllWebviews", {
                detail: { markForRestore: true },
            }),
        );
    }

    /**
     * 关闭按钮（实际执行隐藏）
     */
    async function handleClose() {
        dispatchHideWebviews();
        try {
            await appWindow.hide();
        } catch (error) {
            logger.error("Failed to hide window", error);
        }
    }

    const t = i18n.t;
    let bannerStatus = $state<'hidden' | 'available' | 'downloading' | 'ready' | 'failed'>('hidden');
    let latestVersion = $state<string>('');
    let latestAssets = $state<ReleaseAsset[]>([]);
    let latestReleaseNotes = $state<string>('');
    let latestReleaseUrl = $state<string>('');
    let latestPublishedAt = $state<string>('');
    let lastTaskId = $state<string>('');
    // 防止重复触发自动下载
    let autoDownloadTriggered = $state<boolean>(false);
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const POLL_INTERVAL_MS = 2000;

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function syncUpdateInfoToAppState(version: string) {
        if (!version) {
            appState.clearUpdateInfo();
            return;
        }

        appState.setUpdateInfo({
            version,
            releaseNotes: latestReleaseNotes || null,
            releaseUrl: latestReleaseUrl || null,
            publishedAt: latestPublishedAt || null,
        });
    }

    function applyUpdateMetadata(params: {
        version: string;
        assets?: ReleaseAsset[];
        releaseNotes?: string | null;
        releaseUrl?: string | null;
        publishedAt?: string | null;
    }) {
        latestVersion = params.version;
        if (params.assets) {
            latestAssets = params.assets;
        }
        latestReleaseNotes = params.releaseNotes ?? '';
        latestReleaseUrl = params.releaseUrl ?? '';
        latestPublishedAt = params.publishedAt ?? '';
        syncUpdateInfoToAppState(params.version);
    }

    async function refreshDownloadStatus(taskId: string) {
        const status = await getDownloadStatus(taskId);
        if (!status) {
            return;
        }

        if (status.status === 'completed') {
            stopPolling();
            bannerStatus = 'ready';
            lastTaskId = status.id;
            logger.info("update download completed (poll)", {
                taskId: status.id,
                bytes: status.bytesDownloaded,
            });
            autoDownloadTriggered = false;
            return;
        }

        if (status.status === 'failed') {
            stopPolling();
            bannerStatus = 'failed';
            logger.error("update download failed (poll)", {
                taskId: status.id,
                error: status.error,
            });
            autoDownloadTriggered = false;
            return;
        }

        if (status.status === 'running') {
            if (bannerStatus !== 'downloading') {
                bannerStatus = 'downloading';
            }
            if (status.bytesDownloaded && status.bytesTotal) {
                logger.debug("update download progress", {
                    taskId: status.id,
                    downloaded: status.bytesDownloaded,
                    total: status.bytesTotal,
                });
            }
        }
    }

    function startPolling(taskId: string) {
        stopPolling();
        pollTimer = setInterval(() => {
            void refreshDownloadStatus(taskId);
        }, POLL_INTERVAL_MS);
        void refreshDownloadStatus(taskId);
    }

    onDestroy(() => {
        stopPolling();
    });

    // 统一处理手动/自动下载流程，方便记录日志与轮询
    async function triggerDownload(asset: ReleaseAsset | null, source: "manual" | "auto") {
        if (!asset) {
            bannerStatus = 'failed';
            logger.warn("update download skipped: no matching asset", {
                version: latestVersion,
                source,
            });
            if (source === "auto") {
                autoDownloadTriggered = false;
            }
            return;
        }

        logger.info("update download requested", {
            version: latestVersion,
            asset: asset.name,
            source,
        });

        bannerStatus = 'downloading';

        const task = await downloadUpdate(latestVersion, String(asset.id));
        if (!task) {
            logger.error("update download invocation failed", {
                version: latestVersion,
                asset: asset.name,
                source,
            });
            bannerStatus = 'failed';
            if (source === "auto") {
                autoDownloadTriggered = false;
            }
            return;
        }

        lastTaskId = task.id;
        logger.info("update download task started", {
            version: latestVersion,
            taskId: task.id,
            asset: asset.name,
            source,
        });
        startPolling(task.id);
    }

    async function handleDownload() {
        const asset = selectAssetForUserAgent(latestAssets);
        await triggerDownload(asset, "manual");
    }

    async function handleRestart() {
        if (!lastTaskId) {
            logger.warn("install update requested but task id missing");
            return;
        }

        stopPolling();

        // 直接调用后端命令启动安装器并退出应用
        logger.info("install update requested immediately", { taskId: lastTaskId });
        const started = await installUpdateNow(lastTaskId);
        if (!started) {
            bannerStatus = 'failed';
            logger.error("install update command failed", { taskId: lastTaskId });
        }
    }

    if (typeof window !== 'undefined') {
        void (async () => {
            try {
                await onUpdateAvailable(({ version, assets, releaseNotes, releaseUrl, publishedAt }) => {
                    logger.info("update available event received", {
                        version,
                        assetCount: assets?.length ?? 0,
                    });
                    applyUpdateMetadata({
                        version: version as string,
                        assets: assets as unknown as ReleaseAsset[],
                        releaseNotes: releaseNotes ?? null,
                        releaseUrl: releaseUrl ?? null,
                        publishedAt: publishedAt ?? null,
                    });
                    if (configStore.config.autoUpdateEnabled && !autoDownloadTriggered) {
                        autoDownloadTriggered = true;
                        const asset = selectAssetForUserAgent(latestAssets);
                        logger.info("auto update enabled - triggering download from frontend", {
                            version,
                            assetName: asset?.name ?? "unknown",
                        });
                        void triggerDownload(asset, "auto");
                    } else {
                        bannerStatus = 'available';
                    }
                });
                await onUpdateDownloaded(({ version, taskId }) => {
                    stopPolling();
                    logger.info("update downloaded event received", { version, taskId });
                    latestVersion = version as string;
                    lastTaskId = taskId as string;
                    bannerStatus = 'ready';
                    autoDownloadTriggered = false;
                    syncUpdateInfoToAppState(latestVersion);
                });
                const info = await checkUpdate();
                if (info?.hasUpdate) {
                    const resolvedVersion = (info.latestVersion as string) ?? '';
                    applyUpdateMetadata({
                        version: resolvedVersion,
                        assets: (info.assets ?? []) as ReleaseAsset[],
                        releaseNotes: info.releaseNotes ?? null,
                        releaseUrl: info.releaseUrl ?? null,
                        publishedAt: info.publishedAt ?? null,
                    });
                    if (!latestAssets.length) {
                        logger.warn("update detected but assets list is empty", info);
                    } else {
                        logger.info("update check found release", {
                            version: resolvedVersion,
                            assetCount: latestAssets.length,
                        });
                    }
                    if (configStore.config.autoUpdateEnabled && !autoDownloadTriggered) {
                        autoDownloadTriggered = true;
                        const asset = selectAssetForUserAgent(latestAssets);
                        logger.info(
                            "auto update enabled after manual check - triggering download",
                            {
                                version: resolvedVersion,
                                assetName: asset?.name ?? "unknown",
                            },
                        );
                        void triggerDownload(asset, "auto");
                    } else {
                        bannerStatus = 'available';
                    }
                } else {
                    logger.info("update check completed with no newer version");
                    bannerStatus = 'hidden';
                    latestVersion = '';
                    latestAssets = [];
                    latestReleaseNotes = '';
                    latestReleaseUrl = '';
                    latestPublishedAt = '';
                    appState.clearUpdateInfo();
                }
            } catch (error) {
                logger.warn("register update listeners failed", error);
            }
        })();
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
            <h1 class="platform-name">{t("sidebar.translation")}</h1>
        {:else if appState.currentView === "settings"}
            <h1 class="platform-name">{t("settings.title")}</h1>
        {:else}
            <h1 class="app-title">{t("app.name")}</h1>
        {/if}
    </div>

    <div class="header-right">
        {#if bannerStatus !== 'hidden'}
            <UpdateBanner
                status={bannerStatus === 'available' ? 'available' : bannerStatus === 'downloading' ? 'downloading' : bannerStatus === 'ready' ? 'ready' : 'failed'}
                version={latestVersion}
                releaseNotes={latestReleaseNotes}
                releaseUrl={latestReleaseUrl}
                onDownload={bannerStatus === 'available' || bannerStatus === 'failed' ? handleDownload : null}
                onRestart={bannerStatus === 'ready' ? handleRestart : null}
            />
        {/if}
        <button
            class="icon-btn hover-close"
            onclick={handleClose}
            type="button"
            aria-label={t("header.close")}
        >
            <X size={16} />
        </button>
    </div>
</header>

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
        /* Enable window dragging only on left side */
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
        gap: 0.4rem;
        flex-shrink: 0;
        /* Disable drag for button area - CRITICAL */
        -webkit-app-region: no-drag;
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
        /* Force no-drag on buttons - CRITICAL */
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

</style>
