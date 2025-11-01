import { describe, it, expect, beforeEach, vi } from "vitest";
import { quickAskStore } from "$lib/stores/quick-ask.svelte";

// Mock modules
vi.mock("$lib/utils/clipboard", () => {
	class ClipboardReadError extends Error {
		constructor(message: string, options?: ErrorOptions) {
			super(message, options);
			this.name = "ClipboardReadError";
		}
	}

	return {
		readClipboardText: vi.fn(),
		ClipboardReadError,
	};
});

vi.mock("$lib/utils/logger", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("$lib/stores/config.svelte", () => ({
	configStore: {
		initialized: true,
		config: {
			quickAsk: {
				enabled: true,
				selectedPlatformId: "chatgpt",
				hotkeyInterval: 400,
				voiceEnabled: false,
			},
		},
		init: vi.fn(),
		update: vi.fn(),
	},
}));

import { readClipboardText, ClipboardReadError } from "$lib/utils/clipboard";
import { configStore } from "$lib/stores/config.svelte";

describe("QuickAskStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		quickAskStore.close();
	});

	describe("state getters", () => {
		it("returns initial state", () => {
			expect(quickAskStore.isOpen).toBe(false);
			expect(quickAskStore.question).toBe("");
			expect(quickAskStore.loading).toBe(false);
			expect(quickAskStore.error).toBeNull();
		});

		it("reflects config state after init", async () => {
			await quickAskStore.init();
			expect(quickAskStore.enabled).toBe(true);
			expect(quickAskStore.selectedPlatformId).toBe("chatgpt");
			expect(quickAskStore.hotkeyInterval).toBe(400);
			expect(quickAskStore.voiceEnabled).toBe(false);
		});
	});

	describe("setQuestion", () => {
		it("updates question and clears error", () => {
			quickAskStore.setError("some error");
			quickAskStore.setQuestion("new question");
			expect(quickAskStore.question).toBe("new question");
			expect(quickAskStore.error).toBeNull();
		});
	});

	describe("setError", () => {
		it("sets error message and stops loading", () => {
			quickAskStore.setError("test error");
			expect(quickAskStore.error).toBe("test error");
			expect(quickAskStore.loading).toBe(false);
		});
	});

	describe("open", () => {
		it("sets isOpen to true and clears error", async () => {
			vi.mocked(readClipboardText).mockResolvedValue(null);
			await quickAskStore.open();
			expect(quickAskStore.isOpen).toBe(true);
			expect(quickAskStore.error).toBeNull();
		});

		it("auto-pastes clipboard content when available", async () => {
			vi.mocked(readClipboardText).mockResolvedValue("clipboard text");
			await quickAskStore.open();
			expect(quickAskStore.question).toBe("clipboard text");
		});

	it("handles clipboard read failure gracefully", async () => {
		const clipboardError = new ClipboardReadError("Permission denied");
		vi.mocked(readClipboardText).mockRejectedValue(clipboardError);
		await quickAskStore.open();
		expect(quickAskStore.isOpen).toBe(true);
		expect(quickAskStore.error).toBe("quickAsk.errors.clipboardFailed");
	});		it("does not set question when clipboard is null", async () => {
			vi.mocked(readClipboardText).mockResolvedValue(null);
			await quickAskStore.open();
			expect(quickAskStore.question).toBe("");
		});
	});

	describe("close", () => {
		it("resets all state", async () => {
			vi.mocked(readClipboardText).mockResolvedValue("test");
			await quickAskStore.open();
			quickAskStore.setError("error");
			quickAskStore.close();

			expect(quickAskStore.isOpen).toBe(false);
			expect(quickAskStore.question).toBe("");
			expect(quickAskStore.error).toBeNull();
			expect(quickAskStore.loading).toBe(false);
		});
	});

	describe("configuration methods", () => {
		beforeEach(async () => {
			await quickAskStore.init();
		});

		it("setSelectedPlatform updates config", async () => {
			await quickAskStore.setSelectedPlatform("claude");
			expect(configStore.update).toHaveBeenCalledWith({
				quickAsk: expect.objectContaining({
					selectedPlatformId: "claude",
				}),
			});
		});

		it("setHotkeyInterval clamps value between 200-1000ms", async () => {
			await quickAskStore.setHotkeyInterval(150);
			expect(configStore.update).toHaveBeenCalledWith({
				quickAsk: expect.objectContaining({
					hotkeyInterval: 200,
				}),
			});

			await quickAskStore.setHotkeyInterval(1500);
			expect(configStore.update).toHaveBeenCalledWith({
				quickAsk: expect.objectContaining({
					hotkeyInterval: 1000,
				}),
			});
		});

		it("setEnabled updates enabled state", async () => {
			await quickAskStore.setEnabled(false);
			expect(configStore.update).toHaveBeenCalledWith({
				quickAsk: expect.objectContaining({
					enabled: false,
				}),
			});
		});

		it("setVoiceEnabled updates voice state", async () => {
			await quickAskStore.setVoiceEnabled(true);
			expect(configStore.update).toHaveBeenCalledWith({
				quickAsk: expect.objectContaining({
					voiceEnabled: true,
				}),
			});
		});
	});
});
