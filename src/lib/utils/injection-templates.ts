/**
 * Pre-configured injection templates for different AI platforms and translation services
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
					// Wait for the good response button to appear (indicates generation is complete)
					// The good response button appears only after the assistant finishes streaming
					const respButtonSelectors = [
						'button[data-testid="good-response-turn-action-button"]',
					];
					
					let respButton = null;
					for (const sel of respButtonSelectors) {
						// Get the last good response button (latest assistant message)
						const buttons = document.querySelectorAll(sel);
						if (buttons.length > 0) {
							respButton = buttons[buttons.length - 1];
							break;
						}
					}
					
					if (!respButton) {
						return ''; // Good response not found, generation may still be in progress
					}
					
					// Extract text directly from the message container
					// Find the parent message container of the good response button
					let messageContainer = respButton.closest('[data-message-author-role="assistant"]');
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
					return '';
				}`
			}
		],
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
					// Wait for the copy button to appear (indicates generation is complete)
					// The copy button appears only after the assistant finishes streaming
					const copyButtonSelectors = [
						'button[data-testid="action-bar-copy"]',
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
					let messageContainer = copyButton.closest('div[data-is-streaming="false"]');
					if (!messageContainer) {
						// Try alternative selectors
						const allMessages = document.querySelectorAll('div[data-is-streaming="false"]');
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
						'.font-claude-response',
					];
					
					for (const sel of contentSelectors) {
						const contentDiv = messageContainer.querySelector(sel);
						if (contentDiv) {
							const text = contentDiv.textContent?.trim();
							if (text) return text;
						}
					}
					return '';
				}`
			}
		],
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
						'message-content'
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
					const tools_items = document.querySelectorAll('._0a3d93b');
					if (tools_items.length === 0) {
						return ''; // not found, generation may still be in progress
					}
					const last_tool = tools_items[tools_items.length - 1];
					// Extract text directly from the message container
					// Find the parent message container 
					let messageContainer = last_tool.parentNode.querySelector('.ds-message');
					const text = messageContainer.textContent?.trim();
					return text || '';
				}`
			}
		],
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
	}
];

/**
 * 通义千问 (Tongyi Qianwen) injection templates
 */
export const TONGYI_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'tongyi',
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
	}
];

/**
 * 文心一言 (ERNIE Bot) injection templates
 */
export const WENXIN_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'wenxin',
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
	}
];

/**
 * Google Translate injection templates
 */
export const GOOGLE_TRANSLATE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'google',
		name: 'Translate Text',
		description: 'Fill source text and extract translation result',
		urlPattern: 'https://translate\\.google\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[aria-label*="Source text"], textarea[aria-label*="源文本"], textarea.er8xn',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 15000,
				pollInterval: 800,
				extractScript: `() => {
					// Google Translate auto-translates, wait for result to appear
					const resultSelectors = [
						'span[data-language-for-alternatives]',
						'span.ryNqvb',
						'div[data-language-for-alternatives]',
						'span[jsname="jqKxS"]',
						'.Q4iAWc'
					];
					
					for (const sel of resultSelectors) {
						const elements = document.querySelectorAll(sel);
						if (elements.length > 0) {
							// Get the last/latest translation result
							const element = elements[elements.length - 1];
							const text = element.textContent?.trim();
							// Filter out placeholder text
							if (text && text !== 'Translation' && text !== '翻译' && text.length > 0) {
								return text;
							}
						}
					}
					
					// Fallback: try translation result panel
					const panel = document.querySelector('[aria-live="polite"]');
					if (panel) {
						const text = panel.textContent?.trim();
						if (text && text.length > 0) {
							return text;
						}
					}
					
					return ''; // Not ready yet
				}`
			}
		],
	}
];

/**
 * DeepL injection templates
 */
export const DEEPL_TRANSLATE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'deepl',
		name: 'Translate Text',
		description: 'Fill source text and extract translation result',
		urlPattern: 'https://www\\.deepl\\.com/translator.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea[data-testid="translator-source-input"], d-textarea[data-testid="translator-source-input"] textarea, div[contenteditable="true"][data-testid="translator-source-input"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 15000,
				pollInterval: 800,
				extractScript: `() => {
					// DeepL auto-translates, wait for result
					const resultSelectors = [
						'textarea[data-testid="translator-target-input"]',
						'd-textarea[data-testid="translator-target-input"] textarea',
						'div[contenteditable="true"][data-testid="translator-target-input"]',
						'.lmt__translations_as_text__text_btn'
					];
					
					for (const sel of resultSelectors) {
						const element = document.querySelector(sel);
						if (element) {
							const text = element.textContent?.trim() || (element as HTMLInputElement).value?.trim();
							// Filter loading states
							if (text && text !== 'Translating...' && text !== '翻译中...' && text.length > 0) {
								return text;
							}
						}
					}
					
					return ''; // Not ready yet
				}`
			}
		],
	}
];

/**
 * Youdao Translate injection templates
 */
export const YOUDAO_TRANSLATE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'youdao',
		name: 'Translate Text',
		description: 'Fill source text and extract translation result',
		urlPattern: 'https://fanyi\\.youdao\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: '#inputOriginal, #js_fanyi_input, textarea[placeholder*="请输入"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 15000,
				pollInterval: 800,
				extractScript: `() => {
					// Youdao auto-translates
					const resultSelectors = [
						'#transTarget',
						'#js_fanyi_output_resultOutput',
						'.output-bd p',
						'p[class*="wordGroup"]'
					];
					
					for (const sel of resultSelectors) {
						const element = document.querySelector(sel);
						if (element) {
							const text = element.textContent?.trim();
							if (text && text.length > 0) {
								return text;
							}
						}
					}
					
					// Try finding the translation result container
					const container = document.querySelector('.trans-container__trans, .fanyi__output');
					if (container) {
						const text = container.textContent?.trim();
						if (text && text.length > 0) {
							return text;
						}
					}
					
					return ''; // Not ready yet
				}`
			}
		],
	}
];

/**
 * Baidu Translate injection templates
 */
export const BAIDU_TRANSLATE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'baidu',
		name: 'Translate Text',
		description: 'Fill source text and extract translation result',
		urlPattern: 'https://fanyi\\.baidu\\.com.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea.textarea-input-origin, #baidu_translate_input, textarea[placeholder*="请输入"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 15000,
				pollInterval: 800,
				extractScript: `() => {
					// Baidu auto-translates
					const resultSelectors = [
						'p.target-output',
						'.target-output',
						'#transTarget p',
						'p[class*="output"]'
					];
					
					for (const sel of resultSelectors) {
						const elements = document.querySelectorAll(sel);
						if (elements.length > 0) {
							// Get text from all paragraphs in result
							const texts = Array.from(elements)
								.map(el => el.textContent?.trim())
								.filter(t => t && t.length > 0);
							if (texts.length > 0) {
								return texts.join('\\n');
							}
						}
					}
					
					// Fallback to container
					const container = document.querySelector('.output-bd, .target-output-wrap');
					if (container) {
						const text = container.textContent?.trim();
						if (text && text.length > 0) {
							return text;
						}
					}
					
					return ''; // Not ready yet
				}`
			}
		],
	}
];

/**
 * Bing Translator injection templates
 */
export const BING_TRANSLATE_TEMPLATES: InjectionTemplate[] = [
	{
		platformId: 'bing',
		name: 'Translate Text',
		description: 'Fill source text and extract translation result',
		urlPattern: 'https://www\\.bing\\.com/translator.*',
		actions: [
			{
				type: 'fill',
				selector: 'textarea#tta_input_ta, textarea[id*="input"]',
				content: '',
				triggerEvents: true,
				delay: 300,
				timeout: 5000
			},
			{
				type: 'extract',
				timeout: 15000,
				pollInterval: 800,
				extractScript: `() => {
					// Bing auto-translates
					const resultSelectors = [
						'textarea#tta_output_ta',
						'textarea[id*="output"]',
						'.lmt__target_textarea',
						'#t_sv'
					];
					
					for (const sel of resultSelectors) {
						const element = document.querySelector(sel);
						if (element) {
							const text = (element as HTMLTextAreaElement).value?.trim() || element.textContent?.trim();
							if (text && text.length > 0) {
								return text;
							}
						}
					}
					
					// Try to find output container
					const container = document.querySelector('.t_out, [id*="output"]');
					if (container) {
						const text = container.textContent?.trim();
						if (text && text.length > 0) {
							return text;
						}
					}
					
					return ''; // Not ready yet
				}`
			}
		],
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
	...TONGYI_TEMPLATES,
	...WENXIN_TEMPLATES,
	...DOUBAO_TEMPLATES,
	...YUANBAO_TEMPLATES,
	...GROK_TEMPLATES,
	...GOOGLE_TRANSLATE_TEMPLATES,
	...DEEPL_TRANSLATE_TEMPLATES,
	...YOUDAO_TRANSLATE_TEMPLATES,
	...BAIDU_TRANSLATE_TEMPLATES,
	...BING_TRANSLATE_TEMPLATES
];

const CHAT_TEMPLATE_REGISTRY = new Map<string, InjectionTemplate[]>([
	['chatgpt', CHATGPT_TEMPLATES],
	['claude', CLAUDE_TEMPLATES],
	['gemini', GEMINI_TEMPLATES],
	['deepseek', DEEPSEEK_TEMPLATES],
	['kimi', KIMI_TEMPLATES],
	['copilot', COPILOT_TEMPLATES],
	['tongyi', TONGYI_TEMPLATES],
	['wenxin', WENXIN_TEMPLATES],
	['doubao', DOUBAO_TEMPLATES],
	['yuanbao', YUANBAO_TEMPLATES],
	['grok', GROK_TEMPLATES],
]);

const TRANSLATION_TEMPLATE_REGISTRY = new Map<string, InjectionTemplate[]>([
	['google', GOOGLE_TRANSLATE_TEMPLATES],
	['deepl', DEEPL_TRANSLATE_TEMPLATES],
	['youdao', YOUDAO_TRANSLATE_TEMPLATES],
	['baidu', BAIDU_TRANSLATE_TEMPLATES],
	['bing', BING_TRANSLATE_TEMPLATES],
]);

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

/**
 * Get default chat template (first registered template) by platform ID
 */
export function getDefaultChatTemplate(platformId: string): InjectionTemplate | undefined {
	const templates = CHAT_TEMPLATE_REGISTRY.get(platformId);
	return templates?.[0];
}

/**
 * Get default translation template (first registered template) by platform ID
 */
export function getDefaultTranslationTemplate(platformId: string): InjectionTemplate | undefined {
	const templates = TRANSLATION_TEMPLATE_REGISTRY.get(platformId);
	return templates?.[0];
}
