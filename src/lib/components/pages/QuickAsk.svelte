<script lang="ts">
import { onMount } from "svelte";
import { listen } from "@tauri-apps/api/event";
import { i18n } from "$lib/i18n";
import { quickAskStore } from "$lib/stores/quick-ask.svelte";
import { appState } from "$lib/stores/app.svelte";
import { platformsStore } from "$lib/stores/platforms.svelte";
import { logger } from "$lib/utils/logger";

const t = i18n.t;

let inputElement = $state<HTMLTextAreaElement | undefined>();
let hasAutoSelected = $state(false);

onMount(() => {
	void quickAskStore.init();

	// Listen for global shortcut event from Rust backend
	const unlisten = listen("open-quick-ask", () => {
		logger.debug("Received open-quick-ask event");
		// 隐藏所有子 WebView，避免遮挡弹窗（不标记恢复）
		window.dispatchEvent(new Event("hideAllWebviewsNoRestore"));
		quickAskStore.open();
	});

	return () => {
		unlisten.then((fn) => fn());
	};
});

// Auto-focus input when opened
$effect(() => {
	if (quickAskStore.isOpen && inputElement) {
		// Reset auto-select flag when opening
		if (!hasAutoSelected) {
			inputElement.focus();
			// Auto-select all text if pasted from clipboard (only once)
			if (quickAskStore.question) {
				setTimeout(() => {
					inputElement?.select();
				}, 0);
				hasAutoSelected = true;
			}
		}
	} else {
		// Reset flag when closed
		hasAutoSelected = false;
	}
});

async function handleSubmit() {
	const success = await quickAskStore.submit();
	if (success) {
		// Close Quick Ask modal
		quickAskStore.close();

		// Switch to the selected platform's view
		const selectedPlatformId = quickAskStore.selectedPlatformId;
		if (selectedPlatformId) {
			const platform = platformsStore.getPlatformById(selectedPlatformId);
			if (platform) {
				appState.switchToChatView(platform);
				logger.info("Switched to platform view:", platform.name);
				window.dispatchEvent(
					new CustomEvent("ensureChatVisible", {
						detail: { platformId: platform.id },
					}),
				);
			}
		}
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		e.preventDefault();
		quickAskStore.close();
	} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
		e.preventDefault();
		handleSubmit();
	}
}

function handleBackdropClick(e: MouseEvent) {
	if (e.target === e.currentTarget) {
		quickAskStore.close();
	}
}

function goToLogin() {
	const selectedPlatformId = quickAskStore.selectedPlatformId;
	// Close modal first
	quickAskStore.close();

	if (selectedPlatformId) {
		const platform = platformsStore.getPlatformById(selectedPlatformId);
		if (platform) {
			appState.switchToChatView(platform);
			logger.info("Navigating to platform for login:", platform.name);
			window.dispatchEvent(
				new CustomEvent("ensureChatVisible", {
					detail: { platformId: platform.id },
				}),
			);
		}
	}
}
</script>

{#if quickAskStore.isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="quick-ask-backdrop" onclick={handleBackdropClick}>
		<div class="quick-ask-modal">
			<div class="modal-header">
				<h2>{t("quickAsk.title")}</h2>
				<button class="close-button" onclick={() => quickAskStore.close()} aria-label={t("quickAsk.close")}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="modal-body">
				<textarea
					bind:this={inputElement}
					bind:value={quickAskStore.question}
					placeholder={t("quickAsk.placeholder")}
					onkeydown={handleKeydown}
					rows="4"
					disabled={quickAskStore.loading}
				></textarea>

				{#if quickAskStore.error}
					<div class="error-message">
						{t(quickAskStore.error)}
						{#if quickAskStore.error === 'quickAsk.errors.notLoggedIn'}
							<div class="login-cta">
								<button class="go-login-button" onclick={goToLogin}>{t('quickAsk.goToLogin')}</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="modal-footer">
				<div class="footer-hint">
					<span>ESC {t("quickAsk.cancel")} • Ctrl+Enter {t("quickAsk.send")}</span>
				</div>
				<div class="footer-actions">
					<button class="cancel-button" onclick={() => quickAskStore.close()} disabled={quickAskStore.loading}>
						{t("quickAsk.cancel")}
					</button>
					<button class="send-button" onclick={handleSubmit} disabled={quickAskStore.loading || !quickAskStore.question.trim()}>
						{quickAskStore.loading ? t("quickAsk.sending") : t("quickAsk.send")}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
.quick-ask-backdrop {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background-color: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 9999;
	backdrop-filter: blur(4px);
}

.quick-ask-modal {
	background: var(--bg-primary);
	border-radius: 0.75rem;
	width: 90%;
	max-width: 42rem;
	box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.3);
	display: flex;
	flex-direction: column;
	max-height: 80vh;
}

.modal-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.25rem;
	border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
	font-size: 1.125rem;
	font-weight: 600;
	color: var(--text-primary);
	margin: 0;
}

.close-button {
	background: transparent;
	border: none;
	color: var(--text-secondary);
	cursor: pointer;
	padding: 0.25rem;
	border-radius: 0.25rem;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s;
}

.close-button:hover {
	background: var(--bg-secondary);
	color: var(--text-primary);
}

.modal-body {
	padding: 1.25rem;
	flex: 1;
	overflow-y: auto;
}

.modal-body textarea {
	width: 100%;
	min-height: 6rem;
	padding: 0.75rem;
	border: 1px solid var(--border-color);
	border-radius: 0.5rem;
	background: var(--bg-secondary);
	color: var(--text-primary);
	font-family: inherit;
	font-size: 0.9375rem;
	line-height: 1.5;
	resize: vertical;
	transition: border-color 0.2s;
}

.modal-body textarea:focus {
	outline: none;
	border-color: var(--accent-color);
}

.modal-body textarea:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.error-message {
	margin-top: 0.75rem;
	padding: 0.625rem 0.875rem;
	background: rgba(239, 68, 68, 0.1);
	border: 1px solid rgba(239, 68, 68, 0.3);
	border-radius: 0.375rem;
	color: #ef4444;
	font-size: 0.875rem;
}

.modal-footer {
	padding: 1rem 1.25rem;
	border-top: 1px solid var(--border-color);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.footer-hint {
	font-size: 0.8125rem;
	color: var(--text-secondary);
}

.footer-actions {
	display: flex;
	gap: 0.625rem;
}

.cancel-button,
.send-button {
	padding: 0.5rem 1rem;
	border-radius: 0.375rem;
	font-size: 0.875rem;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.2s;
	border: none;
}

.cancel-button {
	background: var(--bg-secondary);
	color: var(--text-primary);
}

.cancel-button:hover:not(:disabled) {
	background: var(--bg-tertiary);
}

.send-button {
	background: var(--accent-color);
	color: white;
}

.send-button:hover:not(:disabled) {
	opacity: 0.9;
}

.cancel-button:disabled,
.send-button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
