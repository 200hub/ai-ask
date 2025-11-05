/**
 * JavaScript injection configuration and types for child webviews
 */

/**
 * Fill text action configuration
 */
export interface FillTextAction {
	type: 'fill';
	/**
	 * CSS selector to find the target element
	 */
	selector: string;
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
	/**
	 * Wait timeout in milliseconds (default: 5000)
	 */
	timeout?: number;
}

/**
 * Click action configuration
 */
export interface ClickAction {
	type: 'click';
	/**
	 * CSS selector to find the target element
	 */
	selector: string;
	/**
	 * Delay before clicking in milliseconds (default: 0)
	 */
	delay?: number;
	/**
	 * Whether to wait for element to be visible (default: true)
	 */
	waitForVisible?: boolean;
	/**
	 * Wait timeout in milliseconds (default: 5000)
	 */
	timeout?: number;
}

/**
 * Extract content action configuration
 */
export interface ExtractAction {
	type: 'extract';
	/**
	 * Maximum time to wait for content in milliseconds (default: 10000)
	 */
	timeout?: number;
	/**
	 * Polling interval in milliseconds (default: 500)
	 */
	pollInterval?: number;
	/**
	 * Custom JavaScript code to extract content
	 * Function receives no parameters: () => string
	 */
	extractScript: string;
}

/**
 * Union type of all action types
 */
export type InjectionAction = FillTextAction | ClickAction | ExtractAction;

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
