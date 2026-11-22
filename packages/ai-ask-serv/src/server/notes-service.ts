import type { DmlOperations } from '@h-ai/reldb'
import type { SyncedNoteRow } from 'ai-ask-contract'
import { err, HaiCommonError, ok } from '@h-ai/core'
import { reldb } from '@h-ai/reldb'
import { noteRowSchema } from 'ai-ask-contract'
import { serverM } from './messages.js'

interface StoredNote {
  id: string
  payload: string
}

export async function initializeNotes() {
  return reldb.sql.execute(`CREATE TABLE IF NOT EXISTS ai_ask_notes (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`)
}

export async function listNotes(userId: string, sql: Pick<DmlOperations, 'query'> = reldb.sql) {
  const result = await sql.query<StoredNote>(
    'SELECT id, payload FROM ai_ask_notes WHERE user_id = ? ORDER BY updated_at, id',
    [userId],
  )
  if (!result.success)
    return result
  const notes: SyncedNoteRow[] = []
  for (const row of result.data) {
    let value: unknown
    try {
      value = JSON.parse(row.payload)
    }
    catch (cause) {
      // 原生 JSON 异常消息可能包含便签正文；只把安全根因交给框架日志边界。
      return invalidStoredNote({ name: cause instanceof Error ? cause.name : 'InvalidJSON', stage: 'json' })
    }
    const parsed = noteRowSchema.safeParse(value)
    if (!parsed.success) {
      return invalidStoredNote({
        name: 'StoredNoteValidationError',
        fields: parsed.error.issues.map(issue => issue.path.join('.')),
      })
    }
    if (parsed.data.user_id !== userId || parsed.data.id !== row.id)
      return invalidStoredNote({ name: 'StoredNoteIdentityMismatch' })
    notes.push(parsed.data)
  }
  return ok(notes)
}

function invalidStoredNote(cause: Record<string, unknown>) {
  // Serv 统一记录一次 5xx、添加追踪编号并隐藏内部诊断，服务层不重复输出。
  return err(HaiCommonError.INTERNAL_ERROR, serverM('notes.invalidStoredData'), cause)
}

export async function pushNotes(userId: string, notes: SyncedNoteRow[]) {
  // HaiResult 失败由框架回滚整批写入，最终回复也在提交前读取并校验。
  return reldb.tx.wrapResult(async (tx) => {
    for (const input of notes) {
      const note = { ...input, user_id: userId }
      // 数据库原子比较版本；墓碑永久保留，离线旧设备不能复活已删便签。
      const saved = await tx.execute(`
        INSERT INTO ai_ask_notes (user_id, id, updated_at, deleted_at, payload)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at,
          payload = excluded.payload
        WHERE ai_ask_notes.deleted_at IS NULL
          AND (excluded.deleted_at IS NOT NULL
            OR excluded.updated_at > ai_ask_notes.updated_at)
      `, [userId, note.id, note.updated_at, note.deleted_at, JSON.stringify(note)])
      if (!saved.success)
        return saved
    }
    return listNotes(userId, tx)
  })
}
