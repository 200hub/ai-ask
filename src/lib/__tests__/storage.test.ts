import type { AIPlatform, TranslationPlatform } from '$lib/types/platform'
import { DEFAULT_CONFIG } from '$lib/types/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoreData = Record<string, unknown>

const STORAGE_KEYS = {
  CONFIG: 'app_config',
  AI_PLATFORMS: 'ai_platforms',
  TRANSLATION_PLATFORMS: 'translation_platforms',
}

const builtInAI: AIPlatform[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: 'chatgpt.svg',
    url: 'https://chat.openai.com',
    enabled: true,
    isCustom: false,
    sortOrder: 1,
    selectionToolbarAvailable: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: 'claude.svg',
    url: 'https://claude.ai',
    enabled: true,
    isCustom: false,
    sortOrder: 2,
    selectionToolbarAvailable: false,
  },
]

const builtInTranslation: TranslationPlatform[] = [
  {
    id: 'google',
    name: 'Google',
    icon: 'google.svg',
    url: 'https://translate.google.com',
    enabled: true,
    supportLanguages: ['en', 'zh'],
  },
]

let storeData: StoreData = {}
const saveSpy = vi.fn()

class MockStore {
  static async load() {
    return new MockStore()
  }

  async get<T>(key: string): Promise<T | undefined> {
    return storeData[key] as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    storeData[key] = value
  }

  async save(): Promise<void> {
    saveSpy()
  }
}

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: MockStore,
}))

vi.mock('$lib/utils/constants', () => ({
  BUILT_IN_AI_PLATFORMS: builtInAI,
  BUILT_IN_TRANSLATION_PLATFORMS: builtInTranslation,
  DESKTOP_NOTES: {
    DEFAULT_WIDTH: 320,
    DEFAULT_HEIGHT: 280,
    MIN_WIDTH: 240,
    MIN_HEIGHT: 180,
    DEFAULT_OFFSET_X: 120,
    DEFAULT_OFFSET_Y: 120,
    DEFAULT_SCREEN_WIDTH: 1920,
    DEFAULT_SCREEN_HEIGHT: 1080,
    DEFAULT_COLOR: 'sunny',
  },
  DESKTOP_NOTE_COLOR_PRESETS: [
    { id: 'sunny' },
    { id: 'mint' },
    { id: 'sky' },
    { id: 'lavender' },
    { id: 'rose' },
    { id: 'slate' },
  ],
}))

let getConfig: (typeof import('$lib/utils/storage'))['getConfig']
let saveConfig: (typeof import('$lib/utils/storage'))['saveConfig']
let updateConfig: (typeof import('$lib/utils/storage'))['updateConfig']
let getAIPlatforms: (typeof import('$lib/utils/storage'))['getAIPlatforms']
let addCustomPlatform: (typeof import('$lib/utils/storage'))['addCustomPlatform']
let deleteAIPlatform: (typeof import('$lib/utils/storage'))['deleteAIPlatform']
let getTranslationPlatforms: (typeof import('$lib/utils/storage'))['getTranslationPlatforms']
let resetToDefaults: (typeof import('$lib/utils/storage'))['resetToDefaults']
let getDesktopNotes: (typeof import('$lib/utils/storage'))['getDesktopNotes']
let saveDesktopNotes: (typeof import('$lib/utils/storage'))['saveDesktopNotes']

beforeEach(async () => {
  storeData = {}
  saveSpy.mockClear()
  vi.resetModules()

  const storageModule = await import('$lib/utils/storage')
  getConfig = storageModule.getConfig
  saveConfig = storageModule.saveConfig
  updateConfig = storageModule.updateConfig
  getAIPlatforms = storageModule.getAIPlatforms
  addCustomPlatform = storageModule.addCustomPlatform
  deleteAIPlatform = storageModule.deleteAIPlatform
  getTranslationPlatforms = storageModule.getTranslationPlatforms
  resetToDefaults = storageModule.resetToDefaults
  getDesktopNotes = storageModule.getDesktopNotes
  saveDesktopNotes = storageModule.saveDesktopNotes
})

describe('storage utilities', () => {
  it('returns default config on first load and persists it', async () => {
    const config = await getConfig()

    expect(config).toEqual(DEFAULT_CONFIG)
    expect(storeData[STORAGE_KEYS.CONFIG]).toEqual(DEFAULT_CONFIG)
    expect(saveSpy).toHaveBeenCalled()
  })

  it('normalizes legacy ignored apps values', async () => {
    storeData[STORAGE_KEYS.CONFIG] = {
      ...DEFAULT_CONFIG,
      selectionToolbarIgnoredApps: 'notepad.exe, chrome.exe\n Edge.exe;;',
    }

    saveSpy.mockClear()

    const config = await getConfig()

    expect(config.selectionToolbarIgnoredApps).toEqual(['notepad.exe', 'chrome.exe', 'Edge.exe'])
    expect(saveSpy).toHaveBeenCalled()
  })

  it('normalizes temporary disable numeric fields', async () => {
    storeData[STORAGE_KEYS.CONFIG] = {
      ...DEFAULT_CONFIG,
      selectionToolbarTemporaryDisableDurationMs: '300000',
      selectionToolbarTemporaryDisabledUntil: '1700000000000',
    }

    const config = await getConfig()

    expect(config.selectionToolbarTemporaryDisableDurationMs).toBe(300_000)
    expect(config.selectionToolbarTemporaryDisabledUntil).toBe(1_700_000_000_000)
  })

  it('updates config while normalizing proxy settings', async () => {
    await saveConfig(DEFAULT_CONFIG)

    const updated = await updateConfig({
      proxy: { type: 'custom', host: 'proxy.local', port: '7000' },
      theme: 'dark',
    })

    expect(updated.proxy).toEqual({ type: 'custom', host: 'proxy.local', port: '7000' })
    expect(updated.theme).toBe('dark')
    expect(storeData[STORAGE_KEYS.CONFIG]).toMatchObject({ theme: 'dark' })
  })

  it('initializes AI platforms from built-ins when empty', async () => {
    const platforms = await getAIPlatforms()

    expect(platforms).toEqual(builtInAI)
    expect(storeData[STORAGE_KEYS.AI_PLATFORMS]).toEqual(builtInAI)
  })

  it('forces built-in selection toolbar availability to defaults', async () => {
    storeData[STORAGE_KEYS.AI_PLATFORMS] = builtInAI.map(platform => ({
      ...platform,
      selectionToolbarAvailable: true,
    }))

    const platforms = await getAIPlatforms()
    const claude = platforms.find(platform => platform.id === 'claude')

    expect(claude?.selectionToolbarAvailable).toBe(false)
    expect(
      (storeData[STORAGE_KEYS.AI_PLATFORMS] as AIPlatform[])[1].selectionToolbarAvailable,
    ).toBe(false)
  })

  it('adds and deletes custom AI platforms', async () => {
    const base = await getAIPlatforms()
    expect(base).toHaveLength(2)

    const custom = await addCustomPlatform({
      name: 'Custom',
      icon: 'custom.svg',
      url: 'https://custom.ai',
      enabled: true,
      userAgent: '',
    })

    expect(custom.isCustom).toBe(true)
    expect(custom.sortOrder).toBe(3)

    await deleteAIPlatform(custom.id)
    const platforms = storeData[STORAGE_KEYS.AI_PLATFORMS] as AIPlatform[]
    expect(platforms.find(item => item.id === custom.id)).toBeUndefined()
  })

  it('resets persisted data to defaults', async () => {
    storeData[STORAGE_KEYS.CONFIG] = { theme: 'dark' }
    storeData[STORAGE_KEYS.AI_PLATFORMS] = []
    storeData[STORAGE_KEYS.TRANSLATION_PLATFORMS] = []

    await resetToDefaults()

    expect(storeData[STORAGE_KEYS.CONFIG]).toEqual(DEFAULT_CONFIG)
    expect(storeData[STORAGE_KEYS.AI_PLATFORMS]).toEqual(builtInAI)
    expect(storeData[STORAGE_KEYS.TRANSLATION_PLATFORMS]).toEqual(builtInTranslation)
  })

  it('returns translation platforms from built-ins when missing', async () => {
    const translations = await getTranslationPlatforms()

    expect(translations).toEqual(builtInTranslation)
    expect(storeData[STORAGE_KEYS.TRANSLATION_PLATFORMS]).toEqual(builtInTranslation)
  })

  it('normalizes desktop notes before returning them', async () => {
    storeData.desktop_notes = [
      {
        id: 'note-1',
        title: 'Daily',
        content: 'Hello',
        color: 'sky',
        visible: true,
        bounds: { leftPercent: 0.01, topPercent: 0.02, rightPercent: 0.11, bottomPercent: 0.13 },
        createdAt: 1,
        updatedAt: 2,
        sync: { dirty: false, deleted: false },
      },
      {
        id: '',
      },
    ]

    const notes = await getDesktopNotes()

    expect(notes).toHaveLength(1)
    expect(notes[0].bounds.leftPercent).toBe(0.01)
    expect(notes[0].bounds.rightPercent).toBe(0.11)
    expect(notes[0].color).toBe('sky')
  })

  it('normalizes invalid desktop note bounds into a valid rectangle', async () => {
    storeData.desktop_notes = [
      {
        id: 'note-invalid-bounds',
        title: 'Bad bounds',
        content: 'Test',
        color: 'sky',
        visible: true,
        bounds: {
          leftPercent: 1.3,
          topPercent: -0.2,
          rightPercent: 0.2,
          bottomPercent: -1,
        },
        createdAt: 1,
        updatedAt: 2,
        deletedAt: null,
        sync: { dirty: false, lastSyncedAt: null },
      },
    ]

    const notes = await getDesktopNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].bounds.leftPercent).toBeGreaterThanOrEqual(0)
    expect(notes[0].bounds.topPercent).toBeGreaterThanOrEqual(0)
    expect(notes[0].bounds.rightPercent).toBeLessThanOrEqual(1)
    expect(notes[0].bounds.bottomPercent).toBeLessThanOrEqual(1)
    expect(notes[0].bounds.rightPercent).toBeGreaterThan(notes[0].bounds.leftPercent)
    expect(notes[0].bounds.bottomPercent).toBeGreaterThan(notes[0].bounds.topPercent)
  })

  it('persists desktop notes through the shared store', async () => {
    await saveDesktopNotes([
      {
        id: 'note-2',
        title: 'Saved',
        content: '- item',
        color: 'mint',
        visible: true,
        bounds: { leftPercent: 0.02, topPercent: 0.04, rightPercent: 0.18, bottomPercent: 0.3 },
        createdAt: 10,
        updatedAt: 11,
        deletedAt: null,
        sync: {
          dirty: true,
          lastSyncedAt: null,
        },
      },
    ])

    expect(storeData.desktop_notes).toEqual([
      expect.objectContaining({
        id: 'note-2',
        color: 'mint',
      }),
    ])
  })
})
