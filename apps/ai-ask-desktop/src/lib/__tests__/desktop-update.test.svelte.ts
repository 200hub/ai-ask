import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { Resource } from '@tauri-apps/api/core'
import { Update } from '@tauri-apps/plugin-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), native: vi.fn(), getVersion: vi.fn(), initConfig: vi.fn(), config: { autoUpdateEnabled: false, proxy: { type: 'system' } } }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }))
vi.mock('@tauri-apps/api/core', async original => ({
  ...await original<typeof import('@tauri-apps/api/core')>(),
  invoke: mocks.invoke,
  isTauri: mocks.native,
  Channel: class { onmessage?: (event: DownloadEvent) => void },
}))
vi.mock('$lib/stores/config.svelte', () => ({ configStore: { config: mocks.config, init: mocks.initConfig } }))
const available = { status: 'available', update: { rid: 7, version: '2.0.0', currentVersion: '1.0.0', body: 'Signed release', rawJson: {} } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
let updater: InstanceType<typeof import('$lib/utils/desktop-update.svelte').DesktopUpdate>
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.native.mockReturnValue(true)
  mocks.getVersion.mockResolvedValue('1.0.0')
  mocks.initConfig.mockResolvedValue(undefined)
  mocks.config.autoUpdateEnabled = false
  mocks.invoke.mockImplementation(async (command) => {
    if (command === 'desktop_update_configured')
return true
    if (command === 'desktop_update_check')
return available
    if (command === 'desktop_update_download')
return 8
    if (command === 'desktop_update_install')
throw new Error('Editor save failed')
    throw new Error(`Unexpected native command: ${command}`)
  })
  vi.spyOn(Resource.prototype, 'close').mockResolvedValue()
  vi.spyOn(Update.prototype, 'close').mockResolvedValue()
  updater = new (await import('$lib/utils/desktop-update.svelte')).DesktopUpdate()
})
afterEach(() => {
  updater.dispose()
  vi.restoreAllMocks()
})

describe('hai signed desktop update adapter', () => {
  it('does not contact update endpoints from browser previews', async () => {
    mocks.native.mockReturnValue(false)
    await updater.initialize()
    expect(updater.status).toBe('unavailable')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('shows unconfigured packages explicitly without attempting an unsigned fallback', async () => {
    mocks.invoke.mockResolvedValue(false)
    await updater.initialize()
    expect(updater.enabled).toBe(false)
    expect(updater.status).toBe('unavailable')
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['desktop_update_configured'])
  })
  it('uses the native version and shares concurrent initialization', async () => {
    mocks.getVersion.mockResolvedValue('1.2.3')
    await Promise.all([updater.initialize(), updater.initialize()])
    expect(updater.version).toBe('1.2.3')
    expect(mocks.getVersion).toHaveBeenCalledTimes(1)
    expect(updater.status).toBe('available')
    expect(updater.notes).toBe('Signed release')
    expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_update_download', expect.anything())
  })
  it('distinguishes current, unavailable target and network failure', async () => {
    await updater.initialize()
    for (const status of ['current', 'unavailable'] as const) {
      mocks.invoke.mockResolvedValueOnce({ status })
      await updater.check()
      expect(updater.status).toBe(status)
    }
    mocks.invoke.mockRejectedValueOnce(new Error('Unavailable feed'))
    await updater.check()
    expect(updater.status).toBe('check-failed')
  })
  it('downloads a verified package once and never installs without an explicit action', async () => {
    await updater.initialize()
    await Promise.all([updater.download(), updater.download()])
    expect(updater.status).toBe('ready')
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_download')).toHaveLength(1)
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_install')).toHaveLength(0)
  })
  it('keeps automatic download preference without automatically installing', async () => {
    mocks.config.autoUpdateEnabled = true
    await updater.initialize()
    expect(updater.status).toBe('ready')
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_install')).toHaveLength(0)
  })
  it('reports native progress while waiting for verified completion', async () => {
    await updater.initialize()
    const download = deferred<number>()
    mocks.invoke.mockImplementationOnce((_, { onEvent }: { onEvent: { onmessage: (event: DownloadEvent) => void } }) => {
      onEvent.onmessage({ event: 'Started', data: { contentLength: 8 } })
      onEvent.onmessage({ event: 'Progress', data: { chunkLength: 3 } })
      onEvent.onmessage({ event: 'Finished' })
      return download.promise
    })
    const running = updater.download()
    expect(updater.percent).toBe(37)
    expect(updater.status).toBe('downloading')
    download.resolve(8)
    await running
    expect(updater.status).toBe('ready')
  })
  it('rejects installation when download or signature verification failed', async () => {
    await updater.initialize()
    mocks.invoke.mockRejectedValueOnce(new Error('Invalid signature'))
    await updater.download()
    await updater.install()
    expect(updater.status).toBe('check-failed')
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_install')).toHaveLength(0)
  })
  it('retries a save or installer failure with the same verified package', async () => {
    await updater.initialize()
    await updater.download()
    await updater.install()
    expect(updater.status).toBe('install-failed')
    await updater.install()
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_install')).toHaveLength(2)
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_download')).toHaveLength(1)
  })
  it('closes a check resource arriving after disposal', async () => {
    await updater.initialize()
    const check = deferred<typeof available>()
    mocks.invoke.mockReturnValueOnce(check.promise)
    const checking = updater.check()
    await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'desktop_update_check')).toHaveLength(2))
    updater.dispose()
    check.resolve(available)
    await checking
    expect(updater.status).not.toBe('available')
    expect(Update.prototype.close).toHaveBeenCalled()
  })
  it('closes verified bytes arriving after disposal', async () => {
    await updater.initialize()
    const download = deferred<number>()
    mocks.invoke.mockReturnValueOnce(download.promise)
    const downloading = updater.download()
    updater.dispose()
    download.resolve(8)
    await downloading
    expect(Resource.prototype.close).toHaveBeenCalled()
    expect(updater.status).toBe('idle')
  })
})
