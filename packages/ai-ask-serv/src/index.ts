import type { CoreConfig } from '@h-ai/core'
import type { ServConfig } from '@h-ai/serv'
import process from 'node:process'
import { core } from '@h-ai/core'
import { serv } from '@h-ai/serv'
import { createServerApp } from './app-server.js'
import { closeModules, initializeModules } from './server/runtime.js'

async function main() {
  await initializeModules()
  try {
    const { server } = core.config.getOrThrow<ServConfig>('serv')
    const config = core.config.getOrThrow<CoreConfig>('core')
    await new Promise<void>((resolve, reject) => {
      const listener = serv.listen(createServerApp(), {
        host: server.host,
        port: server.port,
        onClose: closeModules,
        onListening: (address) => {
          core.logger.info('Application listening', { name: config.name, host: server.host, port: address.port })
          resolve()
        },
      })
      listener.server.once('error', reject)
      listener.server.once('listening', () => listener.server.off('error', reject))
    })
  }
  catch (error) {
    try {
      await closeModules()
    }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Application startup and cleanup failed')
    }
    throw error
  }
}

main().catch((error: unknown) => {
  core.logger.fatal('Application startup failed', { error })
  process.exitCode = 1
})
