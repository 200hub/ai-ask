<script lang="ts">
    import type { SettingsTab } from "$lib/types/config";
    import GeneralSettings from "./GeneralSettings.svelte";
    import PlatformSettings from "./PlatformSettings.svelte";
    import ProxySettings from "./ProxySettings.svelte";
    import TranslationSettings from "./TranslationSettings.svelte";
    import AboutSettings from "./AboutSettings.svelte";
    import { i18n } from "$lib/i18n";

    const t = i18n.t;

    let currentTab = $state<SettingsTab>("general");

    const tabs: Array<{
        id: SettingsTab;
        labelKey: string;
        descriptionKey: string;
        icon: string;
    }> = [
        { id: "general", labelKey: "settings.general", descriptionKey: "general.title", icon: "⚙️" },
        { id: "platforms", labelKey: "settings.platforms", descriptionKey: "platforms.title", icon: "🤖" },
        { id: "proxy", labelKey: "settings.proxy", descriptionKey: "proxy.title", icon: "🌐" },
        { id: "translation", labelKey: "settings.translation", descriptionKey: "translationSettings.title", icon: "🌍" },
        { id: "about", labelKey: "settings.about", descriptionKey: "about.title", icon: "ℹ️" },
    ];

    function switchTab(tabId: SettingsTab) {
        currentTab = tabId;
    }
</script>

<div class="settings-page">
    <div class="settings-layout">
        <aside class="settings-sidebar">
                <div class="sidebar-header">
                    <p class="sidebar-eyebrow">{t("app.name")}</p>
                    <h2 class="sidebar-title">{t("settings.title")}</h2>
                    <p class="sidebar-description">{t("app.description")}</p>
                </div>

                <nav class="sidebar-nav" aria-label={t("settings.title")}>
                    {#each tabs as tab (tab.id)}
                        <button
                            type="button"
                            class="sidebar-tab"
                            class:active={currentTab === tab.id}
                            onclick={() => switchTab(tab.id)}
                            aria-current={currentTab === tab.id ? "page" : undefined}
                        >
                            <span class="tab-icon">{tab.icon}</span>
                            <span class="tab-text">
                                <span class="tab-label">{t(tab.labelKey)}</span>
                                <span class="tab-subtitle">{t(tab.descriptionKey)}</span>
                            </span>
                        </button>
                    {/each}
                </nav>
        </aside>

        <section class="settings-main">
            {#if currentTab === "general"}
                <GeneralSettings />
            {:else if currentTab === "platforms"}
                <PlatformSettings />
            {:else if currentTab === "proxy"}
                <ProxySettings />
            {:else if currentTab === "translation"}
                <TranslationSettings />
            {:else if currentTab === "about"}
                <AboutSettings />
            {/if}
        </section>
    </div>
</div>

<style>
    .settings-page {
        --settings-max-width: 1080px;
        --settings-sidebar-width: 280px;
        --settings-page-padding: 24px;
        --settings-content-gap: 32px;
        width: 100%;
        height: 100%;
        padding: clamp(1rem, 3vw, var(--settings-page-padding));
        background: var(--bg-primary);
        box-sizing: border-box;
        display: flex;
    }

    .settings-layout {
        width: 100%;
        max-width: var(--settings-max-width);
        margin: 0 auto;
        display: flex;
        gap: clamp(1rem, 3vw, var(--settings-content-gap));
    }

    .settings-sidebar {
        width: min(var(--settings-sidebar-width), 100%);
        padding: 2rem 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        background: linear-gradient(
            160deg,
            color-mix(in srgb, var(--accent-color) 25%, transparent) 0%,
            color-mix(in srgb, var(--bg-secondary) 85%, transparent) 100%
        );
        position: sticky;
        top: clamp(1rem, 3vw, var(--settings-page-padding));
        align-self: flex-start;
        border-radius: 1.25rem;
        box-shadow: var(--shadow-md);
        max-height: calc(100vh - clamp(2rem, 4vw, 4rem));
    }

    .sidebar-header {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .sidebar-eyebrow {
        margin: 0;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-secondary);
    }

    .sidebar-title {
        margin: 0;
        font-size: 1.6rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .sidebar-description {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: 1.4;
    }

    .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        flex: 1;
        overflow-y: auto;
        padding-right: 0.25rem;
    }

    .sidebar-nav::-webkit-scrollbar {
        width: 6px;
    }

    .sidebar-nav::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--text-secondary) 40%, transparent);
        border-radius: 999px;
    }

    .sidebar-nav::-webkit-scrollbar-track {
        background: transparent;
    }

    .sidebar-tab {
        display: flex;
        gap: 0.8rem;
        padding: 0.9rem 1rem;
        border-radius: 1rem;
        border: 1px solid transparent;
        background: color-mix(in srgb, var(--bg-primary) 65%, transparent);
        cursor: pointer;
        text-align: left;
        transition: all 0.2s ease;
        color: var(--text-primary);
    }

    .sidebar-tab:hover {
        border-color: color-mix(in srgb, var(--accent-color) 40%, transparent);
        box-shadow: var(--shadow-sm);
    }

    .sidebar-tab.active {
        border-color: color-mix(in srgb, var(--accent-color) 70%, transparent);
        background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-primary));
        box-shadow: 0 10px 40px rgba(15, 23, 42, 0.15);
    }

    .tab-icon {
        font-size: 1.25rem;
        line-height: 1;
    }

    .tab-text {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .tab-label {
        font-weight: 600;
        font-size: 0.95rem;
    }

    .tab-subtitle {
        font-size: 0.8rem;
        color: var(--text-secondary);
    }

    .settings-main {
        flex: 1;
        padding: var(--settings-content-gap);
        display: flex;
        flex-direction: column;
        gap: var(--settings-content-gap);
        background: transparent;
        overflow-y: auto;
    }

    .settings-main::-webkit-scrollbar {
        width: 8px;
    }

    .settings-main::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
        border-radius: 999px;
    }

    .settings-main::-webkit-scrollbar-track {
        background: transparent;
    }

    @media (max-width: 1024px) {
        .settings-layout {
            flex-direction: column;
        }

        .settings-sidebar {
            width: 100%;
            padding: 1.5rem;
            position: static;
            max-height: none;
        }

        .sidebar-nav {
            flex-direction: row;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .sidebar-tab {
            flex: 1 1 calc(50% - 0.5rem);
        }
    }

    @media (max-width: 768px) {
        .settings-main {
            padding: clamp(1rem, 5vw, var(--settings-content-gap));
        }
    }
</style>
