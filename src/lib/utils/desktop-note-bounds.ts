import type { DesktopNoteBounds } from '$lib/types/desktop-note'

import { DESKTOP_NOTES } from '$lib/utils/constants'

interface LegacyPercentBounds {
  leftPercent?: number
  topPercent?: number
  rightPercent?: number
  bottomPercent?: number
}

function hasFiniteLegacyPercentBounds(value: LegacyPercentBounds): boolean {
  return [value.leftPercent, value.topPercent, value.rightPercent, value.bottomPercent]
    .every(item => typeof item === 'number' && Number.isFinite(item))
}

export function createDefaultDesktopNoteBounds(index = 0): DesktopNoteBounds {
  return {
    x: DESKTOP_NOTES.DEFAULT_OFFSET_X + index * DESKTOP_NOTES.DEFAULT_OFFSET_STEP,
    y: DESKTOP_NOTES.DEFAULT_OFFSET_Y + index * DESKTOP_NOTES.DEFAULT_OFFSET_STEP,
    width: DESKTOP_NOTES.DEFAULT_WIDTH,
    height: DESKTOP_NOTES.DEFAULT_HEIGHT,
  }
}

export function isDesktopNotePositionSane(x: number, y: number, monitor?: string): boolean {
  return Number.isFinite(x)
    && Number.isFinite(y)
    && (Boolean(monitor) || (
      Math.abs(x) <= DESKTOP_NOTES.POSITION_SANITY_LIMIT_X
      && Math.abs(y) <= DESKTOP_NOTES.POSITION_SANITY_LIMIT_Y
    ))
}

export function isDesktopNoteBoundsUsable(bounds: DesktopNoteBounds | null | undefined): bounds is DesktopNoteBounds {
  if (!bounds) {
    return false
  }

  return isDesktopNotePositionSane(bounds.x, bounds.y, bounds.monitor)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width >= DESKTOP_NOTES.MIN_WIDTH
    && bounds.height >= DESKTOP_NOTES.MIN_HEIGHT
}

/**
 * 归一化桌面便签 bounds。
 *
 * 规则：
 * - 兼容旧版百分比数据；
 * - width/height 始终提升到最小尺寸；
 * - 位置超出合理范围时回退到 fallback，避免保存/恢复离谱脏坐标。
 */
export function normalizeDesktopNoteBounds(
  value: unknown,
  fallback: DesktopNoteBounds = createDefaultDesktopNoteBounds(),
): DesktopNoteBounds {
  const candidate = value as Partial<DesktopNoteBounds> & LegacyPercentBounds | null | undefined

  if (!candidate) {
    return { ...fallback }
  }

  if (hasFiniteLegacyPercentBounds(candidate)) {
    const left = candidate.leftPercent as number
    const top = candidate.topPercent as number
    const right = candidate.rightPercent as number
    const bottom = candidate.bottomPercent as number

    return normalizeDesktopNoteBounds({
      x: Math.round(left * DESKTOP_NOTES.DEFAULT_SCREEN_WIDTH),
      y: Math.round(top * DESKTOP_NOTES.DEFAULT_SCREEN_HEIGHT),
      width: Math.round((right - left) * DESKTOP_NOTES.DEFAULT_SCREEN_WIDTH),
      height: Math.round((bottom - top) * DESKTOP_NOTES.DEFAULT_SCREEN_HEIGHT),
    }, fallback)
  }

  const rawX = Number(candidate.x)
  const rawY = Number(candidate.y)
  const rawWidth = Number(candidate.width)
  const rawHeight = Number(candidate.height)
  const monitor = typeof candidate.monitor === 'string' && candidate.monitor ? candidate.monitor : undefined
  const validPosition = isDesktopNotePositionSane(rawX, rawY, monitor)
  const normalizedMonitor = validPosition ? monitor : fallback.monitor

  return {
    x: validPosition ? Math.round(rawX) : fallback.x,
    y: validPosition ? Math.round(rawY) : fallback.y,
    width: Number.isFinite(rawWidth) ? Math.max(Math.round(rawWidth), DESKTOP_NOTES.MIN_WIDTH) : fallback.width,
    height: Number.isFinite(rawHeight) ? Math.max(Math.round(rawHeight), DESKTOP_NOTES.MIN_HEIGHT) : fallback.height,
    ...(normalizedMonitor ? { monitor: normalizedMonitor } : {}),
  }
}

/**
 * 用于 per-note key：只有当原始输入本身可信时才接受。
 *
 * 这样可以避免把 `-21333` 这类脏坐标“修正成默认值”后反过来覆盖内存中的好坐标。
 */
export function normalizeStoredDesktopNoteBounds(value: unknown): DesktopNoteBounds | null {
  const candidate = value as Partial<DesktopNoteBounds> & LegacyPercentBounds | null | undefined
  if (!candidate) {
    return null
  }

  if (hasFiniteLegacyPercentBounds(candidate)) {
    return normalizeDesktopNoteBounds(candidate)
  }

  const x = Number(candidate.x)
  const y = Number(candidate.y)
  const width = Number(candidate.width)
  const height = Number(candidate.height)

  if (!isDesktopNotePositionSane(x, y, candidate.monitor) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return normalizeDesktopNoteBounds(candidate)
}
