<script lang="ts">
    /**
     * Translation provider settings panel.
     */
    import { onMount } from "svelte";
    import { translationStore } from "$lib/stores/translation.svelte";
    import { i18n } from "$lib/i18n";
    import type { TranslationPlatform } from "$lib/types/platform";

    const t = i18n.t;

    function translate(key: string, params?: Record<string, string>) {
        let value = t(key);
        if (params) {
            for (const [paramKey, paramValue] of Object.entries(params)) {
                value = value.replace(`{${paramKey}}`, paramValue);
            }
        }
        return value;
    }

    const FALLBACK_ICON =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129'/%3E%3C/svg%3E";

    onMount(async () => {
        if (translationStore.platforms.length === 0) {
            try {
                await translationStore.init();
            } catch (error) {
                console.error("Failed to load translation platforms:", error);
            }
        }
    });

    function handleIconError(event: Event) {
        const target = event.currentTarget as HTMLImageElement | null;
        if (target && target.src !== FALLBACK_ICON) {
            target.src = FALLBACK_ICON;
        }
    }

    function formatPlatformNames(platforms: TranslationPlatform[]): string {
        if (platforms.length === 0) {
            return "";
        }

        const locale = i18n.locale.get();
        if (typeof Intl !== "undefined" && typeof Intl.ListFormat === "function") {
            try {
                const formatter = new Intl.ListFormat(locale, {
                    style: "long",
                    type: "conjunction",
                });
                return formatter.format(platforms.map((platform) => platform.name));
            } catch (error) {
                console.error("Failed to format translator list:", error);
            }
        }

        return platforms.map((platform) => platform.name).join(", ");
    }

    async function togglePlatform(id: string) {
        try {
            await translationStore.togglePlatform(id);
        } catch (error) {
            console.error("Failed to toggle translation platform:", error);
            window.alert(t("translationSettings.toggleError"));
        }
    }
</script>

<div class="settings-section">
    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">{t("translationSettings.providersTitle")}</h3>
            <p class="group-description">
                {t("translationSettings.providersDescription")}
            </p>
            <div class="enabled-summary">
                <span class="enabled-label">{t("translationSettings.enabledListTitle")}</span>
                {#if translationStore.enabledPlatforms.length > 0}
                    <span class="enabled-names">
                        {formatPlatformNames(translationStore.enabledPlatforms)}
                    </span>
                {:else}
                    <span class="enabled-empty">{t("translationSettings.enabledListEmpty")}</span>
                {/if}
            </div>
        </div>

        <div class="platform-list">
            {#if translationStore.platforms.length === 0}
                <p class="empty-message">{t("translation.noPlatforms")}</p>
            {:else}
                {#each translationStore.platforms as platform (platform.id)}
                    <div class="platform-item">
                        <div class="platform-info">
                            <img
                                src={platform.icon || FALLBACK_ICON}
                                alt={platform.name}
                                class="platform-icon"
                                onerror={handleIconError}
                            />
                            <div class="platform-details">
                                <div class="platform-name-row">
                                    <span class="platform-name">{platform.name}</span>
                                </div>
                                <span class="platform-url">{platform.url}</span>
                                {#if platform.supportLanguages && platform.supportLanguages.length > 0}
                                    <span class="languages">
                                        {translate("translationSettings.supportedLanguages", {
                                            languages: platform.supportLanguages.slice(0, 4).join(", "),
                                        })}
                                        {#if platform.supportLanguages.length > 4}
                                            {translate("translationSettings.moreLanguages", {
                                                count: String(platform.supportLanguages.length - 4),
                                            })}
                                        {/if}
                                    </span>
                                {/if}
                            </div>
                        </div>

                        <div class="platform-actions">
                            <label class="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={platform.enabled}
                                    onchange={() => togglePlatform(platform.id)}
                                />
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <div class="info-box">
        <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
        <div class="info-text">
            <p><strong>{t("translationSettings.tipsTitle")}</strong></p>
            <ul>
                <li>{t("translationSettings.tips.item1")}</li>
                <li>{t("translationSettings.tips.item2")}</li>
                <li>{t("translationSettings.tips.item3")}</li>
            </ul>
        </div>
    </div>
</div>

<style>
    .settings-section {
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }

    .setting-group {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        background-color: var(--bg-secondary);
        border-radius: 0.75rem;
        padding: 1.5rem;
        border: 1px solid var(--border-color);
    }

    .group-header {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .group-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .group-description {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-secondary);
    }

    .enabled-summary {
        display: flex;
        gap: 0.5rem;
        align-items: baseline;
        flex-wrap: wrap;
        font-size: 0.85rem;
    }

    .enabled-label {
        font-weight: 500;
        color: var(--text-secondary);
    }

    .enabled-names {
        color: var(--text-primary);
    }

    .enabled-empty {
        color: var(--text-tertiary);
    }

    .platform-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .platform-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        background-color: var(--bg-primary);
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        gap: 1rem;
    }

    .platform-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    .platform-icon {
        width: 40px;
        height: 40px;
        border-radius: 0.5rem;
        object-fit: cover;
        background-color: var(--bg-secondary);
        flex-shrink: 0;
    }

    .platform-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .platform-name-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .platform-name {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .platform-url {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        word-break: break-all;
    }

    .languages {
        font-size: 0.75rem;
        color: var(--text-tertiary);
    }

    .platform-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .toggle-switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 24px;
        cursor: pointer;
        flex-shrink: 0;
    }

    .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .toggle-slider {
        position: absolute;
        inset: 0;
        background-color: var(--border-color);
        border-radius: 24px;
        transition: all 0.3s ease;
    }

    .toggle-slider::before {
        content: "";
        position: absolute;
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        border-radius: 50%;
        transition: all 0.3s ease;
    }

    .toggle-switch input:checked + .toggle-slider {
        background-color: var(--accent-color);
    }

    .toggle-switch input:checked + .toggle-slider::before {
        transform: translateX(24px);
    }

    .info-box {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        background-color: var(--bg-secondary);
        border-left: 3px solid var(--accent-color);
        border-radius: 0.5rem;
    }

    .info-icon {
        width: 24px;
        height: 24px;
        color: var(--accent-color);
        flex-shrink: 0;
    }

    .info-text {
        flex: 1;
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    .info-text p {
        margin: 0 0 0.5rem 0;
        color: var(--text-primary);
    }

    .info-text ul {
        margin: 0;
        padding-left: 1.2rem;
    }

    .info-text li {
        line-height: 1.6;
        margin-bottom: 0.25rem;
    }

    .empty-message {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-secondary);
    }

    @media (max-width: 768px) {
        .platform-item {
            flex-direction: column;
            align-items: flex-start;
        }

        .platform-actions {
            width: 100%;
            justify-content: space-between;
        }
    }
</style>
