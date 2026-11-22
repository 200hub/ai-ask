import type { InjectionResult } from '$lib/types/injection'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

/** 原生事件来自外部网页；验证实际数据后才能交给 UI，不能只断言 TypeScript 类型。 */
export function isInjectionResult(value: unknown): value is InjectionResult {
  if (!isRecord(value) || typeof value.success !== 'boolean'
    || !isOptionalText(value.error) || !isOptionalCount(value.duration)
    || !isOptionalCount(value.actionsExecuted)) {
    return false
  }
  if (value.results === undefined)
    return true
  return Array.isArray(value.results) && value.results.every((action: unknown) => {
    if (!isRecord(action) || typeof action.index !== 'number' || !Number.isSafeInteger(action.index) || action.index < 0
      || typeof action.type !== 'string' || !['fill', 'click', 'extract'].includes(action.type) || !isRecord(action.result)) {
      return false
    }
    const result = action.result
    return typeof result.success === 'boolean'
      && isOptionalText(result.content) && isOptionalText(result.html)
      && (result.format === undefined || result.format === 'text' || result.format === 'markdown')
  })
}

/** 仅接收当前调试 WebView 的结果，忽略其他平台、已关闭窗口及畸形事件。 */
export function parseInjectionResultEvent(payload: unknown, webviewId: string | null): InjectionResult | null {
  if (!webviewId || !isRecord(payload) || payload.id !== webviewId)
    return null
  if (payload.success === false && typeof payload.error === 'string')
    return { success: false, error: payload.error }
  if (payload.success === true && isInjectionResult(payload.result))
    return payload.result
  return null
}

/** 监听注册可能晚于组件卸载完成；迟到的句柄必须立即释放，回调也不能再更新 UI。 */
export function subscribeInjectionResults(
  subscribe: (receive: (payload: unknown) => void) => Promise<() => void>,
  currentWebviewId: () => string | null,
  receive: (result: InjectionResult) => void,
) {
  let disposed = false
  let unlisten: (() => void) | undefined
  const ready = subscribe((payload) => {
    if (disposed)
      return
    const result = parseInjectionResultEvent(payload, currentWebviewId())
    if (result)
      receive(result)
  }).then((stop) => {
    if (disposed)
      stop()
    else
      unlisten = stop
  })
  return {
    ready,
    dispose() {
      disposed = true
      const stop = unlisten
      unlisten = undefined
      stop?.()
    },
  }
}
