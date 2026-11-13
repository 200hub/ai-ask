<script lang='ts'>
  /**
   * 翻译页面组件 - 子 Webview 管理器
   *
   * 管理翻译平台的子 webview 实例，处理创建、定位、显示/隐藏等功能
   */
  import type { TranslationPlatform } from '$lib/types/platform'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { configStore } from '$lib/stores/config.svelte'
  import { translationStore } from '$lib/stores/translation.svelte'
  import { calculateChildWebviewBounds, ChildWebviewProxy } from '$lib/utils/childWebview'
  import { EVENTS } from '$lib/utils/constants'
  import { logger } from '$lib/utils/logger'
  import { createProxySignature, resolveProxyUrl } from '$lib/utils/proxy'
  import { WebviewReflowScheduler, WebviewWindowEventManager } from '$lib/utils/webview-events'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { onDestroy, onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  const t = i18n.t

  function translate(key: string, params?: Record<string, string>) {
    let value = t(key)
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(`{${paramKey}}`, paramValue)
      }
    }
    return value
  }

  // ========== 核心状态变量 ==========

  const mainWindow = getCurrentWebviewWindow()

  /** 窗口事件管理器 */
  const eventManager = new WebviewWindowEventManager('TranslationPage')

  /** 重排调度器 */
  const reflowScheduler = new WebviewReflowScheduler()

  const webviewWindows = new SvelteMap<string, ChildWebviewProxy>()
  let activeTranslatorId = $state<string | null>(null)
  let isMainWindowFocused = $state(true)
  let proxySignature = $state(createProxySignature(configStore.config.proxy))

  let shouldRestoreWebviews = false
  let visibilityRevision = 0
  let visibilityTask = Promise.resolve()

  let isLoading = $state(false)
  let loadError = $state<string | null>(null)

  $effect(() => {
    const signature = createProxySignature(configStore.config.proxy)
    if (signature !== proxySignature) {
      proxySignature = signature
      void handleProxyConfigChange()
    }
  })

  $effect(() => {
    const translator = translationStore.currentPlatform
    const currentView = appState.currentView

    if (!translator || !translator.enabled) {
      const fallback = translationStore.enabledPlatforms[0]
      if (fallback) {
        translationStore.setCurrentPlatform(fallback.id)
        return
      }

      activeTranslatorId = null
      isLoading = false
      loadError = null
      void hideAllWebviews()
      return
    }

    if (currentView !== 'translation') {
      activeTranslatorId = null
      isLoading = false
      loadError = null
      void hideAllWebviews()
      return
    }

    activeTranslatorId = translator.id
    isLoading = true
    loadError = null
    void showTranslatorWebview(translator)
  })

  async function handleProxyConfigChange() {
    await closeAllWebviews()

    if (appState.currentView === 'translation' && translationStore.currentPlatform) {
      await showTranslatorWebview(translationStore.currentPlatform)
    }
  }

  function showTranslatorWebview(platform: TranslationPlatform): Promise<void> {
    const revision = ++visibilityRevision
    const run = async () => {
      if (revision !== visibilityRevision || appState.currentView !== 'translation') {
        return
      }

      try {
        const bounds = await calculateChildWebviewBounds(mainWindow)
        await hideOtherWebviews(platform.id)

        let webview = webviewWindows.get(platform.id)
        if (!webview) {
          const proxyUrl = resolveProxyUrl(configStore.config.proxy)
          webview = new ChildWebviewProxy(`translator-${platform.id}`, platform.url, proxyUrl)
          await webview.ensure(bounds)
          webviewWindows.set(platform.id, webview)
        }
        else {
          await webview.updateBounds(bounds)
        }

        if (revision !== visibilityRevision || appState.currentView !== 'translation') {
          return
        }

        await webview.show()
        if (revision !== visibilityRevision) {
          await webview.hide()
          return
        }

        shouldRestoreWebviews = false
        isLoading = false
        loadError = null
        if (isMainWindowFocused) {
          await webview.setFocus().catch(error => logger.debug('Could not focus translator WebView', error))
        }
      }
      catch (error) {
        logger.error('Failed to show translator WebView', { platform: platform.name, error })
        if (revision === visibilityRevision) {
          isLoading = false
          loadError = platform.name
          appState.setError(t('translation.toastError'))
        }
      }
    }
    visibilityTask = visibilityTask.then(run)
    return visibilityTask
  }

  async function hideOtherWebviews(excludeId: string) {
    const hidePromises: Promise<void>[] = []

    for (const [id, webview] of webviewWindows.entries()) {
      if (id !== excludeId) {
        hidePromises.push(
          (async () => {
            try {
              await webview.hide()
            }
            catch (error) {
              logger.error('Failed to hide translator WebView', { id, error })
            }
          })(),
        )
      }
    }

    await Promise.all(hidePromises)
  }

  async function positionAllWebviews({ shouldEnsureActiveFront = false } = {}) {
    if (webviewWindows.size === 0) {
      return
    }

    const activeWebview = activeTranslatorId ? webviewWindows.get(activeTranslatorId) : null
    if (!activeWebview?.isVisible()) {
      return
    }
    const bounds = await calculateChildWebviewBounds(mainWindow)

    await activeWebview.updateBounds(bounds)
    if (shouldEnsureActiveFront && isMainWindowFocused && activeWebview.isVisible()) {
      await activeWebview.setFocus()
    }
  }

  function scheduleWebviewReflow(options: { shouldEnsureActiveFront?: boolean, immediate?: boolean } = {}) {
    reflowScheduler.schedule(options, (shouldEnsureActiveFront) => {
      positionAllWebviews({ shouldEnsureActiveFront }).catch((error) => {
        logger.error('Translator WebView reflow failed', error)
      })
    })
  }

  async function hideAllWebviews({ markForRestore = false } = {}) {
    ++visibilityRevision
    shouldRestoreWebviews = markForRestore
    await visibilityTask

    const hideTasks = Array.from(webviewWindows.values()).map(webview =>
      webview.hide().catch((error) => {
        logger.error('Failed to hide translator WebView', error)
      }),
    )

    await Promise.all(hideTasks)
  }

  async function closeAllWebviews() {
    ++visibilityRevision
    await visibilityTask
    const closeTasks = Array.from(webviewWindows.values()).map(webview =>
      webview.close().catch((error) => {
        logger.error('Failed to close translator WebView', error)
      }),
    )

    await Promise.all(closeTasks)
    webviewWindows.clear()
    shouldRestoreWebviews = false
  }

  async function reloadCurrentTranslator() {
    if (!activeTranslatorId) {
      return
    }

    const platform = translationStore.getPlatformById(activeTranslatorId)
    if (!platform) {
      return
    }

    ++visibilityRevision
    await visibilityTask
    const currentWebview = webviewWindows.get(activeTranslatorId)

    try {
      if (currentWebview) {
        await currentWebview.close()
        webviewWindows.delete(activeTranslatorId)
      }

      await showTranslatorWebview(platform)
    }
    catch (error) {
      logger.error('Failed to reload translator platform', error)
      appState.setError(t('translation.toastError'))
    }
  }

  function handleHideAllWebviewsEvent(event: Event) {
    const customEvent = event as CustomEvent<{ markForRestore?: boolean }>
    const markForRestore = customEvent.detail?.markForRestore ?? true
    void hideAllWebviews({ markForRestore })
  }

  function handleEnsureTranslationVisible() {
    const translator = translationStore.currentPlatform
    if (translator && translator.enabled && appState.currentView === 'translation') {
      void showTranslatorWebview(translator)
    }
  }

  function handleMainWindowResize(size?: { width: number, height: number }) {
    if (size && (size.width === 0 || size.height === 0)) {
      void hideAllWebviews({ markForRestore: true })
      return
    }

    scheduleWebviewReflow({ shouldEnsureActiveFront: false, immediate: false })
  }

  function handleMainWindowMove() {
    scheduleWebviewReflow({ shouldEnsureActiveFront: false, immediate: false })
  }

  async function restoreActiveWebview() {
    if (!shouldRestoreWebviews) {
      return
    }

    if (appState.currentView !== 'translation') {
      shouldRestoreWebviews = false
      return
    }

    if (!translationStore.currentPlatform) {
      shouldRestoreWebviews = false
      return
    }

    shouldRestoreWebviews = false

    const platform = translationStore.currentPlatform
    await showTranslatorWebview(platform)
    scheduleWebviewReflow({ shouldEnsureActiveFront: true })
  }

  // ========== 组件生命周期 ==========

  onMount(() => {
    // DOM 事件监听器配置
    const domEventHandlers = [
      { event: 'hideAllWebviews', handler: handleHideAllWebviewsEvent },
      { event: 'resize', handler: () => handleMainWindowResize() },
      { event: EVENTS.ENSURE_TRANSLATION_VISIBLE, handler: handleEnsureTranslationVisible },
    ]

    // 注册 DOM 事件监听器
    domEventHandlers.forEach(({ event, handler }) => {
      window.addEventListener(event, handler as (e: Event) => void)
    })

    // 注册 Tauri 窗口事件监听器
    void eventManager.register(mainWindow, {
      onResize: handleMainWindowResize,
      onMove: handleMainWindowMove,
      onFocus: () => { isMainWindowFocused = true },
      onBlur: () => { isMainWindowFocused = false },
      onClose: closeAllWebviews,
      onHideWebviews: () => { void hideAllWebviews({ markForRestore: true }) },
      onMinimizedOrHidden: () => { void hideAllWebviews({ markForRestore: true }) },
      onRestoredOrShown: () => { void restoreActiveWebview() },
      onRestoreWebviews: () => { void restoreActiveWebview() },
    }).then((focused) => {
      isMainWindowFocused = focused
    })

    // 初始化 WebView 布局
    scheduleWebviewReflow({ shouldEnsureActiveFront: true })

    // 清理函数
    return () => {
      // 清理 DOM 事件监听器
      domEventHandlers.forEach(({ event, handler }) => {
        window.removeEventListener(event, handler as (e: Event) => void)
      })

      // 清理 Tauri 窗口事件监听器
      eventManager.dispose()
    }
  })

  onDestroy(async () => {
    await closeAllWebviews()
  })

  function reload() {
    void reloadCurrentTranslator()
  }
</script>

<div class='translation-container'>

  <!-- 翻译内容区域 -->
  <div class='translation-content'>
    {#if translationStore.currentPlatform}
      {#if isLoading}
        <div class='loading-overlay'>
          <div class='loading-spinner'>
            <svg class='spinner' viewBox='0 0 50 50'>
              <circle
                class='path'
                cx='25'
                cy='25'
                r='20'
                fill='none'
                stroke-width='4'
              ></circle>
            </svg>
            <p class='loading-text'>{t('translation.loading')}</p>
          </div>
        </div>
      {/if}

      {#if loadError}
        <div class='error-overlay'>
          <div class='error-content'>
            <svg
              class='error-icon'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                stroke-linecap='round'
                stroke-linejoin='round'
                stroke-width='2'
                d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
            <h3 class='error-title'>{t('translation.loadErrorTitle')}</h3>
            <p class='error-message'>
              {translate('translation.loadErrorMessage', { name: loadError })}
            </p>
            <button class='reload-btn' onclick={reload}>
              {t('translation.reload')}
            </button>
          </div>
        </div>
      {:else if !isLoading}
        <div class='translation-placeholder'>
          <svg
            class='placeholder-icon'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              stroke-linecap='round'
              stroke-linejoin='round'
              stroke-width='2'
              d='M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129'
            />
          </svg>
          <p class='placeholder-text'>
            {translate('translation.externalWindowHint', {
              name: translationStore.currentPlatform.name,
            })}
          </p>
        </div>
      {/if}
    {:else}
      <div class='no-platform'>
        <svg
          class='no-platform-icon'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='2'
            d='M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129'
          />
        </svg>
        <p>{t('translation.noPlatforms')}</p>
        <p class='hint'>{t('translation.emptyHint')}</p>
      </div>
    {/if}
  </div>
</div>

<style>
    .translation-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--bg-primary);
        overflow: hidden;
    }

    .translation-content {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--bg-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
    }

    .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .spinner {
        width: 50px;
        height: 50px;
        animation: rotate 2s linear infinite;
    }

    .path {
        stroke: var(--accent-color);
        stroke-linecap: round;
        animation: dash 1.5s ease-in-out infinite;
    }

    @keyframes rotate {
        100% {
            transform: rotate(360deg);
        }
    }

    @keyframes dash {
        0% {
            stroke-dasharray: 1, 150;
            stroke-dashoffset: 0;
        }
        50% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -35;
        }
        100% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -124;
        }
    }

    .loading-text {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .error-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--bg-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
    }

    .error-content {
        text-align: center;
        max-width: 400px;
        padding: 2rem;
    }

    .error-icon {
        width: 64px;
        height: 64px;
        color: var(--error-color);
        margin: 0 auto 1rem;
    }

    .error-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
    }

    .error-message {
        font-size: 1rem;
        color: var(--text-secondary);
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
    }

    .reload-btn {
        padding: 0.75rem 1.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: white;
        background-color: var(--accent-color);
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .reload-btn:hover {
        background-color: var(--accent-hover);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
    }

    .reload-btn:active {
        transform: translateY(0);
    }

    .translation-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        color: var(--text-secondary);
        padding: 0 2rem;
        text-align: center;
    }

    .placeholder-icon {
        width: 48px;
        height: 48px;
        color: var(--text-tertiary);
    }

    .placeholder-text {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.5;
    }

    .no-platform {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
    }

    .no-platform-icon {
        width: 64px;
        height: 64px;
        color: var(--text-tertiary);
    }

    .no-platform p {
        font-size: 1rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .no-platform .hint {
        font-size: 0.875rem;
        color: var(--text-tertiary);
    }
</style>
