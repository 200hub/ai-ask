import {
  DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
  DESKTOP_NOTE_TODO_INDENT_SIZE,
  DESKTOP_NOTE_TODO_MAX_DEPTH,
  DESKTOP_NOTE_TODO_METADATA_PREFIX,
  DESKTOP_NOTE_TODO_METADATA_SUFFIX,
  DESKTOP_NOTE_TODO_PRIORITIES,
  DESKTOP_NOTE_TODO_SORT_MODES,
} from '$lib/utils/constants'

export type DesktopNoteTodoPriority = (typeof DESKTOP_NOTE_TODO_PRIORITIES)[number]
export type DesktopNoteTodoSort = (typeof DESKTOP_NOTE_TODO_SORT_MODES)[number]

export interface DesktopNoteTodoPreferences {
  hideCompleted: boolean
  sort: DesktopNoteTodoSort
}

export interface DesktopNoteTodo {
  text: string
  completed: boolean
  priority?: DesktopNoteTodoPriority
  deadline?: string
  depth?: number
}

export function normalizeDesktopNoteTodoPreferences(value: unknown): DesktopNoteTodoPreferences {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    hideCompleted: typeof stored.hideCompleted === 'boolean'
      ? stored.hideCompleted
      : DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES.hideCompleted,
    sort: DESKTOP_NOTE_TODO_SORT_MODES.find(sort => sort === stored.sort)
      ?? DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES.sort,
  }
}

export function getVisibleDesktopNoteTodos<T extends DesktopNoteTodo>(
  items: readonly T[],
  preferences: DesktopNoteTodoPreferences = DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
): { item: T, index: number, depth: number }[] {
  interface Entry {
    item: T
    index: number
    depth: number
    children: Entry[]
  }

  const roots: Entry[] = []
  const parents: Entry[] = []
  for (const [index, item] of items.entries()) {
    const depth = Math.min(getDesktopNoteTodoDepth(item), parents.length)
    const entry = { item, index, depth, children: [] }
    parents.length = depth
    const siblings = parents.at(-1)?.children ?? roots
    siblings.push(entry)
    parents.push(entry)
  }

  let compare: ((left: Entry, right: Entry) => number) | undefined
  if (preferences.sort === 'priority') {
    const rank = (priority: DesktopNoteTodoPriority | undefined) => priority
      ? DESKTOP_NOTE_TODO_PRIORITIES.indexOf(priority)
      : DESKTOP_NOTE_TODO_PRIORITIES.length
    compare = (left, right) => rank(left.item.priority) - rank(right.item.priority)
  }
  else if (preferences.sort === 'deadline') {
    compare = ({ item: left }, { item: right }) => {
      if (left.deadline === right.deadline) {
        return 0
      }
      if (!left.deadline) {
        return 1
      }
      return !right.deadline || left.deadline < right.deadline ? -1 : 1
    }
  }

  const visible: { item: T, index: number, depth: number }[] = []
  function appendSiblings(siblings: Entry[]): boolean {
    if (compare) {
      siblings.sort(compare)
    }
    const initialLength = visible.length
    for (const { item, index, depth, children } of siblings) {
      visible.push({ item, index, depth })
      const hasVisibleChildren = appendSiblings(children)
      if (preferences.hideCompleted && item.completed && !hasVisibleChildren) {
        visible.pop()
      }
    }
    return visible.length > initialLength
  }
  appendSiblings(roots)
  return visible
}

export function getDesktopNoteTodoDepth(item: { depth?: number }): number {
  const depth = item.depth ?? 0
  return Number.isInteger(depth) ? Math.max(0, Math.min(DESKTOP_NOTE_TODO_MAX_DEPTH, depth)) : 0
}

function subtreeEnd(items: readonly { depth?: number }[], index: number): number {
  const depth = getDesktopNoteTodoDepth(items[index])
  let end = index + 1
  while (end < items.length && getDesktopNoteTodoDepth(items[end]) > depth) {
    end += 1
  }
  return end
}

export function getDesktopNoteTodoParentIndex(items: readonly DesktopNoteTodo[], index: number): number | null {
  if (!items[index]) {
    return null
  }
  const depth = getDesktopNoteTodoDepth(items[index])
  if (depth === 0) {
    return null
  }
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (getDesktopNoteTodoDepth(items[candidate]) < depth) {
      return candidate
    }
  }
  return null
}

export function getDesktopNoteTodoSiblingIndex(
  items: readonly DesktopNoteTodo[],
  index: number,
  direction: 'previous' | 'next',
): number | null {
  if (!items[index]) {
    return null
  }
  const depth = getDesktopNoteTodoDepth(items[index])
  if (direction === 'next') {
    const next = subtreeEnd(items, index)
    return items[next] && getDesktopNoteTodoDepth(items[next]) === depth ? next : null
  }
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const previousDepth = getDesktopNoteTodoDepth(items[previous])
    if (previousDepth <= depth) {
      return previousDepth === depth ? previous : null
    }
  }
  return null
}

export function canInsertDesktopNoteSubtask(items: readonly DesktopNoteTodo[], parentIndex: number): boolean {
  return Boolean(items[parentIndex]) && getDesktopNoteTodoDepth(items[parentIndex]) < DESKTOP_NOTE_TODO_MAX_DEPTH
}

export function insertDesktopNoteSubtask<T extends DesktopNoteTodo>(items: T[], parentIndex: number, item: T): T[] {
  if (!canInsertDesktopNoteSubtask(items, parentIndex)) {
    return items
  }
  const end = subtreeEnd(items, parentIndex)
  const child = { ...item, depth: getDesktopNoteTodoDepth(items[parentIndex]) + 1 }
  return [...items.slice(0, end), child, ...items.slice(end)]
}

export function removeDesktopNoteTodo<T extends DesktopNoteTodo>(items: T[], index: number): T[] {
  return items[index] ? [...items.slice(0, index), ...items.slice(subtreeEnd(items, index))] : items
}

export function moveDesktopNoteTodo<T extends DesktopNoteTodo & { id: string | number }>(
  items: T[],
  draggedId: T['id'],
  targetId: T['id'],
  placement: 'before' | 'after',
): T[] {
  const from = items.findIndex(item => item.id === draggedId)
  const target = items.findIndex(item => item.id === targetId)
  if (from < 0 || target < 0 || from === target
    || getDesktopNoteTodoParentIndex(items, from) !== getDesktopNoteTodoParentIndex(items, target)
    || getDesktopNoteTodoDepth(items[from]) !== getDesktopNoteTodoDepth(items[target])) {
    return items
  }

  const end = subtreeEnd(items, from)
  const boundary = placement === 'before' ? target : subtreeEnd(items, target)
  const insertion = boundary - (from < target ? end - from : 0)
  if (insertion === from) {
    return items
  }

  const reordered = [...items]
  const subtree = reordered.splice(from, end - from)
  return [...reordered.slice(0, insertion), ...subtree, ...reordered.slice(insertion)]
}

function isTodoPriority(value: unknown): value is DesktopNoteTodoPriority {
  return typeof value === 'string'
    && (DESKTOP_NOTE_TODO_PRIORITIES as readonly string[]).includes(value)
}

function isTodoDeadline(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    return false
  }
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
}

function parseMetadata(line: string): Pick<DesktopNoteTodo, 'priority' | 'deadline'> {
  if (!line.startsWith(DESKTOP_NOTE_TODO_METADATA_PREFIX) || !line.endsWith(DESKTOP_NOTE_TODO_METADATA_SUFFIX)) {
    return {}
  }
  try {
    const raw = JSON.parse(line.slice(DESKTOP_NOTE_TODO_METADATA_PREFIX.length, -DESKTOP_NOTE_TODO_METADATA_SUFFIX.length)) as {
      priority?: unknown
      deadline?: unknown
    } | null
    return {
      ...(isTodoPriority(raw?.priority) ? { priority: raw.priority } : {}),
      ...(isTodoDeadline(raw?.deadline) ? { deadline: raw.deadline } : {}),
    }
  }
  catch {
    return {}
  }
}

export function parseDesktopNoteTodos(content: string): DesktopNoteTodo[] {
  const lines = content.split(/\r?\n/)
  const indents: number[] = []
  const items: DesktopNoteTodo[] = []
  for (const [index, line] of lines.entries()) {
    const match = /^([ \t]*)- \[([ x])\] (.*)$/i.exec(line)
    if (!match) {
      continue
    }
    const [, prefix, checked, text] = match
    const indent = prefix.replaceAll('\t', ' '.repeat(DESKTOP_NOTE_TODO_INDENT_SIZE)).length
    while (indents.length > 0 && indent <= indents.at(-1)!) {
      indents.pop()
    }
    const depth = Math.min(indents.length, DESKTOP_NOTE_TODO_MAX_DEPTH)
    indents.push(indent)
    const metadata = lines[index + 1]?.trimStart()
    items.push({
      text,
      completed: checked.toLowerCase() === 'x',
      ...(depth > 0 ? { depth } : {}),
      ...(metadata ? parseMetadata(metadata) : {}),
    })
  }
  return items
}

export function serializeDesktopNoteTodos(items: readonly DesktopNoteTodo[]): string {
  let previousDepth = -1
  const rows = items.map((item) => {
    const depth = Math.min(getDesktopNoteTodoDepth(item), previousDepth + 1)
    previousDepth = depth
    return { item, depth }
  })
  const hasSubtasks = rows.some(row => row.depth > 0)
  return rows.map(({ item: { text, completed, priority, deadline }, depth }) => {
    const indent = ' '.repeat(depth * DESKTOP_NOTE_TODO_INDENT_SIZE)
    const row = `${indent}- [${completed ? 'x' : ' '}] ${text.replace(/[\r\n]+/g, ' ')}`
    const metadata = {
      priority: isTodoPriority(priority) ? priority : undefined,
      deadline: isTodoDeadline(deadline) ? deadline : undefined,
    }
    if (!metadata.priority && !metadata.deadline) {
      return row
    }
    // Keep flat notes byte-compatible. In a nested list, place the comment within its item.
    const metadataIndent = hasSubtasks ? indent + ' '.repeat(DESKTOP_NOTE_TODO_INDENT_SIZE) : indent
    return `${row}\n${metadataIndent}${DESKTOP_NOTE_TODO_METADATA_PREFIX}${JSON.stringify(metadata)}${DESKTOP_NOTE_TODO_METADATA_SUFFIX}`
  }).join('\n')
}
