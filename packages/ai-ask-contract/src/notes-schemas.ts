import { z } from 'zod'

/** 公开同步容量与字段约束，由桌面端和服务端共用。 */
export const NOTE_SYNC_LIMITS = {
  BATCH_SIZE: 100,
  MAX_TITLE_LENGTH: 1000,
  MAX_CONTENT_LENGTH: 1_000_000,
  MAX_ID_LENGTH: 200,
} as const

const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** 不包含本地窗口几何，user_id 仅用于响应；写入时服务端强制使用会话身份。 */
export const noteRowSchema = z.object({
  id: z.string().min(1).max(NOTE_SYNC_LIMITS.MAX_ID_LENGTH),
  user_id: z.string().max(NOTE_SYNC_LIMITS.MAX_ID_LENGTH),
  title: z.string().max(NOTE_SYNC_LIMITS.MAX_TITLE_LENGTH),
  content: z.string().max(NOTE_SYNC_LIMITS.MAX_CONTENT_LENGTH),
  color: z.enum(['sunny', 'mint', 'sky', 'lavender', 'rose', 'slate']),
  bounds: z.object({
    visible: z.boolean().optional(),
    kind: z.enum(['markdown', 'todo']).optional(),
  }),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
})

export type SyncedNoteRow = z.infer<typeof noteRowSchema>

export const notesPushInputSchema = z.object({
  notes: z.array(noteRowSchema).max(NOTE_SYNC_LIMITS.BATCH_SIZE),
})
