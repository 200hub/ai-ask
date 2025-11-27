<script lang='ts'>
  /**
   * SelectionToolbar - 划词工具栏组件
   *
   * 显示在独立 Webview 中的浮动工具栏，提供翻译、解释、收藏操作。
   * 优化版本：简化状态管理和事件处理，提高代码可维护性。
   */
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
  import '$lib/styles/base.css'

  // ============ Props ============

  interface Props {
    isDarkMode?: boolean
  }

  const { isDarkMode = false }: Props = $props()

  // ============ 类型定义 ============

  interface ToolbarSnapshot {
    last_text: string | null
    enabled: boolean
  }

  // ============ 状态 ============

  let trimmedText = $state('')
  let isProcessing = $state(false)
  let unlistenSelection: UnlistenFn | null = null
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null

  // ============ 派生状态 ============

  const iconFill = $derived(isDarkMode ? '#f9fafb' : '#1f2937')
  const hasValidSelection = $derived(trimmedText.length >= SELECTION_TOOLBAR.MIN_SELECTION_LENGTH)
  const canCollect = $derived(trimmedText.length > 0)
  const t = i18n.t

  // ============ 定时器管理 ============

  function clearAutoHideTimer(): void {
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer)
      autoHideTimer = null
    }
  }

  function restartAutoHideTimer(): void {
    clearAutoHideTimer()
    autoHideTimer = setTimeout(() => {
      void hideToolbar()
    }, SELECTION_TOOLBAR.AUTO_HIDE_DELAY_MS)
  }

  // ============ 核心操作 ============

  /**
   * 隐藏工具栏
   */
  async function hideToolbar(): Promise<void> {
    clearAutoHideTimer()
    trimmedText = ''
    try {
      await invoke('hide_selection_toolbar')
    }
    catch (error) {
      logger.error('Failed to hide selection toolbar', error)
    }
  }

  /**
   * 处理选中文本
   * 统一处理来自 Rust 的选中文本（事件推送或初始快照）
   */
  function processSelectionText(rawText: string): void {
    const text = rawText.trim()

    if (!text) {
      logger.debug('Empty selection received, hiding toolbar')
      void hideToolbar()
      return
    }

    trimmedText = text
    isProcessing = false
    restartAutoHideTimer()
    logger.debug('Selection toolbar received text', { textLength: text.length })
  }

  // ============ 按钮操作 ============

  /**
   * 执行操作的通用包装函数
   */
  async function executeAction(
    actionName: string,
    condition: boolean,
    action: (text: string) => Promise<void>,
  ): Promise<void> {
    if (!condition || isProcessing) {
      return
    }

    const text = trimmedText
    logger.info(`Selection toolbar: ${actionName} clicked`, { textLength: text.length })

    isProcessing = true
    try {
      await hideToolbar()
      await action(text)
    }
    catch (error) {
      logger.error(`Failed to trigger ${actionName}`, error)
    }
    finally {
      isProcessing = false
    }
  }

  function handleTranslate(): void {
    void executeAction('translate', hasValidSelection, requestTranslation)
  }

  function handleExplain(): void {
    void executeAction('explain', hasValidSelection, requestExplanation)
  }

  function handleCollect(): void {
    void executeAction('collect', canCollect, requestCollect)
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

  // ============ 事件处理 ============

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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      void hideToolbar()
    }
  }

  function handleWindowBlur(): void {
    void hideToolbar()
  }

  // ============ 生命周期 ============

  onMount(async () => {
    // 监听选中文本事件
    try {
      unlistenSelection = await listen<string>('toolbar-text-selected', (event) => {
        processSelectionText(event.payload ?? '')
      })
    }
    catch (error) {
      logger.error('Failed to listen for toolbar text', error)
    }

    // 获取初始快照
    try {
      const snapshot = await invoke<ToolbarSnapshot>('get_selection_toolbar_state')
      if (snapshot?.last_text) {
        processSelectionText(snapshot.last_text)
      }
    }
    catch (error) {
      logger.error('Failed to get selection toolbar state', error)
    }

    // 添加全局事件监听
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
  <!-- 翻译按钮 -->
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

  <!-- 解释按钮 -->
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

  <!-- 收藏按钮 -->
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

  <!-- 临时禁用按钮 -->
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
