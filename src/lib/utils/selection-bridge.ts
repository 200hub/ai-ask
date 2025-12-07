import type { InjectionAction } from '$lib/types/injection'
import type { AIPlatform, TranslationPlatform } from '$lib/types/platform'

import { SELECTION_TOOLBAR } from '$lib/utils/constants'
import { generateInjectionScript } from '$lib/utils/injection'
import {
  getDefaultChatTemplate,
  getDefaultTranslationTemplate,
} from '$lib/utils/injection-templates'
import { logger } from '$lib/utils/logger'
import { getConfig } from '$lib/utils/storage'

import { invoke } from '@tauri-apps/api/core'
import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

/**
 * 获取当前工具栏窗口位置
 */
async function getToolbarPosition(): Promise<{ x: number, y: number } | null> {
  try {
    const position = await invoke<{ x: number, y: number }>('get_cursor_position')
    return position
  }
  catch (error) {
    logger.warn('Failed to get toolbar position', error)
    return null
  }
}

/**
 * 确保主窗口可见（用于收藏功能）
 */
async function ensureMainWindowVisible(): Promise<void> {
  try {
    const mainWindow = await WebviewWindow.getByLabel('main')
    if (!mainWindow) {
      logger.warn('Main window not found while handling selection request')
      return
    }

    try {
      if (await mainWindow.isMinimized()) {
        await mainWindow.unminimize()
      }
    }
    catch (error) {
      logger.warn('Failed to update main window minimized state', error)
    }

    await mainWindow.show()
    await mainWindow.setFocus()

    try {
      await mainWindow.emit('restoreWebviews')
    }
    catch (error) {
      logger.warn('Failed to emit restoreWebviews event for main window', error)
    }
  }
  catch (error) {
    logger.error('Failed to focus main window', error)
  }
}

function sanitizeSelection(raw: string): string {
  return raw.trim()
}

/**
 * 获取翻译平台配置
 */
async function getTranslationPlatform(): Promise<TranslationPlatform | null> {
  try {
    const config = await getConfig()
    const translatorId = config.currentTranslator
    if (!translatorId) {
      return null
    }

    // 从配置中获取翻译平台（简化版，实际应从 store 获取）
    // 这里直接返回基本信息即可
    return {
      id: translatorId,
      name: translatorId,
      icon: '',
      url: '',
      enabled: true,
      supportLanguages: [],
    }
  }
  catch (error) {
    logger.error('Failed to get translation platform', error)
    return null
  }
}

/**
 * 获取 AI 解释平台配置
 */
async function getExplainPlatform(): Promise<AIPlatform | null> {
  try {
    const config = await getConfig()

    // 优先使用划词默认平台
    const platformId = config.selectionToolbarDefaultPlatformId
      || config.lastUsedPlatform
      || config.defaultPlatform

    if (!platformId) {
      return null
    }

    // 返回基本信息
    return {
      id: platformId,
      name: platformId,
      icon: '',
      url: '',
      enabled: true,
      isCustom: false,
      sortOrder: 0,
      selectionToolbarAvailable: true,
      preload: false,
    }
  }
  catch (error) {
    logger.error('Failed to get explain platform', error)
    return null
  }
}

/**
 * 构建解释提示词
 */
async function buildExplanationPrompt(text: string): Promise<string> {
  try {
    const config = await getConfig()
    const locale = config.locale || 'zh-CN'

    const prompts: Record<string, string> = {
      'zh-CN': `请解释以下内容：\n\n${text}`,
      'en-US': `Please explain the following:\n\n${text}`,
      'ja-JP': `以下の内容を説明してください：\n\n${text}`,
      'ko-KR': `다음 내용을 설명해 주세요:\n\n${text}`,
    }

    return prompts[locale] || prompts['zh-CN']
  }
  catch {
    return `请解释以下内容：\n\n${text}`
  }
}

/**
 * 显示浮动结果窗口并显示错误
 */
async function showResultWindowWithError(
  actionType: 'translate' | 'explain',
  errorMessage: string,
): Promise<void> {
  const toolbarPosition = await getToolbarPosition()

  await invoke('show_selection_result_window', {
    request: {
      action_type: actionType,
      text: '',
      platform_id: '',
      platform_name: '',
      toolbar_position: toolbarPosition,
      error_message: errorMessage,
    },
  })
}

/**
 * 显示浮动结果窗口并触发注入
 */
async function showResultWindowAndInject(
  actionType: 'translate' | 'explain',
  text: string,
  platformId: string,
  platformName: string,
  webviewId: string,
  injectionScript: string,
): Promise<void> {
  // 获取工具栏位置
  const toolbarPosition = await getToolbarPosition()

  // 显示结果窗口，传递 webviewId 以便过滤注入结果
  await invoke('show_selection_result_window', {
    request: {
      action_type: actionType,
      text,
      platform_id: platformId,
      platform_name: platformName,
      toolbar_position: toolbarPosition,
      webview_id: webviewId,
    },
  })

  // 确保 webview 存在
  await invoke('ensure_child_webview', {
    payload: {
      id: webviewId,
      url: '', // URL 会根据平台自动设置
    },
  })

  // 等待一小段时间让 webview 准备好
  await new Promise(resolve => setTimeout(resolve, 500))

  // 执行注入脚本
  try {
    await invoke('evaluate_child_webview_script', {
      payload: {
        id: webviewId,
        script: injectionScript,
      },
    })
    logger.info('Injection script executed', { webviewId, actionType })
  }
  catch (error) {
    logger.error('Failed to execute injection script', error)
    throw error
  }
}

/**
 * 请求翻译 - 使用浮动结果窗口
 */
export async function requestTranslation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Translation request skipped: text too short')
    return
  }

  logger.info('Requesting translation via floating window', { textLength: text.length })

  try {
    const platform = await getTranslationPlatform()
    if (!platform) {
      logger.warn('No translation platform configured')
      // 显示结果窗口并显示错误
      await showResultWindowWithError('translate', 'selectionResult.error.noPlatform')
      return
    }

    const template = getDefaultTranslationTemplate(platform.id)
    if (!template) {
      logger.warn('No injection template for translator', { translatorId: platform.id })
      // 显示结果窗口并显示错误
      await showResultWindowWithError('translate', 'selectionResult.error.noTemplate')
      return
    }

    // 构建注入动作
    const actions: InjectionAction[] = template.actions.map((action) => {
      if (action.type === 'fill') {
        return { ...action, content: text }
      }
      return action
    })

    const script = generateInjectionScript(actions)
    const webviewId = `translator-${platform.id}`

    await showResultWindowAndInject(
      'translate',
      text,
      platform.id,
      platform.name,
      webviewId,
      script,
    )
  }
  catch (error) {
    logger.error('Failed to request translation', error)
    // 显示结果窗口并显示错误
    await showResultWindowWithError('translate', 'selectionResult.error.failed')
  }
}

/**
 * 请求 AI 解释 - 使用浮动结果窗口
 */
export async function requestExplanation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Explanation request skipped: text too short')
    return
  }

  logger.info('Requesting explanation via floating window', { textLength: text.length })

  try {
    const platform = await getExplainPlatform()
    if (!platform) {
      logger.warn('No AI platform configured for explanation')
      await showResultWindowWithError(
        'explain',
        'selectionResult.error.noPlatform',
      )
      return
    }

    const template = getDefaultChatTemplate(platform.id)
    if (!template) {
      logger.warn('No injection template for AI platform', { platformId: platform.id })
      await showResultWindowWithError(
        'explain',
        'selectionResult.error.noTemplate',
      )
      return
    }

    // 构建提示词
    const prompt = await buildExplanationPrompt(text)

    // 构建注入动作
    const actions: InjectionAction[] = template.actions.map((action) => {
      if (action.type === 'fill') {
        return { ...action, content: prompt }
      }
      return action
    })

    const script = generateInjectionScript(actions)
    const webviewId = `ai-chat-${platform.id}`

    await showResultWindowAndInject(
      'explain',
      text,
      platform.id,
      platform.name,
      webviewId,
      script,
    )
  }
  catch (error) {
    logger.error('Failed to request explanation', error)
    await showResultWindowWithError(
      'explain',
      'selectionResult.error.failed',
    )
  }
}

/**
 * 请求收藏 - 保持原有行为（需要主窗口）
 */
export async function requestCollect(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (!text) {
    logger.debug('Collect request skipped: empty text')
    return
  }

  await ensureMainWindowVisible()

  try {
    await emitTo('main', 'selection-toolbar:collect', { text })
  }
  catch (error) {
    logger.error('Failed to emit collect request', error)
  }
}
