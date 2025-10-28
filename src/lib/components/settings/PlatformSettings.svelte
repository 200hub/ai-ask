<script lang="ts">
    /**
     * Platform settings panel for managing AI providers.
     */
    import { onMount, tick } from "svelte";
    import { Plus, Trash2 } from "lucide-svelte";
    import Button from "../common/Button.svelte";
    import { platformsStore } from "$lib/stores/platforms.svelte";

    const FALLBACK_ICON =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3C/svg%3E";

    let showAddModal = $state(false);
    let isSubmitting = $state(false);
    let formError = $state<string | null>(null);

    let newPlatformName = $state("");
    let newPlatformUrl = $state("");
    let newPlatformIcon = $state("");
    let newPlatformEnabled = $state(true);

    onMount(async () => {
        if (platformsStore.platforms.length === 0) {
            try {
                await platformsStore.init();
            } catch (error) {
                console.error("Failed to load AI platforms:", error);
            }
        }
    });

    function focusOnMount(node: HTMLElement) {
        tick().then(() => node.focus());
        return {
            destroy() {},
        };
    }

    function resetForm() {
        newPlatformName = "";
        newPlatformUrl = "";
        newPlatformIcon = "";
        newPlatformEnabled = true;
        formError = null;
    }

    function handleIconError(event: Event) {
        const target = event.currentTarget as HTMLImageElement | null;
        if (target && target.src !== FALLBACK_ICON) {
            target.src = FALLBACK_ICON;
        }
    }

    async function togglePlatform(id: string) {
        try {
            await platformsStore.togglePlatform(id);
        } catch (error) {
            console.error("Failed to toggle platform:", error);
            window.alert("Unable to update platform. Please try again.");
        }
    }

    async function deletePlatform(id: string) {
        if (!window.confirm("Remove this custom platform?")) return;

        try {
            await platformsStore.removePlatform(id);
        } catch (error) {
            console.error("Failed to delete platform:", error);
            window.alert("Unable to delete platform. Please try again.");
        }
    }

    function openAddModal() {
        resetForm();
        showAddModal = true;
    }

    function closeAddModal() {
        showAddModal = false;
    }

    function validateForm() {
        if (!newPlatformName.trim()) {
            throw new Error("Platform name is required");
        }

        if (!newPlatformUrl.trim()) {
            throw new Error("Platform URL is required");
        }

        try {
            const parsed = new URL(newPlatformUrl.trim());
            if (!parsed.protocol.startsWith("http")) {
                throw new Error();
            }
        } catch (error) {
            throw new Error("Please enter a valid platform URL (http/https)");
        }

        if (newPlatformIcon.trim()) {
            try {
                const parsed = new URL(newPlatformIcon.trim());
                if (!parsed.protocol.startsWith("http")) {
                    throw new Error();
                }
            } catch (error) {
                throw new Error("Please enter a valid icon URL or leave it blank");
            }
        }
    }

    async function handleAddPlatform() {
        formError = null;

        try {
            validateForm();
        } catch (error) {
            formError = error instanceof Error ? error.message : "Invalid form data";
            return;
        }

        isSubmitting = true;

        try {
            await platformsStore.addPlatform({
                name: newPlatformName.trim(),
                url: newPlatformUrl.trim(),
                icon: newPlatformIcon.trim() || FALLBACK_ICON,
                enabled: newPlatformEnabled,
            });
            closeAddModal();
        } catch (error) {
            console.error("Failed to add platform:", error);
            formError = "Unable to add platform. Please try again.";
        } finally {
            isSubmitting = false;
        }
    }
</script>

<div class="settings-section">
    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">Built-in platforms</h3>
            <p class="group-description">Enable or disable the default AI providers.</p>
        </div>

        <div class="platform-list">
            {#if platformsStore.builtInPlatforms.length === 0}
                <p class="empty-message">No built-in platforms available.</p>
            {:else}
                {#each platformsStore.builtInPlatforms as platform (platform.id)}
                    <div class="platform-item">
                        <div class="platform-info">
                            <img
                                src={platform.icon || FALLBACK_ICON}
                                alt={platform.name}
                                class="platform-icon"
                                onerror={handleIconError}
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
            {/if}
        </div>
    </div>

    <div class="setting-group">
        <div class="group-header">
            <h3 class="group-title">Custom platforms</h3>
            <Button variant="primary" size="sm" onclick={openAddModal}>
                <Plus size={16} />
                Add platform
            </Button>
        </div>

        {#if platformsStore.customPlatforms.length === 0}
            <div class="empty-state">
                <p>No custom platforms yet.</p>
                <p class="empty-hint">Use the button above to add your own AI platform.</p>
            </div>
        {:else}
            <div class="platform-list">
                {#each platformsStore.customPlatforms as platform (platform.id)}
                    <div class="platform-item">
                        <div class="platform-info">
                            <img
                                src={platform.icon || FALLBACK_ICON}
                                alt={platform.name}
                                class="platform-icon"
                                onerror={handleIconError}
                            />
                            <div class="platform-details">
                                <span class="platform-name">{platform.name}</span>
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

{#if showAddModal}
    <div
        class="modal-overlay"
        role="button"
        tabindex="0"
        aria-label="Close modal"
        onclick={(event) => {
            if (event.target === event.currentTarget) closeAddModal();
        }}
        onkeydown={(event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeAddModal();
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                closeAddModal();
            }
        }}
    >
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1" use:focusOnMount>
            <h3 class="modal-title">Add custom platform</h3>

            <div class="form-group">
                <label class="form-label" for="platform-name">Platform name *</label>
                <input
                    id="platform-name"
                    type="text"
                    class="form-input"
                    placeholder="e.g. My AI"
                    bind:value={newPlatformName}
                />
            </div>

            <div class="form-group">
                <label class="form-label" for="platform-url">Platform URL *</label>
                <input
                    id="platform-url"
                    type="url"
                    class="form-input"
                    placeholder="https://example.com"
                    bind:value={newPlatformUrl}
                />
            </div>

            <div class="form-group">
                <label class="form-label" for="platform-icon">Icon URL</label>
                <input
                    id="platform-icon"
                    type="url"
                    class="form-input"
                    placeholder="https://example.com/icon.png"
                    bind:value={newPlatformIcon}
                />
                <p class="form-hint">Optional; leave blank to use a generic icon.</p>
            </div>

            <label class="toggle-switch enable-toggle">
                <input
                    type="checkbox"
                    checked={newPlatformEnabled}
                    onchange={() => (newPlatformEnabled = !newPlatformEnabled)}
                />
                <span class="toggle-slider"></span>
                <span class="toggle-label">Enable after adding</span>
            </label>

            {#if formError}
                <p class="form-error">{formError}</p>
            {/if}

            <div class="modal-actions">
                <Button variant="secondary" size="sm" onclick={closeAddModal}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    onclick={handleAddPlatform}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? "Adding..." : "Add platform"}
                </Button>
            </div>
        </div>
    </div>
{/if}

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
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
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

    .empty-message,
    .empty-state {
        margin: 0;
        font-size: 0.9rem;
        color: var(--text-secondary);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 1rem;
        background-color: var(--bg-primary);
        border-radius: 0.5rem;
        border: 1px dashed var(--border-color);
    }

    .empty-hint {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--text-tertiary);
    }

    .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 10, 10, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        z-index: 1000;
    }

    .modal {
        width: min(480px, 100%);
        background-color: var(--bg-primary);
        border-radius: 0.75rem;
        border: 1px solid var(--border-color);
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        box-shadow: var(--shadow-lg);
    }

    .modal-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .form-input {
        padding: 0.625rem 0.875rem;
        font-size: 0.875rem;
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        background-color: var(--bg-primary);
        color: var(--text-primary);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .form-input:focus {
        outline: none;
        border-color: var(--accent-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    .form-hint {
        margin: 0;
        font-size: 0.75rem;
        color: var(--text-tertiary);
    }

    .enable-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.5rem;
    }

    .toggle-label {
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    .form-error {
        margin: 0;
        color: var(--error-color);
        font-size: 0.8125rem;
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
    }

    @media (max-width: 768px) {
        .setting-group {
            padding: 1.125rem;
        }

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
