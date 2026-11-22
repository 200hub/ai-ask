import type { HaiResult } from '@h-ai/core'
import type { SyncedNoteRow } from 'ai-ask-contract'
import { once } from 'node:events'
import process from 'node:process'
import { apiClient } from '@h-ai/api-client'
import { HaiCommonError } from '@h-ai/core'
import { HaiIamError, iam } from '@h-ai/iam'
import { HaiReldbError, reldb } from '@h-ai/reldb'
import { serv } from '@h-ai/serv'
import { syncContract } from 'ai-ask-contract'
import { expect, it, vi } from 'vitest'
import { createServerApp } from '../src/app-server.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

const postgresEndpoint = process.env.HAI_TEST_POSTGRES_URL
const redisEndpoint = process.env.HAI_TEST_REDIS_URL

function checked<T>(result: HaiResult<T>): T {
  if (!result.success)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

it.skipIf(!postgresEndpoint || !redisEndpoint)('uses actual PostgreSQL and Redis in production, persists restarts, and never revives deleted notes', async () => {
  const postgres = new URL(postgresEndpoint!)
  const redis = new URL(redisEndpoint!)
  // 仅允许显式隔离测试库；不清空表，也不读写既有账号的数据。
  if (!['postgres:', 'postgresql:'].includes(postgres.protocol) || postgres.pathname !== '/ai_ask_test')
    throw new Error('HAI_TEST_POSTGRES_URL must point to the isolated ai_ask_test database')
  if (!['redis:', 'rediss:'].includes(redis.protocol))
    throw new Error('HAI_TEST_REDIS_URL must use the Redis protocol')
  const runId = crypto.randomUUID()
  const username = `provider-test-${runId}`
  const password = 'ProductionProviderTest123!'
  const client = apiClient.create(syncContract)
  let listener: ReturnType<typeof serv.listen> | undefined
  let userId: string | undefined

  async function startServer() {
    await initializeModules()
    listener = serv.listen(createServerApp(), { host: '127.0.0.1', port: 0 })
    await once(listener.server, 'listening')
    const address = listener.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing production-provider fixture address')
    checked(await client.init({
      baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
      auth: { storage: apiClient.tokenStorage.memory(), terminalType: 'desktop' },
    }))
  }

  async function stopServer() {
    await client.close()
    await listener?.close()
    listener = undefined
    await closeModules()
  }

  try {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAI_CORE_ENV', 'production')
    vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
    vi.stubEnv('HAI_E2E', '')
    vi.stubEnv('HAI_E2E_MOCK', '')
    vi.stubEnv('HAI_DB_TYPE', 'postgresql')
    vi.stubEnv('HAI_DB_HOST', postgres.hostname)
    vi.stubEnv('HAI_DB_PORT', postgres.port || '5432')
    vi.stubEnv('HAI_DB_DATABASE', 'ai_ask_test')
    vi.stubEnv('HAI_DB_USER', decodeURIComponent(postgres.username))
    vi.stubEnv('HAI_DB_PASSWORD', decodeURIComponent(postgres.password))
    vi.stubEnv('HAI_CACHE_TYPE', 'redis')
    vi.stubEnv('HAI_CACHE_URL', redis.toString())
    vi.stubEnv('HAI_CACHE_KEYPREFIX', `ai-ask-provider-test:${runId}:`)
    vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')

    await startServer()
    expect(reldb.config?.type).toBe('postgresql')
    const registered = checked(await apiClient.createAuthActions(client).register({ username, email: `${runId}@example.test`, password }))
    userId = registered.user.id
    expect(await iam.user.updateUserWithRoles(userId, {
      profile: { displayName: 'Uncommitted provider profile' },
      roleIds: [`missing-role-${runId}`],
    })).toMatchObject({ success: false, error: { code: HaiIamError.ROLE_NOT_FOUND.code } })
    expect(checked(await iam.user.getUser(userId))?.displayName).toBe(registered.user.displayName)
    const updatedUser = checked(await iam.user.updateUserWithRoles(userId, {
      profile: { displayName: 'Committed provider profile' },
      roleIds: [],
    }))
    expect(updatedUser.displayName).toBe('Committed provider profile')
    expect(checked(await iam.authz.getUserRoles(userId))).toEqual([])
    const createdAt = Date.now()
    const note: SyncedNoteRow = {
      id: `note-${runId}`,
      user_id: 'forged-owner',
      title: 'Production provider fixture',
      content: 'First revision',
      color: 'sunny',
      bounds: { visible: true },
      created_at: createdAt,
      updated_at: createdAt + 4000,
      deleted_at: null,
    }
    checked(await client.notes.push({ notes: [note] }))
    checked(await client.notes.push({ notes: [{ ...note, updated_at: createdAt + 9000, content: 'Fast clock edit' }] }))
    const stale = checked(await client.notes.push({ notes: [{ ...note, updated_at: createdAt + 8000, content: 'Stale clock edit' }] }))
    expect(stale[0]).toMatchObject({ user_id: userId, content: 'Fast clock edit', updated_at: createdAt + 9000 })
    const deleted = checked(await client.notes.push({ notes: [{ ...note, updated_at: createdAt + 2000, deleted_at: createdAt + 2000 }] }))
    expect(deleted[0].deleted_at).toBe(createdAt + 2000)
    const revived = checked(await client.notes.push({ notes: [{ ...note, updated_at: createdAt + 10000, content: 'Attempted resurrection' }] }))
    expect(revived[0].deleted_at).toBe(createdAt + 2000)

    // PostgreSQL 拒绝 TEXT 中的 NUL；使用真实驱动失败验证整批写入原子性，不修改表约束。
    const stagedId = `atomic-batch-${runId}`
    const rejected = await client.notes.push({ notes: [{ ...note, id: stagedId }, { ...note, id: `invalid\0${runId}` }] })
    expect(rejected).toMatchObject({ success: false, error: { code: HaiReldbError.QUERY_FAILED.code } })
    expect(checked(await client.notes.list({})).some(row => row.id === stagedId)).toBe(false)

    // 回复校验失败同样不能留下已提交写入，旧损坏数据保留供管理员恢复。
    const corruptId = `corrupt-${runId}`
    checked(await reldb.sql.execute(
      'INSERT INTO ai_ask_notes (user_id, id, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?)',
      [userId, corruptId, createdAt, null, 'Invalid persisted fixture'],
    ))
    const invalidResponse = await client.notes.push({ notes: [{ ...note, id: stagedId }] })
    expect(invalidResponse).toMatchObject({ success: false, error: { code: HaiCommonError.INTERNAL_ERROR.code } })
    const staged = checked(await reldb.sql.query('SELECT id FROM ai_ask_notes WHERE user_id = ? AND id = ?', [userId, stagedId]))
    expect(staged).toEqual([])
    checked(await reldb.sql.execute('DELETE FROM ai_ask_notes WHERE user_id = ? AND id = ?', [userId, corruptId]))

    await stopServer()
    await startServer()
    checked(await apiClient.createAuthActions(client).login({ identifier: username, password }))
    expect(checked(await client.iam.auth.currentUser()).id).toBe(userId)
    expect(checked(await client.notes.list({}))[0]).toMatchObject({ id: note.id, user_id: userId, deleted_at: createdAt + 2000 })
  }
  finally {
    try {
      // 仅删除本用例注册的账号及其便签，不修改模板角色或其他用户。
      if (userId && reldb.isInitialized)
        checked(await reldb.sql.execute('DELETE FROM ai_ask_notes WHERE user_id = ?', [userId]))
      if (userId && iam.isInitialized)
        checked(await iam.user.deleteUser(userId))
    }
    finally {
      await stopServer()
      vi.unstubAllEnvs()
    }
  }
}, 60000)
