import { SELECTION_TOOLBAR } from '$lib/utils/constants'
import { logger } from '$lib/utils/logger'

import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

async function ensureMainWindowVisible(): Promise<void> {
  try {
    const mainWindow = await WebviewWindow.getByLabel('main')
    if (!mainWindow) {
      logger.warn('Main window not found while handling selection request')
      return
    }

    try {
      if (await mainWindow.isMinimized()) {
        await mainWindow.unminimize()
      }
    }
    catch (error) {
      logger.warn('Failed to update main window minimized state', error)
    }

    await mainWindow.show()
    await mainWindow.setFocus()

    try {
      await mainWindow.emit('restoreWebviews')
    }
    catch (error) {
      logger.warn('Failed to emit restoreWebviews event for main window', error)
    }
  }
  catch (error) {
    logger.error('Failed to focus main window', error)
  }
}

function sanitizeSelection(raw: string): string {
  return raw.trim()
}

export async function requestTranslation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Translation request skipped: text too short')
    return
  }

  await ensureMainWindowVisible()

  try {
    await emitTo('main', 'selection-toolbar:translate', { text })
  }
  catch (error) {
    logger.error('Failed to emit translation request', error)
  }
}

export async function requestExplanation(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (text.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
    logger.debug('Explanation request skipped: text too short')
    return
  }

  await ensureMainWindowVisible()

  try {
    await emitTo('main', 'selection-toolbar:explain', { text })
  }
  catch (error) {
    logger.error('Failed to emit explanation request', error)
  }
}

export async function requestCollect(rawText: string): Promise<void> {
  const text = sanitizeSelection(rawText)
  if (!text) {
    logger.debug('Collect request skipped: empty text')
    return
  }

  await ensureMainWindowVisible()

  try {
    await emitTo('main', 'selection-toolbar:collect', { text })
  }
  catch (error) {
    logger.error('Failed to emit collect request', error)
  }
}
