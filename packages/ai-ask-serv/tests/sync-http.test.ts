import type { HaiResult, LogRecord } from '@h-ai/core'
import type { SyncedNoteRow } from 'ai-ask-contract'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiClient } from '@h-ai/api-client'
import { core, HaiCommonError } from '@h-ai/core'
import { HaiIamError } from '@h-ai/iam'
import { reldb } from '@h-ai/reldb'
import { serv } from '@h-ai/serv'
import { syncContract } from 'ai-ask-contract'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServerApp } from '../src/app-server.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

const PASSWORD = 'OnlyForTests123!'
const alice = apiClient.create(syncContract)
const bob = apiClient.create(syncContract)
const anonymous = apiClient.create(syncContract)
let listener: ReturnType<typeof serv.listen> | undefined
let directory: string | undefined
let database: string
let baseUrl: string

function checked<T>(result: HaiResult<T>): T {
  if (!result.success)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

function note(overrides: Partial<SyncedNoteRow> = {}): SyncedNoteRow {
  return {
    id: 'shared-note-id',
    user_id: 'forged-owner',
    title: 'A note',
    content: 'First saved revision',
    color: 'sunny',
    bounds: { visible: true, kind: 'todo' },
    created_at: 1000,
    updated_at: 2000,
    deleted_at: null,
    ...overrides,
  }
}

async function startServer() {
  await initializeModules()
  listener = serv.listen(createServerApp(), { host: '127.0.0.1', port: 0 })
  await once(listener.server, 'listening')
  const address = listener.server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing HTTP address')
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  for (const client of [alice, bob, anonymous])
    checked(await client.init({ baseUrl, auth: { storage: apiClient.tokenStorage.memory(), terminalType: 'desktop' } }))
}

async function stopServer() {
  await Promise.all([alice.close(), bob.close(), anonymous.close()])
  await listener?.close()
  await closeModules()
}

beforeAll(async () => {
  core.logger.setLevel('warn')
  directory = await mkdtemp(join(tmpdir(), 'ai-ask-sync-'))
  database = join(directory, 'test.sqlite')
  vi.stubEnv('HAI_DB_DATABASE', database)
  vi.stubEnv('HAI_CORE_ENV', 'test')
  vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
  vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')
  await startServer()
})

afterAll(async () => {
  try {
    await stopServer()
  }
  finally {
    if (directory)
      await rm(directory, { recursive: true, force: true })
    vi.unstubAllEnvs()
  }
})

describe('hai sync service over real HTTP', () => {
  it('registers and authenticates through the standard IAM client', async () => {
    for (const [client, username] of [[alice, 'alice'], [bob, 'bob']] as const) {
      checked(await apiClient.createAuthActions(client).register({ username, email: `${username}@example.test`, password: PASSWORD }))
      expect(checked(await client.iam.auth.currentUser()).username).toBe(username)
    }
    expect((await anonymous.notes.list({})).success).toBe(false)
  })

  it('reports missing SMTP delivery instead of claiming password reset mail was sent', async () => {
    const config = checked(await anonymous.iam.auth.publicConfig())
    expect(config?.passwordReset?.enabled).toBe(false)
    const result = await anonymous.iam.auth.requestPasswordReset({ identifier: 'alice@example.test' })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.code).toBe(HaiIamError.PASSWORD_RESET_DISABLED.code)
  })

  it('isolates owners even when a client forges user_id or reuses another owner note ID', async () => {
    const aliceId = checked(await alice.iam.auth.currentUser()).id
    const saved = checked(await alice.notes.push({ notes: [note()] }))
    expect(saved).toHaveLength(1)
    expect(saved[0].user_id).toBe(aliceId)
    expect(checked(await bob.notes.list({}))).toEqual([])
    checked(await bob.notes.push({ notes: [note({ user_id: aliceId, content: 'Bob private note' })] }))
    expect(checked(await alice.notes.list({}))[0].content).toBe('First saved revision')
    expect(checked(await bob.notes.list({}))[0].content).toBe('Bob private note')
  })

  it('keeps newer edits when stale writes arrive and returns the committed winner', async () => {
    const latest = note({ updated_at: 4000, content: 'Latest edit' })
    checked(await alice.notes.push({ notes: [latest] }))
    const result = checked(await alice.notes.push({ notes: [note({ updated_at: 3000, content: 'Stale edit' })] }))
    expect(result[0].content).toBe('Latest edit')
    expect(result[0].updated_at).toBe(4000)
  })

  it('keeps deletion tombstones across offline writes, retries, and equal timestamps', async () => {
    checked(await alice.notes.push({ notes: [note({ updated_at: 4000, deleted_at: 4000 })] }))
    for (const updatedAt of [3000, 4000, 9000]) {
      const result = checked(await alice.notes.push({ notes: [note({ updated_at: updatedAt, content: 'Attempted resurrection' })] }))
      expect(result[0].deleted_at).toBe(4000)
    }
  })

  it('validates batch input and enforces the configured browser origins', async () => {
    const response = await fetch(`${baseUrl}/notes/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: [note({ updated_at: -1 })] }),
    })
    expect(response.ok).toBe(false)
    const allowed = await fetch(`${baseUrl}/auth/config`, { headers: { origin: 'http://tauri.localhost' } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost')
    const denied = await fetch(`${baseUrl}/auth/config`, { headers: { origin: 'https://untrusted.example' } })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('propagates deletion despite a faster editing clock and never resurrects the deleted ID', async () => {
    const noteId = 'clock-skew-delete'
    checked(await alice.notes.push({ notes: [note({ id: noteId, updated_at: 9000, content: 'Edited on a fast clock' })] }))
    const deleted = checked(await alice.notes.push({ notes: [note({ id: noteId, updated_at: 2000, deleted_at: 2000 })] }))
    expect(deleted.find(row => row.id === noteId)).toMatchObject({ updated_at: 2000, deleted_at: 2000 })
    const retried = checked(await alice.notes.push({ notes: [note({ id: noteId, updated_at: 10000, content: 'Offline stale resurrection' })] }))
    expect(retried.find(row => row.id === noteId)).toMatchObject({ updated_at: 2000, deleted_at: 2000 })
  })

  it('returns correlated safe errors for corrupt storage without leaking note fragments into HTTP or logs', async () => {
    const userId = checked(await alice.iam.auth.currentUser()).id
    checked(await reldb.sql.execute(
      'INSERT INTO ai_ask_notes (user_id, id, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?)',
      [userId, 'corrupt-storage-fixture', 1000, null, 'SENSITIVE! private note contents'],
    ))
    const records: LogRecord[] = []
    const stop = core.logger.observe(record => records.push(record))
    try {
      const result = await alice.notes.list({})
      expect(result).toMatchObject({ success: false, error: { code: HaiCommonError.INTERNAL_ERROR.code, httpStatus: 500 } })
      if (result.success)
        throw new Error('Expected a stored-note integrity failure')
      expect(result.error.traceId).toBeTruthy()
      const related = records.filter(record => record.context.traceId === result.error.traceId)
      expect(related.some(record => record.level === 'error')).toBe(true)
      expect(JSON.stringify(related)).toContain('SyntaxError')
      expect(JSON.stringify({ result, records })).not.toContain('SENSITIVE!')
    }
    finally {
      stop()
      checked(await reldb.sql.execute('DELETE FROM ai_ask_notes WHERE user_id = ? AND id = ?', [userId, 'corrupt-storage-fixture']))
    }
  })

  it('persists accounts and tombstones after a complete service restart, and revokes logout', async () => {
    await stopServer()
    await startServer()
    checked(await apiClient.createAuthActions(alice).login({ identifier: 'alice@example.test', password: PASSWORD }))
    expect(checked(await alice.notes.list({})).find(row => row.id === 'shared-note-id')?.deleted_at).toBe(4000)
    checked(await alice.iam.auth.logout({}))
    await alice.auth.clear()
    expect((await alice.notes.list({})).success).toBe(false)
  })
})
