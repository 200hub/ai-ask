<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { i18n } from '$lib/i18n'
  import { EVENTS, SELECTION_TOOLBAR } from '$lib/utils/constants'
  import { logger } from '$lib/utils/logger'
  import {
    requestCollect,
    requestExplanation,
    requestTranslation,
  } from '$lib/utils/selection-bridge'
  import { invoke } from '@tauri-apps/api/core'
  import { emit, listen } from '@tauri-apps/api/event'

  import { onDestroy, onMount } from 'svelte'
  /**
   * SelectionToolbar - 划词工具栏组件
   *
   * 显示在独立 Webview 中的浮动工具栏，提供翻译、解释、收藏操作。
   */
  import '$lib/styles/base.css'

  type Props = {
    isDarkMode?: boolean
  }

  type ToolbarSnapshot = {
    last_text: string | null
    enabled: boolean
  }

  const { isDarkMode = false }: Props = $props()
  const iconFill = $derived(isDarkMode ? '#f9fafb' : '#1f2937')

  const t = i18n.t
  type KeyboardHandlerEvent = globalThis.KeyboardEvent

  let trimmedText = $state<string>('')
  let hasValidSelection = $state<boolean>(false)
  let canCollect = $state<boolean>(false)
  let isProcessing = $state<boolean>(false)
  let unlistenSelection: UnlistenFn | null = null
  let autoHideTimer: number | null = null

  const MIN_SELECTION_LENGTH = SELECTION_TOOLBAR.MIN_SELECTION_LENGTH

  function refreshSelectionStates(rawText: string): void {
    trimmedText = rawText.trim()
    hasValidSelection = trimmedText.length >= MIN_SELECTION_LENGTH
    canCollect = trimmedText.length > 0
  }

  function clearAutoHideTimer(): void {
    if (autoHideTimer !== null) {
      window.clearTimeout(autoHideTimer)
      autoHideTimer = null
    }
  }

  function restartAutoHideTimer(): void {
    clearAutoHideTimer()
    autoHideTimer = window.setTimeout(() => {
      void hideToolbar()
    }, SELECTION_TOOLBAR.AUTO_HIDE_DELAY_MS)
  }

  async function hideToolbar(): Promise<void> {
    clearAutoHideTimer()
    refreshSelectionStates('')
    try {
      await invoke('hide_selection_toolbar')
    }
    catch (error) {
      logger.error('Failed to hide selection toolbar', error)
    }
  }

  function handlePointerEnter(): void {
    clearAutoHideTimer()
  }

  function handlePointerLeave(): void {
    if (canCollect) {
      restartAutoHideTimer()
    }
    else {
      void hideToolbar()
    }
  }

  /**
   * 统一处理来自 Rust 的选中文本
   *
   * 无论是事件推送还是初始快照，都复用这段逻辑：
   * - 将文本写入本地状态，控制按钮启用/禁用
   * - 根据当前是否有可收藏文本来决定是否自动隐藏
   */
  function processSelectionText(rawText: string): void {
    const trimmed = rawText.trim()

    if (!trimmed) {
      logger.debug('Empty selection received, hiding toolbar')
      void hideToolbar()
      return
    }

    refreshSelectionStates(rawText)
    isProcessing = false

    if (!canCollect) {
      void hideToolbar()
      return
    }

    restartAutoHideTimer()
    logger.debug('Selection toolbar received text', { textLength: trimmedText.length })
  }

  async function handleTranslate(): Promise<void> {
    if (!hasValidSelection || isProcessing) {
      return
    }

    const text = trimmedText
    logger.info('Selection toolbar: translate clicked', { textLength: text.length })

    isProcessing = true
    try {
      await hideToolbar()
      await requestTranslation(text)
    }
    catch (error) {
      logger.error('Failed to trigger translation', error)
    }
    finally {
      isProcessing = false
    }
  }

  async function handleExplain(): Promise<void> {
    if (!hasValidSelection || isProcessing) {
      return
    }

    const text = trimmedText
    logger.info('Selection toolbar: explain clicked', { textLength: text.length })

    isProcessing = true
    try {
      await hideToolbar()
      await requestExplanation(text)
    }
    catch (error) {
      logger.error('Failed to trigger explanation', error)
    }
    finally {
      isProcessing = false
    }
  }

  async function handleCollect(): Promise<void> {
    if (!canCollect || isProcessing) {
      return
    }

    const text = trimmedText
    logger.info('Selection toolbar: collect clicked', { textLength: text.length })

    try {
      await hideToolbar()
      await requestCollect(text)
    }
    catch (error) {
      logger.error('Failed to trigger collect', error)
    }
  }

  async function handleTemporaryDisable(): Promise<void> {
    if (isProcessing) {
      return
    }

    const until = Date.now() + SELECTION_TOOLBAR.TEMP_DISABLE_DURATION_MS
    logger.info('Selection toolbar: temporary disable requested', { until })

    isProcessing = true
    try {
      await invoke('set_selection_toolbar_temporary_disabled_until', { until })
      await emit(EVENTS.SELECTION_TOOLBAR_TEMP_DISABLE_CHANGED, { until })
    }
    catch (error) {
      logger.error('Failed to schedule temporary disable', error)
    }
    finally {
      isProcessing = false
      await hideToolbar()
    }
  }

  function handleKeydown(event: KeyboardHandlerEvent): void {
    if (event.key === 'Escape') {
      void hideToolbar()
    }
  }

  function handleWindowBlur(): void {
    void hideToolbar()
  }

  onMount(async () => {
    try {
      unlistenSelection = await listen<string>('toolbar-text-selected', (event) => {
        const payload = event.payload ?? ''
        processSelectionText(payload)
      })
    }
    catch (error) {
      logger.error('Failed to listen for toolbar text', error)
    }

    try {
      const snapshot = await invoke<ToolbarSnapshot>('get_selection_toolbar_state')
      if (snapshot?.last_text) {
        // 首次挂载时同步 Rust 侧缓存的选区，避免第一次展示全灰
        processSelectionText(snapshot.last_text)
      }
    }
    catch (error) {
      logger.error('Failed to get selection toolbar state', error)
    }

    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('blur', handleWindowBlur)

    logger.info('Selection toolbar mounted')
  })

  onDestroy(() => {
    unlistenSelection?.()
    clearAutoHideTimer()
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('blur', handleWindowBlur)

    logger.info('Selection toolbar destroyed')
  })
</script>

<div
  class='toolbar-container'
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  <button
    class='toolbar-button'
    type='button'
    onclick={handleTranslate}
    title={t('errors.selectionToolbar.tooltipTranslate')}
    aria-label={t('errors.selectionToolbar.translate')}
    disabled={!hasValidSelection || isProcessing}
  >
    <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M4 6.5h8c.6 0 1 .4 1 1v2h-2V8.5H5V17a.5.5 0 0 0 .5.5H11v-1.5h2V19a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7.5C3 6.9 3.4 6.5 4 6.5Zm13.2 2.8a1 1 0 0 1 1.6 0l3 4.5a1 1 0 0 1-.84 1.57h-1.12l1.06 1.8a1 1 0 0 1-1.74 1L18 15.5l-1.62 2.17a1 1 0 0 1-1.74-1l1.06-1.8h-1.12a1 1 0 0 1-.84-1.57l3-4.5Z'
        fill={iconFill}
      />
    </svg>
    <span class='sr-only'>{t('errors.selectionToolbar.translate')}</span>
  </button>

  <button
    class='toolbar-button'
    type='button'
    onclick={handleExplain}
    title={t('errors.selectionToolbar.tooltipExplain')}
    aria-label={t('errors.selectionToolbar.explain')}
    disabled={!hasValidSelection || isProcessing}
  >
    <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M5 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.6L12 18.5 8.6 14H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 3a1 1 0 0 0-1 1v.5a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm0 3.5a1 1 0 0 0-1 1V12a1 1 0 1 0 2 0v-.5a1 1 0 0 0-1-1Z'
        fill={iconFill}
      />
    </svg>
    <span class='sr-only'>{t('errors.selectionToolbar.explain')}</span>
  </button>

  <button
    class='toolbar-button'
    type='button'
    onclick={handleCollect}
    title={t('errors.selectionToolbar.tooltipCollect')}
    aria-label={t('errors.selectionToolbar.collect')}
    disabled={!canCollect || isProcessing}
  >
    <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M8.5 5h7a1.5 1.5 0 0 1 1.5 1.5v12.3a.2.2 0 0 1-.31.16L12 16.5l-4.69 2.46A.2.2 0 0 1 7 18.8V6.5A1.5 1.5 0 0 1 8.5 5Z'
        fill={iconFill}
      />
    </svg>
    <span class='sr-only'>{t('errors.selectionToolbar.collect')}</span>
  </button>

  <button
    class='toolbar-button'
    type='button'
    onclick={handleTemporaryDisable}
    title={t('errors.selectionToolbar.tooltipDisable')}
    aria-label={t('errors.selectionToolbar.disable')}
    disabled={isProcessing}
  >
    <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M12 3.5a8.5 8.5 0 1 0 8.5 8.5A8.5 8.5 0 0 0 12 3.5Zm0 15a6.5 6.5 0 1 1 6.5-6.5A6.5 6.5 0 0 1 12 18.5Zm-.75-9v3.17l2.48 1.43.76-1.32-1.74-1V9.5Z'
        fill={iconFill}
      />
    </svg>
    <span class='sr-only'>{t('errors.selectionToolbar.disable')}</span>
  </button>
</div>

<style>
  .toolbar-container {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.45rem;
    -webkit-user-select: none;
    user-select: none;
  }

  .toolbar-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.16s ease, transform 0.16s ease;
  }

  .toolbar-button:hover:not(:disabled) {
    background: var(--bg-secondary);
  }

  .toolbar-button:active:not(:disabled) {
    background: var(--bg-tertiary);
    transform: scale(0.95);
  }

  .toolbar-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon {
    width: 1.1rem;
    height: 1.1rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
