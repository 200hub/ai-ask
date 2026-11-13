/**
 * 桌面便签状态管理
 *
 * 说明：
 * - 主窗口负责调用窗口相关命令，恢复/隐藏所有便签窗口。
 * - 便签窗口本身也会复用该 store 读取同一份持久化数据，用于编辑单个便签。
 * - 便签窗口仅提交修改字段，由原生命令在同一存储事务内更新。
 * - 同步采用 Supabase（PostgreSQL + Realtime），认证使用邮箱+密码。
 */
import type {
  DesktopNote,
  DesktopNoteBounds,
  DesktopNoteKind,
  DesktopNotePatch,
  DesktopNoteRow,
  DesktopNotesSyncResult,
} from '$lib/types/desktop-note'
import type { SupabaseSessionInfo } from '$lib/utils/supabase'

import { configStore } from '$lib/stores/config.svelte'
import { DESKTOP_NOTES } from '$lib/utils/constants'
import {
  createDefaultDesktopNoteBounds,
  isDesktopNoteBoundsUsable,
  isDesktopNotePositionSane,
  normalizeDesktopNoteBounds,
} from '$lib/utils/desktop-note-bounds'
import { logger } from '$lib/utils/logger'
import {
  mergeRemoteIntoLocal,
  performFullSync,
  subscribeToRealtime,
  verifySchema,
} from '$lib/utils/notes-sync'
import { deleteNoteBounds, deleteNoteTodoPreferences, getDesktopNotes, loadNoteBounds, saveDesktopNotePatches, saveNoteBounds } from '$lib/utils/storage'
import {
  getSessionInfo,
  isSupabaseAvailable,
  onAuthStateChange,
  signInWithEmail,
  signUpWithEmail,
  signOut as supabaseSignOut,
} from '$lib/utils/supabase'
import { invoke } from '@tauri-apps/api/core'

function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `note-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
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
  /** Supabase 认证会话信息 */
  session = $state<SupabaseSessionInfo>({ authenticated: false, email: null, userId: null })
  authPending = $state(false)
  authError = $state<string | null>(null)
  syncError = $state<string | null>(null)
  /** 最近一次自动同步的结果状态，用于便签底部提示 */
  lastAutoSyncStatus = $state<'idle' | 'syncing' | 'success' | 'error'>('idle')

  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null
  private pendingUpdates = new Map<string, DesktopNotePatch['updates']>()
  private writes = Promise.resolve()
  private readRevision = 0
  /** Realtime 取消订阅函数 */
  private unsubscribeRealtime: (() => void) | null = null
  /** Auth 状态变化取消订阅函数 */
  private unsubscribeAuth: (() => void) | null = null

  /** 活跃（未软删除）便签 */
  get activeNotes(): DesktopNote[] {
    return this.notes.filter(note => !note.deletedAt)
  }

  /** 可见便签 */
  get visibleNotes(): DesktopNote[] {
    return this.activeNotes.filter(note => note.visible)
  }

  // ==================== 初始化 ====================

  async init(force = false) {
    if (this.initialized && !force) {
      return
    }

    const revision = ++this.readRevision
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
      this.notes = mergedNotes.map((note) => {
        const pending = this.pendingUpdates.get(note.id)
        return pending ? { ...note, ...pending, sync: { ...note.sync, ...pending.sync } } : note
      })
      this.initialized = true
    }
  }

  /**
   * 刷新 Supabase 认证会话
   */
  async refreshSession() {
    if (!isSupabaseAvailable()) {
      this.session = { authenticated: false, email: null, userId: null }
      return
    }

    try {
      this.session = await getSessionInfo()
    }
    catch (error) {
      logger.warn('Failed to refresh Supabase session', error)
      this.session = { authenticated: false, email: null, userId: null }
    }
  }

  /**
   * 启动 Supabase Auth 状态监听
   *
   * 登录、注册、Token 刷新等事件均由此回调统一处理，
   * 包括触发 Schema 验证和同步、清理 Realtime 订阅等。
   * signIn/signUp 方法不再重复调用 verifyAndSync，避免双重同步。
   */
  startAuthListener() {
    if (!isSupabaseAvailable()) {
      return
    }

    this.unsubscribeAuth?.()
    this.unsubscribeAuth = onAuthStateChange((_event, session) => {
      this.session = {
        authenticated: !!session?.user,
        email: session?.user?.email ?? null,
        userId: session?.user?.id ?? null,
      }

      // 登录成功后验证 Schema 并自动同步
      if (session?.user && configStore.config.desktopNotesSyncEnabled) {
        void this.verifyAndSync()
      }

      // 退出登录后清理 Realtime 订阅
      if (!session?.user) {
        this.stopRealtime()
      }
    })
  }

  // ==================== 持久化 ====================

  private queuePersist(noteId: string, updates: DesktopNotePatch['updates']) {
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
      const pending = this.pendingUpdates
      if (!pending.size) {
        return
      }
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
    await saveDesktopNotePatches([{ noteId: note.id, updates: note }])
    this.notes = [note, ...this.notes]
    return note
  }

  async updateNote(noteId: string, updates: Partial<DesktopNote>, markDirty = true) {
    const note = this.getNoteById(noteId)
    if (!note || note.deletedAt) {
      return
    }
    const updatedAt = updates.updatedAt ?? Math.max(Date.now(), note.updatedAt + 1)
    const sync = { ...updates.sync, dirty: markDirty ? true : (updates.sync?.dirty ?? note.sync.dirty) }
    this.notes = this.notes.map(n => n.id === noteId
      ? { ...n, ...updates, updatedAt, sync: { ...n.sync, ...sync } }
      : n,
    )
    this.queuePersist(noteId, { ...updates, updatedAt, sync })
  }

  async updateNoteContent(noteId: string, content: string) {
    await this.updateNote(noteId, { content })
  }

  // 颜色更新：不触发 Rust 窗口命令，但标记 dirty 以同步到 Supabase
  async updateNoteColor(noteId: string, color: DesktopNote['color']) {
    await this.updateNote(noteId, { color })
  }

  async updateNoteBounds(noteId: string, bounds: DesktopNoteBounds) {
    // 位置为设备本地状态：仅本地持久化，不参与云端 dirty/updatedAt 同步。
    // 使用 per-note key 直接写入，避免多窗口并发 read-modify-write 竞态。
    let changed = false

    this.notes = this.notes.map((note, index) => {
      if (note.id !== noteId) {
        return note
      }

      const fallbackBounds = isValidBounds(note.bounds) ? note.bounds : createDefaultDesktopNoteBounds(index)

      if (!isDesktopNotePositionSane(bounds.x, bounds.y, bounds.monitor)) {
        logger.warn('Rejecting sticky note bounds update with absurd coordinates', {
          noteId,
          attemptedBounds: bounds,
          fallbackBounds,
        })
        return note
      }

      const normalizedBounds = normalizeDesktopNoteBounds(bounds, fallbackBounds)

      if (
        normalizedBounds.x === note.bounds.x
        && normalizedBounds.y === note.bounds.y
        && normalizedBounds.width === note.bounds.width
        && normalizedBounds.height === note.bounds.height
        && normalizedBounds.monitor === note.bounds.monitor
      ) {
        return note
      }

      if (
        normalizedBounds.x !== bounds.x
        || normalizedBounds.y !== bounds.y
        || normalizedBounds.width !== bounds.width
        || normalizedBounds.height !== bounds.height
      ) {
        logger.warn('Rejecting invalid sticky note bounds update, falling back to last good bounds', {
          noteId,
          attemptedBounds: bounds,
          normalizedBounds,
        })
      }

      changed = true
      return {
        ...note,
        bounds: normalizedBounds,
      }
    })

    if (changed) {
      const updated = this.getNoteById(noteId)
      if (!updated) {
        return
      }
      // 直接写 per-note bounds key，Rust 侧串行化，无竞态
      await saveNoteBounds(noteId, updated.bounds)
    }
  }

  // ==================== 窗口管理 ====================

  async openNoteWindow(noteId: string, activate = false) {
    const note = this.getNoteById(noteId)
    if (!note || note.deletedAt) {
      logger.warn('Cannot open note window: note not found', { noteId })
      return
    }

    // 关键：从 per-note key 读取最新保存的 bounds（便签窗口写入的权威来源）。
    // 主窗口内存中的 note.bounds 不会因便签窗口的位置变化而更新，
    // 必须从持久化 key 读取最新值，否则多次关闭/打开后会恢复到旧位置。
    const effectiveBounds = await resolveOpenBounds(noteId, note.bounds)

    logger.debug('Opening note window', {
      noteId,
      bounds: effectiveBounds,
    })
    if (!note.visible) {
      await this.updateNote(noteId, { visible: true })
      await this.flushPersist()
    }

    try {
      await invoke('ensure_desktop_note_window', {
        payload: {
          noteId: note.id,
          bounds: effectiveBounds,
          ...(activate ? { activate } : {}),
        },
      })
    }
    catch (error) {
      if (!note.visible) {
        await this.updateNote(noteId, { visible: false })
        await this.flushPersist()
      }
      throw error
    }

    this.notes = this.notes.map(n => (n.id === noteId ? { ...n, bounds: effectiveBounds } : n))
    if (!note.visible && configStore.config.desktopNotesSyncEnabled && this.session.authenticated) {
      this.queueAutoSync()
    }
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
  async signUp(email: string, password: string): Promise<SupabaseSessionInfo> {
    this.authPending = true
    this.authError = null

    try {
      const result = await signUpWithEmail(email, password)
      this.session = result
      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.authError = message
      throw error
    }
    finally {
      this.authPending = false
    }
  }

  /**
   * 邮箱登录
   *
   * 同步由 startAuthListener 回调统一触发，无需在此重复调用
   */
  async signIn(email: string, password: string): Promise<SupabaseSessionInfo> {
    this.authPending = true
    this.authError = null

    try {
      const result = await signInWithEmail(email, password)
      this.session = result
      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.authError = message
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
    try {
      await supabaseSignOut()
    }
    catch (error) {
      logger.error('Failed to sign out from Supabase', error)
    }

    this.session = { authenticated: false, email: null, userId: null }
    this.stopRealtime()

    // 重置同步时间戳，确保下次登录时全量拉取远端数据
    await configStore.setDesktopNotesLastSyncedAt(null)
  }

  // ==================== 同步 ====================

  /**
   * 验证数据库 Schema 并执行同步
   *
   * 登录成功后自动调用：先检测 desktop_notes 表是否存在，
   * 通过后才执行完整同步，避免因 Schema 缺失导致同步报错。
   */
  private async verifyAndSync() {
    const schemaOk = await verifySchema()
    if (!schemaOk) {
      this.syncError = 'Cloud sync service initialization failed. Please try again later.'
      logger.error('Schema verification failed, skipping sync')
      return
    }

    await this.syncWithSupabase()
  }

  /**
   * 执行完整同步（push + pull + merge）
   *
   * 同步流程：
   * 1. 刷新待持久化队列→从存储重读最新数据（避免内存快照过期）
   * 2. push 本地 dirty 便签→ pull 远端变更→ LWW 合并
   * 3. 更新本地存储并记录同步时间戳
   * 4. 启动 Realtime 订阅（如果尚未启动）
   *
   * @param options - 同步选项
   * @param options.preferRemote - 强制以远端数据为准（启动时使用，关闭前已同步到 Supabase）
   * @param options.fullPull     - 强制全量拉取（忽略 lastSyncedAt 增量过滤）
   */
  async syncWithSupabase(options?: { preferRemote?: boolean, fullPull?: boolean }): Promise<DesktopNotesSyncResult> {
    this.syncing = true
    this.syncError = null

    try {
      // 同步前先刷新持久化，确保本地最新修改已写入
      await this.flushPersist()
      // 重新从存储读取最新数据，避免使用本窗口的过期内存快照
      const snapshot = await getDesktopNotes()

      logger.info('Sync starting', {
        localCount: snapshot.length,
        lastSyncedAt: configStore.config.desktopNotesLastSyncedAt,
        options,
      })

      const { notes, result } = await performFullSync(
        snapshot,
        configStore.config.desktopNotesLastSyncedAt,
        options,
      )

      await this.applySyncedNotes(snapshot, notes)

      logger.info('Sync completed', {
        mergedCount: notes.length,
        pushed: result.pushed,
        pulled: result.pulled,
      })

      // 更新最后同步时间
      await configStore.setDesktopNotesLastSyncedAt(result.syncedAt)

      // 启动 Realtime 订阅（如果尚未启动）
      this.startRealtime()

      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.syncError = message
      throw error
    }
    finally {
      this.syncing = false
    }
  }

  /**
   * 编辑后自动同步（防抖）
   */
  queueAutoSync() {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer)
    }

    this.autoSyncTimer = setTimeout(() => {
      void this.performAutoSync()
    }, DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
  }

  private async performAutoSync() {
    this.lastAutoSyncStatus = 'syncing'

    try {
      await this.syncWithSupabase()
      this.lastAutoSyncStatus = 'success'
      // 3 秒后清除成功提示
      setTimeout(() => {
        if (this.lastAutoSyncStatus === 'success') {
          this.lastAutoSyncStatus = 'idle'
        }
      }, 3000)
    }
    catch (error) {
      logger.warn('Auto-sync failed', error)
      this.lastAutoSyncStatus = 'error'
      // 5 秒后清除错误提示
      setTimeout(() => {
        if (this.lastAutoSyncStatus === 'error') {
          this.lastAutoSyncStatus = 'idle'
        }
      }, 5000)
    }
  }

  // ==================== Realtime ====================

  /**
   * 启动 Realtime 订阅
   */
  private startRealtime() {
    if (this.unsubscribeRealtime) {
      return // 已经在监听
    }

    this.unsubscribeRealtime = subscribeToRealtime({
      onInsert: (row: DesktopNoteRow) => {
        this.handleRealtimeInsert(row)
      },
      onUpdate: (row: DesktopNoteRow) => {
        this.handleRealtimeUpdate(row)
      },
      onDelete: (row: DesktopNoteRow) => {
        this.handleRealtimeDelete(row)
      },
    })
  }

  /**
   * 停止 Realtime 订阅
   */
  private stopRealtime() {
    this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
  }

  /**
   * 静默关闭便签窗口（仅关闭 Rust 端窗口，不标记 dirty 避免反向同步环）
   *
   * 用于 Realtime 收到远端 visible=false 时关闭本地窗口。
   */
  private async closeNoteWindowSilent(noteId: string) {
    try {
      await invoke('close_desktop_note_window', {
        payload: { noteId, silent: true },
      })
    }
    catch (error) {
      logger.warn('Failed to close desktop note window (realtime)', { noteId, error })
    }
  }

  private async applySyncedNotes(snapshot: DesktopNote[], merged: DesktopNote[]) {
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
    for (const note of snapshot) {
      const updated = this.getNoteById(note.id)
      if (note.visible && updated && (!updated.visible || updated.deletedAt)) {
        await this.closeNoteWindowSilent(note.id)
      }
    }
  }

  private handleRealtimeInsert(row: DesktopNoteRow) {
    this.handleRealtimeUpdate(row)
  }

  private handleRealtimeUpdate(row: DesktopNoteRow) {
    void this.applyRealtimeRow(row).catch(error => logger.warn('Failed to apply synced desktop note', error))
  }

  private handleRealtimeDelete(row: DesktopNoteRow) {
    void this.applyRealtimeRow(row, true).catch(error => logger.warn('Failed to apply deleted desktop note', error))
  }

  private async applyRealtimeRow(row: DesktopNoteRow, hardDeleted = false) {
    await this.flushPersist()
    const snapshot = await getDesktopNotes()
    if (!hardDeleted) {
      await this.applySyncedNotes(snapshot, mergeRemoteIntoLocal(snapshot, [row]))
      return
    }
    const now = Date.now()
    const deleted = snapshot.map(note => note.id === row.id
      ? { ...note, deletedAt: now, visible: false, updatedAt: now, sync: { ...note.sync, dirty: false } }
      : note)
    await this.applySyncedNotes(snapshot, deleted)
  }
}

export const desktopNotesStore = new DesktopNotesStore()
