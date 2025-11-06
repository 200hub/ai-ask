/**
 * Pre-configured injection templates for different AI platforms
 */

import type { InjectionTemplate } from '$lib/types/injection';

/**
 * ChatGPT injection templates
 */
export const CHATGPT_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'chatgpt',
		name: 'Send Message',
		description: 'Send message to ChatGPT and extract response',
		urlPattern: 'https://(chat\\.openai\\.com|chatgpt\\.com).*',
		actions: [
			{
				type: 'fill',
				selector: '#prompt-textarea',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[data-testid="send-button"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// Wait for the copy button to appear (indicates generation is complete)
					// The copy button appears only after the assistant finishes streaming
					const copyButtonSelectors = [
						'button[data-testid="copy-turn-action-button"]',
						'button[aria-label*="复制"]',
						'button[aria-label*="Copy"]'
					];
					
					let copyButton = null;
					for (const sel of copyButtonSelectors) {
						// Get the last copy button (latest assistant message)
						const buttons = document.querySelectorAll(sel);
						if (buttons.length > 0) {
							copyButton = buttons[buttons.length - 1];
							break;
						}
					}
					
					if (!copyButton) {
						return ''; // Copy button not found, generation may still be in progress
					}
					
					// Extract text directly from the message container
					// Find the parent message container of the copy button
					let messageContainer = copyButton.closest('[data-message-author-role="assistant"]');
					if (!messageContainer) {
						// Try alternative selectors
						const allMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
						if (allMessages.length > 0) {
							messageContainer = allMessages[allMessages.length - 1];
						}
					}
					
					if (!messageContainer) {
						return '';
					}
					
					// Try to get the markdown/prose content area
					// This contains the formatted response
					const contentSelectors = [
						'.markdown',
						'[class*="markdown"]',
						'.prose',
						'[class*="message-content"]',
						'[class*="Message"]'
					];
					
					for (const sel of contentSelectors) {
						const contentDiv = messageContainer.querySelector(sel);
						if (contentDiv) {
							const text = contentDiv.textContent?.trim();
							if (text) return text;
						}
					}
					
					// Fallback: get all text from message container
					// Filter out button texts and metadata
					const clone = messageContainer.cloneNode(true);
					// Remove buttons, icons, and other UI elements
					const elementsToRemove = clone.querySelectorAll('button, svg, [role="button"], .sr-only');
					elementsToRemove.forEach(el => el.remove());
					
					return clone.textContent?.trim() || '';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * Claude injection templates
 */
export const CLAUDE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'claude',
		name: 'Send Message',
		description: 'Fill textarea and click send button',
		urlPattern: 'https://claude\\.ai.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[placeholder*="Message"], div[contenteditable="true"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[data-testid="sendButton"], button[aria-label*="Send"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * Gemini injection templates
 */
export const GEMINI_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'gemini',
		name: 'Send Message',
		description: 'Fill textarea and submit',
		urlPattern: 'https://gemini\\.google\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'rich-textarea .ql-editor, div[contenteditable="true"][aria-label*="输入"], div[contenteditable="true"][data-placeholder], textarea',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[aria-label*="发送"], button[aria-label*="Send"], button.send-button, button[type="submit"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// Wait for stop button to disappear (generation complete)
					const stopButton = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
					if (stopButton && stopButton.offsetParent !== null) {
						return ''; // Still generating
					}
					
					const candidates = [
						'message-content model-response-text',
						'.model-response',
						'[data-test-id="model-response"]',
						'.response-container'
					];
					for (const sel of candidates) {
						const containers = document.querySelectorAll(sel);
						if (containers.length > 0) {
							const lastContainer = containers[containers.length - 1];
							const text = lastContainer.textContent?.trim();
							if (text) return text;
						}
					}
					return '';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * DeepSeek injection templates
 */
export const DEEPSEEK_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'deepseek',
		name: 'Send Message',
		description: 'Fill textarea and send',
		urlPattern: 'https://chat\\.deepseek\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[placeholder*="Message"], textarea[placeholder*="消息"], div[contenteditable="true"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: '.ds-icon-button._7436101',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * Kimi injection templates
 */
export const KIMI_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'kimi',
		name: 'Send Message',
		description: 'Fill textarea and send',
		urlPattern: 'https://(kimi\\.moonshot\\.cn|www\\.kimi\\.com).*',
		actions: [
			{
				type: 'fill',
				selector: 'div[class="chat-input-editor"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'div[class="send-button"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * Copilot (Microsoft) injection templates
 */
export const COPILOT_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'copilot',
		name: 'Send Message',
		description: 'Send message to Microsoft Copilot',
		urlPattern: 'https://copilot\\.microsoft\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: '#userInput',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[data-testid="submit-button"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * 通义千问 (Qwen) injection templates
 * TODO
 */
export const QWEN_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'qwen',
		name: 'Send Message',
		description: '向通义千问发送消息',
		urlPattern: 'https://www\\.tongyi\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[placeholder*="向千问提问"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: '.operateBtn-JsB9e2',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * 文心一言 (ERNIE Bot) injection templates
 * TODO
 */
export const ERNIE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'ernie',
		name: 'Send Message',
		description: '向文心一言发送消息',
		urlPattern: 'https://yiyan\\.baidu\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: '.yc-editor',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: '.btnContainer__Va2kMgqR',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * 豆包 (Doubao) injection templates
 */
export const DOUBAO_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'doubao',
		name: 'Send Message',
		description: '向豆包发送消息',
		urlPattern: 'https://(www\\.)?doubao\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[placeholder*="输入"], textarea[placeholder*="Ask"], div[contenteditable="true"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[aria-label*="发送"], button[aria-label*="Send"], .send-button',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * 腾讯元宝 (Yuanbao) injection templates
 */
export const YUANBAO_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'yuanbao',
		name: 'Send Message',
		description: '向腾讯元宝发送消息',
		urlPattern: 'https://yuanbao\\.qq\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: '.ql-editor',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 3000
			},
			{
				type: 'click',
				selector: '#yuanbao-send-btn',
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * Grok injection templates
 */
export const GROK_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'grok',
		name: 'Send Message',
		description: 'Send message to Grok',
		urlPattern: 'https://(x\\.com|twitter\\.com)/i/grok.*',
		actions: [
			{
				type: 'fill',
				selector: 'div[contenteditable="true"][translate="no"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[aria-label="Submit"]',
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// TODO
					return '_';
				}`
			}
		],
		autoExecute: false
	}
];

/**
 * All built-in templates
 */
export const ALL_TEMPLATES: InjectionTemplate[] = [
	...CHATGPT_TEMPLATES,
	...CLAUDE_TEMPLATES,
	...GEMINI_TEMPLATES,
	...DEEPSEEK_TEMPLATES,
	...KIMI_TEMPLATES,
	...COPILOT_TEMPLATES,
	...QWEN_TEMPLATES,
	...ERNIE_TEMPLATES,
	...DOUBAO_TEMPLATES,
	...YUANBAO_TEMPLATES,
	...GROK_TEMPLATES
];

/**
 * Get templates by platform ID
 */
export function getTemplatesByPlatform(platformId: string): InjectionTemplate[] {
	return ALL_TEMPLATES.filter((t) => t.platformId === platformId);
}

/**
 * Find template by name and platform
 */
export function findTemplate(platformId: string, name: string): InjectionTemplate | undefined {
	return ALL_TEMPLATES.find((t) => t.platformId === platformId && t.name === name);
}
