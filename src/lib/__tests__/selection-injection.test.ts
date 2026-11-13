import type { InjectionAction } from '$lib/types/injection'
import { compileFunction, Script } from 'node:vm'
import { generateClickScript, generateFillScript, generateInjectionScript } from '$lib/utils/injection'
import { ALL_TEMPLATES, CHATGPT_TEMPLATES, QIANWEN_TEMPLATES } from '$lib/utils/injection-templates'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions: InjectionAction[] = [
  { type: 'fill', selector: '#source', content: 'next request' },
  {
    type: 'extract',
    extractScript: '() => document.querySelector("#result").textContent',
    pollInterval: 100,
    timeout: 2000,
  },
]

function executeSelectionScript(options: Parameters<typeof generateInjectionScript>[1], scriptActions = actions) {
  const location = { href: '' }
  const run = compileFunction(`return ${generateInjectionScript(scriptActions, options)}`, [
    'window',
    'document',
    'Event',
    'InputEvent',
    'MouseEvent',
    'PointerEvent',
    'console',
    'setTimeout',
    'getComputedStyle',
  ])
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    location,
    result: run({ location, getComputedStyle }, document, Event, InputEvent, Event, Event, logger, setTimeout, getComputedStyle) as Promise<{
      success: boolean
      results: Array<{ result: { content?: string } }>
      error?: string
      stage?: string
      submitted?: boolean
    }>,
  }
}

describe('floating selection injection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = '<textarea id="source">previous request</textarea><p id="result">previous response</p>'
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('waits for a fresh and stable response and returns the matching request id', async () => {
    const source = document.querySelector('#source')!
    const response = document.querySelector('#result')!
    source.addEventListener('input', () => {
      setTimeout(() => {
        response.textContent = 'partial response'
      }, 400)
      setTimeout(() => {
        response.textContent = 'new response'
      }, 650)
    })

    const { location, result } = executeSelectionScript({ requestId: 41, waitForFreshResult: true })
    await vi.advanceTimersByTimeAsync(650)
    expect(location.href).toBe('')
    await vi.advanceTimersByTimeAsync(700)
    expect((await result).results.at(-1)?.result.content).toBe('new response')
    const reply = new URL(location.href)
    expect(reply.searchParams.get('r')).toBe('41')
    expect(reply.pathname).toBe('/result')
  })

  it('allows the current output when translating the same source again', async () => {
    document.querySelector<HTMLTextAreaElement>('#source')!.value = 'next request'
    const { result } = executeSelectionScript({
      requestId: 42,
      waitForFreshResult: true,
      reuseSameTranslation: true,
    })
    await vi.advanceTimersByTimeAsync(700)
    expect((await result).results.at(-1)?.result.content).toBe('previous response')
  })

  it('fails with a timeout if the previous response never changes', async () => {
    const { result } = executeSelectionScript({ requestId: 43, waitForFreshResult: true })
    await vi.advanceTimersByTimeAsync(2200)
    await expect(result).resolves.toMatchObject({ success: false, error: 'EXTRACT_TIMEOUT' })
  })

  it('generates browser JavaScript for each built-in translation and chat platform', () => {
    for (const template of ALL_TEMPLATES) {
      const script = generateInjectionScript(template.actions, { requestId: 44, waitForFreshResult: true })
      expect(() => new Script(script), template.platformId).not.toThrow()
    }
  })

  it('waits until a visible submit button is enabled', async () => {
    document.body.innerHTML = '<button id="send" disabled>Send</button>'
    const button = document.querySelector<HTMLButtonElement>('#send')!
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 20))
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const script = generateClickScript({ type: 'click', selector: '#send', timeout: 1000 })
    const run = compileFunction(`return ${script}`, ['window', 'document', 'console', 'setTimeout', 'MouseEvent', 'PointerEvent'])
    const result = run(window, document, { log: vi.fn() }, setTimeout, Event, Event)
    const finished = expect(result).resolves.toMatchObject({ success: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(clicked).not.toHaveBeenCalled()
    button.disabled = false
    await vi.advanceTimersByTimeAsync(150)
    await finished
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('passes Qianwen text through Slate beforeinput without replacing the editor DOM', async () => {
    document.body.innerHTML = '<div data-slate-editor="true" contenteditable="true"><p>Existing draft</p></div>'
    const editor = document.querySelector('[data-slate-editor]')!
    const paragraph = editor.firstElementChild
    let selected = ''
    let inserted: string | null = null
    editor.addEventListener('beforeinput', (event) => {
      event.preventDefault()
      selected = document.getSelection()?.toString() ?? ''
      inserted = (event as InputEvent).data
    })
    const fill = QIANWEN_TEMPLATES[0].actions.find(action => action.type === 'fill')!
    const script = generateFillScript({ ...fill, content: 'Explain a triangle' })
    const run = compileFunction(`return ${script}`, ['document', 'console', 'InputEvent'])
    await expect(run(document, { log: vi.fn() }, InputEvent)).resolves.toMatchObject({ success: true })
    expect(selected).toBe('Existing draft')
    expect(inserted).toBe('Explain a triangle')
    expect(editor.firstElementChild).toBe(paragraph)
  })

  it('extracts only the last completed Qianwen response', () => {
    document.body.innerHTML = `
      <div class="answer-common-card"><div class="qk-markdown-complete">Previous answer</div></div>
      <div class="answer-common-card"><div class="qk-markdown">New answer</div></div>
    `
    const extract = QIANWEN_TEMPLATES[0].actions.find(action => action.type === 'extract')!
    const run = compileFunction(`return (${extract.extractScript})();`, ['document'])
    expect(run(document)).toBe('')
    document.querySelector('.qk-markdown')!.classList.add('qk-markdown-complete')
    expect(run(document)).toEqual({ text: 'New answer', html: 'New answer' })
  })

  it('waits for ChatGPT completion on the newest turn and accepts its copy control', () => {
    document.body.innerHTML = `
      <article>
        <div data-message-author-role="assistant"><div class="markdown">Previous answer</div></div>
        <button data-testid="good-response-turn-action-button"></button>
      </article>
      <article><div data-message-author-role="assistant"><div class="markdown">New answer</div></div></article>
    `
    const extract = CHATGPT_TEMPLATES[0].actions.find(action => action.type === 'extract')!
    const run = compileFunction(`return (${extract.extractScript})();`, ['document'])
    expect(run(document)).toBe('')
    document.querySelector('article:last-child')!.insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button"></button>')
    expect(run(document)).toEqual({ text: 'New answer', html: 'New answer' })
  })

  it('uses a native edit, submits to the composer form once and returns confirmed submission', async () => {
    const { composer, button, wrongButton, scriptActions } = setupComposer()
    const outside = vi.fn()
    wrongButton.addEventListener('click', outside)
    const submitted = vi.fn(() => {
      expect(composer.textContent).toBe('Explain the following:\n\n\nA triangle has three sides.')
      composer.replaceChildren()
    })
    button.addEventListener('click', submitted)

    const { result } = executeSelectionScript({ requestId: 45, confirmSubmission: true }, scriptActions)
    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toMatchObject({ success: true, submitted: true })
    expect(submitted).toHaveBeenCalledOnce()
    expect(outside).not.toHaveBeenCalled()
    expect((await result).results[0].result).not.toHaveProperty('composer')
  })

  it('distinguishes an unavailable submit control from a dispatched but unconfirmed click', async () => {
    const { button, wrongButton, scriptActions } = setupComposer()
    button.disabled = true
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    wrongButton.addEventListener('click', clicked)
    const unavailable = executeSelectionScript({ requestId: 46, confirmSubmission: true }, scriptActions)
    await vi.advanceTimersByTimeAsync(300)
    await expect(unavailable.result).resolves.toMatchObject({ success: false, stage: 'submit', submitted: false })
    expect(clicked).not.toHaveBeenCalled()

    button.disabled = false
    const unconfirmed = executeSelectionScript({ requestId: 47, confirmSubmission: true }, scriptActions)
    await vi.advanceTimersByTimeAsync(5500)
    await expect(unconfirmed.result).resolves.toMatchObject({ success: false, stage: 'submit', error: 'SUBMISSION_NOT_CONFIRMED' })
    expect((await unconfirmed.result).submitted).toBeUndefined()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('marks extract timeouts as submitted after an accepted click', async () => {
    const { composer, button, scriptActions } = setupComposer()
    button.addEventListener('click', () => composer.replaceChildren())
    const { result } = executeSelectionScript({ requestId: 48, confirmSubmission: true }, [
      ...scriptActions,
      { type: 'extract', timeout: 200, pollInterval: 100, extractScript: '() => ""' },
    ])
    await vi.advanceTimersByTimeAsync(550)
    await expect(result).resolves.toMatchObject({
      success: false,
      stage: 'extract',
      submitted: true,
      error: 'EXTRACT_TIMEOUT',
    })
  })
})

function setupComposer() {
  document.body.innerHTML = `
    <button class="send">Unrelated send</button>
    <form><div id="composer" class="ProseMirror" contenteditable="true"><p><br></p></div>
      <button type="button" class="send">Send prompt</button>
    </form>
  `
  const composer = document.querySelector<HTMLDivElement>('#composer')!
  const button = document.querySelector<HTMLButtonElement>('form .send')!
  const wrongButton = document.querySelector<HTMLButtonElement>('body > .send')!
  Object.defineProperty(composer, 'isContentEditable', { value: true })
  vi.spyOn(composer, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 80, 20)] as unknown as DOMRectList)
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 20))
  vi.spyOn(wrongButton, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 20))
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((command, _showUi, value) => {
      expect(command).toBe('insertText')
      composer.firstElementChild!.textContent = value.replace('\n\n', '\n\n\n')
      return true
    }),
  })
  const scriptActions: InjectionAction[] = [
    { type: 'fill', selector: '#composer', content: 'Explain the following:\n\nA triangle has three sides.', timeout: 200 },
    { type: 'click', selector: '.send', timeout: 200 },
  ]
  return { composer, button, wrongButton, scriptActions }
}
