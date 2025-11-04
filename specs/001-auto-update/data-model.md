# Data Model: 版本检查与自动更新

## Entities

### Config（配置）
- autoUpdateEnabled: boolean（默认 false）
- proxy: { protocol: 'http'|'https', host: string, port: number, auth?: { username: string, password: string } }
- lastCheckedAt: datetime | null

### VersionInfo（版本信息）
- currentVersion: string (semver)
- latestVersion: string (semver)
- isPrerelease: boolean
- publishedAt: datetime

### ReleaseAsset（发布资产）
- id: string | number
- name: string
- platform: 'windows'|'macos'|'linux'|'android'|'ios'
- arch: 'x64'|'arm64'|'universal'|null
- downloadUrl: string
- checksum?: { algo: 'sha256', value: string }

### DownloadTask（下载任务）
- id: string
- status: 'idle'|'running'|'completed'|'failed'
- startedAt: datetime
- completedAt?: datetime
- error?: string
- targetAsset: ReleaseAsset
- bytesTotal?: number
- bytesDownloaded?: number

### UIBanner（头部提示）
- type: 'new-available'|'downloading'|'ready-to-restart'|'failed'
- messageKey: string (i18n key)
- actions: { labelKey: string, action: 'download'|'restart'|'dismiss' }[]

## Relationships
- Config 持久化于应用存储（`plugin-store`）
- VersionInfo 来源于 GitHub Releases；DownloadTask 关联一个 ReleaseAsset

## Validation Rules
- 版本比较遵循语义化；仅当 latestVersion > currentVersion 时判定可更新
- 资产 platform/arch 必须与当前系统匹配
- 下载完成后若存在 checksum 则进行校验；失败置为 `failed`
