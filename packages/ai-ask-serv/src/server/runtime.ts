import type { CacheConfig } from '@h-ai/cache'
import type { CoreConfig, HaiResult } from '@h-ai/core'
import type { IamConfig } from '@h-ai/iam'
import type { ReachConfig } from '@h-ai/reach'
import type { ReldbConfig } from '@h-ai/reldb'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { cache, CacheConfigSchema } from '@h-ai/cache'
import { core, CoreConfigSchema, err, HaiConfigError, ok } from '@h-ai/core'
import { crypto } from '@h-ai/crypto'
import { iam, IamConfigSchema } from '@h-ai/iam'
import { reach, ReachConfigSchema } from '@h-ai/reach'
import { reldb, ReldbConfigSchema } from '@h-ai/reldb'
import { ServConfigSchema } from '@h-ai/serv'
import { initializeNotes } from './notes-service.js'

const configSchemas = {
  core: CoreConfigSchema,
  serv: ServConfigSchema,
  db: ReldbConfigSchema,
  cache: CacheConfigSchema,
  iam: IamConfigSchema,
  reach: ReachConfigSchema,
}

const runtime = core.module.createRuntime([
  {
    name: 'configuration',
    start: () => {
      core.init({
        configDir: './config',
        configSchemas,
      })
      // Core 热重载失败会保留旧缓存；显式检查本次必需文件的读取结果，避免沿旧凭据启动。
      for (const [name, schema] of Object.entries(configSchemas)) {
        if (name === 'reach' && !core.config.getOrThrow<IamConfig>('iam').passwordReset?.enabled)
          continue
        const loaded = core.config.load<unknown>(name, `./config/_${name}.yml`, schema)
        if (!loaded.success)
          return loaded
      }
      return ok(undefined)
    },
    close: () => {},
  },
  {
    name: 'reldb',
    start: async () => {
      const config = core.config.getOrThrow<ReldbConfig>('db')
      if (config.type !== 'sqlite' && config.type !== 'postgresql') {
        return err({
          ...HaiConfigError.CONFIG_VALIDATION_ERROR,
          message: 'AI Ask notes support SQLite and PostgreSQL database providers only',
          ext: { fields: ['HAI_DB_TYPE'] },
        })
      }
      if (config.type === 'sqlite' && config.database !== ':memory:')
        await mkdir(dirname(config.database), { recursive: true })
      return reldb.init(config)
    },
    close: () => reldb.close(),
  },
  {
    name: 'cache',
    start: () => cache.init(core.config.getOrThrow<CacheConfig>('cache')),
    close: () => cache.close(),
  },
  {
    name: 'crypto',
    start: () => crypto.init(),
    close: () => crypto.close(),
  },
  {
    name: 'reach',
    enabled: () => core.config.getOrThrow<IamConfig>('iam').passwordReset?.enabled === true,
    start: () => reach.init(core.config.getOrThrow<ReachConfig>('reach')),
    close: () => reach.close(),
  },
  {
    name: 'iam',
    start: () => iam.init({
      ...core.config.getOrThrow<IamConfig>('iam'),
      reach,
    }),
    close: () => iam.close(),
  },
  {
    name: 'notes',
    start: initializeNotes,
    close: () => {},
  },
])

/** 初始化失败回滚、并发启动和关闭重试由 Hai Core 统一处理。 */
export async function initializeModules(): Promise<void> {
  requireReady(await runtime.start())
  const config = core.config.getOrThrow<CoreConfig>('core')
  core.logger.info('Application initialized', { name: config.name, version: config.version, environment: config.env })
}

export async function closeModules(): Promise<void> {
  requireReady(await runtime.close())
}

function requireReady<T>(result: HaiResult<T>): void {
  if (!result.success)
    throw new Error(result.error.message, { cause: result.error })
}
