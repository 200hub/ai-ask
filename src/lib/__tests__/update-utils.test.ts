import type { ReleaseAsset } from '$lib/types/update'

import { selectAssetForUserAgent } from '$lib/utils/update'
import { describe, expect, it } from 'vitest'

const sampleAssets: ReleaseAsset[] = [
  {
    id: '1',
    name: 'AIAsk-win-x64.exe',
    platform: 'windows',
    arch: 'x64',
    downloadUrl: 'https://example.com/win-x64',
  },
  {
    id: '2',
    name: 'AIAsk-win-arm64.exe',
    platform: 'windows',
    arch: 'arm64',
    downloadUrl: 'https://example.com/win-arm64',
  },
  {
    id: '3',
    name: 'AIAsk-mac-universal.dmg',
    platform: 'macos',
    arch: 'universal',
    downloadUrl: 'https://example.com/mac',
  },
  {
    id: '4',
    name: 'AIAsk-linux.AppImage',
    platform: 'linux',
    arch: null,
    downloadUrl: 'https://example.com/linux',
  },
]

describe('selectAssetForUserAgent', () => {
  it('picks windows x64 asset for desktop windows user agent', () => {
    const asset = selectAssetForUserAgent(
      sampleAssets,
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    )
    expect(asset?.id).toBe('1')
  })

  it('prefers arm64 asset when user agent indicates arm64', () => {
    const asset = selectAssetForUserAgent(
      sampleAssets,
      'Mozilla/5.0 (Windows NT 10.0; ARM64; rv:109.0)',
    )
    expect(asset?.id).toBe('2')
  })

  it('returns universal mac asset for mac user agent', () => {
    const asset = selectAssetForUserAgent(
      sampleAssets,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15',
    )
    expect(asset?.id).toBe('3')
  })

  it('falls back to first asset when nothing matches', () => {
    const asset = selectAssetForUserAgent(sampleAssets, 'UnknownOS')
    expect(asset?.id).toBe('1')
  })
})
