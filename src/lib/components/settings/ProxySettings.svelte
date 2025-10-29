<script lang="ts">
    /**
     * Proxy settings panel
     * Supports: no proxy, system proxy, custom proxy
     */
    import { onMount } from "svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { configStore } from "$lib/stores/config.svelte";
    import type { ProxyConfig } from "$lib/types/config";
    import { i18n } from "$lib/i18n";

    type ProxyType = "none" | "system" | "custom";

    interface ProxyTestResult {
        success: boolean;
        message: string;
        latency?: number;
    }

    const DEFAULT_PROXY_HOST = "127.0.0.1";
    const DEFAULT_PROXY_PORT = "7890";

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

    let proxyType = $state<ProxyType>("none");
    let customProxyHost = $state(DEFAULT_PROXY_HOST);
    let customProxyPort = $state(DEFAULT_PROXY_PORT);
    let isSaving = $state(false);
    let saveStatus = $state<"idle" | "success" | "error">("idle");
    let saveMessage = $state<string | null>(null);
    let testStatus = $state<"idle" | "testing" | "success" | "error">("idle");
    let testMessage = $state<string | null>(null);
    let isDirty = $state(false);

    function syncFromConfig() {
        const proxy = configStore.config.proxy;

        if (!proxy || proxy.type === "none") {
            proxyType = "none";
            customProxyHost = DEFAULT_PROXY_HOST;
            customProxyPort = DEFAULT_PROXY_PORT;
        } else if (proxy.type === "system") {
            proxyType = "system";
            customProxyHost = DEFAULT_PROXY_HOST;
            customProxyPort = DEFAULT_PROXY_PORT;
        } else {
            proxyType = "custom";
            customProxyHost = proxy.host ?? DEFAULT_PROXY_HOST;
            customProxyPort = proxy.port ?? DEFAULT_PROXY_PORT;
        }

        isDirty = false;
        saveStatus = "idle";
        saveMessage = null;
    }

    onMount(async () => {
        if (!configStore.initialized) {
            await configStore.init();
        }
        syncFromConfig();
    });

    function markDirty() {
        isDirty = true;
        saveStatus = "idle";
        saveMessage = null;
    }

    function handleTypeChange(type: ProxyType) {
        if (proxyType === type) return;
        proxyType = type;
        markDirty();
    }

    function validateCustomProxy() {
        const host = customProxyHost.trim();
        const port = customProxyPort.trim();

        if (!host) {
            throw new Error(t("proxy.hostRequired"));
        }

        if (!port) {
            throw new Error(t("proxy.portRequired"));
        }

        const portNumber = Number(port);
        if (
            !Number.isInteger(portNumber) ||
            portNumber <= 0 ||
            portNumber > 65535
        ) {
            throw new Error(t("proxy.portRangeError"));
        }

        return { host, port };
    }

    async function handleSave() {
        if (!isDirty) {
            saveStatus = "success";
            saveMessage = t("proxy.noChanges");
            return;
        }

        let proxyPayload: ProxyConfig | null = null;

        try {
            if (proxyType === "custom") {
                const { host, port } = validateCustomProxy();
                proxyPayload = { type: "custom", host, port };
            } else if (proxyType === "system") {
                proxyPayload = { type: "system" };
            }
        } catch (error) {
            saveStatus = "error";
            saveMessage =
                error instanceof Error
                    ? error.message
                    : t("proxy.saveFailed");
            return;
        }

        isSaving = true;
        saveStatus = "idle";
        saveMessage = null;

        try {
            console.log("Saving proxy config:", proxyPayload);
            await configStore.update({ proxy: proxyPayload });
            console.log("Proxy config saved successfully");
            saveStatus = "success";
            saveMessage = t("proxy.saveSuccess");
            syncFromConfig();
        } catch (error) {
            console.error("Failed to save proxy settings:", error);
            saveStatus = "error";
            const errorMsg =
                error instanceof Error
                    ? error.message
                    : t("proxy.saveFailed");
            saveMessage = errorMsg;
            // Show more detailed error in console
            console.error("Detailed error:", {
                error,
                proxyPayload,
                currentConfig: configStore.config,
            });
        } finally {
            isSaving = false;
        }
    }

    async function handleTestProxy() {
        testStatus = "testing";
        testMessage = null;

        let payload: ProxyConfig = { type: proxyType };

        if (proxyType === "custom") {
            try {
                const { host, port } = validateCustomProxy();
                payload = { type: "custom", host, port };
            } catch (error) {
                testStatus = "error";
                testMessage =
                    error instanceof Error
                        ? error.message
                        : t("proxy.invalidSettings");
                return;
            }
        }

        try {
            const result = await invoke<ProxyTestResult>(
                "test_proxy_connection",
                {
                    config: payload,
                },
            );

            if (result.success) {
                testStatus = "success";
                const latencyText =
                    typeof result.latency === "number"
                        ? translate("proxy.latencySuffix", {
                              latency: String(result.latency),
                          })
                        : "";
                testMessage = translate("proxy.testSuccess", {
                    latency: latencyText,
                });
            } else {
                testStatus = "error";
                testMessage = result.message || t("proxy.testFailed");
            }
        } catch (error) {
            console.error("Failed to test proxy:", error);
            testStatus = "error";
            testMessage =
                error instanceof Error ? error.message : t("proxy.testFailed");
        }
    }
</script>

<div class="proxy-settings">
    <div class="section-header">
        <h3 class="section-title">{t("proxy.title")}</h3>
        <p class="section-description">{t("proxy.description")}</p>
    </div>

    <div class="form-section">
        <span class="form-label">{t("proxy.type")}</span>

        <div class="radio-group">
            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="none"
                    checked={proxyType === "none"}
                    onchange={() => handleTypeChange("none")}
                />
                <div class="radio-content">
                    <div class="radio-title">{t("proxy.none")}</div>
                    <div class="radio-description">
                        {t("proxy.noneDescription")}
                    </div>
                </div>
            </label>

            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="system"
                    checked={proxyType === "system"}
                    onchange={() => handleTypeChange("system")}
                />
                <div class="radio-content">
                    <div class="radio-title">{t("proxy.system")}</div>
                    <div class="radio-description">
                        {t("proxy.systemDescription")}
                    </div>
                </div>
            </label>

            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="custom"
                    checked={proxyType === "custom"}
                    onchange={() => handleTypeChange("custom")}
                />
                <div class="radio-content">
                    <div class="radio-title">{t("proxy.custom")}</div>
                    <div class="radio-description">
                        {t("proxy.customDescription")}
                    </div>
                </div>
            </label>
        </div>
    </div>

    {#if proxyType === "custom"}
        <div class="custom-proxy-section">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="proxy-host">{t("proxy.host")}</label>
                    <input
                        id="proxy-host"
                        type="text"
                        class="form-input"
                        placeholder={t("proxy.hostPlaceholder")}
                        bind:value={customProxyHost}
                        oninput={markDirty}
                    />
                </div>

                <div class="form-group">
                    <label class="form-label" for="proxy-port">{t("proxy.port")}</label>
                    <input
                        id="proxy-port"
                        type="text"
                        class="form-input"
                        placeholder={t("proxy.portPlaceholder")}
                        bind:value={customProxyPort}
                        oninput={markDirty}
                    />
                </div>
            </div>

            <div class="proxy-example">
                <strong>{t("proxy.example")}:</strong>
                <code>http://{customProxyHost}:{customProxyPort}</code>
            </div>
        </div>
    {/if}

    <div class="action-buttons">
        <button
            class="btn btn-primary"
            type="button"
            disabled={isSaving}
            onclick={handleSave}
        >
            {isSaving ? t("common.loading") : t("proxy.saveSettings")}
        </button>
        <button
            class="btn btn-secondary"
            type="button"
            disabled={testStatus === "testing"}
            onclick={handleTestProxy}
        >
            {testStatus === "testing" ? t("common.loading") : t("proxy.testConnection")}
        </button>
    </div>

    {#if saveStatus !== "idle" && saveMessage}
        <div class={`status-message ${saveStatus}`}>
            <p>{saveMessage}</p>
        </div>
    {/if}

    {#if testStatus !== "idle" && testMessage}
        <div class={`status-message ${testStatus}`}>
            <p>{testMessage}</p>
        </div>
    {/if}

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
            <p>{t("proxy.infoTip1")}</p>
            <p class="mt-2">{t("proxy.infoTip2")}</p>
        </div>
    </div>
</div>

<style>
    .proxy-settings {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding: 1.25rem;
        background-color: var(--bg-primary);
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
    }

    .section-header {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .section-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .section-description {
        margin: 0;
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    .form-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .form-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .radio-group {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .radio-option {
        display: flex;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        background-color: var(--bg-secondary);
        cursor: pointer;
        transition:
            border-color 0.2s ease,
            box-shadow 0.2s ease;
    }

    .radio-option:hover {
        border-color: var(--accent-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    .radio-option input {
        margin: 0.25rem 0 0 0;
    }

    .radio-content {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .radio-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .radio-description {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .custom-proxy-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .form-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-input {
        padding: 0.625rem 0.875rem;
        font-size: 0.875rem;
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        background-color: var(--bg-primary);
        color: var(--text-primary);
        transition: all 0.2s ease;
    }

    .form-input:focus {
        outline: none;
        border-color: var(--accent-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .form-input::placeholder {
        color: var(--text-tertiary);
    }

    .proxy-example {
        padding: 0.75rem;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .proxy-example code {
        color: var(--accent-color);
        font-family: monospace;
        font-size: 0.875rem;
    }

    .action-buttons {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .btn {
        padding: 0.625rem 1.25rem;
        font-size: 0.875rem;
        font-weight: 500;
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 7.5rem;
    }

    .btn:active {
        transform: scale(0.98);
    }

    .btn:disabled {
        cursor: not-allowed;
        opacity: 0.7;
        transform: none;
    }

    .btn-primary {
        background-color: var(--accent-color);
        color: white;
    }

    .btn-primary:hover:not(:disabled) {
        background-color: var(--accent-hover);
    }

    .btn-secondary {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
    }

    .btn-secondary:hover:not(:disabled) {
        background-color: var(--bg-tertiary);
    }

    .status-message {
        font-size: 0.8125rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        border: 1px solid transparent;
    }

    .status-message p {
        margin: 0;
    }

    .status-message.success {
        color: var(--success-color);
        border-color: rgba(34, 197, 94, 0.4);
        background-color: rgba(34, 197, 94, 0.12);
    }

    .status-message.error {
        color: var(--error-color);
        border-color: rgba(239, 68, 68, 0.4);
        background-color: rgba(239, 68, 68, 0.1);
    }

    .info-box {
        display: flex;
        gap: 0.75rem;
        padding: 0.875rem;
        background-color: rgba(59, 130, 246, 0.05);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: 0.375rem;
    }

    .info-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--accent-color);
        flex-shrink: 0;
        margin-top: 0.125rem;
    }

    .info-text {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        line-height: 1.6;
    }

    .info-text p {
        margin: 0;
    }

    .mt-2 {
        margin-top: 0.5rem;
    }

    @media (max-width: 768px) {
        .form-row {
            grid-template-columns: 1fr;
        }

        .action-buttons {
            flex-direction: column;
        }

        .btn {
            width: 100%;
        }
    }
</style>
