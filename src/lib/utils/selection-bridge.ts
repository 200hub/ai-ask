import type { InjectionAction } from '$lib/types/injection'
import type { AIPlatform, TranslationPlatform } from '$lib/types/platform'

import { SELECTION_TOOLBAR } from '$lib/utils/constants'
import { generateInjectionScript } from '$lib/utils/injection'
import {
  getDefaultChatTemplate,
  getDefaultTranslationTemplate,
} from '$lib/utils/injection-templates'
import { logger } from '$lib/utils/logger'
import { getAIPlatforms, getConfig, getTranslationPlatforms } from '$lib/utils/storage'

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
    logger.info('Getting translation platform', {
      translatorId,
      configKeys: Object.keys(config),
    })
    if (!translatorId) {
      logger.warn('No current translator configured')
      return null
    }

    // 直接从存储获取平台列表（因为划词工具栏窗口和主窗口是独立的）
    const platforms = await getTranslationPlatforms()
    logger.debug('Available translation platforms', {
      platformIds: platforms.map(p => p.id),
    })
    const platform = platforms.find(p => p.id === translatorId)

    if (!platform) {
      logger.warn('Translation platform not found in storage', { translatorId })
      return null
    }

    logger.debug('Got translation platform', { id: platform.id, url: platform.url })
    return platform
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
      logger.warn('No AI platform ID configured for explanation')
      return null
    }

    // 直接从存储获取平台列表（因为划词工具栏窗口和主窗口是独立的）
    const platforms = await getAIPlatforms()
    const platform = platforms.find(p => p.id === platformId)

    if (!platform) {
      logger.warn('AI platform not found in storage', { platformId })
      return null
    }

    logger.debug('Got explain platform', { id: platform.id, url: platform.url })
    return platform
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
 * 仅在窗口未打开时调用
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
 * 通知已显示的结果窗口发生错误
 * 在窗口已经打开后发生错误时使用
 */
async function notifyResultWindowError(errorMessage: string): Promise<void> {
  try {
    await emitTo('selection-result', 'selection-result:error', {
      errorMessage,
    })
  }
  catch (error) {
    logger.error('Failed to notify result window error', error)
  }
}

/**
 * 显示浮动结果窗口并触发注入
 * 注意：不修改 webview 的位置，只执行注入脚本
 * webview 保持在主窗口中，用户可以在主窗口中查看完整内容
 */
async function showResultWindowAndInject(
  actionType: 'translate' | 'explain',
  text: string,
  platformId: string,
  platformName: string,
  platformUrl: string,
  webviewId: string,
  injectionScript: string,
): Promise<void> {
  logger.info('showResultWindowAndInject called', {
    actionType,
    platformId,
    platformName,
    platformUrl,
    webviewId,
    textLength: text.length,
  })

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
  logger.debug('Result window shown')

  // 确保 webview 存在，但不修改其位置
  // webview 保持在主窗口中的原有位置，用户可以在主窗口中查看完整内容
  logger.debug('Ensuring child webview exists', { webviewId, platformUrl })
  await invoke('ensure_child_webview', {
    payload: {
      id: webviewId,
      url: platformUrl,
      // 不指定 bounds，让 webview 保持在主窗口中的位置
    },
  })
  logger.debug('Child webview ensured')

  // 等待一小段时间让 webview 准备好（减少等待时间以提高响应速度）
  await new Promise(resolve => setTimeout(resolve, 200))

  // 执行注入脚本
  logger.debug('Executing injection script', { webviewId })
  await invoke('evaluate_child_webview_script', {
    payload: {
      id: webviewId,
      script: injectionScript,
    },
  })
  logger.info('Injection script executed', { webviewId, actionType })
}

/**
 * 检查是否应该使用悬浮结果窗口
 * @returns 是否使用悬浮窗口，默认为 true
 */
async function shouldUseFloatingWindow(): Promise<boolean> {
  try {
    const config = await getConfig()
    // 如果配置未定义，默认使用悬浮窗口
    return config.selectionToolbarUseFloatingWindow !== false
  }
  catch {
    return true
  }
}

/**
 * 请求翻译 - 根据配置使用浮动结果窗口或直接打开主窗口
 */
export async function requestTranslation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Translation request skipped: text too short')
    return
  }

  // 检查是否使用悬浮窗口
  const useFloating = await shouldUseFloatingWindow()

  if (!useFloating) {
    // 直接使用主窗口模式 - 通过 Rust 命令发送事件到主窗口
    logger.info('Requesting translation via main window', { textLength: text.length })
    try {
      const platform = await getTranslationPlatform()
      if (!platform) {
        logger.warn('No translation platform configured')
        return
      }
      await invoke('open_platform_in_main_window', {
        platformId: platform.id,
        platformType: 'translation',
        text,
        action: 'translate',
      })
    }
    catch (error) {
      logger.error('Failed to open translation in main window', error)
    }
    return
  }

  // 使用悬浮结果窗口模式
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
      platform.url,
      webviewId,
      script,
    )
  }
  catch (error) {
    logger.error('Failed to request translation', error)
    // 通知已显示的窗口发生错误，而不是重新打开窗口
    await notifyResultWindowError('selectionResult.error.failed')
  }
}

/**
 * 请求 AI 解释 - 根据配置使用浮动结果窗口或直接打开主窗口
 */
export async function requestExplanation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Explanation request skipped: text too short')
    return
  }

  // 检查是否使用悬浮窗口
  const useFloating = await shouldUseFloatingWindow()

  if (!useFloating) {
    // 直接使用主窗口模式 - 通过 Rust 命令发送事件到主窗口
    logger.info('Requesting explanation via main window', { textLength: text.length })
    try {
      const platform = await getExplainPlatform()
      if (!platform) {
        logger.warn('No AI platform configured for explanation')
        return
      }
      await invoke('open_platform_in_main_window', {
        platformId: platform.id,
        platformType: 'ai',
        text,
        action: 'explain',
      })
    }
    catch (error) {
      logger.error('Failed to open explanation in main window', error)
    }
    return
  }

  // 使用悬浮结果窗口模式
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
      platform.url,
      webviewId,
      script,
    )
  }
  catch (error) {
    logger.error('Failed to request explanation', error)
    // 通知已显示的窗口发生错误，而不是重新打开窗口
    await notifyResultWindowError('selectionResult.error.failed')
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
