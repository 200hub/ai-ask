/**
 * Quick Ask Store
 * 管理快速问答功能的运行状态与配置状态
 */

import { DEFAULT_CONFIG } from "$lib/types/config";
import { ClipboardReadError, readClipboardText } from "$lib/utils/clipboard";
import { logger } from "$lib/utils/logger";
import { configStore } from "./config.svelte";

type QuickAskConfigState = {
	enabled: boolean;
	selectedPlatformId: string | null;
	hotkeyInterval: number;
	voiceEnabled: boolean;
};

interface QuickAskState extends QuickAskConfigState {
	isOpen: boolean;
	question: string;
	loading: boolean;
	error: string | null;
	initialized: boolean;
}

class QuickAskStore {
	#state = $state<QuickAskState>({
		isOpen: false,
		question: "",
		loading: false,
		error: null,
		initialized: false,
		enabled: DEFAULT_CONFIG.quickAsk.enabled,
		selectedPlatformId: DEFAULT_CONFIG.quickAsk.selectedPlatformId,
		hotkeyInterval: DEFAULT_CONFIG.quickAsk.hotkeyInterval,
		voiceEnabled: DEFAULT_CONFIG.quickAsk.voiceEnabled,
	});

	get isOpen() {
		return this.#state.isOpen;
	}

	get question() {
		return this.#state.question;
	}

	set question(value: string) {
		this.setQuestion(value);
	}

	get loading() {
		return this.#state.loading;
	}

	get error() {
		return this.#state.error;
	}

	get enabled() {
		return this.#state.enabled;
	}

	get selectedPlatformId() {
		return this.#state.selectedPlatformId;
	}

	get hotkeyInterval() {
		return this.#state.hotkeyInterval;
	}

	get voiceEnabled() {
		return this.#state.voiceEnabled;
	}

	async init(): Promise<void> {
		if (this.#state.initialized) {
			this.syncConfigFromStore();
			return;
		}

		await this.loadConfigFromStore();
		this.#state.initialized = true;
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.#state.initialized) {
			await this.init();
		} else {
			this.syncConfigFromStore();
		}
	}

	private async loadConfigFromStore(): Promise<void> {
		if (!configStore.initialized) {
			await configStore.init();
		}
		this.applyConfig(configStore.config.quickAsk ?? DEFAULT_CONFIG.quickAsk);
	}

	private syncConfigFromStore(): void {
		if (!configStore.initialized) {
			return;
		}
		this.applyConfig(configStore.config.quickAsk ?? DEFAULT_CONFIG.quickAsk);
	}

	private applyConfig(config: QuickAskConfigState): void {
		this.#state.enabled = config.enabled;
		this.#state.selectedPlatformId = config.selectedPlatformId;
		this.#state.hotkeyInterval = config.hotkeyInterval;
		this.#state.voiceEnabled = config.voiceEnabled;
	}

	private getCurrentConfig(): QuickAskConfigState {
		return {
			enabled: this.#state.enabled,
			selectedPlatformId: this.#state.selectedPlatformId,
			hotkeyInterval: this.#state.hotkeyInterval,
			voiceEnabled: this.#state.voiceEnabled,
		};
	}

	private async saveQuickAskConfig(
		updates: Partial<QuickAskConfigState>,
	): Promise<void> {
		await this.ensureInitialized();

		const nextConfig: QuickAskConfigState = {
			...this.getCurrentConfig(),
			...updates,
		};

		try {
			await configStore.update({ quickAsk: nextConfig });
			this.applyConfig(configStore.config.quickAsk ?? nextConfig);
		} catch (error) {
			logger.error("Failed to persist Quick Ask config", error);
			throw error;
		}
	}

	async setSelectedPlatform(id: string | null): Promise<void> {
		await this.saveQuickAskConfig({ selectedPlatformId: id });
	}

	async setHotkeyInterval(intervalMs: number): Promise<void> {
		const clamped = Math.min(Math.max(Math.round(intervalMs), 200), 1000);
		await this.saveQuickAskConfig({ hotkeyInterval: clamped });
	}

	async setEnabled(enabled: boolean): Promise<void> {
		await this.saveQuickAskConfig({ enabled });
	}

	async setVoiceEnabled(enabled: boolean): Promise<void> {
		await this.saveQuickAskConfig({ voiceEnabled: enabled });
	}

	async open(): Promise<void> {
		await this.ensureInitialized();

		logger.debug("Opening Quick Ask");
		this.#state.isOpen = true;
		this.#state.error = null;

		try {
			const clipboardText = await readClipboardText();
			if (clipboardText) {
				this.#state.question = clipboardText;
				logger.debug("Auto-pasted clipboard content");
			}
		} catch (error) {
			if (error instanceof ClipboardReadError) {
				logger.warn("Failed to read clipboard for Quick Ask", error);
				this.setError("quickAsk.errors.clipboardFailed");
			} else if (error instanceof Error) {
				logger.warn("Unexpected clipboard error", error);
			} else {
				logger.warn("Unknown clipboard error");
			}
		}
	}

	close(): void {
		logger.debug("Closing Quick Ask");
		this.#state.isOpen = false;
		this.#state.question = "";
		this.#state.error = null;
		this.#state.loading = false;
	}

	setQuestion(text: string): void {
		this.#state.question = text;
		this.#state.error = null;
	}

	setError(message: string): void {
		this.#state.error = message;
		this.#state.loading = false;
	}

	async submit(): Promise<boolean> {
		await this.ensureInitialized();

		const trimmedQuestion = this.#state.question.trim();
		if (!trimmedQuestion) {
			this.setError("quickAsk.errors.emptyQuestion");
			return false;
		}

		this.#state.question = trimmedQuestion;

		const selectedPlatformId = this.#state.selectedPlatformId;
		if (!selectedPlatformId) {
			this.setError("quickAsk.errors.noPlatform");
			return false;
		}

		this.#state.loading = true;
		this.#state.error = null;

		try {
			const [{ appState }, { platformsStore }] = await Promise.all([
				import("$lib/stores/app.svelte"),
				import("$lib/stores/platforms.svelte"),
			]);

			// 确保 platformsStore 已加载平台列表
			if (!platformsStore.platforms || platformsStore.platforms.length === 0) {
				logger.debug("Platforms not loaded yet, initializing...");
				await platformsStore.init();
			}

			const platform = platformsStore.getPlatformById(selectedPlatformId);
			if (!platform) {
				this.setError("quickAsk.errors.noPlatform");
				this.#state.loading = false;
				return false;
			}

			if (!platform.enabled) {
				this.setError("quickAsk.errors.platformNotEnabled");
				this.#state.loading = false;
				return false;
			}

			logger.debug("Preparing to show platform for quick ask", {
				platformId: platform.id,
			});

			appState.switchToChatView(platform);

			const waitForChatWebviewReady = async (): Promise<void> => {
				if (typeof window === "undefined") {
					return;
				}

				logger.debug("Starting to wait for chat webview readiness", {
					platformId: platform.id,
					currentView: appState.currentView,
					selectedPlatform: appState.selectedPlatform?.id,
					webviewLoading: appState.webviewLoading,
				});

				const isReady = () =>
					appState.currentView === "chat" &&
					appState.selectedPlatform?.id === platform.id &&
					!appState.webviewLoading;

				await new Promise<void>((resolve, reject) => {
					let settled = false;
					let cleanup: () => void;

					const onReady = (event: Event) => {
						const detail = (event as CustomEvent<{ platformId: string }>).detail;
						logger.debug("Received chatWebviewReady event", {
							eventPlatformId: detail?.platformId,
							targetPlatformId: platform.id,
						});
						if (detail?.platformId === platform.id) {
							settled = true;
							cleanup();
							logger.debug("Chat webview ready via event", {
								platformId: platform.id,
							});
							resolve();
						}
					};

					const checkInterval = setInterval(() => {
						if (isReady()) {
							settled = true;
							cleanup();
							logger.debug("Chat webview ready via polling", {
								platformId: platform.id,
							});
							resolve();
						}
					}, 100);

					const timeoutId = setTimeout(() => {
						if (!settled) {
							cleanup();
							logger.error("Chat webview not ready within timeout", {
								platformId: platform.id,
								currentView: appState.currentView,
								selectedPlatform: appState.selectedPlatform?.id,
								webviewLoading: appState.webviewLoading,
							});
							reject(new Error("WEBVIEW_NOT_READY"));
						}
					}, 8000);

					cleanup = () => {
						window.removeEventListener("chatWebviewReady", onReady as EventListener);
						clearInterval(checkInterval);
						clearTimeout(timeoutId);
					};

					window.addEventListener("chatWebviewReady", onReady as EventListener);
				});

				logger.info("Chat webview ready for quick ask", {
					platformId: platform.id,
				});
			};

			await waitForChatWebviewReady();

			const { injectQuestionToPlatform } = await import("$lib/utils/injection");

			const pause = (ms: number) =>
				new Promise<void>((resolve) => {
					setTimeout(resolve, ms);
				});

			const attemptInjection = async (retries: number) => {
				try {
					await injectQuestionToPlatform(selectedPlatformId, trimmedQuestion);
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: typeof error === "string"
								? error
								: JSON.stringify(error);

					if (message === "NOT_LOGGED_IN") {
						logger.warn("Platform requires login", { platformId: selectedPlatformId });
						this.setError("quickAsk.errors.notLoggedIn");
						throw error;
					}

					if (retries > 0 && message.includes("子 webview 不存在")) {
						logger.warn("Target webview missing, retrying injection", {
							platformId: selectedPlatformId,
							remainingRetries: retries,
						});
						await pause(300);
						await attemptInjection(retries - 1);
						return;
					}

					throw error;
				}
			};

			await pause(100);
			await attemptInjection(2);

			this.#state.loading = false;
			logger.info("Question submitted successfully", { platformId: selectedPlatformId });
			return true;
		} catch (err) {
			logger.error("Failed to submit question:", err);
			// 保留更具体的未登录错误，不要被通用发送失败覆盖
			if (this.#state.error !== "quickAsk.errors.notLoggedIn") {
				this.setError("quickAsk.errors.sendFailed");
			}
			return false;
		}
	}
}

export const quickAskStore = new QuickAskStore();
