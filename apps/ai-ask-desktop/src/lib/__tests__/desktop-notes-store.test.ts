import type { DesktopNote, DesktopNotePatch } from '$lib/types/desktop-note'
import { DESKTOP_NOTES } from '$lib/utils/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock 外部依赖
const mockGetDesktopNotes = vi.fn()
const mockSaveDesktopNotePatches = vi.fn()
const mockSaveNoteBounds = vi.fn()
const mockLoadNoteBounds = vi.fn()
const mockDeleteNoteBounds = vi.fn()
const mockInvoke = vi.fn()
const mockPerformFullSync = vi.fn()
const mockWatchDesktopNotes = vi.fn()
const mockCloudSignOut = vi.fn()
const mockGetSessionInfo = vi.fn()
const mockIsCloudSyncAvailable = vi.fn()
const mockSubscribeToChanges = vi.fn()
const mockStopChanges = vi.fn()
const mockConfig = {
  desktopNotesSyncEnabled: true,
  desktopNotesServerUrl: 'https://sync.test',
  desktopNotesEnabled: false,
}

vi.mock('$lib/utils/storage', () => ({
  getDesktopNotes: () => mockGetDesktopNotes(),
  saveDesktopNotePatches: (patches: DesktopNotePatch[]) => mockSaveDesktopNotePatches(patches),
  saveNoteBounds: (...args: unknown[]) => mockSaveNoteBounds(...args),
  loadNoteBounds: (...args: unknown[]) => mockLoadNoteBounds(...args),
  deleteNoteBounds: (...args: unknown[]) => mockDeleteNoteBounds(...args),
  watchDesktopNotes: (...args: unknown[]) => mockWatchDesktopNotes(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('$lib/utils/notes-sync', () => ({
  performFullSync: (...args: unknown[]) => mockPerformFullSync(...args),
  subscribeToChanges: (...args: unknown[]) => mockSubscribeToChanges(...args),
}))

const mockSetDesktopNotesLastSyncedAt = vi.fn()

vi.mock('$lib/stores/config.svelte', () => ({
  configStore: {
    config: mockConfig,
    setDesktopNotesSyncEnabled: async (enabled: boolean) => { mockConfig.desktopNotesSyncEnabled = enabled },
    update: async (updates: Partial<typeof mockConfig>) => { Object.assign(mockConfig, updates) },
    setDesktopNotesLastSyncedAt: (...args: unknown[]) => mockSetDesktopNotesLastSyncedAt(...args),
  },
}))

vi.mock('$lib/utils/cloud-auth', () => ({
  isCloudSyncAvailable: () => mockIsCloudSyncAvailable(),
  normalizeCloudServerUrl: (url: string) => url.replace(/\/+$/, ''),
  getSessionInfo: () => mockGetSessionInfo(),
  onAuthStateChange: vi.fn(),
  signOut: (...args: unknown[]) => mockCloudSignOut(...args),
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

function useStoredNotes(initial: DesktopNote[]) {
  let stored = initial
  mockGetDesktopNotes.mockImplementation(async () => structuredClone(stored))
  mockSaveDesktopNotePatches.mockImplementation(async (patches: DesktopNotePatch[]) => {
    for (const patch of patches) {
      const previous = stored.find(note => note.id === patch.noteId)
      if (patch.ifUnchanged && (previous?.updatedAt ?? null) !== patch.ifUnchanged.updatedAt) {
        continue
      }
      const next = { ...previous, ...patch.updates, sync: { ...previous?.sync, ...patch.updates.sync } } as DesktopNote
      stored = previous ? stored.map(note => note.id === patch.noteId ? next : note) : [...stored, next]
    }
  })
  return () => stored
}

let desktopNotesStore: (typeof import('$lib/stores/desktop-notes.svelte'))['desktopNotesStore']

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  mockGetDesktopNotes.mockReset()
  mockSaveDesktopNotePatches.mockReset()
  mockSaveNoteBounds.mockReset()
  mockLoadNoteBounds.mockReset()
  mockDeleteNoteBounds.mockReset()
  mockInvoke.mockReset()
  mockPerformFullSync.mockReset()
  mockWatchDesktopNotes.mockReset().mockResolvedValue(() => undefined)
  mockCloudSignOut.mockReset().mockResolvedValue(undefined)
  mockGetSessionInfo.mockReset().mockResolvedValue({ authenticated: false, email: null, userId: null })
  mockIsCloudSyncAvailable.mockReset().mockReturnValue(false)
  mockSubscribeToChanges.mockReset().mockReturnValue(mockStopChanges)
  mockStopChanges.mockReset()
  mockConfig.desktopNotesSyncEnabled = true
  mockConfig.desktopNotesServerUrl = 'https://sync.test'
  mockConfig.desktopNotesEnabled = false
  mockSetDesktopNotesLastSyncedAt.mockReset()

  // 默认返回空列表
  mockGetDesktopNotes.mockResolvedValue([])
  mockSaveDesktopNotePatches.mockResolvedValue(undefined)
  mockSaveNoteBounds.mockResolvedValue(undefined)
  mockLoadNoteBounds.mockResolvedValue(null)
  mockDeleteNoteBounds.mockResolvedValue(undefined);

  ({ desktopNotesStore } = await import('$lib/stores/desktop-notes.svelte'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('desktopNotesStore', () => {
  describe('updateNoteBounds', () => {
    it('should propagate geometry save failure and allow the same bounds to be retried', async () => {
      const note = createTestNote({ id: 'retry-bounds' })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      const bounds = { x: 200, y: 220, width: 400, height: 350 }
      mockSaveNoteBounds.mockRejectedValueOnce(new Error('Disk unavailable'))

      await expect(desktopNotesStore.updateNoteBounds(note.id, bounds)).rejects.toThrow('Disk unavailable')
      expect(desktopNotesStore.getNoteById(note.id)?.bounds).toEqual(note.bounds)
      await desktopNotesStore.updateNoteBounds(note.id, bounds)
      expect(mockSaveNoteBounds).toHaveBeenCalledTimes(2)
      expect(desktopNotesStore.getNoteById(note.id)?.bounds).toEqual(bounds)
    })

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

    it('should ignore absurd offscreen bounds and keep last good geometry', async () => {
      const note = createTestNote({
        id: 'test-note-invalid-bounds',
        bounds: { x: 320, y: 240, width: 360, height: 280 },
        sync: { dirty: false, lastSyncedAt: 1000 },
      })
      mockGetDesktopNotes.mockResolvedValue([note])

      await desktopNotesStore.init()
      await desktopNotesStore.updateNoteBounds('test-note-invalid-bounds', {
        x: -21333,
        y: -21333,
        width: 240,
        height: 180,
      })

      const updated = desktopNotesStore.getNoteById('test-note-invalid-bounds')
      expect(updated).not.toBeNull()
      expect(updated!.bounds).toEqual({ x: 320, y: 240, width: 360, height: 280 })
      expect(mockSaveNoteBounds).not.toHaveBeenCalled()
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
    it('keeps the window state and reports native close failures', async () => {
      const note = createTestNote({ id: 'close-failed', visible: true })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      mockInvoke.mockRejectedValueOnce(new Error('Native close unavailable'))

      await expect(desktopNotesStore.closeNoteWindow(note.id)).rejects.toThrow('Native close unavailable')

      expect(desktopNotesStore.getNoteById(note.id)?.visible).toBe(true)
      expect(mockSaveDesktopNotePatches).not.toHaveBeenCalled()
    })

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
    it('does not open a note hidden while its device geometry was loading', async () => {
      const note = createTestNote({ id: 'late-hidden', visible: true })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      let finishBounds!: (bounds: null) => void
      mockLoadNoteBounds.mockReturnValueOnce(new Promise((resolve) => {
        finishBounds = resolve
      }))
      const opening = desktopNotesStore.openNoteWindow(note.id)
      await desktopNotesStore.markNoteHiddenLocally(note.id)
      finishBounds(null)
      await opening

      expect(mockInvoke).not.toHaveBeenCalled()
      expect(desktopNotesStore.getNoteById(note.id)?.visible).toBe(false)
    })

    it('does not create an editor when exit begins while loading geometry', async () => {
      const note = createTestNote({ id: 'exiting-note' })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      let finishBounds!: (bounds: null) => void
      mockLoadNoteBounds.mockReturnValueOnce(new Promise((resolve) => {
        finishBounds = resolve
      }))
      const opening = desktopNotesStore.openNoteWindow(note.id)
      desktopNotesStore.suspendCloudActivity()
      finishBounds(null)
      await opening

      expect(mockInvoke).not.toHaveBeenCalled()
    })

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
    it('should drain edits made while a native write is still pending', async () => {
      const note = createTestNote({ id: 'drain-note', content: 'original' })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      let finishWrite!: () => void
      const firstWrite = new Promise<void>((resolve) => {
        finishWrite = resolve
      })
      mockSaveDesktopNotePatches.mockReturnValueOnce(firstWrite)

      await desktopNotesStore.updateNoteContent(note.id, 'first edit')
      const flushing = desktopNotesStore.flushPersistPublic()
      await Promise.resolve()
      await desktopNotesStore.updateNoteContent(note.id, 'last edit before exit')
      finishWrite()
      await flushing

      expect(mockSaveDesktopNotePatches).toHaveBeenCalledTimes(2)
      expect(mockSaveDesktopNotePatches.mock.calls[1][0]).toEqual([
        expect.objectContaining({ noteId: note.id, updates: expect.objectContaining({ content: 'last edit before exit' }) }),
      ])
    })

    it('should retain the latest patch when a write fails and is retried', async () => {
      const note = createTestNote({ id: 'retry-note' })
      mockGetDesktopNotes.mockResolvedValue([note])
      await desktopNotesStore.init()
      let rejectWrite!: (error: Error) => void
      const firstWrite = new Promise<void>((_resolve, reject) => {
        rejectWrite = reject
      })
      mockSaveDesktopNotePatches.mockReturnValueOnce(firstWrite)

      await desktopNotesStore.updateNoteContent(note.id, 'first edit')
      const flushing = desktopNotesStore.flushPersistPublic()
      const failure = expect(flushing).rejects.toThrow('Disk unavailable')
      await Promise.resolve()
      await desktopNotesStore.updateNoteContent(note.id, 'latest edit')
      rejectWrite(new Error('Disk unavailable'))
      await failure
      await desktopNotesStore.flushPersistPublic()

      expect(mockSaveDesktopNotePatches.mock.calls[1][0][0].updates.content).toBe('latest edit')
    })

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
      mockSaveDesktopNotePatches.mockClear()

      await desktopNotesStore.flushPersistPublic()

      expect(mockSaveDesktopNotePatches).not.toHaveBeenCalled()
    })
  })

  describe('concurrent reads and synchronization', () => {
    it('does not mark a failed storage read as an initialized empty notebook', async () => {
      mockGetDesktopNotes.mockRejectedValueOnce(new Error('Read unavailable'))

      await expect(desktopNotesStore.init()).rejects.toThrow('Read unavailable')

      expect(desktopNotesStore.initialized).toBe(false)
    })

    it('recognizes a zero timestamp as a deletion tombstone', async () => {
      mockGetDesktopNotes.mockResolvedValue([createTestNote({ id: 'zero-tombstone', deletedAt: 0 })])
      await desktopNotesStore.init()

      expect(desktopNotesStore.activeNotes).toEqual([])
      await desktopNotesStore.openNoteWindow('zero-tombstone')
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('should finish a captured session refresh before replacing login credentials', async () => {
      mockIsCloudSyncAvailable.mockReturnValue(true)
      let finishRefresh!: (session: { authenticated: boolean, userId: string, email: string }) => void
      mockGetSessionInfo.mockReturnValue(new Promise((resolve) => {
        finishRefresh = resolve
      }))
      const cloudAuth = await import('$lib/utils/cloud-auth')
      const signIn = vi.mocked(cloudAuth.signInWithEmail).mockResolvedValue({ authenticated: true, userId: 'user-b', email: 'b@example.com' })

      const refreshing = desktopNotesStore.refreshSession()
      await vi.waitFor(() => expect(mockGetSessionInfo).toHaveBeenCalledTimes(1))
      const loggingIn = desktopNotesStore.signIn('b@example.com', 'password')
      expect(signIn).not.toHaveBeenCalled()
      finishRefresh({ authenticated: true, userId: 'user-a', email: 'a@example.com' })
      await refreshing
      await loggingIn

      expect(desktopNotesStore.session.userId).toBe('user-b')
    })

    it('should queue refresh requests behind an in-flight logout', async () => {
      mockIsCloudSyncAvailable.mockReturnValue(true)
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      let finishLogout!: () => void
      mockCloudSignOut.mockReturnValue(new Promise<void>((resolve) => {
        finishLogout = resolve
      }))

      const loggingOut = desktopNotesStore.signOut()
      await vi.waitFor(() => expect(mockCloudSignOut).toHaveBeenCalledTimes(1))
      const refreshing = desktopNotesStore.refreshSession()
      expect(mockGetSessionInfo).not.toHaveBeenCalled()
      finishLogout()
      await loggingOut
      await refreshing

      expect(mockGetSessionInfo).toHaveBeenCalledTimes(1)
      expect(desktopNotesStore.session.authenticated).toBe(false)
    })

    it('should preserve an edit persisted after a refresh started reading', async () => {
      const original = createTestNote({ id: 'reading-note', content: 'original', updatedAt: 1000 })
      mockGetDesktopNotes.mockResolvedValue([original])
      await desktopNotesStore.init()
      let finishRead!: (notes: DesktopNote[]) => void
      const read = new Promise<DesktopNote[]>((resolve) => {
        finishRead = resolve
      })
      mockGetDesktopNotes.mockReturnValueOnce(read)
      const refreshing = desktopNotesStore.init(true)
      await Promise.resolve()
      await desktopNotesStore.updateNoteContent(original.id, 'saved while reading')
      await desktopNotesStore.flushPersistPublic()
      finishRead([original])
      await refreshing

      expect(desktopNotesStore.getNoteById(original.id)?.content).toBe('saved while reading')
    })

    it('should serialize sync requests and keep syncing true until the queue drains', async () => {
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()
      interface SyncResponse { notes: DesktopNote[], result: { pushed: number, pulled: number, syncedAt: number } }
      let finishFirst!: (response: SyncResponse) => void
      let finishSecond!: (response: SyncResponse) => void
      const first = new Promise<SyncResponse>((resolve) => {
        finishFirst = resolve
      })
      const second = new Promise<SyncResponse>((resolve) => {
        finishSecond = resolve
      })
      mockPerformFullSync.mockReturnValueOnce(first).mockReturnValueOnce(second)

      const syncingFirst = desktopNotesStore.syncWithCloud()
      const syncingSecond = desktopNotesStore.syncWithCloud()
      await vi.waitFor(() => expect(mockPerformFullSync).toHaveBeenCalledTimes(1))
      finishFirst({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })
      await syncingFirst
      expect(desktopNotesStore.syncing).toBe(true)
      await vi.waitFor(() => expect(mockPerformFullSync).toHaveBeenCalledTimes(2))
      finishSecond({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 2000 } })
      await syncingSecond
      expect(desktopNotesStore.syncing).toBe(false)
    })

    it('should apply an older remote deletion without reviving a newer local active note', async () => {
      const original = createTestNote({ id: 'deleted-remote', updatedAt: 9000 })
      const stored = useStoredNotes([original])
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()
      mockPerformFullSync.mockImplementation(async (notes: DesktopNote[]) => ({
        notes: notes.map(note => ({ ...note, deletedAt: 2000, updatedAt: 2000, visible: false, sync: { dirty: false, lastSyncedAt: 3000 } })),
        result: { pushed: 0, pulled: 1, syncedAt: 3000 },
      }))

      await desktopNotesStore.syncWithCloud()

      expect(stored()[0].deletedAt).toBe(2000)
      expect(desktopNotesStore.getNoteById(original.id)?.deletedAt).toBe(2000)
      expect(desktopNotesStore.activeNotes).toHaveLength(0)
    })

    it('should persist edits made during synchronization before applying a stale response', async () => {
      const original = createTestNote({ id: 'edit-during-sync', content: 'original', updatedAt: 1000 })
      const stored = useStoredNotes([original])
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()
      mockPerformFullSync.mockImplementation(async (notes: DesktopNote[]) => {
        await desktopNotesStore.updateNoteContent(original.id, 'new edit')
        return {
          notes: notes.map(note => ({ ...note, sync: { ...note.sync, dirty: false, lastSyncedAt: 3000 } })),
          result: { pushed: 1, pulled: 0, syncedAt: 3000 },
        }
      })

      await desktopNotesStore.syncWithCloud()

      expect(stored()[0].content).toBe('new edit')
      expect(stored()[0].sync.dirty).toBe(true)
      expect(desktopNotesStore.getNoteById(original.id)?.content).toBe('new edit')
    })
  })

  describe('automatic synchronization', () => {
    it('restores saved credentials when enabling sync after an offline launch with sync disabled', async () => {
      mockConfig.desktopNotesSyncEnabled = false
      mockIsCloudSyncAvailable.mockReturnValue(true)
      mockGetSessionInfo.mockResolvedValue({ authenticated: true, userId: 'user-a', email: 'a@example.com' })
      mockPerformFullSync.mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })

      await desktopNotesStore.setSyncEnabled(true)
      await vi.advanceTimersByTimeAsync(DESKTOP_NOTES.SYNC_DEBOUNCE_MS)

      expect(mockGetSessionInfo).toHaveBeenCalledOnce()
      expect(mockSubscribeToChanges).toHaveBeenCalledOnce()
      expect(mockPerformFullSync).toHaveBeenCalledOnce()
    })

    it('recovers an existing session after the server was temporarily unavailable at startup', async () => {
      mockIsCloudSyncAvailable.mockReturnValue(true)
      mockGetSessionInfo.mockRejectedValueOnce(new Error('Server temporarily unavailable'))
        .mockResolvedValue({ authenticated: true, userId: 'user-a', email: 'a@example.com' })
      mockPerformFullSync.mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })

      await desktopNotesStore.refreshSession()
      expect(desktopNotesStore.session.authenticated).toBe(false)
      expect(mockSubscribeToChanges).toHaveBeenCalledOnce()
      mockSubscribeToChanges.mock.calls[0][0]()
      await vi.waitFor(() => expect(mockPerformFullSync).toHaveBeenCalledOnce())

      expect(desktopNotesStore.session.userId).toBe('user-a')
    })

    it('starts cloud observation and synchronization when an authenticated account enables sync', async () => {
      mockConfig.desktopNotesSyncEnabled = false
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      mockPerformFullSync.mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })

      await desktopNotesStore.setSyncEnabled(true)
      expect(mockSubscribeToChanges).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
      expect(mockPerformFullSync).toHaveBeenCalledOnce()
      await desktopNotesStore.setSyncEnabled(false)
      expect(mockStopChanges).toHaveBeenCalledOnce()
      mockSubscribeToChanges.mock.calls[0][0]()
      await vi.advanceTimersByTimeAsync(DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
      expect(mockPerformFullSync).toHaveBeenCalledOnce()
    })

    it('keeps observing changes and retries after the first cloud request fails', async () => {
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      mockPerformFullSync.mockRejectedValueOnce(new Error('Server temporarily unavailable'))
        .mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })

      await desktopNotesStore.setSyncEnabled(true)
      await vi.advanceTimersByTimeAsync(DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
      expect(desktopNotesStore.lastAutoSyncStatus).toBe('error')
      expect(mockStopChanges).not.toHaveBeenCalled()
      mockSubscribeToChanges.mock.calls[0][0]()
      await vi.waitFor(() => expect(desktopNotesStore.lastAutoSyncStatus).toBe('success'))

      expect(mockPerformFullSync).toHaveBeenCalledTimes(2)
    })

    it('coalesces repeated change notifications while a slow request is in progress', async () => {
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      let finish!: (response: { notes: DesktopNote[], result: { pushed: number, pulled: number, syncedAt: number } }) => void
      mockPerformFullSync.mockReturnValueOnce(new Promise((resolve) => {
        finish = resolve
      })).mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })

      await desktopNotesStore.setSyncEnabled(true)
      await vi.advanceTimersByTimeAsync(DESKTOP_NOTES.SYNC_DEBOUNCE_MS)
      const changed = mockSubscribeToChanges.mock.calls[0][0]
      changed()
      changed()
      changed()
      expect(mockPerformFullSync).toHaveBeenCalledOnce()
      finish({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })
      await vi.waitFor(() => expect(mockPerformFullSync).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(desktopNotesStore.syncing).toBe(false))

      expect(mockPerformFullSync).toHaveBeenCalledTimes(2)
    })

    it('does not start previously queued requests after synchronization is disabled', async () => {
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      let finish!: (response: { notes: DesktopNote[], result: { pushed: number, pulled: number, syncedAt: number } }) => void
      mockPerformFullSync.mockReturnValueOnce(new Promise((resolve) => {
        finish = resolve
      }))
      const first = desktopNotesStore.syncWithCloud()
      await vi.waitFor(() => expect(mockPerformFullSync).toHaveBeenCalledOnce())
      const queued = desktopNotesStore.syncWithCloud()
      const rejected = expect(queued).rejects.toThrow('Cloud synchronization is disabled')
      const disabling = desktopNotesStore.setSyncEnabled(false)
      await Promise.resolve()
      finish({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 1000 } })
      await Promise.all([first, rejected, disabling])

      expect(mockPerformFullSync).toHaveBeenCalledOnce()
    })
  })

  describe('signOut', () => {
    it('claims local notes immediately after login even when cloud sync is disabled', async () => {
      mockConfig.desktopNotesSyncEnabled = false
      const stored = useStoredNotes([createTestNote({ id: 'account-before-first-sync' })])
      const cloudAuth = await import('$lib/utils/cloud-auth')
      vi.mocked(cloudAuth.signInWithEmail).mockResolvedValue({ authenticated: true, userId: 'user-a', email: 'a@example.com' })

      await desktopNotesStore.signIn('a@example.com', 'password')

      expect(stored()[0].sync.ownerId).toBe('https://sync.test#user-a')
      expect(mockPerformFullSync).not.toHaveBeenCalled()
    })

    it('should claim historical clean notes and deletion tombstones for migration to Hai', async () => {
      const stored = useStoredNotes([
        createTestNote({ id: 'legacy-clean', sync: { dirty: false, lastSyncedAt: 1000 } }),
        createTestNote({ id: 'legacy-deleted', updatedAt: 2000, deletedAt: 2000, sync: { dirty: false, lastSyncedAt: 1000 } }),
      ])
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()

      await desktopNotesStore.signOut()

      expect(stored().every(note => note.sync.ownerId === 'https://sync.test#user-a' && note.sync.dirty && note.sync.lastSyncedAt === null)).toBe(true)
      expect(mockSaveDesktopNotePatches.mock.calls[0][0]).toContainEqual({
        noteId: 'legacy-deleted',
        updates: { sync: { ownerId: 'https://sync.test#user-a', dirty: true, lastSyncedAt: null } },
        ifUnchanged: { updatedAt: 2000 },
      })
    })

    it('should retain local account ownership after sign-out and never push A notes as B', async () => {
      const stored = useStoredNotes([createTestNote({ id: 'a-note' })])
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()

      await desktopNotesStore.signOut()
      expect(stored()[0].sync.ownerId).toBe('https://sync.test#user-a')
      desktopNotesStore.session = { authenticated: true, userId: 'user-b', email: 'b@example.com' }
      mockPerformFullSync.mockResolvedValue({ notes: [], result: { pushed: 0, pulled: 0, syncedAt: 3000 } })
      await desktopNotesStore.syncWithCloud()

      expect(mockPerformFullSync.mock.calls[0][0]).toEqual([])
      expect(stored()).toHaveLength(1)
      expect(stored()[0].sync.ownerId).toBe('https://sync.test#user-a')
    })

    it('should keep the session when local account ownership cannot be saved', async () => {
      mockGetDesktopNotes.mockResolvedValue([createTestNote({ id: 'unsaved-a-note' })])
      desktopNotesStore.session = { authenticated: true, userId: 'user-a', email: 'a@example.com' }
      await desktopNotesStore.init()
      mockSaveDesktopNotePatches.mockRejectedValueOnce(new Error('Disk unavailable'))

      await expect(desktopNotesStore.signOut()).rejects.toThrow('Disk unavailable')

      expect(mockCloudSignOut).not.toHaveBeenCalled()
      expect(desktopNotesStore.session.userId).toBe('user-a')
    })

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
