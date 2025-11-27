/**
 * 平台预加载模块
 *
 * 在应用启动时预加载默认的翻译平台和 AI 平台，
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
 * 在后台静默创建默认翻译平台和 AI 平台的 WebView，
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
    await Promise.all([preloadTranslationPlatform(), preloadAIPlatform()])
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
 * 预加载 AI 平台
 */
async function preloadAIPlatform(): Promise<void> {
  // 按优先级获取要预加载的平台
  const candidateIds = [
    configStore.config.selectionToolbarDefaultPlatformId,
    configStore.config.lastUsedPlatform,
    configStore.config.defaultPlatform,
  ].filter((id): id is string => Boolean(id))

  // 尝试找到第一个可用的平台
  let platform = null
  for (const id of candidateIds) {
    const p = platformsStore.getPlatformById(id)
    if (p && p.enabled) {
      platform = p
      break
    }
  }

  // 如果没有配置的平台，使用第一个启用的平台
  if (!platform) {
    platform = platformsStore.enabledPlatforms[0]
  }

  if (!platform) {
    logger.debug('No AI platform available for preload')
    return
  }

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
