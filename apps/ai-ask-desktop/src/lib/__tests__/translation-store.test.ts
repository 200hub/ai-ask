import type { TranslationPlatform } from '$lib/types/platform'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const initialTranslations: TranslationPlatform[] = [
  {
    id: 'google',
    name: 'Google',
    icon: 'google.svg',
    url: 'https://translate.google.com',
    enabled: true,
    supportLanguages: ['en', 'zh'],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    icon: 'deepl.svg',
    url: 'https://deepl.com',
    enabled: true,
    supportLanguages: ['en', 'de'],
  },
  {
    id: 'youdao',
    name: 'Youdao',
    icon: 'youdao.svg',
    url: 'https://youdao.com',
    enabled: false,
    supportLanguages: ['zh', 'en'],
  },
]

let translationData: TranslationPlatform[] = []

const storageMocks = {
  getTranslationPlatforms: vi.fn(async () => clone(translationData)),
  saveTranslationPlatforms: vi.fn(async (platforms: TranslationPlatform[]) => {
    translationData = clone(platforms)
  }),
  updateTranslationPlatform: vi.fn(async (id: string, updates: Partial<TranslationPlatform>) => {
    const index = translationData.findIndex(item => item.id === id)
    if (index !== -1) {
      translationData[index] = { ...translationData[index], ...updates }
    }
  }),
}

const config = {
  currentTranslator: 'deepl',
}

const configMock = {
  config,
  setCurrentTranslator: vi.fn(async (id: string) => {
    config.currentTranslator = id
  }),
}

vi.mock('$lib/utils/storage', () => storageMocks)
vi.mock('$lib/stores/config.svelte', () => ({ configStore: configMock }))

let translationStore: (typeof import('$lib/stores/translation.svelte'))['translationStore']

beforeEach(async () => {
  translationData = clone(initialTranslations)
  config.currentTranslator = 'deepl'

  storageMocks.getTranslationPlatforms.mockClear()
  storageMocks.saveTranslationPlatforms.mockClear()
  storageMocks.updateTranslationPlatform.mockClear()
  configMock.setCurrentTranslator.mockClear()

  vi.resetModules();
  ({ translationStore } = await import('$lib/stores/translation.svelte'))
  await translationStore.init()
})

describe('translationStore', () => {
  it('keeps only preferred translator enabled during init', () => {
    expect(translationStore.enabledPlatforms).toHaveLength(1)
    expect(translationStore.currentPlatform?.id).toBe('deepl')
    expect(configMock.setCurrentTranslator).toHaveBeenCalledWith('deepl')
  })

  it('enables a translator and disables others', async () => {
    await translationStore.togglePlatform('google')

    expect(translationStore.currentPlatform?.id).toBe('google')
    expect(configMock.setCurrentTranslator).toHaveBeenCalledWith('google')
    expect(translationStore.enabledPlatforms.map(p => p.id)).toEqual(['google'])
  })

  it('disables active translator and clears current selection when none remain', async () => {
    await translationStore.togglePlatform('deepl')

    expect(translationStore.currentPlatform).toBeNull()
    expect(configMock.setCurrentTranslator).toHaveBeenLastCalledWith('')
  })

  it('ignores setCurrentPlatform for disabled translators', () => {
    translationStore.setCurrentPlatform('youdao')
    expect(translationStore.currentPlatform?.id).not.toBe('youdao')

    translationStore.setCurrentPlatform('deepl')
    expect(translationStore.currentPlatform?.id).toBe('deepl')
  })

  it('updates translator details and persists', async () => {
    await translationStore.updatePlatform('deepl', {
      name: 'DeepL Plus',
      enabled: true,
    })

    expect(storageMocks.updateTranslationPlatform).toHaveBeenCalledWith('deepl', {
      name: 'DeepL Plus',
      enabled: true,
    })
    expect(translationStore.getPlatformById('deepl')?.name).toBe('DeepL Plus')
  })
})
