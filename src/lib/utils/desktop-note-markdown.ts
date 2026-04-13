/**
 * 桌面便签 Markdown 渲染工具
 *
 * 说明：
 * - 当前实现优先保证安全，禁用原始 HTML 注入
 * - 允许标准 Markdown 语法（标题、列表、代码块、链接等）
 */
import { marked } from 'marked'

function stripDangerousHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html
  }

  const parser = new DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')

  documentNode.querySelectorAll('script, style').forEach(node => node.remove())

  documentNode.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.toLowerCase()
      if (name.startsWith('on') || value.includes('javascript:')) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return documentNode.body.innerHTML
}

export function renderDesktopNoteMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown ?? '', {
    breaks: true,
    gfm: true,
  })

  return stripDangerousHtml(typeof rendered === 'string' ? rendered : '')
}
