/**
 * JavaScript injection manager for child webviews
 * Handles automatic DOM manipulation and event triggering
 */

import { logger } from './logger';
import type {
	InjectionAction,
	InjectionConfig,
	InjectionResult,
	InjectionTemplate,
	SelectorConfig
} from '$lib/types/injection';
import { DEFAULT_INJECTION_TIMEOUT, DEFAULT_MAX_RETRIES } from './constants';

/**
 * Generates JavaScript code to find an element based on selector config
 */
function generateElementFinderScript(config: SelectorConfig): string {
	const timeout = config.timeout || DEFAULT_INJECTION_TIMEOUT;
	const script = `
		(function() {
			return new Promise((resolve, reject) => {
				const startTime = Date.now();
				const timeout = ${timeout};
				
				function findElement() {
					try {
						let element = null;
						let context = document;
						
						// Handle iframe
						${
							config.iframeSelector
								? `
						const iframe = document.querySelector('${config.iframeSelector}');
						if (!iframe || !iframe.contentDocument) {
							throw new Error('Iframe not found or not accessible');
						}
						context = iframe.contentDocument;
						`
								: ''
						}
						
						// Handle shadow root
						${
							config.shadowRoot
								? `
						const shadowHost = context.querySelector('${config.shadowRoot}');
						if (!shadowHost || !shadowHost.shadowRoot) {
							throw new Error('Shadow root not found');
						}
						context = shadowHost.shadowRoot;
						`
								: ''
						}
						
						// Find target element
						element = context.querySelector('${config.selector}');
						
						if (element) {
							resolve(element);
						} else if (Date.now() - startTime > timeout) {
							reject(new Error('Element not found: ${config.selector}'));
						} else {
							setTimeout(findElement, 100);
						}
					} catch (error) {
						if (Date.now() - startTime > timeout) {
							reject(error);
						} else {
							setTimeout(findElement, 100);
						}
					}
				}
				
				findElement();
			});
		})();
	`;
	return script;
}

/**
 * Generates JavaScript code to fill text in an element
 */
function generateFillTextScript(
	selectorConfig: SelectorConfig,
	content: string,
	triggerEvents: boolean = true
): string {
	const finderScript = generateElementFinderScript(selectorConfig);
	const escapedContent = content.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

	return `
		${finderScript}.then(element => {
			if (!element) {
				throw new Error('Element not found');
			}
			
			// Set value based on element type
			if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
				element.value = '${escapedContent}';
			} else if (element.isContentEditable) {
				element.textContent = '${escapedContent}';
			} else {
				throw new Error('Element is not editable');
			}
			
			// Trigger events if requested
			${
				triggerEvents
					? `
			element.dispatchEvent(new Event('input', { bubbles: true }));
			element.dispatchEvent(new Event('change', { bubbles: true }));
			element.focus();
			`
					: ''
			}
			
			return { success: true, message: 'Text filled successfully' };
		});
	`;
}

/**
 * Generates JavaScript code to click an element
 */
function generateClickScript(selectorConfig: SelectorConfig, waitForVisible: boolean = true): string {
	const finderScript = generateElementFinderScript(selectorConfig);

	return `
		${finderScript}.then(element => {
			if (!element) {
				throw new Error('Element not found');
			}
			
			${
				waitForVisible
					? `
			// Check if element is visible
			const rect = element.getBoundingClientRect();
			const isVisible = rect.width > 0 && rect.height > 0 && 
				window.getComputedStyle(element).visibility !== 'hidden' &&
				window.getComputedStyle(element).display !== 'none';
			
			if (!isVisible) {
				throw new Error('Element is not visible');
			}
			`
					: ''
			}
			
			// Perform click
			element.click();
			
			return { success: true, message: 'Element clicked successfully' };
		});
	`;
}

/**
 * Generates JavaScript code for a wait action
 */
function generateWaitScript(duration: number): string {
	return `
		new Promise(resolve => {
			setTimeout(() => {
				resolve({ success: true, message: 'Wait completed' });
			}, ${duration});
		});
	`;
}

/**
 * Injection manager class
 * Handles script generation and execution coordination
 */
export class InjectionManager {
	private config: InjectionConfig;
	private templates: Map<string, InjectionTemplate[]>;

	constructor(config: InjectionConfig = {}) {
		this.config = {
			defaultTimeout: config.defaultTimeout || DEFAULT_INJECTION_TIMEOUT,
			debug: config.debug || false,
			maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES
		};
		this.templates = new Map();
		logger.info('InjectionManager initialized', { config: this.config });
	}

	/**
	 * Register an injection template
	 */
	registerTemplate(template: InjectionTemplate): void {
		const templates = this.templates.get(template.platformId) || [];
		templates.push(template);
		this.templates.set(template.platformId, templates);
		logger.info('Template registered', { platformId: template.platformId, name: template.name });
	}

	/**
	 * Get templates for a specific platform
	 */
	getTemplates(platformId: string): InjectionTemplate[] {
		return this.templates.get(platformId) || [];
	}

	/**
	 * Find matching template for a URL
	 */
	findTemplateForUrl(url: string, platformId?: string): InjectionTemplate | null {
		const templates = platformId ? this.getTemplates(platformId) : Array.from(this.templates.values()).flat();

		for (const template of templates) {
			const regex = new RegExp(template.urlPattern);
			if (regex.test(url)) {
				return template;
			}
		}

		return null;
	}

	/**
	 * Generate script for a single action
	 */
	generateActionScript(action: InjectionAction): string {
		switch (action.type) {
			case 'fill':
				return generateFillTextScript(
					action.target,
					action.content,
					action.triggerEvents !== false
				);

			case 'click':
				return generateClickScript(action.target, action.waitForVisible !== false);

			case 'wait':
				return generateWaitScript(action.duration);

			case 'custom':
				return action.script;

			default:
				throw new Error(`Unknown action type: ${(action as InjectionAction).type}`);
		}
	}

	/**
	 * Generate complete script for a sequence of actions
	 */
	generateSequenceScript(actions: InjectionAction[]): string {
		const actionScripts = actions.map((action, index) => {
			const delay = 'delay' in action && action.delay ? action.delay : 0;
			const script = this.generateActionScript(action);

			return `
				// Action ${index + 1}: ${action.type}
				${delay > 0 ? `await new Promise(resolve => setTimeout(resolve, ${delay}));` : ''}
				await (${script});
			`;
		});

		return `
			(async function() {
				const startTime = Date.now();
				const results = [];
				
				try {
					${actionScripts.join('\n')}
					
					return {
						success: true,
						duration: Date.now() - startTime,
						actionsExecuted: ${actions.length}
					};
				} catch (error) {
					return {
						success: false,
						error: error.message,
						duration: Date.now() - startTime,
						actionsExecuted: results.length
					};
				}
			})();
		`;
	}

	/**
	 * Generate script from a template
	 */
	generateTemplateScript(template: InjectionTemplate): string {
		if (this.config.debug) {
			logger.info('Generating script from template', {
				platformId: template.platformId,
				name: template.name,
				actionCount: template.actions.length
			});
		}

		return this.generateSequenceScript(template.actions);
	}

	/**
	 * Parse execution result from script output
	 */
	parseResult(output: unknown): InjectionResult {
		if (typeof output === 'object' && output !== null) {
			return output as InjectionResult;
		}

		return {
			success: false,
			error: 'Invalid result format'
		};
	}
}

/**
 * Create and export singleton instance
 */
export const injectionManager = new InjectionManager({
	debug: import.meta.env.DEV
});
