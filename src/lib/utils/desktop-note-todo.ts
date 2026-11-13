import {
  DESKTOP_NOTE_TODO_METADATA_PREFIX,
  DESKTOP_NOTE_TODO_METADATA_SUFFIX,
  DESKTOP_NOTE_TODO_PRIORITIES,
} from '$lib/utils/constants'

export type DesktopNoteTodoPriority = (typeof DESKTOP_NOTE_TODO_PRIORITIES)[number]

export interface DesktopNoteTodo {
  text: string
  completed: boolean
  priority?: DesktopNoteTodoPriority
  deadline?: string
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
