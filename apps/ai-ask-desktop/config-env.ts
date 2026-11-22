import { core } from '@h-ai/core'

export const DESKTOP_PUBLIC_ENV_PREFIXES = ['PUBLIC_', 'VITE_']

/** 在 Node 构建边界读取根目录 dotenv，仅将明确公开的变量传给浏览器。 */
export function desktopEnvironmentDefines(mode: string, envDir: string): Record<string, string> {
  const environment = core.config.loadEnvFiles({ mode, envDir })
  if (!environment.success)
    throw new Error(environment.error.message)

  return Object.fromEntries(
    Object.entries(environment.data)
      .filter(([name]) => DESKTOP_PUBLIC_ENV_PREFIXES.some(prefix => name.startsWith(prefix)))
      .map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)]),
  )
}
