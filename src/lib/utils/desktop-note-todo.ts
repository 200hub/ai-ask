import {
  DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
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
): { item: T, index: number }[] {
  const visible = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => !preferences.hideCompleted || !item.completed)

  if (preferences.sort === 'priority') {
    const rank = (priority: DesktopNoteTodoPriority | undefined) => priority
      ? DESKTOP_NOTE_TODO_PRIORITIES.indexOf(priority)
      : DESKTOP_NOTE_TODO_PRIORITIES.length
    visible.sort((left, right) => rank(left.item.priority) - rank(right.item.priority))
  }
  else if (preferences.sort === 'deadline') {
    visible.sort(({ item: left }, { item: right }) => {
      if (left.deadline === right.deadline) {
        return 0
      }
      if (!left.deadline) {
        return 1
      }
      return !right.deadline || left.deadline < right.deadline ? -1 : 1
    })
  }

  return visible
}

export function moveDesktopNoteTodo<T extends { id: string | number }>(
  items: T[],
  draggedId: T['id'],
  targetId: T['id'],
  placement: 'before' | 'after',
): T[] {
  const from = items.findIndex(item => item.id === draggedId)
  const target = items.findIndex(item => item.id === targetId)
  if (from < 0 || target < 0 || from === target) {
    return items
  }

  const insertion = target + Number(placement === 'after') - Number(from < target)
  if (insertion === from) {
    return items
  }

  const reordered = [...items]
  reordered.splice(from, 1)
  reordered.splice(insertion, 0, items[from])
  return reordered
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
  return lines.flatMap((line, index) => {
    const match = /^- \[([ x])\] (.*)$/i.exec(line)
    return match
      ? [{
          text: match[2],
          completed: match[1].toLowerCase() === 'x',
          ...parseMetadata(lines[index + 1] ?? ''),
        }]
      : []
  })
}

export function serializeDesktopNoteTodos(items: DesktopNoteTodo[]): string {
  return items.map(({ text, completed, priority, deadline }) => {
    const row = `- [${completed ? 'x' : ' '}] ${text.replace(/[\r\n]+/g, ' ')}`
    const metadata = {
      priority: isTodoPriority(priority) ? priority : undefined,
      deadline: isTodoDeadline(deadline) ? deadline : undefined,
    }
    if (!metadata.priority && !metadata.deadline) {
      return row
    }
    return `${row}\n${DESKTOP_NOTE_TODO_METADATA_PREFIX}${JSON.stringify(metadata)}${DESKTOP_NOTE_TODO_METADATA_SUFFIX}`
  }).join('\n')
}
