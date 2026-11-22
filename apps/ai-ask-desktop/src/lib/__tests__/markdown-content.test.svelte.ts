import MarkdownContent from '$lib/components/MarkdownContent.svelte'
import { i18n } from '$lib/i18n'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let target: HTMLDivElement
let component: ReturnType<typeof mount> | undefined

beforeEach(async () => {
  await i18n.locale.set('zh-CN')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (component)
    await unmount(component)
  component = undefined
  target.remove()
})

describe('private Markdown preview', () => {
  it('loads external images only after the user opts in, and can hide them again', () => {
    component = mount(MarkdownContent, {
      target,
      props: {
        content: '![remote](https://images.example/note.png)\n\n<img src="/relative.png" alt="relative">',
        scope: 'note-a',
      },
    })
    flushSync()

    expect(target.querySelector('img')).toBeNull()
    const button = target.querySelector('button')!
    expect(button.textContent).toContain('显示外部图片')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    flushSync(() => button.click())
    expect([...target.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
      'https://images.example/note.png',
      '/relative.png',
    ])
    expect(button.getAttribute('aria-pressed')).toBe('true')

    flushSync(() => button.click())
    expect(target.querySelector('img')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('resets image consent when another note or selection request replaces the content', () => {
    const props = $state({ content: '![remote](https://images.example/note.png)', scope: 'request-a' })
    component = mount(MarkdownContent, { target, props })
    flushSync()
    flushSync(() => target.querySelector('button')!.click())
    expect(target.querySelector('img')).not.toBeNull()

    flushSync(() => {
      props.scope = 'request-b'
    })
    expect(target.querySelector('img')).toBeNull()
    expect(target.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')

    flushSync(() => {
      props.scope = 'request-a'
    })
    expect(target.querySelector('img')).toBeNull()
  })

  it('keeps embedded images visible and preserves the framework URL whitelist after opt-in', () => {
    component = mount(MarkdownContent, {
      target,
      props: {
        content: '![embedded](data:image/png;base64,aGVsbG8=)\n\n![remote](https://images.example/note.png)\n\n<img src="javascript:alert(1)" onerror="alert(1)" alt="unsafe">\n\n```md\n![literal](https://images.example/code.png)\n```',
        scope: 'note-a',
      },
    })
    flushSync()

    expect(target.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(target.querySelectorAll('img')).toHaveLength(1)
    flushSync(() => target.querySelector('button')!.click())

    expect(target.querySelector('img[src="https://images.example/note.png"]')).not.toBeNull()
    expect(target.querySelector('img[src^="javascript:"], [onerror], script')).toBeNull()
    expect(target.querySelector('img[src="https://images.example/code.png"]')).toBeNull()
    expect(target.querySelector('code')?.textContent).toContain('![literal](https://images.example/code.png)')
  })
})
