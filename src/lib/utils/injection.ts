/**
 * JavaScript injection utilities for child webviews
 * 
 * Core Architecture:
 * 1. Fill: Insert content into input elements
 * 2. Click: Trigger click events on buttons/elements
 * 3. Extract: Get content from response elements
 * 
 * Each operation accepts either:
 * - Selector (string or SelectorConfig): for standard DOM queries
 * - Custom JS code: for complex logic (must be complete function)
 */

import { logger } from './logger';
import type {
	FillTextAction,
	ClickAction,
	ExtractAction,
	InjectionAction
} from '$lib/types/injection';
import { DEFAULT_INJECTION_TIMEOUT } from './constants';

/**
 * Escape string for safe embedding in JavaScript template literals
 */
function escapeJs(value: string): string {
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
 * Generate element finder script
 * Returns a Promise that resolves to the found element
 */
function generateFinderScript(selector: string, timeout?: number): string {
	const timeoutMs = timeout || DEFAULT_INJECTION_TIMEOUT;
	const escapedSelector = escapeJs(selector);

	return `
(new Promise((resolve, reject) => {
	console.log('[FINDER] Looking for element:', '${escapedSelector}');
	const startTime = Date.now();
	const timeout = ${timeoutMs};
	
	function findElement() {
		try {
			const element = document.querySelector('${escapedSelector}');
			if (element) {
				console.log('[FINDER] Element found:', '${escapedSelector}');
				resolve(element);
				return;
			}
			
			if (Date.now() - startTime > timeout) {
				console.error('[FINDER] Timeout: Element not found:', '${escapedSelector}');
				reject(new Error('Element not found: ${escapedSelector}'));
				return;
			}
			
			setTimeout(findElement, 100);
		} catch (error) {
			if (Date.now() - startTime > timeout) {
				console.error('[FINDER] Error:', error);
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
 * Generate fill script
 * Supports: <input>, <textarea>, contenteditable elements
 */
export function generateFillScript(action: FillTextAction): string {
	const content = escapeJs(action.content);
	const triggerEvents = action.triggerEvents ?? true;

	const finderScript = generateFinderScript(action.selector, action.timeout);

	return `
${finderScript}.then(element => {
	console.log('[FILL] Starting fill operation');
	if (!element) throw new Error('Element not found');
	
	const value = '${content}';
	console.log('[FILL] Filling with value:', value.substring(0, 50) + (value.length > 50 ? '...' : ''));
	
	// Handle different element types
	if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
		// Native input/textarea: use property setter
		const descriptor = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(element),
			'value'
		);
		if (descriptor?.set) {
			descriptor.set.call(element, value);
		} else {
			element.value = value;
		}
		console.log('[FILL] Filled input/textarea element');
	} else if (element.isContentEditable) {
		// ContentEditable: set innerText
		element.innerText = value;
		console.log('[FILL] Filled contentEditable element');
	} else {
		throw new Error('Element is not editable');
	}
	
	// Trigger events if needed
	${triggerEvents ? `
	try { element.focus(); } catch(e) {}
	element.dispatchEvent(new Event('input', { bubbles: true }));
	element.dispatchEvent(new Event('change', { bubbles: true }));
	console.log('[FILL] Events triggered');
	` : ''}
	
	console.log('[FILL] Fill completed successfully');
	return { success: true, message: 'Text filled' };
})
	`.trim();
}

/**
 * Generate click script
 * Simulates full click sequence: pointerdown → mousedown → pointerup → mouseup → click
 */
export function generateClickScript(action: ClickAction): string {
	const waitForVisible = action.waitForVisible ?? true;

	const finderScript = generateFinderScript(action.selector, action.timeout);

	return `
${finderScript}.then(element => {
	console.log('[CLICK] Starting click operation');
	if (!element) throw new Error('Element not found');
	
	// Get element rect once and reuse
	const rect = element.getBoundingClientRect();
	${waitForVisible ? `
	// Check visibility
	const style = window.getComputedStyle(element);
	if (rect.width === 0 || rect.height === 0 || 
	    style.visibility === 'hidden' || style.display === 'none') {
		console.error('[CLICK] Element not visible');
		throw new Error('Element not visible');
	}
	console.log('[CLICK] Element is visible');
	` : ''}
	
	// Focus and dispatch full click sequence
	try { element.focus(); } catch(e) {}
	
	const centerX = (rect.left + rect.right) / 2;
	const centerY = (rect.top + rect.bottom) / 2;
	const opts = {
		bubbles: true,
		cancelable: true,
		view: window,
		clientX: centerX,
		clientY: centerY
	};
	
	console.log('[CLICK] Dispatching click events');
	element.dispatchEvent(new PointerEvent('pointerdown', opts));
	element.dispatchEvent(new MouseEvent('mousedown', opts));
	element.dispatchEvent(new PointerEvent('pointerup', opts));
	element.dispatchEvent(new MouseEvent('mouseup', opts));
	element.dispatchEvent(new MouseEvent('click', opts));
	
	console.log('[CLICK] Click completed successfully');
	return { success: true, message: 'Element clicked' };
})
	`.trim();
}

/**
 * Generate extract script with polling until content is available
 * Continuously polls for content until non-empty or timeout
 */
export function generateExtractScript(action: ExtractAction): string {
	const timeout = action.timeout || 10000; // 默认 10 秒
	const pollInterval = action.pollInterval || 500; // 默认 500ms 轮询
	const extractScript = action.extractScript || '';

	return `
(new Promise((resolve, reject) => {
	const startTime = Date.now();
	const timeout = ${timeout};
	const pollInterval = ${pollInterval};
	
	function tryExtract() {
		try {
			console.log('[EXTRACT] Attempting extraction...');
			
			// Execute custom extraction script
			const extractFn = ${extractScript};
			const content = extractFn();
			
			if (content && content.trim().length > 0) {
				console.log('[EXTRACT] Content found:', content.length, 'chars');
				resolve({ success: true, content: content.trim() });
				return;
			}
			
			// Check timeout
			const elapsed = Date.now() - startTime;
			if (elapsed > timeout) {
				console.warn('[EXTRACT] Timeout - no content found after', elapsed, 'ms');
				reject(new Error('Extract timeout: no content found'));
				return;
			}
			
			// Retry
			console.log('[EXTRACT] No content yet, retrying in', pollInterval, 'ms');
			setTimeout(tryExtract, pollInterval);
			
		} catch (error) {
			const elapsed = Date.now() - startTime;
			if (elapsed > timeout) {
				console.error('[EXTRACT] Error:', error);
				reject(error);
			} else {
				setTimeout(tryExtract, pollInterval);
			}
		}
	}
	
	tryExtract();
}))
	`.trim();
}

/**
 * Generate complete injection script with multiple actions
 */
export function generateInjectionScript(actions: InjectionAction[]): string {
	const scriptParts: string[] = [];

	actions.forEach((action, index) => {
		let actionScript = '';

		switch (action.type) {
			case 'fill':
				actionScript = generateFillScript(action);
				break;
			case 'click':
				actionScript = generateClickScript(action);
				break;
			case 'extract':
				actionScript = generateExtractScript(action);
				break;
			default:
				logger.warn('Unknown action type');
				return;
		}

		// Add delay if specified
		const delay = 'delay' in action ? action.delay : 0;
		if (delay && delay > 0) {
			scriptParts.push(`await new Promise(r => setTimeout(r, ${delay}));`);
		}

		scriptParts.push(`const result${index} = await (${actionScript});`);
		scriptParts.push(`results.push({ index: ${index}, type: '${action.type}', result: result${index} });`);
	});

	return `
(async function() {
	console.log('[INJECTION] Starting ${actions.length} actions');
	const results = [];
	const startTime = Date.now();
    
	// Helper: base64url encode JSON and stream via host-based navigation (http://injection.localhost)
	async function __sendResultLarge(obj) {
		try {
			console.log('[SEND-RESULT] Starting result transmission...');
			const json = JSON.stringify(obj);
			console.log('[SEND-RESULT] JSON length:', json.length);
			// utf8 -> base64
			const base64 = btoa(unescape(encodeURIComponent(json)));
			// Convert to base64url
			let b64u = base64.split('+').join('-').split('/').join('_');
			while (b64u.endsWith('=')) b64u = b64u.slice(0, -1);
			const CHUNK = 1800; // per-URL payload
			const total = Math.ceil(b64u.length / CHUNK) || 1;
			console.log('[SEND-RESULT] Will send', total, 'chunks');
			// begin
			console.log('[SEND-RESULT] Sending begin signal...');
			try { window.location.href = 'http://injection.localhost/begin?t=' + total; } catch (e) { console.error('[SEND-RESULT] Begin nav error:', e); }
			await new Promise(r => setTimeout(r, 10));
			// chunks
			for (let i = 0; i < total; i++) {
				const part = b64u.slice(i * CHUNK, (i + 1) * CHUNK);
				console.log('[SEND-RESULT] Sending chunk', i + 1, '/', total);
				try { window.location.href = 'http://injection.localhost/chunk?i=' + i + '&t=' + total + '&d=' + part; } catch (e) { console.error('[SEND-RESULT] Chunk nav error:', e); }
				await new Promise(r => setTimeout(r, 10));
			}
			// end
			console.log('[SEND-RESULT] Sending end signal...');
			try { window.location.href = 'http://injection.localhost/end?t=' + total; } catch (e) { console.error('[SEND-RESULT] End nav error:', e); }
			console.log('[SEND-RESULT] Transmission complete');
		} catch (e) {
			console.error('[SEND-RESULT] Fatal error:', e);
			try { window.location.href = 'http://injection.localhost/error?m=' + encodeURIComponent(String(e && e.message || e)); } catch (_) {}
		}
	}
    
	try {
		${scriptParts.join('\n\t\t')}
        
		const duration = Date.now() - startTime;
		console.log('[INJECTION] All actions completed', { duration, results });
		const result = {
			success: true,
			duration,
			actionsExecuted: ${actions.length},
			results
		};
		// Stream result to host via navigation chunks
		console.log('[INJECTION] Calling __sendResultLarge...');
		await __sendResultLarge(result);
		console.log('[INJECTION] __sendResultLarge returned');
		return result;
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error('[INJECTION] Failed:', error);
		const result = {
			success: false,
			error: error.message || String(error),
			duration,
			actionsExecuted: results.length,
			results
		};
		console.log('[INJECTION] Calling __sendResultLarge (error path)...');
		await __sendResultLarge(result);
		console.log('[INJECTION] __sendResultLarge returned (error path)');
		return result;
	}
})().catch(err => {
	console.error('[INJECTION] Uncaught:', err);
});
	`.trim();
}

/**
 * Injection Manager
 * Manages injection templates and provides unified API
 */
export class InjectionManager {
	private templates: Map<string, import('$lib/types/injection').InjectionTemplate> = new Map();

	/**
	 * Register an injection template
	 */
	registerTemplate(template: import('$lib/types/injection').InjectionTemplate): void {
		const key = `${template.platformId}-${template.name}`;
		this.templates.set(key, template);
		logger.debug('[InjectionManager] Template registered', { platformId: template.platformId, name: template.name });
	}

	/**
	 * Get template by platform and name
	 */
	getTemplate(platformId: string, name: string): import('$lib/types/injection').InjectionTemplate | undefined {
		const key = `${platformId}-${name}`;
		return this.templates.get(key);
	}

	/**
	 * Get all templates for a platform
	 */
	getTemplatesForPlatform(platformId: string): import('$lib/types/injection').InjectionTemplate[] {
		return Array.from(this.templates.values()).filter(t => t.platformId === platformId);
	}

	/**
	 * Generate script from template, injecting content
	 */
	generateFromTemplate(
		platformId: string,
		templateName: string,
		content: string
	): string | null {
		const template = this.getTemplate(platformId, templateName);
		if (!template) {
			logger.error('[InjectionManager] Template not found', { platformId, templateName });
			return null;
		}

		// Clone actions and inject content into fill actions
		const actions = template.actions.map(action => {
			if (action.type === 'fill') {
				return { ...action, content };
			}
			return action;
		});

		logger.info('[InjectionManager] Generating from template', { 
			platformId, 
			name: templateName, 
			actionCount: actions.length 
		});

		return generateInjectionScript(actions);
	}

	/**
	 * Generate standalone fill script
	 */
	generateFill(selector: string, content: string, triggerEvents = true, timeout?: number): string {
		const action: FillTextAction = {
			type: 'fill',
			selector,
			content,
			triggerEvents,
			timeout
		};
		return `(async function() { return await (${generateFillScript(action)}); })();`;
	}

	/**
	 * Generate standalone click script
	 */
	generateClick(selector: string, waitForVisible = true, timeout?: number): string {
		const action: ClickAction = {
			type: 'click',
			selector,
			waitForVisible,
			timeout
		};
		return `(async function() { return await (${generateClickScript(action)}); })();`;
	}

	/**
	 * Generate standalone extract script
	 */
	generateExtract(extractScript: string, timeout = 10000, pollInterval = 500): string {
		const action: ExtractAction = {
			type: 'extract',
			extractScript,
			timeout,
			pollInterval
		};
		return `(async function() { return await (${generateExtractScript(action)}); })();`;
	}
}

/**
 * Singleton instance
 */
export const injectionManager = new InjectionManager();
