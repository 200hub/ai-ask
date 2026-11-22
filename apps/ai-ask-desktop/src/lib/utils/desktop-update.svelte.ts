/** 改编自 Hai beta.35 desktop-update 模板；版本、下载与验签由 Tauri 官方插件提供。 */
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { configStore } from '$lib/stores/config.svelte'
import { APP_INFO, DESKTOP_UPDATE } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'
import { getVersion } from '@tauri-apps/api/app'
import { Channel, invoke, isTauri, Resource } from '@tauri-apps/api/core'
import { Update } from '@tauri-apps/plugin-updater'

export type DesktopUpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'unavailable' | 'check-failed' | 'downloading' | 'ready' | 'installing' | 'install-failed'
type Metadata = Omit<ConstructorParameters<typeof Update>[0], 'body'> & { body?: string | null }
type CheckResult = { status: 'current' | 'unavailable' } | { status: 'available', update: Metadata }

export class DesktopUpdate {
  version = $state<string>(APP_INFO.version)
  enabled = $state(false)
  status = $state<DesktopUpdateStatus>('idle')
  latestVersion = $state('')
  notes = $state('')
  percent = $state<number>()
  busy = $derived(['checking', 'downloading', 'installing'].includes(this.status))
  private candidate: Update | null = null
  private downloaded: Resource | null = null
  private generation = 0
  private initialization: Promise<void> | null = null
  private disposed = false

  initialize(): Promise<void> {
    if (this.initialization)
      return this.initialization
    this.disposed = false
    const generation = ++this.generation
    this.initialization = this.initializeNative(generation)
    return this.initialization
  }

  private async initializeNative(generation: number): Promise<void> {
    if (!isTauri()) {
      this.status = 'unavailable'
      return
    }
    try {
      await configStore.init()
      const [version, enabled] = await Promise.all([getVersion(), invoke<boolean>('desktop_update_configured')])
      if (!this.current(generation))
        return
      this.version = version
      this.enabled = enabled
      if (!enabled) {
        this.status = 'unavailable'
        return
      }
      await this.check()
      if (this.current(generation) && configStore.config.autoUpdateEnabled && this.status === 'available')
        await this.download()
    }
    catch (error) {
      if (this.current(generation)) {
        this.status = 'check-failed'
        this.initialization = null
        logger.warn('Failed to initialize signed desktop updates', { error })
      }
    }
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  async check(): Promise<void> {
    if (!this.enabled || this.busy || this.disposed || this.status === 'ready')
      return
    this.status = 'checking'
    this.latestVersion = ''
    this.notes = ''
    const generation = this.generation
    await this.releaseCandidate()
    try {
      const result = await invoke<CheckResult>('desktop_update_check', { proxy: configStore.config.proxy })
      if (result.status === 'available') {
        const candidate = new Update({ ...result.update, body: result.update.body ?? undefined })
        if (!this.current(generation)) {
          await this.closeResource(candidate, 'candidate')
          return
        }
        this.candidate = candidate
        this.latestVersion = candidate.version
        this.notes = candidate.body?.trim().slice(0, DESKTOP_UPDATE.NOTES_MAX_LENGTH) ?? ''
      }
      if (this.current(generation))
        this.status = result.status
    }
    catch (error) {
      if (this.current(generation)) {
        this.status = 'check-failed'
        logger.warn('Signed desktop update failed', { stage: 'check', error })
      }
    }
  }

  async download(): Promise<void> {
    const candidate = this.candidate
    if (!candidate || this.status !== 'available' || this.disposed)
      return
    const generation = this.generation
    this.status = 'downloading'
    this.percent = undefined
    let total: number | undefined
    let received = 0
    const events = new Channel<DownloadEvent>()
    events.onmessage = (event) => {
      if (!this.current(generation))
        return
      if (event.event === 'Started') {
        total = event.data.contentLength
}
      else if (event.event === 'Progress') {
        received += event.data.chunkLength
        if (total)
          this.percent = Math.min(100, Math.floor(received * 100 / total))
      }
    }
    try {
      const rid = await invoke<number>('desktop_update_download', { rid: candidate.rid, onEvent: events })
      const resource = new Resource(rid)
      if (!this.current(generation)) {
        await this.closeResource(resource, 'late-download')
        return
      }
      this.downloaded = resource
      this.status = 'ready'
    }
    catch (error) {
      if (this.current(generation)) {
        this.status = 'check-failed'
        logger.warn('Signed desktop update failed', { stage: 'download', error })
      }
    }
    finally {
      if (this.candidate === candidate)
        await this.releaseCandidate()
      else
        await this.closeResource(candidate, 'candidate')
    }
  }

  /** 仅由用户确认安装后调用；原生命令先收齐保存回执，再调用官方安装并重启。 */
  async install(): Promise<void> {
    const downloaded = this.downloaded
    if (!downloaded || !['ready', 'install-failed'].includes(this.status) || this.disposed)
      return
    const generation = this.generation
    this.status = 'installing'
    try {
      await invoke('desktop_update_install', { rid: downloaded.rid })
    }
    catch (error) {
      if (this.current(generation)) {
        this.status = 'install-failed'
        logger.warn('Signed desktop update failed', { stage: 'install', error })
      }
    }
    finally {
      if (!this.current(generation)) {
        if (this.downloaded === downloaded)
          this.downloaded = null
        await this.closeResource(downloaded, 'late-install')
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.initialization = null
    this.enabled = false
    if (this.status !== 'downloading')
      void this.releaseCandidate()
    if (this.status !== 'installing') {
      void this.closeResource(this.downloaded, 'dispose')
      this.downloaded = null
    }
    this.status = 'idle'
  }

  private async closeResource(resource: Resource | null, stage: string): Promise<void> {
    try {
      await resource?.close()
    }
    catch (error) {
      logger.debug('Failed to release signed update resource', { stage, error })
    }
  }

  private async releaseCandidate(): Promise<void> {
    const candidate = this.candidate
    this.candidate = null
    await this.closeResource(candidate, 'candidate')
  }
}

export const desktopUpdate = new DesktopUpdate()
