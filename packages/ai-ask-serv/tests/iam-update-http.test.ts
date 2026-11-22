import type { HaiResult } from '@h-ai/core'
import { once } from 'node:events'
import { apiClient } from '@h-ai/api-client'
import { HaiIamError, iam } from '@h-ai/iam'
import { serv } from '@h-ai/serv'
import { syncContract } from 'ai-ask-contract'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createServerApp } from '../src/app-server.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

const password = 'AtomicUserUpdate123!'
const admin = apiClient.create(syncContract)
const member = apiClient.create(syncContract)
const anonymous = apiClient.create(syncContract)
let listener: ReturnType<typeof serv.listen> | undefined
let targetId: string
let initialName: string | undefined
let proof: string | undefined

function checked<T>(result: HaiResult<T>): T {
  if (!result.success)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

beforeAll(async () => {
  vi.stubEnv('HAI_CORE_ENV', 'test')
  vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
  vi.stubEnv('HAI_DB_TYPE', 'sqlite')
  vi.stubEnv('HAI_DB_DATABASE', ':memory:')
  vi.stubEnv('HAI_CACHE_TYPE', 'memory')
  vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')
  vi.stubEnv('HAI_IAM_REAUTHENTICATION_ENABLED', 'true')
  vi.stubEnv('HAI_IAM_REAUTHENTICATION_OPERATIONS', '["iam.users.update"]')
  await initializeModules()
  listener = serv.listen(createServerApp(), { host: '127.0.0.1', port: 0 })
  await once(listener.server, 'listening')
  const address = listener.server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing atomic-user HTTP fixture address')
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  for (const client of [admin, member, anonymous]) {
    checked(await client.init({
      baseUrl,
      auth: { storage: apiClient.tokenStorage.memory(), terminalType: 'desktop' },
      headers: (): Record<string, string> => client === admin && proof ? { 'x-hai-reauthentication': proof } : {},
    }))
  }
  const adminUser = checked(await apiClient.createAuthActions(admin).register({ username: 'atomic-admin', password })).user
  const target = checked(await apiClient.createAuthActions(member).register({ username: 'atomic-member', password })).user
  targetId = target.id
  initialName = target.displayName
  // 通过真实 IAM 授权专用测试角色，不依赖管理员旁路或伪造会话。
  const permission = checked(await iam.authz.createPermission({ code: 'iam.users.write', name: 'Atomic update fixture' }))
  const role = checked(await iam.authz.createRole({ code: 'atomic-update-fixture', name: 'Atomic update fixture', permissionIds: [permission.id] }))
  checked(await iam.authz.assignRole(adminUser.id, role.id))
  await admin.auth.clear()
  checked(await apiClient.createAuthActions(admin).login({ identifier: 'atomic-admin', password }))
})

beforeEach(() => {
  proof = undefined
})

afterAll(async () => {
  try {
    await Promise.all([admin.close(), member.close(), anonymous.close()])
    await listener?.close()
    await closeModules()
  }
  finally {
    vi.unstubAllEnvs()
  }
})

it('retains authentication and permission guards on the atomic replacement route', async () => {
  for (const [client, status] of [[anonymous, 401], [member, 403]] as const) {
    expect(await client.iam.users.update({ id: targetId, displayName: 'Unauthorized change' }))
      .toMatchObject({ success: false, error: { httpStatus: status } })
  }
  expect(checked(await iam.user.getUser(targetId))?.displayName).toBe(initialName)
})

it('retains sensitive-operation proof requirements before the profile is changed', async () => {
  expect(await admin.iam.users.update({ id: targetId, displayName: 'Missing proof change' }))
    .toMatchObject({ success: false, error: { code: HaiIamError.REAUTHENTICATION_REQUIRED.code } })
  expect(checked(await iam.user.getUser(targetId))?.displayName).toBe(initialName)
})

it('rolls back the profile if a requested role does not exist and consumes its operation proof once', async () => {
  proof = checked(await admin.iam.auth.reauthenticate({ password, operation: 'iam.users.update' })).ticket
  expect(await admin.iam.users.update({ id: targetId, displayName: 'Must roll back', roleIds: ['missing-role-fixture'] }))
    .toMatchObject({ success: false, error: { code: HaiIamError.ROLE_NOT_FOUND.code } })
  expect(checked(await iam.user.getUser(targetId))?.displayName).toBe(initialName)
  expect(await admin.iam.users.update({ id: targetId, displayName: 'Replayed proof change' }))
    .toMatchObject({ success: false, error: { code: HaiIamError.TICKET_INVALID.code } })
  expect(checked(await iam.user.getUser(targetId))?.displayName).toBe(initialName)
})

it('keeps a wrong-purpose ticket usable by its actual operation and atomically clears the target roles', async () => {
  proof = checked(await admin.iam.auth.reauthenticate({ password, operation: 'iam.users.update' })).ticket
  expect(await iam.ticket.consume(proof, { purpose: 'another-operation-fixture' }))
    .toMatchObject({ success: false, error: { code: HaiIamError.TICKET_INVALID.code } })
  expect(checked(await admin.iam.users.update({ id: targetId, displayName: 'Committed name', roleIds: [] })).displayName)
    .toBe('Committed name')
  expect(checked(await iam.authz.getUserRoles(targetId))).toEqual([])
})
