import type { DesktopNoteTodo } from '$lib/utils/desktop-note-todo'
import { DESKTOP_NOTE_TODO_MAX_DEPTH } from '$lib/utils/constants'
import {
  canInsertDesktopNoteSubtask,
  getDesktopNoteTodoParentIndex,
  getDesktopNoteTodoSiblingIndex,
  getVisibleDesktopNoteTodos,
  insertDesktopNoteSubtask,
  moveDesktopNoteTodo,
  normalizeDesktopNoteTodoPreferences,
  parseDesktopNoteTodos,
  removeDesktopNoteTodo,
  serializeDesktopNoteTodos,
} from '$lib/utils/desktop-note-todo'
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'

describe('desktop note to-do content', () => {
  it('round-trips completion and literal text in the existing content field', () => {
    const items = [
      { text: '查看 **草稿**', completed: false },
      { text: '发送 [附件] <备忘>', completed: true },
      { text: '', completed: false },
    ]
    const content = serializeDesktopNoteTodos(items)
    expect(content).toBe('- [ ] 查看 **草稿**\n- [x] 发送 [附件] <备忘>\n- [ ] ')
    expect(parseDesktopNoteTodos(content)).toEqual(items)
  })

  it('supports Windows newlines and keeps pasted text on one task row', () => {
    expect(parseDesktopNoteTodos('- [X] Done\r\n- [ ] Pending')).toEqual([
      { text: 'Done', completed: true },
      { text: 'Pending', completed: false },
    ])
    expect(serializeDesktopNoteTodos([{ text: 'first\r\nsecond', completed: false }])).toBe('- [ ] first second')
    expect(parseDesktopNoteTodos('')).toEqual([])
  })

  it('keeps optional priority and deadline associated with the preceding task', () => {
    const items: DesktopNoteTodo[] = [
      { text: '回访', completed: true, priority: 'high', deadline: '2028-02-29' },
      { text: '确认日程', completed: false, deadline: '2026-11-20' },
      { text: '归档', completed: false, priority: 'low' },
      { text: '普通待办', completed: false },
    ]
    const content = serializeDesktopNoteTodos(items)
    expect(content).toContain('- [x] 回访\n<!-- ai-ask:todo {"priority":"high","deadline":"2028-02-29"} -->')
    expect(parseDesktopNoteTodos(content.replaceAll('\n', '\r\n'))).toEqual(items)
  })

  it('preserves legacy task text that looks like metadata and ignores malformed metadata', () => {
    const content = [
      '- [ ] 原样显示 <!-- ai-ask:todo {"priority":"high"} -->',
      '<!-- ai-ask:todo {"priority":"urgent","deadline":"2026-02-29"} -->',
      '- [ ] 保留任务',
      '<!-- ai-ask:todo invalid-json -->',
      '- [ ] 有优先级',
      '<!-- ai-ask:todo {"priority":"normal","deadline":"0000-01-01"} -->',
    ].join('\n')
    expect(parseDesktopNoteTodos(content)).toEqual([
      { text: '原样显示 <!-- ai-ask:todo {"priority":"high"} -->', completed: false },
      { text: '保留任务', completed: false },
      { text: '有优先级', completed: false, priority: 'normal' },
    ])
  })

  it('omits cleared metadata and rejects non-calendar dates on write', () => {
    expect(serializeDesktopNoteTodos([{ text: '完成清理', completed: true, deadline: '2026-04-31' }]))
      .toBe('- [x] 完成清理')
    expect(serializeDesktopNoteTodos([{ text: '确认', completed: false, priority: undefined, deadline: undefined }]))
      .toBe('- [ ] 确认')
  })

  it('keeps each level and metadata as a real nested Markdown checklist', () => {
    const items: DesktopNoteTodo[] = [
      { text: 'Parent', completed: true, priority: 'high', deadline: '2026-12-01' },
      { text: 'Child', completed: false, depth: 1, deadline: '2026-12-02' },
      { text: 'Grandchild', completed: true, depth: 2, priority: 'low' },
      { text: 'Other child', completed: false, depth: 1 },
      { text: 'Another parent', completed: false, priority: 'normal' },
    ]
    const content = serializeDesktopNoteTodos(items)
    expect(content).toContain('\n  - [ ] Child\n    <!-- ai-ask:todo {"deadline":"2026-12-02"} -->\n    - [x] Grandchild')
    expect(parseDesktopNoteTodos(content.replaceAll('\n', '\r\n'))).toEqual(items)
    const preview = document.createElement('div')
    preview.innerHTML = marked.parse(content)
    expect(preview.querySelector('ul > li > ul > li > ul > li')?.textContent?.trim()).toBe('Grandchild')
    expect(preview.querySelectorAll(':scope > ul > li')).toHaveLength(2)
  })

  it('accepts legacy comments next to nested input and keeps every task when indent exceeds the UI limit', () => {
    const content = [
      '- [ ] Parent',
      '<!-- ai-ask:todo {"priority":"normal"} -->',
      '    - [ ] Four spaces',
      '    <!-- ai-ask:todo {"priority":"high"} -->',
      '\t\t\t- [x] Tabs',
      ...Array.from({ length: DESKTOP_NOTE_TODO_MAX_DEPTH }, (_, index) => `${' '.repeat(10 + 2 * index)}- [ ] Task ${index}`),
    ].join('\n')
    const items = parseDesktopNoteTodos(content)
    expect(items.slice(0, 3)).toEqual([
      { text: 'Parent', completed: false, priority: 'normal' },
      { text: 'Four spaces', completed: false, depth: 1, priority: 'high' },
      { text: 'Tabs', completed: true, depth: 2 },
    ])
    expect(items).toHaveLength(3 + DESKTOP_NOTE_TODO_MAX_DEPTH)
    expect(items.at(-1)?.depth).toBe(DESKTOP_NOTE_TODO_MAX_DEPTH)
    expect(parseDesktopNoteTodos(serializeDesktopNoteTodos(items))).toEqual(items)
  })
})

describe('desktop note to-do list preferences', () => {
  const items: (DesktopNoteTodo & { id: string })[] = [
    { id: 'no-metadata', text: '无设置', completed: false },
    { id: 'normal', text: '重复事项', completed: false, priority: 'normal', deadline: '2027-01-01' },
    { id: 'completed', text: '已完成事项', completed: true, priority: 'high', deadline: '2026-01-01' },
    { id: 'low', text: '低优先级', completed: false, priority: 'low', deadline: '2026-12-31' },
    { id: 'high', text: '重复事项', completed: false, priority: 'high', deadline: '2027-01-01' },
    { id: 'no-metadata-2', text: '另一个无设置事项', completed: false },
  ]

  it('defaults to manual order and showing completed tasks, validating stored fields independently', () => {
    expect(normalizeDesktopNoteTodoPreferences(null)).toEqual({ hideCompleted: false, sort: 'manual' })
    expect(normalizeDesktopNoteTodoPreferences({ sort: 'unknown', hideCompleted: true }))
      .toEqual({ hideCompleted: true, sort: 'manual' })
    expect(normalizeDesktopNoteTodoPreferences({ sort: 'deadline', hideCompleted: 'true' }))
      .toEqual({ hideCompleted: false, sort: 'deadline' })
    expect(getVisibleDesktopNoteTodos(items)).toEqual(items.map((item, index) => ({ item, index, depth: 0 })))
  })

  it('filters completed items while retaining the original indices for editing', () => {
    const visible = getVisibleDesktopNoteTodos(items, { hideCompleted: true, sort: 'manual' })
    expect(visible.map(({ index }) => index)).toEqual([0, 1, 3, 4, 5])
    expect(visible[3].item).toBe(items[4])
    expect(getVisibleDesktopNoteTodos([items[2]], { hideCompleted: true, sort: 'manual' })).toEqual([])
  })

  it('sorts high to low with unspecified priority last and ties in manual order', () => {
    const visible = getVisibleDesktopNoteTodos(items, { hideCompleted: false, sort: 'priority' })
    expect(visible.map(({ index }) => index)).toEqual([2, 4, 1, 3, 0, 5])
    expect(items.map(item => item.id)).toEqual(['no-metadata', 'normal', 'completed', 'low', 'high', 'no-metadata-2'])
  })

  it('sorts deadlines chronologically with empty dates last and equal dates in manual order', () => {
    const visible = getVisibleDesktopNoteTodos(items, { hideCompleted: true, sort: 'deadline' })
    expect(visible.map(({ index }) => index)).toEqual([3, 1, 4, 0, 5])
    expect(getVisibleDesktopNoteTodos([], { hideCompleted: true, sort: 'deadline' })).toEqual([])
  })
})

describe('desktop note to-do hierarchies', () => {
  const items: (DesktopNoteTodo & { id: number })[] = [
    { id: 0, text: 'Completed parent', completed: true, priority: 'low' },
    { id: 1, text: 'Child due later', completed: false, depth: 1, deadline: '2026-11-29' },
    { id: 2, text: 'Grandchild', completed: false, depth: 2, priority: 'high' },
    { id: 3, text: 'Child due sooner', completed: false, depth: 1, deadline: '2026-11-20' },
    { id: 4, text: 'Entirely completed parent', completed: true, priority: 'normal' },
    { id: 5, text: 'Completed child', completed: true, depth: 1 },
    { id: 6, text: 'Other parent', completed: false, priority: 'high' },
    { id: 7, text: 'Other child', completed: false, depth: 1, deadline: '2026-11-15' },
  ]

  it('filters completed branches and retains ancestors and source indices for open descendants', () => {
    const visible = getVisibleDesktopNoteTodos(items, { hideCompleted: true, sort: 'manual' })
    expect(visible.map(({ index, depth }) => [index, depth])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 1],
      [6, 0],
      [7, 1],
    ])
    expect(getVisibleDesktopNoteTodos([
      { ...items[0] },
      { ...items[1], completed: true },
      items[2],
    ], { hideCompleted: true, sort: 'manual' }).map(({ index }) => index)).toEqual([0, 1, 2])
  })

  it('sorts only siblings and keeps their subtrees and original item references', () => {
    const byPriority = getVisibleDesktopNoteTodos(items, { hideCompleted: true, sort: 'priority' })
    expect(byPriority.map(({ index }) => index)).toEqual([6, 7, 0, 1, 2, 3])
    const byDeadline = getVisibleDesktopNoteTodos(items, { hideCompleted: true, sort: 'deadline' })
    expect(byDeadline.map(({ index }) => index)).toEqual([0, 3, 1, 2, 6, 7])
    expect(byDeadline[3].item).toBe(items[2])
  })

  it('moves and deletes entire subtrees while rejecting moves across parents', () => {
    expect(moveDesktopNoteTodo(items, 0, 6, 'after').map(({ id }) => id)).toEqual([4, 5, 6, 7, 0, 1, 2, 3])
    expect(moveDesktopNoteTodo(items, 1, 3, 'after').map(({ id }) => id)).toEqual([0, 3, 1, 2, 4, 5, 6, 7])
    expect(moveDesktopNoteTodo(items, 3, 1, 'before').map(({ id }) => id)).toEqual([0, 3, 1, 2, 4, 5, 6, 7])
    expect(moveDesktopNoteTodo(items, 1, 7, 'after')).toBe(items)
    expect(moveDesktopNoteTodo(items, 0, 2, 'before')).toBe(items)
    expect(removeDesktopNoteTodo(items, 0).map(({ id }) => id)).toEqual([4, 5, 6, 7])
    expect(removeDesktopNoteTodo(items, 1).map(({ id }) => id)).toEqual([0, 3, 4, 5, 6, 7])
    expect(removeDesktopNoteTodo(items, -1)).toBe(items)
  })

  it('finds the parent and siblings past descendants without crossing a parent boundary', () => {
    expect(getDesktopNoteTodoParentIndex(items, 2)).toBe(1)
    expect(getDesktopNoteTodoParentIndex(items, 3)).toBe(0)
    expect(getDesktopNoteTodoParentIndex(items, 6)).toBeNull()
    expect(getDesktopNoteTodoSiblingIndex(items, 1, 'next')).toBe(3)
    expect(getDesktopNoteTodoSiblingIndex(items, 3, 'previous')).toBe(1)
    expect(getDesktopNoteTodoSiblingIndex(items, 3, 'next')).toBeNull()
    expect(getDesktopNoteTodoSiblingIndex(items, 5, 'previous')).toBeNull()
  })

  it('inserts after the parent subtree and limits new nesting', () => {
    const child = { id: 8, text: 'New child', completed: false, priority: 'high' } as const
    const next = insertDesktopNoteSubtask(items, 0, child)
    expect(next.map(({ id }) => id)).toEqual([0, 1, 2, 3, 8, 4, 5, 6, 7])
    expect(next[4]).toEqual({ ...child, depth: 1 })
    expect(insertDesktopNoteSubtask(items, 1, child)[3].depth).toBe(2)
    expect(insertDesktopNoteSubtask(items, -1, child)).toBe(items)
    const deepest = [...items, { ...child, depth: DESKTOP_NOTE_TODO_MAX_DEPTH }]
    expect(canInsertDesktopNoteSubtask(deepest, deepest.length - 1)).toBe(false)
    expect(insertDesktopNoteSubtask(deepest, deepest.length - 1, child)).toBe(deepest)
  })
})

describe('desktop note to-do list manual order', () => {
  const items = [
    { id: 0, text: '重复事项', completed: false },
    { id: 1, text: '隐藏事项一', completed: true },
    { id: 2, text: '重复事项', completed: false },
    { id: 3, text: '隐藏事项二', completed: true },
    { id: 4, text: '最后一项', completed: false },
  ]

  it('moves down after a visible target while preserving the relative order of hidden rows', () => {
    const result = moveDesktopNoteTodo(items, 0, 4, 'after')
    expect(result.map(({ id }) => id)).toEqual([1, 2, 3, 4, 0])
    expect(getVisibleDesktopNoteTodos(result, { hideCompleted: true, sort: 'manual' }).map(({ item }) => item.id))
      .toEqual([2, 4, 0])
    expect(result[4]).toBe(items[0])
    expect(items.map(({ id }) => id)).toEqual([0, 1, 2, 3, 4])
  })

  it('moves up before a visible target, including to the beginning', () => {
    expect(moveDesktopNoteTodo(items, 4, 0, 'before').map(({ id }) => id)).toEqual([4, 0, 1, 2, 3])
    expect(moveDesktopNoteTodo(items, 4, 2, 'after').map(({ id }) => id)).toEqual([0, 1, 2, 4, 3])
    expect(moveDesktopNoteTodo(items, 0, 2, 'before').map(({ id }) => id)).toEqual([1, 0, 2, 3, 4])
  })

  it('returns the same array for unchanged or invalid moves', () => {
    expect(moveDesktopNoteTodo(items, 0, 0, 'before')).toBe(items)
    expect(moveDesktopNoteTodo(items, 0, 1, 'before')).toBe(items)
    expect(moveDesktopNoteTodo(items, 1, 0, 'after')).toBe(items)
    expect(moveDesktopNoteTodo(items, 10, 1, 'before')).toBe(items)
    expect(moveDesktopNoteTodo(items, 1, 10, 'after')).toBe(items)
  })
})
