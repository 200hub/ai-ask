#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*))*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/;

function readVersion(file, pattern) {
  const version = readFileSync(file, 'utf8').match(pattern)?.[1];
  if (!version) {
    throw new Error(`Could not find version in ${file}`);
  }
  return version;
}

function gitTagVersion() {
  const ref = process.env.GITHUB_REF_NAME || execFileSync(
    'git', ['describe', '--tags', '--exact-match'], { encoding: 'utf8' },
  ).trim();
  if (!ref.startsWith('v')) {
    throw new Error(`Git tag ${ref} must start with v`);
  }
  return ref.slice(1);
}

try {
  const sourceOnly = process.argv.includes('--source-only');
  const source = 'src-tauri/tauri.conf.json';
  const expected = JSON.parse(readFileSync(source, 'utf8')).version;
  if (typeof expected !== 'string' || !semver.test(expected)) {
    throw new Error(`Invalid semantic version in ${source}: ${expected}`);
  }

  const versions = {
    'package.json': JSON.parse(readFileSync('package.json', 'utf8')).version,
    'src-tauri/Cargo.toml': readVersion('src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m),
    'src-tauri/Cargo.lock': readVersion('src-tauri/Cargo.lock', /\[\[package\]\][\r\n]+name\s*=\s*"ai-ask"[\r\n]+version\s*=\s*"([^"]+)"/),
    'APP_INFO.version': readVersion('src/lib/utils/constants.ts', /export\s+const\s+APP_INFO\s*=\s*\{[^}]*?\bversion:\s*['"]([^'"]+)['"]/),
  };
  if (!sourceOnly) {
    versions['Git tag'] = gitTagVersion();
  }

  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length) {
    const details = mismatches.map(([file, version]) => `  ${file}: ${version}`).join('\n');
    throw new Error(`Expected version ${expected} from ${source}\n${details}`);
  }
  console.log(`Version validation passed for ${expected} (${sourceOnly ? 'source files' : 'source files and tag'}).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
