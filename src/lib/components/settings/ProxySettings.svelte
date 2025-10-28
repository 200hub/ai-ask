<script lang="ts">
    /**
     * 代理设置组件
     * 支持：无代理、系统代理、自定义代理
     */
    import { configStore } from "$lib/stores/config.svelte";

    type ProxyType = "none" | "system" | "custom";

    let proxyType = $state<ProxyType>(configStore.config.proxy?.type || "none");
    let customProxyHost = $state(configStore.config.proxy?.host || "127.0.0.1");
    let customProxyPort = $state(configStore.config.proxy?.port || "7890");

    /**
     * 保存代理设置
     */
    async function handleSave() {
        try {
            await configStore.update({
                proxy: {
                    type: proxyType,
                    host: customProxyHost,
                    port: customProxyPort,
                },
            });
            alert("代理设置已保存");
        } catch (error) {
            console.error("Failed to save proxy settings:", error);
            alert("保存失败，请重试");
        }
    }

    /**
     * 测试代理连接
     */
    async function handleTestProxy() {
        alert("代理测试功能开发中...");
    }
</script>

<div class="proxy-settings">
    <div class="section-header">
        <h3 class="section-title">网络代理</h3>
        <p class="section-description">配置应用的网络代理设置</p>
    </div>

    <!-- 代理类型选择 -->
    <div class="form-section">
        <label class="form-label">代理类型</label>

        <div class="radio-group">
            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="none"
                    checked={proxyType === "none"}
                    onchange={() => (proxyType = "none")}
                />
                <div class="radio-content">
                    <div class="radio-title">不使用代理</div>
                    <div class="radio-description">
                        直接连接，不经过任何代理
                    </div>
                </div>
            </label>

            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="system"
                    checked={proxyType === "system"}
                    onchange={() => (proxyType = "system")}
                />
                <div class="radio-content">
                    <div class="radio-title">系统代理</div>
                    <div class="radio-description">使用系统配置的代理设置</div>
                </div>
            </label>

            <label class="radio-option">
                <input
                    type="radio"
                    name="proxy-type"
                    value="custom"
                    checked={proxyType === "custom"}
                    onchange={() => (proxyType = "custom")}
                />
                <div class="radio-content">
                    <div class="radio-title">自定义代理</div>
                    <div class="radio-description">手动配置代理服务器</div>
                </div>
            </label>
        </div>
    </div>

    <!-- 自定义代理配置 -->
    {#if proxyType === "custom"}
        <div class="custom-proxy-section">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="proxy-host">代理地址</label>
                    <input
                        id="proxy-host"
                        type="text"
                        class="form-input"
                        placeholder="127.0.0.1"
                        bind:value={customProxyHost}
                    />
                </div>

                <div class="form-group">
                    <label class="form-label" for="proxy-port">端口</label>
                    <input
                        id="proxy-port"
                        type="text"
                        class="form-input"
                        placeholder="7890"
                        bind:value={customProxyPort}
                    />
                </div>
            </div>

            <div class="proxy-example">
                <strong>示例：</strong>
                <code>http://{customProxyHost}:{customProxyPort}</code>
            </div>
        </div>
    {/if}

    <!-- 操作按钮 -->
    <div class="action-buttons">
        <button class="btn btn-secondary" onclick={handleTestProxy}>
            测试连接
        </button>
        <button class="btn btn-primary" onclick={handleSave}>保存设置</button>
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
            <p>
                <strong>提示：</strong
                >修改代理设置后，需要重新加载网页才能生效。
            </p>
            <p class="mt-2">
                常见代理端口：HTTP/HTTPS 代理通常使用 7890、8080、1080 等端口。
            </p>
        </div>
    </div>
</div>

<style>
    .proxy-settings {
        width: 100%;
        max-width: none;
    }

    .section-header {
        margin-bottom: 1.5rem;
    }

    .section-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
    }

    .section-description {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .form-section {
        margin-bottom: 1rem;
    }

    .form-label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 0.75rem;
    }

    .radio-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .radio-option {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.75rem;
        background-color: var(--bg-secondary);
        border: 2px solid var(--border-color);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .radio-option:hover {
        border-color: var(--accent-color);
        background-color: var(--bg-primary);
    }

    .radio-option:has(input:checked) {
        border-color: var(--accent-color);
        background-color: rgba(59, 130, 246, 0.05);
    }

    .radio-option input[type="radio"] {
        margin-top: 0.125rem;
        cursor: pointer;
        width: 1.125rem;
        height: 1.125rem;
        accent-color: var(--accent-color);
    }

    .radio-content {
        flex: 1;
    }

    .radio-title {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 0.25rem;
    }

    .radio-description {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .custom-proxy-section {
        padding: 1rem;
        background-color: var(--bg-secondary);
        border-radius: 0.5rem;
        margin-bottom: 1rem;
    }

    .form-row {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
    }

    .form-group {
        display: flex;
        flex-direction: column;
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
        margin-bottom: 1rem;
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
    }

    .btn:active {
        transform: scale(0.98);
    }

    .btn-primary {
        background-color: var(--accent-color);
        color: white;
    }

    .btn-primary:hover {
        background-color: var(--accent-hover);
    }

    .btn-secondary {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
        background-color: var(--bg-tertiary);
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

    .info-text strong {
        color: var(--text-primary);
    }

    .mt-2 {
        margin-top: 0.5rem;
    }

    /* 响应式设计 */
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
