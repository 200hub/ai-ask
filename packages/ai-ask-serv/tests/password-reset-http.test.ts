import type { HaiResult } from '@h-ai/core'
import type { Socket } from 'node:net'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { apiClient } from '@h-ai/api-client'
import { core } from '@h-ai/core'
import { serv } from '@h-ai/serv'
import { syncContract } from 'ai-ask-contract'
import { expect, it, vi } from 'vitest'
import { createServerApp } from '../src/app-server.js'
import { closeModules, initializeModules } from '../src/server/runtime.js'

function checked<T>(result: HaiResult<T>): T {
  if (!result.success)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

it('delivers a real SMTP reset link, accepts the browser form, and consumes the token once', async () => {
  core.logger.setLevel('warn')
  const sockets = new Set<Socket>()
  let resolveMessage!: (message: string) => void
  const message = new Promise<string>((resolve) => {
    resolveMessage = resolve
  })
  const smtp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write('220 fixture ESMTP\r\n')
    let buffer = ''
    let receiving = false
    let body = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let lineEnd = buffer.indexOf('\r\n')
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd)
        buffer = buffer.slice(lineEnd + 2)
        if (receiving) {
          if (line === '.') {
            receiving = false
            resolveMessage(body)
            socket.write('250 queued\r\n')
          }
          else {
            body += `${line}\r\n`
          }
        }
        else if (line.startsWith('EHLO') || line.startsWith('HELO')) {
          socket.write('250-fixture\r\n250 SIZE 10000000\r\n')
        }
        else if (line === 'DATA') {
          receiving = true
          socket.write('354 send mail\r\n')
        }
        else if (line === 'QUIT') {
          socket.end('221 goodbye\r\n')
        }
        else {
          socket.write('250 accepted\r\n')
        }
        lineEnd = buffer.indexOf('\r\n')
      }
    })
  })
  const client = apiClient.create(syncContract)
  let listener: ReturnType<typeof serv.listen> | undefined
  try {
    smtp.listen(0, '127.0.0.1')
    await once(smtp, 'listening')
    const smtpAddress = smtp.address()
    if (!smtpAddress || typeof smtpAddress === 'string')
      throw new Error('Missing SMTP fixture address')
    vi.stubEnv('HAI_CORE_ENV', 'test')
    vi.stubEnv('HAI_CORE_LOGGING_LEVEL', 'warn')
    vi.stubEnv('HAI_DB_DATABASE', ':memory:')
    vi.stubEnv('HAI_IAM_PASSWORDRESET_ENABLED', 'true')
    vi.stubEnv('HAI_IAM_PASSWORD_MINLENGTH', '12')
    vi.stubEnv('HAI_IAM_PASSWORD_MAXLENGTH', '256')
    vi.stubEnv('HAI_IAM_PASSWORDRESET_RESETURL', 'http://127.0.0.1/reset-password')
    vi.stubEnv('HAI_REACH_PROVIDERS_0_HOST', '127.0.0.1')
    vi.stubEnv('HAI_REACH_PROVIDERS_0_PORT', String(smtpAddress.port))
    vi.stubEnv('HAI_REACH_PROVIDERS_0_SECURE', 'false')
    vi.stubEnv('HAI_REACH_PROVIDERS_0_FROM', 'noreply@example.test')
    await initializeModules()
    listener = serv.listen(createServerApp(), { host: '127.0.0.1', port: 0 })
    await once(listener.server, 'listening')
    const address = listener.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing service address')
    const origin = `http://127.0.0.1:${address.port}`
    checked(await client.init({ baseUrl: `${origin}/api/v1`, auth: { storage: apiClient.tokenStorage.memory() } }))
    checked(await apiClient.createAuthActions(client).register({ username: 'reset-user', email: 'reset@example.test', password: 'OriginalPass123!' }))
    checked(await client.iam.auth.requestPasswordReset({ identifier: 'reset@example.test' }))
    const mail = (await message).replace(/=\r\n/g, '').replace(/=([\dA-F]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    const href = mail.match(/href="([^"]+)"/)?.[1]
    expect(href).toBeTruthy()
    const url = new URL(href!)
    const token = url.searchParams.get('token')
    expect(token).toBeTruthy()
    const page = await fetch(`${origin}${url.pathname}${url.search}`, { headers: { 'accept-language': 'en-US' } })
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await page.text()).toContain('autocomplete="new-password"')
    const newPassword = `ChangedPass456!${'a'.repeat(160)}`
    const form = new URLSearchParams({ token: token!, password: newPassword, confirm: newPassword })
    const attempted = await Promise.all(Array.from({ length: 2 }, () => fetch(`${origin}/reset-password`, {
      method: 'POST',
      body: form,
      headers: { 'accept-language': 'en-US' },
    })))
    expect(attempted.map(response => response.status).sort()).toEqual([200, 400])
    const updated = attempted.find(response => response.status === 200)!
    expect(await updated.text()).toContain('Password updated')
    const replay = await fetch(`${origin}/reset-password`, { method: 'POST', body: form })
    expect(replay.status).toBe(400)
    await client.auth.clear()
    checked(await apiClient.createAuthActions(client).login({ identifier: 'reset@example.test', password: newPassword }))
    expect(checked(await client.iam.auth.currentUser()).username).toBe('reset-user')
  }
  finally {
    await client.close()
    await listener?.close()
    await closeModules()
    for (const socket of sockets)
      socket.destroy()
    await new Promise<void>((resolve, reject) => smtp.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
  }
})
