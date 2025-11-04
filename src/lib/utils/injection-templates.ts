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
		description: 'Fill textarea and click send button',
		urlPattern: 'https://chat\\.openai\\.com.*',
		actions: [
			{
				type: 'fill',
				target: {
					selector: '#prompt-textarea',
					timeout: 5000
				},
				content: '',
				triggerEvents: true
			},
			{
				type: 'wait',
				duration: 300
			},
			{
				type: 'click',
				target: {
					selector: 'button[data-testid="send-button"]',
					timeout: 3000
				},
				waitForVisible: true
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
				target: {
					selector: 'div[contenteditable="true"]',
					timeout: 5000
				},
				content: '',
				triggerEvents: true
			},
			{
				type: 'wait',
				duration: 300
			},
			{
				type: 'click',
				target: {
					selector: 'button[aria-label*="Send"]',
					timeout: 3000
				},
				waitForVisible: true
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
				target: {
					selector: '.ql-editor',
					timeout: 5000
				},
				content: '',
				triggerEvents: true
			},
			{
				type: 'wait',
				duration: 300
			},
			{
				type: 'click',
				target: {
					selector: 'button[aria-label*="Send"]',
					timeout: 3000
				},
				waitForVisible: true
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
				target: {
					selector: 'textarea[placeholder*="Send"]',
					timeout: 5000
				},
				content: '',
				triggerEvents: true
			},
			{
				type: 'wait',
				duration: 300
			},
			{
				type: 'click',
				target: {
					selector: 'button[type="submit"]',
					timeout: 3000
				},
				waitForVisible: true
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
		urlPattern: 'https://kimi\\.moonshot\\.cn.*',
		actions: [
			{
				type: 'fill',
				target: {
					selector: 'textarea',
					timeout: 5000
				},
				content: '',
				triggerEvents: true
			},
			{
				type: 'wait',
				duration: 300
			},
			{
				type: 'click',
				target: {
					selector: 'button[type="submit"]',
					timeout: 3000
				},
				waitForVisible: true
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
