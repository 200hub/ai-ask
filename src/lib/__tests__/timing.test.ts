import { TIMING } from '$lib/utils/constants'

import { describe, expect, it } from 'vitest'

describe('tIMING warm-start configuration', () => {
  it('uses a strictly shorter delay for warm webview resumes', () => {
    expect(TIMING.MIN_WEBVIEW_LOADING_WARM_MS).toBeLessThan(TIMING.MIN_WEBVIEW_LOADING_MS)
  })

  it('keeps both delays as positive finite numbers', () => {
    expect(TIMING.MIN_WEBVIEW_LOADING_MS).toBeGreaterThan(0)
    expect(TIMING.MIN_WEBVIEW_LOADING_WARM_MS).toBeGreaterThan(0)
    expect(Number.isFinite(TIMING.MIN_WEBVIEW_LOADING_MS)).toBe(true)
    expect(Number.isFinite(TIMING.MIN_WEBVIEW_LOADING_WARM_MS)).toBe(true)
  })
})
