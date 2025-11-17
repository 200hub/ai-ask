/**
 * 子 WebView 注入脚本生成工具
 * 架构概览：
 * 1. Fill  —— 向输入组件填充文本（支持 input / textarea / contenteditable）
 * 2. Click —— 以全事件序列模拟真实点击（pointer & mouse）
 * 3. Extract —— 轮询提取最新响应内容（由模板的 extractScript 控制 DOM 提取策略）
 *
 * 特性：
 * - 每个动作生成独立 Promise 脚本，被包裹在统一的注入 IIFE 中顺序执行
 * - 提取脚本返回 { text, html } 结构，后续由 injection-format.ts 做 Markdown 转换
 * - 结果通过分片 Base64URL 编码导航拦截回传（防止 URL 长度限制）
 * - 日志打印使用英文（跨团队调试一致性），代码注释中文便于维护
 */

import type {
  ClickAction,
  ExtractAction,
  ExtractOutputFormat,
  FillTextAction,
  InjectionAction,
} from '$lib/types/injection'
import { DEFAULT_EXTRACT_OUTPUT_FORMAT, DEFAULT_INJECTION_TIMEOUT } from './constants'
import { logger } from './logger'

/**
 * Escape string for safe embedding in JavaScript template literals
 */
// 安全转义文本以嵌入模板字符串，避免引号 / 换行 / 特殊 Unicode 破坏脚本文法
function escapeJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/'/g, '\\\'')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Generate element finder script
 * Returns a Promise that resolves to the found element
 */
// 生成元素查找脚本：轮询 querySelector，直到找到或超时（用于后续动作引用）
function generateFinderScript(selector: string, timeout?: number): string {
  const timeoutMs = timeout || DEFAULT_INJECTION_TIMEOUT
  const escapedSelector = escapeJs(selector)

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
    `.trim()
}

/**
 * Generate fill script
 * Supports: <input>, <textarea>, contenteditable elements
 */
// 生成填充脚本：尝试属性 setter，兼容触发 input/change 事件（可选）
export function generateFillScript(action: FillTextAction): string {
  const content = escapeJs(action.content)
  const triggerEvents = action.triggerEvents ?? true

  const finderScript = generateFinderScript(action.selector, action.timeout)

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
    ${
      triggerEvents
        ? `
    try { element.focus(); } catch(e) {}
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[FILL] Events triggered');
    `
        : ''
    }
    
    console.log('[FILL] Fill completed successfully');
    return { success: true, message: 'Text filled' };
})
    `.trim()
}

/**
 * Generate click script
 * Simulates full click sequence: pointerdown → mousedown → pointerup → mouseup → click
 */
// 生成点击脚本：派发 pointer 与 mouse 事件，确保框架/库能捕获到完整序列
export function generateClickScript(action: ClickAction): string {
  const finderScript = generateFinderScript(action.selector, action.timeout)

  return `
${finderScript}.then(element => {
    console.log('[CLICK] Starting click operation');
    if (!element) throw new Error('Element not found');
    
    // Get element rect once and reuse
    const rect = element.getBoundingClientRect();
    
    // Check visibility
    const style = window.getComputedStyle(element);
    if (rect.width === 0 || rect.height === 0 || 
        style.visibility === 'hidden' || style.display === 'none') {
        console.error('[CLICK] Element not visible');
        throw new Error('Element not visible');
    }
    console.log('[CLICK] Element is visible');
    
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
    `.trim()
}

/**
 * Generate extract script with polling until content is available
 * Continuously polls for content until non-empty or timeout
 */
// 生成提取脚本：轮询执行用户提供的 extractScript，直到有内容或超时
export function generateExtractScript(action: ExtractAction): string {
  const timeout = action.timeout || 10000 // 默认 10 秒
  const pollInterval = action.pollInterval || 500 // 默认 500ms 轮询
  const extractScript = action.extractScript || ''
  const outputFormat: ExtractOutputFormat = action.outputFormat ?? DEFAULT_EXTRACT_OUTPUT_FORMAT

  return `
(new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeout = ${timeout};
    const pollInterval = ${pollInterval};

    function normalizeExtractResult(raw) {
        if (typeof raw === 'string') {
            return { text: raw, html: '' };
        }
        if (raw && typeof raw === 'object') {
            const text = typeof raw.text === 'string' ? raw.text : '';
            const html = typeof raw.html === 'string' ? raw.html : '';
            return { text, html };
        }
        return { text: '', html: '' };
    }

    function tryExtract() {
        try {
            console.log('[EXTRACT] Attempting extraction...');
            
            // Execute custom extraction script
            const extractFn = ${extractScript};
            const raw = extractFn();
            const normalized = normalizeExtractResult(raw);
            const textContent = (normalized.text || '').trim();
            const htmlContent = (normalized.html || '').trim();
            
            if (textContent.length > 0 || htmlContent.length > 0) {
                console.log('[EXTRACT] Content found:', textContent.length || htmlContent.length, 'chars');
                resolve({ success: true, content: textContent, html: htmlContent, format: '${outputFormat}' });
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
    `.trim()
}

/**
 * Generate complete injection script with multiple actions
 */
// 聚合多个动作生成最终注入脚本：顺序执行并分片回传结果
export function generateInjectionScript(actions: InjectionAction[]): string {
  const scriptParts: string[] = []

  actions.forEach((action, index) => {
    let actionScript = ''

    switch (action.type) {
      case 'fill':
        actionScript = generateFillScript(action)
        break
      case 'click':
        actionScript = generateClickScript(action)
        break
      case 'extract':
        actionScript = generateExtractScript(action)
        break
      default:
        logger.warn('Unknown action type')
        return
    }

    // Add delay if specified
    const delay = 'delay' in action ? action.delay : 0
    if (delay && delay > 0) {
      scriptParts.push(`await new Promise(r => setTimeout(r, ${delay}));`)
    }

    scriptParts.push(`const result${index} = await (${actionScript});`)
    scriptParts.push(
      `results.push({ index: ${index}, type: '${action.type}', result: result${index} });`,
    )
  })

  return `
(async function() {
    // =============================================================================
    // AI-Ask Auto Injection Script
    // This IIFE executes actions and returns results via navigation intercept
    // All variables are scoped to avoid polluting the global namespace
    // =============================================================================
    
    console.log('[INJECTION] Starting ${actions.length} actions');
    const results = [];
    const startTime = Date.now();
    
    async function __sendResultLarge(obj) {
        try {
            console.log('[SEND-RESULT] Preparing transmission...');
            const json = JSON.stringify(obj);
            
            // Encode JSON to base64url (URL-safe base64)
            const base64 = btoa(unescape(encodeURIComponent(json)));
            let b64u = base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            
            // Split into chunks to avoid URL length limits (safe limit: 1800 chars per chunk)
            const CHUNK_SIZE = 1800;
            const totalChunks = Math.ceil(b64u.length / CHUNK_SIZE) || 1;
            console.log('[SEND-RESULT] Transmitting', b64u.length, 'bytes in', totalChunks, 'chunks');
            
            // Signal: begin
            try { 
                window.location.href = 'http://injection.localhost/begin?t=' + totalChunks; 
            } catch (e) { 
                console.error('[SEND-RESULT] Begin signal failed:', e); 
            }
            await new Promise(r => setTimeout(r, 10));
            
            // Send chunks
            for (let i = 0; i < totalChunks; i++) {
                const chunk = b64u.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                try { 
                    window.location.href = 'http://injection.localhost/chunk?i=' + i + '&t=' + totalChunks + '&d=' + chunk; 
                } catch (e) { 
                    console.error('[SEND-RESULT] Chunk', i, 'failed:', e); 
                }
                await new Promise(r => setTimeout(r, 10));
            }
            
            // Signal: end
            try { 
                window.location.href = 'http://injection.localhost/end?t=' + totalChunks; 
            } catch (e) { 
                console.error('[SEND-RESULT] End signal failed:', e); 
            }
            console.log('[SEND-RESULT] Transmission complete');
        } catch (e) {
            console.error('[SEND-RESULT] Fatal error:', e);
            // Attempt to send error signal
            try { 
                const msg = encodeURIComponent(String((e && e.message) || e)); 
                window.location.href = 'http://injection.localhost/error?m=' + msg; 
            } catch (_) {
                // Silent fail - nothing more we can do
            }
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
        
        // Send result back to Rust via navigation intercept
        await __sendResultLarge(result);
        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error('[INJECTION] Failed:', error);
        const result = {
            success: false,
            error: (error && error.message) || String(error),
            duration,
            actionsExecuted: results.length,
            results
        };
        await __sendResultLarge(result);
        return result;
    }
})().catch(err => {
    // Top-level error handler - should never reach here due to try-catch above
    console.error('[INJECTION] Uncaught error:', err);
});
    `.trim()
}

/**
 * Injection Manager
 * Manages injection templates and provides unified API
 */
// 注入管理器：负责模板注册与脚本生成的统一入口
export class InjectionManager {
  private templates: Map<string, import('$lib/types/injection').InjectionTemplate> = new Map()

  /**
   * Register an injection template
   */
  // 注册模板：按 platformId + name 组合键存储
  registerTemplate(template: import('$lib/types/injection').InjectionTemplate): void {
    const key = `${template.platformId}-${template.name}`
    this.templates.set(key, template)
    logger.debug('[InjectionManager] Template registered', {
      platformId: template.platformId,
      name: template.name,
    })
  }

  /**
   * Get template by platform and name
   */
  // 获取单个模板
  getTemplate(
    platformId: string,
    name: string,
  ): import('$lib/types/injection').InjectionTemplate | undefined {
    const key = `${platformId}-${name}`
    return this.templates.get(key)
  }

  /**
   * Get all templates for a platform
   */
  // 获取某平台所有模板
  getTemplatesForPlatform(platformId: string): import('$lib/types/injection').InjectionTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.platformId === platformId)
  }

  /**
   * Generate script from template, injecting content
   */
  // 根据模板生成注入脚本：自动把传入的 content 注入所有 fill 动作
  generateFromTemplate(platformId: string, templateName: string, content: string): string | null {
    const template = this.getTemplate(platformId, templateName)
    if (!template) {
      logger.error('[InjectionManager] Template not found', { platformId, templateName })
      return null
    }

    // Clone actions and inject content into fill actions
    const actions = template.actions.map((action) => {
      if (action.type === 'fill') {
        return { ...action, content }
      }
      return action
    })

    logger.info('[InjectionManager] Generating from template', {
      platformId,
      name: templateName,
      actionCount: actions.length,
    })

    return generateInjectionScript(actions)
  }

  /**
   * Generate standalone fill script
   */
  // 生成单次填充脚本（无需模板体系）
  generateFill(selector: string, content: string, triggerEvents = true, timeout?: number): string {
    const action: FillTextAction = {
      type: 'fill',
      selector,
      content,
      triggerEvents,
      timeout,
    }
    return `(async function() { return await (${generateFillScript(action)}); })();`
  }

  /**
   * Generate standalone click script
   */
  // 生成单次点击脚本
  generateClick(selector: string, timeout?: number): string {
    const action: ClickAction = {
      type: 'click',
      selector,
      timeout,
    }
    return `(async function() { return await (${generateClickScript(action)}); })();`
  }

  /**
   * Generate standalone extract script
   */
  // 生成单次提取脚本：可指定轮询参数与输出格式
  generateExtract(
    extractScript: string,
    timeout = 10000,
    pollInterval = 500,
    outputFormat?: ExtractOutputFormat,
  ): string {
    const action: ExtractAction = {
      type: 'extract',
      extractScript,
      timeout,
      pollInterval,
      outputFormat,
    }
    return `(async function() { return await (${generateExtractScript(action)}); })();`
  }
}

/**
 * Singleton instance
 */
export const injectionManager = new InjectionManager()
