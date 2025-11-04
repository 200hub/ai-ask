/**
 * Unit tests for injection manager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InjectionManager } from '$lib/utils/injection';
import type {
	InjectionTemplate,
	FillTextAction,
	ClickAction,
	WaitAction,
	CustomScriptAction
} from '$lib/types/injection';

describe('InjectionManager', () => {
	let manager: InjectionManager;

	beforeEach(() => {
		manager = new InjectionManager({ debug: false });
	});

	describe('Template Management', () => {
		it('should register and retrieve templates', () => {
			const template: InjectionTemplate = {
				platformId: 'test-platform',
				name: 'Test Template',
				urlPattern: 'https://test\\.com.*',
				actions: []
			};

			manager.registerTemplate(template);
			const templates = manager.getTemplates('test-platform');

			expect(templates).toHaveLength(1);
			expect(templates[0]).toEqual(template);
		});

		it('should find template by URL pattern', () => {
			const template: InjectionTemplate = {
				platformId: 'chatgpt',
				name: 'Send Message',
				urlPattern: 'https://chat\\.openai\\.com.*',
				actions: []
			};

			manager.registerTemplate(template);
			const found = manager.findTemplateForUrl('https://chat.openai.com/chat');

			expect(found).not.toBeNull();
			expect(found?.platformId).toBe('chatgpt');
		});

		it('should return null for non-matching URL', () => {
			const template: InjectionTemplate = {
				platformId: 'chatgpt',
				name: 'Send Message',
				urlPattern: 'https://chat\\.openai\\.com.*',
				actions: []
			};

			manager.registerTemplate(template);
			const found = manager.findTemplateForUrl('https://example.com');

			expect(found).toBeNull();
		});
	});

	describe('Script Generation - Fill Text Action', () => {
		it('should generate fill text script with basic selector', () => {
			const action: FillTextAction = {
				type: 'fill',
				target: {
					selector: '#input-field'
				},
				content: 'Hello World'
			};

			const script = manager.generateActionScript(action);

			expect(script).toContain('#input-field');
			expect(script).toContain('Hello World');
			expect(script).toContain('element.value');
			expect(script).toContain('dispatchEvent');
		});

		it('should escape special characters in content', () => {
			const action: FillTextAction = {
				type: 'fill',
				target: {
					selector: '#input-field'
				},
				content: "Test with 'quotes' and \n newlines"
			};

			const script = manager.generateActionScript(action);

			expect(script).toContain("\\'quotes\\'");
			expect(script).toContain('\\n');
		});

		it('should include iframe selector if provided', () => {
			const action: FillTextAction = {
				type: 'fill',
				target: {
					selector: '#input-field',
					iframeSelector: '#my-iframe'
				},
				content: 'Test'
			};

			const script = manager.generateActionScript(action);

			expect(script).toContain('#my-iframe');
			expect(script).toContain('iframe');
		});

		it('should not trigger events if triggerEvents is false', () => {
			const action: FillTextAction = {
				type: 'fill',
				target: {
					selector: '#input-field'
				},
				content: 'Test',
				triggerEvents: false
			};

			const script = manager.generateActionScript(action);

			expect(script).not.toContain('dispatchEvent');
		});
	});

	describe('Script Generation - Click Action', () => {
		it('should generate click script with visibility check', () => {
			const action: ClickAction = {
				type: 'click',
				target: {
					selector: 'button.submit'
				}
			};

			const script = manager.generateActionScript(action);

			expect(script).toContain('button.submit');
			expect(script).toContain('click()');
			expect(script).toContain('getBoundingClientRect');
			expect(script).toContain('isVisible');
		});

		it('should skip visibility check if waitForVisible is false', () => {
			const action: ClickAction = {
				type: 'click',
				target: {
					selector: 'button.submit'
				},
				waitForVisible: false
			};

			const script = manager.generateActionScript(action);

			expect(script).not.toContain('getBoundingClientRect');
			expect(script).toContain('click()');
		});
	});

	describe('Script Generation - Wait Action', () => {
		it('should generate wait script with specified duration', () => {
			const action: WaitAction = {
				type: 'wait',
				duration: 1000
			};

			const script = manager.generateActionScript(action);

			expect(script).toContain('setTimeout');
			expect(script).toContain('1000');
		});
	});

	describe('Script Generation - Custom Action', () => {
		it('should use custom script directly', () => {
			const customCode = 'console.log("Custom action");';
			const action: CustomScriptAction = {
				type: 'custom',
				script: customCode
			};

			const script = manager.generateActionScript(action);

			expect(script).toBe(customCode);
		});
	});

	describe('Sequence Script Generation', () => {
		it('should generate script for action sequence', () => {
			const actions = [
				{
					type: 'fill' as const,
					target: { selector: '#input' },
					content: 'Test'
				},
				{
					type: 'wait' as const,
					duration: 300
				},
				{
					type: 'click' as const,
					target: { selector: 'button' }
				}
			];

			const script = manager.generateSequenceScript(actions);

			expect(script).toContain('async function');
			expect(script).toContain('Action 1: fill');
			expect(script).toContain('Action 2: wait');
			expect(script).toContain('Action 3: click');
			expect(script).toContain('success: true');
			expect(script).toContain('actionsExecuted');
		});

		it('should include delays for actions', () => {
			const actions = [
				{
					type: 'fill' as const,
					target: { selector: '#input' },
					content: 'Test',
					delay: 500
				}
			];

			const script = manager.generateSequenceScript(actions);

			expect(script).toContain('setTimeout');
			expect(script).toContain('500');
		});
	});

	describe('Template Script Generation', () => {
		it('should generate complete script from template', () => {
			const template: InjectionTemplate = {
				platformId: 'test',
				name: 'Test Flow',
				urlPattern: '.*',
				actions: [
					{
						type: 'fill',
						target: { selector: '#input' },
						content: 'Hello'
					},
					{
						type: 'click',
						target: { selector: 'button' }
					}
				]
			};

			const script = manager.generateTemplateScript(template);

			expect(script).toContain('async function');
			expect(script).toContain('Action 1: fill');
			expect(script).toContain('Action 2: click');
		});
	});

	describe('Result Parsing', () => {
		it('should parse successful result', () => {
			const output = {
				success: true,
				duration: 1234,
				actionsExecuted: 3
			};

			const result = manager.parseResult(output);

			expect(result.success).toBe(true);
			expect(result.duration).toBe(1234);
			expect(result.actionsExecuted).toBe(3);
		});

		it('should parse error result', () => {
			const output = {
				success: false,
				error: 'Element not found'
			};

			const result = manager.parseResult(output);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Element not found');
		});

		it('should handle invalid result format', () => {
			const output = 'invalid';

			const result = manager.parseResult(output);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Invalid result format');
		});
	});
});
