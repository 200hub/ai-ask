import type { SyncedNoteRow } from 'ai-ask-contract'
import { HaiCommonError } from '@h-ai/core'
import { HaiReldbError, reldb } from '@h-ai/reldb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { listNotes, pushNotes } from '../src/server/notes-service.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

beforeEach(async () => {
  vi.stubEnv('HAI_CORE_ENV', 'test')
  vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
  vi.stubEnv('HAI_DB_TYPE', 'sqlite')
  vi.stubEnv('HAI_DB_DATABASE', ':memory:')
  vi.stubEnv('HAI_CACHE_TYPE', 'memory')
  vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')
  await initializeModules()
})

afterEach(async () => {
  try {
    await closeModules()
  }
  finally {
    vi.unstubAllEnvs()
  }
})

const row: SyncedNoteRow = {
  id: 'stored-note',
  user_id: 'owner',
  title: 'Stored title',
  content: 'Stored content',
  color: 'sunny',
  bounds: { visible: true },
  created_at: 1000,
  updated_at: 2000,
  deleted_at: null,
}

it.each([
  ['invalid JSON', 'private-note-body-sentinel'],
  ['invalid fields', JSON.stringify({ ...row, content: null })],
  ['mismatched owner', JSON.stringify({ ...row, user_id: 'another-owner' })],
  ['mismatched ID', JSON.stringify({ ...row, id: 'another-note' })],
])('returns a safe HaiResult for persisted note corruption: %s', async (_label, payload) => {
  const inserted = await reldb.sql.execute(
    'INSERT INTO ai_ask_notes (user_id, id, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?)',
    ['owner', 'stored-note', 2000, null, payload],
  )
  expect(inserted.success).toBe(true)
  await expect(listNotes('owner')).resolves.toMatchObject({
    success: false,
    error: { code: HaiCommonError.INTERNAL_ERROR.code, httpStatus: 500 },
  })
})

it('rolls back all prior notes when a later note is rejected by the actual database', async () => {
  const constraint = await reldb.sql.execute(`
    CREATE TRIGGER reject_sync_fixture BEFORE INSERT ON ai_ask_notes
    WHEN NEW.id = 'reject-sync-fixture'
    BEGIN SELECT RAISE(ABORT, 'Sync fixture rejected'); END
  `)
  expect(constraint.success).toBe(true)
  const result = await pushNotes('owner', [row, { ...row, id: 'reject-sync-fixture' }])
  expect(result).toMatchObject({ success: false, error: { code: HaiReldbError.QUERY_FAILED.code } })
  expect(await reldb.sql.query('SELECT id FROM ai_ask_notes WHERE user_id = ?', ['owner']))
    .toMatchObject({ success: true, data: [] })
})

it('rolls back writes if the final response cannot validate existing persisted data', async () => {
  const corrupt = 'private-note-body-sentinel'
  expect((await reldb.sql.execute(
    'INSERT INTO ai_ask_notes (user_id, id, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?)',
    ['owner', 'corrupt-existing', 1000, null, corrupt],
  )).success).toBe(true)
  expect(await pushNotes('owner', [row])).toMatchObject({
    success: false,
    error: { code: HaiCommonError.INTERNAL_ERROR.code },
  })
  expect(await reldb.sql.query('SELECT id, payload FROM ai_ask_notes WHERE user_id = ?', ['owner']))
    .toMatchObject({ success: true, data: [{ id: 'corrupt-existing', payload: corrupt }] })
})
