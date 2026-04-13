import type { DesktopNote, DesktopNoteRow, DesktopNotesSyncResult } from '$lib/types/desktop-note'
/**
 * 便签同步引擎 — Supabase 实现
 *
 * 同步策略：
 * 1. 推送本地 dirty 便签 → Supabase upsert（含软删除）
 * 2. 拉取远端变更 → select where updated_at > lastSyncedAt
 * 3. 合并采用 Last-Writer-Wins（以 updatedAt 为准）
 * 4. Realtime 订阅进行增量同步
 *
 * 同步字段：title, content, color, bounds（含 refScreenWidth/refScreenHeight）
 * 纯本地字段：visible（窗口是否打开，不同步）
 */
import type { RealtimeChannel } from '@supabase/supabase-js'

import { DESKTOP_NOTES, SUPABASE } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'
import { getCurrentUser, getSupabaseClient } from '$lib/utils/supabase'

/**
 * 本地便签 → Supabase 行格式
 */
function noteToRow(note: DesktopNote, userId: string): DesktopNoteRow {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    color: note.color,
    bounds: note.bounds,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt,
  }
}

/**
 * Supabase 行 → 本地便签格式
 *
 * 字段映射规则：
 * - title/content/color/bounds/createdAt/updatedAt/deletedAt → 直接从远端行赋值
 * - visible → 保留本地窗口状态（不同步），新便签默认 false
 * - bounds → 优先用远端（含 refScreenWidth/refScreenHeight），缺失时复用本地或默认值
 * - sync → 重置为 dirty=false + 当前时间戳
 */
function rowToNote(row: DesktopNoteRow, existingLocal?: DesktopNote): DesktopNote {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    color: row.color as DesktopNote['color'],
    // visible 是纯本地窗口状态（当前设备是否打开窗口），不从远端覆盖
    visible: existingLocal?.visible ?? false,
    // bounds 优先使用远端数据（含 refScreenWidth/refScreenHeight），确保跨设备同步
    bounds: row.bounds ?? existingLocal?.bounds ?? {
      x: DESKTOP_NOTES.DEFAULT_OFFSET_X,
      y: DESKTOP_NOTES.DEFAULT_OFFSET_Y,
      width: DESKTOP_NOTES.DEFAULT_WIDTH,
      height: DESKTOP_NOTES.DEFAULT_HEIGHT,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    sync: {
      dirty: false,
      lastSyncedAt: Date.now(),
    },
  }
}

/**
 * 推送本地 dirty 便签到 Supabase
 *
 * 使用 upsert 保证幂等：同一 id 的便签不会创建重复记录
 */
export async function pushDirtyNotes(notes: DesktopNote[]): Promise<number> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Not authenticated')
  }

  const dirtyNotes = notes.filter(n => n.sync.dirty)
  if (dirtyNotes.length === 0) {
    return 0
  }

  // 分批推送，避免单次请求过大
  const batchSize = DESKTOP_NOTES.MAX_NOTES_PER_SYNC
  let totalPushed = 0

  for (let i = 0; i < dirtyNotes.length; i += batchSize) {
    const batch = dirtyNotes.slice(i, i + batchSize)
    const rows = batch.map(n => noteToRow(n, user.id))

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from(SUPABASE.NOTES_TABLE)
      .upsert(rows, { onConflict: 'user_id,id' })

    if (error) {
      logger.error('Failed to push notes batch', { offset: i, message: error.message })
      throw new Error(`Push failed: ${error.message}`)
    }

    totalPushed += batch.length
  }

  logger.info('Pushed dirty notes to Supabase', { count: totalPushed })
  return totalPushed
}

/**
 * 拉取远端自 lastSyncedAt 以来的变更
 *
 * 返回远端便签行列表
 */
export async function pullRemoteChanges(lastSyncedAt: number | null): Promise<DesktopNoteRow[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Not authenticated')
  }

  const supabase = getSupabaseClient()

  let query = supabase
    .from(SUPABASE.NOTES_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  // 首次同步（lastSyncedAt 为 null）拉取全量
  if (lastSyncedAt !== null) {
    query = query.gt('updated_at', lastSyncedAt)
  }

  const { data, error } = await query

  if (error) {
    logger.error('Failed to pull remote notes', { message: error.message })
    throw new Error(`Pull failed: ${error.message}`)
  }

  logger.info('Pulled remote notes from Supabase', { count: data?.length ?? 0 })
  return (data ?? []) as DesktopNoteRow[]
}

/**
 * 合并远端变更到本地：Last-Writer-Wins
 *
 * 规则：
 * - 远端 updated_at > 本地 updatedAt → 覆盖本地
 * - 远端 updated_at <= 本地 updatedAt → 保留本地（本地已在 push 阶段推送）
 * - 远端有但本地无 → 新增到本地
 */
export function mergeRemoteIntoLocal(
  localNotes: DesktopNote[],
  remoteRows: DesktopNoteRow[],
  options?: { preferRemote?: boolean },
): DesktopNote[] {
  const preferRemote = options?.preferRemote ?? false
  const localMap = new Map(localNotes.map(n => [n.id, n]))

  for (const row of remoteRows) {
    const local = localMap.get(row.id)

    if (!local) {
      // 远端有，本地无 → 新增
      localMap.set(row.id, rowToNote(row))
    }
    else if (preferRemote) {
      // 全量拉取场景（如重新登录）以远端为准，避免本地历史状态（尤其软删除）遮蔽远端有效数据
      localMap.set(row.id, rowToNote(row, local))
    }
    else if (row.updated_at > local.updatedAt) {
      // 远端较新 → 覆盖本地（保留 visible / bounds）
      localMap.set(row.id, rowToNote(row, local))
    }
    // else: 本地较新或同步 → 保持本地版本
  }

  return Array.from(localMap.values())
}

/**
 * 完整同步流程：push dirty → pull changes → merge
 *
 * @param localNotes - 本地便签列表
 * @param lastSyncedAt - 上次同步时间戳
 * @param options - 同步选项
 * @param options.preferRemote - 强制以远端数据为准（启动时关闭前已同步）
 * @param options.fullPull     - 强制全量拉取（忽略 lastSyncedAt 增量过滤）
 */
export async function performFullSync(
  localNotes: DesktopNote[],
  lastSyncedAt: number | null,
  options?: { preferRemote?: boolean, fullPull?: boolean },
): Promise<{ notes: DesktopNote[], result: DesktopNotesSyncResult }> {
  // 1. 推送本地 dirty 便签
  const pushed = await pushDirtyNotes(localNotes)

  // 2. 推送成功后清除 dirty 标记（在内存中）
  const afterPush = localNotes.map(n => n.sync.dirty
    ? { ...n, sync: { ...n.sync, dirty: false, lastSyncedAt: Date.now() } }
    : n,
  )

  // 3. 拉取远端变更
  // 启动时或首次同步使用全量拉取（fullPull 或 lastSyncedAt === null）
  const pullSince = options?.fullPull ? null : lastSyncedAt
  const remoteRows = await pullRemoteChanges(pullSince)

  // 4. 合并
  // preferRemote 场景：启动恢复（关闭前已同步）、首次/重新登录
  const merged = mergeRemoteIntoLocal(afterPush, remoteRows, {
    preferRemote: options?.preferRemote ?? (lastSyncedAt === null),
  })

  const syncedAt = Date.now()

  return {
    notes: merged,
    result: {
      pushed,
      pulled: remoteRows.length,
      syncedAt,
    },
  }
}

/**
 * Realtime 订阅回调类型
 */
export interface RealtimeCallbacks {
  onInsert: (row: DesktopNoteRow) => void
  onUpdate: (row: DesktopNoteRow) => void
  onDelete: (row: DesktopNoteRow) => void
}

/**
 * 订阅 Supabase Realtime 变更
 *
 * 返回取消订阅函数
 */
export function subscribeToRealtime(callbacks: RealtimeCallbacks): (() => void) | null {
  try {
    const supabase = getSupabaseClient()

    const channel: RealtimeChannel = supabase
      .channel('desktop-notes-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: SUPABASE.NOTES_TABLE,
        },
        (payload) => {
          logger.info('Realtime: note inserted', { id: (payload.new as DesktopNoteRow).id })
          callbacks.onInsert(payload.new as DesktopNoteRow)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: SUPABASE.NOTES_TABLE,
        },
        (payload) => {
          logger.info('Realtime: note updated', { id: (payload.new as DesktopNoteRow).id })
          callbacks.onUpdate(payload.new as DesktopNoteRow)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: SUPABASE.NOTES_TABLE,
        },
        (payload) => {
          logger.info('Realtime: note deleted', { id: (payload.old as DesktopNoteRow).id })
          callbacks.onDelete(payload.old as DesktopNoteRow)
        },
      )
      .subscribe((status) => {
        logger.info('Realtime subscription status', { status })
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }
  catch (error) {
    logger.error('Failed to subscribe to Realtime', error)
    return null
  }
}

/**
 * 验证 Supabase 数据库 schema 是否就绪
 *
 * 登录成功后调用，尝试 SELECT 检测 desktop_notes 表是否存在。
 * 返回 true 表示可用，false 表示表不存在或查询失败。
 */
export async function verifySchema(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()

    // 用 LIMIT 0 的 select 验证表是否存在，不读任何数据
    const { error } = await supabase
      .from(SUPABASE.NOTES_TABLE)
      .select('id', { count: 'exact', head: true })
      .limit(0)

    if (error) {
      logger.error('Schema verification failed', { message: error.message })
      return false
    }

    logger.info('Schema verification passed')
    return true
  }
  catch (error) {
    logger.error('Schema verification error', error)
    return false
  }
}
