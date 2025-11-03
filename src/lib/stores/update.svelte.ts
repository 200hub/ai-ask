import { invoke } from '@tauri-apps/api/core';
import type { ProxyConfig } from '$lib/types/config';
import { log } from '$lib/utils/logger';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface UpdateInitOptions {
  currentVersion: string;
  autoUpdate: boolean;
  proxy?: ProxyConfig;
}

export interface UpdateAvailablePayload {
  version?: string;
  notes?: string;
}

export interface UpdateProgressPayload {
  percent?: number;
  downloaded?: number;
  total?: number;
}

export interface UpdateDownloadedPayload {
  version?: string;
}

export interface UpdateErrorPayload {
  message?: string;
}

class UpdateStore {
  status = $state<UpdateStatus>('idle');
  currentVersion = $state<string | null>(null);
  latestVersion = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);
  downloadProgress = $state<number>(0);
  autoUpdateEnabled = $state<boolean>(true);
  proxy = $state<ProxyConfig | undefined>(undefined);
  pendingInstall = $state<boolean>(false);
  error = $state<string | null>(null);
  lastCheckedAt = $state<number | null>(null);

  async init(options: UpdateInitOptions): Promise<void> {
    this.currentVersion = options.currentVersion;
    this.status = 'idle';
    this.latestVersion = null;
    this.releaseNotes = null;
    this.downloadProgress = 0;
    this.pendingInstall = false;
    this.error = null;
    this.lastCheckedAt = null;
    this.autoUpdateEnabled = options.autoUpdate;
    this.proxy = options.proxy;

    if (options.autoUpdate) {
      await this.checkForUpdates();
    }
  }

  syncConfig(config: { autoUpdate: boolean; proxy?: ProxyConfig }): void {
    const wasEnabled = this.autoUpdateEnabled;
    this.autoUpdateEnabled = config.autoUpdate;
    this.proxy = config.proxy;

    if (!wasEnabled && config.autoUpdate) {
      void this.checkForUpdates();
    }
  }

  async checkForUpdates(manual = false): Promise<void> {
    if (this.status === 'checking' || this.status === 'downloading' || this.status === 'installing') {
      return;
    }

    if (!manual && !this.autoUpdateEnabled) {
      return;
    }

    this.status = 'checking';
    this.error = null;
    this.downloadProgress = 0;
    this.pendingInstall = false;

    try {
      await invoke('start_update_check', {
        currentVersion: this.currentVersion,
        proxy: this.proxy,
        manual,
      });
      this.lastCheckedAt = Date.now();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.error = message;
      log.error('自动更新检查失败', error);
    }
  }

  async startDownload(): Promise<void> {
    if (this.status === 'downloading' || this.status === 'installing') {
      return;
    }

    this.status = 'downloading';
    this.downloadProgress = 0;
    this.error = null;
    this.pendingInstall = false;

    try {
      await invoke('start_update_download', {
        version: this.latestVersion,
        proxy: this.proxy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.error = message;
      log.error('下载应用更新失败', error);
    }
  }

  async cancelDownload(): Promise<void> {
    if (this.status !== 'downloading') {
      return;
    }

    try {
      await invoke('cancel_update_download');
      this.status = this.latestVersion ? 'available' : 'idle';
      this.downloadProgress = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.error = message;
      log.error('取消应用更新下载失败', error);
    }
  }

  async installAndRestart(): Promise<void> {
    if (!(this.pendingInstall || this.status === 'downloaded')) {
      return;
    }

    this.status = 'installing';
    this.error = null;

    try {
      await invoke('install_downloaded_update');
      this.pendingInstall = false;
      this.status = 'idle';
      this.latestVersion = null;
      this.releaseNotes = null;
      this.downloadProgress = 0;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.error = message;
      this.pendingInstall = true;
      log.error('安装应用更新失败', error);
    }
  }

  handleUpdateAvailable(payload: UpdateAvailablePayload | undefined): void {
    this.status = 'available';
    this.pendingInstall = false;
    this.error = null;
    this.downloadProgress = 0;
    this.latestVersion = payload?.version ?? null;
    this.releaseNotes = payload?.notes ?? null;
  }

  handleUpdateProgress(payload: UpdateProgressPayload | undefined): void {
    this.status = 'downloading';
    this.pendingInstall = false;

    const progressValue = this.normalizeProgress(payload);
    if (progressValue !== null) {
      this.downloadProgress = progressValue;
    }
  }

  handleUpdateDownloaded(payload: UpdateDownloadedPayload | undefined): void {
    this.status = 'downloaded';
    this.pendingInstall = true;
    this.error = null;
    this.downloadProgress = 100;
    if (payload?.version) {
      this.latestVersion = payload.version;
    }
  }

  handleUpdateError(payload: UpdateErrorPayload | undefined): void {
    this.status = 'error';
    this.pendingInstall = false;
    this.downloadProgress = 0;
    this.error = payload?.message ?? null;
  }

  acknowledgeInstalled(): void {
    this.status = 'idle';
    this.pendingInstall = false;
    this.latestVersion = null;
    this.releaseNotes = null;
    this.downloadProgress = 0;
    this.error = null;
  }

  private normalizeProgress(payload: UpdateProgressPayload | undefined): number | null {
    if (!payload) {
      return null;
    }

    const { percent, downloaded, total } = payload;

    if (typeof percent === 'number' && Number.isFinite(percent)) {
      const normalized = percent > 1 ? percent : percent * 100;
      return Math.max(0, Math.min(100, Math.round(normalized)));
    }

    if (
      typeof downloaded === 'number' &&
      typeof total === 'number' &&
      Number.isFinite(downloaded) &&
      Number.isFinite(total) &&
      total > 0
    ) {
      const ratio = (downloaded / total) * 100;
      return Math.max(0, Math.min(100, Math.round(ratio)));
    }

    return null;
  }
}

export const updateStore = new UpdateStore();
