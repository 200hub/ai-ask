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
    bounds: overrides.bounds ?? { x: 100, y: 100, width: 320, height: 280 },
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

      const newBounds = { x: 200, y: 200, width: 400, height: 350 }
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

      expect(mockInvoke).toHaveBeenCalledWith('ensure_desktop_note_window', {
        payload: { noteId: 'test-note-5', bounds: note.bounds },
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

describe('scaleBoundsForScreen', () => {
  let scaleBoundsForScreen: (typeof import('$lib/stores/desktop-notes.svelte'))['scaleBoundsForScreen']

  beforeEach(async () => {
    ({ scaleBoundsForScreen } = await import('$lib/stores/desktop-notes.svelte'))
  })

  it('should return bounds unchanged when no refScreen dimensions', () => {
    const bounds = { x: 100, y: 100, width: 320, height: 280 }
    const result = scaleBoundsForScreen(bounds)
    expect(result).toEqual(bounds)
  })

  it('should return bounds unchanged when screen size matches ref', () => {
    // 测试环境 screen.width/height 默认由 jsdom 设置（通常 0），
    // 回退到 DEFAULT_SCREEN_WIDTH/HEIGHT = 1920x1080
    const bounds = {
      x: 100,
      y: 100,
      width: 320,
      height: 280,
      refScreenWidth: 1920,
      refScreenHeight: 1080,
    }
    const result = scaleBoundsForScreen(bounds)
    // screen 不可用时回退到默认 1920x1080，与 ref 相同 → 不缩放
    expect(result).toEqual(bounds)
  })

  it('should scale bounds proportionally for different screen size', () => {
    // 模拟从 1920x1080 屏幕保存的 bounds，在 2560x1440 屏幕上还原
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 2560, height: 1440 },
      configurable: true,
    })

    const bounds = {
      x: 960,
      y: 540,
      width: 320,
      height: 280,
      refScreenWidth: 1920,
      refScreenHeight: 1080,
    }
    const result = scaleBoundsForScreen(bounds)

    // scaleX = 2560/1920 ≈ 1.333, scaleY = 1440/1080 ≈ 1.333
    expect(result.x).toBe(Math.round(960 * (2560 / 1920)))
    expect(result.y).toBe(Math.round(540 * (1440 / 1080)))
    expect(result.width).toBe(Math.round(320 * (2560 / 1920)))
    expect(result.height).toBe(Math.round(280 * (1440 / 1080)))
    expect(result.refScreenWidth).toBe(2560)
    expect(result.refScreenHeight).toBe(1440)

    // 清理
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 0, height: 0 },
      configurable: true,
    })
  })

  it('should enforce MIN_WIDTH and MIN_HEIGHT when scaling down', () => {
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 800, height: 600 },
      configurable: true,
    })

    const bounds = {
      x: 100,
      y: 100,
      width: 320,
      height: 280,
      refScreenWidth: 3840,
      refScreenHeight: 2160,
    }
    const result = scaleBoundsForScreen(bounds)

    // scaleX = 800/3840 ≈ 0.208 → width = 320*0.208 ≈ 67 → 应 clamp 到 MIN_WIDTH=240
    expect(result.width).toBeGreaterThanOrEqual(240)
    expect(result.height).toBeGreaterThanOrEqual(180)

    Object.defineProperty(globalThis, 'screen', {
      value: { width: 0, height: 0 },
      configurable: true,
    })
  })

  it('should clamp bounds when note is completely below screen (y > screenHeight)', () => {
    // 模拟问题场景：便签 y=1788 超出 1440 高度的屏幕
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 2560, height: 1440 },
      configurable: true,
    })

    const bounds = {
      x: 2059,
      y: 1788,
      width: 874,
      height: 628,
      refScreenWidth: 2560,
      refScreenHeight: 1440,
    }
    const result = scaleBoundsForScreen(bounds)

    // y 应被约束到屏幕内可见区域（screenH - MIN_VISIBLE_PORTION = 1440 - 80 = 1360）
    expect(result.y).toBeLessThanOrEqual(1440 - 80)
    // x 也应被约束（2059 + 874 > 2560，但 x=2059 < 2560 - 80=2480，所以 x 不需要约束）
    // 但 x=2059 < 2560-80=2480，x 没超出右边界
    expect(result.x).toBeLessThanOrEqual(2560 - 80)
    expect(result.width).toBe(874)
    expect(result.height).toBe(628)

    Object.defineProperty(globalThis, 'screen', {
      value: { width: 0, height: 0 },
      configurable: true,
    })
  })

  it('should clamp bounds when note is off-screen to the right', () => {
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 1920, height: 1080 },
      configurable: true,
    })

    const bounds = {
      x: 1900,
      y: 100,
      width: 320,
      height: 280,
      refScreenWidth: 1920,
      refScreenHeight: 1080,
    }
    const result = scaleBoundsForScreen(bounds)

    // x=1900 > 1920-80=1840 → 应被约束到 1840
    expect(result.x).toBe(1920 - 80)
    expect(result.y).toBe(100)

    Object.defineProperty(globalThis, 'screen', {
      value: { width: 0, height: 0 },
      configurable: true,
    })
  })

  it('should clamp bounds when note is off-screen to the left or top', () => {
    Object.defineProperty(globalThis, 'screen', {
      value: { width: 1920, height: 1080 },
      configurable: true,
    })

    const bounds = {
      x: -400,
      y: -300,
      width: 320,
      height: 280,
      refScreenWidth: 1920,
      refScreenHeight: 1080,
    }
    const result = scaleBoundsForScreen(bounds)

    // x + width = -400 + 320 = -80，等于 minVisible 的负数 → 刚好在边界
    // x + width < 80 → x 应被约束到 80 - 320 = -240
    expect(result.x + result.width).toBeGreaterThanOrEqual(80)
    expect(result.y + result.height).toBeGreaterThanOrEqual(80)

    Object.defineProperty(globalThis, 'screen', {
      value: { width: 0, height: 0 },
      configurable: true,
    })
  })

  it('should clamp bounds for old data without refScreen that is off-screen', () => {
    // 旧数据无 refScreenWidth/refScreenHeight，但位置超出屏幕
    // 默认屏幕回退到 1920x1080
    const bounds = { x: 2000, y: 1200, width: 320, height: 280 }
    const result = scaleBoundsForScreen(bounds)

    // 应被约束到默认屏幕 1920x1080 内
    expect(result.x).toBeLessThanOrEqual(1920 - 80)
    expect(result.y).toBeLessThanOrEqual(1080 - 80)
  })
})
