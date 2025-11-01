/**
 * AI Platform Injection Utilities
 * Provides platform-specific JS injection to auto-fill and send questions
 */

import { logger } from "./logger";

/**
 * Injection strategy for a specific AI platform
 */
export interface PlatformInjectionStrategy {
	/**
	 * Selector for the main input field
	 */
	inputSelector: string;

	/**
	 * Selector for the send button
	 */
	sendButtonSelector: string;

	/**
	 * Selector to check if user is logged in (e.g., login button presence = not logged in)
	 * If this selector exists, user is considered NOT logged in
	 */
	loginCheckSelector?: string;

	/**
	 * Optional: custom function to set input value (if simple assignment doesn't work)
	 */
	setInputValue?: (question: string) => string;

	/**
	 * Optional: custom function to trigger send (if simple click doesn't work)
	 */
	triggerSend?: () => string;

	/**
	 * Optional: wait time (ms) before clicking send after setting input
	 */
	sendDelay?: number;

	/**
	 * Optional: max wait time (ms) for input element to appear
	 */
	waitForReadyMs?: number;
}

/**
 * Built-in injection strategies for supported platforms
 */
const PLATFORM_STRATEGIES: Record<string, PlatformInjectionStrategy> = {
	chatgpt: {
		inputSelector: "#prompt-textarea",
		sendButtonSelector: 'button[data-testid="send-button"]',
		loginCheckSelector: 'button:has-text("Log in"), button:has-text("Sign up")',
		waitForReadyMs: 5000,
		sendDelay: 200,
	},
	claude: {
		inputSelector: 'div[contenteditable="true"][data-placeholder]',
		sendButtonSelector: 'button[aria-label="Send Message"]',
		loginCheckSelector: 'a[href*="login"], button:has-text("Sign In")',
		waitForReadyMs: 5000,
		setInputValue: (question: string) => `
      const input = document.querySelector('div[contenteditable="true"][data-placeholder]');
      if (input) {
        input.focus();
        input.textContent = ${JSON.stringify(question)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `,
		sendDelay: 300,
	},
	gemini: {
		inputSelector: ".ql-editor",
		sendButtonSelector: 'button[aria-label="Send message"]',
		loginCheckSelector: 'a[href*="accounts.google.com"]',
		waitForReadyMs: 5000,
		sendDelay: 200,
	},
	// Add more platforms as needed
};

/**
 * Generate injection script for a given platform and question
 * 
 * Note: Currently unused as we rely on __quickAskInject function
 * injected during webview initialization. Kept for future enhancement.
 */
export function generateInjectionScript(
	strategy: PlatformInjectionStrategy,
	question: string,
): string {
	const escapedQuestion = JSON.stringify(question);
	const waitForReadyMs = strategy.waitForReadyMs || 5000;
	const sendDelay = strategy.sendDelay || 100;

	// Login check script (if loginCheckSelector exists)
	const loginCheckScript = strategy.loginCheckSelector
		? `
		// Check if user is logged in
			const loginElement = document.querySelector(${JSON.stringify(strategy.loginCheckSelector)});
			if (loginElement) {
				// Hash report: NOT_LOGGED_IN
				try {
					const url = new URL(location.href);
					url.hash = '__qa_err=NOT_LOGGED_IN';
					history.replaceState(null, document.title, url.toString());
				} catch (_) {}
				return { success: false, error: 'NOT_LOGGED_IN' };
			}
	`
		: "";

	// Wait for input element to appear
	const waitForInputScript = `
		let input = document.querySelector(${JSON.stringify(strategy.inputSelector)});
		if (!input) {
			// Wait for element to appear (max ${waitForReadyMs}ms)
			const startTime = Date.now();
			while (!input && (Date.now() - startTime) < ${waitForReadyMs}) {
				await new Promise(resolve => setTimeout(resolve, 100));
				input = document.querySelector(${JSON.stringify(strategy.inputSelector)});
			}
			if (!input) {
				throw new Error('Input field not found: ${strategy.inputSelector}');
			}
		}
	`;

	// Set input value script
	const setValueScript =
		strategy.setInputValue?.(question) ||
		`
    input.focus();
		if (input.value !== undefined) {
			input.value = ${escapedQuestion};
		} else if (input.textContent !== undefined) {
			input.textContent = ${escapedQuestion};
		} else if (input.innerText !== undefined) {
			input.innerText = ${escapedQuestion};
		}
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  `;

	// Trigger send script
	const triggerSendScript =
		strategy.triggerSend?.() ||
		`
    const sendButton = document.querySelector(${JSON.stringify(strategy.sendButtonSelector)});
    if (!sendButton) {
      throw new Error('Send button not found: ${strategy.sendButtonSelector}');
    }
		sendButton.disabled = false; // Ensure button is enabled
    sendButton.click();
  `;

	return `
(async function() {
	try {
		${loginCheckScript}
		${waitForInputScript}
		${setValueScript}
    
		// Wait before clicking send
		await new Promise(resolve => setTimeout(resolve, ${sendDelay}));
    
		${triggerSendScript}
    
		// Hash report: OK
		try {
			const url = new URL(location.href);
			url.hash = '__qa_ok';
			history.replaceState(null, document.title, url.toString());
		} catch (_) {}
    
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
})();
	`.trim();
}

/**
 * Inject question into a platform's webview and auto-send
 * 
 * @param platformId - The platform identifier (e.g., 'chatgpt', 'claude')
 * @param question - The question to inject
 * @returns Promise that resolves when injection is complete
 */
export async function injectQuestionToPlatform(
	platformId: string,
	question: string,
): Promise<void> {
	const strategy = PLATFORM_STRATEGIES[platformId];

	if (!strategy) {
		logger.warn(`No injection strategy found for platform: ${platformId}`);
		throw new Error(`Platform ${platformId} is not yet supported for Quick Ask`);
	}

	// Generate concrete injection script
	const script = generateInjectionScript(strategy, question);

	logger.info(`Injecting question into ${platformId} via command...`);

	try {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("inject_question_to_platform", {
			payload: {
				platform_id: platformId,
				question,
				script,
			},
		});
		logger.info(`Question delivered to ${platformId} (command method)`);

		const webviewId = `ai-chat-${platformId}`;
		// 前端轮询 fragment 接收状态
		const start = Date.now();
		const timeout = 2500;
		while (Date.now() - start < timeout) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const frag = (await invoke("get_child_webview_fragment", { payload: { id: webviewId } })) as any;
			if (typeof frag === "string") {
				if (frag === "__qa_ok") {
					await invoke("clear_child_webview_fragment", { payload: { id: webviewId } });
					return;
				}
				if (frag.startsWith("__qa_err=")) {
					const code = frag.substring("__qa_err=".length);
					await invoke("clear_child_webview_fragment", { payload: { id: webviewId } });
					throw new Error(code);
				}
			}
			await new Promise((r) => setTimeout(r, 120));
		}
		// 超时视为成功提交
		return;
	} catch (error) {
		logger.error(`Failed to inject question to ${platformId}:`, error);
		throw error;
	}
}

/**
 * Check if a platform is supported for Quick Ask injection
 */
export function isPlatformSupported(platformId: string): boolean {
	return platformId in PLATFORM_STRATEGIES;
}

/**
 * Get injection strategy for a specific platform
 */
export function getPlatformStrategy(platformId: string): PlatformInjectionStrategy | undefined {
	return PLATFORM_STRATEGIES[platformId];
}

/**
 * Get all supported platform IDs
 */
export function getSupportedPlatforms(): string[] {
	return Object.keys(PLATFORM_STRATEGIES);
}
