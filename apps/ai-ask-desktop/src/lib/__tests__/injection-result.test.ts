import type { InjectionResult } from '$lib/types/injection'
import { Buffer } from 'node:buffer'
import { compileFunction } from 'node:vm'
import { generateInjectionScript } from '$lib/utils/injection'
import { isInjectionResult, parseInjectionResultEvent, subscribeInjectionResults } from '$lib/utils/injection-result'
import { describe, expect, it, vi } from 'vitest'

const extraction: InjectionResult = {
  success: true,
  duration: 42,
  actionsExecuted: 1,
  results: [{ index: 0, type: 'extract', result: { success: true, content: 'Actual page reply', format: 'text' } }],
}

describe('injection result boundary', () => {
  it('receives actual generated script extraction through the existing navigation result protocol', async () => {
    const location = { href: '' }
    const script = generateInjectionScript([{
      type: 'extract',
      extractScript: '() => "Actual AI reply 实际回复"',
      outputFormat: 'text',
    }])
    const execute = compileFunction(`return ${script}`, ['window', 'console'])
    await execute({ location }, { log: vi.fn(), error: vi.fn(), warn: vi.fn() })
    const navigation = new URL(location.href)
    expect(navigation.origin).toBe('http://injection.localhost')
    expect(navigation.pathname).toBe('/result')
    const data: unknown = JSON.parse(Buffer.from(navigation.searchParams.get('d')!, 'base64url').toString('utf8'))
    expect(parseInjectionResultEvent({ id: 'debug-chatgpt', success: true, result: data }, 'debug-chatgpt'))
      .toMatchObject({ success: true, results: [{ type: 'extract', result: { content: 'Actual AI reply 实际回复' } }] })
  })

  it('accepts the actual native success envelope and retains typed extraction data', () => {
    expect(parseInjectionResultEvent({ id: 'debug-chatgpt', success: true, result: extraction }, 'debug-chatgpt')).toEqual(extraction)
  })

  it('ignores another platform, inactive windows, and malformed native envelopes', () => {
    const payload = { id: 'debug-chatgpt', success: true, result: extraction }
    expect(parseInjectionResultEvent(payload, 'debug-claude')).toBeNull()
    expect(parseInjectionResultEvent(payload, null)).toBeNull()
    expect(parseInjectionResultEvent({ ...payload, success: 'true' }, 'debug-chatgpt')).toBeNull()
    expect(parseInjectionResultEvent({ ...payload, result: { success: true, results: {} } }, 'debug-chatgpt')).toBeNull()
  })

  it('handles native transport failure without reporting success', () => {
    expect(parseInjectionResultEvent({ id: 'debug-chatgpt', success: false, error: 'Invalid result encoding' }, 'debug-chatgpt'))
      .toEqual({ success: false, error: 'Invalid result encoding' })
  })

  it.each([
    null,
    { success: 'true' },
    { success: true, duration: Number.NaN },
    { success: true, actionsExecuted: -1 },
    { success: true, error: {} },
    { success: true, results: [null] },
    { success: true, results: [{ index: 0, type: 'extract', result: { success: true, content: {} } }] },
    { success: true, results: [{ index: 0, type: 'extract', result: { success: true, format: 'html' } }] },
  ])('rejects untrusted result data: %j', (value) => {
    expect(isInjectionResult(value)).toBe(false)
  })
})

describe('asynchronous injection listener ownership', () => {
  it('releases a listener that resolves after disposal and ignores late events', async () => {
    let resolve!: (stop: () => void) => void
    let send!: (payload: unknown) => void
    const stop = vi.fn()
    const receive = vi.fn()
    const subscription = subscribeInjectionResults((handler) => {
      send = handler
      return new Promise((done) => {
        resolve = done
      })
    }, () => 'debug-chatgpt', receive)
    subscription.dispose()
    send({ id: 'debug-chatgpt', success: true, result: extraction })
    resolve(stop)
    await subscription.ready
    subscription.dispose()
    expect(stop).toHaveBeenCalledOnce()
    expect(receive).not.toHaveBeenCalled()
  })

  it('uses the current platform at delivery time and releases an established listener once', async () => {
    let send!: (payload: unknown) => void
    let activeId: string | null = 'debug-chatgpt'
    const stop = vi.fn()
    const receive = vi.fn()
    const subscription = subscribeInjectionResults(async (handler) => {
      send = handler
      return stop
    }, () => activeId, receive)
    await subscription.ready
    activeId = 'debug-claude'
    send({ id: 'debug-chatgpt', success: true, result: extraction })
    send({ id: 'debug-claude', success: true, result: extraction })
    activeId = null
    send({ id: 'debug-claude', success: true, result: extraction })
    expect(receive).toHaveBeenCalledExactlyOnceWith(extraction)
    subscription.dispose()
    subscription.dispose()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('propagates registration failure to the page', async () => {
    const failure = new Error('Native listener registration failed')
    const subscription = subscribeInjectionResults(async () => {
      throw failure
    }, () => 'debug-chatgpt', vi.fn())
    await expect(subscription.ready).rejects.toBe(failure)
    subscription.dispose()
  })
})
