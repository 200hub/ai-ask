import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { logger } from "$lib/utils/logger";

export const MAX_CLIPBOARD_LENGTH = 8000;

export class ClipboardReadError extends Error {
	constructor(message = "Failed to read clipboard text", options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ClipboardReadError";
	}
}

/**
 * 读取剪贴板文本并进行基础清洗
 */
export async function readClipboardText(options?: {
	maxLength?: number;
	trim?: boolean;
}): Promise<string | null> {
	const maxLength = options?.maxLength ?? MAX_CLIPBOARD_LENGTH;
	const shouldTrim = options?.trim ?? true;

	try {
		const rawText = await readText();

		if (typeof rawText !== "string" || rawText.length === 0) {
			return null;
		}

		let normalized = shouldTrim ? rawText.trim() : rawText;
		normalized = normalized.replace(/\r\n/g, "\n");

		if (!normalized) {
			return null;
		}

		if (normalized.length > maxLength) {
			logger.warn("Clipboard text exceeded max length, truncating", {
				originalLength: normalized.length,
				maxLength,
			});
			normalized = normalized.slice(0, maxLength);
		}

		return normalized;
	} catch (error) {
		logger.warn("Failed to access clipboard text", error);
		throw new ClipboardReadError("Failed to access clipboard", { cause: error });
	}
}
