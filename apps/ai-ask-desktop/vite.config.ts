import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { haiOptimizeExclude, haiPrebundledDeps } from '@h-ai/ui/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { DESKTOP_PUBLIC_ENV_PREFIXES, desktopEnvironmentDefines } from './config-env.ts'

const host = process.env.TAURI_DEV_HOST
const environmentDirectory = fileURLToPath(new URL('../../', import.meta.url))
const devPort = 1420
const hmrPort = 1421

export default defineConfig(({ mode }) => {
  return {
    base: './',
    envDir: false,
    envPrefix: DESKTOP_PUBLIC_ENV_PREFIXES,
    define: desktopEnvironmentDefines(mode, environmentDirectory),
    plugins: [svelte()],
    optimizeDeps: {
      exclude: [...haiOptimizeExclude],
      include: [...haiPrebundledDeps],
    },
    resolve: {
      alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    },
    clearScreen: false,
    preview: { host: '127.0.0.1', port: devPort, strictPort: true },
    server: {
      port: devPort,
      strictPort: true,
      host: host || '127.0.0.1',
      hmr: host ? { protocol: 'ws', host, port: hmrPort } : undefined,
      watch: { ignored: ['**/src-tauri/**'] },
    },
  }
})
