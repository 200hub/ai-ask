import type { DesktopNote } from '$lib/types/desktop-note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock 外部依赖
const mockGetDesktopNotes = vi.fn()
const mockSaveDesktopNotes = vi.fn()
const mockSaveNoteBounds = vi.fn()
const mockLoadNoteBounds = vi.fn()
const mockDeleteNoteBounds = vi.fn()
const mockInvoke = vi.fn()

vi.mock('$lib/utils/storage', () => ({
  getDesktopNotes: () => mockGetDesktopNotes(),
  saveDesktopNotes: (notes: DesktopNote[]) => mockSaveDesktopNotes(notes),
  saveNoteBounds: (...args: unknown[]) => mockSaveNoteBounds(...args),
  loadNoteBounds: (...args: unknown[]) => mockLoadNoteBounds(...args),
  deleteNoteBounds: (...args: unknown[]) => mockDeleteNoteBounds(...args),
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
    bounds: overrides.bounds ?? { x: 96, y: 97, width: 326, height: 281 },
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
  mockSaveNoteBounds.mockReset()
  mockLoadNoteBounds.mockReset()
  mockDeleteNoteBounds.mockReset()
  mockInvoke.mockReset()
  mockSetDesktopNotesLastSyncedAt.mockReset()

  // 默认返回空列表
  mockGetDesktopNotes.mockResolvedValue([])
  mockSaveDesktopNotes.mockResolvedValue(undefined)
  mockSaveNoteBounds.mockResolvedValue(undefined)
  mockLoadNoteBounds.mockResolvedValue(null)
  mockDeleteNoteBounds.mockResolvedValue(undefined);

  ({ desktopNotesStore } = await import('$lib/stores/desktop-notes.svelte'))
})

describe('desktopNotesStore', () => {
  describe('updateNoteBounds', () => {
    it('should keep bounds update local-only without marking dirty', async () => {
      const note = createTestNote({
        id: 'test-note-1',
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()

      const newBounds = { x: 192, y: 194, width: 403, height: 356 }
      await desktopNotesStore.updateNoteBounds('test-note-1', newBounds)

      const updated = desktopNotesStore.getNoteById('test-note-1')
      expect(updated).not.toBeNull()
      expect(updated!.bounds).toEqual(newBounds)
      // bounds 变更为设备本地状态，不应触发云同步 dirty
      expect(updated!.sync.dirty).toBe(false)
      // 应使用 per-note key 写入（不做 read-modify-write），避免多窗口竞态
      expect(mockSaveNoteBounds).toHaveBeenCalledWith('test-note-1', newBounds)
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

    it('should not write full notes array when no pending changes', async () => {
      // 回归保护：主窗口在 app-before-exit 调用 flushPersistPublic 时，
      // 如果 pendingNoteIds 为空，绝不能用陈旧内存快照覆盖磁盘上
      // 其他窗口（便签窗口）刚写入的 visible=false。
      const note = createTestNote({ id: 'regression-note', visible: true })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()
      mockSaveDesktopNotes.mockClear()

      await desktopNotesStore.flushPersistPublic()

      expect(mockSaveDesktopNotes).not.toHaveBeenCalled()
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
