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

	private async ensurePlatformReady(platformId: string): Promise<void> {
		if (typeof window === "undefined") {
			return;
		}

		const { emit, listen } = await import("@tauri-apps/api/event");

		await new Promise<void>((resolve, reject) => {
			let resolved = false;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			let unlisten: (() => void) | null = null;

			const cleanup = () => {
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = undefined;
				}

				if (unlisten) {
					unlisten();
					unlisten = null;
				}
			};

			const settle = (result: "resolve" | "reject", error?: unknown) => {
				if (resolved) {
					return;
				}
				resolved = true;
				cleanup();
				if (result === "resolve") {
					resolve();
				} else {
					reject(error instanceof Error ? error : new Error(String(error ?? "PLATFORM_READY_FAILED")));
				}
			};

			const startListening = async () => {
				try {
					unlisten = await listen<{ platformId: string; success?: boolean; error?: string }>(
						"quick-ask-platform-ready",
						(event) => {
							if (event.payload.platformId !== platformId) {
								return;
							}

							if (event.payload.success === false) {
								settle("reject", event.payload.error ?? "PLATFORM_READY_FAILED");
								return;
							}

							settle("resolve");
						},
					);

					try {
						await emit("quick-ask-show-platform", { platformId });
					} catch (emitError) {
						settle("reject", emitError);
					}
				} catch (listenError) {
					settle("reject", listenError);
				}
			};

			startListening().catch((error) => {
				settle("reject", error);
			});

			timeoutId = setTimeout(() => {
				settle("reject", new Error("PLATFORM_READY_TIMEOUT"));
			}, 10000);
		});
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
			const { platformsStore } = await import("$lib/stores/platforms.svelte");

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

			logger.debug("Requesting main window to prepare platform for quick ask", {
				platformId: platform.id,
			});

			await this.ensurePlatformReady(platform.id);

			logger.info("Platform ready for quick ask", { platformId: platform.id });

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
