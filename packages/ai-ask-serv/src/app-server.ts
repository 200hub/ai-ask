import type { CoreConfig } from '@h-ai/core'
import type { ServConfig } from '@h-ai/serv'
import { core } from '@h-ai/core'
import { iam } from '@h-ai/iam'
import { serv } from '@h-ai/serv'
import { syncContract } from 'ai-ask-contract'
import { PASSWORD_RESET, passwordResetPage } from './server/password-reset.js'
import { createApplicationIamProcedures } from './server/procedures/iam-procedures.js'
import { createNotesProcedures } from './server/procedures/notes-procedures.js'

export function createServerApp() {
  const config = core.config.getOrThrow<ServConfig>('serv')
  const coreConfig = core.config.getOrThrow<CoreConfig>('core')
  const security = serv.createRuntimeSecurityPolicy({
    environment: coreConfig.env,
    corsOrigin: config.cors.origin,
    nativeOrigins: config.cors.nativeOrigins,
  })
  if (config.transport !== false)
    throw new Error('Application transport encryption is not enabled in the desktop client')

  return serv.createApp({
    contract: syncContract,
    procedures: { iam: createApplicationIamProcedures(), notes: createNotesProcedures() },
    iam,
    http: {
      ...config.http,
      docs: security.exposeApiDocs ? config.http.docs : false,
      openapi: security.exposeApiDocs ? config.http.openapi : false,
    },
    middlewares: [
      { path: PASSWORD_RESET.PATH, middleware: passwordResetPage },
      { middleware: serv.cors({
        origin: security.allowOrigin,
        credentials: config.cors.credentials,
        allowedHeaders: config.cors.allowedHeaders,
        exposedHeaders: config.cors.exposedHeaders,
      }) },
    ],
  })
}
