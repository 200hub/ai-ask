/**
 * JavaScript injection configuration and types for child webviews
 */

/**
 * Selector configuration for targeting DOM elements
 */
export interface SelectorConfig {
	/**
	 * CSS selector to find the target element
	 */
	selector: string;
	/**
	 * Optional iframe selector if element is inside iframe
	 */
	iframeSelector?: string;
	/**
	 * Optional shadow DOM selector path
	 */
	shadowRoot?: string;
	/**
	 * Wait timeout in milliseconds (default: 5000)
	 */
	timeout?: number;
}

/**
 * Fill text action configuration
 */
export interface FillTextAction {
	type: 'fill';
	/**
	 * Target element selector config
	 */
	target: SelectorConfig;
	/**
	 * Text content to fill
	 */
	content: string;
	/**
	 * Whether to trigger input events (default: true)
	 */
	triggerEvents?: boolean;
	/**
	 * Delay before filling in milliseconds (default: 0)
	 */
	delay?: number;
}

/**
 * Click action configuration
 */
export interface ClickAction {
	type: 'click';
	/**
	 * Target element selector config
	 */
	target: SelectorConfig;
	/**
	 * Delay before clicking in milliseconds (default: 0)
	 */
	delay?: number;
	/**
	 * Whether to wait for element to be visible (default: true)
	 */
	waitForVisible?: boolean;
}

/**
 * Wait action configuration
 */
export interface WaitAction {
	type: 'wait';
	/**
	 * Wait duration in milliseconds
	 */
	duration: number;
}

/**
 * Custom script action configuration
 */
export interface CustomScriptAction {
	type: 'custom';
	/**
	 * Custom JavaScript code to execute
	 */
	script: string;
	/**
	 * Delay before executing in milliseconds (default: 0)
	 */
	delay?: number;
}

/**
 * Union type of all action types
 */
export type InjectionAction = FillTextAction | ClickAction | WaitAction | CustomScriptAction;

/**
 * Injection template for a specific platform
 */
export interface InjectionTemplate {
	/**
	 * Platform identifier (e.g., 'chatgpt', 'claude')
	 */
	platformId: string;
	/**
	 * Template name
	 */
	name: string;
	/**
	 * Template description
	 */
	description?: string;
	/**
	 * URL pattern to match (regex string)
	 */
	urlPattern: string;
	/**
	 * Sequence of actions to perform
	 */
	actions: InjectionAction[];
	/**
	 * Whether to auto-execute on page load (default: false)
	 */
	autoExecute?: boolean;
}

/**
 * Injection execution result
 */
export interface InjectionResult {
	/**
	 * Whether execution was successful
	 */
	success: boolean;
	/**
	 * Error message if failed
	 */
	error?: string;
	/**
	 * Execution duration in milliseconds
	 */
	duration?: number;
	/**
	 * Number of actions executed
	 */
	actionsExecuted?: number;
}

/**
 * Injection manager configuration
 */
export interface InjectionConfig {
	/**
	 * Default timeout for element selectors in milliseconds
	 */
	defaultTimeout?: number;
	/**
	 * Whether to enable debug logging
	 */
	debug?: boolean;
	/**
	 * Maximum retry attempts for failed actions
	 */
	maxRetries?: number;
}
