import type { CacheConfig } from '@h-ai/cache'
import { cache, CacheConfigSchema } from '@h-ai/cache'
import { core, err, HaiConfigError } from '@h-ai/core'
import { crypto } from '@h-ai/crypto'
import { iam } from '@h-ai/iam'
import { reach } from '@h-ai/reach'
import { reldb, ReldbConfigSchema } from '@h-ai/reldb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closeModules, initializeModules } from '../src/server/runtime.js'

beforeEach(() => {
  vi.stubEnv('HAI_CORE_ENV', 'test')
  vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
  vi.stubEnv('HAI_DB_DATABASE', ':memory:')
  vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')
})

afterEach(async () => {
  try {
    await closeModules()
  }
  finally {
    vi.unstubAllEnvs()
  }
})

it('loads real YAML through Core with standard HAI overrides and leaves disabled mail closed', async () => {
  vi.stubEnv('HAI_CORE_NAME', 'AI Ask Configuration Test')
  vi.stubEnv('HAI_SERV_SERVER_PORT', '31422')
  await initializeModules()
  expect(core.config.getOrThrow<{ name: string }>('core').name).toBe('AI Ask Configuration Test')
  expect(core.config.getOrThrow<{ server: { port: number } }>('serv').server.port).toBe(31422)
  expect(reldb.isInitialized && cache.isInitialized && crypto.isInitialized && iam.isInitialized).toBe(true)
  expect(reach.isInitialized).toBe(false)
})

it('rolls back initialized dependencies after invalid IAM configuration and permits a clean retry', async () => {
  vi.stubEnv('HAI_IAM_PASSWORD_MAXLENGTH', '4')
  await expect(initializeModules()).rejects.toBeInstanceOf(Error)
  for (const module of [reldb, cache, crypto, iam, reach])
    expect(module.isInitialized).toBe(false)
  vi.stubEnv('HAI_IAM_PASSWORD_MAXLENGTH', '128')
  await initializeModules()
  expect(iam.isInitialized).toBe(true)
  const registered = await iam.user.register({ username: 'retry-user', password: 'RetryPass123!' })
  expect(registered.success).toBe(true)
})

it('resolves Redis fields absent from the memory YAML using the real Cache schema', () => {
  vi.stubEnv('HAI_CACHE_TYPE', 'redis')
  vi.stubEnv('HAI_CACHE_URL', 'redis://cache:6379')
  core.init({ configDir: './config', configSchemas: { cache: CacheConfigSchema } })
  const configured = CacheConfigSchema.parse(core.config.getOrThrow<CacheConfig>('cache'))
  expect(configured).toMatchObject({ type: 'redis', url: 'redis://cache:6379' })
  expect(cache.isInitialized).toBe(false)
})

it('resolves PostgreSQL connection fields over the SQLite default through the real Reldb schema', () => {
  vi.stubEnv('HAI_DB_TYPE', 'postgresql')
  vi.stubEnv('HAI_DB_DATABASE', 'ai_ask')
  vi.stubEnv('HAI_DB_HOST', 'db')
  vi.stubEnv('HAI_DB_PORT', '5432')
  vi.stubEnv('HAI_DB_USER', 'ai_ask')
  core.init({ configDir: './config', configSchemas: { db: ReldbConfigSchema } })
  const configured = ReldbConfigSchema.parse(core.config.getOrThrow('db'))
  expect(configured).toMatchObject({ type: 'postgresql', host: 'db', port: 5432, database: 'ai_ask', user: 'ai_ask' })
  expect(reldb.isInitialized).toBe(false)
})

it('rejects local SQLite and memory cache in production without leaving initialized state', async () => {
  vi.stubEnv('HAI_CORE_ENV', 'production')
  vi.stubEnv('HAI_CACHE_TYPE', 'memory')
  await expect(initializeModules()).rejects.toMatchObject({ cause: { ext: { module: 'reldb' } } })
  expect(reldb.isInitialized).toBe(false)
  expect(cache.isInitialized).toBe(false)
  expect(iam.isInitialized).toBe(false)
  expect((await cache.init({ type: 'memory' })).success).toBe(false)
  expect(cache.isInitialized).toBe(false)
})

it('refuses a failed required configuration read after close even when a valid prior config is cached', async () => {
  await initializeModules()
  await closeModules()
  const load = vi.spyOn(core.config, 'load').mockReturnValue(err(HaiConfigError.CONFIG_PARSE_ERROR, 'Required YAML parse failed'))
  try {
    await expect(initializeModules()).rejects.toMatchObject({ cause: { ext: { module: 'configuration' } } })
    expect(reldb.isInitialized || cache.isInitialized || iam.isInitialized).toBe(false)
  }
  finally {
    load.mockRestore()
  }
})
