import { registerExitFlush } from '$lib/utils/exit-flush'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callbacks, invoke, cleanup } = vi.hoisted(() => ({
  callbacks: new Map<string, (event: { payload: { requestId: number } }) => Promise<void> | void>(),
  invoke: vi.fn(),
  cleanup: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, callback) => {
    callbacks.set(name, callback)
    return cleanup
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

beforeEach(() => {
  callbacks.clear()
  vi.clearAllMocks()
  invoke.mockResolvedValue(undefined)
})

describe('exit persistence handshake', () => {
  it('waits for this window to finish saving before acknowledging', async () => {
    let saved!: () => void
    const flush = vi.fn(() => new Promise<void>((resolve) => {
      saved = resolve
    }))
    const setExiting = vi.fn()
    await registerExitFlush({ flush, setExiting, onFailure: vi.fn() })
    const pending = callbacks.get('app-before-exit')!({ payload: { requestId: 3 } })
    expect(setExiting).toHaveBeenCalledWith(true)
    expect(invoke).not.toHaveBeenCalled()
    saved()
    await pending
    expect(invoke).toHaveBeenCalledWith('complete_exit_flush', { requestId: 3, error: null })
  })

  it('reports a disk error instead of acknowledging a successful save', async () => {
    await registerExitFlush({ flush: vi.fn().mockRejectedValue(new Error('Disk full')), setExiting: vi.fn(), onFailure: vi.fn() })
    await callbacks.get('app-before-exit')!({ payload: { requestId: 4 } })
    expect(invoke).toHaveBeenCalledWith('complete_exit_flush', { requestId: 4, error: 'Disk full' })
  })

  it('unlocks editing on cancelled exit and permits a new request', async () => {
    const setExiting = vi.fn()
    const onFailure = vi.fn()
    const flush = vi.fn().mockResolvedValue(undefined)
    await registerExitFlush({ flush, setExiting, onFailure })
    await callbacks.get('app-before-exit')!({ payload: { requestId: 1 } })
    await callbacks.get('app-exit-failed')!({ payload: { requestId: 1 } })
    expect(setExiting).toHaveBeenLastCalledWith(false)
    expect(onFailure).toHaveBeenCalledOnce()
    await callbacks.get('app-before-exit')!({ payload: { requestId: 2 } })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('removes both listeners when the window is disposed', async () => {
    const stop = await registerExitFlush({ flush: vi.fn(), setExiting: vi.fn(), onFailure: vi.fn() })
    stop()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
})
