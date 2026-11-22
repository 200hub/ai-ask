import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { compareVersions, configure, merge, planChannelUpdate, sign, validateReleaseConfiguration } from './desktop-updates.mjs'

const version = '2.4.0-beta.3+build.7'
const assetBaseUrl = `https://github.com/example/ai-ask/releases/download/v${version}/`
const targets = [['windows', 'x64'], ['windows', 'arm64'], ['linux', 'x64'], ['macos', 'x64'], ['macos', 'arm64']]
const require = createRequire(new URL('../../apps/ai-ask-desktop/package.json', import.meta.url))
const cli = require.resolve('@tauri-apps/cli/tauri.js')
const previous = new Map(['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'].map(key => [key, process.env[key]]))
let directory
let key
let wrongKey
let signedDirectories
let channelFixture

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-ask-updater-ci-'))
  for (const name of ['release', 'another']) {
    execFileSync(process.execPath, [cli, 'signer', 'generate', '--ci', '--password', 'fixture-only-password', '--write-keys', join(directory, name)], { stdio: 'ignore', windowsHide: true })
  }
  key = (await readFile(join(directory, 'release.pub'), 'utf8')).trim()
  wrongKey = (await readFile(join(directory, 'another.pub'), 'utf8')).trim()
  process.env.TAURI_SIGNING_PRIVATE_KEY = await readFile(join(directory, 'release'), 'utf8')
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 'fixture-only-password'
})

after(async () => {
  for (const [key, value] of previous) {
    if (value === undefined)
      delete process.env[key]
    else
      process.env[key] = value
  }
  if (directory) {
    const target = resolve(directory)
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('ai-ask-updater-ci-'))
      throw new Error('Refusing to remove an unexpected updater-test directory')
    await rm(target, { recursive: true, force: true })
  }
})

async function fixture(platform, arch) {
  const bundleDirectory = join(directory, `bundle-${platform}-${arch}`)
  const source = join(bundleDirectory, platform === 'windows' ? 'nsis/AIAsk-setup.exe' : platform === 'linux' ? 'appimage/AIAsk.AppImage' : 'macos/AIAsk.app/Contents/MacOS/AIAsk')
  await mkdir(dirname(source), { recursive: true })
  await writeFile(source, `Fixture bundle bytes for ${platform}/${arch}`, { mode: 0o755 })
  return { platform, arch, version, bundleDirectory, outputDirectory: join(directory, `signed-${platform}-${arch}`), assetBaseUrl, key }
}

async function channelScenario() {
  if (channelFixture)
    return channelFixture
  const gitDirectory = join(directory, 'channel-history')
  await mkdir(gitDirectory)
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Updater fixture', '-c', 'user.email=updater@example.test', ...args], { cwd: gitDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('commit', '--quiet', '--allow-empty', '-m', 'Root fixture')
  const root = git('rev-parse', 'HEAD')
  const versions = ['2.4.0-beta.9', '2.4.0-beta.13', '2.4.0-beta.14']
  const sources = []
  const feeds = []
  const releases = []
  for (const [index, selectedVersion] of versions.entries()) {
    if (index === 2)
      git('checkout', '--quiet', '--detach', root)
    git('commit', '--quiet', '--allow-empty', '-m', `Version ${selectedVersion}`)
    sources.push(git('rev-parse', 'HEAD'))
    git('tag', `v${selectedVersion}`)
    const directories = []
    for (const [platform, arch] of targets) {
      const options = await fixture(platform, arch)
      const outputDirectory = join(directory, `channel-${selectedVersion}-${platform}-${arch}`)
      await sign({ ...options, version: selectedVersion, assetBaseUrl: `https://github.com/example/ai-ask/releases/download/v${selectedVersion}/`, outputDirectory })
      directories.push(outputDirectory)
    }
    const feedFile = join(directory, `channel-${selectedVersion}.json`)
    await merge(directories, selectedVersion, feedFile, key)
    const feed = JSON.parse(await readFile(feedFile, 'utf8'))
    feeds.push(feed)
    const assets = Object.values(feed.platforms).flatMap(artifact => [artifact.url, `${artifact.url}.sig`])
    assets.push(`https://github.com/example/ai-ask/releases/download/v${selectedVersion}/latest.json`)
    releases.push({ tag_name: `v${selectedVersion}`, draft: false, assets: assets.map(url => ({ name: decodeURIComponent(basename(new URL(url).pathname)), size: 1, state: 'uploaded', browser_download_url: url })) })
  }
  git('checkout', '--quiet', 'main')
  channelFixture = { gitDirectory, git, sources, feeds, releases }
  return channelFixture
}

test('keeps manual builds unchanged without public update configuration and rejects partial configuration', async () => {
  const file = join(directory, 'manual-platform.json')
  const original = JSON.stringify({ app: { windows: null }, plugins: { existing: { enabled: true } } })
  await writeFile(file, original)
  assert.equal(await configure(file, '', ''), false)
  assert.equal(await readFile(file, 'utf8'), original)
  await assert.rejects(configure(file, '', key), /configured together/)
  await assert.rejects(configure(file, 'https://updates.example/latest.json', ''), /configured together/)
  assert.equal(await readFile(file, 'utf8'), original)
})

test('configures a signed-version updater without changing platform window or other plugin settings', async () => {
  const file = join(directory, 'signed-platform.json')
  await writeFile(file, JSON.stringify({ app: { windows: null }, bundle: { active: true }, plugins: { existing: { enabled: true } } }))
  assert.equal(await configure(file, 'https://updates.example/ai-ask/latest.json', key), true)
  const config = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(config.app.windows, null)
  assert.equal(config.plugins.existing.enabled, true)
  assert.equal(config.bundle.active, true)
  assert.equal(config.bundle.createUpdaterArtifacts, false)
  assert.deepEqual(config.plugins.updater, { endpoints: ['https://updates.example/ai-ask/latest.json'], pubkey: key, requireSignedVersion: true, allowDowngrades: false })
})

test('rejects insecure feeds and malformed public keys before writing configuration', async () => {
  const file = join(directory, 'invalid-platform.json')
  for (const endpoint of ['http://updates.example/latest.json', 'https://user:pass@updates.example/latest.json', 'https://updates.example/latest.json?token=x', 'https://updates.example/latest.json#part', 'https://updates.example/feed.json'])
    await assert.rejects(configure(file, endpoint, key))
  const extraLine = Buffer.from(`${Buffer.from(key, 'base64').toString('utf8')}\nextra`).toString('base64')
  for (const value of ['placeholder-key', Buffer.from('not a public key').toString('base64'), extraLine])
    await assert.rejects(configure(file, 'https://updates.example/latest.json', value))
  await assert.rejects(readFile(file), { code: 'ENOENT' })
})

test('checks release variables against the reviewed source trust root before the CLI writes an overlay', async () => {
  const sourceDirectory = join(directory, 'reviewed-configuration')
  await mkdir(sourceDirectory)
  const file = join(sourceDirectory, 'tauri.conf.json')
  const overlay = join(sourceDirectory, 'tauri.windows.conf.json')
  const endpoint = 'https://github.com/example/ai-ask/releases/download/desktop-updates/latest.json'
  const updater = { pubkey: key, endpoints: [endpoint], requireSignedVersion: true, allowDowngrades: false }
  await writeFile(file, JSON.stringify({ plugins: { updater } }))
  await validateReleaseConfiguration(file, endpoint, key)
  await assert.rejects(validateReleaseConfiguration(file, endpoint, wrongKey), /reviewed source/)
  await assert.rejects(validateReleaseConfiguration(file, 'https://wrong.example/latest.json', key), /reviewed source/)
  await writeFile(file, JSON.stringify({ plugins: { updater: { ...updater, requireSignedVersion: false } } }))
  await assert.rejects(validateReleaseConfiguration(file, endpoint, key), /strict signature policy/)
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('desktop-updates.mjs', import.meta.url)), 'configure', overlay, endpoint], { env: { ...process.env, TAURI_UPDATE_PUBLIC_KEY: key }, stdio: 'ignore', windowsHide: true }))
  await assert.rejects(readFile(overlay), { code: 'ENOENT' })
  await writeFile(file, JSON.stringify({ plugins: { updater } }))
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('desktop-updates.mjs', import.meta.url)), 'configure', overlay, ''], { env: { ...process.env, TAURI_UPDATE_PUBLIC_KEY: '' }, stdio: 'ignore', windowsHide: true }))
  await assert.rejects(readFile(overlay), { code: 'ENOENT' })
})

test('orders prerelease versions by SemVer rather than lexical text or build metadata', () => {
  assert.equal(compareVersions('0.0.1-beta.13', '0.0.1-beta.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.13'), -1)
  assert.equal(compareVersions('1.0.0-beta.13+one', '1.0.0-beta.13+two'), 0)
  assert.throws(() => compareVersions('1.0.0-beta.01', '1.0.0'), /SemVer/)
})

test('advances a complete signed prerelease, skips late and repeated builds, and never changes application tags', async () => {
  const scenario = await channelScenario()
  const options = { candidate: scenario.feeds[1], current: scenario.feeds[0], releases: scenario.releases.slice(0, 2), sourceSha: scenario.sources[1], repository: 'example/ai-ask', key, gitDirectory: scenario.gitDirectory }
  const tags = scenario.git('show-ref', '--tags')
  assert.equal(planChannelUpdate(options).promote, true)
  assert.equal(planChannelUpdate({ ...options, current: null }).promote, true)
  assert.equal(planChannelUpdate({ ...options, current: scenario.feeds[1] }).promote, false)
  const late = { ...options, candidate: scenario.feeds[0], sourceSha: scenario.sources[0] }
  assert.equal(planChannelUpdate({ ...late, current: scenario.feeds[1] }).promote, false)
  // 即使前次上传失败导致通道清单暂缺，新版已公开的事实仍阻止旧版回填。
  assert.equal(planChannelUpdate({ ...late, current: null }).promote, false)
  assert.equal(scenario.git('show-ref', '--tags'), tags)
})

test('rejects a wrong source SHA, divergent newer source, or incomplete public application release', async () => {
  const scenario = await channelScenario()
  const options = { candidate: scenario.feeds[1], current: scenario.feeds[0], releases: scenario.releases.slice(0, 2), sourceSha: scenario.sources[1], repository: 'example/ai-ask', key, gitDirectory: scenario.gitDirectory }
  assert.throws(() => planChannelUpdate({ ...options, sourceSha: scenario.sources[0] }), /does not match the built source SHA/)
  assert.throws(() => planChannelUpdate({ ...options, candidate: scenario.feeds[2], current: scenario.feeds[1], sourceSha: scenario.sources[2], releases: scenario.releases }), /must descend/)
  const incomplete = structuredClone(options.releases)
  incomplete[1].assets.pop()
  assert.throws(() => planChannelUpdate({ ...options, releases: incomplete }), /must be public/)
  const draft = structuredClone(options.releases)
  draft[1].draft = true
  assert.throws(() => planChannelUpdate({ ...options, releases: draft }), /must be public/)
})

test('signs fixture bytes with the official CLI, packs each Mac app, and merges five unique versioned assets', async () => {
  signedDirectories = []
  for (const [platform, arch] of targets) {
    const options = await fixture(platform, arch)
    await sign(options)
    signedDirectories.push(options.outputDirectory)
    const manifest = JSON.parse(await readFile(join(options.outputDirectory, 'latest.json'), 'utf8'))
    const [artifact] = Object.values(manifest.platforms)
    const name = decodeURIComponent(basename(new URL(artifact.url).pathname))
    assert.ok(name.includes(`-${platform}-${arch}-${version}`))
    assert.equal((await readFile(join(options.outputDirectory, `${name}.sig`), 'utf8')).trim(), artifact.signature)
    if (platform === 'macos') {
      const listing = execFileSync('tar', ['-tzf', join(options.outputDirectory, name)], { encoding: 'utf8', windowsHide: true })
      assert.match(listing, /AIAsk\.app\/Contents\/MacOS\/AIAsk/)
    }
  }
  const output = join(directory, 'latest.json')
  await merge(signedDirectories, version, output, key)
  const manifest = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(manifest.version, version)
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64'])
  assert.equal(new Set(Object.values(manifest.platforms).map(artifact => artifact.url)).size, 5)
  assert.equal((await readdir(directory)).some(name => name.endsWith('.sig')), false)
})

test('fails without signing credentials, on an unsupported target, or with a mismatched key without emitting a feed', async () => {
  const options = await fixture('linux', 'reject')
  const secret = process.env.TAURI_SIGNING_PRIVATE_KEY
  delete process.env.TAURI_SIGNING_PRIVATE_KEY
  try {
    await assert.rejects(sign({ ...options, arch: 'x64' }), /PRIVATE_KEY is required/)
  }
  finally {
    process.env.TAURI_SIGNING_PRIVATE_KEY = secret
  }
  await assert.rejects(sign({ ...options, arch: 'arm64' }), /Unsupported/)
  await assert.rejects(sign({ ...options, arch: 'x64', key: wrongKey }), /does not match/)
  await assert.rejects(readFile(join(options.outputDirectory, 'latest.json')), { code: 'ENOENT' })
})

test('refuses incomplete, duplicate, mismatched-version, or differently signed release manifests', async () => {
  const output = join(directory, 'rejected-latest.json')
  await assert.rejects(merge(signedDirectories.slice(0, 4), version, output, key), /All five/)
  await assert.rejects(merge([...signedDirectories, signedDirectories[0]], version, output, key), /duplicate/)
  await assert.rejects(merge(signedDirectories, '2.4.1', output, key), /release version/)
  await assert.rejects(merge(signedDirectories, version, output, wrongKey), /does not match/)
  await assert.rejects(readFile(output), { code: 'ENOENT' })
})

test('rejects artifact and trusted-comment tampering, and refuses asset path traversal', async () => {
  const source = signedDirectories[0]
  const manifestFile = join(source, 'latest.json')
  const original = await readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(original)
  const artifact = Object.values(manifest.platforms)[0]
  const file = join(source, decodeURIComponent(basename(new URL(artifact.url).pathname)))
  const bytes = await readFile(file)
  const signature = artifact.signature
  try {
    await writeFile(file, 'Tampered installer bytes')
    await assert.rejects(merge(signedDirectories, version, join(directory, 'tampered-latest.json'), key), /artifact signature is invalid/)
    await writeFile(file, bytes)
    const decoded = Buffer.from(signature, 'base64').toString('utf8').replace('timestamp:', 'tampered:')
    artifact.signature = Buffer.from(decoded).toString('base64')
    await writeFile(`${file}.sig`, artifact.signature)
    await writeFile(manifestFile, JSON.stringify(manifest))
    await assert.rejects(merge(signedDirectories, version, join(directory, 'tampered-comment.json'), key), /trusted comment is invalid/)
    artifact.signature = signature
    artifact.url = 'https://updates.example/%2e%2e%2foutside.exe'
    await writeFile(manifestFile, JSON.stringify(manifest))
    await assert.rejects(merge(signedDirectories, version, join(directory, 'traversal-latest.json'), key), /artifact names/)
  }
  finally {
    await writeFile(file, bytes)
    await writeFile(`${file}.sig`, signature)
    await writeFile(manifestFile, original)
  }
})

test('keeps PR builds secret-free, signs only release steps, and uploads installer and updater artifacts separately', async () => {
  const load = async (name) => {
    const document = parseDocument(await readFile(fileURLToPath(new URL(`../workflows/${name}.yml`, import.meta.url)), 'utf8'))
    assert.deepEqual(document.errors, [])
    return document.toJS()
  }
  const pull = await load('pull-request')
  const build = await load('build-desktop')
  const release = await load('release')
  assert.equal(pull.permissions.contents, 'read')
  assert.equal(pull.on.pull_request_target, undefined)
  assert.equal(JSON.stringify(pull).includes('secrets.'), false)
  assert.ok(pull.jobs['windows-checks'].steps.some(step => step.run === 'pnpm test:ci'))
  assert.equal(build.on.workflow_call.inputs.signed_updates.default, false)
  assert.equal(build.jobs.build.strategy.matrix.include.length, 5)
  const steps = build.jobs.build.steps
  const credentialSteps = steps.filter(step => JSON.stringify(step).includes('secrets.TAURI_SIGNING_PRIVATE_KEY'))
  assert.equal(credentialSteps.length, 1)
  assert.equal(credentialSteps[0].name, 'Sign updater artifacts')
  assert.match(credentialSteps[0].if, /signed_updates.*pull_request.*enabled/)
  const configured = steps.find(step => step.id === 'updater')
  assert.match(configured.if, /signed_updates.*pull_request/)
  const normal = steps.find(step => step.name === 'Upload build artifacts')
  const signed = steps.find(step => step.name === 'Upload signed updater artifacts')
  assert.equal(normal.with.path.includes('updater-'), false)
  assert.ok(signed.with.name.startsWith('updater-'))
  assert.equal(release.jobs.desktop.with.signed_updates, true)
  assert.equal(Object.keys(release.jobs.desktop.secrets).length, 2)
  const publish = release.jobs.publish.steps.find(step => step.name === 'Check installers and publish').run
  assert.ok(publish.indexOf('gh release upload "$TAG"') < publish.indexOf('gh release upload "$TAG" artifacts/latest.json'))
  assert.match(publish, /artifacts\/windows-x64-\$version/)
  assert.match(publish, /artifacts\/macos-intel-\$version/)
  const channel = release.jobs['update-channel']
  assert.deepEqual(channel.needs, ['prepare', 'publish'])
  assert.equal(channel.concurrency.group, 'desktop-updates-channel')
  assert.equal(channel.concurrency['cancel-in-progress'], false)
  assert.equal(channel.concurrency.queue, 'max')
  assert.match(channel.if, /always\(\).*needs\.publish\.result.*pending == 'false'/)
  const channelScript = channel.steps.find(step => step.name === 'Publish the fixed prerelease update feed last').run
  assert.match(channelScript, /gh release create desktop-updates .*--prerelease --latest=false/)
  assert.match(channelScript, /gh release upload desktop-updates channel\/candidate\/latest\.json --clobber/)
  assert.equal(channelScript.includes('git push'), false)
  assert.ok(channelScript.indexOf('channel-plan') < channelScript.indexOf('gh release upload desktop-updates'))
  const prepare = release.jobs.prepare.steps.find(step => step.id === 'version').run
  assert.match(prepare, /pending=false/)
  assert.match(prepare, /echo "sha=\$sha"/)
  await load('build-mobile')
})
/* eslint test/no-import-node-test: off -- These CI tests run with node --test outside the Vitest workspace. */
