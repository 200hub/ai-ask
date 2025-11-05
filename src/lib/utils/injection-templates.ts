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
				waitForVisible: true,
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					// Try multiple known selectors for ChatGPT assistant replies
					const candidates = [
						'div[data-message-author-role="assistant"]',
						'div[data-qa="assistant-message"]',
						'article:has([data-message-author-role="assistant"])'
					];
					for (const sel of candidates) {
						const container = Array.from(document.querySelectorAll(sel)).pop();
						if (container) {
							const p = container.querySelector('p');
							const text = p?.textContent?.trim();
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
				waitForVisible: true,
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					const candidates = [
						'[data-testid="chatMessage"] [data-testid="assistantMessage"]',
						'[data-testid*="assistant"]',
						'main article'
					];
					for (const sel of candidates) {
						const container = Array.from(document.querySelectorAll(sel)).pop();
						if (container) {
							const text = container.textContent?.trim();
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
				selector: 'div[contenteditable="true"][role="textbox"], .ql-editor, textarea',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[aria-label*="Send"], button[type="submit"]',
				waitForVisible: true,
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					const candidates = [
						'cib-message-group .markdown',
						'[role="feed"] article:last-child',
						'.prose'
					];
					for (const sel of candidates) {
						const container = Array.from(document.querySelectorAll(sel)).pop();
						if (container) {
							const text = container.textContent?.trim();
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
				selector: 'textarea, div[contenteditable="true"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[type="submit"], button[aria-label*="Send"], .send-button',
				waitForVisible: true,
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					const candidates = [
						'.assistant, .ai, .bot',
						'[data-role="assistant"]',
						'.message.assistant'
					];
					for (const sel of candidates) {
						const container = Array.from(document.querySelectorAll(sel)).pop();
						if (container) {
							const p = container.querySelector('p');
							const text = (p?.textContent || container.textContent)?.trim();
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
				selector: 'textarea, div[contenteditable="true"][role="textbox"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'click',
				selector: 'button[type="submit"], button[aria-label*="Send"], .send-button',
				waitForVisible: true,
				timeout: 3000
			},
			{
				type: 'extract',
				timeout: 30000,
				pollInterval: 1000,
				extractScript: `() => {
					const candidates = [
						'[data-testid*="assistant"], [class*="assistant"]',
						'[data-role="assistant"]',
						'.message.assistant'
					];
					for (const sel of candidates) {
						const container = Array.from(document.querySelectorAll(sel)).pop();
						if (container) {
							const p = container.querySelector('p');
							const text = (p?.textContent || container.textContent)?.trim();
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
 * All built-in templates
 */
export const ALL_TEMPLATES: InjectionTemplate[] = [
	...CHATGPT_TEMPLATES,
	...CLAUDE_TEMPLATES,
	...GEMINI_TEMPLATES,
	...DEEPSEEK_TEMPLATES,
	...KIMI_TEMPLATES
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
