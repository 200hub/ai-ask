import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HashRouter } from '../navigation/hash-router.svelte'

const PAGE_FILES = [
  '../pages/index.svelte',
  '../pages/sticky-note.svelte',
  '../pages/toolbar.svelte',
  '../pages/toolbar-result.svelte',
]

let stopRouting: (() => void) | undefined

beforeEach(() => {
  history.replaceState(null, '', '/')
})

afterEach(() => {
  stopRouting?.()
  stopRouting = undefined
})

describe('hai desktop hash navigation', () => {
  it('restores a native note route and its encoded note identifier', () => {
    location.hash = '#/sticky-note?noteId=note%23one'
    const router = new HashRouter(PAGE_FILES, '/')
    stopRouting = router.start()

    expect(router.path).toBe('/sticky-note')
    expect(router.file).toBe('../pages/sticky-note.svelte')
    expect(new URLSearchParams(router.search).get('noteId')).toBe('note#one')
  })

  it('renders the matching toolbar pages through the shared entry point', () => {
    const router = new HashRouter(PAGE_FILES, '/')
    stopRouting = router.start()

    router.navigate('/toolbar')
    expect(router.file).toBe('../pages/toolbar.svelte')
    router.navigate('/toolbar-result?requestId=one')
    expect(router.file).toBe('../pages/toolbar-result.svelte')
    expect(router.search).toBe('?requestId=one')
    expect(location.hash).toBe('#/toolbar-result?requestId=one')
  })

  it('falls back to the main page for unknown paths and nonlocal navigation', () => {
    const router = new HashRouter(PAGE_FILES, '/')
    stopRouting = router.start()

    for (const target of ['/unknown?noteId=wrong', '//remote.example', 'https://remote.example', '/\\remote.example']) {
      router.navigate(target)
      expect(router.path).toBe('/')
      expect(router.search).toBe('')
      expect(router.file).toBe('../pages/index.svelte')
    }
  })

  it('observes hash history changes until the router is stopped', () => {
    const router = new HashRouter(PAGE_FILES, '/')
    const changed = () => undefined
    stopRouting = router.start(changed)
    location.hash = '#/toolbar'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(router.path).toBe('/toolbar')

    stopRouting()
    location.hash = '#/sticky-note?noteId=ignored'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(router.path).toBe('/toolbar')
  })
})
