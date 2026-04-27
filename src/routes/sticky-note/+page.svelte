<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { desktopNotesStore } from '$lib/stores/desktop-notes.svelte'

  import {
    DESKTOP_NOTE_COLOR_PRESETS,
    DESKTOP_NOTES,
  } from '$lib/utils/constants'
  import { renderDesktopNoteMarkdown } from '$lib/utils/desktop-note-markdown'
  import { logger } from '$lib/utils/logger'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { onMount } from 'svelte'
  import '$lib/styles/base.css'

  const t = i18n.t
  const appWindow = getCurrentWebviewWindow()

  const noteId = new URLSearchParams(window.location.search).get('noteId') ?? ''

  // 编辑 / 预览切换
  let mode = $state<'edit' | 'preview'>('preview')
  // 颜色面板展开态
  let colorPanelOpen = $state(false)
  // 颜色切换期间暂停几何回写，避免误写位置
  let geometryPaused = $state(false)
  // 已经进入关闭流程，用于避免重入
  let closing = false

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

  /**
   * 读取当前窗口几何并以逻辑像素形式写回 store（仅本地持久化）。
   *
   * 设计原则：钉死在系统给的逻辑坐标，不做任何屏幕/显示器感知。
   * 所有异常被吞掉，只记录 warn，绝不阻塞关闭/退出流程。
   *
   * 参数 `force`：为 true 时绕过 `geometryPaused`。
   * 用于关闭路径 — 即使窗口刚换过颜色也必须落盘位置。
   */
  async function commitCurrentGeometry(force = false): Promise<void> {
    if (!noteId) {
      return
    }
    if (!force && geometryPaused) {
      return
    }

    try {
      const [physPosition, physSize, scaleFactor] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.innerSize(),
        appWindow.scaleFactor(),
      ])

      const logicalPos = physPosition.toLogical(scaleFactor)
      const logicalSize = physSize.toLogical(scaleFactor)

      await desktopNotesStore.updateNoteBounds(noteId, {
        x: Math.round(logicalPos.x),
        y: Math.round(logicalPos.y),
        width: Math.max(Math.round(logicalSize.width), DESKTOP_NOTES.MIN_WIDTH),
        height: Math.max(Math.round(logicalSize.height), DESKTOP_NOTES.MIN_HEIGHT),
      })
    }
    catch (error) {
      logger.warn('Failed to commit sticky note geometry', error)
    }
  }

  /** 防抖同步几何到本地，然后触发内容/颜色等的云同步 */
  function scheduleGeometrySync() {
    if (!noteId || geometryPaused) {
      return
    }

    if (geometryTimer) {
      clearTimeout(geometryTimer)
    }

    geometryTimer = setTimeout(() => {
      if (geometryPaused) {
        return
      }
      void commitCurrentGeometry().then(() => triggerAutoSync())
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

  /** 颜色切换：暂停几何同步避免误触发位置回写 */
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
      setTimeout(() => {
        geometryPaused = false
      }, 500)
    }
    colorPanelOpen = false
    triggerAutoSync()
  }

  function triggerAutoSync() {
    if (
      configStore.config.desktopNotesSyncEnabled
      && desktopNotesStore.session.authenticated
    ) {
      desktopNotesStore.queueAutoSync()
    }
  }

  /**
   * 关闭按钮点击：直接请求关闭窗口。
   * 所有持久化由 onCloseRequested 统一处理，保证无论 X 按钮、系统菜单、
   * Alt+F4 还是 Rust 侧 window.close() 都走同一流程。
   */
  async function handleCloseWindow() {
    if (closing) {
      return
    }
    try {
      await appWindow.close()
    }
    catch (error) {
      logger.error('appWindow.close() failed', error)
    }
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

      const foundNote = noteId ? desktopNotesStore.getNoteById(noteId) : null
      if (!foundNote && noteId) {
        logger.warn('Sticky note window: note not found after init', {
          noteId,
          totalNotes: desktopNotesStore.notes.length,
        })
      }

      await desktopNotesStore.refreshSession()

      try {
        // 先注册 close 监听，避免其他监听失败导致关闭链路失效
        // 规范 Tauri v2 模式：preventDefault → 异步落盘 → destroy()
        // 权限：desktop-notes.json 中已开启 core:window:allow-destroy
        unlistenClose = await appWindow.onCloseRequested(async (event) => {
          if (closing) {
            return
          }
          closing = true
          event.preventDefault()

          try {
            // 关闭路径：force=true 绕过 geometryPaused 与 monitor-change 拦截，
            // 确保即使颜色刚切换也能落盘最后一次位置
            await commitCurrentGeometry(true)
            if (noteId) {
              await desktopNotesStore.markNoteHiddenLocally(noteId)
            }
            // 关闭前必须立即同步（不能依赖防抖 queueAutoSync，destroy 会在防抖触发前销毁 webview）
            // 不在此处检查 session.authenticated——直接尝试同步，失败时优雅降级到本地落盘
            // （syncWithSupabase 内部的 getCurrentUser 使用 Supabase 实际 auth 状态，不依赖内存 session）
            if (configStore.config.desktopNotesSyncEnabled) {
              await desktopNotesStore.syncWithSupabase()
            }
            else {
              await desktopNotesStore.flushPersistPublic()
            }
          }
          catch (error) {
            logger.warn('Sticky note pre-close persist/sync failed', error)
            // 同步失败时兜底落盘，保证本地状态不丢
            try {
              await desktopNotesStore.flushPersistPublic()
            }
            catch { /* ignore */ }
          }

          try {
            // 使用 destroy() 强制关闭，不触发新的 closeRequested 事件
            // 权限：desktop-notes.json 中已开启 core:window:allow-destroy
            await appWindow.destroy()
          }
          catch (error) {
            logger.error('appWindow.destroy() failed', error)
            closing = false
          }
        })
      }
      catch (error) {
        logger.error('Failed to register sticky note close listener', error)
      }

      try {
        unlistenTheme = await listen<{ theme?: 'system' | 'light' | 'dark' }>(
          'theme-changed',
          (event) => {
            applyTheme(event.payload?.theme ?? configStore.config.theme)
          },
        )
      }
      catch (error) {
        logger.warn('Failed to register theme listener for sticky note', error)
      }

      try {
        // 托盘退出：只落盘待写内容/颜色等变更，不重新读取几何（避免在 OS 强制移位后保存错误坐标）
        // bounds 变更已通过 per-note key 实时写入，无需在此再次 commit。
        unlistenBeforeExit = await listen('app-before-exit', async () => {
          try {
            await desktopNotesStore.flushPersistPublic()
          }
          catch (error) {
            logger.warn('app-before-exit flush failed', error)
          }
        })
      }
      catch (error) {
        logger.warn('Failed to register app-before-exit listener for sticky note', error)
      }

      try {
        unlistenMoved = await appWindow.onMoved(() => scheduleGeometrySync())
      }
      catch (error) {
        logger.warn('Failed to register moved listener for sticky note', error)
      }

      try {
        unlistenResized = await appWindow.onResized(() => scheduleGeometrySync())
      }
      catch (error) {
        logger.warn('Failed to register resized listener for sticky note', error)
      }

      try {
        unlistenBlur = await appWindow.listen('tauri://blur', () => {
          if (mode === 'edit') {
            mode = 'preview'
          }
          triggerAutoSync()
        })
      }
      catch (error) {
        logger.warn('Failed to register blur listener for sticky note', error)
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
    <header class='note-header'>
      <div class='header-tools'>
        <button
          class='color-dot-btn'
          type='button'
          title={t('desktopNotes.changeColor')}
          onclick={toggleColorPanel}
        >
          <span class='color-dot current'></span>
        </button>
      </div>

      <!-- 中间拖拽区（唯一拖拽热区，不挡交互元素） -->
      <div class='drag-region' data-tauri-drag-region></div>

      <button
        class='close-btn'
        type='button'
        onclick={handleCloseWindow}
        title={t('common.close')}
        aria-label={t('common.close')}
      >
        ✕
      </button>
    </header>

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

    .note-header {
        display: flex;
        align-items: center;
        padding: 0.3rem 0.5rem;
        background: color-mix(in srgb, var(--note-accent) 8%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 18%, transparent);
        min-height: 1.8rem;
    }

    .drag-region {
        flex: 1;
        min-width: 0;
        min-height: 1.2rem;
    }

    .header-tools {
        display: flex;
        gap: 0.35rem;
        align-items: center;
    }

    /* 关闭按钮：始终可点击，默认半透明；hover/focus 加强 */
    .close-btn {
        opacity: 0.5;
        border: none;
        background: none;
        color: var(--note-text);
        font-size: 0.85rem;
        cursor: pointer;
        padding: 0.15rem 0.45rem;
        border-radius: 0.25rem;
        transition: opacity 0.15s ease, background 0.15s ease;
        line-height: 1;
    }

    .close-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, #ef4444 18%, transparent);
    }

    .close-btn:focus-visible {
        opacity: 1;
        outline: 2px solid color-mix(in srgb, #ef4444 60%, transparent);
        outline-offset: 1px;
    }

    .color-dot-btn {
        border: none;
        background: none;
        padding: 0.15rem;
        cursor: pointer;
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

    .color-panel {
        display: flex;
        gap: 0.4rem;
        padding: 0.35rem 0.5rem;
        background: color-mix(in srgb, white 55%, var(--note-bg));
        border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 15%, transparent);
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
