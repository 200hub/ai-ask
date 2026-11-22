/**
 * 桌面便签状态管理
 *
 * 说明：
 * - 主窗口负责调用窗口相关命令，恢复/隐藏所有便签窗口。
 * - 便签窗口本身也会复用该 store 读取同一份持久化数据，用于编辑单个便签。
 * - 便签窗口仅提交修改字段，由原生命令在同一存储事务内更新。
 * - 主窗口通过 Hai Framework 同步便签，其他窗口只读写本地存储。
 */
import type {
  DesktopNote,
  DesktopNoteBounds,
  DesktopNoteKind,
  DesktopNotePatch,
  DesktopNotesSyncResult,
} from '$lib/types/desktop-note'
import type { CloudSessionInfo } from '$lib/utils/cloud-auth'
import { configStore } from '$lib/stores/config.svelte'
import {
  signOut as cloudSignOut,
  getSessionInfo,
  isCloudSyncAvailable,
  normalizeCloudServerUrl,
  onAuthStateChange,
  signInWithEmail,
  signUpWithEmail,
} from '$lib/utils/cloud-auth'

import { DESKTOP_NOTES } from '$lib/utils/constants'
import {
  createDefaultDesktopNoteBounds,
  desktopNoteBoundsEqual,
  isDesktopNoteBoundsUsable,
  isDesktopNotePositionSane,
  normalizeDesktopNoteBounds,
} from '$lib/utils/desktop-note-bounds'
import { logger } from '$lib/utils/logger'
import {
  performFullSync,
  subscribeToChanges,
} from '$lib/utils/notes-sync'
import { deleteNoteBounds, deleteNoteTodoPreferences, getDesktopNotes, loadNoteBounds, saveDesktopNotePatches, saveNoteBounds, watchDesktopNotes } from '$lib/utils/storage'
import { core } from '@h-ai/core'
import { invoke } from '@tauri-apps/api/core'
import { SvelteMap } from 'svelte/reactivity'

function generateNoteId(): string {
  return core.id.uuid()
}

function createEmptyNote(index: number, kind: DesktopNoteKind): DesktopNote {
  const now = Date.now()
  return {
    id: generateNoteId(),
    title: '',
    content: '',
    ...(kind === 'todo' ? { kind } : {}),
    color: DESKTOP_NOTES.DEFAULT_COLOR,
    visible: true,
    bounds: createDefaultDesktopNoteBounds(index),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    sync: {
      dirty: true,
      lastSyncedAt: null,
    },
  }
}

/**
 * 判断 bounds 是否有效（非零面积、有限值）。
 *
 * 用于 openNoteWindow 打开前校验持久化 bounds，
 * 避免兼容区数据/竞态派生的零矩形导致便签被打开为不可见。
 */
function isValidBounds(bounds: DesktopNoteBounds | null | undefined): bounds is DesktopNoteBounds {
  return isDesktopNoteBoundsUsable(bounds)
}

/**
 * 获取指定便签打开时应该使用的有效 bounds（逻辑像素）。
 *
 * 优先级：
 * 1. per-note key 中最新保存的 bounds（便签窗口拖拽/改大小后的全权威来源）
 * 2. 内存中的 note.bounds（可能来自列表同步，但在主窗口中常常是陈旧值）
 * 3. 默认 bounds（仅当 1/2 都无效时，防止位置丢失使便签无法打开）
 */
async function resolveOpenBounds(noteId: string, inMemory: DesktopNoteBounds): Promise<DesktopNoteBounds> {
  const saved = await loadNoteBounds(noteId)
  if (isValidBounds(saved)) {
    return saved
  }
  if (isValidBounds(inMemory)) {
    return inMemory
  }
  logger.warn('No valid bounds found for note, falling back to default', { noteId })
  return createDefaultDesktopNoteBounds()
}

class DesktopNotesStore {
  notes = $state<DesktopNote[]>([])
  initialized = $state(false)
  syncing = $state(false)
  /** Hai Framework 认证会话信息 */
  session = $state<CloudSessionInfo>({ authenticated: false, email: null, userId: null })
  authPending = $state(false)
  authError = $state<string | null>(null)
  syncError = $state<string | null>(null)
  /** 最近一次自动同步的结果状态，用于便签底部提示 */
  lastAutoSyncStatus = $state<'idle' | 'syncing' | 'success' | 'error'>('idle')

  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null
  private autoSyncActive: Promise<void> | null = null
  private autoSyncRequested = false
  private cloudChangeActive: Promise<void> | null = null
  private pendingUpdates = new Map<string, DesktopNotePatch['updates']>()
  private writes = Promise.resolve()
  private syncQueue = Promise.resolve()
  private queuedSyncs = 0
  private signingOut = false
  private cloudSuspended = false
  private readRevision = 0
  private editRevision = 0
  private noteEditRevisions = new Map<string, number>()
  private unsubscribeLocal: (() => void) | null = null
  private localRefreshQueue = Promise.resolve()
  /** 云端变更取消订阅函数 */
  private unsubscribeChanges: (() => void) | null = null
  /** Auth 状态变化取消订阅函数 */
  private unsubscribeAuth: (() => void) | null = null

  private canSync() {
    return configStore.config.desktopNotesSyncEnabled && this.session.authenticated
      && !this.signingOut && !this.cloudSuspended
  }

  private clearAutoSyncTimer() {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /** 活跃（未软删除）便签 */
  get activeNotes(): DesktopNote[] {
    return this.notes.filter(note => note.deletedAt === null)
  }

  /** 可见便签 */
  get visibleNotes(): DesktopNote[] {
    return this.activeNotes.filter(note => note.visible)
  }

  // ==================== 初始化 ====================

  private getSyncOwnerId(): string {
    if (!this.session.authenticated || !this.session.userId) {
      throw new Error('Not authenticated')
    }
    return `${normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)}#${this.session.userId}`
  }

  private async claimUnownedNotes(ownerId: string) {
    await this.flushPersist()
    const notes = await getDesktopNotes()
    const claims = notes.filter(note => !note.sync.ownerId).map(note => ({
      noteId: note.id,
      updates: { sync: { ownerId, dirty: true, lastSyncedAt: null } },
      ...(note.deletedAt !== null ? { ifUnchanged: { updatedAt: note.updatedAt } } : {}),
    }))
    if (claims.length) {
      await saveDesktopNotePatches(claims)
    }
  }

  /** 主窗口汇总所有便签窗口的本地提交，统一执行云同步。 */
  async startLocalChangeListener() {
    this.unsubscribeLocal?.()
    this.unsubscribeLocal = await watchDesktopNotes(() => {
      this.localRefreshQueue = this.localRefreshQueue.then(async () => {
        await this.init(true)
        if (!this.cloudSuspended && configStore.config.desktopNotesSyncEnabled && this.session.authenticated) {
          const ownerId = this.getSyncOwnerId()
          if (this.notes.some(note => note.sync.dirty && (!note.sync.ownerId || note.sync.ownerId === ownerId))) {
            this.queueAutoSync()
          }
        }
      }).catch(error => logger.warn('Failed to refresh locally changed desktop notes', error))
    }, { includeBounds: false })
  }

  async init(force = false) {
    if (this.initialized && !force) {
      return
    }

    const revision = ++this.readRevision
    const editRevision = this.editRevision
    await this.flushPersist()
    const notes = await getDesktopNotes()

    // 合并 per-note bounds：每个便签窗口独立写自己的 bounds key，
    // 启动时读回并覆盖 notes 数组中可能过期的 bounds，避免竞态导致位置丢失。
    const mergedNotes = await Promise.all(
      notes.map(async (note) => {
        const savedBounds = await loadNoteBounds(note.id)
        return savedBounds ? { ...note, bounds: savedBounds } : note
      }),
    )

    if (revision === this.readRevision) {
      const current = new SvelteMap(this.notes.map(note => [note.id, note]))
      this.notes = mergedNotes.map((stored) => {
        const local = current.get(stored.id)
        current.delete(stored.id)
        // 读操作可能晚于新编辑落盘完成，写队列排空后仍需保护本次读取期间的新版本。
        const editedDuringRead = (this.noteEditRevisions.get(stored.id) ?? 0) > editRevision
        const note = local && editedDuringRead && stored.deletedAt === null && local.updatedAt > stored.updatedAt ? local : stored
        const pending = this.pendingUpdates.get(note.id)
        return pending ? { ...note, ...pending, sync: { ...note.sync, ...pending.sync } } : note
      })
      this.notes.push(...current.values())
      this.initialized = true
    }
  }

  /**
   * 刷新 Hai Framework 认证会话
   */
  async refreshSession() {
    const refreshing = this.syncQueue.then(async () => {
      if (!isCloudSyncAvailable()) {
        this.session = { authenticated: false, email: null, userId: null }
        return
      }
      try {
        this.session = await getSessionInfo()
        if (this.canSync())
          this.startChanges()
        else
          this.stopChanges()
      }
      catch (error) {
        logger.warn('Failed to refresh Hai Framework session', error)
        this.startChanges(true)
      }
    })
    this.syncQueue = refreshing.then(() => {}, () => {})
    await refreshing
  }

  /**
   * 启动 Hai Framework Auth 状态监听
   *
   * 登录、注册、Token 刷新等事件均由此回调统一处理，
   * 包括调度同步和清理云端变更订阅。
   * 登录成功后共用同一防抖同步入口。
   */
  startAuthListener() {
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = onAuthStateChange((_event, session) => {
      this.session = {
        authenticated: !!session?.user,
        email: session?.user?.email ?? null,
        userId: session?.user?.id ?? null,
      }

      if (this.canSync()) {
        this.startChanges()
        this.queueAutoSync()
      }

      // 退出登录后清理云端变更订阅
      if (!session?.user) {
        this.stopChanges()
      }
    })
  }

  // ==================== 持久化 ====================

  private queuePersist(noteId: string, updates: DesktopNotePatch['updates']) {
    this.noteEditRevisions.set(noteId, ++this.editRevision)
    const queued = this.pendingUpdates.get(noteId)
    this.pendingUpdates.set(noteId, {
      ...queued,
      ...updates,
      sync: { ...queued?.sync, ...updates.sync },
    })
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      void this.flushPersist().catch(error => logger.error('Failed to persist desktop note updates', error))
    }, DESKTOP_NOTES.SAVE_DEBOUNCE_MS)
  }

  private flushPersist() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    const write = this.writes.then(async () => {
      // 原生写入期间仍可接收新编辑；退出回执必须等全部已接收修改落盘。
      while (this.pendingUpdates.size) {
        const pending = this.pendingUpdates
        this.pendingUpdates = new Map()
        const patches = Array.from(pending, ([noteId, updates]) => ({ noteId, updates }))
        try {
          await saveDesktopNotePatches(patches)
        }
        catch (error) {
          for (const [noteId, updates] of pending) {
            const latest = this.pendingUpdates.get(noteId)
            this.pendingUpdates.set(noteId, {
              ...updates,
              ...latest,
              sync: { ...updates.sync, ...latest?.sync },
            })
          }
          throw error
        }
      }
    })
    this.writes = write.catch(() => {})
    return write
  }

  /**
   * 刷新待持久化队列（公开方法，供便签窗口在 app exit 时调用）
   */
  async flushPersistPublic() {
    await this.flushPersist()
  }

  // ==================== CRUD ====================

  getNoteById(noteId: string): DesktopNote | null {
    return this.notes.find(note => note.id === noteId) ?? null
  }

  async createNote(kind: DesktopNoteKind = 'markdown'): Promise<DesktopNote> {
    await this.init(true)
    const note = createEmptyNote(this.activeNotes.length, kind)
    if (this.session.authenticated) {
      note.sync.ownerId = this.getSyncOwnerId()
    }
    await saveDesktopNotePatches([{ noteId: note.id, updates: note }])
    this.noteEditRevisions.set(note.id, ++this.editRevision)
    this.notes = [note, ...this.notes]
    return note
  }

  async updateNote(noteId: string, updates: Partial<DesktopNote>, markDirty = true) {
    const note = this.getNoteById(noteId)
    if (!note || note.deletedAt !== null) {
      return
    }
    const updatedAt = updates.updatedAt ?? Math.max(Date.now(), note.updatedAt + 1)
    const sync = {
      ...updates.sync,
      ...(!note.sync.ownerId && this.session.authenticated ? { ownerId: this.getSyncOwnerId() } : {}),
      dirty: markDirty ? true : (updates.sync?.dirty ?? note.sync.dirty),
    }
    this.notes = this.notes.map(n => n.id === noteId
      ? { ...n, ...updates, updatedAt, sync: { ...n.sync, ...sync } }
      : n,
    )
    this.queuePersist(noteId, { ...updates, updatedAt, sync })
  }

  async updateNoteContent(noteId: string, content: string) {
    await this.updateNote(noteId, { content })
  }

  // 颜色更新：不触发 Rust 窗口命令，但标记 dirty 以同步到 Hai Framework
  async updateNoteColor(noteId: string, color: DesktopNote['color']) {
    await this.updateNote(noteId, { color })
  }

  async updateNoteBounds(noteId: string, bounds: DesktopNoteBounds) {
    const note = this.getNoteById(noteId)
    if (!note) {
      return
    }
    const fallbackBounds = isValidBounds(note.bounds) ? note.bounds : createDefaultDesktopNoteBounds()
    if (!isDesktopNotePositionSane(bounds.x, bounds.y, bounds.monitor)) {
      logger.warn('Rejecting sticky note bounds update with absurd coordinates', { noteId, attemptedBounds: bounds, fallbackBounds })
      return
    }
    const normalizedBounds = normalizeDesktopNoteBounds(bounds, fallbackBounds)
    if (desktopNoteBoundsEqual(normalizedBounds, note.bounds)) {
      return
    }
    // 先落盘再更新内存，确保退出取消后仍能用相同位置重试失败的保存。
    await saveNoteBounds(noteId, normalizedBounds)
    this.notes = this.notes.map(current => current.id === noteId ? { ...current, bounds: normalizedBounds } : current)
  }

  // ==================== 窗口管理 ====================

  async openNoteWindow(noteId: string, activate = false) {
    if (this.cloudSuspended)
      return
    const note = this.getNoteById(noteId)
    if (!note || note.deletedAt !== null) {
      logger.warn('Cannot open note window: note not found', { noteId })
      return
    }
    const effectiveBounds = await resolveOpenBounds(noteId, note.bounds)
    const current = this.getNoteById(noteId)
    if (this.cloudSuspended || !current || current.deletedAt !== null || (note.visible && !current.visible))
      return
    const wasHidden = !current.visible
    if (wasHidden) {
      await this.updateNote(noteId, { visible: true })
      await this.flushPersist()
    }
    const latest = this.getNoteById(noteId)
    if (this.cloudSuspended || !latest?.visible || latest.deletedAt !== null)
      return
    logger.debug('Opening note window', { noteId, bounds: effectiveBounds })
    try {
      await invoke('ensure_desktop_note_window', {
        payload: {
          noteId,
          bounds: effectiveBounds,
          ...(activate ? { activate } : {}),
        },
      })
    }
    catch (error) {
      if (wasHidden) {
        await this.updateNote(noteId, { visible: false })
        await this.flushPersist()
      }
      throw error
    }
    this.notes = this.notes.map(n => (n.id === noteId ? { ...n, bounds: effectiveBounds } : n))
    if (wasHidden)
      this.queueAutoSync()
  }

  /**
   * 关闭指定便签窗口。
   *
   * Rust 端执行 window.close() 会触发目标便签窗口的 onCloseRequested 流程，
   * 由便签窗口自身负责持久化 visible=false（经 `markNoteHiddenLocally`），
   * 因此这里无需再重复标记。
   *
   * 若目标窗口已不存在（例如用户已手动关闭），为保证本地视图一致性，
   * 我们仍对本 store 做一次 visible=false 标记。
   */
  async closeNoteWindow(noteId: string) {
    try {
      await invoke('close_desktop_note_window', {
        payload: { noteId },
      })
    }
    catch (error) {
      logger.warn('Failed to close desktop note window', { noteId, error })
      throw error
    }

    // 便签窗口独立 webview，其 onCloseRequested 会自行更新 visible=false。
    // 但当前 store（主窗口/设置页）的内存副本需要同步更新，否则 UI 列表仍然显示“打开”。
    await this.markNoteHiddenLocally(noteId)
  }

  /**
   * 将便签本地状态标记为不可见并触发云同步。
   *
   * 仅写入本地 store + 持久化 + 云同步 dirty，不调用 Rust 侧窗口命令。
   * 供便签窗口 onCloseRequested 以及主窗口 closeNoteWindow 共用。
   */
  async markNoteHiddenLocally(noteId: string) {
    const note = this.getNoteById(noteId)
    if (!note || !note.visible) {
      return
    }

    await this.updateNote(noteId, { visible: false }, true)

    if (configStore.config.desktopNotesSyncEnabled && this.session.authenticated) {
      this.queueAutoSync()
    }
  }

  /**
   * 恢复所有可见便签窗口 —— 逐个创建，单个失败不阻塞其余
   */
  async restoreVisibleWindows(options?: { recoverHidden?: boolean }) {
    const recoverHidden = options?.recoverHidden ?? false
    const toRestore = recoverHidden ? this.activeNotes : this.visibleNotes
    logger.info('Restoring desktop note windows', {
      recoverHidden,
      total: this.notes.length,
      active: this.activeNotes.length,
      toRestore: toRestore.length,
      noteIds: toRestore.map(n => n.id),
    })
    for (const note of toRestore) {
      if (configStore.config.desktopNotesEnabled === false) {
        return
      }
      try {
        await this.openNoteWindow(note.id)
      }
      catch (error) {
        logger.error('Failed to restore desktop note window', { noteId: note.id, error })
      }
    }
  }

  async hideAllWindows() {
    await invoke('suspend_desktop_note_windows')
  }

  // ==================== 删除 ====================

  async deleteNote(noteId: string) {
    const note = this.getNoteById(noteId)
    if (!note) {
      return
    }

    await this.closeNoteWindow(noteId)

    await this.updateNote(noteId, { visible: false, deletedAt: Date.now() })
    await this.flushPersist()

    // 清理 per-note bounds key（避免孤立 key 占用存储）
    void deleteNoteBounds(noteId)
    if (note.kind === 'todo') {
      void deleteNoteTodoPreferences(noteId).catch(error => logger.warn('Failed to delete note task preferences', { noteId, error }))
    }

    // 如果同步启用且已认证，触发自动同步以推送删除
    if (configStore.config.desktopNotesSyncEnabled && this.session.authenticated) {
      this.queueAutoSync()
    }
  }

  // ==================== 认证 ====================

  /**
   * 邮箱注册
   *
   * 同步由 startAuthListener 回调统一触发，无需在此重复调用
   */
  async signUp(email: string, password: string): Promise<CloudSessionInfo> {
    return this.authenticate(() => signUpWithEmail(email, password))
  }

  async signIn(email: string, password: string): Promise<CloudSessionInfo> {
    return this.authenticate(() => signInWithEmail(email, password))
  }

  private async authenticate(action: () => Promise<CloudSessionInfo>): Promise<CloudSessionInfo> {
    this.authPending = true
    this.authError = null
    // 认证与同步共用队列，避免旧请求读写便签期间凭据被替换。
    const authentication = this.syncQueue.then(async () => {
      if (this.session.authenticated) {
        await this.claimUnownedNotes(this.getSyncOwnerId())
      }
      const result = await action()
      this.session = result
      if (result.authenticated)
        await this.claimUnownedNotes(this.getSyncOwnerId())
      return result
    })
    this.syncQueue = authentication.then(() => {}, () => {})
    try {
      return await authentication
    }
    catch (error) {
      this.authError = error instanceof Error ? error.message : String(error)
      throw error
    }
    finally {
      this.authPending = false
    }
  }

  /**
   * 退出登录
   */
  async signOut() {
    this.signingOut = true
    this.clearAutoSyncTimer()
    const signingOut = this.syncQueue.then(async () => {
      // 本地归属保存失败时保留当前账号，允许用户重试。
      if (this.session.authenticated) {
        await this.claimUnownedNotes(this.getSyncOwnerId())
      }
      await cloudSignOut()
      this.session = { authenticated: false, email: null, userId: null }
      this.stopChanges()
      await configStore.setDesktopNotesLastSyncedAt(null)
    })
    this.syncQueue = signingOut.then(() => {}, () => {})
    try {
      await signingOut
    }
    finally {
      this.signingOut = false
    }
  }

  /** 将旧实例请求排空后再保存地址，保证请求始终使用同一个后端。 */
  async changeSyncServer(serverUrl: string) {
    const normalized = serverUrl.trim() ? normalizeCloudServerUrl(serverUrl) : ''
    const changing = this.syncQueue.then(async () => {
      if (this.session.authenticated) {
        await this.claimUnownedNotes(this.getSyncOwnerId())
      }
      if (isCloudSyncAvailable())
        await cloudSignOut({ allowOffline: true })
      this.stopChanges()
      this.session = { authenticated: false, email: null, userId: null }
      this.clearAutoSyncTimer()
      await configStore.update({ desktopNotesServerUrl: normalized, desktopNotesLastSyncedAt: null, desktopNotesSyncEnabled: false })
    })
    this.syncQueue = changing.then(() => {}, () => {})
    await changing
  }

  // ==================== 同步 ====================

  async setSyncEnabled(enabled: boolean) {
    await configStore.setDesktopNotesSyncEnabled(enabled)
    if (enabled) {
      if (!this.session.authenticated)
        await this.refreshSession()
      if (this.canSync()) {
        this.startChanges()
        this.queueAutoSync()
      }
    }
    else {
      this.clearAutoSyncTimer()
      this.autoSyncRequested = false
      this.stopChanges()
      await this.syncQueue
    }
  }

  /**
   * 执行完整同步（push + pull + merge）
   *
   * 同步流程：
   * 1. 刷新待持久化队列→从存储重读最新数据（避免内存快照过期）
   * 2. 拉取并合并云端数据，再推送当前账号的本地修改
   * 3. 更新本地存储并记录同步时间戳
   * 4. 启动云端变更订阅（如果尚未启动）
   *
   */
  async syncWithCloud(): Promise<DesktopNotesSyncResult> {
    if (this.signingOut || this.cloudSuspended) {
      throw new Error('Cloud session is signing out')
    }
    if (!configStore.config.desktopNotesSyncEnabled)
      throw new Error('Cloud synchronization is disabled')
    this.queuedSyncs++
    this.syncing = true
    const sync = this.syncQueue.then(() => this.performSync())
    this.syncQueue = sync.then(() => {}, () => {})
    try {
      return await sync
    }
    finally {
      this.queuedSyncs--
      this.syncing = this.queuedSyncs > 0
    }
  }

  private async performSync(): Promise<DesktopNotesSyncResult> {
    this.syncError = null

    try {
      if (this.cloudSuspended || this.signingOut) {
        throw new Error('Cloud synchronization is suspended')
      }
      if (!configStore.config.desktopNotesSyncEnabled)
        throw new Error('Cloud synchronization is disabled')
      const ownerId = this.getSyncOwnerId()
      this.startChanges()
      // 同步前先刷新持久化，确保本地最新修改已写入
      await this.flushPersist()
      // 重新从存储读取最新数据，避免使用本窗口的过期内存快照
      // 联网前持久化便签归属，确保同步失败或退出后也不会把 A 的便签发送给 B。
      await this.claimUnownedNotes(ownerId)
      const snapshot = (await getDesktopNotes()).filter(note => note.sync.ownerId === ownerId)

      logger.info('Sync starting', {
        localCount: snapshot.length,
        lastSyncedAt: configStore.config.desktopNotesLastSyncedAt,
      })

      const { notes, result } = await performFullSync(
        snapshot,
        this.session.userId!,
      )

      if (this.getSyncOwnerId() !== ownerId) {
        throw new Error('Cloud session changed during synchronization')
      }
      await this.applySyncedNotes(snapshot, notes.map(note => ({ ...note, sync: { ...note.sync, ownerId } })))

      logger.info('Sync completed', {
        mergedCount: notes.length,
        pushed: result.pushed,
        pulled: result.pulled,
      })

      // 更新最后同步时间
      await configStore.setDesktopNotesLastSyncedAt(result.syncedAt)

      // 启动云端变更订阅（如果尚未启动）
      this.startChanges()

      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.syncError = message
      throw error
    }
  }

  /**
   * 编辑后自动同步（防抖）
   */
  queueAutoSync() {
    this.clearAutoSyncTimer()
    if (!this.canSync())
      return
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null
      if (this.canSync())
        void this.performAutoSync()
    }, DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
  }

  private performAutoSync(): Promise<void> {
    if (!this.canSync())
      return Promise.resolve()
    this.autoSyncRequested = true
    if (this.autoSyncActive)
      return this.autoSyncActive
    const active = (async () => {
      while (this.autoSyncRequested && this.canSync()) {
        this.autoSyncRequested = false
        await this.performAutoSyncAttempt()
      }
    })()
    this.autoSyncActive = active
    void active.finally(() => {
      if (this.autoSyncActive === active)
        this.autoSyncActive = null
    })
    return active
  }

  private async performAutoSyncAttempt() {
    this.lastAutoSyncStatus = 'syncing'

    try {
      await this.syncWithCloud()
      this.lastAutoSyncStatus = 'success'
      // 3 秒后清除成功提示
      setTimeout(() => {
        if (this.lastAutoSyncStatus === 'success') {
          this.lastAutoSyncStatus = 'idle'
        }
      }, DESKTOP_NOTES.SYNC_SUCCESS_STATUS_MS)
    }
    catch (error) {
      logger.warn('Auto-sync failed', error)
      this.lastAutoSyncStatus = 'error'
      // 5 秒后清除错误提示
      setTimeout(() => {
        if (this.lastAutoSyncStatus === 'error') {
          this.lastAutoSyncStatus = 'idle'
        }
      }, DESKTOP_NOTES.SYNC_ERROR_STATUS_MS)
    }
  }

  // ==================== 云端变更 ====================

  suspendCloudActivity() {
    this.cloudSuspended = true
    this.autoSyncRequested = false
    this.stopChanges()
    this.clearAutoSyncTimer()
  }

  resumeCloudActivity() {
    this.cloudSuspended = false
    if (configStore.config.desktopNotesSyncEnabled && this.session.authenticated) {
      this.startChanges()
      this.queueAutoSync()
    }
  }

  private startChanges(retrySession = false) {
    const canRetrySession = retrySession && configStore.config.desktopNotesSyncEnabled
      && !this.cloudSuspended && !this.signingOut && isCloudSyncAvailable()
    if (this.unsubscribeChanges || (!this.canSync() && !canRetrySession)) {
      return
    }
    this.unsubscribeChanges = subscribeToChanges(() => {
      void this.observeCloudChange()
    })
  }

  private observeCloudChange(): Promise<void> {
    if (this.cloudChangeActive)
      return this.cloudChangeActive
    const observing = (async () => {
      if (!configStore.config.desktopNotesSyncEnabled || this.cloudSuspended || this.signingOut)
        return
      if (!this.session.authenticated)
        await this.refreshSession()
      if (this.canSync())
        await this.performAutoSync()
    })().catch(error => logger.warn('Failed to refresh cloud changes', error))
    this.cloudChangeActive = observing
    void observing.finally(() => {
      if (this.cloudChangeActive === observing)
        this.cloudChangeActive = null
    })
    return observing
  }

  private stopChanges() {
    this.unsubscribeChanges?.()
    this.unsubscribeChanges = null
  }

  /**
   * 远端隐藏或删除后请求关闭本地窗口，由目标窗口先保存正文和草稿。
   */
  private async closeSyncedNoteWindow(noteId: string) {
    try {
      await invoke('close_desktop_note_window', {
        payload: { noteId },
      })
    }
    catch (error) {
      logger.warn('Failed to close desktop note window (cloud changes)', { noteId, error })
    }
  }

  private async applySyncedNotes(snapshot: DesktopNote[], merged: DesktopNote[]) {
    // 先落盘网络请求期间的新编辑，再应用条件补丁，避免旧响应仍匹配旧磁盘版本。
    await this.flushPersist()
    const previous = new Map(snapshot.map(note => [note.id, note]))
    const patches = merged.filter(note => note !== previous.get(note.id)).map(note => ({
      noteId: note.id,
      updates: note,
      ifUnchanged: { updatedAt: previous.get(note.id)?.updatedAt ?? null },
    }))
    if (patches.length) {
      await saveDesktopNotePatches(patches)
    }
    await this.init(true)
    if (this.cloudSuspended) {
      return
    }
    for (const note of snapshot) {
      const updated = this.getNoteById(note.id)
      if (note.visible && updated && (!updated.visible || updated.deletedAt !== null)) {
        await this.closeSyncedNoteWindow(note.id)
      }
    }
    if (configStore.config.desktopNotesEnabled) {
      for (const incoming of merged) {
        const before = previous.get(incoming.id)
        const current = this.getNoteById(incoming.id)
        if (
          incoming.visible && incoming.deletedAt === null
          && current?.visible && current.deletedAt === null
          && current.sync.ownerId === incoming.sync.ownerId
          && (!before || !before.visible)
          && !this.cloudSuspended
        ) {
          await this.openNoteWindow(current.id)
        }
      }
    }
  }
}

export const desktopNotesStore = new DesktopNotesStore()
