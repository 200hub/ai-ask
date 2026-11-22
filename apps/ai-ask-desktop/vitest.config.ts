import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    // 组件与 Runes 测试使用和桌面 Webview 相同的浏览器入口。
    conditions: ['browser'],
  },
  test: {
    include: ['src/lib/__tests__/**/*.test.{ts,svelte.ts}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: 'src/lib/__tests__/setup.ts',
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.{ts,svelte}'],
    },
  },
})
