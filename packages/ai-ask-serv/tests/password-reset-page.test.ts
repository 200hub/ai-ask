import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServerApp } from '../src/app-server.js'
import { PASSWORD_RESET } from '../src/server/password-reset.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

beforeAll(async () => {
  vi.stubEnv('HAI_CORE_ENV', 'test')
  vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
  vi.stubEnv('HAI_DB_TYPE', 'sqlite')
  vi.stubEnv('HAI_DB_DATABASE', ':memory:')
  vi.stubEnv('HAI_CACHE_TYPE', 'memory')
  vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'false')
  vi.stubEnv('HAI_IAM_PASSWORD_MINLENGTH', '12')
  vi.stubEnv('HAI_IAM_PASSWORD_MAXLENGTH', '256')
  await initializeModules()
})

afterAll(async () => {
  try {
    await closeModules()
  }
  finally {
    vi.unstubAllEnvs()
  }
})

it('uses the active IAM password policy for the browser form', async () => {
  const response = await createServerApp().request(`${PASSWORD_RESET.PATH}?token=example-token`)
  const html = await response.text()
  expect(html).toContain('minlength="12"')
  expect(html).toContain('maxlength="256"')
})

it('cancels an oversized streamed form without consuming its entire body', async () => {
  let chunksRead = 0
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksRead++
      if (chunksRead > 10)
        controller.close()
      else controller.enqueue(new Uint8Array(PASSWORD_RESET.MAX_FORM_BYTES + 1).fill(97))
    },
    cancel,
  })
  const options: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream,
    duplex: 'half',
  }
  const response = await createServerApp().fetch(new Request(`http://localhost${PASSWORD_RESET.PATH}`, options))
  expect(response.status).toBe(413)
  expect(cancel).toHaveBeenCalledOnce()
  expect(chunksRead).toBeLessThan(10)
})
