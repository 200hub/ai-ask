<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import GlobalSelectionMonitor from '$lib/components/common/GlobalSelectionMonitor.svelte'
  import Header from '$lib/components/layout/Header.svelte'
  import MainContent from '$lib/components/layout/MainContent.svelte'
  import Sidebar from '$lib/components/layout/Sidebar.svelte'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { configStore } from '$lib/stores/config.svelte'
  import { desktopNotesStore } from '$lib/stores/desktop-notes.svelte'
  import { platformsStore } from '$lib/stores/platforms.svelte'
  import { translationStore } from '$lib/stores/translation.svelte'
  import { copyTextToClipboard } from '$lib/utils/clipboard'
  import { logger } from '$lib/utils/logger'
  import { preloadDefaultPlatforms } from '$lib/utils/preload'
  import { executeExplanation, executeTranslation } from '$lib/utils/selection-actions'
  import { emit, listen } from '@tauri-apps/api/event'
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
  let openPlatformUnlisten: UnlistenFn | null = null
  let beforeExitUnlisten: UnlistenFn | null = null

  type SelectionToolbarEventPayload = {
    text?: string
  }

  /**
   * 从浮动结果窗口跳转到主窗口的事件负载
   */
  type OpenPlatformEventPayload = {
    platformId: string
    platformType: 'ai' | 'translation'
    text?: string
    action?: 'translate' | 'explain'
  }

  onMount(() => {
    void registerOpenSettingsListener()
    void registerTranslationHotkeyListener()
    void registerSelectionToolbarListeners()
    void registerOpenPlatformListener()
    void registerBeforeExitListener()
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

    openPlatformUnlisten?.()
    openPlatformUnlisten = null

    beforeExitUnlisten?.()
    beforeExitUnlisten = null
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
      await desktopNotesStore.init()
      await platformsStore.init()
      await translationStore.init()

      await desktopNotesStore.refreshSession()
      desktopNotesStore.startAuthListener()

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

      if (configStore.config.desktopNotesEnabled) {
        // 启动时：如果开启同步且已认证，先执行同步（以远端数据为准，关闭前已同步到 Supabase）
        if (
          configStore.config.desktopNotesSyncEnabled
          && desktopNotesStore.session.authenticated
        ) {
          try {
            const result = await desktopNotesStore.syncWithSupabase({
              preferRemote: true,
              fullPull: true,
            })
            logger.info('Startup desktop notes sync completed', {
              pushed: result.pushed,
              pulled: result.pulled,
            })
          }
          catch (error) {
            logger.warn('Startup desktop notes sync failed', error)
          }
        }

        // 同步后恢复窗口：仅恢复 visible=true 的便签（visible 状态已跨设备同步）
        // 设计上不再做屏幕切换重定位 — 钉死保存的逻辑像素坐标，
        // 用户拔插显示器、切换主屏的处理交给 OS。
        await desktopNotesStore.restoreVisibleWindows({ recoverHidden: false })
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

  /**
   * 注册应用退出前监听：在 Rust 发出 `app-before-exit` 后，
   * 完成便签待写数据落盘 + 云同步（如启用），然后回发 `app-exit-ready` 让 Rust 退出。
   * Rust 端最长等待 3 秒；超时会强制退出。
   */
  async function registerBeforeExitListener() {
    try {
      beforeExitUnlisten = await listen('app-before-exit', async () => {
        try {
          // 1) 先 flush 本地待写数据（内容、颜色、visible 等）
          await desktopNotesStore.flushPersistPublic()

          // 2) 如果云同步启用，执行一次完整同步（关闭便签产生的 visible=false 也会被推送）
          if (
            configStore.config.desktopNotesSyncEnabled
            && desktopNotesStore.session.authenticated
          ) {
            try {
              await desktopNotesStore.syncWithSupabase()
            }
            catch (error) {
              logger.warn('Pre-exit desktop notes sync failed', error)
            }
          }
        }
        catch (error) {
          logger.warn('Pre-exit flush failed', error)
        }
        finally {
          // 无论成功失败都通知 Rust 可以退出了
          try {
            await emit('app-exit-ready')
          }
          catch (error) {
            logger.warn('Failed to emit app-exit-ready', error)
          }
        }
      })
    }
    catch (error) {
      logger.error('Failed to listen for app-before-exit event:', error)
    }
  }

  /**
   * 处理从浮动结果窗口跳转到主窗口的请求
   */
  async function handleOpenPlatform(payload: OpenPlatformEventPayload) {
    logger.info('Open platform request received', payload)

    if (payload.platformType === 'translation') {
      // 切换到翻译视图
      const platform = translationStore.getPlatformById(payload.platformId)
      if (platform) {
        translationStore.setCurrentPlatform(platform.id)
        appState.switchToTranslationView()
        window.dispatchEvent(new CustomEvent('ensureTranslationVisible'))

        // 如果有文本，执行翻译操作
        if (payload.text && payload.action === 'translate') {
          // 延迟执行以确保 webview 已显示
          setTimeout(() => {
            void executeTranslation(payload.text as string)
          }, 300)
        }
      }
      else {
        logger.warn('Translation platform not found', { platformId: payload.platformId })
      }
    }
    else {
      // 切换到 AI 聊天视图
      const platform = platformsStore.getPlatformById(payload.platformId)
      if (platform) {
        appState.switchToChatView(platform)

        // 如果有文本，执行相应操作
        if (payload.text) {
          // 延迟执行以确保 webview 已显示
          setTimeout(() => {
            if (payload.action === 'translate') {
              void executeTranslation(payload.text as string)
            }
            else if (payload.action === 'explain') {
              void executeExplanation(payload.text as string)
            }
          }, 300)
        }
      }
      else {
        logger.warn('AI platform not found', { platformId: payload.platformId })
      }
    }
  }

  /**
   * 注册打开平台事件监听器
   */
  async function registerOpenPlatformListener() {
    try {
      openPlatformUnlisten = await listen<OpenPlatformEventPayload>(
        'openPlatform',
        (event) => {
          handleOpenPlatform(event.payload)
        },
      )
    }
    catch (error) {
      logger.error('Failed to listen for openPlatform event:', error)
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
