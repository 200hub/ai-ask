/**
 * 平台预加载模块
 *
 * 在应用启动时预加载标记为预加载的 AI 平台和翻译平台，
 * 提升首次使用时的响应速度
 */

import { configStore } from '$lib/stores/config.svelte'
import { platformsStore } from '$lib/stores/platforms.svelte'
import { translationStore } from '$lib/stores/translation.svelte'
import { calculateChildWebviewBounds, ChildWebviewProxy } from '$lib/utils/childWebview'
import { logger } from '$lib/utils/logger'
import { resolveProxyUrl } from '$lib/utils/proxy'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

/** 平台预加载配置 */
interface PreloadConfig {
  webviewId: string
  url: string
  platformId: string
  platformType: 'translation' | 'ai'
}

/**
 * 预加载单个平台的 WebView（共享逻辑）
 */
async function preloadPlatformWebview(config: PreloadConfig): Promise<void> {
  const { webviewId, url, platformId, platformType } = config
  const proxyUrl = resolveProxyUrl(configStore.config.proxy)
  const proxy = new ChildWebviewProxy(webviewId, url, proxyUrl)

  const mainWindow = getCurrentWebviewWindow()
  const bounds = await calculateChildWebviewBounds(mainWindow)

  // 创建但不显示 WebView
  await proxy.ensure(bounds)

  // 等待页面加载完成，确保预加载真正有效
  await proxy.waitForLoadFinished()

  logger.info(`${platformType === 'translation' ? 'Translation' : 'AI'} platform preloaded`, {
    platformId,
    webviewId,
  })
}

/**
 * 预加载默认平台
 *
 * 在后台静默创建默认翻译平台和标记为预加载的 AI 平台的 WebView，
 * 但不显示它们，等用户需要时可以立即使用
 */
export async function preloadDefaultPlatforms(): Promise<void> {
  if (!configStore.config.preloadDefaultPlatforms) {
    logger.info('Platform preloading is disabled')
    return
  }

  // 等待一小段时间，避免影响应用启动速度
  await new Promise(resolve => setTimeout(resolve, 1000))

  logger.info('Starting platform preloading')

  try {
    await Promise.all([preloadTranslationPlatform(), preloadAIPlatforms()])
    logger.info('Platform preloading completed successfully')
  }
  catch (error) {
    logger.warn('Platform preloading failed (non-critical)', error)
  }
}

/**
 * 预加载翻译平台
 */
async function preloadTranslationPlatform(): Promise<void> {
  const currentTranslatorId = configStore.config.currentTranslator
  if (!currentTranslatorId) {
    logger.debug('No default translator configured, skipping preload')
    return
  }

  const translator = translationStore.getPlatformById(currentTranslatorId)
  if (!translator || !translator.enabled) {
    logger.debug('Default translator not available or disabled', { translatorId: currentTranslatorId })
    return
  }

  try {
    await preloadPlatformWebview({
      webviewId: `translator-${translator.id}`,
      url: translator.url,
      platformId: translator.id,
      platformType: 'translation',
    })
  }
  catch (error) {
    logger.warn('Failed to preload translation platform', { translatorId: translator.id, error })
  }
}

/**
 * 预加载所有标记为预加载的 AI 平台
 */
async function preloadAIPlatforms(): Promise<void> {
  // 获取所有标记为预加载且已启用的平台
  const platformsToPreload = platformsStore.platforms.filter(
    platform => platform.enabled && platform.preload,
  )

  if (platformsToPreload.length === 0) {
    logger.debug('No AI platforms marked for preload')
    return
  }

  logger.info('AI platforms to preload', {
    count: platformsToPreload.length,
    platformIds: platformsToPreload.map(p => p.id),
  })

  // 串行预加载，避免同时创建太多 WebView 造成资源压力
  for (const platform of platformsToPreload) {
    try {
      await preloadPlatformWebview({
        webviewId: `ai-chat-${platform.id}`,
        url: platform.url,
        platformId: platform.id,
        platformType: 'ai',
      })
    }
    catch (error) {
      logger.warn('Failed to preload AI platform', { platformId: platform.id, error })
    }
  }
}
