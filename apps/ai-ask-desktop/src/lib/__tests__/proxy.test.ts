import { createProxySignature, resolveProxyUrl } from '$lib/utils/proxy'
import { describe, expect, it } from 'vitest'

describe('proxy utilities', () => {
  it('creates deterministic proxy signatures', () => {
    expect(createProxySignature(null)).toBe('system')
    expect(createProxySignature({ type: 'system' })).toBe('system')
    expect(createProxySignature({ type: 'custom', host: ' 127.0.0.1 ', port: '8080' })).toBe(
      '["custom","127.0.0.1","8080"]',
    )
  })

  it('resolves custom proxy urls with defaults', () => {
    expect(resolveProxyUrl(null)).toBeNull()
    expect(resolveProxyUrl({ type: 'system' })).toBeNull()

    expect(resolveProxyUrl({ type: 'custom', host: '127.0.0.1', port: '8080' })).toBe(
      'http://127.0.0.1:8080',
    )

    expect(resolveProxyUrl({ type: 'custom', host: 'socks5://192.168.0.1', port: '1080' })).toBe(
      'socks5://192.168.0.1:1080',
    )

    expect(() => resolveProxyUrl({ type: 'custom', host: 'invalid host' })).toThrow('Invalid custom proxy configuration')
  })

  it('uses port embedded in host url when missing explicit port', () => {
    expect(resolveProxyUrl({ type: 'custom', host: 'http://proxy.example.com:9000' })).toBe(
      'http://proxy.example.com:9000',
    )
  })
  it.each([
    { host: 'https://proxy.example.com', port: '80' },
    { host: 'http://user:secret@proxy.example.com', port: '80' },
    { host: 'http://proxy.example.com/path', port: '80' },
    { host: 'http://proxy.example.com?secret=token', port: '80' },
    { host: 'http://proxy.example.com#fragment', port: '80' },
    { host: '127.0.0.1', port: '65536' },
    { host: '127.0.0.1', port: '1e3' },
    { host: '127.0.0.1', port: '0' },
    { host: 'socks5://127.0.0.1' },
  ])('rejects invalid custom proxy without leaking its value: %j', (config) => {
    expect(() => resolveProxyUrl({ type: 'custom', ...config })).toThrow('Invalid custom proxy configuration')
  })

  it('honors explicit port, default HTTP port and IPv6', () => {
    expect(resolveProxyUrl({ type: 'custom', host: 'http://proxy.example.com:9000', port: '8080' })).toBe('http://proxy.example.com:8080')
    expect(resolveProxyUrl({ type: 'custom', host: 'proxy.example.com' })).toBe('http://proxy.example.com:80')
    expect(resolveProxyUrl({ type: 'custom', host: 'socks5://[::1]:1080' })).toBe('socks5://[::1]:1080')
  })
})
