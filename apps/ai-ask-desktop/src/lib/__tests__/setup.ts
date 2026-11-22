import { beforeEach, vi } from 'vitest'

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

vi.mock('$lib/utils/logger', () => ({ logger: log, log }))

beforeEach(() => {
  log.debug.mockClear()
  log.info.mockClear()
  log.warn.mockClear()
  log.error.mockClear()
})

interface MatchMediaResult {
  matches: boolean
  media: string
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
  onchange: null
  addListener: (listener: () => void) => void
  removeListener: (listener: () => void) => void
  dispatchEvent: () => boolean
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(
      (query: string): MatchMediaResult => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    ),
  })
}
