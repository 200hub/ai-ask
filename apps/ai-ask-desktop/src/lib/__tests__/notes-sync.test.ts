import type { DesktopNote, DesktopNoteRow } from '$lib/types/desktop-note'
import * as syncModule from '$lib/utils/notes-sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { list, push, getCurrentUser } = vi.hoisted(() => ({ list: vi.fn(), push: vi.fn(), getCurrentUser: vi.fn() }))
vi.mock('$lib/utils/cloud-auth', () => ({
  getCloudConnection: async () => {
    const user = await getCurrentUser()
    if (!user)
      throw new Error('Not authenticated')
    return { client: { notes: { list, push } }, userId: user.id }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUser.mockResolvedValue({ id: 'user-1' })
  list.mockResolvedValue({ success: true, data: [] })
  push.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => vi.useRealTimers())

function createLocalNote(overrides: Partial<DesktopNote> = {}): DesktopNote {
  const now = Date.now()
  return {
    id: overrides.id ?? 'note-1',
    title: overrides.title ?? 'Test Note',
    content: overrides.content ?? 'Hello',
    kind: overrides.kind,
    color: overrides.color ?? 'sunny',
    visible: overrides.visible ?? true,
    bounds: overrides.bounds ?? { x: 96, y: 97, width: 326, height: 281 },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
    sync: overrides.sync ?? { dirty: false, lastSyncedAt: null },
  }
}

// 创建测试用远端行
function createRemoteRow(overrides: Partial<DesktopNoteRow> = {}): DesktopNoteRow {
  const now = Date.now()
  return {
    id: overrides.id ?? 'note-1',
    user_id: overrides.user_id ?? 'user-1',
    title: overrides.title ?? 'Remote Note',
    content: overrides.content ?? 'Remote Content',
    color: overrides.color ?? 'mint',
    bounds: overrides.bounds ?? { x: 192, y: 194, width: 403, height: 356 },
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    deleted_at: overrides.deleted_at ?? null,
  }
}

describe('mergeRemoteIntoLocal', () => {
  it('reads the to-do kind from remote metadata while retaining device position', () => {
    const bounds = { x: 20, y: 40, width: 320, height: 280, monitor: 'DISPLAY2' }
    const local = createLocalNote({ bounds, updatedAt: 1000 })
    const remote = createRemoteRow({ bounds: { visible: true, kind: 'todo' }, content: '- [x] Done', updated_at: 2000 })

    expect(syncModule.mergeRemoteIntoLocal([local], [remote])[0]).toMatchObject({
      kind: 'todo',
      content: '- [x] Done',
      bounds,
    })
  })

  it('should add new remote notes to local', () => {
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'local-1', updatedAt: 1000 }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({ id: 'remote-1', updated_at: 2000 }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)

    expect(merged).toHaveLength(2)
    expect(merged.find(n => n.id === 'local-1')).toBeTruthy()
    expect(merged.find(n => n.id === 'remote-1')).toBeTruthy()
  })

  it('should overwrite local with newer remote', () => {
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'note-1', content: 'old local', updatedAt: 1000, visible: true }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({ id: 'note-1', content: 'new remote', updated_at: 2000 }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)

    expect(merged).toHaveLength(1)
    const note = merged[0]
    expect(note.content).toBe('new remote')
    // 保留本地 visible 状态
    expect(note.visible).toBe(true)
    // 同步后 dirty 应为 false
    expect(note.sync.dirty).toBe(false)
  })

  it('should keep local when local is newer', () => {
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'note-1', content: 'new local', updatedAt: 3000 }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({ id: 'note-1', content: 'old remote', updated_at: 1000 }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)

    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('new local')
  })

  it('should keep local when timestamps are equal', () => {
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'note-1', content: 'local version', updatedAt: 1000 }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({ id: 'note-1', content: 'remote version', updated_at: 1000 }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)

    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('local version')
  })

  it('should preserve local bounds when remote overwrites', () => {
    const localBounds = { x: 58, y: 54, width: 403, height: 302 }
    const remoteBoundsData = { x: 960, y: 540, width: 240, height: 180 }
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'note-1', bounds: localBounds, updatedAt: 1000 }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({
        id: 'note-1',
        bounds: remoteBoundsData,
        updated_at: 2000,
      }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)
    // 远端较新时仍保留本地 bounds（位置按设备本地保存）
    expect(merged[0].bounds).toEqual(localBounds)
  })

  it('should use default local bounds for new notes when no local', () => {
    const remoteBounds = { x: 499, y: 497, width: 595, height: 400 }

    const merged = syncModule.mergeRemoteIntoLocal([], [
      createRemoteRow({ id: 'new-note', bounds: remoteBounds }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].bounds).toEqual({
      x: 120,
      y: 120,
      width: 320,
      height: 280,
    })
  })

  it('should handle merged soft-deleted notes', () => {
    const deletedAt = Date.now()
    const localNotes: DesktopNote[] = [
      createLocalNote({ id: 'note-1', updatedAt: 1000 }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({ id: 'note-1', deleted_at: deletedAt, updated_at: 2000 }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)
    expect(merged[0].deletedAt).toBe(deletedAt)
  })

  it('should handle empty inputs', () => {
    expect(syncModule.mergeRemoteIntoLocal([], [])).toEqual([])
  })

  it('should handle multiple remote rows', () => {
    const merged = syncModule.mergeRemoteIntoLocal([], [
      createRemoteRow({ id: 'a' }),
      createRemoteRow({ id: 'b' }),
      createRemoteRow({ id: 'c' }),
    ])

    expect(merged).toHaveLength(3)
  })

  it('should preserve local deletion when the remote row is still active', () => {
    const localNotes: DesktopNote[] = [
      createLocalNote({
        id: 'note-1',
        content: 'local stale',
        deletedAt: Date.now(),
        updatedAt: 999999,
      }),
    ]

    const remoteRows: DesktopNoteRow[] = [
      createRemoteRow({
        id: 'note-1',
        content: 'remote active',
        deleted_at: null,
        updated_at: 1000,
      }),
    ]

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows)
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('local stale')
    expect(merged[0].deletedAt).not.toBeNull()
  })

  it('should preserve a pending edit over an older remote row during recovery', () => {
    const local = createLocalNote({ content: 'offline edit', updatedAt: 3000, sync: { dirty: true, lastSyncedAt: 1000 } })
    const remote = createRemoteRow({ content: 'old cloud version', updated_at: 2000 })

    expect(syncModule.mergeRemoteIntoLocal([local], [remote])[0]).toBe(local)
  })

  it('should accept a remote deletion despite a fast local device clock', () => {
    const local = createLocalNote({ updatedAt: 9000, sync: { dirty: true, lastSyncedAt: 1000 } })
    const remote = createRemoteRow({ deleted_at: 2000, updated_at: 2000 })

    expect(syncModule.mergeRemoteIntoLocal([local], [remote])[0].deletedAt).toBe(2000)
  })
})

describe('hai notes transport', () => {
  it('uploads only dirty content, kind and visibility without device geometry', async () => {
    const note = createLocalNote({ kind: 'todo', sync: { dirty: true, lastSyncedAt: null } })
    expect((await syncModule.performFullSync([note, createLocalNote({ id: 'clean' })], 'user-1')).result.pushed).toBe(1)
    expect(push).toHaveBeenCalledWith({ notes: [expect.objectContaining({
      id: note.id,
      user_id: 'user-1',
      bounds: { visible: true, kind: 'todo' },
    })] })
  })

  it('batches large queues', async () => {
    const notes = Array.from({ length: 205 }, (_, index) => createLocalNote({ id: String(index), sync: { dirty: true, lastSyncedAt: null } }))
    expect((await syncModule.performFullSync(notes, 'user-1')).result.pushed).toBe(205)
    expect(push.mock.calls.map(call => call[0].notes.length)).toEqual([100, 100, 5])
  })

  it('requires authentication', async () => {
    getCurrentUser.mockResolvedValue(null)
    await expect(syncModule.performFullSync([], 'user-1')).rejects.toThrow('Not authenticated')
    expect(push).not.toHaveBeenCalled()
  })

  it('propagates pull failure and never pushes a stale local version', async () => {
    list.mockResolvedValue({ success: false, error: { message: 'Offline' } })
    await expect(syncModule.performFullSync([createLocalNote()], 'user-1')).rejects.toThrow('Offline')
    expect(push).not.toHaveBeenCalled()
  })

  it('does not clear pending writes after push fails', async () => {
    push.mockResolvedValue({ success: false, error: { message: 'Timeout' } })
    const local = createLocalNote({ sync: { dirty: true, lastSyncedAt: null } })
    await expect(syncModule.performFullSync([local], 'user-1')).rejects.toThrow('Timeout')
    expect(local.sync.dirty).toBe(true)
  })

  it('pulls before push and keeps the remote newer version', async () => {
    list.mockResolvedValue({ success: true, data: [createRemoteRow({ updated_at: 3000 })] })
    const result = await syncModule.performFullSync([createLocalNote({ updatedAt: 1000, sync: { dirty: true, lastSyncedAt: null } })], 'user-1')
    expect(result.notes[0].content).toBe('Remote Content')
    expect(push).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith({})
  })

  it('uses server final version when another device wins during push', async () => {
    push.mockResolvedValue({ success: true, data: [createRemoteRow({ content: 'concurrent device', updated_at: 4000 })] })
    const result = await syncModule.performFullSync([createLocalNote({ updatedAt: 2000, sync: { dirty: true, lastSyncedAt: null } })], 'user-1')
    expect(result.notes[0].content).toBe('concurrent device')
    expect(result.notes[0].sync.dirty).toBe(false)
  })

  it('accepts permanent tombstones returned during push despite clock skew', async () => {
    push.mockResolvedValue({ success: true, data: [createRemoteRow({ deleted_at: 1000, updated_at: 1000 })] })
    const result = await syncModule.performFullSync([createLocalNote({ updatedAt: 9000, sync: { dirty: true, lastSyncedAt: null } })], 'user-1')
    expect(result.notes[0].deletedAt).toBe(1000)
  })

  it('rejects a different credential identity before reading or pushing scoped notes', async () => {
    getCurrentUser.mockResolvedValue({ id: 'another-user' })
    const note = createLocalNote({ sync: { dirty: true, lastSyncedAt: null, ownerId: 'server#original-user' } })
    await expect(syncModule.performFullSync([note], 'original-user')).rejects.toThrow('Cloud identity changed')
    expect(list).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(note.sync.dirty).toBe(true)
  })

  it('cleans polling and reconnect listeners', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const stop = syncModule.subscribeToChanges(onChange)
    vi.advanceTimersByTime(15000)
    window.dispatchEvent(new Event('online'))
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(30000)
    window.dispatchEvent(new Event('online'))
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
