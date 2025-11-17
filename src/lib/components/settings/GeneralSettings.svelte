<script lang="ts">
    /**
     * 通用设置标签页
     */
    import { onMount, onDestroy } from "svelte";
    import { configStore } from "$lib/stores/config.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import {
        AVAILABLE_SHORTCUTS,
        TRANSLATION_SHORTCUTS,
        SELECTION_TOOLBAR_SHORTCUTS,
    } from "$lib/utils/constants";
    import { i18n, SUPPORTED_LOCALES, type Locale } from "$lib/i18n";
    import { logger } from "$lib/utils/logger";

    const t = i18n.t;

    let isSaving = $state(false);
    let currentLocale = $state<Locale>(i18n.locale.get());
    
    // 划词工具栏忽略应用输入框的值
    let ignoreInput = $state("");
    
    // 临时禁用倒计时显示文本（格式：剩余 X 分 Y 秒）
    let disableCountdown = $state("");
    
    // 倒计时定时器句柄，用于每秒更新剩余时间
    let countdownTimer: number | null = null;
    
    // 临时禁用功能的恢复时间戳（Unix 毫秒）
    const temporaryDisableUntil = $derived(configStore.config.selectionToolbarTemporaryDisabledUntil);
    
    // 当前是否处于临时禁用状态（恢复时间戳大于当前时间）
    const isTemporaryDisabled = $derived(
        typeof temporaryDisableUntil === "number" && temporaryDisableUntil > Date.now()
    );

    /**
     * 主题选项
     */
    const themeOptions = [
        { value: "system", labelKey: "general.themeSystem", icon: "🌓" },
        { value: "light", labelKey: "general.themeLight", icon: "☀️" },
        { value: "dark", labelKey: "general.themeDark", icon: "🌙" },
    ] as const;

    /**
     * 格式化翻译字符串
     * 
     * 将翻译文本中的占位符（如 {minutes}、{seconds}）替换为实际值
     * 
     * @param key - i18n 翻译键
     * @param params - 占位符参数对象，键为占位符名称，值为替换内容
     * @returns 格式化后的字符串
     */
    function formatTranslation(
        key: string,
        params: Record<string, string | number>,
    ): string {
        let output = t(key);
        for (const [paramKey, paramValue] of Object.entries(params)) {
            output = output.replace(`{${paramKey}}`, String(paramValue));
        }
        return output;
    }

    /**
     * 格式化禁用恢复时间戳为本地化日期时间字符串
     * 
     * @param until - Unix 毫秒时间戳
     * @returns 本地化日期时间字符串，如 "2025/11/12 16:30:00"
     */
    function formatDisableUntil(until: number | null): string {
        if (!until) {
            return "";
        }
        return new Date(until).toLocaleString();
    }

    /**
     * 更新临时禁用倒计时显示
     * 
     * 每秒调用一次，计算并更新剩余时间的显示文本。
     * 当倒计时结束时，自动触发配置刷新以恢复划词工具栏。
     */
    function updateDisableCountdown(): void {
        const until = configStore.config.selectionToolbarTemporaryDisabledUntil;
        if (!until) {
            disableCountdown = "";
            return;
        }

        const remaining = until - Date.now();
        if (remaining <= 0) {
            disableCountdown = "";
            void configStore.refreshSelectionToolbarTemporaryDisableIfExpired();
            return;
        }

        const minutes = Math.floor(remaining / 60000).toString();
        const seconds = Math.floor((remaining % 60000) / 1000)
            .toString()
            .padStart(2, "0");
        disableCountdown = formatTranslation(
            "general.selectionToolbarTemporaryDisabledCountdown",
            {
                minutes,
                seconds,
            },
        );
    }

    onMount(() => {
        // 启动倒计时定时器，每秒更新一次剩余时间显示
        updateDisableCountdown();
        countdownTimer = window.setInterval(updateDisableCountdown, 1000);
    });

    onDestroy(() => {
        // 清理倒计时定时器，避免内存泄漏
        if (countdownTimer !== null) {
            window.clearInterval(countdownTimer);
        }
    });

    // 监听临时禁用配置变化，实时更新倒计时显示
    $effect(() => {
        void configStore.config.selectionToolbarTemporaryDisabledUntil;
        updateDisableCountdown();
    });

    // 监听语言切换，重新格式化倒计时文本
    $effect(() => {
        void currentLocale;
        updateDisableCountdown();
    });

    /**
     * 切换主题
     */
    async function handleThemeChange(theme: "system" | "light" | "dark") {
        isSaving = true;
        try {
            await configStore.setTheme(theme);
        } catch (error) {
            logger.error("Failed to change theme", error);
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
            logger.error("Failed to change hotkey", error);
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
            logger.error("Failed to change translation hotkey", error);
        }
    }

    /**
     * 更新划词工具栏快捷键
     */
    async function handleSelectionToolbarHotkeyChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const hotkey = target.value;

        try {
            await configStore.setSelectionToolbarHotkey(hotkey);
            // TODO: 重新注册划词工具栏快捷键
        } catch (error) {
            logger.error("Failed to change selection toolbar hotkey", error);
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
            logger.error("Failed to change auto start", error);
        }
    }

    /**
     * 切换自动更新
     */
    async function handleAutoUpdateChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const enabled = target.checked;

        try {
            await configStore.setAutoUpdateEnabled(enabled);
        } catch (error) {
            logger.error("Failed to change auto update", error);
        }
    }

    /**
     * 切换划词工具栏
     */
    async function handleSelectionToolbarChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const enabled = target.checked;

        try {
            await configStore.setSelectionToolbarEnabled(enabled);
        } catch (error) {
            logger.error("Failed to change selection toolbar", error);
        }
    }

    /**
     * 添加忽略应用到划词工具栏黑名单
     * 
     * 将输入的应用名称（进程名或窗口类名）添加到忽略列表中。
     * 在这些应用中，划词工具栏不会显示。
     */
    async function handleAddIgnoredApp() {
        const value = ignoreInput.trim();
        if (!value) {
            return;
        }

        const existing = configStore.config.selectionToolbarIgnoredApps;
        if (existing.some((item) => item.toLowerCase() === value.toLowerCase())) {
            ignoreInput = "";
            return;
        }

        try {
            await configStore.setSelectionToolbarIgnoredApps([...existing, value]);
            ignoreInput = "";
        } catch (error) {
            logger.error("Failed to add ignored application", error);
        }
    }

    /**
     * 从忽略列表中移除指定应用
     * 
     * @param app - 要移除的应用名称
     */
    async function handleRemoveIgnoredApp(app: string) {
        const filtered = configStore.config.selectionToolbarIgnoredApps.filter((item) => item !== app);

        try {
            await configStore.setSelectionToolbarIgnoredApps(filtered);
        } catch (error) {
            logger.error("Failed to remove ignored application", error);
        }
    }

    /**
     * 立即恢复划词工具栏（取消临时禁用）
     * 
     * 清除临时禁用的恢复时间戳，使划词工具栏立即恢复正常工作。
     * 注意：临时禁用只能由划词工具栏自身触发，此功能仅用于提前恢复。
     */
    async function handleResumeTemporaryDisable() {
        try {
            await configStore.setSelectionToolbarTemporaryDisabledUntil(null);
        } catch (error) {
            logger.error("Failed to resume selection toolbar", error);
        }
    }

    /**
     * 更新划词默认平台
     */
    async function handleSelectionToolbarDefaultPlatformChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const platformId = target.value || null;

        try {
            await configStore.setSelectionToolbarDefaultPlatformId(platformId);
        } catch (error) {
            logger.error("Failed to change selection toolbar default platform", error);
        }
    }

    /**
     * 切换平台预加载
     */
    async function handlePreloadChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const enabled = target.checked;

        try {
            await configStore.setPreloadDefaultPlatforms(enabled);
        } catch (error) {
            logger.error("Failed to change preload setting", error);
        }
    }

    /**
     * 请求辅助功能权限
     */
    async function handleRequestPermission() {
        try {
            await configStore.requestAccessibilityPermission();
            // 延迟检查，因为用户需要时间去设置
            setTimeout(async () => {
                await configStore.checkAccessibilityPermission();
            }, 1000);
        } catch (error) {
            logger.error("Failed to request accessibility permission", error);
        }
    }

    /**
     * 重新检查权限状态
     */
    async function handleCheckPermission() {
        try {
            const granted = await configStore.checkAccessibilityPermission();
            if (granted) {
                logger.info("Accessibility permission is now granted");
            } else {
                logger.warn("Accessibility permission is still not granted");
            }
        } catch (error) {
            logger.error("Failed to check accessibility permission", error);
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
            await configStore.update({ locale });
        } catch (error) {
            logger.error("Failed to change locale", error);
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
                {#each SUPPORTED_LOCALES as locale (locale.code)}
                    <option value={locale.code}>{locale.nativeName}</option>
                {/each}
            </select>
        </div>
    </div>

    <!-- 划词工具栏设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.selectionToolbar")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.selectionToolbarEnabled")}</span>
                <span class="label-description">{t("general.selectionToolbarDescription")}</span>
            </div>
            <label class="toggle-switch">
                <input 
                    type="checkbox" 
                    checked={configStore.config.selectionToolbarEnabled} 
                    onchange={handleSelectionToolbarChange} 
                />
                <span class="toggle-slider"></span>
            </label>
        </div>

        {#if configStore.config.selectionToolbarEnabled && !configStore.accessibilityPermissionGranted}
            <div class="permission-warning">
                <div class="warning-icon">⚠️</div>
                <div class="warning-content">
                    <div class="warning-title">{t("general.accessibilityPermissionRequired")}</div>
                    <div class="warning-message">{t("general.accessibilityPermissionMessage")}</div>
                    <button class="permission-button" onclick={handleRequestPermission}>
                        {t("general.openSystemSettings")}
                    </button>
                    <button class="permission-button secondary" onclick={handleCheckPermission}>
                        {t("general.recheckPermission")}
                    </button>
                </div>
            </div>
        {/if}

        {#if configStore.config.selectionToolbarEnabled}
            <div class="setting-item">
                <div class="setting-label">
                    <span class="label-text">{t("general.selectionToolbarDefaultPlatform")}</span>
                    <span class="label-description">
                        {t("general.selectionToolbarDefaultPlatformDescription")}
                    </span>
                </div>
                <select
                    class="setting-select"
                    value={configStore.config.selectionToolbarDefaultPlatformId || ""}
                    onchange={handleSelectionToolbarDefaultPlatformChange}
                >
                    <option value="">{t("general.selectPlatform")}</option>
                    {#each platformsStore.selectionToolbarPlatforms as platform (platform.id)}
                        <option value={platform.id}>{platform.name}</option>
                    {/each}
                </select>
            </div>

            <div class="setting-item stacked">
                <div class="setting-label">
                    <span class="label-text">{t("general.selectionToolbarIgnoreTitle")}</span>
                    <span class="label-description">
                        {t("general.selectionToolbarIgnoreDescription")}
                    </span>
                </div>

                <div class="ignore-editor">
                    <input
                        class="setting-input"
                        type="text"
                        bind:value={ignoreInput}
                        placeholder={t("general.selectionToolbarIgnorePlaceholder")}
                        onkeydown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void handleAddIgnoredApp();
                            }
                        }}
                    />
                    <button class="btn-secondary" type="button" onclick={handleAddIgnoredApp}>
                        {t("general.selectionToolbarIgnoreAdd")}
                    </button>
                </div>

                {#if configStore.config.selectionToolbarIgnoredApps.length > 0}
                    <div class="ignored-list">
                        {#each configStore.config.selectionToolbarIgnoredApps as app (app)}
                            <span class="ignored-entry">
                                <span class="ignored-name">{app}</span>
                                <button
                                    type="button"
                                    class="ignored-remove"
                                    onclick={() => handleRemoveIgnoredApp(app)}
                                    aria-label={formatTranslation(
                                        "general.selectionToolbarIgnoreRemove",
                                        { app },
                                    )}
                                >
                                    ×
                                </button>
                            </span>
                        {/each}
                    </div>
                {:else}
                    <div class="ignored-empty">{t("general.selectionToolbarIgnoreEmpty")}</div>
                {/if}
            </div>

            <!-- 临时禁用状态显示（仅在被划词工具栏触发禁用后显示） -->
            {#if isTemporaryDisabled}
                <div class="setting-item stacked">
                    <div class="temporary-disable-status">
                        <div>
                            {formatTranslation("general.selectionToolbarTemporaryDisabledStatus", {
                                time: formatDisableUntil(temporaryDisableUntil),
                            })}
                        </div>
                        {#if disableCountdown}
                            <div class="temporary-disable-countdown">{disableCountdown}</div>
                        {/if}
                    </div>
                    <!-- 立即恢复按钮：允许用户提前结束临时禁用 -->
                    <button class="btn-secondary outline" type="button" onclick={handleResumeTemporaryDisable}>
                        {t("general.selectionToolbarTemporaryDisableResumeNow")}
                    </button>
                </div>
            {/if}
        {/if}
    </div>

    <!-- 启动/更新设置 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.startup")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.autoStart")}</span>
                <span class="label-description">{t("general.autoStartDescription")}</span>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" checked={configStore.config.autoStart} onchange={handleAutoStartChange} />
                <span class="toggle-slider"></span>
            </label>
        </div>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.autoUpdate")}</span>
                <span class="label-description">{t("general.autoUpdateDescription")}</span>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" checked={configStore.config.autoUpdateEnabled} onchange={handleAutoUpdateChange} />
                <span class="toggle-slider"></span>
            </label>
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
                {#each themeOptions as option (option.value)}
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
                {#each AVAILABLE_SHORTCUTS as shortcut (shortcut)}
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
                {#each TRANSLATION_SHORTCUTS as shortcut (shortcut)}
                    <option value={shortcut}>{formatHotkey(shortcut)}</option>
                {/each}
            </select>
        </div>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.selectionToolbarHotkey")}</span>
                <span class="label-description">
                    {t("general.selectionToolbarHotkeyDescription")}
                </span>
            </div>
            <select
                class="setting-select"
                value={configStore.config.selectionToolbarHotkey}
                onchange={handleSelectionToolbarHotkeyChange}
            >
                {#each SELECTION_TOOLBAR_SHORTCUTS as shortcut (shortcut)}
                    <option value={shortcut}>{formatHotkey(shortcut)}</option>
                {/each}
            </select>
        </div>
    </div>

    <!-- 性能优化 -->
    <div class="setting-group">
        <h3 class="group-title">{t("general.performance")}</h3>

        <div class="setting-item">
            <div class="setting-label">
                <span class="label-text">{t("general.preloadPlatforms")}</span>
                <span class="label-description">
                    {t("general.preloadPlatformsDescription")}
                </span>
            </div>
            <label class="toggle-switch">
                <input
                    type="checkbox"
                    checked={configStore.config.preloadDefaultPlatforms}
                    onchange={handlePreloadChange}
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
    
    .setting-item.stacked {
        flex-direction: column;
        align-items: stretch;
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
    
    .setting-input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        color: var(--text-primary);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        transition: border-color 0.2s ease;
    }
    
    .setting-input:focus {
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
    
    .btn-secondary {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }
    
    .btn-secondary:hover {
        background-color: var(--bg-tertiary);
        border-color: var(--accent-color);
    }
    
    .btn-secondary:active {
        transform: scale(0.98);
    }
    
    .ignore-editor {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        width: 100%;
    }
    
    .ignored-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    
    .ignored-entry {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }
    
    .ignored-name {
        max-width: 14rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    
    .ignored-remove {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        padding: 0;
    }
    
    .ignored-remove:hover {
        color: var(--text-primary);
    }
    
    .ignored-empty {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }
    
    .temporary-disable-status {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    .temporary-disable-countdown {
        font-weight: 500;
        color: var(--accent-color);
    }

    .btn-secondary.outline {
        background-color: transparent;
        color: var(--accent-color);
        border-color: var(--accent-color);
    }

    .btn-secondary.outline:hover {
        background-color: rgba(59, 130, 246, 0.1);
    }

    :global(.dark) .btn-secondary.outline:hover {
        background-color: rgba(59, 130, 246, 0.2);
    }

    .permission-warning {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        background-color: #fff3cd;
        border: 1px solid #ffc107;
        border-radius: 0.5rem;
        margin: 1rem 0;
    }

    :global(.dark) .permission-warning {
        background-color: rgba(255, 193, 7, 0.15);
        border-color: rgba(255, 193, 7, 0.3);
    }

    .warning-icon {
        font-size: 1.5rem;
        flex-shrink: 0;
    }

    .warning-content {
        flex: 1;
    }

    .warning-title {
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 0.5rem;
    }

    .warning-message {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-bottom: 0.75rem;
        line-height: 1.5;
    }

    .permission-button {
        padding: 0.5rem 1rem;
        background-color: var(--accent-color);
        color: white;
        border: none;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-right: 0.5rem;
    }

    .permission-button:hover {
        opacity: 0.9;
        transform: translateY(-1px);
    }

    .permission-button:active {
        transform: translateY(0);
    }

    .permission-button.secondary {
        background-color: transparent;
        color: var(--text-primary);
        border: 1px solid var(--border-color);
    }

    .permission-button.secondary:hover {
        background-color: var(--bg-secondary);
    }
</style>
