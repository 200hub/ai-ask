/**
 * Sticky Note 模块端到端集成测试
 *
 * 覆盖便签功能清单的核心场景：创建、编辑、颜色切换、关闭、删除、
 * 恢复、几何持久化、多屏切换、云同步开关等。
 *
 * 使用 vitest + jsdom 环境下的纯 JS 模拟，不依赖真实 Tauri 运行时。
 */
import type { DesktopNote } from '$lib/types/desktop-note'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ==================== Mock 外部依赖 ====================

const mockGetDesktopNotes = vi.fn()
const mockSaveDesktopNotes = vi.fn()
const mockSaveNoteBounds = vi.fn()
const mockLoadNoteBounds = vi.fn()
const mockDeleteNoteBounds = vi.fn()
const mockInvoke = vi.fn()
const mockSetDesktopNotesLastSyncedAt = vi.fn()

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

vi.mock('$lib/stores/config.svelte', () => ({
  configStore: {
    config: {
      desktopNotesSyncEnabled: false,
      desktopNotesLastSyncedAt: null,
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

vi.mock('$lib/utils/notes-sync', () => ({
  mergeRemoteIntoLocal: vi.fn(notes => notes),
  performFullSync: vi.fn(),
  subscribeToRealtime: vi.fn(() => () => undefined),
  verifySchema: vi.fn().mockResolvedValue(true),
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

type DesktopNotesStore = (typeof import('$lib/stores/desktop-notes.svelte'))['desktopNotesStore']
let desktopNotesStore: DesktopNotesStore

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

  mockGetDesktopNotes.mockResolvedValue([])
  mockSaveDesktopNotes.mockResolvedValue(undefined)
  mockSaveNoteBounds.mockResolvedValue(undefined)
  mockLoadNoteBounds.mockResolvedValue(null)
  mockDeleteNoteBounds.mockResolvedValue(undefined)
  mockInvoke.mockResolvedValue(undefined);

  ({ desktopNotesStore } = await import('$lib/stores/desktop-notes.svelte'))
})

// ==================== 场景 1：创建便签 ====================

describe('sticky note e2e - 创建便签', () => {
  it('点击"新建"应生成可见的便签并写入持久化', async () => {
    await desktopNotesStore.init()
    const note = await desktopNotesStore.createNote()

    expect(note.id).toBeTruthy()
    expect(note.visible).toBe(true)
    expect(note.deletedAt).toBeNull()
    expect(desktopNotesStore.activeNotes).toHaveLength(1)
    expect(mockSaveDesktopNotes).toHaveBeenCalled()
  })

  it('新建便签后立即打开窗口（主窗口路径）', async () => {
    await desktopNotesStore.init()
    const note = await desktopNotesStore.createNote()

    await desktopNotesStore.openNoteWindow(note.id)
    expect(mockInvoke).toHaveBeenCalledWith(
      'ensure_desktop_note_window',
      expect.objectContaining({
        payload: expect.objectContaining({
          noteId: note.id,
        }),
      }),
    )
  })
})

// ==================== 场景 2-3：编辑内容 & Markdown 渲染 ====================

describe('sticky note e2e - 编辑内容', () => {
  it('更新内容应标记 dirty 并持久化', async () => {
    const note = createTestNote({ id: 'n-edit', content: '' })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.updateNoteContent('n-edit', '# hello world')

    const updated = desktopNotesStore.getNoteById('n-edit')
    expect(updated!.content).toBe('# hello world')
    expect(updated!.sync.dirty).toBe(true)
  })

  it('markdown 渲染应输出 HTML（纯函数）', async () => {
    const { renderDesktopNoteMarkdown } = await import('$lib/utils/desktop-note-markdown')
    const html = renderDesktopNoteMarkdown('**bold**')
    expect(html).toContain('<strong>')
  })
})

// ==================== 场景 4-5：拖拽 & 调整大小 ====================

describe('sticky note e2e - 几何持久化', () => {
  it('updateNoteBounds 仅本地持久化，不标记 dirty，不触发云同步', async () => {
    const note = createTestNote({
      id: 'n-bounds',
      sync: { dirty: false, lastSyncedAt: 123 },
    })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    const newBounds = {
      leftPercent: 0.3,
      topPercent: 0.4,
      rightPercent: 0.6,
      bottomPercent: 0.7,
    }
    await desktopNotesStore.updateNoteBounds('n-bounds', newBounds)

    const updated = desktopNotesStore.getNoteById('n-bounds')
    expect(updated!.bounds.leftPercent).toBe(0.3)
    // 关键：dirty 不应被置为 true
    expect(updated!.sync.dirty).toBe(false)
    expect(updated!.sync.lastSyncedAt).toBe(123)
    // 应调用 per-note key 写入，避免多窗口并发竞态
    expect(mockSaveNoteBounds).toHaveBeenCalledWith('n-bounds', newBounds)
  })

  it('init() 应将 per-note bounds 合并覆盖 notes 数组中的旧 bounds', async () => {
    const oldBounds = { leftPercent: 0.05, topPercent: 0.09, rightPercent: 0.22, bottomPercent: 0.35 }
    const savedBounds = { leftPercent: 0.1, topPercent: 0.2, rightPercent: 0.4, bottomPercent: 0.6 }
    const note = createTestNote({ id: 'n-merge', bounds: oldBounds })
    mockGetDesktopNotes.mockResolvedValue([note])
    // 模拟该便签的 per-note bounds 已被写入（如上次移动保存）
    mockLoadNoteBounds.mockResolvedValue(savedBounds)
    await desktopNotesStore.init()

    const loaded = desktopNotesStore.getNoteById('n-merge')
    // init() 应以 per-note key 中的最新 bounds 覆盖 notes 数组中的旧 bounds
    expect(loaded!.bounds).toEqual(savedBounds)
  })

  it('pixelsToBounds 对屏幕外的无效坐标应自修为合法矩形', async () => {
    const { pixelsToBounds } = await import('$lib/stores/desktop-notes.svelte')
    const bounds = pixelsToBounds(2600, 1400, 10, 10, 1920, 1080)

    expect(bounds.leftPercent).toBeGreaterThanOrEqual(0)
    expect(bounds.leftPercent).toBeLessThanOrEqual(1)
    expect(bounds.rightPercent).toBeGreaterThan(bounds.leftPercent)
    expect(bounds.bottomPercent).toBeGreaterThan(bounds.topPercent)
  })
})

// ==================== 场景 6：颜色切换 ====================

describe('sticky note e2e - 颜色切换', () => {
  it('updateNoteColor 应标记 dirty 以触发云同步', async () => {
    const note = createTestNote({
      id: 'n-color',
      color: 'sunny',
      sync: { dirty: false, lastSyncedAt: 111 },
    })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.updateNoteColor('n-color', 'mint')

    const updated = desktopNotesStore.getNoteById('n-color')
    expect(updated!.color).toBe('mint')
    expect(updated!.sync.dirty).toBe(true)
  })
})

// ==================== 场景 7：关闭窗口 ====================

describe('sticky note e2e - 关闭窗口', () => {
  it('closeNoteWindow 应调用 Rust 命令并同步标记 visible=false', async () => {
    const note = createTestNote({ id: 'n-close', visible: true })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.closeNoteWindow('n-close')

    expect(mockInvoke).toHaveBeenCalledWith('close_desktop_note_window', {
      payload: { noteId: 'n-close' },
    })
    const updated = desktopNotesStore.getNoteById('n-close')
    expect(updated!.visible).toBe(false)
    expect(updated!.sync.dirty).toBe(true)
  })

  it('markNoteHiddenLocally 仅本地标记，不调用 Rust 命令', async () => {
    const note = createTestNote({ id: 'n-hide', visible: true })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    mockInvoke.mockClear()
    await desktopNotesStore.markNoteHiddenLocally('n-hide')

    expect(mockInvoke).not.toHaveBeenCalled()
    const updated = desktopNotesStore.getNoteById('n-hide')
    expect(updated!.visible).toBe(false)
    expect(updated!.sync.dirty).toBe(true)
  })

  it('markNoteHiddenLocally 对已经不可见的便签应无操作（幂等）', async () => {
    const note = createTestNote({
      id: 'n-already-hidden',
      visible: false,
      sync: { dirty: false, lastSyncedAt: 999 },
    })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.markNoteHiddenLocally('n-already-hidden')

    const updated = desktopNotesStore.getNoteById('n-already-hidden')
    expect(updated!.visible).toBe(false)
    // 不应因幂等调用而重新标记 dirty
    expect(updated!.sync.dirty).toBe(false)
  })

  it('closeNoteWindow 在 Rust 命令失败时仍应标记本地 visible=false', async () => {
    const note = createTestNote({ id: 'n-close-err', visible: true })
    mockGetDesktopNotes.mockResolvedValue([note])
    mockInvoke.mockRejectedValueOnce(new Error('window not found'))
    await desktopNotesStore.init()

    await desktopNotesStore.closeNoteWindow('n-close-err')

    const updated = desktopNotesStore.getNoteById('n-close-err')
    expect(updated!.visible).toBe(false)
  })
})

// ==================== 场景 8：软删除 ====================

describe('sticky note e2e - 软删除', () => {
  it('deleteNote 应关闭窗口 + 打软删除戳 + 标记 dirty', async () => {
    const note = createTestNote({ id: 'n-del', visible: true })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.deleteNote('n-del')

    const deleted = desktopNotesStore.getNoteById('n-del')
    expect(deleted!.deletedAt).toBeGreaterThan(0)
    expect(deleted!.visible).toBe(false)
    expect(deleted!.sync.dirty).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('close_desktop_note_window', expect.any(Object))
  })
})

// ==================== 场景 9：恢复窗口 ====================

describe('sticky note e2e - 恢复窗口', () => {
  it('restoreVisibleWindows 仅恢复 visible=true 且未删除的便签', async () => {
    const notes = [
      createTestNote({ id: 'v1', visible: true }),
      createTestNote({ id: 'h1', visible: false }),
      createTestNote({
        id: 'd1',
        visible: true,
        deletedAt: Date.now(),
        sync: { dirty: false, lastSyncedAt: null },
      }),
    ]
    mockGetDesktopNotes.mockResolvedValue(notes)
    await desktopNotesStore.init()

    mockInvoke.mockClear()
    await desktopNotesStore.restoreVisibleWindows()

    // 只应对 v1 调用 ensure_desktop_note_window
    const ensureCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === 'ensure_desktop_note_window',
    )
    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0][1]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ noteId: 'v1' }),
      }),
    )
  })

  it('openNoteWindow 对 visible=false 的便签应自动重置为 visible=true 并标记 dirty', async () => {
    const note = createTestNote({
      id: 'n-reopen',
      visible: false,
      sync: { dirty: false, lastSyncedAt: 1 },
    })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.openNoteWindow('n-reopen')

    const updated = desktopNotesStore.getNoteById('n-reopen')
    expect(updated!.visible).toBe(true)
    expect(updated!.sync.dirty).toBe(true)
  })
})

// ==================== 场景 10：应用退出前落盘 ====================

describe('sticky note e2e - 退出前落盘', () => {
  it('flushPersistPublic 应将待持久化项写入存储', async () => {
    const note = createTestNote({ id: 'n-flush' })
    mockGetDesktopNotes.mockResolvedValue([note])
    await desktopNotesStore.init()

    await desktopNotesStore.updateNoteContent('n-flush', 'pending change')
    mockSaveDesktopNotes.mockClear()

    await desktopNotesStore.flushPersistPublic()

    expect(mockSaveDesktopNotes).toHaveBeenCalled()
    const saved = mockSaveDesktopNotes.mock.calls[0][0] as DesktopNote[]
    expect(saved.find(n => n.id === 'n-flush')?.content).toBe('pending change')
  })
})

// ==================== 场景 11：全部隐藏（设置页开关） ====================

describe('sticky note e2e - hideAllWindows', () => {
  it('hideAllWindows 应对所有可见便签触发关闭流程', async () => {
    const notes = [
      createTestNote({ id: 'v1', visible: true }),
      createTestNote({ id: 'v2', visible: true }),
      createTestNote({ id: 'h1', visible: false }),
    ]
    mockGetDesktopNotes.mockResolvedValue(notes)
    await desktopNotesStore.init()

    mockInvoke.mockClear()
    await desktopNotesStore.hideAllWindows()

    const closeCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === 'close_desktop_note_window',
    )
    expect(closeCalls).toHaveLength(2)
    const ids = closeCalls.map(c => (c[1] as { payload: { noteId: string } }).payload.noteId)
    expect(ids.sort()).toEqual(['v1', 'v2'])

    // 本地 visible 状态也应全部置为 false
    expect(desktopNotesStore.getNoteById('v1')!.visible).toBe(false)
    expect(desktopNotesStore.getNoteById('v2')!.visible).toBe(false)
  })
})

// ==================== 场景 14：数据自修复 ====================

describe('sticky note e2e - 数据修复', () => {
  it('pixelsToBounds 对退化矩形 (right<=left) 应扩展为最小宽度', async () => {
    const { pixelsToBounds } = await import('$lib/stores/desktop-notes.svelte')
    // 放到屏幕最右端且宽度极小
    const bounds = pixelsToBounds(1918, 100, 1, 1, 1920, 1080)
    expect(bounds.rightPercent).toBeGreaterThan(bounds.leftPercent)
    expect(bounds.bottomPercent).toBeGreaterThan(bounds.topPercent)
  })

  it('boundsToPixels 对超屏 bounds 应 clamp 后输出合法尺寸', async () => {
    const { boundsToPixels } = await import('$lib/stores/desktop-notes.svelte')
    const result = boundsToPixels(
      { leftPercent: -0.5, topPercent: -0.5, rightPercent: 1.5, bottomPercent: 1.5 },
      1920,
      1080,
    )
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.width).toBeLessThanOrEqual(1920)
    expect(result.height).toBeLessThanOrEqual(1080)
  })
})

// ==================== 场景 15：打开时位置权威来源 ====================

describe('sticky note e2e - openNoteWindow 位置来源', () => {
  it('openNoteWindow 必须优先使用 per-note key 中的最新 bounds，忽略内存中陈旧值', async () => {
    // 模拟场景：主窗口内存中 bounds 是陈旧值（例如启动时的初值），
    // 用户之前通过便签窗口拖拽后保存到 per-note key，此时主窗口重新 open 必须使用最新值。
    const staleBounds = { leftPercent: 0.05, topPercent: 0.05, rightPercent: 0.25, bottomPercent: 0.35 }
    const freshBounds = { leftPercent: 0.5, topPercent: 0.5, rightPercent: 0.8, bottomPercent: 0.9 }
    const note = createTestNote({ id: 'n-source', bounds: staleBounds })
    mockGetDesktopNotes.mockResolvedValue([note])
    // 关键：init 时尚未保存 fresh，init 后才 saveNoteBounds；模拟为 loadNoteBounds 第二次返回 fresh
    mockLoadNoteBounds.mockResolvedValueOnce(null) // init
    mockLoadNoteBounds.mockResolvedValueOnce(freshBounds) // openNoteWindow
    await desktopNotesStore.init()

    await desktopNotesStore.openNoteWindow('n-source')

    const ensureCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'ensure_desktop_note_window')
    expect(ensureCall).toBeDefined()
    const payload = (ensureCall![1] as { payload: { bounds: { x: number, y: number } } }).payload
    // 使用 fresh bounds 中的 leftPercent=0.5 在 1920 屏幕上应该在 x>=800（不是陈旧的 x~=96）
    expect(payload.bounds.x).toBeGreaterThan(500)
  })

  it('openNoteWindow 在 per-note key 为空时回退使用内存 bounds', async () => {
    const memBounds = { leftPercent: 0.3, topPercent: 0.3, rightPercent: 0.6, bottomPercent: 0.7 }
    const note = createTestNote({ id: 'n-fallback', bounds: memBounds })
    mockGetDesktopNotes.mockResolvedValue([note])
    mockLoadNoteBounds.mockResolvedValue(null) // per-note key 始终为空
    await desktopNotesStore.init()

    await desktopNotesStore.openNoteWindow('n-fallback')

    const ensureCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'ensure_desktop_note_window')
    expect(ensureCall).toBeDefined()
    const payload = (ensureCall![1] as { payload: { bounds: { x: number, y: number, width: number, height: number } } }).payload
    // 0.3 * 1920 ≈ 576
    expect(payload.bounds.x).toBeGreaterThan(400)
    expect(payload.bounds.width).toBeGreaterThan(100)
  })

  it('openNoteWindow 在内存 bounds 也无效时使用默认 bounds，不定位到 (0,0,0,0)', async () => {
    // 构造全零无效 bounds
    const zeroBounds = { leftPercent: 0, topPercent: 0, rightPercent: 0, bottomPercent: 0 }
    const note = createTestNote({ id: 'n-zero', bounds: zeroBounds })
    mockGetDesktopNotes.mockResolvedValue([note])
    mockLoadNoteBounds.mockResolvedValue(null)
    await desktopNotesStore.init()

    await desktopNotesStore.openNoteWindow('n-zero')

    const ensureCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'ensure_desktop_note_window')
    expect(ensureCall).toBeDefined()
    const payload = (ensureCall![1] as { payload: { bounds: { x: number, y: number, width: number, height: number } } }).payload
    // 默认 bounds 应该产生合理宽高（至少 MIN_WIDTH/MIN_HEIGHT），且位置不是 (0,0)
    expect(payload.bounds.width).toBeGreaterThanOrEqual(100)
    expect(payload.bounds.height).toBeGreaterThanOrEqual(100)
  })
})
