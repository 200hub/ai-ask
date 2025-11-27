/**
 * 更新管理器 - 处理应用自动更新的状态和逻辑
 *
 * 将 Header.svelte 中的更新相关逻辑抽取为独立模块，
 * 提高代码可维护性和可测试性。
 */
import type { ReleaseAsset } from '$lib/types/update'
import { appState } from '$lib/stores/app.svelte'
import { configStore } from '$lib/stores/config.svelte'
import { APP_INFO } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'
import {
  checkUpdate,
  downloadUpdate,
  getDownloadStatus,
  installUpdateNow,
  onUpdateAvailable,
  onUpdateDownloaded,
  selectAssetForUserAgent,
} from '$lib/utils/update'

/** 更新状态类型 */
export type UpdateStatus = 'hidden' | 'available' | 'downloading' | 'ready' | 'failed'

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 2000

/**
 * 更新管理器类
 *
 * 使用 Svelte 5 Runes 进行状态管理
 */
class UpdateManager {
  // 公开状态
  status = $state<UpdateStatus>('hidden')
  version = $state<string>('')
  releaseNotes = $state<string>('')
  releaseUrl = $state<string>('')

  // 内部状态
  private assets = $state<ReleaseAsset[]>([])
  private publishedAt = $state<string>('')
  private taskId = $state<string>('')
  private autoDownloadTriggered = $state<boolean>(false)
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private initialized = false

  /**
   * 初始化更新管理器
   * 注册事件监听器并检查更新
   */
  async init(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') {
      return
    }
    this.initialized = true

    try {
      // 注册更新可用事件监听
      await onUpdateAvailable(({ version, assets, releaseNotes, releaseUrl, publishedAt }) => {
        logger.info('Update available event received', {
          version,
          assetCount: assets?.length ?? 0,
        })

        this.applyMetadata({
          version: version as string,
          assets: assets as unknown as ReleaseAsset[],
          releaseNotes: releaseNotes ?? null,
          releaseUrl: releaseUrl ?? null,
          publishedAt: publishedAt ?? null,
        })

        this.maybeAutoDownload('event')
      })

      // 注册更新下载完成事件监听
      await onUpdateDownloaded(({ version, taskId }) => {
        this.stopPolling()
        logger.info('Update downloaded event received', { version, taskId })

        this.version = version as string
        this.taskId = taskId as string
        this.status = 'ready'
        this.autoDownloadTriggered = false
        this.syncToAppState()
      })

      // 主动检查更新
      await this.checkForUpdates()
    }
    catch (error) {
      logger.warn('Failed to initialize update manager', error)
    }
  }

  /**
   * 销毁更新管理器，清理资源
   */
  destroy(): void {
    this.stopPolling()
  }

  /**
   * 手动触发下载
   */
  async download(): Promise<void> {
    const asset = selectAssetForUserAgent(this.assets)
    await this.triggerDownload(asset, 'manual')
  }

  /**
   * 安装并重启
   */
  async installAndRestart(): Promise<void> {
    if (!this.taskId) {
      logger.warn('Install update requested but task id missing')
      return
    }

    this.stopPolling()
    logger.info('Install update requested', { taskId: this.taskId })

    const started = await installUpdateNow(this.taskId)
    if (!started) {
      this.status = 'failed'
      logger.error('Install update command failed', { taskId: this.taskId })
    }
  }

  // ============ 私有方法 ============

  /**
   * 检查更新
   */
  private async checkForUpdates(): Promise<void> {
    const info = await checkUpdate()

    if (!info?.hasUpdate) {
      logger.info('Update check completed with no newer version')
      this.setNoUpdate()
      return
    }

    const resolvedVersion = (info.latestVersion as string) ?? ''
    this.applyMetadata({
      version: resolvedVersion,
      assets: (info.assets ?? []) as ReleaseAsset[],
      releaseNotes: info.releaseNotes ?? null,
      releaseUrl: info.releaseUrl ?? null,
      publishedAt: info.publishedAt ?? null,
    })

    if (!this.assets.length) {
      logger.warn('Update detected but assets list is empty', info)
    }
    else {
      logger.info('Update check found release', {
        version: resolvedVersion,
        assetCount: this.assets.length,
      })
    }

    this.maybeAutoDownload('check')
  }

  /**
   * 应用更新元数据
   */
  private applyMetadata(params: {
    version: string
    assets?: ReleaseAsset[]
    releaseNotes?: string | null
    releaseUrl?: string | null
    publishedAt?: string | null
  }): void {
    this.version = params.version
    if (params.assets) {
      this.assets = params.assets
    }
    this.releaseNotes = params.releaseNotes ?? ''
    this.releaseUrl = params.releaseUrl ?? ''
    this.publishedAt = params.publishedAt ?? ''
    this.syncToAppState()
  }

  /**
   * 设置无更新状态
   */
  private setNoUpdate(): void {
    this.status = 'hidden'
    this.version = APP_INFO.version
    this.assets = []
    this.releaseNotes = ''
    this.releaseUrl = ''
    this.publishedAt = ''

    appState.setUpdateInfo({
      version: APP_INFO.version,
      releaseNotes: null,
      releaseUrl: null,
      publishedAt: null,
    })
  }

  /**
   * 同步更新信息到全局应用状态
   */
  private syncToAppState(): void {
    if (!this.version) {
      appState.clearUpdateInfo()
      return
    }

    appState.setUpdateInfo({
      version: this.version,
      releaseNotes: this.releaseNotes || null,
      releaseUrl: this.releaseUrl || null,
      publishedAt: this.publishedAt || null,
    })
  }

  /**
   * 如果启用了自动更新，则自动触发下载
   */
  private maybeAutoDownload(source: 'event' | 'check'): void {
    if (configStore.config.autoUpdateEnabled && !this.autoDownloadTriggered) {
      this.autoDownloadTriggered = true
      const asset = selectAssetForUserAgent(this.assets)
      logger.info('Auto update enabled - triggering download', {
        version: this.version,
        assetName: asset?.name ?? 'unknown',
        source,
      })
      void this.triggerDownload(asset, 'auto')
    }
    else {
      this.status = 'available'
    }
  }

  /**
   * 触发下载
   */
  private async triggerDownload(
    asset: ReleaseAsset | null,
    source: 'manual' | 'auto',
  ): Promise<void> {
    if (!asset) {
      this.status = 'failed'
      logger.warn('Update download skipped: no matching asset', {
        version: this.version,
        source,
      })
      if (source === 'auto') {
        this.autoDownloadTriggered = false
      }
      return
    }

    logger.info('Update download requested', {
      version: this.version,
      asset: asset.name,
      source,
    })

    this.status = 'downloading'

    const task = await downloadUpdate(this.version, String(asset.id))
    if (!task) {
      logger.error('Update download invocation failed', {
        version: this.version,
        asset: asset.name,
        source,
      })
      this.status = 'failed'
      if (source === 'auto') {
        this.autoDownloadTriggered = false
      }
      return
    }

    this.taskId = task.id
    logger.info('Update download task started', {
      version: this.version,
      taskId: task.id,
      asset: asset.name,
      source,
    })
    this.startPolling(task.id)
  }

  /**
   * 开始轮询下载状态
   */
  private startPolling(taskId: string): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => {
      void this.refreshDownloadStatus(taskId)
    }, POLL_INTERVAL_MS)
    void this.refreshDownloadStatus(taskId)
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * 刷新下载状态
   */
  private async refreshDownloadStatus(taskId: string): Promise<void> {
    const downloadStatus = await getDownloadStatus(taskId)
    if (!downloadStatus) {
      return
    }

    switch (downloadStatus.status) {
      case 'completed':
        this.stopPolling()
        this.status = 'ready'
        this.taskId = downloadStatus.id
        logger.info('Update download completed (poll)', {
          taskId: downloadStatus.id,
          bytes: downloadStatus.bytesDownloaded,
        })
        this.autoDownloadTriggered = false
        break

      case 'failed':
        this.stopPolling()
        this.status = 'failed'
        logger.error('Update download failed (poll)', {
          taskId: downloadStatus.id,
          error: downloadStatus.error,
        })
        this.autoDownloadTriggered = false
        break

      case 'running':
        if (this.status !== 'downloading') {
          this.status = 'downloading'
        }
        if (downloadStatus.bytesDownloaded && downloadStatus.bytesTotal) {
          logger.debug('Update download progress', {
            taskId: downloadStatus.id,
            downloaded: downloadStatus.bytesDownloaded,
            total: downloadStatus.bytesTotal,
          })
        }
        break
    }
  }
}

// 导出单例实例
export const updateManager = new UpdateManager()
