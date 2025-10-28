<script lang="ts">
    /**
     * 翻译设置标签页
     */
    import { translationStore } from "$lib/stores/translation.svelte";
    import { configStore } from "$lib/stores/config.svelte";

    /**
     * 切换翻译平台启用状态
     */
    async function togglePlatform(id: string) {
        try {
            await translationStore.togglePlatform(id);
        } catch (error) {
            console.error("Failed to toggle translation platform:", error);
        }
    }

    /**
     * 设置为默认翻译平台
     */
    async function setAsDefault(id: string) {
        try {
            translationStore.setCurrentPlatform(id);
            await configStore.setCurrentTranslator(id);
        } catch (error) {
            console.error("Failed to set default translator:", error);
        }
    }
</script>

<div class="settings-section">
    <!-- 翻译平台列表 -->
    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">翻译平台</h3>
            <p class="group-description">启用或禁用翻译服务平台</p>
        </div>

        <div class="platform-list">
            {#each translationStore.platforms as platform (platform.id)}
                <div class="platform-item">
                    <div class="platform-info">
                        <img
                            src={platform.icon}
                            alt={platform.name}
                            class="platform-icon"
                            onerror={(e) =>
                                (e.currentTarget.src =
                                    "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%222%22 d=%22M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129%22/%3E%3C/svg%3E")}
                        />
                        <div class="platform-details">
                            <div class="platform-name-row">
                                <span class="platform-name"
                                    >{platform.name}</span
                                >
                                {#if translationStore.currentPlatform?.id === platform.id}
                                    <span class="default-badge">默认</span>
                                {/if}
                            </div>
                            <span class="platform-url">{platform.url}</span>
                            {#if platform.supportLanguages.length > 0}
                                <span class="languages">
                                    支持语言: {platform.supportLanguages
                                        .slice(0, 4)
                                        .join(", ")}
                                    {#if platform.supportLanguages.length > 4}
                                        等 {platform.supportLanguages.length} 种
                                    {/if}
                                </span>
                            {/if}
                        </div>
                    </div>

                    <div class="platform-actions">
                        {#if platform.enabled && translationStore.currentPlatform?.id !== platform.id}
                            <button
                                class="set-default-btn"
                                onclick={() => setAsDefault(platform.id)}
                            >
                                设为默认
                            </button>
                        {/if}
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
        </div>
    </div>

    <!-- 使用说明 -->
    <div class="info-box">
        <svg
            class="info-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        </svg>
        <div class="info-text">
            <p><strong>使用提示：</strong></p>
            <ul>
                <li>这些翻译平台都是免费且无需登录的</li>
                <li>点击左侧边栏的翻译图标即可使用翻译功能</li>
                <li>在翻译页面可以快速切换不同的翻译平台</li>
                <li>设置默认翻译平台后，打开翻译功能时会自动使用该平台</li>
            </ul>
        </div>
    </div>
</div>

<style>
    .settings-section {
        width: 100%;
        max-width: none;
    }

    .setting-group {
        margin-bottom: 1.25rem;
    }

    .group-header {
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }

    .group-title {
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.25rem 0;
    }

    .group-description {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        margin: 0;
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
        padding: 0.75rem;
        background-color: var(--bg-secondary);
        border-radius: 0.375rem;
        gap: 0.75rem;
        transition: all 0.2s ease;
    }

    .platform-item:hover {
        background-color: var(--bg-tertiary);
    }

    .platform-info {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        flex: 1;
        min-width: 0;
    }

    .platform-icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .platform-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
        flex: 1;
    }

    .platform-name-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .platform-name {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .default-badge {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: white;
        background-color: var(--accent-color);
        border-radius: 9999px;
    }

    .platform-url {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

    .set-default-btn {
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--accent-color);
        background-color: transparent;
        border: 1px solid var(--accent-color);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
    }

    .set-default-btn:hover {
        background-color: var(--accent-color);
        color: white;
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
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
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
        margin-top: 2rem;
    }

    .info-icon {
        width: 24px;
        height: 24px;
        color: var(--accent-color);
        flex-shrink: 0;
    }

    .info-text {
        flex: 1;
    }

    .info-text p {
        font-size: 0.875rem;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
    }

    .info-text ul {
        margin: 0;
        padding-left: 1.25rem;
    }

    .info-text li {
        font-size: 0.875rem;
        color: var(--text-secondary);
        line-height: 1.6;
        margin-bottom: 0.25rem;
    }

    .info-text li:last-child {
        margin-bottom: 0;
    }

    /* 响应式设计 */
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
