import type { UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { APP_EXIT } from './constants'
import { logger } from './logger'

/** Every editing window acknowledges its own durable writes before native exit. */
export async function registerExitFlush(options: {
  flush: () => Promise<void>
  setExiting: (exiting: boolean) => void
  onFailure: () => void
}): Promise<UnlistenFn> {
  let activeRequest: number | null = null
  const unlistenFailure = await listen(APP_EXIT.FAILED_EVENT, () => {
    activeRequest = null
    options.setExiting(false)
    options.onFailure()
  })
  try {
    const unlistenExit = await listen<{ requestId: number }>(APP_EXIT.BEFORE_EVENT, async ({ payload }) => {
      if (activeRequest !== null)
        return
      activeRequest = payload.requestId
      options.setExiting(true)
      let error: string | null = null
      try {
        await options.flush()
      }
      catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
        logger.error('Failed to persist window before exit', cause)
      }
      try {
        await invoke(APP_EXIT.COMPLETE_COMMAND, { requestId: payload.requestId, error })
      }
      catch (cause) {
        logger.error('Failed to acknowledge exit persistence', cause)
        activeRequest = null
        options.setExiting(false)
        options.onFailure()
      }
    })
    return () => {
      unlistenExit()
      unlistenFailure()
    }
  }
  catch (error) {
    unlistenFailure()
    throw error
  }
}
