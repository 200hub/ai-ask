/**
 * 更新相关类型定义
 */

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios'
export type Arch = 'x64' | 'arm64' | 'universal' | null

export interface VersionInfo {
  currentVersion: string
  latestVersion: string
  isPrerelease: boolean
  publishedAt: string // ISO datetime
}

export interface ReleaseAsset {
  id: string | number
  name: string
  platform: Platform
  arch: Arch
  downloadUrl: string
  size?: number | null
  checksum?: { algo: 'sha256', value: string } | null
}

export type DownloadStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface DownloadTask {
  id: string
  status: DownloadStatus
  startedAt: string // ISO datetime
  completedAt?: string | null // ISO datetime
  error?: string | null
  targetAsset: ReleaseAsset
  bytesTotal?: number | null
  bytesDownloaded?: number | null
}
