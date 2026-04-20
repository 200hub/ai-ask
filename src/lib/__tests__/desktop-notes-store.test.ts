import type { DesktopNote } from '$lib/types/desktop-note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock 外部依赖
const mockGetDesktopNotes = vi.fn()
const mockSaveDesktopNotes = vi.fn()
const mockInvoke = vi.fn()

vi.mock('$lib/utils/storage', () => ({
  getDesktopNotes: () => mockGetDesktopNotes(),
  saveDesktopNotes: (notes: DesktopNote[]) => mockSaveDesktopNotes(notes),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const mockSetDesktopNotesLastSyncedAt = vi.fn()

vi.mock('$lib/stores/config.svelte', () => ({
  configStore: {
    config: {
      desktopNotesSyncEnabled: false,
    },
    setDesktopNotesLastSyncedAt: (...args: unknown[]) => mockSetDesktopNotesLastSyncedAt(...args),
  },
}))

vi.mock('$lib/utils/supabase', () => ({
  isSupabaseAvailable: () => false,
  getSessionInfo: vi.fn().mockResolvedValue({ authenticated: false, email: null, userId: null }),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  signUpWithEmail: vi.fn(),
  signInWithEmail: vi.fn(),
}))

function createTestNote(overrides: Partial<DesktopNote> = {}): DesktopNote {
  const now = Date.now()
  return {
    id: overrides.id ?? `note-${now}`,
    title: overrides.title ?? '',
    content: overrides.content ?? '',
    color: overrides.color ?? 'sunny',
    visible: overrides.visible ?? true,
    bounds: overrides.bounds ?? { leftPercent: 0.05, topPercent: 0.09, rightPercent: 0.22, bottomPercent: 0.35 },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
    sync: {
      dirty: true,
      lastSyncedAt: null,
      ...(overrides.sync ?? {}),
    },
  }
}

let desktopNotesStore: (typeof import('$lib/stores/desktop-notes.svelte'))['desktopNotesStore']

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  mockGetDesktopNotes.mockReset()
  mockSaveDesktopNotes.mockReset()
  mockInvoke.mockReset()
  mockSetDesktopNotesLastSyncedAt.mockReset()

  // 默认返回空列表
  mockGetDesktopNotes.mockResolvedValue([])
  mockSaveDesktopNotes.mockResolvedValue(undefined);

  ({ desktopNotesStore } = await import('$lib/stores/desktop-notes.svelte'))
})

describe('desktopNotesStore', () => {
  describe('updateNoteBounds', () => {
    it('should mark note as dirty when updating bounds (for Supabase sync)', async () => {
      const note = createTestNote({
        id: 'test-note-1',
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()

      const newBounds = { leftPercent: 0.1, topPercent: 0.18, rightPercent: 0.31, bottomPercent: 0.51 }
      await desktopNotesStore.updateNoteBounds('test-note-1', newBounds)

      const updated = desktopNotesStore.getNoteById('test-note-1')
      expect(updated).not.toBeNull()
      expect(updated!.bounds).toEqual(newBounds)
      // bounds 变更应标记 dirty 以便同步到 Supabase
      expect(updated!.sync.dirty).toBe(true)
    })
  })

  describe('updateNoteContent', () => {
    it('should mark note as dirty when updating content', async () => {
      const note = createTestNote({
        id: 'test-note-2',
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()
      await desktopNotesStore.updateNoteContent('test-note-2', 'new content')

      const updated = desktopNotesStore.getNoteById('test-note-2')
      expect(updated).not.toBeNull()
      expect(updated!.content).toBe('new content')
      // 内容更新应标记 dirty
      expect(updated!.sync.dirty).toBe(true)
    })
  })

  describe('updateNoteColor', () => {
    it('should mark note as dirty when updating color', async () => {
      const note = createTestNote({
        id: 'test-note-3',
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()
      await desktopNotesStore.updateNoteColor('test-note-3', 'mint')

      const updated = desktopNotesStore.getNoteById('test-note-3')
      expect(updated).not.toBeNull()
      expect(updated!.color).toBe('mint')
      // 颜色更新应标记 dirty
      expect(updated!.sync.dirty).toBe(true)
    })
  })

  describe('closeNoteWindow', () => {
    it('should set visible to false on user-initiated close', async () => {
      const note = createTestNote({ id: 'test-note-4', visible: true })
      mockGetDesktopNotes.mockResolvedValue([note])
      mockInvoke.mockResolvedValue(undefined)

      await desktopNotesStore.init()
      await desktopNotesStore.closeNoteWindow('test-note-4')

      const updated = desktopNotesStore.getNoteById('test-note-4')
      expect(updated).not.toBeNull()
      expect(updated!.visible).toBe(false)
    })
  })

  describe('openNoteWindow', () => {
    it('should set visible to true when opening a hidden note', async () => {
      const note = createTestNote({ id: 'test-note-5', visible: false })
      mockGetDesktopNotes.mockResolvedValue([note])
      mockInvoke.mockResolvedValue(undefined)

      await desktopNotesStore.init()
      await desktopNotesStore.openNoteWindow('test-note-5')

      // 前端将百分比 bounds 转为像素后传给 Rust
      expect(mockInvoke).toHaveBeenCalledWith('ensure_desktop_note_window', {
        payload: {
          noteId: 'test-note-5',
          bounds: expect.objectContaining({
            x: expect.any(Number),
            y: expect.any(Number),
            width: expect.any(Number),
            height: expect.any(Number),
          }),
        },
      })

      const updated = desktopNotesStore.getNoteById('test-note-5')
      expect(updated).not.toBeNull()
      expect(updated!.visible).toBe(true)
    })

    it('should silently return for non-existent note', async () => {
      mockGetDesktopNotes.mockResolvedValue([])

      await desktopNotesStore.init()
      await desktopNotesStore.openNoteWindow('non-existent')

      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('deleteNote', () => {
    it('should soft-delete note with deletedAt timestamp', async () => {
      const note = createTestNote({
        id: 'test-note-6',
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])
      mockInvoke.mockResolvedValue(undefined)

      await desktopNotesStore.init()
      await desktopNotesStore.deleteNote('test-note-6')

      const deleted = desktopNotesStore.getNoteById('test-note-6')
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).toBeGreaterThan(0)
      expect(deleted!.sync.dirty).toBe(true)
      expect(deleted!.visible).toBe(false)
    })

    it('should soft-delete unsynced note as well', async () => {
      const note = createTestNote({
        id: 'test-note-7',
        sync: { dirty: true, lastSyncedAt: null },
      })
      mockGetDesktopNotes.mockResolvedValue([note])
      mockInvoke.mockResolvedValue(undefined)

      await desktopNotesStore.init()
      await desktopNotesStore.deleteNote('test-note-7')

      const deleted = desktopNotesStore.getNoteById('test-note-7')
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).toBeGreaterThan(0)
    })
  })

  describe('visibleNotes', () => {
    it('should filter notes by visible and not deleted', async () => {
      const notes = [
        createTestNote({ id: 'visible-1', visible: true }),
        createTestNote({ id: 'hidden-1', visible: false }),
        createTestNote({ id: 'deleted-1', visible: true, deletedAt: Date.now(), sync: { dirty: false, lastSyncedAt: null } }),
      ]
      mockGetDesktopNotes.mockResolvedValue(notes)

      await desktopNotesStore.init()

      const visible = desktopNotesStore.visibleNotes
      expect(visible).toHaveLength(1)
      expect(visible[0].id).toBe('visible-1')
    })
  })

  describe('flushPersistPublic', () => {
    it('should be callable as a public method', async () => {
      mockGetDesktopNotes.mockResolvedValue([])
      await desktopNotesStore.init()

      // 公开方法应可调用且不抛异常
      await expect(desktopNotesStore.flushPersistPublic()).resolves.not.toThrow()
    })
  })

  describe('signOut', () => {
    it('should reset lastSyncedAt to null on sign out', async () => {
      mockGetDesktopNotes.mockResolvedValue([])
      mockSetDesktopNotesLastSyncedAt.mockResolvedValue(undefined)
      await desktopNotesStore.init()

      await desktopNotesStore.signOut()

      // 退出登录应重置同步时间戳，确保下次登录全量拉取
      expect(mockSetDesktopNotesLastSyncedAt).toHaveBeenCalledWith(null)
    })
  })
})

describe('boundsToPixels & pixelsToBounds', () => {
  let boundsToPixels: (typeof import('$lib/stores/desktop-notes.svelte'))['boundsToPixels']
  let pixelsToBounds: (typeof import('$lib/stores/desktop-notes.svelte'))['pixelsToBounds']

  beforeEach(async () => {
    ({ boundsToPixels, pixelsToBounds } = await import('$lib/stores/desktop-notes.svelte'))
  })

  it('should convert percentage bounds to pixel coordinates', () => {
    const bounds = { leftPercent: 0.1, topPercent: 0.2, rightPercent: 0.4, bottomPercent: 0.5 }
    const result = boundsToPixels(bounds, 1920, 1080)
    expect(result.x).toBe(192)
    expect(result.y).toBe(216)
    expect(result.width).toBe(576)
    expect(result.height).toBe(324)
  })

  it('should enforce MIN_WIDTH and MIN_HEIGHT', () => {
    // 非常小的百分比区域 → 宽/高不足时应 clamp 到最小值
    const bounds = { leftPercent: 0.5, topPercent: 0.5, rightPercent: 0.51, bottomPercent: 0.51 }
    const result = boundsToPixels(bounds, 1920, 1080)
    expect(result.width).toBeGreaterThanOrEqual(240)
    expect(result.height).toBeGreaterThanOrEqual(180)
  })

  it('should convert pixel coordinates to percentage bounds', () => {
    const result = pixelsToBounds(192, 216, 576, 324, 1920, 1080)
    expect(result.leftPercent).toBe(0.1)
    expect(result.topPercent).toBe(0.2)
    expect(result.rightPercent).toBe(0.4)
    expect(result.bottomPercent).toBe(0.5)
  })

  it('should round-trip correctly', () => {
    const original = { leftPercent: 0.25, topPercent: 0.15, rightPercent: 0.6, bottomPercent: 0.75 }
    const screenW = 1920
    const screenH = 1080
    const pixels = boundsToPixels(original, screenW, screenH)
    const restored = pixelsToBounds(pixels.x, pixels.y, pixels.width, pixels.height, screenW, screenH)

    // 因为 Math.round，可能有微小误差
    expect(Math.abs(restored.leftPercent - original.leftPercent)).toBeLessThan(0.001)
    expect(Math.abs(restored.topPercent - original.topPercent)).toBeLessThan(0.001)
    expect(Math.abs(restored.rightPercent - original.rightPercent)).toBeLessThan(0.001)
    expect(Math.abs(restored.bottomPercent - original.bottomPercent)).toBeLessThan(0.001)
  })

  it('should handle different screen sizes consistently', () => {
    // 在 1920x1080 保存的百分比，在 2560x1440 上还原
    const percentBounds = pixelsToBounds(960, 540, 320, 280, 1920, 1080)
    const on1080p = boundsToPixels(percentBounds, 1920, 1080)
    const on1440p = boundsToPixels(percentBounds, 2560, 1440)

    // 两个屏幕上的相对位置应一致（即百分比相同），但绝对像素不同
    expect(on1080p.x).toBe(960)
    expect(on1080p.y).toBe(540)
    expect(on1440p.x).toBe(1280)
    expect(on1440p.y).toBe(720)
  })
})
