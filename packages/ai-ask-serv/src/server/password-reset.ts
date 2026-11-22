import type { ServMiddleware } from '@h-ai/serv'
import { core } from '@h-ai/core'
import { iam } from '@h-ai/iam'
import { serverM } from './messages.js'

export const PASSWORD_RESET = {
  PATH: '/reset-password',
  MAX_FORM_BYTES: 4096,
  MAX_TOKEN_LENGTH: 200,
} as const

const logger = core.logger.child({ module: 'ai-ask-serv', scope: 'password-reset' })

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

function render(locale: string, token: string, feedback?: string) {
  const title = serverM('reset.title', locale)
  const policy = passwordPolicy()
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${feedback ? `<p role="status">${escapeHtml(feedback)}</p>` : ''}${token ? `<form method="post" action="${PASSWORD_RESET.PATH}"><input type="hidden" name="token" value="${escapeHtml(token)}"><p><label>${serverM('reset.password', locale)}<input name="password" type="password" autocomplete="new-password" minlength="${policy.minLength}" maxlength="${policy.maxLength}" required></label></p><p><label>${serverM('reset.confirm', locale)}<input name="confirm" type="password" autocomplete="new-password" minlength="${policy.minLength}" maxlength="${policy.maxLength}" required></label></p><button type="submit">${serverM('reset.submit', locale)}</button></form>` : ''}</main></body></html>`
}

function passwordPolicy() {
  if (!iam.publicConfig)
    throw new Error('IAM password policy is unavailable')
  return iam.publicConfig.password
}

/** 按收到的实际字节限制表单，不信任 Content-Length，也不先把整条流读进内存。 */
async function readForm(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader)
    return ''
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        return body + decoder.decode()
      size += chunk.value.byteLength
      if (size > PASSWORD_RESET.MAX_FORM_BYTES) {
        await reader.cancel().catch(() => logger.debug('Oversized reset form cancellation failed'))
        return null
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
  }
  finally {
    reader.releaseLock()
  }
}

export const passwordResetPage: ServMiddleware = async (context) => {
  const locale = context.req.header('accept-language') ?? 'zh-CN'
  context.header('Cache-Control', 'no-store')
  context.header('Referrer-Policy', 'no-referrer')
  context.header('Content-Security-Policy', 'default-src \'none\'; form-action \'self\'; frame-ancestors \'none\'; base-uri \'none\'')
  if (context.req.method === 'GET') {
    const token = context.req.query('token') ?? ''
    const valid = token.length > 0 && token.length <= PASSWORD_RESET.MAX_TOKEN_LENGTH
    return context.html(render(locale, valid ? token : '', valid ? undefined : serverM('reset.invalid', locale)), valid ? 200 : 400)
  }
  if (context.req.method !== 'POST')
    return context.html(render(locale, '', serverM('reset.invalid', locale)), 405)
  if (!context.req.header('content-type')?.startsWith('application/x-www-form-urlencoded'))
    return context.html(render(locale, '', serverM('reset.invalid', locale)), 400)
  let body: string | null
  try {
    body = await readForm(context.req.raw)
  }
  catch {
    logger.debug('Failed to read password reset form')
    return context.html(render(locale, '', serverM('reset.invalid', locale)), 400)
  }
  if (body === null)
    return context.html(render(locale, '', serverM('reset.invalid', locale)), 413)
  const form = new URLSearchParams(body)
  const token = form.get('token') ?? ''
  const password = form.get('password') ?? ''
  if (!token || token.length > PASSWORD_RESET.MAX_TOKEN_LENGTH || password.length > passwordPolicy().maxLength)
    return context.html(render(locale, '', serverM('reset.invalid', locale)), 400)
  if (password !== form.get('confirm'))
    return context.html(render(locale, token, serverM('reset.mismatch', locale)), 400)
  const result = await iam.user.confirmPasswordReset(token, password)
  return context.html(render(locale, result.success ? '' : token, serverM(result.success ? 'reset.done' : 'reset.failed', locale)), result.success ? 200 : 400)
}
