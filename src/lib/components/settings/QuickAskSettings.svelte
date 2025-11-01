<script lang="ts">
/**
 * Quick Ask 设置组件
 */
import { onMount } from "svelte";
import { quickAskStore } from "$lib/stores/quick-ask.svelte";
import { platformsStore } from "$lib/stores/platforms.svelte";
import { i18n } from "$lib/i18n";
import { logger } from "$lib/utils/logger";

const t = i18n.t;

let isSaving = $state(false);

onMount(() => {
	void quickAskStore.init();
	void platformsStore.init();
});

// Compute enabled platforms
const enabledPlatforms = $derived(platformsStore.enabledPlatforms);

/**
 * Toggle Quick Ask enabled/disabled
 */
async function handleEnabledChange(event: Event) {
	const target = event.target as HTMLInputElement;
	const enabled = target.checked;

	isSaving = true;
	try {
		await quickAskStore.setEnabled(enabled);
	} catch (error) {
		logger.error("Failed to toggle Quick Ask:", error);
	} finally {
		isSaving = false;
	}
}

/**
 * Handle platform selection change (radio button)
 */
async function handlePlatformSelect(platformId: string) {
	isSaving = true;
	try {
		await platformsStore.setQuickAskPlatform(platformId);
		logger.info("快速问答平台已切换", { platformId });
	} catch (error) {
		logger.error("Failed to change Quick Ask platform:", error);
	} finally {
		isSaving = false;
	}
}

/**
 * Handle hotkey interval change
 */
async function handleHotkeyIntervalChange(event: Event) {
	const target = event.target as HTMLInputElement;
	const value = parseInt(target.value, 10);
	try {
		await quickAskStore.setHotkeyInterval(value);
		logger.debug("热键时间窗已更新", { interval: value });
	} catch (error) {
		logger.error("更新热键时间窗失败", { error });
	}
}

/**
 * Toggle voice input enabled/disabled
 */
async function handleVoiceChange(event: Event) {
	const target = event.target as HTMLInputElement;
	const voiceEnabled = target.checked;

	isSaving = true;
	try {
		await quickAskStore.setVoiceEnabled(voiceEnabled);
	} catch (error) {
		logger.error("Failed to toggle voice input:", error);
	} finally {
		isSaving = false;
	}
}
</script>

<div class="settings-section">
	<h3 class="section-title">{t("quickAsk.settingsTitle")}</h3>

	<!-- Enable Quick Ask -->
	<div class="setting-item">
		<div class="setting-label">
			<span class="label-text">{t("quickAsk.enabled")}</span>
			<span class="label-description">{t("quickAsk.enabledDescription")}</span>
		</div>
		<label class="toggle-switch">
			<input
				type="checkbox"
				checked={quickAskStore.enabled}
				onchange={handleEnabledChange}
				disabled={isSaving}
			/>
			<span class="toggle-slider"></span>
		</label>
	</div>

	<!-- Select Platform (Radio List) -->
	<div class="setting-item platform-selector">
		<div class="setting-label">
			<span class="label-text">{t("quickAsk.selectPlatform")}</span>
			<span class="label-description">{t("quickAsk.selectPlatformDescription")}</span>
		</div>
		<div class="platform-list">
			{#if enabledPlatforms.length === 0}
				<div class="empty-state">
					<span class="warning-hint">{t("quickAsk.errors.noPlatform")}</span>
				</div>
			{:else}
				{#each enabledPlatforms as platform (platform.id)}
					<label class="platform-item">
						<input
							type="radio"
							name="quick-ask-platform"
							value={platform.id}
							checked={quickAskStore.selectedPlatformId === platform.id}
							onchange={() => handlePlatformSelect(platform.id)}
							disabled={isSaving || !quickAskStore.enabled}
						/>
						<div class="platform-info">
							{#if platform.icon}
								<img src={platform.icon} alt={platform.name} class="platform-icon" />
							{/if}
							<span class="platform-name">{platform.name}</span>
						</div>
						{#if quickAskStore.selectedPlatformId === platform.id}
							<span class="selected-badge">{t("translationSettings.defaultBadge")}</span>
						{/if}
					</label>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Hotkey Interval Slider -->
	<div class="setting-item">
		<div class="setting-label">
			<span class="label-text">{t("quickAsk.hotkeyLabel")}</span>
			<span class="label-description">{t("quickAsk.hotkeyDescription")}</span>
		</div>
		<div class="slider-control">
			<div class="slider-value">{quickAskStore.hotkeyInterval}ms</div>
			<input
				type="range"
				min="200"
				max="1000"
				step="50"
				value={quickAskStore.hotkeyInterval}
				oninput={handleHotkeyIntervalChange}
				disabled={!quickAskStore.enabled}
			/>
			<div class="slider-labels">
				<span>200ms</span>
				<span>1000ms</span>
			</div>
		</div>
	</div>

	<!-- Voice Input Toggle -->
	<div class="setting-item">
		<div class="setting-label">
			<span class="label-text">{t("quickAsk.voiceInputEnabled")}</span>
			<span class="label-description">{t("quickAsk.voiceInputDescription")}</span>
		</div>
		<label class="toggle-switch">
			<input
				type="checkbox"
				checked={quickAskStore.voiceEnabled}
				onchange={handleVoiceChange}
				disabled={isSaving || !quickAskStore.enabled}
			/>
			<span class="toggle-slider"></span>
		</label>
	</div>
</div>

<style>
.settings-section {
	padding: 1.5rem;
	max-width: 48rem;
}

.section-title {
	font-size: 1.125rem;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 1.25rem;
}

.setting-item {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	padding: 1rem 0;
	border-bottom: 1px solid var(--border-color);
	gap: 1rem;
}

.setting-item.platform-selector {
	flex-direction: column;
	align-items: stretch;
}

.setting-item:last-child {
	border-bottom: none;
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
	line-height: 1.4;
}

.warning-hint {
	font-size: 0.75rem;
	color: #f59e0b;
}

/* Platform Radio List */
.platform-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-top: 0.5rem;
}

.platform-item {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem;
	border: 1px solid var(--border-color);
	border-radius: 0.375rem;
	background: var(--bg-secondary);
	cursor: pointer;
	transition: all 0.2s;
}

.platform-item:hover:not(:has(input:disabled)) {
	background: var(--bg-hover);
	border-color: var(--accent-color);
}

.platform-item input[type="radio"] {
	width: 1rem;
	height: 1rem;
	cursor: pointer;
	accent-color: var(--accent-color);
}

.platform-item input[type="radio"]:disabled {
	cursor: not-allowed;
	opacity: 0.5;
}

.platform-info {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex: 1;
}

.platform-icon {
	width: 1.25rem;
	height: 1.25rem;
	object-fit: contain;
}

.platform-name {
	font-size: 0.875rem;
	color: var(--text-primary);
}

.selected-badge {
	font-size: 0.75rem;
	padding: 0.125rem 0.5rem;
	border-radius: 0.25rem;
	background: var(--accent-color);
	color: white;
}

.empty-state {
	padding: 1rem;
	text-align: center;
}

/* Slider Control */
.slider-control {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-width: 14rem;
}

.slider-value {
	font-size: 0.875rem;
	font-weight: 500;
	color: var(--accent-color);
	text-align: center;
}

input[type="range"] {
	width: 100%;
	height: 0.375rem;
	border-radius: 0.1875rem;
	background: var(--border-color);
	outline: none;
	cursor: pointer;
}

input[type="range"]::-webkit-slider-thumb {
	appearance: none;
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	background: var(--accent-color);
	cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	background: var(--accent-color);
	cursor: pointer;
	border: none;
}

input[type="range"]:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

input[type="range"]:disabled::-webkit-slider-thumb {
	cursor: not-allowed;
}

input[type="range"]:disabled::-moz-range-thumb {
	cursor: not-allowed;
}

.slider-labels {
	display: flex;
	justify-content: space-between;
	font-size: 0.75rem;
	color: var(--text-secondary);
}

/* Toggle Switch */
.toggle-switch {
	position: relative;
	display: inline-block;
	width: 3rem;
	height: 1.5rem;
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
	background-color: var(--bg-tertiary);
	border-radius: 1.5rem;
	transition: background-color 0.3s;
}

.toggle-slider::before {
	content: "";
	position: absolute;
	height: 1.125rem;
	width: 1.125rem;
	left: 0.1875rem;
	bottom: 0.1875rem;
	background-color: white;
	border-radius: 50%;
	transition: transform 0.3s;
}

.toggle-switch input:checked + .toggle-slider {
	background-color: var(--accent-color);
}

.toggle-switch input:checked + .toggle-slider::before {
	transform: translateX(1.5rem);
}

.toggle-switch input:disabled + .toggle-slider {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
