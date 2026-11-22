import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const readPackage = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const rootPackage = readPackage('package.json')
const desktop = readPackage('apps/ai-ask-desktop/package.json')
const service = readPackage('packages/ai-ask-serv/package.json')
const contract = readPackage('packages/ai-ask-contract/package.json')
const frameworkVersion = rootPackage.devDependencies['@h-ai/core']
assert.match(frameworkVersion, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'Pin an exact Hai release')
const skills = readPackage('.agents/hai-framework.json')
assert.equal(skills.version, frameworkVersion, 'Skill templates must match the runtime release')
for (const name of skills.skills) {
  const checkResources = (relative) => {
    const source = relative.replace('.agents/skills/', 'node_modules/@h-ai/cli/templates/skills/')
    for (const entry of readdirSync(new URL(source, root), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`
      assert.equal(existsSync(new URL(file, root)), true, `Missing skill resource: ${file}`)
      if (entry.isDirectory()) {
        checkResources(file)
      }
    }
  }
  assert.equal(existsSync(new URL(`.agents/skills/${name}/SKILL.md`, root)), true, `Missing skill: ${name}`)
  checkResources(`.agents/skills/${name}`)
}

assert.equal(rootPackage.private, true, 'Workspace root must be private')
assert.equal(desktop.name, 'ai-ask-desktop')
assert.equal(service.name, 'ai-ask-serv')
assert.equal(contract.name, 'ai-ask-contract')
for (const legacy of ['src', 'src-tauri', 'sync-server', 'supabase', 'static', '.specify', '.svelte-kit'])
  assert.equal(existsSync(new URL(legacy, root)), false, `Legacy root directory remains: ${legacy}`)
for (const forbidden of ['@sveltejs/kit', '@sveltejs/adapter-static', 'ai-ask-serv', '@ai-ask/sync-server', 'marked', '@tauri-apps/plugin-shell'])
  assert.equal(Object.hasOwn({ ...desktop.dependencies, ...desktop.devDependencies }, forbidden), false, `Invalid desktop dependency: ${forbidden}`)
assert.equal(desktop.dependencies['ai-ask-contract'], 'workspace:*')
assert.equal(existsSync(new URL('apps/ai-ask-desktop/src/types/marked.d.ts', root)), false, 'Do not replace dependency types with handwritten declarations')
for (const legacy of ['src/lib/utils/update.ts', 'src/lib/utils/update-manager.svelte.ts', 'src/lib/types/update.ts'])
  assert.equal(existsSync(new URL(`apps/ai-ask-desktop/${legacy}`, root)), false, `Legacy updater remains: ${legacy}`)
assert.equal(service.dependencies['ai-ask-contract'], 'workspace:*')
assert.equal(contract.exports['.'].import, './dist/index.js')
assert.equal(contract.exports['.'].types, './dist/index.d.ts')
for (const key of ['@h-ai/serv', '@h-ai/iam', '@h-ai/reldb'])
  assert.equal(Object.hasOwn(contract.dependencies, key), false, `Server dependency leaked into contract: ${key}`)
for (const file of ['index.html', 'src/main.ts', 'src/App.svelte', 'public/favicon.png'])
  assert.equal(existsSync(new URL(`apps/ai-ask-desktop/${file}`, root)), true, `Missing desktop entry: ${file}`)
for (const locale of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'])
  assert.equal(existsSync(new URL(`apps/ai-ask-desktop/messages/${locale}.json`, root)), true, `Missing locale: ${locale}`)
for (const file of ['_core.yml', '_serv.yml', '_db.yml', '_cache.yml', '_iam.yml', '_reach.yml'])
  assert.equal(existsSync(new URL(`packages/ai-ask-serv/config/${file}`, root)), true, `Missing Hai config: ${file}`)
for (const pkg of [rootPackage, desktop, service, contract]) {
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (name.startsWith('@h-ai/'))
      assert.equal(version, frameworkVersion, `Hai version mismatch: ${pkg.name}/${name}`)
  }
}
console.info(`Hai workspace structure verified: ${fileURLToPath(root)}`)
