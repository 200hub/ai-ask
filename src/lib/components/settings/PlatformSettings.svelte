<script lang="ts">
    /**
     * AI平台管理设置标签页
     */
    import { platformsStore } from "$lib/stores/platforms.svelte";
    import { Trash2, Plus, GripVertical } from "lucide-svelte";
    import Button from "../common/Button.svelte";

    let showAddModal = $state(false);
    let newPlatform = $state({
        name: "",
        url: "",
        icon: "",
        enabled: true,
    });

    /**
     * 切换平台启用状态
     */
    async function togglePlatform(id: string) {
        try {
            await platformsStore.togglePlatform(id);
        } catch (error) {
            console.error("Failed to toggle platform:", error);
        }
    }

    /**
     * 删除自定义平台
     */
    async function deletePlatform(id: string) {
        if (!confirm("确定要删除这个平台吗？")) return;

        try {
            await platformsStore.removePlatform(id);
        } catch (error) {
            console.error("Failed to delete platform:", error);
            alert("删除失败：" + (error as Error).message);
        }
    }

    /**
     * 打开添加平台弹窗
     */
    function openAddModal() {
        showAddModal = true;
        newPlatform = {
            name: "",
            url: "",
            icon: "",
            enabled: true,
        };
    }

    /**
     * 关闭添加平台弹窗
     */
    function closeAddModal() {
        showAddModal = false;
    }

    /**
     * 添加自定义平台
     */
    async function handleAddPlatform() {
        if (!newPlatform.name || !newPlatform.url) {
            alert("请填写平台名称和网址");
            return;
        }

        try {
            await platformsStore.addPlatform({
                name: newPlatform.name,
                url: newPlatform.url,
                icon: newPlatform.icon || "https://via.placeholder.com/40",
                enabled: newPlatform.enabled,
            });
            closeAddModal();
        } catch (error) {
            console.error("Failed to add platform:", error);
            alert("添加失败");
        }
    }
</script>

<div class="settings-section">
    <!-- 内置平台 -->
    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">内置AI平台</h3>
            <p class="group-description">启用或禁用内置的AI平台</p>
        </div>

        <div class="platform-list">
            {#each platformsStore.builtInPlatforms as platform (platform.id)}
                <div class="platform-item">
                    <div class="platform-info">
                        <img
                            src={platform.icon}
                            alt={platform.name}
                            class="platform-icon"
                            onerror={(e) =>
                                (e.currentTarget.src =
                                    "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E")}
                        />
                        <div class="platform-details">
                            <span class="platform-name">{platform.name}</span>
                            <span class="platform-url">{platform.url}</span>
                        </div>
                    </div>
                    <label class="toggle-switch">
                        <input
                            type="checkbox"
                            checked={platform.enabled}
                            onchange={() => togglePlatform(platform.id)}
                        />
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            {/each}
        </div>
    </div>

    <!-- 自定义平台 -->
    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">自定义平台</h3>
            <Button variant="primary" size="sm" onclick={openAddModal}>
                <Plus size={16} />
                添加平台
            </Button>
        </div>

        {#if platformsStore.customPlatforms.length === 0}
            <div class="empty-state">
                <p>暂无自定义平台</p>
                <p class="empty-hint">点击上方按钮添加您自己的AI平台</p>
            </div>
        {:else}
            <div class="platform-list">
                {#each platformsStore.customPlatforms as platform (platform.id)}
                    <div class="platform-item">
                        <div class="platform-info">
                            <img
                                src={platform.icon}
                                alt={platform.name}
                                class="platform-icon"
                                onerror={(e) =>
                                    (e.currentTarget.src =
                                        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E")}
                            />
                            <div class="platform-details">
                                <span class="platform-name"
                                    >{platform.name}</span
                                >
                                <span class="platform-url">{platform.url}</span>
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
                            <Button
                                variant="icon"
                                size="sm"
                                onclick={() => deletePlatform(platform.id)}
                                class="delete-btn"
                            >
                                <Trash2 size={16} />
                            </Button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<!-- 添加平台弹窗 -->
{#if showAddModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="modal-overlay"
        onclick={(e) => e.target === e.currentTarget && closeAddModal()}
    >
        <div class="add-modal">
            <h3 class="modal-title">添加自定义平台</h3>

            <div class="form-group">
                <label class="form-label">平台名称 *</label>
                <input
                    type="text"
                    class="form-input"
                    placeholder="例如：My AI"
                    bind:value={newPlatform.name}
                />
            </div>

            <div class="form-group">
                <label class="form-label">平台网址 *</label>
                <input
                    type="url"
                    class="form-input"
                    placeholder="https://example.com"
                    bind:value={newPlatform.url}
                />
            </div>

            <div class="form-group">
                <label class="form-label">图标网址</label>
                <input
                    type="url"
                    class="form-input"
                    placeholder="https://example.com/icon.png"
                    bind:value={newPlatform.icon}
                />
                <p class="form-hint">可选，留空将使用默认图标</p>
            </div>

            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" bind:checked={newPlatform.enabled} />
                    <span>立即启用此平台</span>
                </label>
            </div>

            <div class="modal-actions">
                <Button variant="secondary" onclick={closeAddModal}>取消</Button
                >
                <Button variant="primary" onclick={handleAddPlatform}
                    >添加</Button
                >
            </div>
        </div>
    </div>
{/if}

<style>
    .settings-section {
        width: 100%;
        max-width: none;
    }

    .setting-group {
        margin-bottom: 1.5rem;
    }

    .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.875rem;
        padding-bottom: 0.375rem;
        border-bottom: 1px solid var(--border-color);
    }

    .group-title {
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .group-description {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0.25rem 0 0 0;
    }

    .platform-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .platform-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        transition: all 0.2s ease;
    }

    .platform-item:hover {
        background-color: var(--bg-tertiary);
    }

    .platform-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1;
        min-width: 0;
    }

    .platform-icon {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .platform-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .platform-name {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
        margin: 0;
    }

    .platform-url {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .platform-actions {
        display: flex;
        gap: 0.375rem;
        margin-left: auto;
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

    .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        color: var(--text-secondary);
    }

    .empty-state p {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
    }

    .empty-hint {
        font-size: 0.875rem;
        color: var(--text-tertiary);
    }

    /* 添加平台弹窗 */
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    }

    .add-modal {
        background-color: var(--bg-primary);
        border-radius: 0.625rem;
        padding: 1.25rem;
        width: 90%;
        max-width: 480px;
        box-shadow: var(--shadow-lg);
    }

    .modal-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 1rem 0;
    }

    .form-group {
        margin-bottom: 0.875rem;
    }

    .form-label {
        display: block;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 0.375rem;
    }

    .form-input {
        width: 100%;
        padding: 0.625rem;
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

    .form-hint {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        margin: 0.375rem 0 0 0;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
    }

    .checkbox-label span {
        font-size: 0.875rem;
        color: var(--text-primary);
    }

    .modal-actions {
        display: flex;
        gap: 0.625rem;
        justify-content: flex-end;
        margin-top: 1rem;
    }

    .platform-item :global(.delete-btn) {
        color: var(--error-color);
    }

    .platform-item :global(.delete-btn:hover) {
        background-color: rgba(239, 68, 68, 0.1);
    }
</style>
