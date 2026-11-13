import type { DesktopNoteTodo } from '$lib/utils/desktop-note-todo'
import { parseDesktopNoteTodos, serializeDesktopNoteTodos } from '$lib/utils/desktop-note-todo'
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
})
