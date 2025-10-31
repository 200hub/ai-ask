<script lang="ts">
    /**
     * 通用设置标签页
     */
    import { configStore } from "$lib/stores/config.svelte";
    import {
        AVAILABLE_SHORTCUTS,
        TRANSLATION_SHORTCUTS,
    } from "$lib/utils/constants";
    import { i18n, SUPPORTED_LOCALES, type Locale } from "$lib/i18n";

    const t = i18n.t;

    let isSaving = $state(false);
    let currentLocale = $state<Locale>(i18n.locale.get());

    /**
     * 主题选项
     */
    const themeOptions = [
        { value: "system", labelKey: "general.themeSystem", icon: "🌓" },
        { value: "light", labelKey: "general.themeLight", icon: "☀️" },
        { value: "dark", labelKey: "general.themeDark", icon: "🌙" },
    ] as const;

    /**
     * 切换主题
     */
    async function handleThemeChange(theme: "system" | "light" | "dark") {
        isSaving = true;
        try {
            await configStore.setTheme(theme);
        } catch (error) {
            console.error("Failed to change theme:", error);
        } finally {
            isSaving = false;
        }
    }

    /**
     * 更新全局快捷键
     */
    async function handleHotkeyChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const hotkey = target.value;

        try {
            await configStore.setGlobalHotkey(hotkey);
            // TODO: 重新注册全局快捷键
        } catch (error) {
            console.error("Failed to change hotkey:", error);
        }
    }

    /**
     * 更新翻译快捷键
     */
    async function handleTranslationHotkeyChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const hotkey = target.value;

        try {
            await configStore.setTranslationHotkey(hotkey);
            // TODO: 重新注册翻译快捷键
        } catch (error) {
            console.error("Failed to change translation hotkey:", error);
        }
    }

    /**
     * 切换自动启动
     */
    async function handleAutoStartChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const autoStart = target.checked;

        try {
            await configStore.setAutoStart(autoStart);
            // TODO: 配置系统自动启动
        } catch (error) {
            console.error("Failed to change auto start:", error);
        }
    }

    /**
     * 格式化快捷键显示
     */
    function formatHotkey(hotkey: string): string {
        return hotkey
            .replace("CommandOrControl", "Ctrl/Cmd")
            .replace("Alt", "Alt")
            .replace("Shift", "Shift")
            .replace("+", " + ");
    }

    /**
     * 切换语言
     */
    async function handleLocaleChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const locale = target.value as Locale;

        try {
            i18n.locale.set(locale);
            currentLocale = locale;
            // 保存到配置
            await configStore.updateConfig({ locale });
        } catch (error) {
            console.error("Failed to change locale:", error);
        }
    }

    /**
     * 清理缓存（占位功能，子 webview 模式下暂无实际操作）
     */
    function handleClearCache() {
        if (window.confirm(t("general.clearCacheConfirm"))) {
            window.alert(t("general.clearCacheSuccess"));
        }
    }
</script>

<div class="settings-section">
    <!-- 语言设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.languageTitle")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.interfaceLanguage")}</span>
                <span class="label-description">
                    {t("general.interfaceLanguageDescription")}
                </span>
            </div>
            <select
                class="setting-select"
                value={currentLocale}
                onchange={handleLocaleChange}
            >
                {#each SUPPORTED_LOCALES as locale}
                    <option value={locale.code}>{locale.nativeName}</option>
                {/each}
            </select>
        </div>
    </div>

    <!-- 主题设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.appearance")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.theme")}</span>
                <span class="label-description">{t("general.themeDescription")}</span>
            </div>
            <div class="theme-options">
                {#each themeOptions as option}
                    <button
                        class="theme-option"
                        class:active={configStore.config.theme === option.value}
                        onclick={() => handleThemeChange(option.value)}
                        disabled={isSaving}
                    >
                        <span class="theme-icon">{option.icon}</span>
                        <span class="theme-label">{t(option.labelKey)}</span>
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- 快捷键设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.shortcuts")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.globalHotkey")}</span>
                <span class="label-description">{t("general.globalHotkeyDescription")}</span>
            </div>
            <select
                class="setting-select"
                value={configStore.config.globalHotkey}
                onchange={handleHotkeyChange}
            >
                {#each AVAILABLE_SHORTCUTS as shortcut}
                    <option value={shortcut}>{formatHotkey(shortcut)}</option>
                {/each}
            </select>
        </div>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.translationHotkey")}</span>
                <span class="label-description">
                    {t("general.translationHotkeyDescription")}
                </span>
            </div>
            <select
                class="setting-select"
                value={configStore.config.translationHotkey}
                onchange={handleTranslationHotkeyChange}
            >
                {#each TRANSLATION_SHORTCUTS as shortcut}
                    <option value={shortcut}>{formatHotkey(shortcut)}</option>
                {/each}
            </select>
        </div>
    </div>

    <!-- 启动设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.startup")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.autoStart")}</span>
                <span class="label-description">{t("general.autoStartDescription")}</span>
            </div>
            <label class="toggle-switch">
                <input
                    type="checkbox"
                    checked={configStore.config.autoStart}
                    onchange={handleAutoStartChange}
                />
                <span class="toggle-slider"></span>
            </label>
        </div>
    </div>

    <!-- 缓存管理 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.cacheManagement")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.clearCache")}</span>
                <span class="label-description">
                    {t("general.clearCacheDescription")}
                </span>
            </div>
            <button class="btn-clear-cache" onclick={handleClearCache}>
                {t("general.clearCache")}
            </button>
        </div>
    </div>

    <!-- 提示信息 -->
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
            <p>{t("general.infoTip1")}</p>
            <p>{t("general.infoTip2")}</p>
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

    .group-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.75rem 0;
        padding-bottom: 0.375rem;
        border-bottom: 1px solid var(--border-color);
    }

    .setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        background-color: var(--bg-secondary);
        border-radius: 0.375rem;
        margin-bottom: 0.625rem;
        gap: 1rem;
    }

    .setting-label {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .label-text {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .label-description {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .theme-options {
        display: flex;
        gap: 0.5rem;
    }

    .theme-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
        padding: 0.625rem 0.875rem;
        background-color: var(--bg-primary);
        border: 2px solid var(--border-color);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 80px;
    }

    .theme-option:hover:not(:disabled) {
        border-color: var(--accent-color);
        transform: translateY(-2px);
    }

    .theme-option.active {
        border-color: var(--accent-color);
        background-color: var(--accent-color);
        color: white;
    }

    .theme-option:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .theme-icon {
        font-size: 1.5rem;
    }

    .theme-label {
        font-size: 0.8125rem;
        font-weight: 500;
    }

    .setting-select {
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        color: var(--text-primary);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 180px;
    }

    .setting-select:hover {
        border-color: var(--accent-color);
    }

    .setting-select:focus {
        outline: none;
        border-color: var(--accent-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .toggle-switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 24px;
        cursor: pointer;
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
        gap: 0.75rem;
        padding: 0.875rem;
        background-color: var(--bg-secondary);
        border-left: 3px solid var(--accent-color);
        border-radius: 0.375rem;
        margin-top: 1rem;
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
        color: var(--text-secondary);
        margin: 0 0 0.5rem 0;
        line-height: 1.5;
    }

    .info-text p:last-child {
        margin-bottom: 0;
    }

    /* 响应式设计 */
    @media (max-width: 768px) {
        .setting-item {
            flex-direction: column;
            align-items: flex-start;
        }

        .theme-options {
            width: 100%;
            justify-content: space-between;
        }

        .theme-option {
            flex: 1;
            min-width: unset;
        }

        .setting-select {
            width: 100%;
        }
    }

    .btn-clear-cache {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .btn-clear-cache:hover {
        background-color: var(--bg-tertiary);
        border-color: var(--accent-color);
    }

    .btn-clear-cache:active {
        transform: scale(0.98);
    }
</style>
