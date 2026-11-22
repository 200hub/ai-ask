/** Smoke-test embedded Tauri assets with no Vite server or installed application. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const executable = process.env.AI_ASK_E2E_EXE
const dataDirectory = process.env.AI_ASK_E2E_DATA
const outputDirectory = process.env.AI_ASK_E2E_OUTPUT
  ?? fileURLToPath(new URL('../../../test-results/hai-embedded-assets/', import.meta.url))
assert.equal(process.platform, 'win32', 'This smoke test requires Windows WebView2')
assert.ok(executable && dataDirectory, 'Set AI_ASK_E2E_EXE and AI_ASK_E2E_DATA to the isolated build')
assert.equal(basename(dataDirectory), 'windows-profile', 'Refuse to seed an application data directory')
const noteId = 'embedded-asset-note'
const noteLabel = `desktop-note-${noteId}`
const finalContent = '# 嵌入资源保存成功\n\n打包协议下立即退出不丢内容。'
const report = { launches: [], assetErrors: [] }
const logs = []

async function waitFor(check, description, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value)
      return value
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out: ${description}`)
}

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

async function findWindow(context, label) {
  return waitFor(async () => {
    for (const page of context.pages()) {
      const current = await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWebview.label).catch(() => null)
      if (current === label)
        return page
    }
    return null
  }, `native window ${label}`)
}

async function openApp() {
  const port = await freePort()
  const child = spawn(executable, [], {
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  child.stdout.on('data', chunk => logs.push(String(chunk)))
  child.stderr.on('data', chunk => logs.push(String(chunk)))
  let browser
  const pageErrors = []
  async function close() {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await browser?.close().catch(() => {})
  }
  try {
    await waitFor(async () => {
      if (child.exitCode !== null)
        throw new Error(`Embedded application exited early: ${child.exitCode}`)
      return (await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null))?.ok
    }, 'WebView2 debugging endpoint')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const observePage = page => page.on('pageerror', error => pageErrors.push(error.message))
    context.pages().forEach(observePage)
    context.on('page', observePage)
    context.on('response', (response) => {
      if (response.url().includes('tauri.localhost/assets/') && response.status() >= 400)
        report.assetErrors.push({ url: response.url(), status: response.status() })
    })
    context.on('requestfailed', (request) => {
      if (request.url().includes('tauri.localhost/assets/'))
        report.assetErrors.push({ url: request.url(), failure: request.failure()?.errorText })
    })
    const main = await findWindow(context, 'main')
    const note = await findWindow(context, noteLabel)
    await main.getByRole('button', { name: '设置', exact: true }).waitFor()
    await note.locator('.note-shell').waitFor()
    const assets = []
    for (const page of [main, note]) {
      const url = new URL(page.url())
      assert.equal(url.hostname, 'tauri.localhost', 'An embedded build must use its native asset origin')
      assert.ok(['/', '/index.html'].includes(url.pathname))
      assert.ok(url.hash.startsWith('#/'))
      const style = await page.evaluate(() => ({
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
        stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map(link => link.href),
      }))
      assert.ok(style.background, 'The shared stylesheet must be applied')
      assert.ok(style.stylesheets.some(href => href.includes('tauri.localhost/assets/') && href.endsWith('.css')))
      assets.push({ url: page.url(), stylesheets: style.stylesheets })
    }
    assert.equal(new URL(note.url()).hash, `#/sticky-note?noteId=${noteId}`)
    assert.equal(await note.locator('.note-shell').evaluate(element => getComputedStyle(element).display), 'flex')
    report.launches.push({ mainUrl: main.url(), noteUrl: note.url(), assets })
    return {
      main,
      note,
      pageErrors,
      async exit() {
        await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('request_app_exit')).catch((error) => {
          if (!/closed|disconnected|destroyed|connection/i.test(error.message))
            throw error
        })
        await waitFor(() => child.exitCode !== null, 'durable native exit')
        assert.equal(child.exitCode, 0)
      },
      close,
    }
  }
  catch (error) {
    await close()
    throw error
  }
}

async function main() {
  const developmentServer = await fetch('http://127.0.0.1:1420', { signal: AbortSignal.timeout(1000) }).catch(() => null)
  assert.equal(developmentServer, null, 'Stop the development server before testing embedded assets')
  await mkdir(dataDirectory, { recursive: true })
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(resolve(dataDirectory, 'config.json'), JSON.stringify({
    app_config: {
      locale: 'zh-CN',
      firstRun: false,
      preloadDefaultPlatforms: false,
      selectionToolbarEnabled: false,
      desktopNotesEnabled: true,
      desktopNotesSyncEnabled: false,
      desktopNotesServerUrl: '',
      globalHotkey: 'Control+Alt+Shift+F9',
      translationHotkey: 'Control+Alt+Shift+F11',
      selectionToolbarHotkey: 'Control+Alt+Shift+F8',
    },
    desktop_notes: [{
      id: noteId,
      title: '',
      content: '# 已嵌入的便签资源\n\n无需开发服务器。',
      color: 'sunny',
      visible: true,
      bounds: { x: 120, y: 120, width: 320, height: 280 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      sync: { dirty: true, lastSyncedAt: null },
    }],
  }))

  let app
  try {
    app = await openApp()
    await app.note.getByRole('heading', { name: '已嵌入的便签资源' }).waitFor()
    await app.main.screenshot({ path: resolve(outputDirectory, 'embedded-main.png') })
    await app.note.locator('.note-preview').dispatchEvent('dblclick')
    await app.note.getByPlaceholder('在这里输入 Markdown 内容…').fill(finalContent)
    await app.exit()
    assert.deepEqual(app.pageErrors, [])
    await app.close()
    const saved = JSON.parse(await readFile(resolve(dataDirectory, 'config.json'), 'utf8'))
    assert.equal(saved.desktop_notes.find(note => note.id === noteId)?.content, finalContent)
    assert.equal(saved.desktop_notes.find(note => note.id === noteId)?.visible, true)
    app = await openApp()
    await app.note.getByRole('heading', { name: '嵌入资源保存成功' }).waitFor()
    await app.note.screenshot({ path: resolve(outputDirectory, 'embedded-note-restored.png') })
    await app.exit()
    assert.deepEqual(app.pageErrors, [])
    assert.deepEqual(report.assetErrors, [])
    report.success = true
    process.stdout.write('Embedded Tauri assets, Hash pages, stylesheets, immediate save and restart passed.\n')
  }
  finally {
    await app?.close()
    await writeFile(resolve(outputDirectory, 'embedded-assets.json'), JSON.stringify(report, null, 2))
    await writeFile(resolve(outputDirectory, 'native-embedded.log'), logs.join(''))
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
