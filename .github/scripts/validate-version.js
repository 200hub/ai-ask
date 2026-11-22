#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { paths, readJson, readSourceVersion, readTauriVersion, readVersion, rootDir } from './workspace-version.js'

function gitTagVersion() {
  const ref = process.env.GITHUB_REF_NAME || execFileSync(
    'git',
    ['describe', '--tags', '--exact-match'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim()
  if (!ref.startsWith('v'))
    throw new Error(`Git tag ${ref} must start with v`)
  return ref.slice(1)
}

try {
  const sourceOnly = process.argv.includes('--source-only')
  const expected = readSourceVersion()
  const versions = {
    'desktop package.json': readJson(paths.desktopPackage).version,
    'service package.json': readJson(paths.servicePackage).version,
    'contract package.json': readJson(paths.contractPackage).version,
    '.env HAI_CORE_VERSION': readVersion(paths.publicEnvironment, /^HAI_CORE_VERSION=([^\r\n]+)/m),
    '.env.example HAI_CORE_VERSION': readVersion(paths.exampleEnvironment, /^HAI_CORE_VERSION=([^\r\n]+)/m),
    'Core YAML version fallback': readVersion(paths.coreConfig, /^version:\s*\$\{HAI_CORE_VERSION:([^}]+)\}/m),
    'Tauri workspace version reference': readTauriVersion(),
    'Cargo.toml': readVersion(paths.cargoManifest, /^version\s*=\s*"([^"]+)"/m),
    'Cargo.lock': readVersion(paths.cargoLock, /\[\[package\]\][\r\n]+name\s*=\s*"ai-ask"[\r\n]+version\s*=\s*"([^"]+)"/),
    'APP_INFO.version': readVersion(paths.constants, /export\s+const\s+APP_INFO\s*=\s*\{[^}]*?\bversion:\s*['"]([^'"]+)['"]/),
  }
  if (!sourceOnly)
    versions['Git tag'] = gitTagVersion()
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected)
  if (mismatches.length)
    throw new Error(`Expected workspace version ${expected}\n${mismatches.map(([file, version]) => `  ${file}: ${version}`).join('\n')}`)
  console.info(`Version validation passed for ${expected} (${sourceOnly ? 'workspace sources' : 'workspace sources and tag'}).`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
