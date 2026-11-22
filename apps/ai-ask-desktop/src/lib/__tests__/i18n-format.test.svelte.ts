import type { InterpolationParams } from '@h-ai/core'
import { i18n } from '$lib/i18n'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

beforeEach(async () => {
  i18n.loadTranslations('zh-CN', {
    formattingTest: {
      repeated: '{name} / {name} / {count} / {enabled} / {missing}',
      fallback: '默认 {value}',
      inherited: '{own} / {inherited}',
    },
  })
  await i18n.locale.set('zh-CN')
})

afterEach(async () => {
  await i18n.locale.set('zh-CN')
})

describe('shared translation formatting', () => {
  it('replaces every occurrence, preserves literal replacement text and keeps missing placeholders', () => {
    expect(i18n.format('formattingTest.repeated', { name: '$&{count}', count: 0, enabled: false }))
      .toBe('$&{count} / $&{count} / 0 / false / {missing}')
    expect(i18n.format('formattingTest.repeated')).toBe(i18n.t('formattingTest.repeated'))
  })

  it('only reads own parameter keys', () => {
    const params: InterpolationParams = Object.assign(Object.create({ inherited: 'hidden' }), { own: 'visible' })
    expect(i18n.format('formattingTest.inherited', params)).toBe('visible / {inherited}')
  })

  it('retains locale fallback and the existing t fallback signature', async () => {
    await i18n.locale.set('ko-KR')
    expect(i18n.format('formattingTest.fallback', { value: 'value' })).toBe('默认 value')
    expect(i18n.t('formattingTest.missing', 'custom fallback')).toBe('custom fallback')
  })

  it('keeps formatted labels reactive across all four languages and changed parameters', async () => {
    let email = $state('first@example.test')
    const label = $derived(i18n.format('desktopNotes.auth.signedInAs', { email }))
    const currentLabel = () => label
    const currentEmail = () => email
    for (const locale of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'] as const) {
      await i18n.locale.set(locale)
      expect(currentLabel()).toBe(i18n.t('desktopNotes.auth.signedInAs').replace('{email}', currentEmail()))
      expect(currentLabel()).toContain(currentEmail())
    }
    email = 'second@example.test'
    expect(currentLabel()).toContain('second@example.test')
    expect(currentLabel()).not.toContain('first@example.test')
  })
})
