import { core } from '@h-ai/core'

core.logger.configure({ level: import.meta.env.DEV ? 'debug' : 'warn' })

// 兼容组件的多参数调用；完整 Error 交给 Hai 处理 cause 链和敏感字段。
function context(data: unknown[]): Record<string, unknown> | undefined {
  if (data.length === 0)
    return undefined
  if (data.length === 1 && data[0] && typeof data[0] === 'object' && !(data[0] instanceof Error))
    return data[0] as Record<string, unknown>
  return data.length === 1 && data[0] instanceof Error ? { error: data[0] } : { details: data }
}

export const logger = {
  debug: (message: string, ...data: unknown[]) => core.logger.debug(message, context(data)),
  info: (message: string, ...data: unknown[]) => core.logger.info(message, context(data)),
  warn: (message: string, ...data: unknown[]) => core.logger.warn(message, context(data)),
  error: (message: string, ...data: unknown[]) => core.logger.error(message, context(data)),
}
