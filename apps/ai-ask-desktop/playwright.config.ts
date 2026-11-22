import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/windows-e2e',
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  workers: 1,
  timeout: 75_000,
  use: { actionTimeout: 12_000 },
  expect: { timeout: 12_000 },
  webServer: process.env.AI_ASK_E2E_EXE
    ? {
        command: 'pnpm dev',
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        url: 'http://localhost:1420',
        reuseExistingServer: true,
      }
    : undefined,
})
