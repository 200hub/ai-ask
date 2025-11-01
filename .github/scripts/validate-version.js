#!/usr/bin/env node

/**
 * Version Validation Script
 * 
 * Validates that:
 * 1. Git tag follows semantic versioning (v*.*.*)
 * 2. package.json version matches tag
 * 3. src-tauri/tauri.conf.json version matches tag
 * 4. src-tauri/Cargo.toml version matches tag
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Color output helpers
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ERROR: ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function warn(message) {
  log(`⚠️  WARNING: ${message}`, 'yellow');
}

// Get version from git tag
function getGitTagVersion() {
  try {
    // Get current tag from GITHUB_REF or git describe
    const refName = process.env.GITHUB_REF_NAME || 
                    execSync('git describe --tags --exact-match', { encoding: 'utf8' }).trim();
    
    if (!refName.startsWith('v')) {
      error('Git tag must start with "v" (e.g., v1.0.0)');
      return null;
    }
    
    const version = refName.substring(1); // Remove 'v' prefix
    
    // Validate semantic versioning format
    const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    if (!semverRegex.test(version)) {
      error(`Invalid semantic version format: ${version}`);
      error('Expected format: v{major}.{minor}.{patch} (e.g., v1.0.0)');
      return null;
    }
    
    success(`Git tag version: v${version}`);
    return version;
  } catch (err) {
    error('Failed to get git tag. Make sure you are on a tagged commit.');
    error(err.message);
    return null;
  }
}

// Read package.json version
function getPackageJsonVersion() {
  try {
    const packagePath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const version = packageJson.version;
    
    success(`package.json version: ${version}`);
    return version;
  } catch (err) {
    error('Failed to read package.json');
    error(err.message);
    return null;
  }
}

// Read tauri.conf.json version
function getTauriConfigVersion() {
  try {
    const tauriConfigPath = path.resolve(process.cwd(), 'src-tauri/tauri.conf.json');
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
    const version = tauriConfig.version;
    
    success(`tauri.conf.json version: ${version}`);
    return version;
  } catch (err) {
    error('Failed to read src-tauri/tauri.conf.json');
    error(err.message);
    return null;
  }
}

// Read Cargo.toml version
function getCargoTomlVersion() {
  try {
    const cargoTomlPath = path.resolve(process.cwd(), 'src-tauri/Cargo.toml');
    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    
    // Parse version from Cargo.toml
    const versionMatch = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (!versionMatch) {
      error('Could not find version in Cargo.toml');
      return null;
    }
    
    const version = versionMatch[1];
    success(`Cargo.toml version: ${version}`);
    return version;
  } catch (err) {
    error('Failed to read src-tauri/Cargo.toml');
    error(err.message);
    return null;
  }
}

// Main validation
function main() {
  console.log('\n🔍 Validating version consistency...\n');
  
  const gitVersion = getGitTagVersion();
  const packageVersion = getPackageJsonVersion();
  const tauriVersion = getTauriConfigVersion();
  const cargoVersion = getCargoTomlVersion();
  
  // Check if all versions were retrieved
  if (!gitVersion || !packageVersion || !tauriVersion || !cargoVersion) {
    error('\nVersion validation failed: Could not retrieve all versions');
    process.exit(1);
  }
  
  // Compare versions
  const versions = {
    'Git tag': gitVersion,
    'package.json': packageVersion,
    'tauri.conf.json': tauriVersion,
    'Cargo.toml': cargoVersion
  };
  
  const allMatch = Object.values(versions).every(v => v === gitVersion);
  
  if (!allMatch) {
    console.log('\n❌ Version mismatch detected:\n');
    Object.entries(versions).forEach(([source, version]) => {
      const status = version === gitVersion ? '✓' : '✗';
      console.log(`  ${status} ${source}: ${version}`);
    });
    
    error('\nAll versions must match the git tag version!');
    error(`Expected: ${gitVersion}`);
    console.log('\nTo fix this, update all version files to match:');
    console.log(`  pnpm version ${gitVersion} --no-git-tag-version`);
    console.log(`  # Then manually update src-tauri/tauri.conf.json and src-tauri/Cargo.toml`);
    
    process.exit(1);
  }
  
  console.log('\n✅ All versions match!\n');
  success(`Version: ${gitVersion}`);
  console.log('\n✨ Version validation passed. Ready to build!\n');
  
  process.exit(0);
}

main();
