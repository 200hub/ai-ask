import type { ProxyConfig } from '$lib/types/config'
import { PROXY } from '$lib/utils/constants'

/** 配置签名仅用于比较，不写入日志，避免泄露旧配置中的凭据。 */
export function createProxySignature(proxy: ProxyConfig | null | undefined): string {
  return !proxy || proxy.type === 'system'
    ? 'system'
    : JSON.stringify([proxy.type, proxy.host?.trim(), proxy.port?.trim()])
}

/** 无效自定义配置必须中止创建，不能悄悄回退到系统代理。 */
export function resolveProxyUrl(proxy: ProxyConfig | null | undefined): string | null {
  if (!proxy || proxy.type === 'system')
    return null
  const invalid = () => new Error('Invalid custom proxy configuration')
  const host = proxy.host?.trim()
  if (proxy.type !== 'custom' || !host)
    throw invalid()
  let parsed: URL
  try {
    parsed = new URL(host.includes('://') ? host : `${PROXY.DEFAULT_SCHEME}://${host}`)
  }
  catch {
    throw invalid()
  }
  if (!PROXY.SCHEMES.includes(parsed.protocol)
    || !parsed.hostname || parsed.username || parsed.password
    || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw invalid()
  }
  const rawPort = proxy.port?.trim() || parsed.port
    || (parsed.protocol === `${PROXY.DEFAULT_SCHEME}:` ? String(PROXY.DEFAULT_HTTP_PORT) : '')
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < PROXY.MIN_PORT || port > PROXY.MAX_PORT)
    throw invalid()
  return `${parsed.protocol}//${parsed.hostname}:${port}`
}
