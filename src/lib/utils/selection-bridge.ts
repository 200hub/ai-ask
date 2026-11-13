import type { AppConfig } from '$lib/types/config'
import type { InjectionTemplate } from '$lib/types/injection'
import type { AIPlatform, TranslationPlatform } from '$lib/types/platform'

import { ChildWebviewProxy } from '$lib/utils/childWebview'
import { SELECTION_RESULT_WINDOW, SELECTION_TOOLBAR } from '$lib/utils/constants'
import { generateInjectionScript } from '$lib/utils/injection'
import { getDefaultChatTemplate, getDefaultTranslationTemplate } from '$lib/utils/injection-templates'
import { logger } from '$lib/utils/logger'
import { resolveProxyUrl } from '$lib/utils/proxy'
import { buildSelectionExplanationPrompt } from '$lib/utils/selection-prompt'
import { getAIPlatforms, getConfig, getTranslationPlatforms } from '$lib/utils/storage'
import { invoke } from '@tauri-apps/api/core'
import { emitTo } from '@tauri-apps/api/event'

type SelectionAction = 'translate' | 'explain'
type Platform = AIPlatform | TranslationPlatform

interface ResultWindowTarget {
  windowLabel: string
  requestId: number
}

interface CursorPosition {
  x: number
  y: number
}

function getToolbarPosition(): Promise<CursorPosition | null> {
  return invoke<CursorPosition>('get_cursor_position').catch((error) => {
    logger.debug('Failed to get toolbar position', error)
    return null
  })
}

async function getSelectionPlatform(action: SelectionAction, config: AppConfig): Promise<Platform | undefined> {
  if (action === 'translate') {
    const platforms = (await getTranslationPlatforms()).filter(platform => platform.enabled)
    return platforms.find(platform => platform.id === config.currentTranslator) ?? platforms[0]
  }

  const platforms = (await getAIPlatforms()).filter(
    platform => platform.enabled && platform.selectionToolbarAvailable !== false,
  )
  const candidates = [config.selectionToolbarDefaultPlatformId, config.lastUsedPlatform, config.defaultPlatform]
  for (const id of candidates) {
    const match = platforms.find(platform => platform.id === id)
    if (match) {
      return match
    }
  }
  return platforms[0]
}

async function publishSelectionResult(target: ResultWindowTarget, outcome: { Ok: unknown } | { Err: string }): Promise<void> {
  await invoke('publish_selection_result', { ...target, outcome })
}

async function runFloatingAction(
  target: ResultWindowTarget,
  webviewId: string,
  platform: Platform,
  config: AppConfig,
  template: InjectionTemplate,
  content: string,
): Promise<void> {
  try {
    const webview = new ChildWebviewProxy(webviewId, platform.url, resolveProxyUrl(config.proxy))
    await webview.ensure()
    if (!await webview.waitForLoadFinished(SELECTION_RESULT_WINDOW.PROVIDER_READY_TIMEOUT_MS)) {
      throw new Error('EXTRACT_TIMEOUT')
    }

    const actions = template.actions.map(action => action.type === 'fill' ? { ...action, content } : action)
    const script = generateInjectionScript(actions, {
      requestId: target.requestId,
      waitForFreshResult: true,
      reuseSameTranslation: webviewId.startsWith('translator-'),
    })
    const result = await invoke<unknown>('run_selection_injection', {
      requestId: target.requestId,
      payload: { id: webviewId, script },
      timeoutMs: SELECTION_RESULT_WINDOW.INJECTION_TIMEOUT_MS,
    })
    await publishSelectionResult(target, { Ok: result })
  }
  catch (error) {
    logger.warn('Floating selection action failed', { webviewId, error })
    const message = String(error).includes('EXTRACT_TIMEOUT') ? 'EXTRACT_TIMEOUT' : 'selectionResult.failed'
    await publishSelectionResult(target, { Err: message })
  }
}

async function requestSelectionAction(action: SelectionAction, rawText: string): Promise<void> {
  const text = rawText.trim()
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    return
  }

  try {
    const config = await getConfig()
    const [platform, toolbarPosition] = await Promise.all([
      getSelectionPlatform(action, config),
      config.selectionToolbarUseFloatingWindow !== false ? getToolbarPosition() : Promise.resolve(null),
    ])
    const platformType = action === 'translate' ? 'translation' : 'ai'
    if (platform && config.selectionToolbarUseFloatingWindow === false) {
      await invoke('open_platform_in_main_window', { platformId: platform.id, platformType, text, action })
      return
    }

    const template = platform && (action === 'translate'
      ? getDefaultTranslationTemplate(platform.id)
      : getDefaultChatTemplate(platform.id))
    const target = await invoke<ResultWindowTarget>('show_selection_result_window', {
      request: {
        actionType: action,
        text,
        platformId: platform?.id ?? '',
        platformName: platform?.name ?? '',
        toolbarPosition,
        errorMessage: !platform
          ? 'selectionResult.error.noPlatform'
          : !template ? 'selectionResult.error.noTemplate' : null,
      },
    })
    if (platform && template) {
      const webviewId = action === 'translate' ? `translator-${platform.id}` : `ai-chat-${platform.id}`
      const content = action === 'translate' ? text : buildSelectionExplanationPrompt(text, config.locale)
      // The toolbar is already hidden. Let the user start another action while this result loads.
      void runFloatingAction(target, webviewId, platform, config, template, content).catch(error => logger.error('Failed to publish selection result', error))
    }
  }
  catch (error) {
    logger.error('Failed to request selection action', { action, error })
  }
}

export function requestTranslation(text: string): Promise<void> {
  return requestSelectionAction('translate', text)
}

export function requestExplanation(text: string): Promise<void> {
  return requestSelectionAction('explain', text)
}

export async function requestCollect(rawText: string): Promise<void> {
  const text = rawText.trim()
  if (!text) {
    return
  }

  try {
    await invoke('show_main_window_for_selection')
    await emitTo('main', 'selection-toolbar:collect', { text })
  }
  catch (error) {
    logger.error('Failed to emit collect request', error)
  }
}
