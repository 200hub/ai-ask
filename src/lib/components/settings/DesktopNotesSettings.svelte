<script lang='ts'>
  import type { DesktopNoteBounds } from '$lib/types/desktop-note'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { desktopNotesStore } from '$lib/stores/desktop-notes.svelte'
  import {
    DESKTOP_NOTE_COLOR_PRESETS,
    DESKTOP_NOTES,
    SUPABASE,
  } from '$lib/utils/constants'
  import { logger } from '$lib/utils/logger'
  import { isSupabaseAvailable, resetPassword } from '$lib/utils/supabase'
  import { onDestroy, onMount } from 'svelte'

  const t = i18n.t

  let isBusy = $state(false)
  let authMode = $state<'signin' | 'signup'>('signin')
  let authEmail = $state('')
  let authPassword = $state('')
  let authStatus = $state('')

  const activeNotes = $derived(desktopNotesStore.activeNotes)
  const uniqueActiveNotes = $derived.by(() => {
    const seen = new Set<string>()
    const result: typeof activeNotes = []
    for (const note of activeNotes) {
      if (seen.has(note.id)) {
        continue
      }
      seen.add(note.id)
      result.push(note)
    }
    return result
  })
  const session = $derived(desktopNotesStore.session)
  const lastSyncedAt = $derived(configStore.config.desktopNotesLastSyncedAt)
  // 云同步后端是否可用（开发阶段可能未配置，打包后一定可用）
  const syncAvailable = $derived(isSupabaseAvailable())

  // 设置页与便签窗口处于不同 Tauri webview，store 实例独立。
  // 每次进入设置页时强制重新读取持久化数据，保证列表数据最新。
  // 同时定期轮询刷新，确保便签窗口的修改能及时反映到设置页列表。
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  onMount(() => {
    void desktopNotesStore.init(true)
    void desktopNotesStore.refreshSession()

    refreshTimer = setInterval(() => {
      void desktopNotesStore.init(true)
    }, DESKTOP_NOTES.SETTINGS_REFRESH_INTERVAL_MS)
  })

  onDestroy(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  })

  function formatTranslation(
    key: string,
    params: Record<string, string | number> = {},
  ): string {
    let output = t(key)
    for (const [paramKey, paramValue] of Object.entries(params)) {
      output = output.replace(`{${paramKey}}`, String(paramValue))
    }
    return output
  }

  function formatTimestamp(timestamp: number | null): string {
    if (!timestamp) {
      return t('desktopNotes.sync.never')
    }

    return new Date(timestamp).toLocaleString()
  }

  function colorPreviewStyle(colorId: string): string {
    const preset = DESKTOP_NOTE_COLOR_PRESETS.find(item => item.id === colorId)
    if (!preset) {
      return ''
    }

    return `background:${preset.background}; border-color:${preset.accent}; color:${preset.text};`
  }

  /** 将百分比 bounds 转换为近似像素尺寸（用于设置页显示） */
  function noteSizeLabel(bounds: DesktopNoteBounds): string {
    const w = Math.round((bounds.rightPercent - bounds.leftPercent) * DESKTOP_NOTES.DEFAULT_SCREEN_WIDTH)
    const h = Math.round((bounds.bottomPercent - bounds.topPercent) * DESKTOP_NOTES.DEFAULT_SCREEN_HEIGHT)
    return `${w}×${h}`
  }

  async function handleFeatureToggle(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked
    isBusy = true

    try {
      await configStore.setDesktopNotesEnabled(enabled)
      if (enabled) {
        await desktopNotesStore.restoreVisibleWindows({ recoverHidden: false })
      }
      else {
        await desktopNotesStore.hideAllWindows()
      }
    }
    catch (error) {
      logger.error('Failed to toggle desktop notes feature', error)
    }
    finally {
      isBusy = false
    }
  }

  async function handleSyncToggle(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked
    try {
      await configStore.setDesktopNotesSyncEnabled(enabled)
    }
    catch (error) {
      logger.error('Failed to toggle desktop notes sync', error)
    }
  }

  async function handleCreateNote() {
    isBusy = true
    try {
      const note = await desktopNotesStore.createNote()
      if (configStore.config.desktopNotesEnabled) {
        await desktopNotesStore.openNoteWindow(note.id)
      }
    }
    catch (error) {
      logger.error('Failed to create desktop note', error)
    }
    finally {
      isBusy = false
    }
  }

  async function handleOpenNote(noteId: string) {
    try {
      await desktopNotesStore.openNoteWindow(noteId)
    }
    catch (error) {
      logger.error('Failed to open desktop note', { noteId, error })
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await desktopNotesStore.deleteNote(noteId)
    }
    catch (error) {
      logger.error('Failed to delete desktop note', { noteId, error })
    }
  }

  async function handleAuth() {
    const email = authEmail.trim()
    const password = authPassword

    if (!email || !password) {
      authStatus = t('desktopNotes.auth.fillFields')
      return
    }

    if (password.length < SUPABASE.PASSWORD_MIN_LENGTH) {
      authStatus = formatTranslation('desktopNotes.auth.passwordTooShort', {
        min: SUPABASE.PASSWORD_MIN_LENGTH,
      })
      return
    }

    isBusy = true
    authStatus = ''

    try {
      if (authMode === 'signup') {
        const result = await desktopNotesStore.signUp(email, password)
        if (result.authenticated) {
          authStatus = formatTranslation('desktopNotes.auth.signedInAs', { email: result.email ?? email })
        }
        else {
          authStatus = t('desktopNotes.auth.confirmEmail')
        }
      }
      else {
        const result = await desktopNotesStore.signIn(email, password)
        authStatus = formatTranslation('desktopNotes.auth.signedInAs', { email: result.email ?? email })
      }

      // 登录成功后清除表单
      authEmail = ''
      authPassword = ''
    }
    catch (error) {
      authStatus = error instanceof Error ? error.message : String(error)
      logger.error('Authentication failed', error)
    }
    finally {
      isBusy = false
    }
  }

  async function handleSignOut() {
    isBusy = true
    try {
      await desktopNotesStore.signOut()
      authStatus = t('desktopNotes.auth.signedOut')
    }
    catch (error) {
      logger.error('Failed to sign out', error)
    }
    finally {
      isBusy = false
    }
  }

  async function handleResetPassword() {
    const email = authEmail.trim()
    if (!email) {
      authStatus = t('desktopNotes.auth.enterEmail')
      return
    }

    isBusy = true
    try {
      await resetPassword(email)
      authStatus = t('desktopNotes.auth.resetEmailSent')
    }
    catch (error) {
      authStatus = error instanceof Error ? error.message : String(error)
      logger.error('Password reset failed', error)
    }
    finally {
      isBusy = false
    }
  }

  async function handleSyncNow() {
    isBusy = true
    try {
      // 手动同步使用全量拉取，确保能获取到所有远端变更
      // （增量拉取依赖 lastSyncedAt 过滤，可能遗漏直接在数据库修改的记录）
      const result = await desktopNotesStore.syncWithSupabase({ fullPull: true })
      authStatus = formatTranslation('desktopNotes.sync.successCount', {
        pushed: result.pushed,
        pulled: result.pulled,
      })
    }
    catch (error) {
      authStatus = error instanceof Error ? error.message : String(error)
      logger.error('Failed to sync desktop notes', error)
    }
    finally {
      isBusy = false
    }
  }
</script>

<div class='settings-section'>
  <div class='setting-group'>
    <h3 class='group-title'>{t('desktopNotes.title')}</h3>

    <div class='setting-item'>
      <div class='setting-label'>
        <span class='label-text'>{t('desktopNotes.enabled')}</span>
        <span class='label-description'>{t('desktopNotes.enabledDescription')}</span>
      </div>
      <label class='toggle-switch'>
        <input
          type='checkbox'
          checked={configStore.config.desktopNotesEnabled}
          onchange={handleFeatureToggle}
          disabled={isBusy}
        />
        <span class='toggle-slider'></span>
      </label>
    </div>

    <div class='setting-item stacked'>
      <div class='setting-label'>
        <span class='label-text'>{t('desktopNotes.create')}</span>
        <span class='label-description'>{t('desktopNotes.createDescription')}</span>
      </div>
      <div class='actions-row'>
        <button class='btn-primary' type='button' onclick={handleCreateNote} disabled={isBusy}>
          {t('desktopNotes.create')}
        </button>
      </div>
    </div>
  </div>

  <div class='setting-group'>
    <h3 class='group-title'>{t('desktopNotes.listTitle')}</h3>

    {#if uniqueActiveNotes.length === 0}
      <div class='empty-state'>{t('desktopNotes.empty')}</div>
    {:else}
      <div class='note-list'>
        {#each uniqueActiveNotes as note (note.id)}
          <div class='note-card'>
            <div class='note-card-header'>
              <div class='note-color' style={colorPreviewStyle(note.color)}>
                {t(`desktopNotes.colors.${note.color}`)}
              </div>
              <div class='note-meta'>
                <div class='note-title'>{note.content ? note.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 30) : t('desktopNotes.emptyContent')}</div>
                <div class='note-subtitle'>
                  {noteSizeLabel(note.bounds)}
                </div>
              </div>
            </div>
            <div class='note-preview'>{note.content || t('desktopNotes.emptyContent')}</div>
            <div class='note-actions'>
              <button class='btn-secondary' type='button' onclick={() => handleOpenNote(note.id)}>
                {t('desktopNotes.open')}
              </button>
              <button class='btn-danger' type='button' onclick={() => handleDeleteNote(note.id)}>
                {t('desktopNotes.delete')}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if syncAvailable}
  <div class='setting-group'>
    <h3 class='group-title'>{t('desktopNotes.sync.title')}</h3>

    <div class='setting-item'>
      <div class='setting-label'>
        <span class='label-text'>{t('desktopNotes.sync.enabled')}</span>
        <span class='label-description'>{t('desktopNotes.sync.enabledDescription')}</span>
      </div>
      <label class='toggle-switch'>
        <input
          type='checkbox'
          checked={configStore.config.desktopNotesSyncEnabled}
          onchange={handleSyncToggle}
        />
        <span class='toggle-slider'></span>
      </label>
    </div>

    <div class='setting-item stacked'>
      <div class='setting-label'>
        <span class='label-text'>{t('desktopNotes.auth.account')}</span>
        <span class='label-description'>{t('desktopNotes.auth.accountDescription')}</span>
      </div>

      {#if session.authenticated}
        <div class='status-box'>
          <div>{formatTranslation('desktopNotes.auth.signedInAs', { email: session.email ?? '-' })}</div>
          {#if authStatus}
            <div class='muted'>{authStatus}</div>
          {/if}
        </div>

        <div class='actions-row'>
          <button class='btn-secondary' type='button' onclick={handleSignOut} disabled={isBusy}>
            {t('desktopNotes.auth.signOut')}
          </button>
          <button
            class='btn-secondary'
            type='button'
            onclick={handleSyncNow}
            disabled={isBusy || !configStore.config.desktopNotesSyncEnabled}
          >
            {desktopNotesStore.syncing ? t('desktopNotes.sync.syncing') : t('desktopNotes.sync.now')}
          </button>
        </div>
      {:else}
        <div class='auth-form'>
          <div class='auth-tabs'>
            <button
              class='auth-tab'
              class:active={authMode === 'signin'}
              type='button'
              onclick={() => {
                authMode = 'signin'
                authStatus = ''
              }}
            >
              {t('desktopNotes.auth.signIn')}
            </button>
            <button
              class='auth-tab'
              class:active={authMode === 'signup'}
              type='button'
              onclick={() => {
                authMode = 'signup'
                authStatus = ''
              }}
            >
              {t('desktopNotes.auth.signUp')}
            </button>
          </div>

          <input
            class='auth-input'
            type='email'
            placeholder={t('desktopNotes.auth.emailPlaceholder')}
            bind:value={authEmail}
            disabled={isBusy}
          />
          <input
            class='auth-input'
            type='password'
            placeholder={t('desktopNotes.auth.passwordPlaceholder')}
            bind:value={authPassword}
            disabled={isBusy}
          />

          {#if authStatus}
            <div class='auth-status'>{authStatus}</div>
          {/if}

          <div class='actions-row'>
            <button class='btn-primary' type='button' onclick={handleAuth} disabled={isBusy}>
              {authMode === 'signup' ? t('desktopNotes.auth.signUp') : t('desktopNotes.auth.signIn')}
            </button>
            {#if authMode === 'signin'}
              <button class='btn-secondary' type='button' onclick={handleResetPassword} disabled={isBusy}>
                {t('desktopNotes.auth.forgotPassword')}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <div class='meta-grid'>
        <div>
          <span class='meta-label'>{t('desktopNotes.sync.lastSyncedAt')}</span>
          <span class='meta-value'>{formatTimestamp(lastSyncedAt)}</span>
        </div>
      </div>
    </div>
  </div>
  {/if}
</div>

<style>
    .settings-section {
        width: 100%;
        max-width: none;
    }

    .setting-group {
        margin-bottom: 1.25rem;
    }

    .group-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.75rem 0;
        padding-bottom: 0.375rem;
        border-bottom: 1px solid var(--border-color);
    }

    .setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        background-color: var(--bg-secondary);
        border-radius: 0.375rem;
        margin-bottom: 0.625rem;
        gap: 1rem;
    }

    .setting-item.stacked {
        flex-direction: column;
        align-items: stretch;
    }

    .setting-label {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .label-text {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .label-description {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .toggle-switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 24px;
        cursor: pointer;
    }

    .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .toggle-slider {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--border-color);
        border-radius: 24px;
        transition: all 0.3s ease;
    }

    .toggle-slider::before {
        content: '';
        position: absolute;
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        border-radius: 50%;
        transition: all 0.3s ease;
    }

    .toggle-switch input:checked + .toggle-slider {
        background-color: var(--accent-color);
    }

    .toggle-switch input:checked + .toggle-slider::before {
        transform: translateX(24px);
    }

    .actions-row {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .btn-primary,
    .btn-secondary,
    .btn-danger {
        padding: 0.55rem 1rem;
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .btn-primary {
        border: none;
        background: var(--accent-color);
        color: white;
    }

    .btn-secondary {
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-primary);
    }

    .btn-danger {
        border: 1px solid color-mix(in srgb, var(--error-color) 55%, transparent);
        background: color-mix(in srgb, var(--error-color) 12%, var(--bg-primary));
        color: var(--error-color);
    }

    .btn-primary:disabled,
    .btn-secondary:disabled,
    .btn-danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .note-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
        gap: 0.75rem;
    }

    .note-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
        padding: 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .note-card-header {
        display: flex;
        gap: 0.75rem;
        align-items: center;
    }

    .note-color {
        min-width: 4.5rem;
        border-radius: 999px;
        border: 1px solid var(--border-color);
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-align: center;
    }

    .note-meta {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
    }

    .note-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .note-subtitle,
    .muted {
        font-size: 0.8rem;
        color: var(--text-secondary);
    }

    .note-preview {
        min-height: 4.5rem;
        font-size: 0.875rem;
        line-height: 1.5;
        color: var(--text-secondary);
        display: -webkit-box;
        line-clamp: 4;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .note-actions {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .empty-state,
    .status-box,
    .meta-grid {
        padding: 0.875rem;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
    }

    .status-box {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        word-break: break-word;
    }

    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
    }

    .auth-tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border-color);
    }

    .auth-tab {
        flex: 1;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        font-weight: 500;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .auth-tab.active {
        color: var(--accent-color);
        border-bottom-color: var(--accent-color);
    }

    .auth-input {
        width: 100%;
        padding: 0.55rem 0.75rem;
        font-size: 0.875rem;
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        background: var(--bg-primary);
        color: var(--text-primary);
        box-sizing: border-box;
    }

    .auth-input:focus {
        outline: none;
        border-color: var(--accent-color);
    }

    .auth-input:disabled {
        opacity: 0.5;
    }

    .auth-status {
        font-size: 0.8125rem;
        color: var(--text-secondary);
        word-break: break-word;
    }

    .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: 0.75rem;
    }

    .meta-label {
        display: block;
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-bottom: 0.25rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .meta-value {
        font-size: 0.875rem;
        color: var(--text-primary);
        word-break: break-word;
    }

    @media (max-width: 768px) {
        .setting-item {
            flex-direction: column;
            align-items: flex-start;
        }

        .note-list {
            grid-template-columns: 1fr;
        }
    }
</style>
