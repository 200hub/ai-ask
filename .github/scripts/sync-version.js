#!/usr/bin/env node

/** Synchronize desktop release metadata from the workspace package version. */
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { paths, readSourceVersion } from './workspace-version.js'

function updateFile(file, update) {
  const previous = readFileSync(file, 'utf8')
  const next = update(previous)
  if (next !== previous) {
    writeFileSync(file, next, 'utf8')
    console.info(`Updated ${file}`)
  }
}

function replaceVersion(file, pattern, version) {
  updateFile(file, (content) => {
    if (!pattern.test(content))
      throw new Error(`Version field not found in ${file}`)
    return content.replace(pattern, (_match, prefix, suffix) => `${prefix}${version}${suffix}`)
  })
}

try {
  const version = readSourceVersion()
  for (const file of [paths.desktopPackage, paths.servicePackage, paths.contractPackage]) {
    updateFile(file, (content) => {
      const packageJson = JSON.parse(content)
      packageJson.version = version
      return `${JSON.stringify(packageJson, null, 2)}\n`
    })
  }
  updateFile(paths.tauriConfig, (content) => {
    const config = JSON.parse(content)
    config.version = '../../../package.json'
    return `${JSON.stringify(config, null, 2)}\n`
  })
  replaceVersion(paths.cargoManifest, /(^version\s*=\s*")[^"]*(")/m, version)
  replaceVersion(paths.cargoLock, /(\[\[package\]\]\s*\nname\s*=\s*"ai-ask"\s*\nversion\s*=\s*")[^"]*(")/, version)
  replaceVersion(paths.constants, /(export\s+const\s+APP_INFO\s*=\s*\{[\s\S]*?version:\s*['"])[^'"]*(['"])/, version)
  replaceVersion(paths.publicEnvironment, /(^HAI_CORE_VERSION=)[^\r\n]*(\r?$)/m, version)
  replaceVersion(paths.coreConfig, /(^version:\s*\$\{HAI_CORE_VERSION:)[^}\r\n]*(\})/m, version)
  console.info(`Workspace desktop version synchronized to ${version}.`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
