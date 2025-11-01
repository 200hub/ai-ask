<script lang="ts">
import { onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { i18n } from "$lib/i18n";
import { quickAskStore } from "$lib/stores/quick-ask.svelte";
import { platformsStore } from "$lib/stores/platforms.svelte";
import { logger } from "$lib/utils/logger";

const t = i18n.t;

let inputElement = $state<HTMLTextAreaElement | undefined>();
let hasAutoSelected = $state(false);

onMount(async () => {
	// 初始化配置与平台列表，并尝试读取剪贴板预填
	await Promise.all([
		quickAskStore.init(),
		platformsStore.init(),
	]);
	await quickAskStore.open();
	inputElement?.focus();
});

// Auto-focus and auto-select on open
$effect(() => {
	// 仅在首次有预填内容时自动全选，避免用户输入时被反复全选打断
	if (!hasAutoSelected && inputElement && quickAskStore.question) {
		inputElement.focus();
		setTimeout(() => {
			inputElement?.select();
			hasAutoSelected = true;
		}, 0);
	}
});

async function handleSubmit() {
	const success = await quickAskStore.submit();
	if (success) {
		// Notify main window to show platform and switch view
		const selectedPlatformId = quickAskStore.selectedPlatformId;
		if (selectedPlatformId) {
			const { emit } = await import("@tauri-apps/api/event");
			await emit("quick-ask-show-platform", { platformId: selectedPlatformId }).catch((err) => {
				logger.error("Failed to emit show platform event", err);
			});
			logger.info("Emitted show platform event for:", selectedPlatformId);
		}

		// Close window via Tauri command
		await invoke("close_quick_ask_window").catch((err) => {
			logger.error("Failed to close Quick Ask window", err);
		});
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		e.preventDefault();
		void invoke("close_quick_ask_window").catch((err) => {
			logger.error("Failed to close Quick Ask window", err);
		});
	} else if (e.key === "Enter" && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
		e.preventDefault();
		void handleSubmit();
	}
}
</script>

<div class="quick-ask-window">
	<div class="input-container">
		<textarea
			bind:this={inputElement}
			bind:value={quickAskStore.question}
			placeholder={t("quickAsk.placeholder")}
			onkeydown={handleKeydown}
			rows="4"
			disabled={quickAskStore.loading}
			aria-label={t("quickAsk.title")}
		></textarea>

		{#if quickAskStore.error}
			<div class="error-message">
				{t(quickAskStore.error)}
			</div>
		{/if}
	</div>

	<div class="footer">
		<div class="hint">
			<span>ESC {t("quickAsk.cancel")} • Ctrl+Enter {t("quickAsk.send")}</span>
		</div>
		<button
			class="send-button"
			onclick={handleSubmit}
			disabled={quickAskStore.loading || !quickAskStore.question.trim()}
		>
			{quickAskStore.loading ? t("quickAsk.sending") : t("quickAsk.send")}
		</button>
	</div>
</div>

<style>
.quick-ask-window {
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	background: var(--bg-primary);
	color: var(--text-primary);
	padding: 0.75rem;
	gap: 0.5rem;
	border: 1px solid var(--border-color);
	border-radius: 0.5rem;
	box-shadow: var(--shadow-md);
}

.input-container {
	flex: 1;
	display: flex;
	flex-direction: column;
}

textarea {
	width: 100%;
	flex: 1;
	padding: 0.625rem;
	border: 1px solid var(--border-color);
	border-radius: 0.375rem;
	background: var(--bg-secondary);
	color: var(--text-primary);
	font-family: inherit;
	font-size: 0.875rem;
	line-height: 1.4;
	resize: none;
	overflow: auto;
	transition: border-color 0.2s;
}

textarea:focus {
	outline: none;
	border-color: var(--accent-color);
}

textarea:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.error-message {
	margin-top: 0.5rem;
	padding: 0.5rem 0.75rem;
	background: rgba(239, 68, 68, 0.1);
	border: 1px solid rgba(239, 68, 68, 0.3);
	border-radius: 0.25rem;
	color: #ef4444;
	font-size: 0.8125rem;
}

.footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.hint {
	font-size: 0.75rem;
	color: var(--text-secondary);
}

.send-button {
	padding: 0.375rem 0.875rem;
	border-radius: 0.25rem;
	font-size: 0.8125rem;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.2s;
	border: none;
	background: var(--accent-color);
	color: white;
}

.send-button:hover:not(:disabled) {
	opacity: 0.9;
}

.send-button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
