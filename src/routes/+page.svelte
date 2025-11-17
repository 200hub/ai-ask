<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import GlobalSelectionMonitor from '$lib/components/common/GlobalSelectionMonitor.svelte'
  import Header from '$lib/components/layout/Header.svelte'
  import MainContent from '$lib/components/layout/MainContent.svelte'
  import Sidebar from '$lib/components/layout/Sidebar.svelte'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { configStore } from '$lib/stores/config.svelte'
  import { platformsStore } from '$lib/stores/platforms.svelte'
  import { translationStore } from '$lib/stores/translation.svelte'
  import { copyTextToClipboard } from '$lib/utils/clipboard'
  import { logger } from '$lib/utils/logger'
  import { preloadDefaultPlatforms } from '$lib/utils/preload'
  import { executeExplanation, executeTranslation } from '$lib/utils/selection-actions'
  import { listen } from '@tauri-apps/api/event'
  /**
   * AI Ask 主页面
   */
  import { onDestroy, onMount } from 'svelte'
  import '$lib/styles/base.css'

  const t = i18n.t

  let openSettingsUnlisten: UnlistenFn | null = null
  let translationHotkeyUnlisten: UnlistenFn | null = null
  let selectionTranslateUnlisten: UnlistenFn | null = null
  let selectionExplainUnlisten: UnlistenFn | null = null
  let selectionCollectUnlisten: UnlistenFn | null = null

  type SelectionToolbarEventPayload = {
    text?: string
  }

  onMount(() => {
    void registerOpenSettingsListener()
    void registerTranslationHotkeyListener()
    void registerSelectionToolbarListeners()
    void initializeStores()
  })

  onDestroy(() => {
    openSettingsUnlisten?.()
    openSettingsUnlisten = null

    translationHotkeyUnlisten?.()
    translationHotkeyUnlisten = null

    selectionTranslateUnlisten?.()
    selectionTranslateUnlisten = null

    selectionExplainUnlisten?.()
    selectionExplainUnlisten = null

    selectionCollectUnlisten?.()
    selectionCollectUnlisten = null
  })

  function extractSelectionText(payload: SelectionToolbarEventPayload | null | undefined): string | null {
    const raw = payload?.text ?? ''
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  async function handleSelectionToolbarTranslate(payload: SelectionToolbarEventPayload | null) {
    const text = extractSelectionText(payload)
    if (!text) {
      logger.debug('Selection toolbar translate request skipped: empty payload')
      return
    }

    try {
      await executeTranslation(text)
    }
    catch (error) {
      logger.error('Failed to handle selection toolbar translate request:', error)
    }
  }

  async function handleSelectionToolbarExplain(payload: SelectionToolbarEventPayload | null) {
    const text = extractSelectionText(payload)
    if (!text) {
      logger.debug('Selection toolbar explain request skipped: empty payload')
      return
    }

    try {
      await executeExplanation(text)
    }
    catch (error) {
      logger.error('Failed to handle selection toolbar explain request:', error)
    }
  }

  async function handleSelectionToolbarCollect(payload: SelectionToolbarEventPayload | null) {
    const text = extractSelectionText(payload)
    if (!text) {
      logger.debug('Selection toolbar collect request skipped: empty payload')
      return
    }

    try {
      await copyTextToClipboard(text)
      logger.info('Selection toolbar collect request copied to clipboard', {
        textLength: text.length,
      })
    }
    catch (error) {
      logger.error('Failed to handle selection toolbar collect request', error)
      appState.setError(t('errors.selectionToolbar.collectFailed'))
    }
  }

  async function registerSelectionToolbarListeners() {
    try {
      selectionTranslateUnlisten = await listen<SelectionToolbarEventPayload>(
        'selection-toolbar:translate',
        (event) => {
          void handleSelectionToolbarTranslate(event.payload ?? null)
        },
      )
    }
    catch (error) {
      logger.error('Failed to listen for selection-toolbar:translate event:', error)
    }

    try {
      selectionExplainUnlisten = await listen<SelectionToolbarEventPayload>(
        'selection-toolbar:explain',
        (event) => {
          void handleSelectionToolbarExplain(event.payload ?? null)
        },
      )
    }
    catch (error) {
      logger.error('Failed to listen for selection-toolbar:explain event:', error)
    }

    try {
      selectionCollectUnlisten = await listen<SelectionToolbarEventPayload>(
        'selection-toolbar:collect',
        (event) => {
          void handleSelectionToolbarCollect(event.payload ?? null)
        },
      )
    }
    catch (error) {
      logger.error('Failed to listen for selection-toolbar:collect event:', error)
    }
  }

  /**
   * 处理翻译快捷键触发
   */
  function handleTranslationHotkey() {
    logger.debug('Translation hotkey triggered, switching to translation view')
    appState.switchToTranslationView()
    window.dispatchEvent(new CustomEvent('ensureTranslationVisible'))
  }

  /**
   * 注册翻译快捷键监听器
   */
  async function registerTranslationHotkeyListener() {
    try {
      translationHotkeyUnlisten = await listen('translation-hotkey-triggered', () => {
        handleTranslationHotkey()
      })
    }
    catch (error) {
      logger.error('Failed to listen for translation-hotkey-triggered event:', error)
    }
  }

  async function initializeStores() {
    try {
      await configStore.init()
      await platformsStore.init()
      await translationStore.init()

      const translatorId = configStore.config.currentTranslator
      if (translatorId) {
        translationStore.setCurrentPlatform(translatorId)
      }
      else if (!translationStore.currentPlatform && translationStore.enabledPlatforms.length > 0) {
        translationStore.setCurrentPlatform(translationStore.enabledPlatforms[0].id)
      }

      const lastPlatformId
        = configStore.config.lastUsedPlatform
          || configStore.config.defaultPlatform
      if (lastPlatformId) {
        const platform = platformsStore.getPlatformById(lastPlatformId)
        if (platform && platform.enabled) {
          appState.switchToChatView(platform)
        }
      }

      // 预加载默认平台（异步，不阻塞初始化）
      void preloadDefaultPlatforms()
    }
    catch (error) {
      logger.error('Failed to initialize application stores:', error)
    }
  }

  async function registerOpenSettingsListener() {
    try {
      openSettingsUnlisten = await listen('open-settings', () => {
        appState.openSettings()
      })
    }
    catch (error) {
      logger.error('Failed to listen for open-settings event:', error)
    }
  }
</script>

<div class='app-container'>
  <GlobalSelectionMonitor />
  <Header />
  <div class='app-body'>
    <Sidebar />
    <MainContent />
  </div>
</div>

<style>
    .app-container {
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background-color: var(--bg-primary);
    }

    .app-body {
        flex: 1;
        display: flex;
        overflow: hidden;
    }
</style>
