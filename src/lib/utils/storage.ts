import type { AppConfig, ProxyConfig } from '../types/config'
import type { DesktopNote, DesktopNoteBounds, DesktopNoteColor, DesktopNoteSyncState } from '../types/desktop-note'
import type { AIPlatform, TranslationPlatform } from '../types/platform'
/**
 * 存储工具类 - 用于配置的持久化
 */
import { Store } from '@tauri-apps/plugin-store'
import { DEFAULT_CONFIG } from '../types/config'
import {
  BUILT_IN_AI_PLATFORMS,
  BUILT_IN_TRANSLATION_PLATFORMS,
  DESKTOP_NOTE_COLOR_PRESETS,
  DESKTOP_NOTES,
} from './constants'
import { logger } from './logger'

/**
 * 配置存储键
 */
const STORAGE_KEYS = {
  CONFIG: 'app_config',
  AI_PLATFORMS: 'ai_platforms',
  TRANSLATION_PLATFORMS: 'translation_platforms',
  CUSTOM_PLATFORMS: 'custom_platforms',
  DESKTOP_NOTES: 'desktop_notes',
}

const DESKTOP_NOTE_COLOR_IDS = new Set<DesktopNoteColor>(
  DESKTOP_NOTE_COLOR_PRESETS.map(item => item.id),
)

function normalizeDesktopNoteColor(value: unknown): DesktopNoteColor {
  if (typeof value === 'string' && DESKTOP_NOTE_COLOR_IDS.has(value as DesktopNoteColor)) {
    return value as DesktopNoteColor
  }

  return DESKTOP_NOTES.DEFAULT_COLOR as DesktopNoteColor
}

function normalizeNoteBounds(value: unknown): DesktopNoteBounds {
  const candidate = value as Partial<DesktopNoteBounds> | null | undefined
  const width = Number(candidate?.width)
  const height = Number(candidate?.height)
  const x = Number(candidate?.x)
  const y = Number(candidate?.y)

  const bounds: DesktopNoteBounds = {
    width: Number.isFinite(width) ? Math.max(DESKTOP_NOTES.MIN_WIDTH, width) : DESKTOP_NOTES.DEFAULT_WIDTH,
    height: Number.isFinite(height) ? Math.max(DESKTOP_NOTES.MIN_HEIGHT, height) : DESKTOP_NOTES.DEFAULT_HEIGHT,
    x: Number.isFinite(x) ? x : DESKTOP_NOTES.DEFAULT_OFFSET_X,
    y: Number.isFinite(y) ? y : DESKTOP_NOTES.DEFAULT_OFFSET_Y,
  }

  // 保留屏幕参考尺寸（用于跨分辨率/DPI 等比缩放）
  const refW = Number(candidate?.refScreenWidth)
  const refH = Number(candidate?.refScreenHeight)
  if (Number.isFinite(refW) && refW > 0) {
    bounds.refScreenWidth = refW
  }
  if (Number.isFinite(refH) && refH > 0) {
    bounds.refScreenHeight = refH
  }

  return bounds
}

function normalizeDesktopNoteSync(value: unknown): DesktopNoteSyncState {
  const candidate = value as Partial<DesktopNoteSyncState> | null | undefined
  const lastSyncedAt = typeof candidate?.lastSyncedAt === 'number' && Number.isFinite(candidate.lastSyncedAt)
    ? candidate.lastSyncedAt
    : null

  return {
    dirty: candidate?.dirty !== false,
    lastSyncedAt,
  }
}

function normalizeDeletedAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  // 兼容旧版 sync.deleted 布尔迁移：如果旧数据有 deleted=true，转为时间戳
  return null
}

function createDefaultDesktopNote(partial?: Partial<DesktopNote>): DesktopNote {
  const now = Date.now()

  // 兼容旧版数据迁移：从 sync.deleted + sync.issueNumber 等字段迁移
  const legacySync = partial?.sync as Record<string, unknown> | undefined
  let deletedAt = normalizeDeletedAt(partial?.deletedAt)
  if (!deletedAt && legacySync?.deleted === true) {
    deletedAt = now // 旧版 deleted=true → 转为软删除时间戳
  }

  return {
    id: partial?.id ?? `note-${now}`,
    title: partial?.title ?? '',
    content: partial?.content ?? '',
    color: normalizeDesktopNoteColor(partial?.color),
    visible: partial?.visible ?? true,
    bounds: normalizeNoteBounds(partial?.bounds),
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    deletedAt,
    sync: normalizeDesktopNoteSync(partial?.sync),
  }
}

function normalizeDesktopNotes(value: unknown): DesktopNote[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const candidate = entry as Partial<DesktopNote>
      if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
        return null
      }

      return createDefaultDesktopNote(candidate)
    })
    .filter((item): item is DesktopNote => item !== null)

  // 以 id 去重：保留 updatedAt 更新的那条，避免重复 key 触发 Svelte each_key_duplicate
  const deduped = new Map<string, DesktopNote>()
  for (const note of normalized) {
    const existing = deduped.get(note.id)
    if (!existing || note.updatedAt >= existing.updatedAt) {
      deduped.set(note.id, note)
    }
  }

  return Array.from(deduped.values())
}

function normalizeProxyConfig(
  proxy: (ProxyConfig | { type?: string, host?: string, port?: string }) | null | undefined,
): ProxyConfig {
  if (!proxy) {
    return { type: 'system' }
  }

  const proxyType = (proxy as { type?: string }).type ?? 'system'

  if (proxyType === 'custom') {
    return {
      type: 'custom',
      host: (proxy as { host?: string }).host,
      port: (proxy as { port?: string }).port,
    }
  }

  if (proxyType === 'system') {
    return { type: 'system' }
  }

  // Legacy value (e.g. "none")
  return { type: 'system' }
}

function normalizeIgnoredAppsConfig(value: unknown): string[] {
  const candidates: string[] = []

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        candidates.push(entry)
      }
      else if (entry != null) {
        candidates.push(String(entry))
      }
    }
  }
  else if (typeof value === 'string') {
    candidates.push(...value.split(/[\n,;]+/))
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of candidates) {
    const trimmed = raw.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}

function normalizePositiveDuration(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallback
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

/**
 * Store实例
 */
let store: Store | null = null

/**
 * 初始化Store
 */
export async function initStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('config.json')
  }
  return store
}

/**
 * 获取应用配置
 */
export async function getConfig(): Promise<AppConfig> {
  try {
    const storeInstance = await initStore()
    const config = await storeInstance.get<AppConfig>(STORAGE_KEYS.CONFIG)

    if (!config) {
      // 首次运行，返回默认配置
      await saveConfig(DEFAULT_CONFIG)
      return DEFAULT_CONFIG
    }

    // 合并默认配置（防止新增配置项时出现undefined）
    const merged: AppConfig = { ...DEFAULT_CONFIG, ...config }
    const rawConfig = config as unknown as Record<string, unknown>

    merged.proxy = normalizeProxyConfig(config?.proxy ?? merged.proxy)

    let needsSave = false

    const normalizedIgnored = normalizeIgnoredAppsConfig(
      rawConfig.selectionToolbarIgnoredApps ?? merged.selectionToolbarIgnoredApps,
    )
    if (!areStringArraysEqual(normalizedIgnored, merged.selectionToolbarIgnoredApps)) {
      merged.selectionToolbarIgnoredApps = normalizedIgnored
      needsSave = true
    }

    const normalizedDuration = normalizePositiveDuration(
      rawConfig.selectionToolbarTemporaryDisableDurationMs,
      DEFAULT_CONFIG.selectionToolbarTemporaryDisableDurationMs,
    )
    if (normalizedDuration !== merged.selectionToolbarTemporaryDisableDurationMs) {
      merged.selectionToolbarTemporaryDisableDurationMs = normalizedDuration
      needsSave = true
    }

    const normalizedUntil = normalizeOptionalTimestamp(
      rawConfig.selectionToolbarTemporaryDisabledUntil,
    )
    if (normalizedUntil !== merged.selectionToolbarTemporaryDisabledUntil) {
      merged.selectionToolbarTemporaryDisabledUntil = normalizedUntil
      needsSave = true
    }

    if (needsSave) {
      await saveConfig(merged)
    }

    return merged
  }
  catch (error) {
    logger.error('Failed to get config', error)
    return DEFAULT_CONFIG
  }
}

/**
 * 保存应用配置
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    const storeInstance = await initStore()
    await storeInstance.set(STORAGE_KEYS.CONFIG, config)
    await storeInstance.save()
  }
  catch (error) {
    logger.error('Failed to save config', error)
    throw error
  }
}

/**
 * 更新配置的部分字段
 */
export async function updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  try {
    const currentConfig = await getConfig()

    // 深度合并配置，确保 proxy 字段正确更新
    const newConfig: AppConfig = {
      ...currentConfig,
      ...updates,
    }

    // 如果 updates 中明确包含 proxy，则覆盖
    if ('proxy' in updates) {
      newConfig.proxy = updates.proxy
    }

    newConfig.proxy = normalizeProxyConfig(newConfig.proxy)

    await saveConfig(newConfig)
    return newConfig
  }
  catch (error) {
    logger.error('Failed to update config', error)
    throw error
  }
}

/**
 * 获取桌面便签列表
 */
export async function getDesktopNotes(): Promise<DesktopNote[]> {
  try {
    const storeInstance = await initStore()
    const raw = await storeInstance.get<DesktopNote[]>(STORAGE_KEYS.DESKTOP_NOTES)
    const normalized = normalizeDesktopNotes(raw)

    if (JSON.stringify(raw ?? []) !== JSON.stringify(normalized)) {
      await saveDesktopNotes(normalized)
    }

    return normalized
  }
  catch (error) {
    logger.error('Failed to get desktop notes', error)
    return []
  }
}

/**
 * 保存桌面便签列表
 */
export async function saveDesktopNotes(notes: DesktopNote[]): Promise<void> {
  try {
    const normalized = normalizeDesktopNotes(notes)
    const storeInstance = await initStore()
    await storeInstance.set(STORAGE_KEYS.DESKTOP_NOTES, normalized)
    await storeInstance.save()
  }
  catch (error) {
    logger.error('Failed to save desktop notes', error)
    throw error
  }
}

/**
 * 获取AI平台列表
 */
export async function getAIPlatforms(): Promise<AIPlatform[]> {
  try {
    const storeInstance = await initStore()
    const platforms = await storeInstance.get<AIPlatform[]>(STORAGE_KEYS.AI_PLATFORMS)

    if (!platforms) {
      // 首次运行，返回内置平台
      await saveAIPlatforms(BUILT_IN_AI_PLATFORMS)
      return [...BUILT_IN_AI_PLATFORMS]
    }

    const defaultsById = new Map(BUILT_IN_AI_PLATFORMS.map(platform => [platform.id, platform]))
    const defaultIds = new Set(defaultsById.keys())

    let hasUpdates = false

    const normalized: AIPlatform[] = []

    for (const platform of platforms) {
      if (platform.isCustom) {
        normalized.push(platform)
        continue
      }

      const defaults = defaultsById.get(platform.id)
      if (!defaults) {
        // 移除已下线的内置平台
        hasUpdates = true
        continue
      }

      const selectionToolbarAvailable = defaults.selectionToolbarAvailable ?? true
      // 保留用户设置的 preload 值，新平台使用默认值
      const preload = platform.preload ?? defaults.preload ?? false

      const merged: AIPlatform = {
        ...defaults,
        enabled: platform.enabled,
        sortOrder: platform.sortOrder ?? defaults.sortOrder,
        selectionToolbarAvailable,
        preload,
      }

      if (platform.icon !== defaults.icon) {
        hasUpdates = true
      }
      if (platform.name !== defaults.name || platform.url !== defaults.url) {
        hasUpdates = true
      }
      if (platform.selectionToolbarAvailable !== selectionToolbarAvailable) {
        hasUpdates = true
      }
      // 检查 preload 是否需要更新
      if (platform.preload !== preload) {
        hasUpdates = true
      }

      normalized.push({ ...merged })
      defaultIds.delete(platform.id)
    }

    if (defaultIds.size > 0) {
      // 新增的内置平台
      for (const id of defaultIds) {
        const defaults = defaultsById.get(id)
        if (defaults) {
          normalized.push({ ...defaults })
          hasUpdates = true
        }
      }
    }

    normalized.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder
      }
      return a.name.localeCompare(b.name)
    })

    normalized.forEach((platform, index) => {
      const expected = index + 1
      if (platform.sortOrder !== expected) {
        platform.sortOrder = expected
        hasUpdates = true
      }
    })

    if (hasUpdates) {
      await saveAIPlatforms(normalized)
      return normalized
    }

    return normalized
  }
  catch (error) {
    logger.error('Failed to get AI platforms', error)
    return [...BUILT_IN_AI_PLATFORMS]
  }
}

/**
 * 保存AI平台列表
 */
export async function saveAIPlatforms(platforms: AIPlatform[]): Promise<void> {
  try {
    const storeInstance = await initStore()
    await storeInstance.set(STORAGE_KEYS.AI_PLATFORMS, platforms)
    await storeInstance.save()
  }
  catch (error) {
    logger.error('Failed to save AI platforms', error)
    throw error
  }
}

/**
 * 添加自定义AI平台
 */
export async function addCustomPlatform(
  platform: Omit<AIPlatform, 'id' | 'isCustom' | 'sortOrder'>,
): Promise<AIPlatform> {
  try {
    const platforms = await getAIPlatforms()
    const newPlatform: AIPlatform = {
      ...platform,
      id: `custom_${Date.now()}`,
      isCustom: true,
      sortOrder: platforms.length + 1,
    }

    platforms.push(newPlatform)
    await saveAIPlatforms(platforms)
    return newPlatform
  }
  catch (error) {
    logger.error('Failed to add custom platform', error)
    throw error
  }
}

/**
 * 更新AI平台
 */
export async function updateAIPlatform(id: string, updates: Partial<AIPlatform>): Promise<void> {
  try {
    const platforms = await getAIPlatforms()
    const index = platforms.findIndex(p => p.id === id)

    if (index !== -1) {
      platforms[index] = { ...platforms[index], ...updates }
      await saveAIPlatforms(platforms)
    }
  }
  catch (error) {
    logger.error('Failed to update AI platform', error)
    throw error
  }
}

/**
 * 删除AI平台（仅自定义平台）
 */
export async function deleteAIPlatform(id: string): Promise<void> {
  try {
    const platforms = await getAIPlatforms()
    const platform = platforms.find(p => p.id === id)

    if (platform && platform.isCustom) {
      const filtered = platforms.filter(p => p.id !== id)
      await saveAIPlatforms(filtered)
    }
  }
  catch (error) {
    logger.error('Failed to delete AI platform', error)
    throw error
  }
}

/**
 * 获取翻译平台列表
 */
export async function getTranslationPlatforms(): Promise<TranslationPlatform[]> {
  try {
    const storeInstance = await initStore()
    const platforms = await storeInstance.get<TranslationPlatform[]>(
      STORAGE_KEYS.TRANSLATION_PLATFORMS,
    )

    if (!platforms) {
      await saveTranslationPlatforms(BUILT_IN_TRANSLATION_PLATFORMS)
      return [...BUILT_IN_TRANSLATION_PLATFORMS]
    }
    const defaultsById = new Map(
      BUILT_IN_TRANSLATION_PLATFORMS.map(platform => [platform.id, platform]),
    )

    let hasUpdates = false
    const normalized: TranslationPlatform[] = []

    for (const platform of platforms) {
      const defaults = defaultsById.get(platform.id)
      if (!defaults) {
        // 保留自定义或未知平台
        normalized.push(platform)
        continue
      }

      const merged: TranslationPlatform = {
        ...defaults,
        enabled: platform.enabled,
      }

      if (
        platform.name !== defaults.name
        || platform.url !== defaults.url
        || platform.icon !== defaults.icon
        || JSON.stringify(platform.supportLanguages) !== JSON.stringify(defaults.supportLanguages)
      ) {
        hasUpdates = true
      }

      normalized.push(merged)
      defaultsById.delete(platform.id)
    }

    if (defaultsById.size > 0) {
      for (const platform of defaultsById.values()) {
        normalized.push({ ...platform })
        hasUpdates = true
      }
    }

    if (hasUpdates) {
      await saveTranslationPlatforms(normalized)
    }

    return normalized
  }
  catch (error) {
    logger.error('Failed to get translation platforms', error)
    return [...BUILT_IN_TRANSLATION_PLATFORMS]
  }
}

/**
 * 保存翻译平台列表
 */
export async function saveTranslationPlatforms(platforms: TranslationPlatform[]): Promise<void> {
  try {
    const storeInstance = await initStore()
    await storeInstance.set(STORAGE_KEYS.TRANSLATION_PLATFORMS, platforms)
    await storeInstance.save()
  }
  catch (error) {
    logger.error('Failed to save translation platforms', error)
    throw error
  }
}

/**
 * 更新翻译平台
 */
export async function updateTranslationPlatform(
  id: string,
  updates: Partial<TranslationPlatform>,
): Promise<void> {
  try {
    const platforms = await getTranslationPlatforms()
    const index = platforms.findIndex(p => p.id === id)

    if (index !== -1) {
      platforms[index] = { ...platforms[index], ...updates }
      await saveTranslationPlatforms(platforms)
    }
  }
  catch (error) {
    logger.error('Failed to update translation platform', error)
    throw error
  }
}

/**
 * 重置所有配置到默认值
 */
export async function resetToDefaults(): Promise<void> {
  try {
    await saveConfig(DEFAULT_CONFIG)
    await saveAIPlatforms(BUILT_IN_AI_PLATFORMS)
    await saveTranslationPlatforms(BUILT_IN_TRANSLATION_PLATFORMS)
  }
  catch (error) {
    logger.error('Failed to reset to defaults', error)
    throw error
  }
}

/**
 * 导出配置（用于备份）
 */
export async function exportConfig(): Promise<string> {
  try {
    const config = await getConfig()
    const aiPlatforms = await getAIPlatforms()
    const translationPlatforms = await getTranslationPlatforms()

    return JSON.stringify(
      {
        config,
        aiPlatforms,
        translationPlatforms,
      },
      null,
      2,
    )
  }
  catch (error) {
    logger.error('Failed to export config', error)
    throw error
  }
}

/**
 * 导入配置（用于恢复备份）
 */
export async function importConfig(jsonString: string): Promise<void> {
  try {
    const data = JSON.parse(jsonString)

    if (data.config) {
      await saveConfig(data.config)
    }
    if (data.aiPlatforms) {
      await saveAIPlatforms(data.aiPlatforms)
    }
    if (data.translationPlatforms) {
      await saveTranslationPlatforms(data.translationPlatforms)
    }
  }
  catch (error) {
    logger.error('Failed to import config', error)
    throw error
  }
}
