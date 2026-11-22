/** 改编自 Hai beta.35 desktop-update-release；公开配置、打包与私钥签名严格分步。 */
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
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?$/i.test(value))
    throw new Error('The updater version must be an application SemVer')
  return value
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

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))
  return nested.flat()
}

/** 与 updater 使用的 Minisign 协议一致：校验文件签名和覆盖 version 的 trusted comment。 */
async function verifyArtifact(file, encodedSignature, configuredKey, version) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'configure') {
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
  else {
    throw new Error('Expected configure, sign or merge')
  }
}
