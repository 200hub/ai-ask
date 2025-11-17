import type { ExtractScriptResult, FormattedExtractResult } from '$lib/types/injection'
// 将 AI 平台返回的 HTML 转换成 Markdown，并进行代码语言识别与清理的核心工具模块
// 说明：
// 1. 仅添加中文注释，不修改原有逻辑与行为。
// 2. 日志仍保持英文（项目规范），注释使用中文帮助维护者理解。
// 3. 代码块语言检测尽量通用，避免平台定制化。按钮/工具栏等交互元素已在净化阶段剔除。
import TurndownService from 'turndown'

import { gfm } from 'turndown-plugin-gfm'
import {
  CODE_LANGUAGE_ALIASES,
  CODE_LANGUAGE_LABEL_MAX_LENGTH,
  DEFAULT_EXTRACT_OUTPUT_FORMAT,
  KNOWN_CODE_LANGUAGES,
} from './constants'
import { logger } from './logger'

// Turndown 配置：统一的 Markdown 风格（ATX 标题、围栏代码块、星号加粗/斜体、短横列表）
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
})

// 启用 GFM 支持（表格 / 删除线 / 任务列表等）
turndown.use(gfm)

// 可识别的有效语言集合（用于快速校验）
const VALID_LANGUAGES = new Set<string>(KNOWN_CODE_LANGUAGES)
// 常见用于承载语言信息的属性名称集合（多平台兼容）
const LANGUAGE_ATTR_NAMES = [
  'class',
  'lang',
  'data-language',
  'data-lang',
  'data-code-language',
  'data-code-lang',
  'data-language-id',
  'data-language-name',
  'data-mode',
  'data-lexer',
  'aria-label',
] as const
// 在邻近区域内查找可能包含语言标签的元素选择器集合
const LANGUAGE_LABEL_QUERY = [
  '[data-language]',
  '[data-lang]',
  '[data-code-language]',
  '[data-language-name]',
  '[class*="code-block"]',
  '[class*="CodeBlock"]',
  '[class*="codeHeader"]',
  '[class*="code-header"]',
  '[class*="code-toolbar"]',
  '[class*="codeToolbar"]',
  '[class*="code-info"]',
  '[class*="codeInfo"]',
  '[class*="language-label"]',
  '[class*="languageLabel"]',
  '[class*="gds-title"]',
].join(', ')
// 排除类名中包含明显与语言标签无关或与复制按钮相关的元素（减少误判）
const LABEL_TEXT_EXCLUDE_CLASS = /token|hljs|copy|button|icon/i
// 在 HTML 净化阶段要移除的交互性/装饰性元素选择器（防止被错误提取进 Markdown）
const SANITIZE_REMOVAL_SELECTORS = [
  'button',
  '[role="button"]',
  '[aria-label="复制"]',
  '[aria-label="复制代码"]',
  '[aria-label="copy"]',
  '[aria-label="copy code"]',
  '[aria-label="Copy code"]',
  '[aria-label="Copy"]',
  '[aria-label*="复制"]',
  '[aria-label*="copy"]',
  '.copy-button',
  '.copyButton',
  '.copy-code-button',
  '.code-info-button-text',
  '.code-info-button',
  '.codeBlockToolbar',
  '.code-block-toolbar',
  '.code-toolbar',
  '.codeToolbar',
  '.md-code-block-banner .buttons',
  '.md-code-block .buttons',
  '.code-block .buttons',
  '.formatted-code-block-buttons',
  '.formatted-code-block-toolbar',
]

// 将原始抓取的 HTML 进行净化：移除复制按钮 / 工具栏等不需要的内容，仅保留核心语义
function sanitizeExtractedHtml(html: string): string {
  if (!html) {
    return html
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const root = doc.body

    SANITIZE_REMOVAL_SELECTORS.forEach((selector) => {
      root.querySelectorAll(selector).forEach(node => node.remove())
    })

    return root.innerHTML
  }
  catch (error) {
    logger.warn('Failed to sanitize extracted HTML', error)
    return html
  }
}

// 规范化单个语言标记：清理前缀、非法字符、映射别名，返回标准语言或 null
function normalizeLanguageToken(token: string): string | null {
  let normalized = token.toLowerCase().trim()
  if (!normalized) {
    return null
  }

  normalized = normalized.replace(/^(?:language|lang|code|syntax|source)[-_:]/, '')
  normalized = normalized.replace(/^(?:language|lang|code|syntax|source)/, '')
  normalized = normalized.replace(/[^a-z0-9+#]/g, '')

  if (!normalized) {
    return null
  }

  const alias = CODE_LANGUAGE_ALIASES[normalized]
  if (alias) {
    normalized = alias
  }

  if (VALID_LANGUAGES.has(normalized)) {
    return normalized
  }

  return null
}

// 针对原始候选字符串（可能包含多个词）拆分尝试匹配语言（第一个匹配成功即返回）
function normalizeLanguageCandidate(raw?: string | null): string | null {
  if (!raw) {
    return null
  }

  const condensed = raw.replace(/\s+/g, ' ').trim()
  if (!condensed) {
    return null
  }

  const direct = normalizeLanguageToken(condensed)
  if (direct) {
    return direct
  }

  const tokens = condensed.split(/[\s,;|/\\()[\]{}"'`<>:]+/).filter(Boolean)
  for (const token of tokens) {
    const normalized = normalizeLanguageToken(token)
    if (normalized) {
      return normalized
    }
  }

  return null
}

// 收集元素及其 data-* 属性中可能蕴含的语言线索值
function collectAttributeCandidates(element?: Element | null): string[] {
  if (!element) {
    return []
  }

  const values: string[] = []
  for (const attr of LANGUAGE_ATTR_NAMES) {
    const value = element.getAttribute(attr)
    if (value) {
      values.push(value)
    }
  }

  const dataset = (element as HTMLElement).dataset ?? {}
  Object.entries(dataset).forEach(([key, value]) => {
    if (value && /lang|code/i.test(key)) {
      values.push(value)
    }
  })

  return values
}

// 向上与同级有限深度（最多 4 层）收集潜在标签文本（过滤过长、多行、包含排除类名的内容）
function collectNearbyLabelTexts(node?: Element | null): string[] {
  if (!node) {
    return []
  }

  const labels: string[] = []
  const visited = new Set<Element>()

  const considerElement = (element: Element | null) => {
    if (!element || visited.has(element)) {
      return
    }
    visited.add(element)

    const tagName = element.tagName.toLowerCase()
    if (tagName === 'code' || tagName === 'pre' || tagName === 'svg' || tagName === 'button') {
      return
    }

    const classAttr = element.getAttribute('class') ?? ''
    if (LABEL_TEXT_EXCLUDE_CLASS.test(classAttr)) {
      return
    }

    const text = element.textContent ?? ''
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > CODE_LANGUAGE_LABEL_MAX_LENGTH || /\n/.test(trimmed)) {
      return
    }

    labels.push(trimmed)
  }

  const containers = new Set<Element>()
  let current: Element | null = node
  for (let depth = 0; depth < 4 && current; depth++) {
    containers.add(current)
    if (current.parentElement) {
      containers.add(current.parentElement)
    }
    if (current.previousElementSibling) {
      containers.add(current.previousElementSibling)
    }
    if (current.nextElementSibling) {
      containers.add(current.nextElementSibling)
    }
    current = current.parentElement
  }

  containers.forEach((container) => {
    container.querySelectorAll(LANGUAGE_LABEL_QUERY).forEach((el) => {
      considerElement(el as Element)
    })
    considerElement(container)
  })

  return labels
}

// 核心语言检测：综合节点自身、父级链、邻近标签文本，逐步归一化尝试返回匹配语言
function detectCodeLanguage(node?: Element | null): string {
  if (!node) {
    return ''
  }

  const candidates: string[] = []
  const seen = new Set<string>()
  const addCandidate = (value?: string | null) => {
    if (!value) {
      return
    }
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    candidates.push(trimmed)
  }

  collectAttributeCandidates(node).forEach(addCandidate)
  let parent: Element | null = node.parentElement
  let depth = 0
  while (parent && depth < 4) {
    collectAttributeCandidates(parent).forEach(addCandidate)
    parent = parent.parentElement
    depth++
  }

  collectNearbyLabelTexts(node).forEach(addCandidate)

  for (const candidate of candidates) {
    const language = normalizeLanguageCandidate(candidate)
    if (language) {
      return language
    }
  }

  return ''
}

// Turndown 自定义规则：将 <pre><code> 结构转换为围栏代码块，并附带检测出的语言前缀
turndown.addRule('fencedPreCodeBlocks', {
  filter: node => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const preElement = node as HTMLElement
    const codeElement = preElement.querySelector('code')
    const rawText = codeElement?.textContent ?? preElement.textContent ?? ''
    const normalized = rawText.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ')
    const trimmed = normalized.replace(/\s+$/u, '')
    const language = detectCodeLanguage(codeElement || preElement)
    const langSuffix = language || ''
    return `\n\n\`\`\`${langSuffix}\n${trimmed}\n\`\`\`\n\n`
  },
})

// 主入口：对提取结果进行格式化（按需要转换为 markdown），返回统一结构
export function formatExtractedContent(
  result?: Partial<ExtractScriptResult> | null,
): FormattedExtractResult | null {
  if (!result) {
    return null
  }

  const format = result.format ?? DEFAULT_EXTRACT_OUTPUT_FORMAT
  const text = (result.content ?? '').trim()
  const html = (result.html ?? '').trim() || undefined

  let markdown: string | undefined

  if (format === 'markdown') {
    if (html && html.length > 0) {
      try {
        const sanitizedHtml = sanitizeExtractedHtml(html)
        markdown = turndown.turndown(sanitizedHtml).trim()
      }
      catch (error) {
        logger.warn('Failed to convert HTML to markdown', error)
        markdown = text
      }
    }
    else if (text.length > 0) {
      markdown = text
    }
  }

  return {
    format,
    text,
    markdown,
    html,
  }
}

// 获取用于界面显示的文本：优先 markdown（若选择该格式并成功转换），否则回退到原始 text
export function getExtractedDisplayText(result?: Partial<ExtractScriptResult> | null): string {
  const formatted = formatExtractedContent(result)
  if (!formatted) {
    return ''
  }

  if (formatted.format === 'markdown' && formatted.markdown) {
    return formatted.markdown
  }

  return formatted.text
}
