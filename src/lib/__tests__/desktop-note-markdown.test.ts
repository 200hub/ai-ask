import { renderDesktopNoteMarkdown } from '$lib/utils/desktop-note-markdown'
import { describe, expect, it } from 'vitest'

describe('desktop note markdown rendering', () => {
  it('renders standard markdown syntax', () => {
    const html = renderDesktopNoteMarkdown('# Title\n\n- item')

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<li>item</li>')
  })

  it('removes dangerous tags and inline handlers from rendered html', () => {
    const html = renderDesktopNoteMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror=')
  })
})
