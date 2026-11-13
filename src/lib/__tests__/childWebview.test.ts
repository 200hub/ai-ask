import type { ChildWebviewBounds } from '$lib/utils/childWebview'
import {
  BOUNDS_EPSILON,
  boundsEqual,

  ChildWebviewProxy,
} from '$lib/utils/childWebview'
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)

function sampleBounds(): ChildWebviewBounds {
  return {
    positionLogical: { x: 120, y: 64 },
    sizeLogical: { width: 800, height: 600 },
    scaleFactor: 1,
  }
}

describe('boundsEqual', () => {
  it('treats bounds within epsilon as equal', () => {
    const a = sampleBounds()
    const b: ChildWebviewBounds = {
      positionLogical: {
        x: a.positionLogical.x + BOUNDS_EPSILON / 2,
        y: a.positionLogical.y,
      },
      sizeLogical: {
        width: a.sizeLogical.width,
        height: a.sizeLogical.height - BOUNDS_EPSILON / 3,
      },
      scaleFactor: a.scaleFactor,
    }

    expect(boundsEqual(a, b)).toBe(true)
  })

  it('detects meaningful differences', () => {
    const a = sampleBounds()
    const b: ChildWebviewBounds = {
      positionLogical: { ...a.positionLogical },
      sizeLogical: { ...a.sizeLogical, width: a.sizeLogical.width + BOUNDS_EPSILON * 4 },
      scaleFactor: a.scaleFactor,
    }

    expect(boundsEqual(a, b)).toBe(false)
  })
})

describe('childWebviewProxy', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('ensures child webview with requested payload', async () => {
    const bounds = sampleBounds()
    const proxy = new ChildWebviewProxy('foo', 'https://example.com', null)

    await proxy.ensure(bounds)

    expect(invokeMock).toHaveBeenCalledWith('ensure_child_webview', {
      payload: {
        id: 'foo',
        url: 'https://example.com',
        bounds,
        proxyUrl: null,
      },
    })
    expect(proxy.isVisible()).toBe(false)
  })

  it('avoids redundant bounds updates', async () => {
    const bounds = sampleBounds()
    const proxy = new ChildWebviewProxy('bar', 'https://example.com', null)
    await proxy.ensure(bounds)

    invokeMock.mockClear()

    await proxy.updateBounds(bounds)
    expect(invokeMock).not.toHaveBeenCalled()

    const updated: ChildWebviewBounds = {
      positionLogical: { ...bounds.positionLogical },
      sizeLogical: { ...bounds.sizeLogical, height: bounds.sizeLogical.height + 10 },
      scaleFactor: bounds.scaleFactor,
    }

    await proxy.updateBounds(updated)
    expect(invokeMock).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenLastCalledWith('set_child_webview_bounds', {
      payload: {
        id: 'bar',
        bounds: updated,
      },
    })
  })

  it('tracks visibility state across show and hide operations', async () => {
    const bounds = sampleBounds()
    const proxy = new ChildWebviewProxy('baz', 'https://example.com', null)
    await proxy.ensure(bounds)

    invokeMock.mockClear()

    await proxy.show()
    expect(invokeMock).toHaveBeenCalledWith('show_child_webview', {
      payload: { id: 'baz' },
    })
    expect(proxy.isVisible()).toBe(true)

    await proxy.show()
    expect(invokeMock).toHaveBeenCalledTimes(1)

    await proxy.hide()
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenLastCalledWith('hide_child_webview', {
      payload: { id: 'baz' },
    })
    expect(proxy.isVisible()).toBe(false)
  })

  it('resets state when closed', async () => {
    const bounds = sampleBounds()
    const proxy = new ChildWebviewProxy('qux', 'https://example.com', null)
    await proxy.ensure(bounds)

    invokeMock.mockClear()

    await proxy.close()
    expect(invokeMock).toHaveBeenCalledWith('close_child_webview', {
      payload: { id: 'qux' },
    })
    expect(proxy.isVisible()).toBe(false)

    await proxy.show()
    expect(invokeMock).toHaveBeenLastCalledWith('show_child_webview', {
      payload: { id: 'qux' },
    })
  })

  it('uses the persisted native page state even if load finished before subscribing', async () => {
    const proxy = new ChildWebviewProxy('alpha', 'https://example.com', null)
    invokeMock.mockResolvedValue(true)

    await expect(proxy.waitForLoadFinished(1000)).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('wait_child_webview_ready', {
      payload: { id: 'alpha' },
      timeoutMs: 1000,
    })
  })

  it('reports a native page load timeout', async () => {
    const proxy = new ChildWebviewProxy('alpha', 'https://example.com', null)
    invokeMock.mockResolvedValue(false)
    await expect(proxy.waitForLoadFinished(1000)).resolves.toBe(false)
  })
})
