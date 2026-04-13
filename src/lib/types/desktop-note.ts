/**
 * 桌面便签领域模型
 *
 * 说明：
 * - `deletedAt` 用于软删除标记（时间戳），null 表示活跃
 * - `visible` 是纯本地窗口状态，不同步到 Supabase
 * - `bounds`（含 refScreenWidth/refScreenHeight）同步到 Supabase，支持跨设备/分辨率还原
 * - 使用 Supabase Auth + PostgreSQL 进行云端同步
 */
export type DesktopNoteColor = 'sunny' | 'mint' | 'sky' | 'lavender' | 'rose' | 'slate'

export interface DesktopNoteBounds {
  x: number
  y: number
  width: number
  height: number
  /** 保存 bounds 时的屏幕逻辑宽度（用于跨分辨率/DPI 等比缩放） */
  refScreenWidth?: number
  /** 保存 bounds 时的屏幕逻辑高度（用于跨分辨率/DPI 等比缩放） */
  refScreenHeight?: number
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
  color: DesktopNoteColor
  /** 纯本地状态：当前桌面窗口是否应展示 */
  visible: boolean
  /** 窗口位置/大小（同步到 Supabase，含 refScreenWidth/refScreenHeight 用于跨分辨率缩放） */
  bounds: DesktopNoteBounds
  createdAt: number
  updatedAt: number
  /** 软删除时间戳，null 表示活跃 */
  deletedAt: number | null
  sync: DesktopNoteSyncState
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
  bounds: DesktopNoteBounds
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
