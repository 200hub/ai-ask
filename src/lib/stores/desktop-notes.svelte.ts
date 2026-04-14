/**
 * 桌面便签状态管理
 *
 * 说明：
 * - 主窗口负责调用窗口相关命令，恢复/隐藏所有便签窗口。
 * - 便签窗口本身也会复用该 store 读取同一份持久化数据，用于编辑单个便签。
 * - 跨窗口数据一致性：note 窗口仅持久化自身所改的字段（read-modify-write），
 *   避免覆盖其他窗口的修改。
 * - 同步采用 Supabase（PostgreSQL + Realtime），认证使用邮箱+密码。
 */
import type {
  DesktopNote,
  DesktopNoteBounds,
  DesktopNoteRow,
  DesktopNotesSyncResult,
} from '$lib/types/desktop-note'
import type { SupabaseSessionInfo } from '$lib/utils/supabase'

import { configStore } from '$lib/stores/config.svelte'
import { DESKTOP_NOTES } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'
import {
  mergeRemoteIntoLocal,
  performFullSync,
  subscribeToRealtime,
  verifySchema,
} from '$lib/utils/notes-sync'
import { getDesktopNotes, saveDesktopNotes } from '$lib/utils/storage'
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

/**
 * 获取当前屏幕逻辑尺寸（CSS 像素）
 *
 * 使用 DOM `screen` 对象，返回逻辑像素分辨率，
 * 与 Tauri LogicalPosition / LogicalSize 坐标系一致。
 */
function getScreenLogicalSize(): { width: number, height: number } {
  const w = typeof screen !== 'undefined' ? screen.width : 0
  const h = typeof screen !== 'undefined' ? screen.height : 0
  return {
    width: w > 0 ? w : DESKTOP_NOTES.DEFAULT_SCREEN_WIDTH,
    height: h > 0 ? h : DESKTOP_NOTES.DEFAULT_SCREEN_HEIGHT,
  }
}

/**
 * 按屏幕比例缩放 bounds：将存储的 bounds 根据保存时屏幕尺寸
 * 等比缩放到当前屏幕尺寸，确保不同分辨率/DPI 下便签位置和大小一致。
 */
export function scaleBoundsForScreen(bounds: DesktopNoteBounds): DesktopNoteBounds {
  const { refScreenWidth, refScreenHeight } = bounds
  if (!refScreenWidth || !refScreenHeight) {
    // 旧数据无参考屏幕尺寸，直接使用原始值
    return bounds
  }

  const { width: curW, height: curH } = getScreenLogicalSize()

  // 屏幕尺寸未变，无需缩放
  if (curW === refScreenWidth && curH === refScreenHeight) {
    return bounds
  }

  const scaleX = curW / refScreenWidth
  const scaleY = curH / refScreenHeight

  return {
    x: Math.round(bounds.x * scaleX),
    y: Math.round(bounds.y * scaleY),
    width: Math.max(Math.round(bounds.width * scaleX), DESKTOP_NOTES.MIN_WIDTH),
    height: Math.max(Math.round(bounds.height * scaleY), DESKTOP_NOTES.MIN_HEIGHT),
    refScreenWidth: curW,
    refScreenHeight: curH,
  }
}

function createDefaultBounds(index: number): DesktopNoteBounds {
  const { width: sw, height: sh } = getScreenLogicalSize()
  return {
    x: DESKTOP_NOTES.DEFAULT_OFFSET_X + index * 24,
    y: DESKTOP_NOTES.DEFAULT_OFFSET_Y + index * 24,
    width: DESKTOP_NOTES.DEFAULT_WIDTH,
    height: DESKTOP_NOTES.DEFAULT_HEIGHT,
    refScreenWidth: sw,
    refScreenHeight: sh,
  }
}

function createEmptyNote(index: number): DesktopNote {
  const now = Date.now()
  return {
    id: generateNoteId(),
    title: '',
    content: '',
    color: DESKTOP_NOTES.DEFAULT_COLOR,
    visible: true,
    bounds: createDefaultBounds(index),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    sync: {
      dirty: true,
      lastSyncedAt: null,
    },
  }
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
  /** 缓存待持久化的 noteId，用于 read-modify-write 单条更新以避免跨窗口覆盖 */
  private pendingNoteIds = new Set<string>()
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

    this.notes = await getDesktopNotes()
    this.initialized = true
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

  /**
   * 排队持久化 —— 传入 noteId 时使用 read-modify-write 避免跨窗口覆盖
   */
  private queuePersist(noteId?: string) {
    if (noteId) {
      this.pendingNoteIds.add(noteId)
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.saveTimer = setTimeout(() => {
      void this.flushPersist()
    }, DESKTOP_NOTES.SAVE_DEBOUNCE_MS)
  }

  /**
   * 执行持久化；若有 pendingNoteIds 则只做增量读写
   */
  private async flushPersist() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    const changedIds = new Set(this.pendingNoteIds)
    this.pendingNoteIds.clear()

    if (changedIds.size === 0) {
      // 无增量标记 —— 全量保存（sync / create / delete 等场景）
      await saveDesktopNotes(this.notes)
      return
    }

    // 增量 read-modify-write：从存储读最新全量 → 只替换本窗口改过的便签 → 写回
    try {
      const freshNotes = await getDesktopNotes()

      for (const nid of changedIds) {
        const localNote = this.notes.find(n => n.id === nid)
        if (!localNote) {
          continue
        }

        const idx = freshNotes.findIndex(n => n.id === nid)
        if (idx >= 0) {
          freshNotes[idx] = { ...localNote }
        }
        else {
          freshNotes.push({ ...localNote })
        }
      }

      await saveDesktopNotes(freshNotes)
    }
    catch (error) {
      logger.error('Failed to persist desktop note (incremental)', error)
      // 回退：全量保存
      await saveDesktopNotes(this.notes)
    }
  }

  /**
   * 立即全量持久化（适用于 sync / create / delete 等全量操作）
   */
  async persistNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    this.pendingNoteIds.clear()
    await saveDesktopNotes(this.notes)
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

  async createNote(): Promise<DesktopNote> {
    const note = createEmptyNote(this.activeNotes.length)
    this.notes = [note, ...this.notes]
    await this.persistNow()
    return note
  }

  async updateNote(noteId: string, updates: Partial<DesktopNote>, markDirty = true) {
    let changed = false

    this.notes = this.notes.map((note) => {
      if (note.id !== noteId) {
        return note
      }

      changed = true
      const updatedAt = updates.updatedAt ?? Date.now()
      return {
        ...note,
        ...updates,
        sync: {
          ...note.sync,
          ...(updates.sync ?? {}),
          dirty: markDirty ? true : (updates.sync?.dirty ?? note.sync.dirty),
        },
        updatedAt,
      }
    })

    if (changed) {
      this.queuePersist(noteId)
    }
  }

  async updateNoteContent(noteId: string, content: string) {
    await this.updateNote(noteId, { content })
  }

  // 颜色更新：不触发 Rust 窗口命令，但标记 dirty 以同步到 Supabase
  async updateNoteColor(noteId: string, color: DesktopNote['color']) {
    await this.updateNote(noteId, { color })
  }

  async updateNoteBounds(noteId: string, bounds: DesktopNoteBounds) {
    // bounds 变更标记 dirty，以便同步到 Supabase（含屏幕参考尺寸 refScreenWidth/refScreenHeight）
    await this.updateNote(noteId, { bounds })
  }

  // ==================== 窗口管理 ====================

  async openNoteWindow(noteId: string) {
    const note = this.getNoteById(noteId)
    if (!note) {
      return
    }

    // 按屏幕比例缩放 bounds：不同分辨率/DPI 下等比还原窗口位置和大小
    const scaledBounds = scaleBoundsForScreen(note.bounds)
    await invoke('ensure_desktop_note_window', {
      payload: {
        noteId: note.id,
        bounds: scaledBounds,
      },
    })

    // 仅当 visible 状态需要变更时才更新，且不标记 dirty 避免无谓同步
    if (!note.visible) {
      await this.updateNote(noteId, { visible: true }, false)
    }
  }

  async closeNoteWindow(noteId: string) {
    try {
      await invoke('close_desktop_note_window', {
        payload: { noteId },
      })
    }
    catch (error) {
      logger.warn('Failed to close desktop note window', { noteId, error })
    }

    await this.updateNote(noteId, { visible: false }, false)
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
      try {
        await this.openNoteWindow(note.id)
      }
      catch (error) {
        logger.error('Failed to restore desktop note window', { noteId: note.id, error })
      }
    }
  }

  async hideAllWindows() {
    for (const note of this.visibleNotes) {
      await this.closeNoteWindow(note.id)
    }
  }

  // ==================== 删除 ====================

  async deleteNote(noteId: string) {
    const note = this.getNoteById(noteId)
    if (!note) {
      return
    }

    await this.closeNoteWindow(noteId)

    // 软删除：设置 deletedAt 时间戳，标记 dirty
    this.notes = this.notes.map(n =>
      n.id !== noteId
        ? n
        : {
            ...n,
            visible: false,
            deletedAt: Date.now(),
            sync: { ...n.sync, dirty: true },
            updatedAt: Date.now(),
          },
    )

    await this.persistNow()

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
      this.notes = await getDesktopNotes()

      logger.info('Sync starting', {
        localCount: this.notes.length,
        lastSyncedAt: configStore.config.desktopNotesLastSyncedAt,
        options,
      })

      const { notes, result } = await performFullSync(
        this.notes,
        configStore.config.desktopNotesLastSyncedAt,
        options,
      )

      this.notes = notes
      await this.persistNow()

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

  private handleRealtimeInsert(row: DesktopNoteRow) {
    const existing = this.notes.find(n => n.id === row.id)
    if (existing) {
      return // 本地已有，可能是自己推送的
    }

    const merged = mergeRemoteIntoLocal(this.notes, [row])
    this.notes = merged
    void this.persistNow()
  }

  private handleRealtimeUpdate(row: DesktopNoteRow) {
    const local = this.notes.find(n => n.id === row.id)
    if (local && local.updatedAt >= row.updated_at) {
      return // 本地版本不比远端旧
    }

    const merged = mergeRemoteIntoLocal(this.notes, [row])
    this.notes = merged
    void this.persistNow()
  }

  private handleRealtimeDelete(row: DesktopNoteRow) {
    const local = this.notes.find(n => n.id === row.id)
    if (!local) {
      return
    }

    // 标记为软删除
    this.notes = this.notes.map(n =>
      n.id !== row.id
        ? n
        : { ...n, deletedAt: Date.now(), visible: false, sync: { ...n.sync, dirty: false } },
    )
    void this.persistNow()
  }
}

export const desktopNotesStore = new DesktopNotesStore()
