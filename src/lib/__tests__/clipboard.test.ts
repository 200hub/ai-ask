import { describe, it, expect, vi, beforeEach } from "vitest";
import { readClipboardText, ClipboardReadError, MAX_CLIPBOARD_LENGTH } from "$lib/utils/clipboard";

// Mock Tauri clipboard plugin
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	readText: vi.fn(),
}));

// Mock logger
vi.mock("$lib/utils/logger", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { readText } from "@tauri-apps/plugin-clipboard-manager";

describe("clipboard utils", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("readClipboardText", () => {
		it("returns null when clipboard is empty string", async () => {
			vi.mocked(readText).mockResolvedValue("");
			const result = await readClipboardText();
			expect(result).toBeNull();
		});

		it("returns null when clipboard contains only whitespace", async () => {
			vi.mocked(readText).mockResolvedValue("   \n\t  ");
			const result = await readClipboardText();
			expect(result).toBeNull();
		});

		it("trims whitespace by default", async () => {
			vi.mocked(readText).mockResolvedValue("  hello world  \n");
			const result = await readClipboardText();
			expect(result).toBe("hello world");
		});

		it("preserves whitespace when trim option is false", async () => {
			vi.mocked(readText).mockResolvedValue("  hello world  ");
			const result = await readClipboardText({ trim: false });
			expect(result).toBe("  hello world  ");
		});

		it("normalizes line endings (CRLF to LF)", async () => {
			vi.mocked(readText).mockResolvedValue("line1\r\nline2\r\nline3");
			const result = await readClipboardText();
			expect(result).toBe("line1\nline2\nline3");
		});

		it("truncates text exceeding max length", async () => {
			const longText = "a".repeat(MAX_CLIPBOARD_LENGTH + 100);
			vi.mocked(readText).mockResolvedValue(longText);
			const result = await readClipboardText();
			expect(result?.length).toBe(MAX_CLIPBOARD_LENGTH);
			expect(result).toBe("a".repeat(MAX_CLIPBOARD_LENGTH));
		});

		it("respects custom maxLength option", async () => {
			const longText = "hello world this is a long text";
			vi.mocked(readText).mockResolvedValue(longText);
			const result = await readClipboardText({ maxLength: 10 });
			expect(result?.length).toBe(10);
			expect(result).toBe("hello worl");
		});

		it("handles special characters correctly", async () => {
			const specialText = 'Hello "World" with \'quotes\' and\ttabs\nand newlines';
			vi.mocked(readText).mockResolvedValue(specialText);
			const result = await readClipboardText();
			expect(result).toContain('"World"');
			expect(result).toContain("'quotes'");
		});

		it("throws ClipboardReadError when readText fails", async () => {
			vi.mocked(readText).mockRejectedValue(new Error("Permission denied"));
			await expect(readClipboardText()).rejects.toThrow(ClipboardReadError);
		});

		it("returns null when clipboard content is not a string", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(readText).mockResolvedValue(null as any);
			const result = await readClipboardText();
			expect(result).toBeNull();
		});

		it("handles undefined clipboard content", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(readText).mockResolvedValue(undefined as any);
			const result = await readClipboardText();
			expect(result).toBeNull();
		});
	});
});
