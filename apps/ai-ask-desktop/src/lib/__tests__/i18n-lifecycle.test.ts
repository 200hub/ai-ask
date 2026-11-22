import { describe, expect, it, vi } from 'vitest'

const loaders = vi.hoisted(() => {
  let finishEnglish!: (value: { default: { label: string } }) => void
  const english = new Promise<{ default: { label: string } }>((resolve) => {
    finishEnglish = resolve
  })
  return { english, finishEnglish }
})

vi.mock('../../../messages/en-US.json', async () => loaders.english)
vi.mock('../../../messages/ja-JP.json', () => {
  throw new Error('Locale download failed')
})

describe('locale loading lifecycle', () => {
  it('keeps the most recent choice when an older locale load finishes later', async () => {
    const { i18n } = await import('../i18n')
    const pendingEnglish = i18n.locale.set('en-US')
    const sameLoad = i18n.locale.set('en-US')
    await i18n.locale.set('zh-CN')
    loaders.finishEnglish({ default: { label: 'English loaded' } })
    await Promise.all([pendingEnglish, sameLoad])
    expect(i18n.locale.get()).toBe('zh-CN')
    await i18n.locale.set('en-US')
    expect(i18n.t('label')).toBe('English loaded')
  })

  it('propagates a loading failure and preserves the previous locale', async () => {
    const { i18n } = await import('../i18n')
    await i18n.locale.set('zh-CN')
    await expect(i18n.locale.set('ja-JP')).rejects.toThrow()
    expect(i18n.locale.get()).toBe('zh-CN')
  })
})
