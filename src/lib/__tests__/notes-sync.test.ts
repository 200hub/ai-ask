/**
 * notes-sync.ts 单元测试
 *
 * 覆盖：
 * - mergeRemoteIntoLocal: LWW 合并策略
 * - pushDirtyNotes: 推送脏数据 (mocked Supabase)
 * - pullRemoteChanges: 拉取远端变更 (mocked Supabase)
 * - performFullSync: 完整同步流程
 * - verifySchema: Schema 验证
 */
import type { DesktopNote, DesktopNoteRow } from '$lib/types/desktop-note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Supabase 客户端
const mockSelect = vi.fn()
const mockUpsert = vi.fn()
const mockEq = vi.fn()
const mockGt = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockFrom = vi.fn()

const mockClient = {
  from: mockFrom,
  channel: vi.fn(),
  removeChannel: vi.fn(),
}

const mockAuth = {
  getSession: vi.fn(),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ ...mockClient, auth: mockAuth })),
}))

vi.mock('$lib/utils/supabase', () => ({
  getSupabaseClient: () => ({ ...mockClient, auth: mockAuth }),
  getCurrentUser: vi.fn(),
}))

vi.mock('$lib/utils/constants', () => ({
  DESKTOP_NOTES: {
    DEFAULT_OFFSET_X: 100,
    DEFAULT_OFFSET_Y: 100,
    DEFAULT_WIDTH: 320,
    DEFAULT_HEIGHT: 280,
    DEFAULT_SCREEN_WIDTH: 1920,
    DEFAULT_SCREEN_HEIGHT: 1080,
    MAX_NOTES_PER_SYNC: 50,
  },
  SUPABASE: {
    URL: 'https://test-project.supabase.co',
    ANON_KEY: 'test-anon-key-1234567890',
    NOTES_TABLE: 'desktop_notes',
  },
}))

vi.mock('$lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// 创建测试用本地便签
function createLocalNote(overrides: Partial<DesktopNote> = {}): DesktopNote {
  const now = Date.now()
  return {
    id: overrides.id ?? 'note-1',
    title: overrides.title ?? 'Test Note',
    content: overrides.content ?? 'Hello',
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

let syncModule: typeof import('$lib/utils/notes-sync')
let mockGetCurrentUser: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  mockFrom.mockReset()
  mockSelect.mockReset()
  mockUpsert.mockReset()
  mockEq.mockReset()
  mockGt.mockReset()
  mockOrder.mockReset()
  mockLimit.mockReset()

  syncModule = await import('$lib/utils/notes-sync')

  // 获取 mocked getCurrentUser
  const supabaseMock = await import('$lib/utils/supabase')
  mockGetCurrentUser = supabaseMock.getCurrentUser as ReturnType<typeof vi.fn>
  mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'test@example.com' })
})

describe('mergeRemoteIntoLocal', () => {
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
      x: 100,
      y: 100,
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

  it('should prefer remote when preferRemote is true', () => {
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

    const merged = syncModule.mergeRemoteIntoLocal(localNotes, remoteRows, { preferRemote: true })
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('remote active')
    expect(merged[0].deletedAt).toBeNull()
  })
})

describe('pushDirtyNotes', () => {
  it('should return 0 when no dirty notes', async () => {
    const notes = [
      createLocalNote({ id: 'clean', sync: { dirty: false, lastSyncedAt: 1000 } }),
    ]

    const result = await syncModule.pushDirtyNotes(notes)
    expect(result).toBe(0)
    // 不应调用 supabase
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('should push dirty notes via upsert', async () => {
    mockFrom.mockReturnValue({
      upsert: mockUpsert.mockResolvedValue({ error: null }),
    })

    const notes = [
      createLocalNote({ id: 'dirty-1', sync: { dirty: true, lastSyncedAt: null } }),
      createLocalNote({ id: 'clean-1', sync: { dirty: false, lastSyncedAt: 1000 } }),
    ]

    const result = await syncModule.pushDirtyNotes(notes)

    expect(result).toBe(1)
    expect(mockFrom).toHaveBeenCalledWith('desktop_notes')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dirty-1',
          user_id: 'user-1',
          bounds: { visible: true },
        }),
      ]),
      { onConflict: 'user_id,id' },
    )
  })

  it('should throw when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(
      syncModule.pushDirtyNotes([createLocalNote({ sync: { dirty: true, lastSyncedAt: null } })]),
    ).rejects.toThrow('Not authenticated')
  })

  it('should throw on upsert error', async () => {
    mockFrom.mockReturnValue({
      upsert: mockUpsert.mockResolvedValue({ error: { message: 'DB error' } }),
    })

    await expect(
      syncModule.pushDirtyNotes([
        createLocalNote({ sync: { dirty: true, lastSyncedAt: null } }),
      ]),
    ).rejects.toThrow('Push failed: DB error')
  })
})

describe('pullRemoteChanges', () => {
  it('should pull all notes on first sync (null lastSyncedAt)', async () => {
    const mockRows = [createRemoteRow({ id: 'r-1' })]

    // 构建链式调用 mock
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockRows, error: null }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.pullRemoteChanges(null)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('r-1')
    expect(queryChain.select).toHaveBeenCalledWith('*')
    expect(queryChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('should pull only changes after lastSyncedAt', async () => {
    const mockRows = [createRemoteRow({ id: 'r-2' })]

    // order 返回一个带 gt 方法的 chainable 对象
    // 当有 lastSyncedAt 时，gt 被调用后最终 resolve
    const mockGtLocal = vi.fn().mockResolvedValue({ data: mockRows, error: null })
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({
        gt: mockGtLocal,
        then: undefined,
      }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.pullRemoteChanges(5000)

    expect(result).toHaveLength(1)
    expect(mockGtLocal).toHaveBeenCalledWith('updated_at', 5000)
  })

  it('should still apply gt filter when lastSyncedAt is 0', async () => {
    const mockRows = [createRemoteRow({ id: 'r-0' })]
    const mockGtLocal = vi.fn().mockResolvedValue({ data: mockRows, error: null })
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({
        gt: mockGtLocal,
        then: undefined,
      }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.pullRemoteChanges(0)

    expect(result).toHaveLength(1)
    expect(mockGtLocal).toHaveBeenCalledWith('updated_at', 0)
  })

  it('should throw when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(
      syncModule.pullRemoteChanges(null),
    ).rejects.toThrow('Not authenticated')
  })

  it('should throw on query error', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'table not found' } }),
    }
    mockFrom.mockReturnValue(queryChain)

    await expect(
      syncModule.pullRemoteChanges(null),
    ).rejects.toThrow('Pull failed: table not found')
  })

  it('should return empty array when no data', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.pullRemoteChanges(null)
    expect(result).toEqual([])
  })
})

describe('performFullSync', () => {
  it('should push dirty, pull remote, and merge', async () => {
    // Push: 1 dirty note
    const pushChain = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }

    // Pull: 1 remote note
    const remoteRow = createRemoteRow({ id: 'remote-only', updated_at: Date.now() + 1000 })
    const pullChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [remoteRow], error: null }),
    }

    // 交替返回 push 和 pull 的 mock
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      return callCount === 1 ? pushChain : pullChain
    })

    const localNotes = [
      createLocalNote({ id: 'local-dirty', sync: { dirty: true, lastSyncedAt: null } }),
    ]

    const { notes, result } = await syncModule.performFullSync(localNotes, null)

    // 应包含本地 + 远端便签
    expect(notes.length).toBeGreaterThanOrEqual(1)
    expect(result.pushed).toBe(1)
    expect(result.pulled).toBe(1)
    expect(result.syncedAt).toBeGreaterThan(0)
  })

  it('should prefer remote on full sync when lastSyncedAt is null', async () => {
    const pushChain = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }

    const remoteRow = createRemoteRow({
      id: 'note-1',
      content: 'remote active',
      deleted_at: null,
      updated_at: 1000,
    })
    const pullChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [remoteRow], error: null }),
    }

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      return callCount === 1 ? pushChain : pullChain
    })

    const localNotes = [
      createLocalNote({
        id: 'note-1',
        content: 'local stale deleted',
        deletedAt: Date.now(),
        updatedAt: Date.now() + 999999,
        sync: { dirty: true, lastSyncedAt: null },
      }),
    ]

    const { notes } = await syncModule.performFullSync(localNotes, null)

    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('remote active')
    expect(notes[0].deletedAt).toBeNull()
  })

  it('should use fullPull to ignore lastSyncedAt and preferRemote from options', async () => {
    const remoteRow = createRemoteRow({
      id: 'note-1',
      content: 'remote updated',
      bounds: { x: 576, y: 324, width: 768, height: 432 },
      updated_at: 500, // 远端比本地旧，但 preferRemote=true 时仍覆盖
    })

    // 本地便签无 dirty → push 不调用 from；只有 pull 调用 from
    const pullChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [remoteRow], error: null }),
    }
    mockFrom.mockReturnValue(pullChain)

    const localNotes = [
      createLocalNote({
        id: 'note-1',
        content: 'local version',
        bounds: { x: 96, y: 97, width: 326, height: 281 },
        updatedAt: 2000,
        sync: { dirty: false, lastSyncedAt: 1000 },
      }),
    ]

    // 使用 fullPull + preferRemote 选项（模拟启动时同步）
    const { notes } = await syncModule.performFullSync(localNotes, 1000, {
      preferRemote: true,
      fullPull: true,
    })

    expect(notes).toHaveLength(1)
    // preferRemote=true → 远端数据覆盖本地（即使本地 updatedAt 更大）
    expect(notes[0].content).toBe('remote updated')
    // bounds 应保留本地版本（位置不跨设备同步）
    expect(notes[0].bounds.x).toBe(96)
    // fullPull 时 pullSince 为 null → 不应有 gt 过滤
    expect(pullChain.order).toHaveBeenCalled()
  })
})

describe('verifySchema', () => {
  it('should return true when table exists', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.verifySchema()
    expect(result).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('desktop_notes')
  })

  it('should return false when table does not exist', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: { message: 'relation does not exist' } }),
    }
    mockFrom.mockReturnValue(queryChain)

    const result = await syncModule.verifySchema()
    expect(result).toBe(false)
  })

  it('should return false when client throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Client not initialized')
    })

    const result = await syncModule.verifySchema()
    expect(result).toBe(false)
  })
})
