/**
 * 子 WebView 注入相关 TypeScript 类型定义
 * 说明：
 * - 将一系列交互动作（填写 / 点击 / 提取）以结构化模板配置
 * - 提取动作支持返回原始文本或 { text, html } 供后续格式化为 Markdown
 * - outputFormat 字段用于标记期望格式（text / markdown），实际转换在 utils/injection-format.ts 中完成
 */

/**
 * Fill text action configuration
 */
export interface FillTextAction {
  type: 'fill'
  /**
   * CSS selector to find the target element
   */
  selector: string
  /**
   * Text content to fill
   */
  content: string
  /**
   * Whether to trigger input events (default: true)
   */
  triggerEvents?: boolean
  /**
   * Delay before filling in milliseconds (default: 0)
   */
  delay?: number
  /**
   * Wait timeout in milliseconds (default: 5000)
   */
  timeout?: number
}

/**
 * Click action configuration
 */
export interface ClickAction {
  type: 'click'
  /**
   * CSS selector to find the target element
   */
  selector: string
  /**
   * Delay before clicking in milliseconds (default: 0)
   */
  delay?: number
  /**
   * Wait timeout in milliseconds (default: 5000)
   */
  timeout?: number
}

/**
 * Extract content action configuration
 */
// 提取结果期望的输出格式：
// text -> 直接使用纯文本； markdown -> 若 extractScript 返回 HTML，则进行 Turndown 转换
export type ExtractOutputFormat = 'text' | 'markdown'

export interface ExtractAction {
  type: 'extract'
  /**
   * Maximum time to wait for content in milliseconds (default: 10000)
   */
  timeout?: number
  /**
   * Polling interval in milliseconds (default: 500)
   */
  pollInterval?: number
  /**
   * Custom JavaScript code to extract content
   * Function receives no parameters: () => string | { text?: string; html?: string }
   */
  extractScript: string
  /**
   * Desired output format for the extracted content
   */
  outputFormat?: ExtractOutputFormat
}

// 浏览器端执行 extractScript 后返回的初步结果（尚未格式化）
export interface ExtractScriptResult {
  success: boolean
  content: string
  html?: string
  format: ExtractOutputFormat
}

// formatExtractedContent 规范化后的结果结构
export interface FormattedExtractResult {
  format: ExtractOutputFormat
  text: string
  markdown?: string
  html?: string
}

/**
 * Union type of all action types
 */
// 统一动作联合类型，便于模板中使用 actions: InjectionAction[]
export type InjectionAction = FillTextAction | ClickAction | ExtractAction

/**
 * Injection template for a specific platform
 */
export interface InjectionTemplate {
  /**
   * Platform identifier (e.g., 'chatgpt', 'claude')
   */
  platformId: string
  /**
   * Template name
   */
  name: string
  /**
   * Template description
   */
  description?: string
  /**
   * URL pattern to match (regex string)
   */
  urlPattern: string
  /**
   * Sequence of actions to perform
   */
  actions: InjectionAction[]
}

/**
 * Injection execution result
 */
export interface InjectionResult {
  /**
   * Whether execution was successful
   */
  success: boolean
  /**
   * Error message if failed
   */
  error?: string
  /**
   * Execution duration in milliseconds
   */
  duration?: number
  /**
   * Number of actions executed
   */
  actionsExecuted?: number
}

/**
 * Injection manager configuration
 */
export interface InjectionConfig {
  /**
   * Default timeout for element selectors in milliseconds
   */
  defaultTimeout?: number
  /**
   * Whether to enable debug logging
   */
  debug?: boolean
  /**
   * Maximum retry attempts for failed actions
   */
  maxRetries?: number
}
