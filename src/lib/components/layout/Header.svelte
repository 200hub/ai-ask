<script lang="ts">
    /**
     * 顶部导航栏组件 - 完全重写，确保按钮可点击
     */
    import { RefreshCw, X, Minimize2, ExternalLink } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { open } from "@tauri-apps/plugin-shell";

    const appWindow = getCurrentWebviewWindow();

    /**
     * 刷新当前WebView内容
     */
    function handleRefresh() {
        console.log("Refresh clicked");
        if (appState.selectedPlatform) {
            const refreshEvent = new CustomEvent("refreshWebview", {
                detail: { platformId: appState.selectedPlatform.id },
            });
            window.dispatchEvent(refreshEvent);
        }
    }

    /**
     * 在浏览器中打开
     */
    async function handleOpenInBrowser() {
        console.log("Open in browser clicked");
        if (appState.selectedPlatform) {
            try {
                await open(appState.selectedPlatform.url);
            } catch (error) {
                console.error("Failed to open in browser:", error);
            }
        }
    }

    /**
     * 最小化到托盘
     */
    async function handleMinimize() {
        console.log("Minimize clicked");
        try {
            await appWindow.hide();
        } catch (error) {
            console.error("Failed to minimize window:", error);
        }
    }

    /**
     * 关闭窗口（实际是隐藏到托盘）
     */
    async function handleClose() {
        console.log("Close clicked");
        try {
            await appWindow.hide();
        } catch (error) {
            console.error("Failed to hide window:", error);
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
            <div class="title-wrapper">
                <svg
                    class="title-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                    />
                </svg>
                <h1 class="platform-name">翻译</h1>
            </div>
        {:else if appState.currentView === "settings"}
            <div class="title-wrapper">
                <svg
                    class="title-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                </svg>
                <h1 class="platform-name">设置</h1>
            </div>
        {:else}
            <h1 class="app-title">AI Ask</h1>
        {/if}
    </div>

    <div class="header-right">
        {#if appState.selectedPlatform}
            <button
                class="icon-btn tooltip"
                onclick={handleRefresh}
                data-tooltip="刷新"
                type="button"
                aria-label="刷新"
            >
                <RefreshCw size={16} />
            </button>

            <button
                class="icon-btn tooltip"
                onclick={handleOpenInBrowser}
                data-tooltip="在浏览器中打开"
                type="button"
                aria-label="在浏览器中打开"
            >
                <ExternalLink size={16} />
            </button>
        {/if}

        <button
            class="icon-btn tooltip"
            onclick={handleMinimize}
            data-tooltip="最小化"
            type="button"
            aria-label="最小化"
        >
            <Minimize2 size={16} />
        </button>

        <button
            class="icon-btn tooltip hover-close"
            onclick={handleClose}
            data-tooltip="关闭"
            type="button"
            aria-label="关闭"
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

    .title-wrapper {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .title-icon {
        width: 1.25rem;
        height: 1.25rem;
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
        gap: 0.125rem;
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

    /* Tooltip styles */
    .tooltip {
        position: relative;
    }

    .tooltip::before {
        content: attr(data-tooltip);
        position: absolute;
        bottom: -1.875rem;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.3rem 0.625rem;
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
        font-size: 0.6875rem;
        white-space: nowrap;
        border-radius: 0.25rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 1000;
        border: 1px solid var(--border-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .tooltip:hover::before {
        opacity: 1;
    }
</style>
