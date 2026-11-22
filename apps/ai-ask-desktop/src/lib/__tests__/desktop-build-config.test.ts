// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { core } from '@h-ai/core'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import desktopConfig from '../../../vite.config'

const PUBLIC_PRODUCTION_URL = 'https://production.example.invalid/api/v1'
const PRIVATE_MARKER = 'private-build-configuration-sentinel'
const TEMPORARY_PREFIX = 'ai-ask-desktop-env-'
let environmentDirectory: string

beforeEach(async () => {
  environmentDirectory = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX))
  vi.stubEnv('PUBLIC_API_BASE', undefined)
  vi.stubEnv('HAI_BUILD_SECRET', undefined)
  await writeFile(join(environmentDirectory, '.env'), 'PUBLIC_API_BASE=https://base.example.invalid/api/v1\n')
  await writeFile(join(environmentDirectory, '.env.dev'), 'PUBLIC_API_BASE=https://development.example.invalid/api/v1\n')
  await writeFile(join(environmentDirectory, '.env.prod'), `PUBLIC_API_BASE=${PUBLIC_PRODUCTION_URL}\nHAI_BUILD_SECRET=${PRIVATE_MARKER}\n`)
  const loadEnvironment = core.config.loadEnvFiles.bind(core.config)
  vi.spyOn(core.config, 'loadEnvFiles').mockImplementation(options => loadEnvironment({ ...options, envDir: environmentDirectory }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (resolve(dirname(environmentDirectory)) !== resolve(tmpdir()) || !basename(environmentDirectory).startsWith(TEMPORARY_PREFIX))
    throw new Error('Refusing to remove an unexpected build test directory')
  await rm(environmentDirectory, { recursive: true, force: true })
})

async function configure(command: 'serve' | 'build', mode: string) {
  if (typeof desktopConfig !== 'function')
    throw new TypeError('Desktop Vite configuration must resolve the requested environment')
  return desktopConfig({ command, mode })
}

describe('desktop public build configuration', () => {
  it('loads root production dotenv during builds and development dotenv during dev', async () => {
    const production = await configure('build', 'production')
    expect(production.define?.['import.meta.env.PUBLIC_API_BASE']).toBe(JSON.stringify(PUBLIC_PRODUCTION_URL))
    const development = await configure('serve', 'development')
    expect(development.define?.['import.meta.env.PUBLIC_API_BASE']).toBe(JSON.stringify('https://development.example.invalid/api/v1'))
    expect(production.envDir).toBe(false)
    expect(production.envPrefix).toEqual(['PUBLIC_', 'VITE_'])
    expect(JSON.stringify(production.define)).not.toContain(PRIVATE_MARKER)
  })

  it('keeps process values above every dotenv override without exposing private settings', async () => {
    await writeFile(join(environmentDirectory, '.env.local'), 'PUBLIC_API_BASE=https://local.example.invalid/api/v1\n')
    await writeFile(join(environmentDirectory, '.env.prod.local'), 'PUBLIC_API_BASE=https://production-local.example.invalid/api/v1\n')
    vi.stubEnv('PUBLIC_API_BASE', 'https://process.example.invalid/api/v1')
    vi.stubEnv('HAI_BUILD_SECRET', PRIVATE_MARKER)

    const configuration = await configure('build', 'production')

    expect(configuration.define?.['import.meta.env.PUBLIC_API_BASE']).toBe(JSON.stringify('https://process.example.invalid/api/v1'))
    expect(JSON.stringify(configuration.define)).not.toContain('HAI_BUILD_SECRET')
    expect(JSON.stringify(configuration.define)).not.toContain(PRIVATE_MARKER)
  })

  it('embeds the production API in built JavaScript while omitting private environment values', async () => {
    await writeFile(join(environmentDirectory, 'index.html'), '<script type="module" src="/entry.js"></script>')
    await writeFile(join(environmentDirectory, 'entry.js'), 'globalThis.buildEnvironment = { api: import.meta.env.PUBLIC_API_BASE, privateValue: import.meta.env.HAI_BUILD_SECRET, environment: import.meta.env };')
    vi.stubEnv('HAI_BUILD_SECRET', PRIVATE_MARKER)
    const configuration = await configure('build', 'production')
    const result = await build({
      configFile: false,
      root: environmentDirectory,
      mode: 'production',
      envDir: configuration.envDir,
      envPrefix: configuration.envPrefix,
      define: configuration.define,
      logLevel: 'silent',
      build: { write: false, minify: false },
    })
    const bundles = Array.isArray(result) ? result : [result]
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
      .filter(item => item.type === 'chunk')
      .map(item => item.code)
      .join('\n')

    expect(code).toContain(PUBLIC_PRODUCTION_URL)
    expect(code).not.toContain(PRIVATE_MARKER)
    expect(code).not.toContain('HAI_BUILD_SECRET')
  })
})
