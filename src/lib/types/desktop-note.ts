/**
 * 桌面便签领域模型
 *
 * 说明：
 * - `deletedAt` 用于软删除标记（时间戳），null 表示活跃
 * - `visible` 编码在 bounds JSONB 中随 Supabase 同步
 * - `bounds` 采用屏幕百分比 (0~1) 存储，跨设备/分辨率/DPI 自动适配
 * - 使用 Supabase Auth + PostgreSQL 进行云端同步
 */
export type DesktopNoteColor = 'sunny' | 'mint' | 'sky' | 'lavender' | 'rose' | 'slate'

/**
 * 便签位置/大小 —— 以屏幕百分比 (0~1) 存储
 *
 * 存储便签左上角和右下角在屏幕上的相对位置，
 * 恢复时按当前屏幕尺寸乘以百分比即可还原为像素坐标。
 */
export interface DesktopNoteBounds {
  /** 左上角 x 占屏幕宽度的百分比 (0~1) */
  leftPercent: number
  /** 左上角 y 占屏幕高度的百分比 (0~1) */
  topPercent: number
  /** 右下角 x 占屏幕宽度的百分比 (0~1) */
  rightPercent: number
  /** 右下角 y 占屏幕高度的百分比 (0~1) */
  bottomPercent: number
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
  /** 窗口是否可见（编码在 bounds JSONB 中随 Supabase 同步） */
  visible: boolean
  /** 窗口位置/大小（百分比格式，同步到 Supabase） */
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
