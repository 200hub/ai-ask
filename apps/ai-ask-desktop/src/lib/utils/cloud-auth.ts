import type { TokenStorage } from '@h-ai/api-client'
import type { HaiResult } from '@h-ai/core'
import { configStore } from '$lib/stores/config.svelte'
import { apiClient } from '@h-ai/api-client'
import { invoke } from '@tauri-apps/api/core'
import { syncContract } from 'ai-ask-contract'
import { HAI_SYNC } from './constants'
import { logger } from './logger'

export interface CloudSessionInfo {
  authenticated: boolean
  email: string | null
  userId: string | null
}

interface StoredTokens {
  accessToken?: string
  refreshToken?: string
}

type CloudClient = ReturnType<typeof createClient>
interface CloudClientHandle { client: CloudClient }
type AuthSession = { user: { id: string, email?: string | null } } | null
const authListeners = new Set<(event: string, session: AuthSession) => void>()
let currentClient: { url: string, promise: Promise<CloudClientHandle> } | null = null
let clientChanges = Promise.resolve()
const nativeStorages = new Map<string, TokenStorage>()

function createClient() {
  return apiClient.create(syncContract)
}

/** 登录凭据保存在操作系统凭据库中，并按后端地址隔离。 */
export function createNativeTokenStorage(serverUrl: string): TokenStorage {
  serverUrl = normalizeCloudServerUrl(serverUrl)
  const existing = nativeStorages.get(serverUrl)
  if (existing)
    return existing
  let writes = Promise.resolve()
  const read = () => invoke<StoredTokens | null>('read_cloud_tokens', { serverUrl })
  function update(tokens: StoredTokens) {
    const result = writes.then(async () => {
      await invoke('write_cloud_tokens', { serverUrl, tokens })
    })
    writes = result.catch(() => {})
    return result
  }
  const storage: TokenStorage = {
    getAccessToken: async () => {
      await writes
      return (await read())?.accessToken ?? null
    },
    getRefreshToken: async () => {
      await writes
      return (await read())?.refreshToken ?? null
    },
    setAccessToken: accessToken => update({ accessToken }),
    setRefreshToken: refreshToken => update({ refreshToken }),
    clear: () => {
      const result = writes.then(() => invoke<void>('clear_cloud_tokens', { serverUrl }))
      writes = result.catch(() => {})
      return result
    },
  }
  nativeStorages.set(serverUrl, storage)
  return storage
}

export function normalizeCloudServerUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid cloud service URL')
  return url.toString().replace(/\/+$/, '')
}

export function isCloudSyncAvailable(): boolean {
  try {
    normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)
    return true
  }
  catch {
    return false
  }
}

function notify(session: AuthSession) {
  for (const callback of authListeners)
    callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session)
}

export async function getCloudClient(expectedServerUrl?: string): Promise<CloudClientHandle> {
  const url = normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)
  if (expectedServerUrl !== undefined && expectedServerUrl !== url)
    throw new Error('Cloud service changed during the request')
  if (currentClient?.url === url)
    return currentClient.promise
  const previous = currentClient
  const promise = clientChanges.then(async () => {
    if (previous) {
      const oldClient = await previous.promise.catch(() => null)
      await oldClient?.client.close()
    }
    const client = createClient()
    const initialized = await client.init({
      baseUrl: url,
      clientName: HAI_SYNC.CLIENT_NAME,
      timeout: HAI_SYNC.REQUEST_TIMEOUT_MS,
      auth: {
        terminalType: HAI_SYNC.TERMINAL_TYPE,
        storage: createNativeTokenStorage(url),
        onRefreshFailed: () => notify(null),
      },
    })
    if (!initialized.success)
      throw new Error(initialized.error.message)
    // Hai 动态过程代理也会暴露 then，必须装入普通对象以避免被 Promise 当作 thenable。
    return { client }
  })
  clientChanges = promise.then(() => {}, () => {})
  currentClient = { url, promise }
  try {
    return await promise
  }
  catch (error) {
    if (currentClient?.promise === promise)
      currentClient = null
    throw error
  }
}

export async function getSessionInfo(): Promise<CloudSessionInfo> {
  const empty = { authenticated: false, email: null, userId: null }
  if (!isCloudSyncAvailable())
    return empty
  const url = normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)
  const storage = createNativeTokenStorage(url)
  if (!await storage.getAccessToken() && !await storage.getRefreshToken())
    return empty
  const { client } = await getCloudClient(url)
  const result = await client.iam.auth.currentUser()
  if (!result.success)
    throw new Error(result.error.message)
  if (normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl) !== url)
    throw new Error('Cloud service changed during the request')
  return { authenticated: true, email: result.data.email ?? null, userId: result.data.id }
}

/** 整次同步使用同一个客户端，绑定身份与后端地址。 */
export async function getCloudConnection() {
  const url = normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)
  const { client } = await getCloudClient(url)
  const user = await client.iam.auth.currentUser()
  if (!user.success)
    throw new Error(user.error.message)
  if (normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl) !== url)
    throw new Error('Cloud service changed during the request')
  return { client, userId: user.data.id }
}

async function authenticateWithAction(
  client: CloudClient,
  action: () => Promise<HaiResult<{ user: { id: string, email?: string | null } }>>,
): Promise<CloudSessionInfo> {
  let result: Awaited<ReturnType<typeof action>>
  try {
    result = await action()
  }
  catch (error) {
    // 原生凭据可能只完成部分写入；报告登录失败前须清除不完整的会话。
    try {
      await client.auth.clear()
      notify(null)
    }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Cloud credential persistence and cleanup failed')
    }
    throw error
  }
  if (!result.success)
    throw new Error(result.error.message)
  const user = result.data.user
  notify({ user })
  return { authenticated: true, email: user.email ?? null, userId: user.id }
}

export async function signInWithEmail(email: string, password: string): Promise<CloudSessionInfo> {
  const { client } = await getCloudClient()
  return authenticateWithAction(client, () => apiClient.createAuthActions(client).login({ identifier: email, password }))
}

export async function signUpWithEmail(email: string, password: string): Promise<CloudSessionInfo> {
  const { client } = await getCloudClient()
  return authenticateWithAction(client, () => apiClient.createAuthActions(client).register({ username: email, email, password }))
}

export async function signOut(options?: { allowOffline?: boolean }): Promise<void> {
  const url = normalizeCloudServerUrl(configStore.config.desktopNotesServerUrl)
  let client: CloudClient | undefined
  let logoutFailure: unknown
  try {
    client = (await getCloudClient(url)).client
    const result = await client.iam.auth.logout({})
    if (!result.success)
      throw new Error(result.error.message)
  }
  catch (error) {
    logoutFailure = error
  }
  // 无论服务是否可达，都必须等待本机凭据真正清除；本地失败不能被离线选项吞掉。
  if (client)
    await client.auth.clear()
  else
    await createNativeTokenStorage(url).clear()
  notify(null)
  if (logoutFailure) {
    if (!options?.allowOffline)
      throw logoutFailure
    logger.warn('Cloud logout failed after local credentials were cleared', logoutFailure)
  }
}

export function onAuthStateChange(callback: (event: string, session: AuthSession) => void): () => void {
  authListeners.add(callback)
  return () => authListeners.delete(callback)
}

export async function resetPassword(email: string): Promise<void> {
  const { client } = await getCloudClient()
  const result = await apiClient.createAuthActions(client).requestPasswordReset(email)
  if (!result.success)
    throw new Error(result.error.message)
}
