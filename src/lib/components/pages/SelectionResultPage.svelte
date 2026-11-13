<script lang='ts'>
  /**
   * SelectionResultPage - 划词浮动结果窗口组件
   *
   * 显示翻译/解释结果的浮动窗口，支持：
   * - 加载中状态显示
   * - Markdown 格式渲染
   * - ESC/点击外部/手动关闭
   * - 跳转到主窗口查看对应平台
   */
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { i18n } from '$lib/i18n'
  import { EVENTS, SELECTION_RESULT_WINDOW } from '$lib/utils/constants'
  import { formatExtractedContent } from '$lib/utils/injection-format'
  import { logger } from '$lib/utils/logger'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { marked } from 'marked'
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
   * 平台类型
   */
  type PlatformType = 'ai' | 'translation'

  /**
   * 结果窗口请求数据
   */
  interface ResultWindowRequest {
    actionType: ActionType
    text: string
    platformId: string
    platformName: string
    errorMessage?: string
  }

  /**
   * 注入结果事件负载
   */
  interface InjectionResult {
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

  interface ResultWindowSnapshot {
    requestId: number
    request: ResultWindowRequest
    outcome: { Ok: InjectionResult } | { Err: string } | null
  }

  // ============ 状态 ============

  let isLoading = $state(true)
  let errorMessage = $state<string | null>(null)
  let resultContent = $state('')
  let resultHtml = $state('')
  let actionType = $state<ActionType>('explain')
  let platformId = $state('')
  let platformName = $state('')
  let platformType = $state<PlatformType>('ai')
  let currentRequestId = $state<number | null>(null)
  let latestRequestId = -1
  let selectedText = $state('') // 选中的文本
  let isPinned = $state(false) // 是否钉住（置顶且不自动消失）
  let isMaximized = $state(false) // 是否最大化
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

  let unlistenRequest: UnlistenFn | null = null
  let mounted = false

  // ============ 派生状态 ============

  const t = i18n.t
  const iconFill = $derived(isDarkMode ? '#f9fafb' : '#1f2937')
  const hasResult = $derived(resultContent.length > 0)

  // 截断选中的文本用于标题显示
  const TITLE_MAX_LENGTH = 20
  const truncatedText = $derived(
    selectedText.length > TITLE_MAX_LENGTH
      ? `${selectedText.slice(0, TITLE_MAX_LENGTH)}...`
      : selectedText,
  )

  // 加载状态显示的标题（翻译中/解释中 + 选中内容）
  const loadingTitle = $derived(
    actionType === 'translate'
      ? t('selectionResult.translating')
      : t('selectionResult.explaining'),
  )

  // 完成后显示的标题（平台名 + 选中内容）
  // 即使 selectedText 为空也要显示平台名
  const completedTitle = $derived.by(() => {
    if (truncatedText && platformName) {
      return `${platformName}: ${truncatedText}`
    }
    if (platformName) {
      return platformName
    }
    // 如果连平台名都没有，显示默认标题
    return actionType === 'translate'
      ? t('selectionResult.translationResult')
      : t('selectionResult.explanationResult')
  })

  // ============ 定时器管理 ============

  /**
   * 将错误码映射为用户友好的错误消息
   */
  function mapErrorMessage(error: string | undefined): string {
    if (!error) {
      return t('selectionResult.failed')
    }
    // 处理特殊错误码
    if (error === 'EXTRACT_TIMEOUT' || error.includes('EXTRACT_TIMEOUT')) {
      return t('selectionResult.timeout')
    }
    // 如果是 i18n 键则翻译
    const translated = t(error)
    return translated !== error ? translated : error
  }

  function clearAutoCloseTimer(): void {
    if (autoCloseTimer !== null) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = null
    }
  }

  function startAutoCloseTimer(): void {
    // 如果钉住了，不启动自动关闭定时器
    if (isPinned) {
      return
    }
    clearAutoCloseTimer()
    autoCloseTimer = setTimeout(() => {
      void hideResultWindow()
    }, SELECTION_RESULT_WINDOW.AUTO_CLOSE_DELAY_MS)
  }

  // ============ 核心操作 ============

  async function hideResultWindow(): Promise<void> {
    const requestId = currentRequestId
    if (requestId === null) {
      return
    }

    clearAutoCloseTimer()
    try {
      await invoke('dismiss_selection_result_window', { requestId })
      if (currentRequestId === requestId) {
        currentRequestId = null
        isPinned = false
        isMaximized = false
      }
    }
    catch (error) {
      logger.error('Failed to dismiss result window', error)
    }
  }

  /**
   * 渲染 Markdown 到 HTML
   */
  function renderMarkdown(content: string): string {
    try {
      const html = marked.parse(content, { gfm: true, breaks: true })
      const documentNode = new DOMParser().parseFromString(html, 'text/html')
      for (const element of documentNode.body.querySelectorAll('*')) {
        if (!/^(?:A|BLOCKQUOTE|BR|CODE|DEL|EM|H[1-6]|HR|LI|OL|P|PRE|STRONG|TABLE|TBODY|TD|TH|THEAD|TR|UL)$/.test(element.tagName)) {
          element.remove()
          continue
        }
        for (const attribute of [...element.attributes]) {
          const safeLink = element.tagName === 'A' && attribute.name === 'href' && /^(?:https?:\/\/|mailto:)/i.test(attribute.value)
          const safeListStart = element.tagName === 'OL' && attribute.name === 'start' && /^\d+$/.test(attribute.value)
          if (!safeLink && !safeListStart) {
            element.removeAttribute(attribute.name)
          }
        }
      }
      return documentNode.body.innerHTML
    }
    catch (error) {
      logger.error('Failed to render markdown', error)
      return ''
    }
  }

  function applySnapshot(snapshot: ResultWindowSnapshot): void {
    const { requestId, request, outcome } = snapshot
    if (requestId < latestRequestId || (requestId === latestRequestId && currentRequestId === null)) {
      return
    }

    if (requestId !== currentRequestId) {
      latestRequestId = requestId
      currentRequestId = requestId
      isPinned = false
      isMaximized = false
      actionType = request.actionType
      platformId = request.platformId
      platformName = request.platformName
      selectedText = request.text
      platformType = actionType === 'translate' ? 'translation' : 'ai'
      isLoading = !request.errorMessage
      errorMessage = request.errorMessage ? mapErrorMessage(request.errorMessage) : null
      resultContent = ''
      resultHtml = ''
      clearAutoCloseTimer()
    }

    if (!isLoading || !outcome) {
      return
    }

    isLoading = false
    if ('Err' in outcome) {
      errorMessage = mapErrorMessage(outcome.Err)
      return
    }
    const payload = outcome.Ok
    if (!payload.success) {
      errorMessage = mapErrorMessage(payload.error)
      return
    }

    // 提取结果内容
    const extractResult = payload.results?.find(r => r.type === 'extract')
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

    // 渲染 Markdown
    resultHtml = renderMarkdown(resultContent)

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
    // 钉住时不关闭窗口
    if (isPinned) {
      logger.debug('Window blur ignored because pinned')
      return
    }
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
    // 鼠标离开时重启自动关闭（如果已有结果且未钉住）
    if (hasResult && !isPinned) {
      startAutoCloseTimer()
    }
  }

  /**
   * 切换钉住状态
   */
  async function handleTogglePin(): Promise<void> {
    const requestId = currentRequestId
    if (requestId === null) {
      return
    }
    const pinned = !isPinned
    try {
      await invoke('set_selection_result_pinned', { requestId, pinned })
    }
    catch (error) {
      logger.error('Failed to change result window pin state', error)
      return
    }
    if (currentRequestId !== requestId) {
      return
    }
    isPinned = pinned

    // 钉住时取消自动关闭定时器
    if (isPinned) {
      clearAutoCloseTimer()
    }
    else if (hasResult) {
      // 取消钉住时，如果有结果则启动自动关闭
      startAutoCloseTimer()
    }
  }

  /**
   * 切换最大化状态
   */
  async function handleToggleMaximize(): Promise<void> {
    try {
      const currentWindow = getCurrentWebviewWindow()
      if (isMaximized) {
        await currentWindow.unmaximize()
      }
      else {
        await currentWindow.maximize()
      }
      isMaximized = !isMaximized
      logger.info('Window maximize toggled', { isMaximized })
    }
    catch (error) {
      logger.error('Failed to toggle maximize', error)
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

  /**
   * 在主窗口中打开对应平台
   */
  async function handleOpenInMainWindow(): Promise<void> {
    if (!platformId) {
      return
    }

    try {
      logger.info('Opening platform in main window', {
        platformId,
        platformType,
        actionType,
        hasText: !!selectedText,
      })
      await invoke('open_platform_in_main_window', {
        platformId,
        platformType,
      })
      // 隐藏结果窗口
      await hideResultWindow()
    }
    catch (error) {
      logger.error('Failed to open platform in main window', error)
    }
  }

  // ============ 生命周期 ============

  onMount(() => {
    mounted = true
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('blur', handleWindowBlur)
    const currentWindow = getCurrentWebviewWindow()

    void (async () => {
      try {
        const unlisten = await currentWindow.listen<ResultWindowSnapshot>(EVENTS.SELECTION_RESULT_STATE, event => applySnapshot(event.payload))
        if (!mounted) {
          unlisten()
          return
        }
        unlistenRequest = unlisten
        const snapshot = await invoke<ResultWindowSnapshot | null>('get_selection_result_state')
        if (mounted && snapshot) {
          applySnapshot(snapshot)
        }
      }
      catch (error) {
        logger.error('Failed to load selection result state', error)
        if (mounted) {
          isLoading = false
          errorMessage = t('selectionResult.failed')
        }
      }
    })()
  })

  onDestroy(() => {
    mounted = false
    unlistenRequest?.()
    clearAutoCloseTimer()
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('blur', handleWindowBlur)

    logger.info('Selection result page destroyed')
  })
</script>

<div
  class='result-container'
  role='region'
  aria-label={completedTitle}
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  <!-- 标题栏 - 支持拖动窗口 -->
  <div class='result-header' data-tauri-drag-region>
    <div class='header-title'>
      {#if isLoading}
        <span class='loading-indicator'></span>
      {/if}
      <span class='title-text'>
        {isLoading ? loadingTitle : completedTitle}
      </span>
    </div>
    <div class='header-actions'>
      {#if hasResult}
        <!-- 复制按钮 -->
        <button
          class='action-button'
          type='button'
          onclick={(e) => {
            e.stopPropagation()
            void handleCopy()
          }}
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
        <!-- 在主窗口中打开按钮 -->
        <button
          class='action-button'
          type='button'
          onclick={(e) => {
            e.stopPropagation()
            void handleOpenInMainWindow()
          }}
          title={t('selectionResult.openInMainWindow')}
          aria-label={t('selectionResult.openInMainWindow')}
        >
          <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
            <path
              d='M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'
              fill={iconFill}
            />
          </svg>
        </button>
      {/if}
      <!-- 最大化按钮 -->
      <button
        class='action-button'
        type='button'
        onclick={(e) => {
          e.stopPropagation()
          void handleToggleMaximize()
        }}
        title={isMaximized ? t('selectionResult.restore') : t('selectionResult.maximize')}
        aria-label={isMaximized ? t('selectionResult.restore') : t('selectionResult.maximize')}
      >
        <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
          {#if isMaximized}
            <path
              d='M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
              fill={iconFill}
            />
          {:else}
            <path
              d='M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
              fill={iconFill}
            />
          {/if}
        </svg>
      </button>
      <!-- 钉住按钮 -->
      <button
        class='action-button {isPinned ? 'pinned' : ''}'
        type='button'
        onclick={(e) => {
          e.stopPropagation()
          void handleTogglePin()
        }}
        title={isPinned ? t('selectionResult.unpin') : t('selectionResult.pin')}
        aria-label={isPinned ? t('selectionResult.unpin') : t('selectionResult.pin')}
      >
        <svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>
          <path
            d='M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z'
            fill={isPinned ? 'var(--accent-color)' : iconFill}
          />
        </svg>
      </button>
      <!-- 关闭按钮 -->
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
      <!-- 显示原文 -->
      {#if selectedText}
        <div class='original-text'>
          <div class='original-label'>{t('selectionResult.originalText')}</div>
          <div class='original-content'>{selectedText}</div>
        </div>
      {/if}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class='result-markdown'>{@html resultHtml}</div>
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
    overflow: hidden;
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

  .action-button.pinned {
    background: var(--accent-bg, rgba(59, 130, 246, 0.1));
  }

  .action-button.pinned:hover {
    background: var(--accent-bg, rgba(59, 130, 246, 0.2));
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

  .original-text {
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
    border-left: 3px solid var(--accent-color);
  }

  .original-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-tertiary);
    margin-bottom: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .original-content {
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 4.5rem;
    overflow: auto;
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

  /* Markdown 内容样式 */
  .result-markdown {
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--text-primary);
    -webkit-user-select: text;
    user-select: text;
  }

  /* Markdown 基础元素样式 */
  .result-markdown :global(p) {
    margin: 0 0 0.75rem 0;
  }

  .result-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .result-markdown :global(h1),
  .result-markdown :global(h2),
  .result-markdown :global(h3),
  .result-markdown :global(h4),
  .result-markdown :global(h5),
  .result-markdown :global(h6) {
    margin: 1rem 0 0.5rem 0;
    font-weight: 600;
    line-height: 1.3;
  }

  .result-markdown :global(h1:first-child),
  .result-markdown :global(h2:first-child),
  .result-markdown :global(h3:first-child) {
    margin-top: 0;
  }

  .result-markdown :global(h1) { font-size: 1.25rem; }
  .result-markdown :global(h2) { font-size: 1.125rem; }
  .result-markdown :global(h3) { font-size: 1rem; }
  .result-markdown :global(h4) { font-size: 0.9375rem; }

  .result-markdown :global(ul),
  .result-markdown :global(ol) {
    margin: 0 0 0.75rem 0;
    padding-left: 1.5rem;
  }

  .result-markdown :global(li) {
    margin-bottom: 0.25rem;
  }

  .result-markdown :global(code) {
    padding: 0.125rem 0.375rem;
    background: var(--bg-tertiary);
    border-radius: 0.25rem;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 0.8125rem;
  }

  .result-markdown :global(pre) {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
    overflow-x: auto;
  }

  .result-markdown :global(pre code) {
    padding: 0;
    background: transparent;
  }

  .result-markdown :global(blockquote) {
    margin: 0.75rem 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--accent-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }

  .result-markdown :global(blockquote p) {
    margin: 0;
  }

  .result-markdown :global(a) {
    color: var(--accent-color);
    text-decoration: none;
  }

  .result-markdown :global(a:hover) {
    text-decoration: underline;
  }

  .result-markdown :global(strong) {
    font-weight: 600;
  }

  .result-markdown :global(em) {
    font-style: italic;
  }

  .result-markdown :global(hr) {
    margin: 1rem 0;
    border: none;
    border-top: 1px solid var(--border-color);
  }

  .result-markdown :global(table) {
    width: 100%;
    margin: 0.75rem 0;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .result-markdown :global(th),
  .result-markdown :global(td) {
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    text-align: left;
  }

  .result-markdown :global(th) {
    background: var(--bg-secondary);
    font-weight: 600;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
