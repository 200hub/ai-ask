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

function escapeForJsString(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/'/g, "\\'")
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/**
 * Generates JavaScript code to find an element based on selector config
 */
function generateElementFinderScript(config: SelectorConfig): string {
	const timeout = config.timeout || DEFAULT_INJECTION_TIMEOUT;
	const selector = escapeForJsString(config.selector);
	const iframeSelector = config.iframeSelector ? escapeForJsString(config.iframeSelector) : null;
	const shadowSelector = config.shadowRoot ? escapeForJsString(config.shadowRoot) : null;

	return `
		(new Promise((resolve, reject) => {
			const startTime = Date.now();
			const timeout = ${timeout};

			console.log('[FINDER] Looking for element: ${selector}');

				function findElement() {
					try {
						let element = null;
						let context = document;

						${iframeSelector ? `
					console.log('[FINDER] Looking for iframe: ${iframeSelector}');
					const iframe = document.querySelector('${iframeSelector}');
					if (!iframe || !iframe.contentDocument) {
						throw new Error('Iframe not ready');
					}
					context = iframe.contentDocument;
					console.log('[FINDER] Iframe found');
					` : ''}

						${shadowSelector ? `
					console.log('[FINDER] Looking for shadow host: ${shadowSelector}');
					const shadowHost = context.querySelector('${shadowSelector}');
					if (!shadowHost || !shadowHost.shadowRoot) {
						throw new Error('Shadow root not ready');
					}
					context = shadowHost.shadowRoot;
					console.log('[FINDER] Shadow root found');
					` : ''}

						element = context.querySelector('${selector}');

						if (element) {
							console.log('[FINDER] Element found:', element);
							resolve(element);
							return;
						}

						const elapsed = Date.now() - startTime;
						if (elapsed > timeout) {
							console.error('[FINDER] Timeout after ' + elapsed + 'ms, element not found: ${selector}');
							reject(new Error('Element not found: ${selector}'));
							return;
						}

						setTimeout(findElement, 100);
					} catch (error) {
						const elapsed = Date.now() - startTime;
						if (elapsed > timeout) {
							console.error('[FINDER] Error while searching:', error);
							reject(error);
						} else {
							setTimeout(findElement, 100);
						}
					}
				}

			findElement();
		}))
	`.trim();
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
	const valueToSet = escapeForJsString(content);

	return `
		${finderScript}.then(element => {
			console.log('[FILL] Filling element:', element ? element.tagName : 'N/A', element);
			
			if (!element) {
				throw new Error('Element not found');
			}

			const valueToSet = '${valueToSet}';
			const dispatchInput = () => {
				const evtOptions = { bubbles: true, cancelable: false, composed: true };
				try {
					element.dispatchEvent(new InputEvent('input', evtOptions));
				} catch (_err) {
					element.dispatchEvent(new Event('input', evtOptions));
				}
				element.dispatchEvent(new Event('change', evtOptions));
			};

			if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
				console.log('[FILL] Setting value on', element.tagName, 'using native setter');
				const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
				const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
				if (descriptor && descriptor.set) {
					descriptor.set.call(element, valueToSet);
				} else {
					element.value = valueToSet;
				}
				try {
					element.focus();
				} catch (_err) {}
				try {
					if (typeof element.setSelectionRange === 'function') {
						element.setSelectionRange(valueToSet.length, valueToSet.length);
					}
				} catch (_err) {}
				if (${triggerEvents ? 'true' : 'false'}) {
					console.log('[FILL] Dispatching input/change events');
					dispatchInput();
				}
				console.log('[FILL] Value set (length):', valueToSet.length);
			} else if (element.isContentEditable) {
				console.log('[FILL] Setting contentEditable content');
				element.innerText = valueToSet;
				try {
					element.focus();
				} catch (_err) {}
				if (${triggerEvents ? 'true' : 'false'}) {
					dispatchInput();
				}
			} else {
				console.error('[FILL] Element is not editable:', element);
				throw new Error('Element is not editable');
			}

			console.log('[FILL] Fill completed successfully');
			return { success: true, message: 'Text filled successfully' };
		});
	`.trim();
}

/**
 * Generates JavaScript code to click an element
 */
function generateClickScript(selectorConfig: SelectorConfig, waitForVisible: boolean = true): string {
	const finderScript = generateElementFinderScript(selectorConfig);

	return `
		${finderScript}.then(element => {
			console.log('[CLICK] Clicking element:', element ? element.tagName : 'N/A', element);
			
			if (!element) {
				throw new Error('Element not found');
			}

			const rect = element.getBoundingClientRect();
			const isVisible = rect.width > 0 && rect.height > 0 &&
				window.getComputedStyle(element).visibility !== 'hidden' &&
				window.getComputedStyle(element).display !== 'none';

			console.log('[CLICK] Element visibility:', isVisible, rect);
			${waitForVisible ? `if (!isVisible) {
				throw new Error('Element is not visible');
			}
			` : `console.log('[CLICK] Visibility check disabled');
			`}

			console.log('[CLICK] Performing click sequence');
			try {
				element.focus();
			} catch (_err) {}
			const evtInit = { bubbles: true, cancelable: true, composed: true, view: window };
			const centerX = (rect.left + rect.right) / 2;
			const centerY = (rect.top + rect.bottom) / 2;
			const withCoords = (init) => Object.assign({ clientX: centerX, clientY: centerY }, init);
			element.dispatchEvent(new PointerEvent('pointerdown', withCoords(evtInit)));
			element.dispatchEvent(new MouseEvent('mousedown', withCoords(evtInit)));
			element.dispatchEvent(new PointerEvent('pointerup', withCoords(evtInit)));
			element.dispatchEvent(new MouseEvent('mouseup', withCoords(evtInit)));
			element.dispatchEvent(new MouseEvent('click', withCoords(evtInit)));
			console.log('[CLICK] Click sequence dispatched');
			
			return { success: true, message: 'Element clicked successfully' };
		});
	`.trim();
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
			const script = this.generateActionScript(action).trim();
			const resultVar = `actionResult${index + 1}`;
			const steps: string[] = [
				`// Action ${index + 1}: ${action.type}`,
				...(delay > 0 ? [`await new Promise(resolve => setTimeout(resolve, ${delay}));`] : []),
				`const ${resultVar} = await ${script};`,
				`results.push({ index: ${index}, type: '${action.type}', result: ${resultVar} });`
			];

			return steps.map((line) => `	${line}`).join('\n');
		});

		return `(async function() {
	console.log('[INJECTION] Script execution started, ${actions.length} actions');
	const startTime = Date.now();
	const results = [];
	const originalTitle = document.title;

	document.title = '[INJECTION_START]' + originalTitle;

	try {
${actionScripts.join('\n')}

		const duration = Date.now() - startTime;
		console.log('[INJECTION] All actions completed successfully', { duration, results });
		document.title = '[INJECTION_SUCCESS]' + originalTitle;
		setTimeout(() => { document.title = originalTitle; }, 1500);

		return {
			success: true,
			duration,
			actionsExecuted: ${actions.length},
			results
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const message = error && error.message ? error.message : String(error);
		console.error('[INJECTION] Script failed:', error);
		document.title = '[INJECTION_ERROR:' + message + ']' + originalTitle;
		setTimeout(() => { document.title = originalTitle; }, 3000);

		return {
			success: false,
			error: message,
			duration,
			actionsExecuted: results.length,
			results
		};
	}
})();`;
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

	/**
	 * Generate script to set up response monitoring in child webview
	 * The monitoring state is stored in window.__AI_ASK_MONITOR__
	 */
	generateResponseMonitorSetupScript(platformId: string, responseSelector: string): string {
		const escapedPlatformId = escapeForJsString(platformId);
		const selector = escapeForJsString(responseSelector);
		
		return `
(function() {
	console.log('[RESPONSE_MONITOR] Setting up response monitoring for ${selector}');
	
	// Initialize global monitoring state
	window.__AI_ASK_MONITOR__ = window.__AI_ASK_MONITOR__ || {};
	window.__AI_ASK_MONITOR__.platformId = '${escapedPlatformId}';
	window.__AI_ASK_MONITOR__.selector = '${selector}';
	window.__AI_ASK_MONITOR__.lastResponseIndex = -1;
	window.__AI_ASK_MONITOR__.responses = [];
	
	console.log('[RESPONSE_MONITOR] Setup complete');
	return { success: true, message: 'Response monitoring setup complete' };
})();
`.trim();
	}

	/**
	 * Generate script to check for new AI responses
	 * This should be called periodically from the main window
	 */
	generateResponseCheckScript(): string {
		// Step 1: Test if IIFE works
		return `
console.log('[RESPONSE_CHECK] Script starting...');
(function() {
	console.log('[RESPONSE_CHECK] Inside IIFE');
	
	if (!window.__AI_ASK_MONITOR__) {
		console.warn('[RESPONSE_CHECK] Monitor not initialized');
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = { hasNew: false, message: 'Monitor not initialized' };
		return;
	}
	
	console.log('[RESPONSE_CHECK] Monitor found:', window.__AI_ASK_MONITOR__);
	
	const monitor = window.__AI_ASK_MONITOR__;
	const selector = monitor.selector;
	const responseElements = document.querySelectorAll(selector);
	
	console.log('[RESPONSE_CHECK] Found', responseElements.length, 'response elements');
	
	if (responseElements.length === 0) {
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = { hasNew: false, message: 'No responses found' };
		return;
	}
	
	const currentIndex = responseElements.length - 1;
	console.log('[RESPONSE_CHECK] Current index:', currentIndex, 'Last index:', monitor.lastResponseIndex);
	
	if (currentIndex > monitor.lastResponseIndex) {
		const latestElement = responseElements[currentIndex];
		
		// Multi-strategy content extraction
		let content = '';
		
		// Strategy 1: Try innerText directly
		content = latestElement.innerText || '';
		console.log('[RESPONSE_CHECK] Strategy 1 (innerText):', content.length, 'chars');
		
		// Strategy 2: Look for common content selectors
		if (content.length === 0) {
			console.log('[RESPONSE_CHECK] Trying Strategy 2...');
			const selectors = ['.markdown', '[data-message-content]', '.prose', 'p', 'div'];
			for (const sel of selectors) {
				try {
					const elements = latestElement.querySelectorAll(sel);
					console.log('[RESPONSE_CHECK] Selector', sel, 'found', elements.length, 'elements');
					if (elements.length > 0) {
						const texts = [];
						for (let i = 0; i < elements.length; i++) {
							const el = elements[i];
							const text = el.innerText || el.textContent || '';
							const trimmed = text.trim();
							if (trimmed.length > 0) {
								texts.push(trimmed);
							}
						}
						
						if (texts.length > 0) {
							content = texts.join('\\n');
							console.log('[RESPONSE_CHECK] Strategy 2 (selector ' + sel + '):', content.length, 'chars');
							break;
						}
					}
				} catch (e) {
					console.error('[RESPONSE_CHECK] Selector error:', sel, e);
				}
			}
		}
		
		// Strategy 3: TreeWalker fallback
		if (content.length === 0) {
			const walker = document.createTreeWalker(latestElement, NodeFilter.SHOW_TEXT, null);
			const textNodes = [];
			let node;
			while (node = walker.nextNode()) {
				const text = (node.textContent || '').trim();
				if (text.length > 0) {
					textNodes.push(text);
				}
			}
			content = textNodes.join(' ');
			console.log('[RESPONSE_CHECK] Strategy 3 (TreeWalker):', content.length, 'chars');
		}
		
		console.log('[RESPONSE_CHECK] Final content length:', content.length);
		
		monitor.lastResponseIndex = currentIndex;
		
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = {
			hasNew: true,
			platformId: monitor.platformId,
			response: {
				content: content,
				isComplete: true,
				timestamp: Date.now()
			}
		};
	} else {
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = { hasNew: false, message: 'No new responses' };
	}
	
	console.log('[RESPONSE_CHECK] Result stored');
})();
`.trim();
	}

	/**
	 * OLD VERSION - keeping for reference
	 */
	generateResponseCheckScriptFull(): string {
		// Full version with try-catch
		return `
console.log('[RESPONSE_CHECK] ===== SCRIPT EXECUTED =====');
(function() {
	try {
		console.log('[RESPONSE_CHECK] Starting check...');
		
		if (!window.__AI_ASK_MONITOR__) {
			console.warn('[RESPONSE_CHECK] Monitor not initialized');
			return { hasNew: false, message: 'Monitor not initialized' };
		}
		
		const monitor = window.__AI_ASK_MONITOR__;
		const selector = monitor.selector;
	
	console.log('[RESPONSE_CHECK] Selector:', selector, 'Last index:', monitor.lastResponseIndex);
	
	// Function to extract text content from element
	function extractContent(element) {
		if (!element) {
			console.warn('[RESPONSE_CHECK] extractContent: element is null');
			return '';
		}
		
		console.log('[RESPONSE_CHECK] Extracting from element:', element.tagName, element.className);
		
		// Strategy 1: Try innerText on the element itself (works if text is directly rendered)
		let text = element.innerText?.trim() || '';
		console.log('[RESPONSE_CHECK] Strategy 1 (innerText):', text.length, 'characters');
		if (text.length > 0) {
			return text;
		}
		
		// Strategy 2: Look for common content containers (ChatGPT, Claude, etc.)
		const contentSelectors = [
			'.markdown p', '.markdown div', '.markdown span',
			'[data-message-content]',
			'.message-content', '.prose p', '.prose div',
			'p', 'div[class*="content"]'
		];
		
		for (const sel of contentSelectors) {
			try {
				const contentElements = element.querySelectorAll(sel);
				if (contentElements.length > 0) {
					const texts = Array.from(contentElements)
						.map(el => el.innerText?.trim() || el.textContent?.trim() || '')
						.filter(t => t.length > 0);
					if (texts.length > 0) {
						text = texts.join('\n');
						console.log('[RESPONSE_CHECK] Strategy 2 (selector', sel + '):', text.length, 'characters');
						if (text.length > 0) {
							return text;
						}
					}
				}
			} catch (e) {
				// Selector might not be valid, continue
			}
		}
		
		// Strategy 3: TreeWalker to recursively extract all text nodes
		console.log('[RESPONSE_CHECK] Strategy 3: Using TreeWalker for recursive extraction');
		const textContent = [];
		const walker = document.createTreeWalker(
			element,
			4, // NodeFilter.SHOW_TEXT
			null
		);
		
		let node;
		while (node = walker.nextNode()) {
			const nodeText = node.textContent?.trim();
			if (nodeText && nodeText.length > 0) {
				textContent.push(nodeText);
			}
		}
		
		const result = textContent.join(' ');
		console.log('[RESPONSE_CHECK] Strategy 3 (TreeWalker):', result.length, 'characters');
		return result;
	}
	
	try {
		const responseElements = document.querySelectorAll(selector);
		
		console.log('[RESPONSE_CHECK] Found', responseElements.length, 'response elements');
		
		if (responseElements.length === 0) {
			console.log('[RESPONSE_CHECK] No responses found');
			return { hasNew: false, message: 'No responses found' };
		}
		
		// Check if there are new responses since last check
		const currentIndex = responseElements.length - 1;
		console.log('[RESPONSE_CHECK] Current index:', currentIndex, 'Last index:', monitor.lastResponseIndex);
		
		if (currentIndex > monitor.lastResponseIndex) {
			// Get the latest response
			const latestElement = responseElements[currentIndex];
			const content = extractContent(latestElement);
			
			// Check if response is still generating
			const isGenerating = !!document.querySelector('button[aria-label="Stop generating"]') ||
			                     !!document.querySelector('[data-testid="stop-button"]') ||
			                     !!document.querySelector('button[aria-label="停止生成"]');
			
			monitor.lastResponseIndex = currentIndex;
			monitor.responses.push({
				index: currentIndex,
				content: content,
				isComplete: !isGenerating,
				timestamp: Date.now()
			});
			
			console.log('[RESPONSE_MONITOR] New response detected', {
				index: currentIndex,
				contentLength: content.length,
				isComplete: !isGenerating
			});
			
			const result = {
				hasNew: true,
				platformId: monitor.platformId,
				response: {
					content: content,
					isComplete: !isGenerating,
					timestamp: Date.now()
				}
			};
			
			console.log('[RESPONSE_CHECK] Storing result:', result);
			window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = result;
			return result;
		} else if (currentIndex === monitor.lastResponseIndex) {
			// Check if the current response has been updated (streaming)
			const currentElement = responseElements[currentIndex];
			const content = extractContent(currentElement);
			const lastResponse = monitor.responses[monitor.responses.length - 1];
			
			if (lastResponse && content !== lastResponse.content) {
				const isGenerating = !!document.querySelector('button[aria-label="Stop generating"]') ||
				                     !!document.querySelector('[data-testid="stop-button"]') ||
				                     !!document.querySelector('button[aria-label="停止生成"]');
				
				lastResponse.content = content;
				lastResponse.isComplete = !isGenerating;
				lastResponse.timestamp = Date.now();
				
				console.log('[RESPONSE_MONITOR] Response updated (streaming)', {
					contentLength: content.length,
					isComplete: !isGenerating
				});
				
				const result = {
					hasNew: true,
					platformId: monitor.platformId,
					response: {
						content: content,
						isComplete: !isGenerating,
						timestamp: Date.now()
					}
				};
				
				console.log('[RESPONSE_CHECK] Storing result:', result);
				window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = result;
				return result;
			}
		}
		
		const result = { hasNew: false, message: 'No new responses' };
		console.log('[RESPONSE_CHECK] Storing result:', result);
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = result;
		return result;
	} catch (error) {
		console.error('[RESPONSE_CHECK] Fatal error:', error);
		console.error('[RESPONSE_CHECK] Stack:', error.stack);
		const result = { hasNew: false, error: String(error) };
		window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__ = result;
		return result;
	}
})();`.trim();
	}
}

/**
 * Create and export singleton instance
 */
export const injectionManager = new InjectionManager({
	debug: import.meta.env.DEV
});
