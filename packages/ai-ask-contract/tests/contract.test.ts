import { apiContract } from '@h-ai/api-contract'
import { describe, expect, it } from 'vitest'
import { NOTE_SYNC_LIMITS, noteRowSchema, notesPushInputSchema, syncContract } from '../src/index.js'

const validRow = {
  id: 'note-id',
  user_id: 'owner',
  title: 'Saved note',
  content: '- [ ] Task',
  color: 'sunny',
  bounds: { visible: true, kind: 'todo' },
  created_at: 1000,
  updated_at: 2000,
  deleted_at: null,
}

describe('shared sync contract', () => {
  it('preserves standard IAM and the existing public note route paths', () => {
    expect(apiContract.pathOf(syncContract.iam.auth.login)).toBe('/auth/login')
    expect(apiContract.pathOf(syncContract.notes.list)).toBe('/notes/list')
    expect(apiContract.pathOf(syncContract.notes.push)).toBe('/notes/push')
  })

  it('validates note fields while keeping local geometry outside the public payload', () => {
    const parsed = noteRowSchema.parse({ ...validRow, bounds: { ...validRow.bounds, x: 100, y: 100, width: 320, height: 280 } })
    expect(parsed.bounds).toEqual({ visible: true, kind: 'todo' })
    expect(noteRowSchema.safeParse({ ...validRow, updated_at: -1 }).success).toBe(false)
    expect(noteRowSchema.safeParse({ ...validRow, color: 'unknown' }).success).toBe(false)
  })

  it('accepts deletion timestamps older than edits and enforces the bounded push batch', () => {
    expect(noteRowSchema.parse({ ...validRow, updated_at: 9000, deleted_at: 2000 }).deleted_at).toBe(2000)
    expect(notesPushInputSchema.safeParse({ notes: Array.from({ length: NOTE_SYNC_LIMITS.BATCH_SIZE + 1 }).fill(validRow) }).success).toBe(false)
  })
})
