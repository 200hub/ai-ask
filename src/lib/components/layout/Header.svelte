<script lang="ts">
    /**
     * 顶部导航栏组件
     */
    import { X } from "lucide-svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

    const appWindow = getCurrentWebviewWindow();

    function dispatchHideWebviews() {
        window.dispatchEvent(new CustomEvent("hideAllWebviews"));
    }

    function notifySuspendWebviewTop() {
        window.dispatchEvent(new CustomEvent("suspendWebviewTop"));
    }

    function notifyResumeWebviewTop() {
        window.dispatchEvent(new CustomEvent("resumeWebviewTop"));
    }

    /**
     * 关闭窗口（实际是隐藏到托盘）
     */
    async function handleClose() {
        dispatchHideWebviews();
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
            <h1 class="platform-name">翻译</h1>
        {:else if appState.currentView === "settings"}
            <h1 class="platform-name">设置</h1>
        {:else}
            <h1 class="app-title">AI Ask</h1>
        {/if}
    </div>

    <div
        class="header-right"
        onpointerenter={notifySuspendWebviewTop}
        onpointerleave={notifyResumeWebviewTop}
    >
        <button
            class="icon-btn hover-close"
            onclick={handleClose}
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
</style>
