import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { chromium, expect, test } from '@playwright/test'

const executable = process.env.AI_ASK_E2E_EXE
const dataDirectory = process.env.AI_ASK_E2E_DATA

test.skip(
  process.platform !== 'win32' || !executable || !dataDirectory || process.env.AI_ASK_E2E_LIVE_PLATFORMS !== '1',
  'Requires an opt-in Windows test build with isolated app data',
)

const platforms = [
  {
    id: 'google',
    action: '翻译',
    target: 'translator-google',
    domains: ['translate.google.com'],
    text: 'The sky is blue today.',
    expected: /天空|天色/,
  },
  {
    id: 'chatgpt',
    action: '解释',
    target: 'ai-chat-chatgpt',
    domains: ['chat.openai.com', 'chatgpt.com'],
    text: 'A triangle has three sides.',
    expected: /三角形|three sides/i,
  },
  {
    id: 'qianwen',
    action: '解释',
    target: 'ai-chat-qianwen',
    domains: ['www.qianwen.com', 'qianwen.com'],
    text: '三角形有三条边。',
    expected: /三角形|三条边/,
  },
] as const

type Platform = (typeof platforms)[number]

function invoke<T>(page: Page, command: string, payload: Record<string, unknown> = {}) {
  return page.evaluate(([command, payload]) => (window as unknown as {
    __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<T> }
  }).__TAURI_INTERNALS__.invoke(command, payload), [command, payload] as const)
}

async function findWindow(context: BrowserContext, label: string) {
  let matched: Page | undefined
  await expect.poll(async () => {
    for (const page of context.pages()) {
      const current = await page.evaluate(() => (window as unknown as {
        __TAURI_INTERNALS__?: { metadata: { currentWebview: { label: string } } }
      }).__TAURI_INTERNALS__?.metadata.currentWebview.label).catch(() => undefined)
      if (current === label) {
        matched = page
        break
      }
    }
    return Boolean(matched)
  }).toBe(true)
  return matched!
}

async function openLiveApp(platform: Platform, testInfo: TestInfo) {
  if (basename(dataDirectory!) !== 'windows-profile') {
    throw new Error('Expected the isolated Windows E2E app data directory')
  }
  await mkdir(dataDirectory!, { recursive: true })
  await writeFile(resolve(dataDirectory!, 'config.json'), JSON.stringify({
    app_config: {
      locale: 'zh-CN',
      theme: 'light',
      firstRun: false,
      autoUpdate: false,
      preloadDefaultPlatforms: false,
      selectionToolbarEnabled: true,
      selectionToolbarUseFloatingWindow: true,
      selectionToolbarDefaultPlatformId: platform.id === 'google' ? 'chatgpt' : platform.id,
      currentTranslator: 'google',
      desktopNotesEnabled: false,
      globalHotkey: 'Control+Alt+Shift+F9',
      translationHotkey: 'Control+Alt+Shift+F11',
      selectionToolbarHotkey: 'Control+Alt+Shift+F8',
    },
  }))

  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not allocate a WebView2 debugging port')
  }
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  const endpoint = `http://127.0.0.1:${address.port}`
  const app = spawn(executable!, [], {
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${address.port}` },
  })
  const log: string[] = []
  app.stdout.on('data', chunk => log.push(String(chunk)))
  app.stderr.on('data', chunk => log.push(String(chunk)))
  const exited = once(app, 'exit')
  let browser: Browser | undefined
  async function close() {
    if (app.exitCode === null && app.signalCode === null) {
      app.kill()
      await exited
    }
    await browser?.close().catch(() => {})
    await testInfo.attach('native-log', { body: log.join(''), contentType: 'text/plain' })
  }
  try {
    await expect.poll(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok, {
      timeout: 20_000,
    }).toBe(true)
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    const main = await findWindow(context, 'main')
    await expect(main.getByRole('button', { name: '设置', exact: true })).toBeVisible()
    return { context, main, close }
  }
  catch (error) {
    await close()
    throw error
  }
}

function matchesDomain(url: string, platform: Platform) {
  try {
    const domains: readonly string[] = platform.domains
    return domains.includes(new URL(url).hostname)
  }
  catch {
    return false
  }
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

function watchLiveSite(context: BrowserContext, platform: Platform) {
  const documents: { url: string, status: number }[] = []
  const navigationErrors: string[] = []
  const siteErrors: { url: string, status: number }[] = []
  context.on('response', (response) => {
    const request = response.request()
    const type = request.resourceType()
    const url = new URL(response.url())
    const status = response.status()
    if (!matchesDomain(url.href, platform)) {
      return
    }
    if (type === 'document') {
      documents.push({ url: `${url.origin}${url.pathname}`, status })
    }
    else if (status >= 400 && ['fetch', 'xhr'].includes(type) && siteErrors.length < 20) {
      siteErrors.push({ url: `${url.origin}${url.pathname}`, status })
    }
  })
  context.on('requestfailed', (request) => {
    const error = request.failure()?.errorText
    if (request.resourceType() === 'document' && matchesDomain(request.url(), platform) && error !== 'net::ERR_ABORTED' && error) {
      navigationErrors.push(error)
    }
  })
  return { documents, navigationErrors, siteErrors }
}

async function detectProviderBlock(
  context: BrowserContext,
  platform: Platform,
  trace: ReturnType<typeof watchLiveSite>,
): Promise<string | null> {
  const response = trace.documents.at(-1)
  if (response && [401, 403, 429, 451].includes(response.status)) {
    return `${platform.id} returned HTTP ${response.status}`
  }
  if (trace.navigationErrors.length > 0 && !trace.documents.some(response => response.status === 200)) {
    return `${platform.id} navigation failed: ${trace.navigationErrors.at(-1)}`
  }
  const child = context.pages().find(page => matchesDomain(page.url(), platform))
  if (!child) {
    return null
  }
  return child.evaluate((target) => {
    const title = document.title
    const hasEditor = Boolean(document.querySelector('textarea,[contenteditable="true"]'))
    const text = document.body?.textContent ?? ''
    if (/just a moment|attention required|请稍候/i.test(title)
      || (!hasEditor && /verify you are human|checking your browser|访问受限|请进行安全验证/i.test(text))) {
      return 'The provider displayed a browser verification or access block'
    }
    const dialog = [...document.querySelectorAll('[role="dialog"]')].some(element => /sign in|log in|登录|扫码/i.test(element.textContent ?? ''))
    if (dialog || (!hasEditor && /log in to continue|请登录后继续|请先登录|登录后使用/i.test(text))) {
      return 'The provider required a signed-in account'
    }
    if (target === 'qianwen' && /你好，我无法回答这个问题，我们换一个话题聊聊吧/.test(text)) {
      return 'Qianwen returned its generic fallback instead of explaining the prompt'
    }
    return null
  }, platform.id).catch(() => null)
}

for (const platform of platforms) {
  test(`live ${platform.id} returns a floating result`, async () => {
    const testInfo = test.info()
    const app = await openLiveApp(platform, testInfo)
    const trace = watchLiveSite(app.context, platform)
    try {
      await invoke(app.main, 'show_selection_toolbar', { text: platform.text, position: { x: 400, y: 360 } })
      const toolbar = await findWindow(app.context, 'selection-toolbar')
      const action = toolbar.getByRole('button', { name: platform.action, exact: true })
      await expect(action).toBeEnabled()
      await action.dispatchEvent('click')
      const result = await findWindow(app.context, 'selection-result')
      const output = result.locator('.result-markdown')
      const error = result.locator('.error-state')
      await expect(output.or(error)).toBeVisible({ timeout: 65_000 })
      await capture(result, testInfo, `live-${platform.id}-result`)

      const child = app.context.pages().find(page => matchesDomain(page.url(), platform))
      const providerState = await child?.evaluate(() => ({
        title: document.title,
        readyState: document.readyState,
        editors: [...document.querySelectorAll('textarea,[contenteditable="true"]')].slice(0, 5).map(element => ({
          tag: element.tagName,
          id: element.id,
          role: element.getAttribute('role'),
          slate: element.getAttribute('data-slate-editor'),
        })),
      })).catch(() => null)
      await testInfo.attach('provider-state', {
        body: JSON.stringify(providerState ?? null),
        contentType: 'application/json',
      })

      const blocked = await detectProviderBlock(app.context, platform, trace)
      if (blocked) {
        testInfo.annotations.push({ type: 'provider-block', description: blocked })
      }
      test.skip(Boolean(blocked), blocked ?? undefined)
      const errorCount = await error.count()
      expect(errorCount, errorCount ? await error.textContent() ?? '' : '').toBe(0)
      await expect(result.locator('.original-content')).toHaveText(platform.text)
      await expect(output).toContainText(platform.expected)
    }
    finally {
      await testInfo.attach('provider-network', {
        body: JSON.stringify(trace, null, 2),
        contentType: 'application/json',
      })
      await app.close()
    }
  })
}
