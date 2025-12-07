<script lang='ts'>
  /**
   * SelectionResultPage - 划词浮动结果窗口组件
   *
   * 显示翻译/解释结果的浮动窗口，支持：
   * - 加载中状态显示
   * - Markdown 格式渲染
   * - ESC/点击外部/手动关闭
   */
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { i18n } from '$lib/i18n'
  import { EVENTS, SELECTION_RESULT_WINDOW } from '$lib/utils/constants'
  import { formatExtractedContent } from '$lib/utils/injection-format'
  import { logger } from '$lib/utils/logger'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { onDestroy, onMount } from 'svelte'
  import '$lib/styles/base.css'

  // ============ Props ============

  interface Props {
    isDarkMode?: boolean
  }

  const { isDarkMode = false }: Props = $props()

  // ============ 类型定义 ============

  /**
   * 操作类型：翻译或解释
   */
  type ActionType = 'translate' | 'explain'

  /**
   * 结果窗口请求数据
   */
  interface ResultWindowRequest {
    actionType: ActionType
    text: string
    platformId: string
    platformName: string
    webviewId?: string
    errorMessage?: string
  }

  /**
   * 注入结果事件负载
   */
  interface InjectionResultPayload {
    id: string
    success: boolean
    result?: {
      success: boolean
      results?: Array<{
        index: number
        type: string
        result: {
          success: boolean
          content?: string
          html?: string
          format?: string
        }
      }>
      error?: string
    }
    error?: string
  }

  // ============ 状态 ============

  let isLoading = $state(true)
  let errorMessage = $state<string | null>(null)
  let resultContent = $state('')
  let actionType = $state<ActionType>('translate')
  let platformName = $state('')
  let currentWebviewId = $state<string | null>(null)
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

  let unlistenRequest: UnlistenFn | null = null
  let unlistenResult: UnlistenFn | null = null

  // ============ 派生状态 ============

  const t = i18n.t
  const iconFill = $derived(isDarkMode ? '#f9fafb' : '#1f2937')
  const hasResult = $derived(resultContent.length > 0)
  const titleText = $derived(
    actionType === 'translate'
      ? t('selectionResult.translating')
      : t('selectionResult.explaining'),
  )

  // ============ 定时器管理 ============

  function clearAutoCloseTimer(): void {
    if (autoCloseTimer !== null) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = null
    }
  }

  function startAutoCloseTimer(): void {
    clearAutoCloseTimer()
    autoCloseTimer = setTimeout(() => {
      void hideResultWindow()
    }, SELECTION_RESULT_WINDOW.AUTO_CLOSE_DELAY_MS)
  }

  // ============ 核心操作 ============

  /**
   * 隐藏结果窗口
   */
  async function hideResultWindow(): Promise<void> {
    clearAutoCloseTimer()
    try {
      await invoke('hide_selection_result_window')
    }
    catch (error) {
      logger.error('Failed to hide selection result window', error)
    }
  }

  /**
   * 处理请求事件
   */
  function handleRequest(payload: ResultWindowRequest): void {
    logger.info('Selection result window received request', {
      actionType: payload.actionType,
      platformId: payload.platformId,
      textLength: payload.text.length,
      webviewId: payload.webviewId,
    })

    // 重置状态
    actionType = payload.actionType
    platformName = payload.platformName
    currentWebviewId = payload.webviewId || null

    // 清除之前的定时器
    clearAutoCloseTimer()

    // 如果请求中携带了错误信息，直接显示错误状态
    if (payload.errorMessage) {
      isLoading = false
      errorMessage = t(payload.errorMessage) || payload.errorMessage
      resultContent = ''
      return
    }

    // 否则进入加载状态
    isLoading = true
    errorMessage = null
    resultContent = ''
  }

  /**
   * 处理注入结果
   * 只处理与当前请求匹配的 webviewId 结果
   */
  function handleInjectionResult(payload: InjectionResultPayload): void {
    // 过滤：只处理匹配当前 webviewId 的结果
    if (currentWebviewId && payload.id !== currentWebviewId) {
      logger.debug('Ignoring injection result for different webview', {
        expected: currentWebviewId,
        received: payload.id,
      })
      return
    }

    logger.debug('Selection result window received injection result', {
      id: payload.id,
      success: payload.success,
    })

    isLoading = false

    if (!payload.success || !payload.result?.success) {
      errorMessage = payload.error || payload.result?.error || t('selectionResult.failed')
      logger.warn('Injection failed', { error: errorMessage })
      return
    }

    // 提取结果内容
    const extractResult = payload.result?.results?.find(r => r.type === 'extract')
    if (!extractResult || !extractResult.result?.success) {
      errorMessage = t('selectionResult.noResult')
      logger.warn('No extract result found')
      return
    }

    const { content, html, format } = extractResult.result
    const formatted = formatExtractedContent({
      content: content || '',
      html: html || '',
      format: (format as 'text' | 'markdown') || 'text',
    })

    resultContent = formatted?.markdown || formatted?.text || ''

    if (!resultContent) {
      errorMessage = t('selectionResult.noResult')
      logger.warn('Empty result content')
      return
    }

    logger.info('Selection result received', { contentLength: resultContent.length })

    // 成功获取结果后启动自动关闭定时器
    startAutoCloseTimer()
  }

  // ============ 事件处理 ============

  function handleClose(): void {
    void hideResultWindow()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      void hideResultWindow()
    }
  }

  function handleWindowBlur(): void {
    // 加载中时不关闭窗口，等待结果返回
    if (isLoading) {
      logger.debug('Window blur ignored during loading')
      return
    }
    // 窗口失焦时自动关闭
    void hideResultWindow()
  }

  function handlePointerEnter(): void {
    // 鼠标进入时暂停自动关闭
    clearAutoCloseTimer()
  }

  function handlePointerLeave(): void {
    // 鼠标离开时重启自动关闭（如果已有结果）
    if (hasResult) {
      startAutoCloseTimer()
    }
  }

  /**
   * 复制结果到剪贴板
   */
  async function handleCopy(): Promise<void> {
    if (!resultContent) {
      return
    }

    try {
      await navigator.clipboard.writeText(resultContent)
      logger.info('Result copied to clipboard')
    }
    catch (error) {
      logger.error('Failed to copy result to clipboard', error)
    }
  }

  // ============ 生命周期 ============

  onMount(async () => {
    // 监听请求事件
    try {
      unlistenRequest = await listen<ResultWindowRequest>('selection-result:request', (event) => {
        handleRequest(event.payload)
      })
    }
    catch (error) {
      logger.error('Failed to listen for result request', error)
    }

    // 监听注入结果事件
    try {
      unlistenResult = await listen<InjectionResultPayload>(
        EVENTS.CHILD_WEBVIEW_INJECTION_RESULT,
        (event) => {
          handleInjectionResult(event.payload)
        },
      )
    }
    catch (error) {
      logger.error('Failed to listen for injection result', error)
    }

    // 添加全局事件监听
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('blur', handleWindowBlur)

    logger.info('Selection result page mounted')
  })

  onDestroy(() => {
    unlistenRequest?.()
    unlistenResult?.()
    clearAutoCloseTimer()
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('blur', handleWindowBlur)

    logger.info('Selection result page destroyed')
  })
</script>

<div
  class='result-container'
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  <!-- 标题栏 -->
  <div class='result-header'>
    <div class='header-title'>
      {#if isLoading}
        <span class='loading-indicator'></span>
      {/if}
      <span class='title-text'>
        {isLoading ? titleText : platformName}
      </span>
    </div>
    <div class='header-actions'>
      {#if hasResult}
        <button
          class='action-button'
          type='button'
          onclick={handleCopy}
          title={t('selectionResult.copy')}
          aria-label={t('selectionResult.copy')}
        >
          <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
            <path
              d='M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'
              fill={iconFill}
            />
          </svg>
        </button>
      {/if}
      <button
        class='action-button close-button'
        type='button'
        onclick={handleClose}
        title={t('selectionResult.close')}
        aria-label={t('selectionResult.close')}
      >
        <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
          <path
            d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
            fill={iconFill}
          />
        </svg>
      </button>
    </div>
  </div>

  <!-- 内容区域 -->
  <div class='result-content'>
    {#if isLoading}
      <div class='loading-state'>
        <div class='loading-spinner'></div>
        <span class='loading-text'>{t('common.loading')}</span>
      </div>
    {:else if errorMessage}
      <div class='error-state'>
        <svg class='error-icon' viewBox='0 0 24 24' aria-hidden='true'>
          <path
            d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'
            fill='currentColor'
          />
        </svg>
        <span class='error-text'>{errorMessage}</span>
      </div>
    {:else if hasResult}
      <div class='result-text'>
        {resultContent}
      </div>
    {:else}
      <div class='empty-state'>
        <span class='empty-text'>{t('selectionResult.noResult')}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .result-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-primary);
    border-radius: 0.5rem;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    -webkit-user-select: none;
    user-select: none;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    min-height: 2.25rem;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .loading-indicator {
    width: 0.75rem;
    height: 0.75rem;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .title-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .action-button:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .action-button:active {
    transform: scale(0.95);
  }

  .close-button:hover {
    background: var(--error-bg, rgba(239, 68, 68, 0.1));
    color: var(--error-color, #ef4444);
  }

  .icon {
    width: 1rem;
    height: 1rem;
  }

  .result-content {
    flex: 1;
    overflow: auto;
    padding: 0.75rem;
  }

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.75rem;
    color: var(--text-secondary);
  }

  .loading-spinner {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text,
  .empty-text {
    font-size: 0.875rem;
  }

  .error-icon {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--error-color, #ef4444);
  }

  .error-text {
    font-size: 0.875rem;
    color: var(--error-color, #ef4444);
    text-align: center;
  }

  .result-text {
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    -webkit-user-select: text;
    user-select: text;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
