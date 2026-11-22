import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('workspace release scripts propagate versions and reject mismatches independently of cwd', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ask-version-'))
  t.after(async () => {
    const target = resolve(directory)
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('ai-ask-version-'))
      throw new Error('Refusing to remove an unexpected version-test directory')
    await rm(target, { recursive: true, force: true })
  })
  const scripts = join(directory, '.github/scripts')
  const desktop = join(directory, 'apps/ai-ask-desktop')
  const version = '2.4.0-beta.3'
  const files = {
    'package.json': JSON.stringify({ type: 'module', version }),
    '.env': 'HAI_CORE_VERSION=1.0.0\n',
    '.env.example': 'HAI_CORE_VERSION=1.0.0\n',
    'packages/ai-ask-serv/package.json': JSON.stringify({ name: 'ai-ask-serv', version: '1.0.0' }),
    'packages/ai-ask-contract/package.json': JSON.stringify({ name: 'ai-ask-contract', version: '1.0.0' }),
    'packages/ai-ask-serv/config/_core.yml': 'version: $' + '{HAI_CORE_VERSION:1.0.0}\n',
    'apps/ai-ask-desktop/package.json': JSON.stringify({ name: 'ai-ask-desktop', version: '1.0.0' }),
    'apps/ai-ask-desktop/src-tauri/tauri.conf.json': JSON.stringify({ version: '../../../package.json' }),
    'apps/ai-ask-desktop/src-tauri/Cargo.toml': '[package]\nname = "ai-ask"\nversion = "1.0.0"\n',
    'apps/ai-ask-desktop/src-tauri/Cargo.lock': '[[package]]\nname = "ai-ask"\nversion = "1.0.0"\n',
    'apps/ai-ask-desktop/src/lib/utils/constants.ts': 'export const APP_INFO = { version: \'1.0.0\' }\n',
  }
  await mkdir(scripts, { recursive: true })
  await mkdir(join(desktop, 'src-tauri'), { recursive: true })
  await mkdir(join(desktop, 'src/lib/utils'), { recursive: true })
  for (const name of ['workspace-version.js', 'sync-version.js', 'validate-version.js'])
    await cp(fileURLToPath(new URL(name, import.meta.url)), join(scripts, name))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true })
    await writeFile(join(directory, name), content)
  }
  const run = (name, args = [], env = {}) => spawnSync(process.execPath, [join(scripts, name), ...args], {
    cwd: desktop,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  assert.equal(run('validate-version.js', ['--source-only']).status, 1)
  const synchronized = run('sync-version.js')
  assert.equal(synchronized.status, 0, synchronized.stderr)
  assert.equal(JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')).version, version)
  assert.equal(JSON.parse(await readFile(join(desktop, 'src-tauri/tauri.conf.json'), 'utf8')).version, '../../../package.json')
  assert.equal(run('validate-version.js', ['--source-only']).status, 0)
  assert.equal(run('validate-version.js', [], { GITHUB_REF_NAME: `v${version}` }).status, 0)
  assert.equal(run('validate-version.js', [], { GITHUB_REF_NAME: 'v1.0.0' }).status, 1)
  assert.equal(await readFile(join(directory, '.env.example'), 'utf8'), `HAI_CORE_VERSION=${version}\n`)
  await writeFile(join(directory, '.env.example'), 'HAI_CORE_VERSION=1.0.0\n')
  assert.equal(run('validate-version.js', ['--source-only']).status, 1)
  assert.equal(run('sync-version.js').status, 0)
  assert.equal(run('validate-version.js', ['--source-only']).status, 0)
  await writeFile(join(desktop, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }))
  assert.equal(run('validate-version.js', ['--source-only']).status, 1)
})
/* eslint test/no-import-node-test: off -- These CI tests run with node --test outside the Vitest workspace. */
