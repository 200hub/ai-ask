/**
 * 桌面便签领域模型
 *
 * 说明：
 * - `deletedAt` 用于软删除标记（时间戳），null 表示活跃
 * - `visible` 编码在 bounds JSONB 中随 Supabase 同步
 * - `bounds` 仅在设备本地保存
 * - 使用 Supabase Auth + PostgreSQL 进行云端同步
 */
export type DesktopNoteColor = 'sunny' | 'mint' | 'sky' | 'lavender' | 'rose' | 'slate'
export type DesktopNoteKind = 'markdown' | 'todo'

/**
 * 逻辑像素位置和大小。带 monitor 时，位置相对于该显示器的工作区。
 * 旧数据没有 monitor，位置相对于虚拟桌面原点。
 */
export interface DesktopNoteGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopNoteBounds extends DesktopNoteGeometry {
  monitor?: string
  preferredMonitor?: string
  monitorBounds?: Record<string, DesktopNoteGeometry>
}

/**
 * 同步状态（纯本地跟踪字段，不上传到 Supabase）
 */
export interface DesktopNoteSyncState {
  /** 本地有未推送的变更 */
  dirty: boolean
  /** 上次成功同步时间 */
  lastSyncedAt: number | null
}

export interface DesktopNote {
  id: string
  title: string
  content: string
  /** 未指定时兼容旧版 Markdown 便签。 */
  kind?: DesktopNoteKind
  color: DesktopNoteColor
  /** 窗口是否可见（编码在 bounds JSONB 中随 Supabase 同步） */
  visible: boolean
  /** 窗口位置和大小，仅设备本地保存 */
  bounds: DesktopNoteBounds
  createdAt: number
  updatedAt: number
  /** 软删除时间戳，null 表示活跃 */
  deletedAt: number | null
  sync: DesktopNoteSyncState
}

export interface DesktopNotePatch {
  noteId: string
  updates: Partial<Omit<DesktopNote, 'sync'>> & { sync?: Partial<DesktopNoteSyncState> }
  ifUnchanged?: { updatedAt: number | null }
}

/**
 * Supabase 数据库行结构（与 desktop_notes 表对应）
 */
export interface DesktopNoteRow {
  id: string
  user_id: string
  title: string
  content: string
  color: string
  bounds: Partial<DesktopNoteBounds> & { visible?: boolean, kind?: DesktopNoteKind }
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/**
 * 同步结果
 */
export interface DesktopNotesSyncResult {
  pushed: number
  pulled: number
  syncedAt: number
}
