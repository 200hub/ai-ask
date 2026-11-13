import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, expect, test } from '@playwright/test'

const executable = process.env.AI_ASK_E2E_EXE
const dataDirectory = process.env.AI_ASK_E2E_DATA
const occupied = 'Control+Alt+Shift+F9'
const replacement = 'Control+Alt+Shift+F10'
const translation = 'Control+Alt+Shift+F11'
const runCommand = promisify(execFile)

const translationPage = `<!doctype html><meta charset="utf-8"><title>Translation fixture</title>
<textarea aria-label="Source text"></textarea>
<div data-language-for-alternatives="zh-CN"></div>
<script>
const output = document.querySelector('div');
document.querySelector('textarea').addEventListener('input', ({ target }) => {
  const text = target.value;
  setTimeout(() => { output.textContent = '译文 ' + text; }, 650);
});
</script>`

const chatPage = `<!doctype html><meta charset="utf-8"><title>AI fixture</title>
<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
<script>
document.querySelector('button').onclick = () => {
  const text = document.querySelector('textarea').value;
  setTimeout(() => {
    const message = document.createElement('article');
    message.innerHTML = '<div data-message-author-role="assistant"><div class="markdown"><p></p></div><button data-testid="good-response-turn-action-button">Like</button></div>';
    message.querySelector('p').textContent = '解释 ' + text;
    document.body.append(message);
  }, 500);
};
</script>`

test.skip(process.platform !== 'win32' || !executable || !dataDirectory, 'Requires a Windows test build with isolated app data')

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a debugging port')
  }
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function openApp(testInfo: TestInfo) {
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}`
  const processOptions = {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  }
  const processHandle = spawn(executable!, [], processOptions)
  const logs: string[] = []
  processHandle.on('exit', (code, signal) => logs.push(`Native process exited: code=${code}, signal=${signal}\n`))
  processHandle.stdout.on('data', chunk => logs.push(String(chunk)))
  processHandle.stderr.on('data', chunk => logs.push(String(chunk)))
  let browser: Browser | undefined
  let closed = false
  async function close() {
    if (closed) {
      return
    }
    closed = true
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      const exited = once(processHandle, 'exit')
      processHandle.kill()
      await exited
    }
    await browser?.close().catch(() => {})
    await testInfo.attach('native-log', { body: logs.join(''), contentType: 'text/plain' })
  }
  try {
    await expect.poll(async () => {
      if (processHandle.exitCode !== null) {
        throw new Error(`AI Ask exited with ${processHandle.exitCode}\n${logs.join('')}`)
      }
      return (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok ?? false
    }, { timeout: 30_000 }).toBe(true)
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    const main = await findWindow(context, 'main')
    main.on('pageerror', error => logs.push(`WebView: ${error.stack ?? error.message}\n`))
    main.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        logs.push(`WebView: ${message.text()}\n`)
      }
    })
    await main.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 12_000 })
    return {
      main,
      context,
      processHandle,
      launchAgain: () => spawn(executable!, [], processOptions),
      close,
    }
  }
  catch (error) {
    await close()
    throw error
  }
}

async function getLabel(page: Page) {
  return page.evaluate(() => (window as unknown as {
    __TAURI_INTERNALS__?: { metadata: { currentWebview: { label: string } } }
  }).__TAURI_INTERNALS__?.metadata.currentWebview.label).catch(() => undefined)
}

async function findWindow(context: BrowserContext, label: string) {
  let matched: Page | undefined
  await expect.poll(async () => {
    for (const page of context.pages()) {
      if ((await getLabel(page))?.startsWith(label)) {
        matched = page
        return true
      }
    }
    return false
  }).toBe(true)
  return matched!
}

function invoke<T>(page: Page, command: string, payload: Record<string, unknown> = {}) {
  return page.evaluate(([command, payload]) => (window as unknown as {
    __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<T> }
  }).__TAURI_INTERNALS__.invoke(command, payload), [command, payload] as const)
}

async function isVisible(page: Page) {
  return invoke<boolean>(page, 'plugin:window|is_visible', { label: await getLabel(page) })
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function seedConfig() {
  if (!dataDirectory!.endsWith('windows-profile')) {
    throw new Error('Expected a dedicated windows-profile test data directory')
  }
  await mkdir(dataDirectory!, { recursive: true })
  const config = {
    app_config: {
      locale: 'zh-CN',
      theme: 'light',
      firstRun: false,
      preloadDefaultPlatforms: false,
      selectionToolbarEnabled: true,
      selectionToolbarUseFloatingWindow: true,
      selectionToolbarDefaultPlatformId: 'chatgpt',
      desktopNotesEnabled: false,
      globalHotkey: occupied,
      translationHotkey: translation,
      selectionToolbarHotkey: 'Control+Alt+Shift+F8',
    },
  }
  await writeFile(resolve(dataDirectory!, 'config.json'), JSON.stringify(config))
}

async function openSettings(page: Page) {
  const settings = page.getByRole('button', { name: '设置', exact: true })
  const navigation = page.getByRole('navigation', { name: '设置' })
  await expect.poll(async () => {
    if (!await navigation.isVisible()) {
      await settings.dispatchEvent('click')
    }
    return navigation.isVisible()
  }).toBe(true)
}

async function addTodo(page: Page, text: string) {
  const edit = page.getByRole('button', { name: '编辑待办清单' })
  const finish = page.getByRole('button', { name: '完成编辑' })
  await expect(edit.or(finish)).toBeVisible()
  if (await edit.isVisible()) {
    await edit.press('Enter')
  }
  const input = page.getByRole('textbox', { name: '新待办事项，按回车添加' })
  await input.fill(text)
  await input.press('Enter')
}

interface NativeWindowState {
  hwnd: number
  visible: boolean
  iconic: boolean
  cloakFlags: number
  centerHitsWindow: boolean
  topmost: boolean
  rect: NativeRect
}

interface NativeRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface DesktopState {
  foregroundHwnd: number
  foregroundClassName: string
  note: NativeWindowState
  main: NativeWindowState
}

async function openDesktopProbe(pid: number) {
  const probe = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./show-desktop.ps1', import.meta.url)),
    '-ProcessId',
    String(pid),
    '-Interactive',
  ], { windowsHide: true })
  const lines = createInterface({ input: probe.stdout })[Symbol.asyncIterator]()
  const exited = once(probe, 'exit')
  let stderr = ''
  probe.stderr.on('data', (chunk: Buffer) => {
    stderr += String(chunk)
  })
  probe.stdin.on('error', () => {})
  async function nextLine() {
    const line = await lines.next()
    if (line.done) {
      throw new Error(`Desktop probe exited. ${stderr}`)
    }
    return JSON.parse(line.value)
  }
  async function close() {
    if (probe.exitCode === null && probe.signalCode === null) {
      probe.stdin.end('{"action":"Exit"}\n')
      await exited
    }
  }
  try {
    expect(await nextLine()).toEqual({ ready: true })
    return {
      async inspect(action = 'Inspect', screenshotPath?: string): Promise<DesktopState> {
        probe.stdin.write(`${JSON.stringify({ action, screenshotPath, settleMs: 180 })}\n`)
        const state = await nextLine() as DesktopState | { error: string }
        if ('error' in state) {
          throw new Error(state.error)
        }
        return state
      },
      close,
    }
  }
  catch (error) {
    await close()
    throw error
  }
}

async function requireInputDesktop() {
  const { stdout } = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./input-desktop.ps1', import.meta.url)),
    '-Describe',
  ], { windowsHide: true })
  const input = JSON.parse(stdout.trim()) as { available: boolean, reason: string | null }
  test.skip(!input.available, input.reason ?? 'Requires the Windows interactive input desktop')
}

interface ExternalSelectionState {
  hwnd: number
  editHwnd: number
  inputForegroundHwnd: number
  inputForegroundPid: number
  foregroundHwnd: number
  foregroundPid: number
  windowClass: string
  editClass: string
  selectedText: string
}

async function openSelectionFixture(testInfo: TestInfo) {
  const fixture = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./external-selection.ps1', import.meta.url)),
  ], { windowsHide: true })
  let logs = ''
  fixture.stderr.on('data', (chunk: Buffer) => {
    logs += String(chunk)
  })
  fixture.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      logs += `${error.message}\n`
    }
  })
  const exited = once(fixture, 'exit')
  const lines = createInterface({ input: fixture.stdout })[Symbol.asyncIterator]()
  async function nextLine() {
    const line = await lines.next()
    if (line.done) {
      throw new Error(`External selection fixture exited. ${logs}`)
    }
    return JSON.parse(line.value)
  }
  async function close() {
    if (fixture.exitCode === null && fixture.signalCode === null) {
      fixture.stdin.end('Exit\n')
      const watchdog = setTimeout(() => fixture.kill(), 2000)
      try {
        await exited
      }
      finally {
        clearTimeout(watchdog)
      }
    }
    await testInfo.attach('external-selection-log', { body: logs, contentType: 'text/plain' })
  }
  try {
    expect(await nextLine()).toEqual({ ready: true })
    return {
      pid: fixture.pid,
      async run(command: 'DragFirst' | 'DragSecond' | 'Hotkey'): Promise<ExternalSelectionState | { inputError: string }> {
        fixture.stdin.write(`${command}\n`)
        const state = await nextLine() as ExternalSelectionState | { inputError: string }
        await testInfo.attach(command, { body: JSON.stringify(state), contentType: 'application/json' })
        if ('inputError' in state) {
          return state
        }
        expect(state.inputForegroundHwnd).toBe(state.hwnd)
        expect(state.inputForegroundPid).toBe(fixture.pid)
        expect(state.editHwnd).not.toBe(state.hwnd)
        expect(state.editClass.toUpperCase()).toBe('EDIT')
        return state
      },
      close,
    }
  }
  catch (error) {
    await close()
    throw error
  }
}

test('native external text selection opens the toolbar and honors ignored apps', async () => {
  await requireInputDesktop()
  const testInfo = test.info()
  await seedConfig()
  const app = await openApp(testInfo)
  let fixture: Awaited<ReturnType<typeof openSelectionFixture>> | undefined
  interface ToolbarState {
    last_text: string | null
    ignored_apps: string[]
  }
  const snapshot = () => invoke<ToolbarState>(app.main, 'get_selection_toolbar_state')
  const first = 'External drag selection'
  const second = 'Ignored external selection'
  async function dragText(command: 'DragFirst' | 'DragSecond', expectedText: string) {
    let selected: ExternalSelectionState | undefined
    // A desktop can coalesce input while the test fixture is being activated. Verify the native selection.
    await expect.poll(async () => {
      const result = await fixture!.run(command)
      if ('inputError' in result) {
        return result.inputError
      }
      selected = result
      return result.selectedText
    }, { timeout: 5000 }).toBe(expectedText)
    return selected!
  }
  async function pressSelectionHotkey(expectedText: string) {
    await expect.poll(async () => {
      const result = await fixture!.run('Hotkey')
      return 'inputError' in result ? result.inputError : result.selectedText
    }, { timeout: 5000 }).toBe(expectedText)
  }
  try {
    await invoke(app.main, 'hide_window')
    await expect.poll(() => isVisible(app.main)).toBe(false)
    fixture = await openSelectionFixture(testInfo)
    expect(fixture.pid).not.toBe(app.processHandle.pid)
    const drag = await dragText('DragFirst', first)
    await expect.poll(snapshot).toMatchObject({ last_text: first })
    const toolbar = await findWindow(app.context, 'selection-toolbar')
    await expect.poll(() => isVisible(toolbar)).toBe(true)
    await expect(toolbar.getByRole('button', { name: '翻译', exact: true })).toBeEnabled()

    await invoke(app.main, 'hide_selection_toolbar')
    await invoke(app.main, 'set_selection_toolbar_ignored_apps', { apps: [drag.windowClass] })
    expect(await snapshot()).toMatchObject({ last_text: null, ignored_apps: [drag.windowClass.toLowerCase()] })
    await dragText('DragSecond', second)
    await pressSelectionHotkey(second)
    // Observe both trigger paths for longer than the native capture budget.
    const captureDeadline = Date.now() + 2200
    await expect.poll(async () => {
      expect((await snapshot()).last_text).toBeNull()
      expect(await isVisible(toolbar)).toBe(false)
      return Date.now() >= captureDeadline
    }, { timeout: 3500, intervals: [100] }).toBe(true)

    await invoke(app.main, 'set_selection_toolbar_ignored_apps', { apps: [] })
    await pressSelectionHotkey(second)
    await expect.poll(snapshot).toMatchObject({ last_text: second })
    await expect.poll(() => isVisible(toolbar)).toBe(true)
    await screenshot(toolbar, testInfo, 'external-selection-toolbar')
  }
  finally {
    try {
      await fixture?.close()
    }
    finally {
      await app.close()
    }
  }
})

test('native single instance and external shortcut conflict', async () => {
  const testInfo = test.info()
  await seedConfig()
  const holder = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./hold-hotkey.ps1', import.meta.url)),
  ], { windowsHide: true })
  const stopped = once(holder, 'exit')
  let holderOutput = ''
  const captureOutput = (chunk: Buffer) => {
    holderOutput += String(chunk)
  }
  holder.stdout.on('data', captureOutput)
  holder.stderr.on('data', captureOutput)
  let app: Awaited<ReturnType<typeof openApp>> | undefined
  try {
    await expect.poll(() => holderOutput).toContain('registered')
    app = await openApp(testInfo)
    const { main } = app
    interface Status { kind: string, accelerator: string, failure: string | null }
    const status = async () => (await invoke<Status[]>(main, 'get_global_shortcut_statuses'))
      .find(item => item.kind === 'globalHotkey')
    await expect.poll(status).toMatchObject({ accelerator: occupied, failure: 'unavailable' })
    await openSettings(main)
    const conflict = main.getByRole('status').filter({ hasText: '系统占用' })
    await expect(conflict).toBeVisible()
    await conflict.scrollIntoViewIfNeeded()
    await screenshot(main, testInfo, 'shortcut-conflict')

    await expect(invoke(main, 'set_global_shortcut', {
      kind: 'globalHotkey',
      accelerator: translation,
    })).rejects.toThrow('duplicate')
    await invoke(main, 'set_global_shortcut', { kind: 'globalHotkey', accelerator: replacement })
    await expect(invoke(main, 'set_global_shortcut', {
      kind: 'globalHotkey',
      accelerator: occupied,
    })).rejects.toThrow('unavailable')
    await expect.poll(status).toMatchObject({ accelerator: replacement, failure: null })

    await invoke(main, 'hide_window')
    await expect.poll(() => isVisible(main)).toBe(false)
    const second = app.launchAgain()
    await expect.poll(() => second.exitCode).toBe(0)
    expect(app.processHandle.exitCode).toBeNull()
    await expect.poll(() => isVisible(main)).toBe(true)
  }
  finally {
    holder.stdin.end()
    await stopped
    await app?.close()
  }
})

test('native Todo and Markdown notes survive pause and restart', async () => {
  const testInfo = test.info()
  await seedConfig()
  let app = await openApp(testInfo)
  try {
    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    const enabled = app.main.getByRole('checkbox', { name: /启用桌面便签/ })
    await expect(enabled).not.toBeChecked()
    await enabled.press('Space')
    await expect(enabled).toBeChecked()
    const createTodo = app.main.getByRole('button', { name: '新建待办便签' })
    await expect(createTodo).toBeEnabled()
    await createTodo.press('Enter')
    const todo = await findWindow(app.context, 'desktop-note-')
    const label = (await getLabel(todo))!
    await addTodo(todo, '检查投影切换后的便签位置')
    await addTodo(todo, '复核翻译结果窗口')
    await addTodo(todo, '删除测试项')
    await todo.getByRole('textbox', { name: '编辑待办事项' }).nth(1).fill('验证翻译和解释结果窗口')
    await todo.getByRole('checkbox', { name: '切换完成状态' }).first().press('Space')
    await todo.getByRole('button', { name: '删除待办事项' }).nth(2).press('Enter')
    await expect(todo.getByRole('textbox', { name: '编辑待办事项' })).toHaveCount(2)
    const priorityButtons = todo.getByRole('button', { name: '优先级', exact: true })
    const deadlineButtons = todo.getByRole('button', { name: '截止日期', exact: true })
    await priorityButtons.nth(1).press('Enter')
    await todo.getByRole('button', { name: '高', exact: true }).press('Enter')
    await deadlineButtons.nth(1).press('Enter')
    await expect(todo.locator('input[type=date]')).toBeVisible()
    await screenshot(todo, testInfo, 'todo-details')
    await todo.locator('input[type=date]').fill('2026-11-20')
    await todo.getByRole('textbox', { name: '新待办事项，按回车添加' }).focus()
    await expect(todo.locator('time[datetime="2026-11-20"]')).toBeVisible()
    await screenshot(todo, testInfo, 'todo-note')

    const position = { x: 180, y: 200 }
    const noteId = new URL(todo.url()).searchParams.get('noteId')
    await expect.poll(async () => {
      await invoke(todo, 'plugin:window|set_position', { label, value: { Physical: position } })
      const config = JSON.parse(await readFile(resolve(dataDirectory!, 'config.json'), 'utf8'))
      return config[`note_bounds_${noteId}`]?.monitor
    }, { intervals: [350, 650, 1000] }).toBeTruthy()
    await expect.poll(() => invoke(todo, 'plugin:window|outer_position', { label })).toEqual(position)
    await expect.poll(async () => {
      const config = JSON.parse(await readFile(resolve(dataDirectory!, 'config.json'), 'utf8'))
      return config[`note_bounds_${noteId}`]?.monitor
    }).toBeTruthy()

    await expect(enabled).toBeEnabled()
    await enabled.press('Space')
    await expect.poll(() => isVisible(todo)).toBe(false)
    await expect(enabled).toBeEnabled()
    await enabled.press('Space')
    await expect.poll(() => isVisible(todo)).toBe(true)
    await expect(todo.getByRole('checkbox', { name: '切换完成状态' }).first()).toBeChecked()

    await app.main.getByRole('button', { name: '新建便签', exact: true }).press('Enter')
    let markdown: Page | undefined
    await expect.poll(async () => {
      for (const page of app.context.pages()) {
        const windowLabel = await getLabel(page)
        if (windowLabel?.startsWith('desktop-note-') && windowLabel !== label) {
          markdown = page
        }
      }
      return Boolean(markdown)
    }).toBe(true)
    await expect(markdown!.locator('.note-shell')).toBeVisible()
    const markdownLabel = (await getLabel(markdown!))!
    await markdown!.locator('.note-preview').dispatchEvent('dblclick')
    await Promise.all([
      markdown!.getByPlaceholder('在这里输入 Markdown 内容…').fill('# Markdown 便签\n\n与待办便签同时保存。'),
      todo.getByRole('textbox', { name: '编辑待办事项' }).nth(1).fill('并发保存时验证翻译和解释窗口'),
    ])
    await markdown!.getByRole('button', { name: '更换颜色' }).focus()
    await expect(markdown!.getByRole('heading', { name: 'Markdown 便签' })).toBeVisible()
    await screenshot(markdown!, testInfo, 'markdown-note')

    await expect.poll(async () => {
      const raw = await readFile(resolve(dataDirectory!, 'config.json'), 'utf8').catch(() => '{}')
      try {
        return JSON.parse(raw).desktop_notes?.map((note: { content: string }) => note.content).join('\n')
      }
      catch {
        return undefined
      }
    }).toMatch(/(?=[\s\S]*- \[x\] 检查投影切换后的便签位置)(?=[\s\S]*并发保存时验证翻译和解释窗口)(?=[\s\S]*# Markdown 便签)/)
    await app.close()
    app = await openApp(testInfo)
    const restored = await findWindow(app.context, label)
    await expect.poll(() => isVisible(restored)).toBe(true)
    await expect.poll(() => invoke(restored, 'plugin:window|outer_position', { label })).toEqual(position)
    await expect(restored.getByRole('checkbox', { name: '切换完成状态' }).first()).toBeChecked()
    await expect(restored.getByRole('combobox', { name: '排序' })).toHaveCount(0)
    await expect(restored.getByRole('checkbox', { name: '隐藏已完成' })).toHaveCount(0)
    await restored.getByRole('button', { name: '编辑待办清单' }).press('Enter')
    await expect(restored.getByRole('textbox', { name: '编辑待办事项' }).nth(1)).toHaveValue('并发保存时验证翻译和解释窗口')
    await expect(restored.locator('time[datetime="2026-11-20"]')).toBeVisible()
    await restored.getByRole('button', { name: '优先级', exact: true }).nth(1).press('Enter')
    await expect(restored.getByRole('button', { name: '高', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await restored.getByRole('button', { name: '完成编辑' }).press('Enter')
    const restoredMarkdown = await findWindow(app.context, markdownLabel)
    await expect(restoredMarkdown.getByRole('heading', { name: 'Markdown 便签' })).toBeVisible()
    await screenshot(restored, testInfo, 'todo-restored')

    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    const restoreToggle = app.main.getByRole('checkbox', { name: '启用桌面便签' })
    await expect(restoreToggle).toBeChecked()
    await restoreToggle.press('Space')
    await expect.poll(() => isVisible(restored)).toBe(false)
    const todoCard = app.main.locator('.note-card').filter({ hasText: '检查投影切换后的便签位置' })
    await todoCard.getByRole('button', { name: '打开', exact: true }).press('Enter')
    await expect(restoreToggle).toBeChecked()
    await expect.poll(() => isVisible(restored)).toBe(true)
  }
  finally {
    await app.close()
  }
})

test('native Todo sorts, hides completed tasks and persists manual ordering', async () => {
  const testInfo = test.info()
  await seedConfig()
  let app = await openApp(testInfo)
  try {
    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    await app.main.getByRole('checkbox', { name: '启用桌面便签' }).press('Space')
    const create = app.main.getByRole('button', { name: '新建待办便签' })
    await expect(create).toBeEnabled()
    await create.press('Enter')
    const todo = await findWindow(app.context, 'desktop-note-')
    const label = (await getLabel(todo))!
    const first = '整理周报'
    const second = '提交审核'
    const third = '确认演示设备'
    const fourth = '已完成的准备工作'
    for (const text of [first, fourth, second, third]) {
      await addTodo(todo, text)
    }
    const rows = todo.locator('.todo-items > li')
    const taskValues = (page: Page) => page.getByRole('textbox', { name: '编辑待办事项' }).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))
    const order = (expected: string[], page = todo) => expect.poll(() => taskValues(page)).toEqual(expected)
    async function priority(index: number, value: string) {
      await rows.nth(index).getByRole('button', { name: '优先级', exact: true }).press('Enter')
      await todo.getByRole('button', { name: value, exact: true }).press('Enter')
    }
    async function deadline(index: number, value: string) {
      await rows.nth(index).getByRole('button', { name: '截止日期', exact: true }).press('Enter')
      await todo.locator('input[type=date]').fill(value)
    }

    await rows.nth(1).getByRole('checkbox', { name: '切换完成状态' }).check()
    await priority(0, '低')
    await priority(2, '高')
    await deadline(2, '2026-11-25')
    await deadline(3, '2026-11-20')
    const hidden = todo.getByRole('checkbox', { name: '隐藏已完成' })
    const sort = todo.getByRole('combobox', { name: '排序' })
    await hidden.check()
    await order([first, second, third])
    await sort.selectOption('priority')
    await order([second, first, third])
    await screenshot(todo, testInfo, 'todo-priority-and-filter')
    await sort.selectOption('deadline')
    await order([third, second, first])
    await screenshot(todo, testInfo, 'todo-deadline')

    await sort.selectOption('manual')
    await order([first, second, third])
    const reorder = todo.getByRole('button', { name: '拖动排序，或用上下方向键移动' })
    const target = await rows.first().boundingBox()
    expect(target).not.toBeNull()
    await reorder.last().dragTo(rows.first(), { targetPosition: { x: target!.width / 2, y: 2 } })
    await order([third, first, second])
    await reorder.last().press('ArrowUp')
    await order([third, second, first])
    await hidden.uncheck()
    await order([third, second, first, fourth])
    await hidden.check()
    await sort.selectOption('deadline')

    const noteId = new URL(todo.url()).searchParams.get('noteId')
    await expect.poll(async () => {
      const config = JSON.parse(await readFile(resolve(dataDirectory!, 'config.json'), 'utf8'))
      return {
        preferences: config[`note_todo_preferences_${noteId}`],
        order: config.desktop_notes?.find((note: { id: string }) => note.id === noteId)?.content.match(/^- \[[ x]\] (.+)$/gm),
      }
    }).toEqual({
      preferences: { sort: 'deadline', hideCompleted: true },
      order: [`- [ ] ${third}`, `- [ ] ${second}`, `- [ ] ${first}`, `- [x] ${fourth}`],
    })
    await app.close()
    app = await openApp(testInfo)
    const restored = await findWindow(app.context, label)
    await expect(restored.getByRole('checkbox', { name: '隐藏已完成' })).toHaveCount(0)
    await expect(restored.getByRole('combobox', { name: '排序' })).toHaveCount(0)
    await restored.getByRole('button', { name: '编辑待办清单' }).press('Enter')
    await expect(restored.getByRole('checkbox', { name: '隐藏已完成' })).toBeChecked()
    await expect(restored.getByRole('combobox', { name: '排序' })).toHaveValue('deadline')
    await order([third, second, first], restored)
    await restored.getByRole('combobox', { name: '排序' }).selectOption('manual')
    await restored.getByRole('checkbox', { name: '隐藏已完成' }).uncheck()
    await order([third, second, first, fourth], restored)
    await screenshot(restored, testInfo, 'todo-manual-restored')
  }
  finally {
    await app.close()
  }
})

test('native Todo view keeps controls out of the list and preserves nested tasks', async () => {
  const testInfo = test.info()
  await seedConfig()
  let app = await openApp(testInfo)
  try {
    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    await app.main.getByRole('checkbox', { name: '启用桌面便签' }).press('Space')
    const create = app.main.getByRole('button', { name: '新建待办便签' })
    await expect(create).toBeEnabled()
    await create.press('Enter')
    const todo = await findWindow(app.context, 'desktop-note-')
    const label = (await getLabel(todo))!
    const view = todo.getByRole('button', { name: '编辑待办清单' })
    const finish = todo.getByRole('button', { name: '完成编辑' })
    const rootText = '发布演示版本'
    const childText = '检查会议投影'
    const grandchildText = '核对便签位置'
    await expect(view).toBeVisible()
    await expect(todo.getByRole('combobox', { name: '排序' })).toHaveCount(0)
    await addTodo(todo, rootText)
    await expect(todo.getByRole('button', { name: '添加', exact: true })).toHaveCount(0)
    for (const [depth, title] of [childText, grandchildText].entries()) {
      const parent = todo.locator(`li[data-task-depth="${depth}"]`)
      await parent.getByRole('button', { name: '添加子任务' }).press('Enter')
      const input = todo.getByRole('textbox', { name: '新子任务，按回车添加' })
      await input.fill(title)
      await input.press('Enter')
      await expect(todo.locator(`li[data-task-depth="${depth + 1}"] input.todo-text`).first()).toHaveValue(title)
    }
    await todo.locator('li[data-task-depth="2"]').getByRole('button', { name: '优先级', exact: true }).press('Enter')
    await expect(todo.getByRole('button', { name: '高', exact: true })).toBeVisible()
    await screenshot(todo, testInfo, 'todo-priority-picker')
    await todo.getByRole('button', { name: '高', exact: true }).press('Enter')
    await todo.locator('li[data-task-depth="1"]').getByRole('button', { name: '截止日期', exact: true }).press('Enter')
    await screenshot(todo, testInfo, 'todo-deadline-picker')
    await todo.locator('input[type=date]').fill('2026-11-25')
    await screenshot(todo, testInfo, 'todo-nested-edit')
    await finish.press('Enter')
    await expect(todo.getByRole('combobox', { name: '排序' })).toHaveCount(0)
    await expect(todo.getByRole('checkbox', { name: '隐藏已完成' })).toHaveCount(0)
    await expect(todo.getByRole('textbox')).toHaveCount(0)
    await expect(todo.locator('li[data-task-depth="2"] .todo-text')).toHaveText(grandchildText)
    const completed = todo.locator('li[data-task-depth="2"]').getByRole('checkbox', { name: '切换完成状态' })
    await completed.check()
    await expect(completed).toBeChecked()
    await screenshot(todo, testInfo, 'todo-nested-view')
    await expect.poll(async () => {
      const config = JSON.parse(await readFile(resolve(dataDirectory!, 'config.json'), 'utf8'))
      return config.desktop_notes?.find((note: { content: string }) => note.content.includes(rootText))?.content
    }).toContain(`    - [x] ${grandchildText}`)
    await app.close()
    app = await openApp(testInfo)
    const restored = await findWindow(app.context, label)
    await expect(restored.locator('li[data-task-depth="1"] .todo-text')).toHaveText(childText)
    await expect(restored.locator('li[data-task-depth="2"] input[type=checkbox]')).toBeChecked()
    await expect(restored.locator('time[datetime="2026-11-25"]')).toBeVisible()
  }
  finally {
    await app.close()
  }
})

test('native Show Desktop keeps open notes visible without covering other apps', async () => {
  await requireInputDesktop()
  const testInfo = test.info()
  await seedConfig()
  const app = await openApp(testInfo)
  const pid = app.processHandle.pid!
  let probe: Awaited<ReturnType<typeof openDesktopProbe>> | undefined
  let desktopShown = false
  try {
    probe = await openDesktopProbe(pid)
    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    const enabled = app.main.getByRole('checkbox', { name: '启用桌面便签' })
    await enabled.press('Space')
    const createTodo = app.main.getByRole('button', { name: '新建待办便签' })
    await expect(createTodo).toBeEnabled()
    await createTodo.press('Enter')
    const note = await findWindow(app.context, 'desktop-note-')
    await addTodo(note, '显示桌面时查看待办')
    await expect(note.getByRole('textbox', { name: '编辑待办事项' })).toHaveValue('显示桌面时查看待办')

    await invoke(app.main, 'show_window')
    const original = await probe.inspect()
    expect(original.main).toMatchObject({ visible: true, iconic: false })
    expect(original.note.topmost).toBe(false)
    for (const cycle of [1, 2]) {
      desktopShown = true
      let shown = await probe.inspect('WinD')
      try {
        await expect.poll(async () => {
          shown = await probe!.inspect()
          return /^(?:Progman|WorkerW)$/.test(shown.foregroundClassName) && shown.note.centerHitsWindow
        }, { message: `Win+D cycle ${cycle}` }).toBe(true)
      }
      catch (error) {
        await testInfo.attach('win-d-last-state', { body: JSON.stringify(shown), contentType: 'application/json' })
        throw new Error(`Win+D cycle ${cycle} did not show the note: ${JSON.stringify(shown)}`, { cause: error })
      }
      await testInfo.attach(`win-d-shown-${cycle}`, { body: JSON.stringify(shown), contentType: 'application/json' })
      expect(shown.foregroundClassName).toMatch(/^(?:Progman|WorkerW)$/)
      expect(shown.main.iconic).toBe(true)
      expect(shown.note).toMatchObject({
        visible: true,
        iconic: false,
        cloakFlags: 0,
        centerHitsWindow: true,
        topmost: true,
      })
      if (cycle === 1) {
        const completed = note.getByRole('checkbox', { name: '切换完成状态' })
        await completed.dispatchEvent('click')
        await expect(completed).toBeChecked()
        const path = testInfo.outputPath('win-d-note.png')
        await probe.inspect('Inspect', path)
        await testInfo.attach('win-d-note', { path, contentType: 'image/png' })
      }
      let restored = await probe.inspect('WinD')
      await expect.poll(async () => {
        restored = await probe!.inspect()
        return !restored.main.iconic && !restored.note.topmost
      }, { message: `After Win+D: ${JSON.stringify(restored)}` }).toBe(true)
      await testInfo.attach(`win-d-restored-${cycle}`, { body: JSON.stringify(restored), contentType: 'application/json' })
      expect(restored.foregroundClassName).not.toMatch(/^(?:Progman|WorkerW)$/)
      desktopShown = false
      expect(restored.main.iconic).toBe(false)
      expect(restored.note.topmost, JSON.stringify(restored)).toBe(false)
    }
  }
  finally {
    if (desktopShown && probe) {
      const current = await probe.inspect().catch(() => null)
      if (current && (current.note.topmost || /^(?:Progman|WorkerW)$/.test(current.foregroundClassName))) {
        await probe.inspect('WinD').catch(() => {})
      }
    }
    await probe?.close()
    await app.close()
  }
})

interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

interface PhysicalDisplay {
  deviceName: string
  primary: boolean
  workArea: DisplayArea
  dpi: { x: number, y: number }
  targetNames: string[]
}

interface DisplayTopology {
  mode: string
  monitors: PhysicalDisplay[]
}

async function displayTopology(): Promise<DisplayTopology> {
  const { stdout } = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./display-topology.ps1', import.meta.url)),
  ], { windowsHide: true })
  return JSON.parse(stdout)
}

test('manual Windows topology and virtual desktop acceptance', async () => {
  const mode = process.env.AI_ASK_E2E_MANUAL_DESKTOP
  test.skip(mode !== '1' && mode !== 'virtual' && mode !== 'projection', 'Requires someone at the Windows desktop to switch displays and virtual desktops')
  test.setTimeout(15 * 60_000)
  await requireInputDesktop()
  const testInfo = test.info()
  const evidence: Record<string, unknown> = {}
  const virtualOnly = mode === 'virtual'
  async function checkpoint(name: string, instructions: string) {
    await writeFile(testInfo.outputPath('next-step.json'), JSON.stringify({ name, instructions }, null, 2))
  }
  function withinWindowArea(state: NativeWindowState, area: DisplayArea) {
    const { left, top, right, bottom } = state.rect
    return left >= area.x - 8 && top >= area.y - 8
      && right <= area.x + area.width + 8 && bottom <= area.y + area.height + 8
  }
  function frameMatches(current: NativeRect, original: NativeRect, tolerance = 0) {
    return Math.abs(current.left - original.left) <= tolerance
      && Math.abs(current.top - original.top) <= tolerance
      && Math.abs(current.right - original.right) <= tolerance
      && Math.abs(current.bottom - original.bottom) <= tolerance
  }
  await seedConfig()
  const app = await openApp(testInfo)
  let probe: Awaited<ReturnType<typeof openDesktopProbe>> | undefined
  try {
    probe = await openDesktopProbe(app.processHandle.pid!)
    const original = await displayTopology()
    const target = original.monitors.find(display => !display.primary) ?? (virtualOnly ? original.monitors[0] : undefined)
    expect(target, virtualOnly ? 'Start with a connected display' : 'Start with two physically connected displays in Extend mode').toBeDefined()
    if (!virtualOnly) {
      expect(original.mode).toBe('extend')
    }
    const { workArea } = target!
    await openSettings(app.main)
    await app.main.getByRole('button', { name: /桌面便签/ }).press('Enter')
    const enabled = app.main.getByRole('checkbox', { name: '启用桌面便签' })
    await enabled.press('Space')
    await expect(enabled).toBeChecked()
    const createTodo = app.main.getByRole('button', { name: '新建待办便签' })
    await expect(createTodo).toBeEnabled()
    await createTodo.press('Enter')
    const note = await findWindow(app.context, 'desktop-note-')
    const label = (await getLabel(note))!
    await addTodo(note, '实机验收：显示桌面后勾选这项')
    const completed = note.getByRole('checkbox', { name: '切换完成状态' })
    const position = { x: workArea.x + 160, y: workArea.y + 120 }
    await expect.poll(() => invoke(note, 'capture_desktop_note_bounds')).not.toBeNull()
    await invoke(note, 'plugin:window|set_position', { label, value: { Physical: position } })
    await expect.poll(async () => {
      const state = (await probe!.inspect()).note
      return state.visible && !state.iconic && !state.cloakFlags && withinWindowArea(state, workArea)
    }).toBe(true)
    const noteId = new URL(note.url()).searchParams.get('noteId')
    const readSavedBounds = async () => {
      const config = JSON.parse(await readFile(resolve(dataDirectory!, 'config.json'), 'utf8'))
      return config[`note_bounds_${noteId}`] as { monitor?: string, x: number, y: number } | undefined
    }
    await expect.poll(async () => (await readSavedBounds())?.monitor).toBe(target!.deviceName)
    const baseline = (await probe.inspect()).note
    const saved = await readSavedBounds()
    evidence.baseline = { topology: original, note: baseline, saved }

    const manualWait = { timeout: 180_000, intervals: [250, 500, 1000] }
    if (mode !== 'projection') {
      await checkpoint('switch-away', '切换到另一 Windows 虚拟桌面（Win+Ctrl+→ 或 Win+Ctrl+D），等提示再切回。')
      await expect.poll(async () => (await probe!.inspect()).main.cloakFlags, manualWait).toBeGreaterThan(0)
      let away = await probe.inspect()
      await expect.poll(async () => {
        away = await probe!.inspect()
        return away.main.cloakFlags > 0 && away.note.visible && !away.note.iconic
          && !away.note.cloakFlags && away.note.centerHitsWindow && frameMatches(away.note.rect, baseline.rect)
      }).toBe(true)
      const virtualPath = testInfo.outputPath('virtual-desktop-note.png')
      evidence.virtualDesktopAway = await probe.inspect('Inspect', virtualPath)
      await testInfo.attach('virtual-desktop-note', { path: virtualPath, contentType: 'image/png' })
      await checkpoint('switch-back', '回到原虚拟桌面（Win+Ctrl+←），先不要切换投影。')
      await expect.poll(async () => {
        const state = await probe!.inspect()
        return state.main.cloakFlags === 0 && state.note.visible && !state.note.cloakFlags
          && !state.note.iconic && frameMatches(state.note.rect, baseline.rect)
      }, manualWait).toBe(true)
      evidence.virtualDesktopBack = await probe.inspect()
    }
    if (virtualOnly) {
      await checkpoint('complete', '已记录虚拟桌面切换和原位置恢复。')
      return
    }

    await checkpoint('primary-only', '按 Win+P，选「仅电脑屏幕」，保持此模式。')
    let single: DisplayTopology | undefined
    await expect.poll(async () => {
      single = await displayTopology()
      return single.monitors.length === 1 && single.mode === 'internal'
    }, { ...manualWait, intervals: [1200, 1600] }).toBe(true)
    await expect.poll(async () => {
      const state = (await probe!.inspect()).note
      return state.visible && !state.iconic && !state.cloakFlags && withinWindowArea(state, single!.monitors[0].workArea)
    }).toBe(true)
    evidence.primaryOnly = { topology: single, desktop: await probe.inspect(), saved: await readSavedBounds() }
    expect(await readSavedBounds()).toEqual(saved)

    await checkpoint('edit-win-d', '在单屏模式按 Win+D，看到便签后，用鼠标勾选「实机验收：显示桌面后勾选这项」，先停在桌面。')
    await expect.poll(async () => {
      const state = await probe!.inspect()
      return state.note.topmost && state.note.centerHitsWindow && !state.note.iconic && !state.note.cloakFlags
    }, manualWait).toBe(true)
    await expect(completed).toBeChecked({ timeout: manualWait.timeout })
    const screenshotPath = testInfo.outputPath('win-d-after-projecting.png')
    evidence.winD = await probe.inspect('Inspect', screenshotPath)
    await testInfo.attach('win-d-after-projecting', { path: screenshotPath, contentType: 'image/png' })

    await checkpoint('extend-again', '再按 Win+D 恢复应用，然后 Win+P 选「扩展」。')
    let extended: DisplayTopology | undefined
    await expect.poll(async () => {
      extended = await displayTopology()
      return extended.mode === 'extend' && extended.monitors.length === original.monitors.length
    }, { ...manualWait, intervals: [1200, 1600] }).toBe(true)
    await expect.poll(async () => {
      const state = (await probe!.inspect()).note
      // Whole logical pixels round at the monitor's DPI; compare at most one logical pixel per edge.
      const tolerance = Math.ceil(Math.max(target!.dpi.x, target!.dpi.y) / 96)
      return state.visible && !state.topmost && !state.iconic && !state.cloakFlags
        && frameMatches(state.rect, baseline.rect, tolerance)
    }).toBe(true)
    evidence.extendRestored = { topology: extended, desktop: await probe.inspect(), saved: await readSavedBounds() }
    expect(await readSavedBounds()).toEqual(saved)
    await expect(completed).toBeChecked()
    await checkpoint('complete', '扩展模式已恢复，便签位置和编辑结果已核对。可以在任务视图里关闭刚创建的空虚拟桌面。')
  }
  finally {
    await testInfo.attach('physical-display-and-virtual-desktop', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
    await probe?.close()
    await app.close()
  }
})

test('native translation and explanation display the current request', async () => {
  const testInfo = test.info()
  await seedConfig()
  const app = await openApp(testInfo)
  try {
    await app.context.route('https://translate.google.com/**', route => route.fulfill({ contentType: 'text/html', body: translationPage }))
    await app.context.route(/^https:\/\/(?:chat\.openai\.com|chatgpt\.com)\//, route => route.fulfill({ contentType: 'text/html', body: chatPage }))

    const translationButton = app.main.getByRole('button', { name: '翻译', exact: true })
    const openedAt = performance.now()
    await translationButton.press('Enter')
    await expect(app.main.locator('.translation-container')).toBeVisible()
    const translate = await findWindow(app.context, 'translator-google')
    await expect(translate.getByRole('textbox', { name: 'Source text' })).toBeVisible()
    const coldMs = Math.round(performance.now() - openedAt)
    await openSettings(app.main)
    await expect.poll(() => isVisible(app.main)).toBe(true)
    const reopenedAt = performance.now()
    await translationButton.press('Enter')
    await expect(app.main.locator('.translation-container')).toBeVisible()
    await expect(app.main.locator('.translation-container .loading-overlay')).toBeHidden()
    await testInfo.attach('translation-open-timing', {
      body: JSON.stringify({ coldMs, warmMs: Math.round(performance.now() - reopenedAt) }),
      contentType: 'application/json',
    })
    await openSettings(app.main)

    let pinned: Page | undefined
    let requestIndex = 0
    for (const [action, text, output] of [
      ['翻译', 'first translation', '译文 first translation'],
      ['翻译', 'second translation', '译文 second translation'],
      ['解释', 'selection from another app', '解释 请解释以下内容'],
    ]) {
      await invoke(app.main, 'show_selection_toolbar', { text, position: { x: 400, y: 360 } })
      const toolbar = await findWindow(app.context, 'selection-toolbar')
      const button = toolbar.getByRole('button', { name: action, exact: true })
      await expect(button).toBeEnabled()
      if (text === 'first translation') {
        await screenshot(toolbar, testInfo, 'selection-toolbar')
      }
      await button.dispatchEvent('click')
      const resultLabel = pinned ? `selection-result-${requestIndex}` : 'selection-result'
      const result = await findWindow(app.context, resultLabel)
      requestIndex++
      await expect(result.locator('.original-content')).toHaveText(text)
      await expect(result.locator('.result-markdown')).toContainText(output)
      if (text === 'first translation') {
        await result.getByRole('button', { name: '钉住', exact: true }).press('Enter')
        await expect(result.getByRole('button', { name: '取消钉住' })).toBeVisible()
        pinned = result
      }
      if (text !== 'first translation') {
        await screenshot(result, testInfo, action === '翻译' ? 'floating-translation' : 'floating-explanation')
        await expect(pinned!.locator('.result-markdown')).toContainText('译文 first translation')
        await result.getByRole('button', { name: '关闭', exact: true }).press('Enter')
        await expect.poll(() => result.isClosed()).toBe(true)
      }
    }
  }
  finally {
    await app.close()
  }
})
