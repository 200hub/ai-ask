import { renderMarkdown } from '$lib/utils/markdown'
import { describe, expect, it } from 'vitest'

describe('desktop note markdown rendering', () => {
  it('renders standard markdown syntax', () => {
    const html = renderMarkdown('# Title\n\n- item')

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<li>item</li>')
  })

  it('removes dangerous tags and inline handlers from rendered html', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror=')
  })

  it.each([
    '![private preview](https://tracker.example/note.png)',
    '![private preview](http://127.0.0.1/private.png)',
    '![private preview](/private/note.png)',
    '![private preview](//tracker.example/note.png)',
    '![private preview](./note.png)',
    '<img src="https://tracker.example/note.png" alt="private preview">',
    '<img src="/private/note.png" alt="private preview" width="200" height="100">',
  ])('shows image alternative text without requesting private preview source: %s', (source) => {
    const documentNode = new DOMParser().parseFromString(renderMarkdown(source), 'text/html')

    expect(documentNode.querySelector('img')).toBeNull()
    expect(documentNode.body.textContent).toContain('private preview')
    expect(documentNode.querySelector('.hai-md-image-placeholder')).not.toBeNull()
  })

  it('keeps embedded images and image syntax in code', () => {
    const source = '![embedded](data:image/png;base64,aGVsbG8=)\n\n<img src="data:image/png;base64,aGVsbG8=" alt="embedded html">\n\n```md\n![original](https://tracker.example/original.png)\n```'
    const documentNode = new DOMParser().parseFromString(renderMarkdown(source), 'text/html')

    expect([...documentNode.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
      'data:image/png;base64,aGVsbG8=',
      'data:image/png;base64,aGVsbG8=',
    ])
    expect(documentNode.querySelector('code')?.textContent).toContain('![original](https://tracker.example/original.png)')
  })

  it('escapes blocked image alternative text through the framework renderer', () => {
    const documentNode = new DOMParser().parseFromString(renderMarkdown('<img src="https://tracker.example/note.png" alt="&lt;script&gt;alert(1)&lt;/script&gt;">'), 'text/html')

    expect(documentNode.querySelector('img, script')).toBeNull()
    expect(documentNode.querySelector('.hai-md-image-placeholder')?.textContent).toContain('script')
  })

  it.each([
    '<iframe srcdoc="<script>window.pwned=true</script>"></iframe>',
    '<object data="javascript:alert(1)"></object><embed src="data:text/html,bad">',
    '<form action="https://attacker.example"><input autofocus onfocus="alert(1)"></form>',
    '<svg><a href="javascript:alert(1)">bad</a></svg>',
    '<a href="java&#x09;script:alert(1)" onclick="alert(1)">bad</a>',
    '[bad](javascript:alert%281%29) ![bad](data:text/html,bad)',
  ])('does not create executable content from %s', (source) => {
    const documentNode = new DOMParser().parseFromString(renderMarkdown(source), 'text/html')
    expect(documentNode.querySelector('script, iframe, object, embed, form, input:not([disabled]), svg')).toBeNull()
    for (const element of documentNode.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on|^srcdoc$/i)
        if (['href', 'src'].includes(attribute.name)) {
          expect(attribute.value.replace(/\s/g, '')).not.toMatch(/^(javascript|data|vbscript):/i)
        }
      }
    }
  })

  it('preserves safe links, task lists, tables and escaped code', () => {
    const html = renderMarkdown('[safe](https://example.com)\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```html\n<script>bad</script>\n```')
    const documentNode = new DOMParser().parseFromString(html, 'text/html')
    expect(documentNode.querySelector('a')?.getAttribute('rel')).toContain('noopener')
    expect(documentNode.querySelector('input')?.disabled).toBe(true)
    expect(documentNode.querySelector('table')).not.toBeNull()
    expect(documentNode.querySelector('code')?.textContent).toContain('<script>bad</script>')
    expect(documentNode.querySelector('script')).toBeNull()
  })
})
