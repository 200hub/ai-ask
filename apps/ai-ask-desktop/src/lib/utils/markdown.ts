import type { MarkdownParseOptions } from '@h-ai/ui/components/scenes/ai/index'
import { parseMarkdown } from '@h-ai/ui/components/scenes/ai/index'
import { stripDesktopNoteTodoMetadata } from './desktop-note-todo'

/** 私密便签和划词结果共用 Hai 安全解析，网络图片仅显示替代文本，不改写原文。 */
export function renderMarkdown(markdown: string, options?: Pick<MarkdownParseOptions, 'remoteImages'>): string {
  return parseMarkdown(stripDesktopNoteTodoMetadata(markdown), {
    allowHtmlTags: true,
    enableHighlight: false,
    showCopyButton: false,
    breaks: true,
    remoteImages: options?.remoteImages ?? false,
  })
}
