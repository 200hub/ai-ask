/**
 * 桌面便签领域模型
 *
 * 说明：
 * - `deletedAt` 用于软删除标记（时间戳），null 表示活跃
 * - `visible` 编码在 bounds JSONB 中随 Supabase 同步
 * - `bounds` 采用屏幕百分比 (0~1) 存储，但仅设备本地保存（不跨设备同步）
 * - 使用 Supabase Auth + PostgreSQL 进行云端同步
 */
export type DesktopNoteColor = 'sunny' | 'mint' | 'sky' | 'lavender' | 'rose' | 'slate'

/**
 * 便签位置/大小 —— 逻辑像素（CSS 像素，相对虚拟桌面原点）
 *
 * 设计上不做任何屏幕/显示器感知：保存什么坐标就还原什么坐标。
 * 用户拔插显示器、切换主屏的处理交给 OS（OS 自己会把窗口拉回可见区域）。
 */
export interface DesktopNoteBounds {
  /** 逻辑像素 x 坐标（相对虚拟桌面原点） */
  x: number
  /** 逻辑像素 y 坐标（相对虚拟桌面原点） */
  y: number
  /** 逻辑像素宽度 */
  width: number
  /** 逻辑像素高度 */
  height: number
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
  /** 窗口位置/大小（百分比格式，仅设备本地） */
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
