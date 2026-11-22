import type { DesktopNote, DesktopNoteRow, DesktopNotesSyncResult } from '$lib/types/desktop-note'
import type { SyncedNoteRow } from 'ai-ask-contract'
import { getCloudConnection } from './cloud-auth'
import { DESKTOP_NOTES, HAI_SYNC } from './constants'
import { createDefaultDesktopNoteBounds } from './desktop-note-bounds'

/** 内容与可见状态参与跨设备同步，窗口位置只在本机保存。 */
function noteToRow(note: DesktopNote, userId: string): SyncedNoteRow {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    color: note.color,
    bounds: { visible: note.visible, ...(note.kind === 'todo' ? { kind: note.kind } : {}) },
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt,
  }
}

function rowToNote(row: DesktopNoteRow, existingLocal?: DesktopNote): DesktopNote {
  const rawBounds = row.bounds ?? {}
  // 从 bounds JSONB 中提取 visible 状态（跨设备同步用）
  const remoteVisible = typeof rawBounds.visible === 'boolean' ? rawBounds.visible : undefined
  const bounds = existingLocal?.bounds ?? createDefaultDesktopNoteBounds()

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    ...((rawBounds.kind ?? existingLocal?.kind) === 'todo' ? { kind: 'todo' } : {}),
    color: row.color as DesktopNote['color'],
    // 远端有明确 visible 状态时使用远端值；否则保留本地状态或默认 true（新便签可见）
    visible: remoteVisible !== undefined ? remoteVisible : (existingLocal?.visible ?? true),
    bounds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    sync: {
      ...existingLocal?.sync,
      dirty: false,
      lastSyncedAt: Date.now(),
    },
  }
}

export function mergeRemoteIntoLocal(
  localNotes: DesktopNote[],
  remoteRows: DesktopNoteRow[],
): DesktopNote[] {
  const localMap = new Map(localNotes.map(note => [note.id, note]))
  for (const row of remoteRows) {
    const local = localMap.get(row.id)
    if (!local || (row.deleted_at !== null && local.deletedAt === null)) {
      localMap.set(row.id, rowToNote(row, local))
    }
    else if (local.deletedAt !== null && row.deleted_at === null) {
      continue
    }
    else if (row.updated_at > local.updatedAt) {
      localMap.set(row.id, rowToNote(row, local))
    }
  }
  return Array.from(localMap.values())
}

async function pushNotes(notes: DesktopNote[], connected: Awaited<ReturnType<typeof getCloudConnection>>) {
  const dirty = notes.filter(note => note.sync.dirty)
  let rows: DesktopNoteRow[] = []
  for (let offset = 0; offset < dirty.length; offset += DESKTOP_NOTES.MAX_NOTES_PER_SYNC) {
    const result = await connected.client.notes.push({
      notes: dirty.slice(offset, offset + DESKTOP_NOTES.MAX_NOTES_PER_SYNC).map(note => noteToRow(note, connected.userId)),
    })
    if (!result.success)
      throw new Error(result.error.message)
    rows = result.data
  }
  return { pushed: dirty.length, rows }
}

export async function performFullSync(
  localNotes: DesktopNote[],
  expectedUserId: string,
): Promise<{ notes: DesktopNote[], result: DesktopNotesSyncResult }> {
  const connected = await getCloudConnection()
  if (connected.userId !== expectedUserId)
    throw new Error('Cloud identity changed during synchronization')
  const pulled = await connected.client.notes.list({})
  if (!pulled.success)
    throw new Error(pulled.error.message)
  const merged = mergeRemoteIntoLocal(localNotes, pulled.data)
  const pushed = await pushNotes(merged, connected)
  const syncedAt = Date.now()
  const clean = merged.map(note => note.sync.dirty
    ? { ...note, sync: { ...note.sync, dirty: false, lastSyncedAt: syncedAt } }
    : note)
  // 服务端按版本条件写入并返回最终数据，首次拉取后的并发修改或删除仍可能胜出。
  const notes = new Map(clean.map(note => [note.id, note]))
  for (const row of pushed.rows) {
    const local = notes.get(row.id)
    if (local && local.deletedAt !== null && row.deleted_at === null)
      continue
    notes.set(row.id, rowToNote(row, local))
  }
  return { notes: Array.from(notes.values()), result: { pushed: pushed.pushed, pulled: pulled.data.length, syncedAt } }
}

/** 定时、网络恢复和窗口聚焦共用同一同步入口。 */
export function subscribeToChanges(onChange: () => void): () => void {
  const timer = setInterval(onChange, HAI_SYNC.POLL_INTERVAL_MS)
  window.addEventListener('online', onChange)
  window.addEventListener('focus', onChange)
  return () => {
    clearInterval(timer)
    window.removeEventListener('online', onChange)
    window.removeEventListener('focus', onChange)
  }
}
