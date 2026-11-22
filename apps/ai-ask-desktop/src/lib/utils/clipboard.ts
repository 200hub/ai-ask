/**
 * 剪贴板工具模块
 *
 * 提供跨浏览器兼容的剪贴板复制功能。
 * 优先使用现代 Clipboard API，降级使用 execCommand 作为回退方案。
 */

import { CLIPBOARD } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'

/**
 * 复制文本到剪贴板
 *
 * 策略：
 * 1. 优先使用 navigator.clipboard.writeText（现代浏览器）
 * 2. 失败时回退到 document.execCommand('copy')（兼容旧浏览器）
 *
 * @param rawText - 要复制的文本
 * @throws 如果所有复制方法都失败
 *
 * @example
 * ```typescript
 * await copyTextToClipboard('Hello World');
 * ```
 */
export async function copyTextToClipboard(rawText: string): Promise<void> {
  const text = rawText ?? ''
  if (!text) {
    logger.debug('Clipboard copy skipped: empty text')
    return
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      logger.info('Clipboard copy completed via navigator.clipboard', { textLength: text.length })
      return
    }
    catch (error) {
      logger.warn('navigator.clipboard.writeText failed, falling back to execCommand', error)
    }
  }

  copyUsingExecCommand(text)
  logger.info('Clipboard copy completed via execCommand fallback', { textLength: text.length })
}

/**
 * 使用 execCommand 复制文本（回退方案）
 *
 * 创建一个隐藏的 textarea 元素，选中其内容后执行复制命令。
 * 这是为了兼容不支持 Clipboard API 的旧浏览器。
 *
 * @param text - 要复制的文本
 * @throws 如果 execCommand 失败
 */
function copyUsingExecCommand(text: string): void {
  if (typeof document === 'undefined') {
    throw new TypeError('Clipboard fallback unavailable: document is undefined')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = `${CLIPBOARD.OFFSCREEN_POSITION_PX}px`
  textarea.style.left = `${CLIPBOARD.OFFSCREEN_POSITION_PX}px`
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const success = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
  document.body.removeChild(textarea)
  if (typeof window !== 'undefined') {
    window.getSelection?.()?.removeAllRanges()
  }

  if (!success) {
    throw new Error('document.execCommand copy failed')
  }
}
