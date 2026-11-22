import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const user = { id: 'hai-user', email: 'user@example.test' }
  const actions = {
    login: vi.fn(),
    register: vi.fn(),
    requestPasswordReset: vi.fn(),
  }
  const makeClient = () => ({
    init: vi.fn().mockResolvedValue({ success: true }),
    close: vi.fn().mockResolvedValue(undefined),
    auth: { clear: vi.fn().mockResolvedValue(undefined) },
    iam: { auth: {
      currentUser: vi.fn().mockResolvedValue({ success: true, data: user }),
      logout: vi.fn().mockResolvedValue({ success: true }),
    } },
  })
  return {
    user,
    actions,
    makeClient,
    createClient: vi.fn(),
    createAuthActions: vi.fn(),
    invoke: vi.fn(),
    config: { desktopNotesServerUrl: 'https://sync.example.test/api/v1' },
  }
})

vi.mock('@h-ai/api-client', () => ({ apiClient: {
  create: mocks.createClient,
  createAuthActions: mocks.createAuthActions,
} }))
vi.mock('ai-ask-contract', () => ({ syncContract: {} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/stores/config.svelte', () => ({ configStore: { config: mocks.config } }))

interface Tokens {
  accessToken?: string
  refreshToken?: string
}

let cloud: typeof import('$lib/utils/cloud-auth')
let client: ReturnType<typeof mocks.makeClient>
let vault: Map<string, Tokens>

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.config.desktopNotesServerUrl = 'https://sync.example.test/api/v1'
  vault = new Map()
  mocks.invoke.mockReset().mockImplementation(async (command: string, input: { serverUrl: string, tokens?: Tokens }) => {
    if (command === 'read_cloud_tokens') {
      const stored = vault.get(input.serverUrl)
      return stored ? { ...stored } : null
    }
    if (command === 'write_cloud_tokens') {
      vault.set(input.serverUrl, { ...vault.get(input.serverUrl), ...input.tokens })
      return
    }
    if (command === 'clear_cloud_tokens') {
      vault.delete(input.serverUrl)
      return
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  client = mocks.makeClient()
  mocks.createClient.mockReset().mockReturnValue(client)
  mocks.createAuthActions.mockReset().mockReturnValue(mocks.actions)
  mocks.actions.login.mockReset().mockResolvedValue({ success: true, data: { user: mocks.user } })
  mocks.actions.register.mockReset().mockResolvedValue({ success: true, data: { user: mocks.user } })
  mocks.actions.requestPasswordReset.mockReset().mockResolvedValue({ success: true })
  cloud = await import('$lib/utils/cloud-auth')
})

describe('native cloud credentials', () => {
  it('serializes simultaneous token updates without losing either token', async () => {
    const storage = cloud.createNativeTokenStorage(mocks.config.desktopNotesServerUrl)
    await Promise.all([
      storage.setAccessToken('access-a'),
      storage.setRefreshToken('refresh-a'),
    ])
    expect(await storage.getAccessToken()).toBe('access-a')
    expect(await storage.getRefreshToken()).toBe('refresh-a')
    await storage.clear()
    expect(await storage.getAccessToken()).toBeNull()
    expect(await storage.getRefreshToken()).toBeNull()
  })

  it('isolates credentials by backend and API path', async () => {
    const first = cloud.createNativeTokenStorage('https://sync.example.test/api/v1')
    const second = cloud.createNativeTokenStorage('https://sync.example.test/other/api/v1')
    await first.setAccessToken('first-account')
    await second.setAccessToken('second-account')
    await first.clear()
    expect(await first.getAccessToken()).toBeNull()
    expect(await second.getAccessToken()).toBe('second-account')
  })

  it('shares one write queue for normalized aliases of the same backend', () => {
    const first = cloud.createNativeTokenStorage('https://SYNC.example.test:443/api/v1///')
    const second = cloud.createNativeTokenStorage('https://sync.example.test/api/v1')
    expect(first).toBe(second)
  })

  it('waits for writes from another adapter for the same backend before reading', async () => {
    const first = cloud.createNativeTokenStorage(mocks.config.desktopNotesServerUrl)
    const second = cloud.createNativeTokenStorage(mocks.config.desktopNotesServerUrl)
    const pending = first.setAccessToken('latest-access')
    const read = second.getAccessToken()
    await pending
    expect(await read).toBe('latest-access')
  })

  it('preserves read and write failures and allows a later retry', async () => {
    const storage = cloud.createNativeTokenStorage(mocks.config.desktopNotesServerUrl)
    mocks.invoke.mockRejectedValueOnce(new Error('Credential vault locked'))
    await expect(storage.getAccessToken()).rejects.toThrow('Credential vault locked')
    mocks.invoke.mockRejectedValueOnce(new Error('Credential vault unavailable'))
    await expect(storage.setAccessToken('uncommitted')).rejects.toThrow('Credential vault unavailable')
    await storage.setAccessToken('retry-saved')
    expect(await storage.getAccessToken()).toBe('retry-saved')
  })

  it('reports failed native credential deletion', async () => {
    const storage = cloud.createNativeTokenStorage(mocks.config.desktopNotesServerUrl)
    mocks.invoke.mockRejectedValueOnce(new Error('Credential delete failed'))
    await expect(storage.clear()).rejects.toThrow('Credential delete failed')
  })
})

describe('hai typed authentication', () => {
  it('permits changing offline servers only after local credentials have been cleared', async () => {
    const changed = vi.fn()
    cloud.onAuthStateChange(changed)
    client.iam.auth.logout.mockRejectedValueOnce(new Error('Remote server offline'))

    await expect(cloud.signOut({ allowOffline: true })).resolves.toBeUndefined()

    expect(client.auth.clear).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith('SIGNED_OUT', null)
  })

  it('never ignores local credential deletion failure when an offline switch is allowed', async () => {
    const changed = vi.fn()
    cloud.onAuthStateChange(changed)
    client.iam.auth.logout.mockRejectedValueOnce(new Error('Remote server offline'))
    client.auth.clear.mockRejectedValueOnce(new Error('Credential vault locked'))

    await expect(cloud.signOut({ allowOffline: true })).rejects.toThrow('Credential vault locked')

    expect(changed).not.toHaveBeenCalled()
  })

  it('normalizes URLs and rejects credentials, fragments, queries, and unsupported schemes', () => {
    expect(cloud.normalizeCloudServerUrl(' https://EXAMPLE.test:443/api/v1/ ')).toBe('https://example.test/api/v1')
    for (const value of ['file:///secret', 'https://user:pass@example.test', 'https://example.test?secret=1', 'https://example.test#token', 'invalid'])
      expect(() => cloud.normalizeCloudServerUrl(value)).toThrow()
  })

  it('reuses one initialized client and initializes desktop authentication', async () => {
    const [first, second] = await Promise.all([cloud.getCloudClient(), cloud.getCloudClient()])
    expect(first).toBe(second)
    expect(first.client).toBe(client)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    expect(client.init).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: mocks.config.desktopNotesServerUrl,
      auth: expect.objectContaining({ terminalType: 'desktop', storage: expect.any(Object) }),
    }))
  })

  it('closes the old client when switching backends and does not reuse its identity', async () => {
    await cloud.getCloudClient()
    const next = mocks.makeClient()
    mocks.createClient.mockReturnValueOnce(next)
    mocks.config.desktopNotesServerUrl = 'https://another.example.test/api/v1'
    expect((await cloud.getCloudClient()).client).toBe(next)
    expect(client.close).toHaveBeenCalledOnce()
    expect(next.init).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: mocks.config.desktopNotesServerUrl }))
  })

  it('retries a failed client initialization', async () => {
    client.init.mockResolvedValueOnce({ success: false, error: { message: 'Configuration rejected' } })
    await expect(cloud.getCloudClient()).rejects.toThrow('Configuration rejected')
    expect((await cloud.getCloudClient()).client).toBe(client)
    expect(client.init).toHaveBeenCalledTimes(2)
  })

  it('never probes the typed client Proxy for then during initialization, reuse, or server replacement', async () => {
    const thenAccess = vi.fn()
    const proxy = new Proxy(client, {
      get(target, property, receiver) {
        if (property === 'then') {
          thenAccess()
          throw new Error('Typed client was incorrectly assimilated as a Promise')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    mocks.createClient.mockReturnValueOnce(proxy)
    const first = await cloud.getCloudClient()
    const second = await cloud.getCloudClient()
    expect(Object.is(first.client, proxy)).toBe(true)
    expect(Object.is(second.client, proxy)).toBe(true)
    expect(thenAccess).not.toHaveBeenCalled()

    mocks.config.desktopNotesServerUrl = 'https://next.example.test/api/v1'
    const next = mocks.makeClient()
    mocks.createClient.mockReturnValueOnce(next)
    expect((await cloud.getCloudClient()).client).toBe(next)
    expect(client.close).toHaveBeenCalledOnce()
    expect(thenAccess).not.toHaveBeenCalled()
  })

  it('binds a sync identity to the same initialized client', async () => {
    const connection = await cloud.getCloudConnection()
    expect(connection.client).toBe(client)
    expect(connection.userId).toBe(mocks.user.id)
    expect(client.iam.auth.currentUser).toHaveBeenCalledOnce()
    expect(mocks.createClient).toHaveBeenCalledOnce()
  })

  it('rejects an identity response when the configured backend changes during currentUser', async () => {
    client.iam.auth.currentUser.mockImplementationOnce(async () => {
      mocks.config.desktopNotesServerUrl = 'https://another.example.test/api/v1'
      return { success: true, data: mocks.user }
    })
    await expect(cloud.getCloudConnection()).rejects.toThrow('Cloud service changed during the request')
    expect(mocks.createClient).toHaveBeenCalledOnce()
    expect(client.init).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://sync.example.test/api/v1' }))
  })

  it('rejects an endpoint switch during credential reading before querying another backend', async () => {
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.config.desktopNotesServerUrl = 'https://another.example.test/api/v1'
      return { accessToken: 'first-server-access' }
    })
    await expect(cloud.getSessionInfo()).rejects.toThrow('Cloud service changed during the request')
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('read_cloud_tokens', { serverUrl: 'https://sync.example.test/api/v1' })
  })

  it('skips the network when no saved identity exists and surfaces credential failures', async () => {
    expect(await cloud.getSessionInfo()).toEqual({ authenticated: false, email: null, userId: null })
    expect(mocks.createClient).not.toHaveBeenCalled()
    mocks.invoke.mockRejectedValueOnce(new Error('Native vault failed'))
    await expect(cloud.getSessionInfo()).rejects.toThrow('Native vault failed')
  })

  it('resolves the saved identity through currentUser and preserves service failures', async () => {
    vault.set(mocks.config.desktopNotesServerUrl, { refreshToken: 'saved-refresh' })
    expect(await cloud.getSessionInfo()).toEqual({ authenticated: true, email: mocks.user.email, userId: mocks.user.id })
    client.iam.auth.currentUser.mockResolvedValueOnce({ success: false, error: { message: 'Service offline' } })
    await expect(cloud.getSessionInfo()).rejects.toThrow('Service offline')
  })

  it('uses standard IAM login and register actions and emits auth state changes', async () => {
    const observer = vi.fn()
    const stop = cloud.onAuthStateChange(observer)
    expect(await cloud.signUpWithEmail('user@example.test', 'Example123!')).toEqual({ authenticated: true, email: mocks.user.email, userId: mocks.user.id })
    expect(mocks.actions.register).toHaveBeenCalledWith({ username: 'user@example.test', email: 'user@example.test', password: 'Example123!' })
    await cloud.signInWithEmail('user@example.test', 'Example123!')
    expect(mocks.actions.login).toHaveBeenCalledWith({ identifier: 'user@example.test', password: 'Example123!' })
    expect(observer).toHaveBeenCalledWith('SIGNED_IN', { user: mocks.user })
    stop()
    await cloud.signInWithEmail('user@example.test', 'Example123!')
    expect(observer).toHaveBeenCalledTimes(2)
  })

  it('does not announce success when login or registration is rejected', async () => {
    const observer = vi.fn()
    cloud.onAuthStateChange(observer)
    mocks.actions.login.mockResolvedValueOnce({ success: false, error: { message: 'Invalid password' } })
    await expect(cloud.signInWithEmail('user@example.test', 'wrong')).rejects.toThrow('Invalid password')
    mocks.actions.register.mockResolvedValueOnce({ success: false, error: { message: 'Email already registered' } })
    await expect(cloud.signUpWithEmail('user@example.test', 'Example123!')).rejects.toThrow('Email already registered')
    expect(observer).not.toHaveBeenCalled()
    expect(client.auth.clear).not.toHaveBeenCalled()
  })

  it('waits for partial native credentials to be cleared before rejecting login or registration', async () => {
    const observer = vi.fn()
    cloud.onAuthStateChange(observer)
    for (const operation of ['login', 'register'] as const) {
      observer.mockClear()
      const persistenceError = new Error(`${operation} refresh token write failed`)
      mocks.actions[operation].mockImplementationOnce(async () => {
        vault.set(mocks.config.desktopNotesServerUrl, { accessToken: 'partial-access' })
        throw persistenceError
      })
      let beginCleanup!: () => void
      let finishCleanup!: () => void
      const cleanupStarted = new Promise<void>((resolve) => {
        beginCleanup = resolve
      })
      const cleanupAllowed = new Promise<void>((resolve) => {
        finishCleanup = resolve
      })
      client.auth.clear.mockImplementationOnce(async () => {
        beginCleanup()
        await cleanupAllowed
        vault.delete(mocks.config.desktopNotesServerUrl)
      })
      let settled = false
      const authentication = operation === 'login'
        ? cloud.signInWithEmail('user@example.test', 'Example123!')
        : cloud.signUpWithEmail('user@example.test', 'Example123!')
      const outcome = authentication.then(
        () => {
          settled = true
          return null
        },
        (error: unknown) => {
          settled = true
          return error
        },
      )
      await cleanupStarted
      expect(settled).toBe(false)
      expect(vault.get(mocks.config.desktopNotesServerUrl)?.accessToken).toBe('partial-access')
      expect(observer).not.toHaveBeenCalled()
      finishCleanup()
      expect(await outcome).toBe(persistenceError)
      expect(vault.has(mocks.config.desktopNotesServerUrl)).toBe(false)
      expect(observer).toHaveBeenCalledExactlyOnceWith('SIGNED_OUT', null)
    }
    expect(client.auth.clear).toHaveBeenCalledTimes(2)
  })

  it('preserves both credential persistence and cleanup errors without announcing authentication success', async () => {
    const observer = vi.fn()
    cloud.onAuthStateChange(observer)
    for (const operation of ['login', 'register'] as const) {
      const persistenceError = new Error(`${operation} token persistence failed`)
      const cleanupError = new Error(`${operation} partial session cleanup failed`)
      mocks.actions[operation].mockRejectedValueOnce(persistenceError)
      client.auth.clear.mockRejectedValueOnce(cleanupError)
      const authentication = operation === 'login'
        ? cloud.signInWithEmail('user@example.test', 'Example123!')
        : cloud.signUpWithEmail('user@example.test', 'Example123!')
      const error: unknown = await authentication.then(() => null, (cause: unknown) => cause)
      expect(error).toBeInstanceOf(AggregateError)
      if (!(error instanceof AggregateError))
        throw new Error('Expected credential failure diagnostics to retain both causes')
      expect(error.errors).toEqual([persistenceError, cleanupError])
    }
    expect(client.auth.clear).toHaveBeenCalledTimes(2)
    expect(observer).not.toHaveBeenCalled()
  })

  it('clears local credentials on logout even if the remote session cannot be revoked', async () => {
    const observer = vi.fn()
    cloud.onAuthStateChange(observer)
    client.iam.auth.logout.mockResolvedValueOnce({ success: false, error: { message: 'Offline' } })
    await expect(cloud.signOut()).rejects.toThrow('Offline')
    expect(client.auth.clear).toHaveBeenCalledOnce()
    expect(observer).toHaveBeenCalledWith('SIGNED_OUT', null)
  })

  it('propagates credential clear failures instead of claiming sign-out completed', async () => {
    const observer = vi.fn()
    cloud.onAuthStateChange(observer)
    client.auth.clear.mockRejectedValueOnce(new Error('Vault still contains session'))
    await expect(cloud.signOut()).rejects.toThrow('Vault still contains session')
    expect(observer).not.toHaveBeenCalled()
  })

  it('surfaces unavailable password reset delivery as an error', async () => {
    mocks.actions.requestPasswordReset.mockResolvedValueOnce({ success: false, error: { message: 'Password reset is unavailable' } })
    await expect(cloud.resetPassword('user@example.test')).rejects.toThrow('Password reset is unavailable')
    expect(mocks.actions.requestPasswordReset).toHaveBeenCalledWith('user@example.test')
  })
})
