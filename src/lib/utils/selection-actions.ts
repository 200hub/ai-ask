/**
 * Selection Toolbar Actions - 划词工具栏操作逻辑
 *
 * 提供翻译和AI解释的注入逻辑
 */

import type { ClickAction, FillTextAction, InjectionAction } from '$lib/types/injection'
import type { AIPlatform, TranslationPlatform } from '$lib/types/platform'

import { i18n } from '$lib/i18n'
import { appState } from '$lib/stores/app.svelte'
import { configStore } from '$lib/stores/config.svelte'
import { platformsStore } from '$lib/stores/platforms.svelte'
import { translationStore } from '$lib/stores/translation.svelte'
import { EVENTS, TIMING, TRANSLATION_INJECTION } from '$lib/utils/constants'
import { generateInjectionScript } from '$lib/utils/injection'
import {
  getDefaultChatTemplate,
  getDefaultTranslationTemplate,
} from '$lib/utils/injection-templates'
import { logger } from '$lib/utils/logger'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

interface WebviewReadyEntry {
  ready: boolean
  resolvers: Array<() => void>
}

const webviewReadyState = new Map<string, WebviewReadyEntry>()
let webviewEventListenersRegistered = false
let webviewEventListenersPromise: Promise<void> | null = null
const t = i18n.t

function getOrCreateReadyEntry(id: string): WebviewReadyEntry {
  const existing = webviewReadyState.get(id)
  if (existing) {
    return existing
  }

  const entry: WebviewReadyEntry = {
    ready: false,
    resolvers: [],
  }
  webviewReadyState.set(id, entry)
  return entry
}

function markWebviewLoading(id: string): void {
  const entry = getOrCreateReadyEntry(id)
  entry.ready = false
}

function markWebviewReady(id: string): void {
  const entry = getOrCreateReadyEntry(id)
  entry.ready = true
  const resolvers = [...entry.resolvers]
  entry.resolvers = []
  resolvers.forEach(resolver => resolver())
}

/**
 * 确保事件监听器已注册（单例模式，避免重复注册）
 *
 * 性能优化：使用 Promise 缓存避免并发调用时的重复注册
 */
async function ensureWebviewEventListeners(): Promise<void> {
  if (webviewEventListenersRegistered) {
    return
  }

  if (typeof window === 'undefined') {
    return
  }

  // 避免并发调用时的重复注册
  if (webviewEventListenersPromise) {
    return webviewEventListenersPromise
  }

  webviewEventListenersPromise = (async () => {
    try {
      const mainWindow = getCurrentWebviewWindow()

      await Promise.all([
        mainWindow.listen(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, (event) => {
          const payload = event.payload as { id?: string } | undefined
          if (!payload?.id) {
            return
          }

          markWebviewLoading(payload.id)
        }),
        mainWindow.listen(EVENTS.CHILD_WEBVIEW_READY, (event) => {
          const payload = event.payload as { id?: string } | undefined
          if (!payload?.id) {
            return
          }

          markWebviewReady(payload.id)
        }),
      ])

      webviewEventListenersRegistered = true
    }
    catch (error) {
      logger.warn('Failed to register child webview readiness listeners', error)
      // 重置 promise 以便下次重试
      webviewEventListenersPromise = null
    }
  })()

  return webviewEventListenersPromise
}

/**
 * 智能等待 WebView 就绪
 *
 * 性能优化版本：
 * - 使用缓存的 ready 状态快速返回
 * - 减少不必要的 IPC 调用
 * - 合并事件监听器注册为单次操作
 *
 * 超时策略：
 * - 已存在的 WebView: 2秒超时（只需等待页面加载）
 * - 新创建的 WebView: 8秒超时（需要创建窗口+加载页面）
 *
 * 注意：超时时间只是保护上限，如果页面提前加载完成，会立即继续执行
 */
async function waitForWebviewReady(id: string): Promise<void> {
  // 快速路径：如果已经 ready，直接返回
  const cachedEntry = webviewReadyState.get(id)
  if (cachedEntry?.ready) {
    logger.debug('Webview already ready (cached), skipping wait', { webviewId: id })
    return
  }

  // 确保事件监听器已注册（不等待，因为可能已经注册）
  void ensureWebviewEventListeners()

  // 检查 WebView 是否已存在，自动选择合适的超时时间
  // 优化：使用 Promise.race 添加快速超时，避免 IPC 卡顿影响整体流程
  let alreadyExists = false
  try {
    const checkPromise = invoke<boolean>('check_child_webview_exists', {
      payload: { id },
    })
    // 添加 500ms 快速超时，IPC 通常很快，如果卡住就假设不存在
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 500)
    })
    alreadyExists = await Promise.race([checkPromise, timeoutPromise])
  }
  catch (error) {
    logger.warn('Failed to check webview existence, assuming new', { webviewId: id, error })
  }

  const timeoutMs = alreadyExists
    ? TIMING.EXISTING_WEBVIEW_READY_TIMEOUT_MS
    : TIMING.CHILD_WEBVIEW_READY_TIMEOUT_MS

  const startTime = Date.now()
  logger.debug('Waiting for webview ready', {
    webviewId: id,
    alreadyExists,
    timeoutMs,
  })

  // 再次检查（可能在上面的 IPC 期间变为 ready）
  const entry = webviewReadyState.get(id)
  if (entry?.ready) {
    logger.debug('Webview became ready during check', { webviewId: id })
    return
  }

  await new Promise<void>((resolve) => {
    const targetEntry = entry ?? getOrCreateReadyEntry(id)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let resolved = false

    const wrappedResolve = (): void => {
      if (resolved) {
        return
      }
      resolved = true

      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = undefined
      }

      const currentEntry = webviewReadyState.get(id)
      if (currentEntry) {
        currentEntry.resolvers = currentEntry.resolvers.filter(
          resolver => resolver !== wrappedResolve,
        )
        currentEntry.ready = true
      }

      const actualWaitTime = Date.now() - startTime
      logger.debug('Webview ready event received', {
        webviewId: id,
        actualWaitMs: actualWaitTime,
      })

      resolve()
    }

    timeoutHandle = setTimeout(() => {
      if (resolved) {
        return
      }

      const currentEntry = webviewReadyState.get(id)
      if (currentEntry) {
        currentEntry.resolvers = currentEntry.resolvers.filter(
          resolver => resolver !== wrappedResolve,
        )
      }

      const actualWaitTime = Date.now() - startTime
      logger.warn('Wait for child webview ready timed out, proceeding anyway', {
        webviewId: id,
        timeoutMs,
        actualWaitMs: actualWaitTime,
        alreadyExists,
      })
      resolved = true
      resolve()
    }, timeoutMs)

    targetEntry.resolvers.push(wrappedResolve)
  })
}

/**
 * 执行翻译操作 - 优化版本
 *
 * 优化策略：
 * 1. 立即切换视图（用户立刻看到界面，0ms 延迟）
 * 2. 异步等待 WebView 加载和注入内容（不阻塞 UI）
 * 3. 智能超时：新建 8秒，已存在 2秒
 *
 * @param selectedText - 选中的文本
 */
export async function executeTranslation(selectedText: string): Promise<void> {
  try {
    logger.info('Executing translation', { textLength: selectedText.length })

    // 切换到翻译视图
    const currentTranslatorId = configStore.config.currentTranslator
    const currentTranslator = currentTranslatorId
      ? translationStore.getPlatformById(currentTranslatorId)
      : null

    if (!currentTranslator || !currentTranslator.enabled) {
      logger.warn('No translation platform available for selection toolbar', {
        translatorId: currentTranslatorId ?? 'unknown',
      })
      appState.setError(t('errors.selectionToolbar.noTranslatorConfigured'))
      return
    }

    // 立即切换视图，给用户即时反馈（不等待 WebView 加载）
    appState.switchToTranslationView()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ensureTranslationVisible'))
    }

    const webviewId = `translator-${currentTranslator.id}`

    // 在后台异步执行加载和注入，不阻塞当前操作
    // 使用 void 明确表示我们不等待这个 Promise
    void (async () => {
      try {
        await waitForWebviewReady(webviewId)
        await injectTranslationText(selectedText, currentTranslator, webviewId)
        logger.info('Translation executed successfully')
      }
      catch (error) {
        logger.error('Failed to inject translation text in background', error)
        appState.setError(t('errors.selectionToolbar.translationFailed'))
      }
    })()

    logger.info('Translation view switched, content will be injected when ready')
  }
  catch (error) {
    logger.error('Failed to execute translation', error)
    appState.setError(t('errors.selectionToolbar.translationFailed'))
    throw error
  }
}

/**
 * 注入文本到翻译器
 *
 * @param text - 要翻译的文本
 * @param translator - 翻译平台
 */
async function injectTranslationText(
  text: string,
  translator: TranslationPlatform,
  webviewId: string,
): Promise<void> {
  try {
    const template = getDefaultTranslationTemplate(translator.id)

    if (!template) {
      logger.warn('No injection template for translator', { translatorId: translator.id })
      return
    }

    const fillTemplate = template.actions.find(
      (action): action is FillTextAction => action.type === 'fill',
    )

    if (!fillTemplate) {
      logger.warn('Translation template missing fill action', { translatorId: translator.id })
      return
    }

    const fillAction: FillTextAction = {
      ...fillTemplate,
      content: text,
      triggerEvents: fillTemplate.triggerEvents ?? true,
      delay: fillTemplate.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
      timeout: fillTemplate.timeout ?? TRANSLATION_INJECTION.FILL_TIMEOUT_MS,
    }

    const actions: InjectionAction[] = [fillAction]

    const clickTemplate = template.actions.find(
      (action): action is ClickAction => action.type === 'click',
    )

    if (clickTemplate) {
      const clickAction: ClickAction = {
        ...clickTemplate,
        delay: clickTemplate.delay ?? fillAction.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
        timeout: clickTemplate.timeout ?? TRANSLATION_INJECTION.CLICK_TIMEOUT_MS,
      }
      actions.push(clickAction)
    }

    const script = generateInjectionScript(actions)

    await invoke('evaluate_child_webview_script', {
      payload: {
        id: webviewId,
        script,
      },
    })

    logger.info('Translation text injected successfully', {
      translatorId: translator.id,
      webviewId,
    })
  }
  catch (error) {
    logger.error('Failed to inject translation text', error)
    throw error
  }
}

/**
 * 执行AI解释操作 - 优化版本
 *
 * 优化策略：
 * 1. 立即切换视图（用户立刻看到界面，0ms 延迟）
 * 2. 异步等待 WebView 加载和注入内容（不阻塞 UI）
 * 3. 智能超时：新建 8秒，已存在 2秒
 *
 * @param selectedText - 选中的文本
 */
export async function executeExplanation(selectedText: string): Promise<void> {
  try {
    logger.info('Executing AI explanation', { textLength: selectedText.length })

    // 获取默认解释平台
    const platform = resolveExplainPlatform()
    if (!platform) {
      logger.warn('No AI platform available for explanation')
      appState.setError(t('errors.selectionToolbar.noAiPlatform'))
      return
    }

    // 立即切换到AI聊天视图，给用户即时反馈（不等待 WebView 加载）
    appState.switchToChatView(platform)

    const webviewId = `ai-chat-${platform.id}`
    const prompt = buildExplanationPrompt(selectedText)

    // 在后台异步执行加载和注入，不阻塞当前操作
    // 使用 void 明确表示我们不等待这个 Promise
    void (async () => {
      try {
        await waitForWebviewReady(webviewId)
        await injectAIPrompt(prompt, platform, webviewId)
        logger.info('AI explanation executed successfully')
      }
      catch (error) {
        logger.error('Failed to inject AI prompt in background', error)
        appState.setError(t('errors.selectionToolbar.explanationFailed'))
      }
    })()

    logger.info('AI chat view switched, prompt will be injected when ready')
  }
  catch (error) {
    logger.error('Failed to execute AI explanation', error)
    appState.setError(t('errors.selectionToolbar.explanationFailed'))
    throw error
  }
}

/**
 * 注入提示词到AI平台
 *
 * @param prompt - 提示词
 * @param platform - AI平台
 */
async function injectAIPrompt(
  prompt: string,
  platform: AIPlatform,
  webviewId: string,
): Promise<void> {
  try {
    const template = getDefaultChatTemplate(platform.id)

    if (!template) {
      logger.warn('No injection template for AI platform', { platformId: platform.id })
      return
    }

    const fillTemplate = template.actions.find(
      (action): action is FillTextAction => action.type === 'fill',
    )

    if (!fillTemplate) {
      logger.warn('AI template missing fill action', { platformId: platform.id })
      return
    }

    const fillAction: FillTextAction = {
      ...fillTemplate,
      content: prompt,
      triggerEvents: fillTemplate.triggerEvents ?? true,
      delay: fillTemplate.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
      timeout: fillTemplate.timeout ?? TRANSLATION_INJECTION.FILL_TIMEOUT_MS,
    }

    const actions: InjectionAction[] = [fillAction]

    const clickTemplate = template.actions.find(
      (action): action is ClickAction => action.type === 'click',
    )

    if (clickTemplate) {
      const clickAction: ClickAction = {
        ...clickTemplate,
        delay: clickTemplate.delay ?? fillAction.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
        timeout: clickTemplate.timeout ?? TRANSLATION_INJECTION.CLICK_TIMEOUT_MS,
      }
      actions.push(clickAction)
    }

    const script = generateInjectionScript(actions)

    await invoke('evaluate_child_webview_script', {
      payload: {
        id: webviewId,
        script,
      },
    })

    logger.info('AI prompt injected successfully', {
      platformId: platform.id,
      webviewId,
    })
  }
  catch (error) {
    logger.error('Failed to inject AI prompt', error)
    throw error
  }
}

/**
 * 构建解释提示词
 *
 * @param text - 选中的文本
 * @returns 格式化的提示词
 */
function buildExplanationPrompt(text: string): string {
  // 根据当前语言构建不同的提示词
  const locale = configStore.config.locale || 'zh-CN'

  const prompts: Record<string, string> = {
    'zh-CN': `请解释以下内容：\n\n${text}`,
    'en-US': `Please explain the following:\n\n${text}`,
    'ja-JP': `以下の内容を説明してください：\n\n${text}`,
    'ko-KR': `다음 내용을 설명해 주세요:\n\n${text}`,
  }

  return prompts[locale] || prompts['zh-CN']
}

function resolveExplainPlatform(): AIPlatform | null {
  const candidateIds = [
    configStore.config.selectionToolbarDefaultPlatformId ?? undefined,
    configStore.config.lastUsedPlatform ?? undefined,
    configStore.config.defaultPlatform ?? undefined,
  ].filter((id): id is string => Boolean(id))

  for (const id of candidateIds) {
    const platform = platformsStore.getPlatformById(id)
    if (platform && platform.enabled && (platform.selectionToolbarAvailable ?? true)) {
      return platform
    }
  }

  const fallback = platformsStore.selectionToolbarPlatforms[0]
  if (fallback) {
    return fallback
  }

  return null
}
