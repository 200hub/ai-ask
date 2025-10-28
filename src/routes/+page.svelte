<script lang="ts">
    /**
     * AI Ask 主页面
     */
    import { onMount } from "svelte";
    import Header from "$lib/components/layout/Header.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";
    import MainContent from "$lib/components/layout/MainContent.svelte";
    import { appState } from "$lib/stores/app.svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import "$lib/styles/base.css";

    onMount(async () => {
        // 初始化所有 stores
        await configStore.init();
        await platformsStore.init();
        await translationStore.init();

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
