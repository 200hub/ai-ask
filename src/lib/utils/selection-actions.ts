import type { ClickAction, FillTextAction, InjectionAction, InjectionTemplate } from '$lib/types/injection'
import type { AIPlatform } from '$lib/types/platform'
import { i18n } from '$lib/i18n'
import { appState } from '$lib/stores/app.svelte'
import { configStore } from '$lib/stores/config.svelte'
import { platformsStore } from '$lib/stores/platforms.svelte'
import { translationStore } from '$lib/stores/translation.svelte'
import { waitForChildWebviewReady } from '$lib/utils/childWebview'
import { EVENTS, TIMING, TRANSLATION_INJECTION } from '$lib/utils/constants'
import { generateInjectionScript } from '$lib/utils/injection'
import { getDefaultChatTemplate, getDefaultTranslationTemplate } from '$lib/utils/injection-templates'
import { logger } from '$lib/utils/logger'
import { buildSelectionExplanationPrompt } from '$lib/utils/selection-prompt'
import { invoke } from '@tauri-apps/api/core'

const t = i18n.t

export async function executeTranslation(selectedText: string, platformId?: string): Promise<void> {
  const translatorId = platformId ?? configStore.config.currentTranslator
  const translator = translatorId ? translationStore.getPlatformById(translatorId) : null
  if (!translator?.enabled) {
    appState.setError(t('errors.selectionToolbar.noTranslatorConfigured'))
    return
  }

  translationStore.setCurrentPlatform(translator.id)
  appState.switchToTranslationView()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTS.ENSURE_TRANSLATION_VISIBLE))
  }

  void injectInMainWindow(
    `translator-${translator.id}`,
    getDefaultTranslationTemplate(translator.id),
    selectedText,
    'errors.selectionToolbar.translationFailed',
  )
}

export async function executeExplanation(selectedText: string, platformId?: string): Promise<void> {
  const platform = platformId ? platformsStore.getPlatformById(platformId) : resolveExplainPlatform()
  if (!platform?.enabled || platform.selectionToolbarAvailable === false) {
    appState.setError(t('errors.selectionToolbar.noAiPlatform'))
    return
  }

  appState.switchToChatView(platform)
  void injectInMainWindow(
    `ai-chat-${platform.id}`,
    getDefaultChatTemplate(platform.id),
    buildSelectionExplanationPrompt(selectedText, configStore.config.locale),
    'errors.selectionToolbar.explanationFailed',
  )
}

async function injectInMainWindow(
  id: string,
  template: InjectionTemplate | undefined,
  content: string,
  errorKey: string,
): Promise<void> {
  try {
    const fill = template?.actions.find((action): action is FillTextAction => action.type === 'fill')
    if (!fill) {
      throw new Error('Injection template does not contain a fill action')
    }

    if (!await waitForChildWebviewReady(id, TIMING.CHILD_WEBVIEW_READY_TIMEOUT_MS)) {
      throw new Error('Child WebView load timed out')
    }

    const actions: InjectionAction[] = [{
      ...fill,
      content,
      triggerEvents: fill.triggerEvents ?? true,
      delay: fill.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
      timeout: fill.timeout ?? TRANSLATION_INJECTION.FILL_TIMEOUT_MS,
    }]

    const click = template?.actions.find((action): action is ClickAction => action.type === 'click')
    if (click) {
      actions.push({
        ...click,
        delay: click.delay ?? fill.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
        timeout: click.timeout ?? TRANSLATION_INJECTION.CLICK_TIMEOUT_MS,
      })
    }

    await invoke('evaluate_child_webview_script', {
      payload: { id, script: generateInjectionScript(actions) },
    })
  }
  catch (error) {
    logger.error('Failed to inject selection in main window', { id, error })
    appState.setError(t(errorKey))
  }
}

function resolveExplainPlatform(): AIPlatform | undefined {
  const { selectionToolbarDefaultPlatformId, lastUsedPlatform, defaultPlatform } = configStore.config
  for (const id of [selectionToolbarDefaultPlatformId, lastUsedPlatform, defaultPlatform]) {
    if (id) {
      const platform = platformsStore.getPlatformById(id)
      if (platform?.enabled && platform.selectionToolbarAvailable !== false) {
        return platform
      }
    }
  }

  return platformsStore.selectionToolbarPlatforms[0]
}
