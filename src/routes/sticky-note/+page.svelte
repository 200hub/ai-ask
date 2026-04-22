<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { desktopNotesStore, pixelsToBounds } from '$lib/stores/desktop-notes.svelte'

  import {
    DESKTOP_NOTE_COLOR_PRESETS,
    DESKTOP_NOTES,
  } from '$lib/utils/constants'
  import { renderDesktopNoteMarkdown } from '$lib/utils/desktop-note-markdown'
  import { logger } from '$lib/utils/logger'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { currentMonitor } from '@tauri-apps/api/window'
  import { onMount } from 'svelte'
  import '$lib/styles/base.css'

  const t = i18n.t
  const appWindow = getCurrentWebviewWindow()

  const noteId = new URLSearchParams(window.location.search).get('noteId') ?? ''

  // 编辑/预览切换模式
  let mode = $state<'edit' | 'preview'>('preview')
  // 颜色面板展开/折叠
  let colorPanelOpen = $state(false)
  // 是否暂停几何同步（颜色切换等内部操作期间）
  let geometryPaused = $state(false)
  // 标记是否由用户主动关闭窗口（区分用户关闭 vs app exit）
  let closedByUser = false

  let unlistenTheme: UnlistenFn | null = null
  let unlistenMoved: UnlistenFn | null = null
  let unlistenResized: UnlistenFn | null = null
  let unlistenBlur: UnlistenFn | null = null
  let unlistenClose: UnlistenFn | null = null
  let unlistenBeforeExit: UnlistenFn | null = null
  let geometryTimer: ReturnType<typeof setTimeout> | null = null

  const currentNote = $derived(noteId ? desktopNotesStore.getNoteById(noteId) : null)
  const previewHtml = $derived(renderDesktopNoteMarkdown(currentNote?.content ?? ''))
  const syncStatus = $derived(desktopNotesStore.lastAutoSyncStatus)

  function computeDark(theme: 'system' | 'light' | 'dark') {
    return theme === 'dark'
      || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  }

  function applyTheme(theme: 'system' | 'light' | 'dark') {
    document.documentElement.classList.toggle('dark', computeDark(theme))
  }

  // 几何同步：带暂停保护，避免颜色切换等操作引发意外 bounds 更新；
  // 同步时将像素坐标转换为屏幕百分比保存，便于跨分辨率/DPI 自动还原
  function scheduleGeometrySync() {
    if (!noteId || geometryPaused) {
      return
    }

    if (geometryTimer) {
      clearTimeout(geometryTimer)
    }

    geometryTimer = setTimeout(async () => {
      if (geometryPaused) {
        return
      }

      try {
        const [physPosition, physSize, scaleFactor, monitor] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.innerSize(),
          appWindow.scaleFactor(),
          currentMonitor(),
        ])

        // 转换为逻辑坐标（Rust 端使用 Logical 单位创建窗口）
        const logicalPos = physPosition.toLogical(scaleFactor)
        const logicalSize = physSize.toLogical(scaleFactor)

        // 使用当前便签所在显示器的逻辑尺寸作为参考，
        // 将绝对像素坐标转换为屏幕百分比保存。
        // 注意：outerPosition() 返回全局坐标，需要减去显示器原点得到显示器本地坐标，
        // 否则副屏便签的百分比会 > 1.0，恢复时位置跑飞。
        let monitorLogicalWidth = screen.width
        let monitorLogicalHeight = screen.height
        let monitorOriginX = 0
        let monitorOriginY = 0
        if (monitor) {
          const monitorScale = monitor.scaleFactor ?? scaleFactor
          monitorLogicalWidth = Math.round(monitor.size.width / monitorScale)
          monitorLogicalHeight = Math.round(monitor.size.height / monitorScale)
          // 显示器原点的逻辑坐标（全局 → 本地偏移量）
          monitorOriginX = Math.round(monitor.position.x / monitorScale)
          monitorOriginY = Math.round(monitor.position.y / monitorScale)
        }

        // 全局逻辑坐标 → 显示器本地逻辑坐标
        const localX = logicalPos.x - monitorOriginX
        const localY = logicalPos.y - monitorOriginY
        const logicalWidth = Math.max(logicalSize.width, DESKTOP_NOTES.MIN_WIDTH)
        const logicalHeight = Math.max(logicalSize.height, DESKTOP_NOTES.MIN_HEIGHT)

        await desktopNotesStore.updateNoteBounds(noteId, pixelsToBounds(
          localX,
          localY,
          logicalWidth,
          logicalHeight,
          monitorLogicalWidth,
          monitorLogicalHeight,
        ))

        // 大小/位置变更也需要同步到 Supabase
        triggerAutoSync()
      }
      catch (error) {
        logger.debug('Failed to sync desktop note geometry', error)
      }
    }, 300)
  }

  async function handleContentInput(event: Event) {
    if (!noteId) {
      return
    }

    await desktopNotesStore.updateNoteContent(noteId, (event.target as HTMLTextAreaElement).value)
  }

  function handleEditorBlur() {
    mode = 'preview'
    triggerAutoSync()
  }

  // 颜色切换：暂停几何同步避免窗口事件干扰，颜色变更会标记 dirty 同步到 Supabase
  async function handleColorChange(colorId: string) {
    if (!noteId) {
      return
    }

    geometryPaused = true
    try {
      await desktopNotesStore.updateNoteColor(
        noteId,
        colorId as NonNullable<typeof currentNote>['color'],
      )
    }
    finally {
      // 延迟恢复，确保窗口事件已经稳定
      setTimeout(() => {
        geometryPaused = false
      }, 500)
    }
    colorPanelOpen = false

    // 颜色变更同步到 Supabase
    triggerAutoSync()
  }

  /** 若启用同步且已认证，触发防抖自动同步 */
  function triggerAutoSync() {
    if (
      configStore.config.desktopNotesSyncEnabled
      && desktopNotesStore.session.authenticated
    ) {
      desktopNotesStore.queueAutoSync()
    }
  }

  async function handleCloseWindow() {
    if (!noteId) {
      return
    }

    // 标记为用户主动关闭，closeNoteWindow 内部会设 visible: false
    closedByUser = true
    await desktopNotesStore.closeNoteWindow(noteId)
  }

  function toggleColorPanel() {
    colorPanelOpen = !colorPanelOpen
  }

  onMount(() => {
    const handleGlobalDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.content-area')) {
        mode = 'edit'
      }
    }

    window.addEventListener('dblclick', handleGlobalDoubleClick)

    void (async () => {
      await configStore.init()
      await desktopNotesStore.init()
      applyTheme(configStore.config.theme)

      // 诊断：确认便签窗口初始化后是否能找到对应便签
      const foundNote = noteId ? desktopNotesStore.getNoteById(noteId) : null
      if (!foundNote && noteId) {
        logger.warn('Sticky note window: note not found after init', {
          noteId,
          totalNotes: desktopNotesStore.notes.length,
          noteIds: desktopNotesStore.notes.map(n => n.id),
        })
      }

      // 刷新认证状态，以便自动同步判断
      void desktopNotesStore.refreshSession()

      // 初始化后延迟同步一次几何，避免初始化期间的干扰
      setTimeout(() => {
        scheduleGeometrySync()
      }, 500)

      try {
        unlistenTheme = await listen<{ theme?: 'system' | 'light' | 'dark' }>('theme-changed', async (event) => {
          const theme = event.payload?.theme ?? configStore.config.theme
          applyTheme(theme)
        })
      }
      catch (error) {
        logger.error('Failed to listen for desktop note theme changes', error)
      }

      try {
        unlistenBeforeExit = await listen('app-before-exit', async () => {
          // 托盘退出流程：在真正退出前强制落盘，避免最后一次 resize/drag 丢失
          await desktopNotesStore.flushPersistPublic()
        })

        unlistenMoved = await appWindow.onMoved(() => {
          scheduleGeometrySync()
        })
        unlistenResized = await appWindow.onResized(() => {
          scheduleGeometrySync()
        })
        unlistenBlur = await appWindow.listen('tauri://blur', () => {
          if (mode === 'edit') {
            mode = 'preview'
          }
          triggerAutoSync()
        })
        unlistenClose = await appWindow.onCloseRequested(async () => {
          // 仅在用户主动关闭时设 visible: false（closeNoteWindow 已处理）；
          // app exit 导致的窗口关闭不修改 visible，确保重启后能恢复
          if (noteId && !closedByUser) {
            // app exit 场景：仅刷新持久化，不改 visible
            await desktopNotesStore.flushPersistPublic()
          }
        })
      }
      catch (error) {
        logger.error('Failed to register desktop note window listeners', error)
      }
    })()

    return () => {
      window.removeEventListener('dblclick', handleGlobalDoubleClick)
      unlistenTheme?.()
      unlistenMoved?.()
      unlistenResized?.()
      unlistenBlur?.()
      unlistenClose?.()
      unlistenBeforeExit?.()
      if (geometryTimer) {
        clearTimeout(geometryTimer)
      }
    }
  })
</script>

<svelte:head>
  <title>{t('desktopNotes.windowTitle')}</title>
</svelte:head>

{#if currentNote}
  <div class='note-shell' data-color={currentNote.color}>
    <!-- 顶部工具栏：拖拽区域 + 悬停时才显示关闭按钮 -->
    <header class='note-header' data-tauri-drag-region>
      <div class='header-tools'>
        <!-- 颜色选择按钮（小圆点） -->
        <button
          class='color-dot-btn'
          type='button'
          title={t('desktopNotes.changeColor')}
          onclick={toggleColorPanel}
        >
          <span class='color-dot current'></span>
        </button>

      </div>

      <!-- 关闭按钮：仅悬停时可见 -->
      <button class='close-btn' type='button' onclick={handleCloseWindow} title={t('common.close')}>
        ✕
      </button>
    </header>

    <!-- 颜色选择面板（展开时显示） -->
    {#if colorPanelOpen}
      <div class='color-panel'>
        {#each DESKTOP_NOTE_COLOR_PRESETS as preset (preset.id)}
          <button
            class='color-dot-option'
            class:active={preset.id === currentNote.color}
            type='button'
            aria-label={t(`desktopNotes.colors.${preset.id}`)}
            title={t(`desktopNotes.colors.${preset.id}`)}
            style={`--dot-bg:${preset.background}; --dot-border:${preset.accent};`}
            onclick={() => handleColorChange(preset.id)}
          ></button>
        {/each}
      </div>
    {/if}

    <!-- 编辑或预览区（切换模式，不同时显示） -->
    <div class='content-area'>
      {#if mode === 'edit'}
        <textarea
          class='note-editor'
          value={currentNote.content}
          placeholder={t('desktopNotes.contentPlaceholder')}
          oninput={handleContentInput}
          onblur={handleEditorBlur}
        ></textarea>
      {:else}
        <div class='note-preview markdown-body'>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html previewHtml || `<p class="empty-hint">${t('desktopNotes.previewEmpty')}</p>`}
        </div>
      {/if}
    </div>

    <!-- 同步状态指示器（仅在同步进行中或有结果时显示） -->
    {#if syncStatus !== 'idle'}
      <div class='sync-indicator' data-status={syncStatus}>
        {#if syncStatus === 'syncing'}
          {t('desktopNotes.sync.syncing')}
        {:else if syncStatus === 'success'}
          ✓ {t('desktopNotes.sync.autoSyncSuccess')}
        {:else if syncStatus === 'error'}
          ✗ {t('desktopNotes.sync.autoSyncError')}
        {/if}
      </div>
    {/if}
  </div>
{:else if !desktopNotesStore.initialized}
  <div class='empty-shell loading'>
    <p>{t('desktopNotes.loading')}</p>
  </div>
{:else}
  <div class='empty-shell'>
    <p>{t('desktopNotes.notFoundDescription')}</p>
  </div>
{/if}

<style>
    :global(body) {
        margin: 0;
        overflow: hidden;
        background: transparent;
    }

    /* 便签外壳与颜色变量 */
    .note-shell {
        --note-bg: #FFF4B5;
        --note-accent: #E5B300;
        --note-text: #3A2A00;
        width: 100vw;
        height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--note-bg);
        color: var(--note-text);
        box-sizing: border-box;
        overflow: hidden;
    }

    .note-shell[data-color='mint'] {
        --note-bg: #DDF8E8;
        --note-accent: #23A56B;
        --note-text: #123A27;
    }

    .note-shell[data-color='sky'] {
        --note-bg: #DDEEFF;
        --note-accent: #2B78E4;
        --note-text: #102A43;
    }

    .note-shell[data-color='lavender'] {
        --note-bg: #EEE6FF;
        --note-accent: #7C4DFF;
        --note-text: #28185A;
    }

    .note-shell[data-color='rose'] {
        --note-bg: #FFE2EA;
        --note-accent: #E64980;
        --note-text: #5B1830;
    }

    .note-shell[data-color='slate'] {
        --note-bg: #E6ECF5;
        --note-accent: #52667A;
        --note-text: #1E2933;
    }

    /* 顶部工具栏 */
    .note-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.3rem 0.5rem;
        background: color-mix(in srgb, var(--note-accent) 8%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 18%, transparent);
        min-height: 1.8rem;
    }

    .header-tools {
        display: flex;
        gap: 0.35rem;
        align-items: center;
        -webkit-app-region: no-drag;
    }

    /* 关闭按钮：默认隐藏，悬停时渐显 */
    .close-btn {
        opacity: 0;
        border: none;
        background: none;
        color: var(--note-text);
        font-size: 0.85rem;
        cursor: pointer;
        padding: 0.15rem 0.35rem;
        border-radius: 0.25rem;
        transition: opacity 0.2s ease, background 0.15s ease;
        -webkit-app-region: no-drag;
    }

    .note-header:hover .close-btn {
        opacity: 0.7;
    }

    .close-btn:hover {
        opacity: 1 !important;
        background: color-mix(in srgb, #ef4444 18%, transparent);
    }

    /* 当前颜色按钮（小圆点） */
    .color-dot-btn {
        border: none;
        background: none;
        padding: 0.15rem;
        cursor: pointer;
        -webkit-app-region: no-drag;
    }

    .color-dot.current {
        display: block;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--note-accent);
        border: 2px solid color-mix(in srgb, var(--note-accent) 60%, white);
        transition: transform 0.15s ease;
    }

    .color-dot-btn:hover .color-dot.current {
        transform: scale(1.15);
    }

    /* 颜色面板（展开时） */
    .color-panel {
        display: flex;
        gap: 0.4rem;
        padding: 0.35rem 0.5rem;
        background: color-mix(in srgb, white 55%, var(--note-bg));
        border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 15%, transparent);
        -webkit-app-region: no-drag;
    }

    .color-dot-option {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--dot-border);
        background: var(--dot-bg);
        cursor: pointer;
        padding: 0;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .color-dot-option:hover {
        transform: scale(1.2);
    }

    .color-dot-option.active {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--dot-border) 40%, white);
        transform: scale(1.15);
    }

    /* 内容区域 */
    .content-area {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .note-editor {
        flex: 1;
        min-height: 0;
        resize: none;
        border: none;
        outline: none;
        background: transparent;
        color: var(--note-text);
        font: inherit;
        font-size: 0.9rem;
        line-height: 1.6;
        padding: 0.6rem 0.75rem;
        box-sizing: border-box;
        -webkit-app-region: no-drag;
        overflow: auto;
    }

    .note-editor::placeholder {
        color: color-mix(in srgb, var(--note-text) 45%, transparent);
    }

    .note-preview {
        flex: 1;
        min-height: 0;
        padding: 0.6rem 0.75rem;
        box-sizing: border-box;
        overflow: auto;
        color: color-mix(in srgb, var(--note-text) 90%, black);
        font-size: 0.9rem;
        line-height: 1.6;
        word-break: break-word;
    }

    .note-preview :global(*) {
      box-sizing: border-box;
    }

    .note-preview :global(h1),
    .note-preview :global(h2),
    .note-preview :global(h3) {
        margin-top: 0;
    }

    .note-preview :global(p) {
        margin: 0.3rem 0;
    }

    .note-preview :global(ul),
    .note-preview :global(ol) {
        margin: 0.3rem 0;
        padding-left: 1.4rem;
    }

    .note-preview :global(li + li) {
      margin-top: 0.15rem;
    }

    .note-preview :global(blockquote) {
      margin: 0.45rem 0;
      padding: 0.25rem 0.55rem;
      border-left: 3px solid color-mix(in srgb, var(--note-accent) 65%, white 20%);
      background: color-mix(in srgb, var(--note-accent) 8%, white 82%);
      border-radius: 0.2rem;
      color: color-mix(in srgb, var(--note-text) 90%, black);
    }

    .note-preview :global(blockquote p) {
      margin: 0.2rem 0;
    }

    .note-preview :global(a) {
      color: color-mix(in srgb, var(--note-accent) 80%, #1d4ed8 20%);
      text-decoration: underline;
      text-underline-offset: 0.12rem;
      word-break: break-all;
    }

    .note-preview :global(a:hover) {
      opacity: 0.9;
    }

    .note-preview :global(hr) {
      border: none;
      border-top: 1px solid color-mix(in srgb, var(--note-accent) 25%, transparent);
      margin: 0.6rem 0;
    }

    .note-preview :global(table) {
      width: 100%;
      margin: 0.5rem 0;
      border-collapse: collapse;
      border: 1px solid color-mix(in srgb, var(--note-accent) 35%, white 40%);
      font-size: 0.84rem;
      background: color-mix(in srgb, white 65%, var(--note-bg));
    }

    .note-preview :global(th),
    .note-preview :global(td) {
      border: 1px solid color-mix(in srgb, var(--note-accent) 28%, white 45%);
      padding: 0.35rem 0.45rem;
      text-align: left;
      vertical-align: top;
    }

    .note-preview :global(thead th) {
      background: color-mix(in srgb, var(--note-accent) 14%, white 75%);
      font-weight: 600;
    }

    .note-preview :global(tbody tr:nth-child(even)) {
      background: color-mix(in srgb, var(--note-accent) 6%, white 82%);
    }

    .note-preview :global(pre) {
        padding: 0.55rem;
        border-radius: 0.4rem;
        background: color-mix(in srgb, var(--note-accent) 8%, white 70%);
        overflow: auto;
        font-size: 0.82rem;
      border: 1px solid color-mix(in srgb, var(--note-accent) 22%, white 50%);
    }

    .note-preview :global(code) {
        font-family: Consolas, 'Courier New', monospace;
    }

    .note-preview :global(:not(pre) > code) {
      padding: 0.08rem 0.25rem;
      border-radius: 0.24rem;
      background: color-mix(in srgb, var(--note-accent) 10%, white 74%);
      border: 1px solid color-mix(in srgb, var(--note-accent) 22%, white 55%);
      font-size: 0.82rem;
    }

    .note-preview :global(input[type='checkbox']) {
      margin-right: 0.28rem;
      accent-color: color-mix(in srgb, var(--note-accent) 85%, #1d4ed8 15%);
      transform: translateY(1px);
    }

    .note-preview :global(.empty-hint) {
        color: color-mix(in srgb, var(--note-text) 45%, transparent);
        font-style: italic;
    }

    /* 同步状态指示器 —— 位于便签底部，小字低调显示 */
    .sync-indicator {
        padding: 0.15rem 0.5rem;
        font-size: 0.7rem;
        text-align: center;
        opacity: 0.6;
        color: var(--note-text);
        border-top: 1px solid color-mix(in srgb, var(--note-accent) 12%, transparent);
        transition: opacity 0.3s ease;
    }

    .sync-indicator[data-status='success'] {
        color: #23a56b;
    }

    .sync-indicator[data-status='error'] {
        color: #e64980;
    }

    .empty-shell {
        width: 100vw;
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        background: var(--bg-primary, #fafafa);
        color: var(--text-secondary, #666);
        font-size: 0.875rem;
    }
</style>
