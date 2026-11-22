/** 桌面发布策略：公开配置、官方 CLI 签名、版本清单及预发布更新通道分步执行。 */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const TARGETS = {
  'windows-x86_64': ['windows', 'x64', '-setup.exe'],
  'windows-aarch64': ['windows', 'arm64', '-setup.exe'],
  'linux-x86_64': ['linux', 'x64', '.AppImage'],
  'darwin-x86_64': ['macos', 'x64', '.app.tar.gz'],
  'darwin-aarch64': ['macos', 'arm64', '.app.tar.gz'],
}
const require = createRequire(new URL('../../apps/ai-ask-desktop/package.json', import.meta.url))

function secureUrl(input) {
  const url = URL.parse(input)
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Updater URLs must use HTTPS without credentials, queries or fragments')
  return url
}

function releaseVersion(value) {
  parseVersion(value)
  return value
}

function parseVersion(value) {
  const parsed = typeof value === 'string' && value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Z-][A-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Z-][A-Z0-9-]*))*))?(?:\+[A-Z0-9-]+(?:\.[A-Z0-9-]+)*)?$/i)
  if (!parsed)
    throw new Error('The updater version must be an application SemVer')
  return { core: parsed.slice(1, 4).map(BigInt), prerelease: parsed[4]?.split('.') ?? [] }
}

/** 按 SemVer 优先级排序，预发布数字按数值比较，构建元数据不参与升级先后。 */
export function compareVersions(first, second) {
  const a = parseVersion(first)
  const b = parseVersion(second)
  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index] !== b.core[index])
      return a.core[index] > b.core[index] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === right)
      continue
    if (left === undefined || right === undefined)
      return left === undefined ? -1 : 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric)
      return BigInt(left) > BigInt(right) ? 1 : -1
    if (leftNumeric !== rightNumeric)
      return leftNumeric ? -1 : 1
    return left > right ? 1 : -1
  }
  return 0
}

function decodeBase64(input) {
  if (typeof input !== 'string' || !input || Buffer.from(input, 'base64').toString('base64') !== input)
    throw new Error('Invalid updater signing data encoding')
  return Buffer.from(input, 'base64')
}

function publicKey(input) {
  const value = input?.trim() ?? ''
  const lines = decodeBase64(value).toString('utf8').trimEnd().split(/\r?\n/)
  const bytes = decodeBase64(lines[1])
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ') || bytes.length !== 42 || bytes.subarray(0, 2).toString('ascii') !== 'Ed')
    throw new Error('Configure a real Tauri signing public key before enabling desktop updates')
  return {
    value,
    keyId: bytes.subarray(2, 10),
    key: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes.subarray(10)]), format: 'der', type: 'spki' }),
  }
}

function filename(target, version) {
  const [platform, arch, extension] = TARGETS[target]
  return `ai-ask-updater-${platform}-${arch}-${version}${extension}`
}

export async function configure(file, endpoint, key) {
  const hasEndpoint = Boolean(endpoint?.trim())
  const hasKey = Boolean(key?.trim())
  if (!hasEndpoint && !hasKey)
    return false
  if (!hasEndpoint || !hasKey)
    throw new Error('TAURI_UPDATE_PUBLIC_KEY and TAURI_UPDATE_FEED_URL must be configured together')
  const url = secureUrl(endpoint)
  if (!url.pathname.endsWith('/latest.json'))
    throw new Error('The updater feed must end with /latest.json')
  const { value: pubkey } = publicKey(key)
  const config = JSON.parse(await readFile(file, 'utf8').catch(error => error.code === 'ENOENT' ? '{}' : Promise.reject(error)))
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('The platform Tauri configuration must be an object')
  config.plugins = { ...config.plugins, updater: { endpoints: [url.href], pubkey, requireSignedVersion: true, allowDowngrades: false } }
  // 自动签名需要构建步骤获得私钥；本工程在独立步骤手动打包并签名。
  config.bundle = { ...config.bundle, createUpdaterArtifacts: false }
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`)
  return true
}

/** 发布配置必须与已评审的正式信任根一致；GitHub vars 不能另造一套安装包信任策略。 */
export async function validateReleaseConfiguration(file, endpoint, key) {
  if (!endpoint?.trim() || !key?.trim())
    throw new Error('Release updater variables are required for the reviewed source configuration')
  const configuredKey = publicKey(key)
  const configuredEndpoint = secureUrl(endpoint).href
  const source = JSON.parse(await readFile(file, 'utf8'))
  const updater = source.plugins?.updater
  if (!updater || updater.pubkey !== configuredKey.value
    || !Array.isArray(updater.endpoints) || updater.endpoints.length !== 1 || updater.endpoints[0] !== configuredEndpoint
    || updater.requireSignedVersion !== true || updater.allowDowngrades !== false
    || updater.dangerousInsecureTransportProtocol === true || updater.dangerousAcceptInvalidCerts === true || updater.dangerousAcceptInvalidHostnames === true) {
    throw new Error('Release updater variables must match the reviewed source public key, feed and strict signature policy')
  }
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))
  return nested.flat()
}

/** 与 updater 使用的 Minisign 协议一致：校验文件签名和覆盖 version 的 trusted comment。 */
function verifySignedVersion(encodedSignature, configuredKey, version) {
  const lines = decodeBase64(encodedSignature).toString('utf8').trimEnd().split(/\r?\n/)
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: '))
    throw new Error('Invalid updater Minisign signature')
  const packet = decodeBase64(lines[1])
  const globalSignature = decodeBase64(lines[3])
  const trusted = lines[2].slice('trusted comment: '.length)
  const versions = trusted.split('\t').filter(field => field.startsWith('version:'))
  if (packet.length !== 74 || packet.subarray(0, 2).toString('ascii') !== 'ED' || globalSignature.length !== 64 || !packet.subarray(2, 10).equals(configuredKey.keyId))
    throw new Error('The updater signature does not match the configured public key')
  if (versions.length !== 1 || versions[0] !== `version:${version}`)
    throw new Error('The updater signature is not bound to this release version')
  if (!verify(null, Buffer.concat([packet.subarray(10), Buffer.from(trusted)]), configuredKey.key, globalSignature))
    throw new Error('The updater signature trusted comment is invalid')
  return packet
}

async function verifyArtifact(file, encodedSignature, configuredKey, version) {
  const packet = verifySignedVersion(encodedSignature, configuredKey, version)
  const state = await lstat(file)
  if (!state.isFile() || state.size === 0)
    throw new Error('Updater artifacts must be non-empty regular files')
  const prehash = createHash('blake2b512')
  for await (const chunk of createReadStream(file))
    prehash.update(chunk)
  if (!verify(null, prehash.digest(), configuredKey.key, packet.subarray(10)))
    throw new Error('The updater artifact signature is invalid')
}

export async function sign({ platform, arch, version, bundleDirectory, outputDirectory, assetBaseUrl, key }) {
  releaseVersion(version)
  const target = Object.keys(TARGETS).find(name => TARGETS[name][0] === platform && TARGETS[name][1] === arch)
  if (!target)
    throw new Error('Unsupported updater platform or architecture')
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY?.trim())
    throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for a configured signed release')
  const configuredKey = publicKey(key)
  const base = secureUrl(assetBaseUrl)
  if (!base.pathname.endsWith('/'))
    base.pathname += '/'
  const all = await files(bundleDirectory)
  const selected = platform === 'macos'
    ? (await readdir(join(bundleDirectory, 'macos'), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app')).map(entry => join(bundleDirectory, 'macos', entry.name))
    : all.filter(file => file.endsWith(platform === 'windows' ? '.exe' : '.AppImage'))
  if (selected.length !== 1 || (await lstat(selected[0])).isSymbolicLink())
    throw new Error(`Expected exactly one ${platform} updater bundle`)
  const output = resolve(outputDirectory)
  await mkdir(output, { recursive: true })
  if ((await readdir(output)).length)
    throw new Error('The updater output directory must be empty')
  const assetName = filename(target, version)
  const artifact = join(output, assetName)
  if (platform === 'macos')
    execFileSync('tar', ['-czf', artifact, '-C', join(bundleDirectory, 'macos'), basename(selected[0])], { windowsHide: true, stdio: 'ignore' })
  else
    await copyFile(selected[0], artifact)
  try {
    // 私钥通过环境传给官方 CLI，不进入命令参数、构建步骤或日志。
    execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--app-version', version, artifact], { windowsHide: true, stdio: 'ignore' })
  }
  catch {
    throw new Error('The official Tauri signer failed; verify the configured signing key and password')
  }
  const signature = (await readFile(`${artifact}.sig`, 'utf8')).trim()
  await verifyArtifact(artifact, signature, configuredKey, version)
  await writeFile(join(output, 'latest.json'), `${JSON.stringify({ version, platforms: { [target]: { signature, url: new URL(encodeURIComponent(assetName), base).href } } }, null, 2)}\n`)
}

export async function merge(directories, version, output, key = process.env.TAURI_UPDATE_PUBLIC_KEY) {
  releaseVersion(version)
  const configuredKey = publicKey(key)
  const platforms = {}
  const names = new Set()
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))
    if (manifest.version !== version || !manifest.platforms || Object.keys(manifest.platforms).length !== 1)
      throw new Error('Each signed manifest must contain one target for this release version')
    for (const [target, artifact] of Object.entries(manifest.platforms)) {
      if (!Object.hasOwn(TARGETS, target) || platforms[target])
        throw new Error('Unknown or duplicate signed updater target')
      const url = secureUrl(artifact.url)
      const assetName = decodeURIComponent(basename(url.pathname))
      if (assetName !== filename(target, version) || names.has(assetName))
        throw new Error('Conflicting or unexpected updater artifact names')
      const file = join(directory, assetName)
      if ((await readFile(`${file}.sig`, 'utf8')).trim() !== artifact.signature)
        throw new Error('The updater manifest and detached signature do not match')
      await verifyArtifact(file, artifact.signature, configuredKey, version)
      names.add(assetName)
      platforms[target] = { signature: artifact.signature, url: url.href }
    }
  }
  if (Object.keys(platforms).length !== Object.keys(TARGETS).length)
    throw new Error('All five signed updater targets are required before publishing a feed')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify({ version, platforms }, null, 2)}\n`)
}

function isVersionAsset(url, repository, version, assetName) {
  const parsed = secureUrl(url)
  return parsed.origin === 'https://github.com'
    && decodeURIComponent(parsed.pathname) === `/${repository}/releases/download/v${version}/${assetName}`
}

function completeRelease(release, repository, version) {
  if (release?.draft !== false || release.tag_name !== `v${version}` || !Array.isArray(release.assets))
    return false
  const names = Object.keys(TARGETS).flatMap(target => [filename(target, version), `${filename(target, version)}.sig`])
  names.push('latest.json')
  return names.every((name) => {
    const matches = release.assets.filter(asset => asset.name === name)
    if (matches.length !== 1)
      return false
    const asset = matches[0]
    return asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0
      && isVersionAsset(asset.browser_download_url, repository, version, name)
  })
}

function validateChannelManifest(manifest, repository, configuredKey) {
  releaseVersion(manifest?.version)
  if (!manifest.platforms || Object.keys(manifest.platforms).length !== Object.keys(TARGETS).length)
    throw new Error('The channel feed must contain all five updater targets')
  for (const target of Object.keys(TARGETS)) {
    const artifact = manifest.platforms[target]
    if (!artifact || !isVersionAsset(artifact.url, repository, manifest.version, filename(target, manifest.version)))
      throw new Error('Channel assets must refer to the matching immutable application release')
    verifySignedVersion(artifact.signature, configuredKey, manifest.version)
  }
}

function tagCommit(gitDirectory, version) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `refs/tags/v${releaseVersion(version)}^{commit}`], { cwd: gitDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim()
  }
  catch {
    throw new Error('The application version tag must exist before updating the desktop channel')
  }
}

/** 只读规划；必须在固定通道互斥锁内重新读取公开 release/feed 后调用，不执行 GitHub 写操作。 */
export function planChannelUpdate({ candidate, current, releases, repository, sourceSha, key, gitDirectory = process.cwd() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f\d]{40}$/i.test(sourceSha) || !Array.isArray(releases))
    throw new Error('Invalid desktop channel release provenance')
  const configuredKey = publicKey(key)
  validateChannelManifest(candidate, repository, configuredKey)
  if (tagCommit(gitDirectory, candidate.version) !== sourceSha)
    throw new Error('The application version tag does not match the built source SHA')
  const published = releases.find(release => release.tag_name === `v${candidate.version}`)
  if (!completeRelease(published, repository, candidate.version))
    throw new Error('The application release and all signed assets must be public before updating the channel')
  if (current) {
    validateChannelManifest(current, repository, configuredKey)
    if (compareVersions(candidate.version, current.version) <= 0)
      return { promote: false, reason: 'The channel already serves this version or a newer version' }
    const priorSha = tagCommit(gitDirectory, current.version)
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', priorSha, sourceSha], { cwd: gitDirectory, stdio: 'ignore', windowsHide: true })
    }
    catch {
      throw new Error('The new channel source must descend from the currently published version')
    }
  }
  // 清单上传失败可能暂时没有 current；公开的完整新版本仍可阻止迟到旧 CI 回填旧版本。
  for (const release of releases) {
    if (typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v'))
      continue
    const version = release.tag_name.slice(1)
    try {
      releaseVersion(version)
    }
    catch {
      continue
    }
    if (compareVersions(version, candidate.version) > 0 && completeRelease(release, repository, version))
      return { promote: false, reason: 'A newer complete application release is already public' }
  }
  return { promote: true, reason: 'The newest complete signed release can advance the desktop channel' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'configure') {
    const sourceFile = join(dirname(args[0]), 'tauri.conf.json')
    const source = JSON.parse(await readFile(sourceFile, 'utf8'))
    if (source.plugins?.updater || args[1]?.trim() || process.env.TAURI_UPDATE_PUBLIC_KEY?.trim())
      await validateReleaseConfiguration(sourceFile, args[1], process.env.TAURI_UPDATE_PUBLIC_KEY)
    const enabled = await configure(args[0], args[1], process.env.TAURI_UPDATE_PUBLIC_KEY)
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`)
  }
  else if (command === 'sign') {
    await sign({ platform: args[0], arch: args[1], version: args[2], bundleDirectory: args[3], outputDirectory: args[4], assetBaseUrl: args[5], key: process.env.TAURI_UPDATE_PUBLIC_KEY })
  }
  else if (command === 'merge') {
    await merge(args.slice(2), args[0], args[1])
  }
  else if (command === 'channel-plan') {
    const [candidate, current, releases] = await Promise.all(args.slice(0, 3).map(file => file === '-' ? null : readFile(file, 'utf8').then(JSON.parse)))
    const plan = planChannelUpdate({ candidate, current, releases: releases.flat(), sourceSha: args[3], repository: args[4], key: process.env.TAURI_UPDATE_PUBLIC_KEY })
    await writeFile(args[5], `${JSON.stringify(plan)}\n`)
  }
  else if (command === 'validate-config') {
    await validateReleaseConfiguration(args[0], args[1], process.env.TAURI_UPDATE_PUBLIC_KEY)
  }
  else {
    throw new Error('Expected configure, sign, merge, channel-plan or validate-config')
  }
}
