<script lang='ts'>
  import type { Locale } from '$lib/i18n'
  import type { DesktopNoteBounds, DesktopNoteColor } from '$lib/types/desktop-note'
  import type { DesktopNoteTodoPreferences } from '$lib/utils/desktop-note-todo'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import DesktopNoteTodoEditor from '$lib/components/DesktopNoteTodoEditor.svelte'
  import { DEFAULT_LOCALE, i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { desktopNotesStore } from '$lib/stores/desktop-notes.svelte'
  import { DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES, DESKTOP_NOTE_COLOR_PRESETS, DESKTOP_NOTES } from '$lib/utils/constants'
  import { renderDesktopNoteMarkdown } from '$lib/utils/desktop-note-markdown'
  import { logger } from '$lib/utils/logger'
  import { loadNoteTodoPreferences, saveNoteTodoPreferences } from '$lib/utils/storage'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { onMount } from 'svelte'
  import '$lib/styles/base.css'

  const t = i18n.t
  const appWindow = getCurrentWebviewWindow()
  const noteId = new URLSearchParams(window.location.search).get('noteId') ?? ''

  let mode = $state<'edit' | 'preview'>('preview')
  let colorPanelOpen = $state(false)
  let locale = $state<Locale | null>(null)
  let todoPreferences = $state<DesktopNoteTodoPreferences>(DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES)
  let todoPreferencesReady = $state(false)
  let closing = false
  let geometryTimer: ReturnType<typeof setTimeout> | undefined
  let pendingGeometry = Promise.resolve()
  let pendingTodoPreferences = Promise.resolve()

  const currentNote = $derived(noteId ? desktopNotesStore.getNoteById(noteId) : null)
  const isTodo = $derived(currentNote?.kind === 'todo')
  const previewHtml = $derived(renderDesktopNoteMarkdown(currentNote?.content ?? ''))
  const syncStatus = $derived(desktopNotesStore.lastAutoSyncStatus)

  function applyTheme(theme: 'system' | 'light' | 'dark') {
    const dark = theme === 'dark'
      || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  }

  function commitCurrentGeometry() {
    pendingGeometry = pendingGeometry.then(async () => {
      if (!noteId) {
        return
      }
      const bounds = await invoke<DesktopNoteBounds | null>('capture_desktop_note_bounds')
      if (bounds) {
        await desktopNotesStore.updateNoteBounds(noteId, bounds)
      }
    }).catch(error => logger.warn('Failed to commit sticky note geometry', error))
    return pendingGeometry
  }

  function scheduleGeometrySync() {
    clearTimeout(geometryTimer)
    geometryTimer = setTimeout(() => {
      geometryTimer = undefined
      void commitCurrentGeometry()
    }, DESKTOP_NOTES.GEOMETRY_DEBOUNCE_MS)
  }

  function handleContentChange(content: string) {
    void desktopNotesStore.updateNoteContent(noteId, content)
    triggerAutoSync()
  }

  function handleTodoPreferencesChange(preferences: DesktopNoteTodoPreferences) {
    todoPreferences = preferences
    pendingTodoPreferences = saveNoteTodoPreferences(noteId, preferences)
      .catch(error => logger.warn('Failed to save note task preferences', { noteId, error }))
  }

  function handleContentInput(event: Event) {
    handleContentChange((event.target as HTMLTextAreaElement).value)
  }

  function handleEditorBlur() {
    mode = 'preview'
    triggerAutoSync()
  }

  async function handleColorChange(color: DesktopNoteColor) {
    await desktopNotesStore.updateNoteColor(noteId, color)
    colorPanelOpen = false
    triggerAutoSync()
  }

  function triggerAutoSync() {
    if (configStore.config.desktopNotesSyncEnabled && desktopNotesStore.session.authenticated) {
      desktopNotesStore.queueAutoSync()
    }
  }

  async function handleCloseWindow() {
    try {
      await appWindow.close()
    }
    catch (error) {
      logger.error('Failed to close sticky note', error)
    }
  }

  function handleGlobalDoubleClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (!isTodo && target?.closest('.content-area')) {
      mode = 'edit'
    }
  }

  onMount(() => {
    const unlisteners: UnlistenFn[] = []
    let disposed = false
    window.addEventListener('dblclick', handleGlobalDoubleClick)

    function register(registration: Promise<UnlistenFn>) {
      void registration.then((cleanup) => {
        if (disposed) {
          cleanup()
        }
        else {
          unlisteners.push(cleanup)
        }
      }).catch(error => logger.warn('Failed to register sticky note event listener', error))
    }

    const loadAppearance = configStore.init().then(async () => {
      applyTheme(configStore.config.theme)
      const requestedLocale = configStore.config.locale ?? DEFAULT_LOCALE
      await i18n.locale.set(requestedLocale)
      document.documentElement.lang = requestedLocale
      locale = requestedLocale
    })
    const loadNote = desktopNotesStore.init().then(async () => {
      if (!currentNote && noteId) {
        logger.warn('Sticky note not found in local storage', { noteId })
      }
      if (currentNote?.kind === 'todo') {
        try {
          todoPreferences = await loadNoteTodoPreferences(noteId)
        }
        catch (error) {
          logger.warn('Failed to load note task preferences', { noteId, error })
        }
      }
      todoPreferencesReady = true
      void desktopNotesStore.refreshSession()
    })
    const ready = Promise.all([loadAppearance, loadNote])
    void ready.catch(error => logger.error('Failed to initialize sticky note', error))

    register(appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      if (closing) {
        return
      }
      closing = true
      try {
        await ready
        if (geometryTimer) {
          clearTimeout(geometryTimer)
          geometryTimer = undefined
        }
        await commitCurrentGeometry()
        await desktopNotesStore.markNoteHiddenLocally(noteId)
        await Promise.all([desktopNotesStore.flushPersistPublic(), pendingTodoPreferences])
      }
      catch (error) {
        logger.warn('Failed to save sticky note before closing', error)
      }
      try {
        await appWindow.destroy()
      }
      catch (error) {
        logger.error('Failed to destroy sticky note', error)
      }
      finally {
        closing = false
      }
    }))

    register(listen<{ theme?: 'system' | 'light' | 'dark' }>('theme-changed', event =>
      applyTheme(event.payload?.theme ?? configStore.config.theme)))
    register(listen('app-before-exit', async () => {
      try {
        if (geometryTimer) {
          clearTimeout(geometryTimer)
          geometryTimer = undefined
        }
        await commitCurrentGeometry()
        await Promise.all([desktopNotesStore.flushPersistPublic(), pendingTodoPreferences])
      }
      catch (error) {
        logger.warn('Failed to save sticky note before exit', error)
      }
    }))
    register(appWindow.listen(DESKTOP_NOTES.GEOMETRY_CAPTURE_EVENT, scheduleGeometrySync))
    register(appWindow.listen('tauri://blur', handleEditorBlur))

    return () => {
      disposed = true
      window.removeEventListener('dblclick', handleGlobalDoubleClick)
      unlisteners.forEach(cleanup => cleanup())
      clearTimeout(geometryTimer)
    }
  })
</script>

<svelte:head>
  <title>{locale ? t('desktopNotes.windowTitle') : ''}</title>
</svelte:head>

{#if currentNote && locale}
  <div class='note-shell' data-color={currentNote.color}>
    <header class='note-header'>
      <div class='header-tools'>
        <button
          class='color-dot-btn'
          type='button'
          title={t('desktopNotes.changeColor')}
          onclick={() => { colorPanelOpen = !colorPanelOpen }}
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
      {#if isTodo}
        {#if todoPreferencesReady}
          <DesktopNoteTodoEditor
            content={currentNote.content}
            preferences={todoPreferences}
            onChange={handleContentChange}
            onPreferencesChange={handleTodoPreferencesChange}
          />
        {/if}
      {:else if mode === 'edit'}
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
{:else if !desktopNotesStore.initialized || !locale}
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
        color: var(--success-color);
    }

    .sync-indicator[data-status='error'] {
        color: var(--error-color);
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
