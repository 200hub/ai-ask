import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const rootDir = fileURLToPath(new URL('../../', import.meta.url))
const desktopDir = resolve(rootDir, 'apps/ai-ask-desktop')
export const paths = {
  workspacePackage: resolve(rootDir, 'package.json'),
  desktopPackage: resolve(desktopDir, 'package.json'),
  servicePackage: resolve(rootDir, 'packages/ai-ask-serv/package.json'),
  contractPackage: resolve(rootDir, 'packages/ai-ask-contract/package.json'),
  publicEnvironment: resolve(rootDir, '.env'),
  exampleEnvironment: resolve(rootDir, '.env.example'),
  coreConfig: resolve(rootDir, 'packages/ai-ask-serv/config/_core.yml'),
  tauriConfig: resolve(desktopDir, 'src-tauri/tauri.conf.json'),
  cargoManifest: resolve(desktopDir, 'src-tauri/Cargo.toml'),
  cargoLock: resolve(desktopDir, 'src-tauri/Cargo.lock'),
  constants: resolve(desktopDir, 'src/lib/utils/constants.ts'),
}

const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Z-][A-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Z-][A-Z0-9-]*))*)?(?:\+[A-Z0-9-]+(?:\.[A-Z0-9-]+)*)?$/i

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function readSourceVersion() {
  const version = readJson(paths.workspacePackage).version
  if (typeof version !== 'string' || !semver.test(version))
    throw new Error(`Invalid workspace semantic version: ${version}`)
  return version
}

export function readTauriVersion() {
  const source = readJson(paths.tauriConfig).version
  if (source !== '../../../package.json')
    throw new Error('Tauri must use the workspace package.json version reference')
  return readJson(resolve(dirname(paths.tauriConfig), source)).version
}

export function readVersion(file, pattern) {
  const version = readFileSync(file, 'utf8').match(pattern)?.[1]
  if (!version)
    throw new Error(`Could not find version in ${file}`)
  return version
}
