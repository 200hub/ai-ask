import type { InjectionAction } from '$lib/types/injection'
import { compileFunction, Script } from 'node:vm'
import { generateClickScript, generateFillScript, generateInjectionScript } from '$lib/utils/injection'
import { ALL_TEMPLATES, QIANWEN_TEMPLATES } from '$lib/utils/injection-templates'
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

function executeSelectionScript(options: Parameters<typeof generateInjectionScript>[1]) {
  const location = { href: '' }
  const run = compileFunction(`return ${generateInjectionScript(actions, options)}`, ['window', 'document', 'Event', 'console', 'setTimeout'])
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    location,
    result: run({ location }, document, Event, logger, setTimeout) as Promise<{
      success: boolean
      results: Array<{ result: { content?: string } }>
      error?: string
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
})
