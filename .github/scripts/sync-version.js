#!/usr/bin/env node

/**
 * 版本号同步脚本
 * 
 * 功能：从 src-tauri/tauri.conf.json 读取版本号，同步到其他文件
 * 
 * 同步目标：
 * - package.json
 * - src-tauri/Cargo.toml
 * - src-tauri/Cargo.lock (ai-ask 包版本)
 * - src/lib/utils/constants.ts (APP_INFO.version)
 * 
 * 使用方法：
 * - npm run version:sync
 * - node .github/scripts/sync-version.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

/**
 * 从 tauri.conf.json 读取版本号
 */
function getVersionFromTauriConfig() {
  try {
    const tauriConfigPath = resolve(rootDir, 'src-tauri/tauri.conf.json');
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
    
    if (!tauriConfig.version) {
      throw new Error('Version not found in tauri.conf.json');
    }
    
    return tauriConfig.version;
  } catch (error) {
    logError(`Failed to read version from tauri.conf.json: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 更新 package.json 版本号
 */
function updatePackageJson(version) {
  try {
    const packageJsonPath = resolve(rootDir, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    if (packageJson.version === version) {
      logInfo(`package.json version is already ${version}`);
      return false;
    }
    
    packageJson.version = version;
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    logSuccess(`Updated package.json: ${packageJson.version} -> ${version}`);
    return true;
  } catch (error) {
    logError(`Failed to update package.json: ${error.message}`);
    return false;
  }
}

/**
 * 更新 Cargo.toml 版本号
 */
function updateCargoToml(version) {
  try {
    const cargoTomlPath = resolve(rootDir, 'src-tauri/Cargo.toml');
    let cargoToml = readFileSync(cargoTomlPath, 'utf8');
    
    // 匹配 [package] 部分的 version 行
    const versionRegex = /^version\s*=\s*"[^"]*"/m;
    const match = cargoToml.match(versionRegex);
    
    if (!match) {
      throw new Error('Version line not found in Cargo.toml');
    }
    
    const currentVersion = match[0].match(/"([^"]*)"/)[1];
    
    if (currentVersion === version) {
      logInfo(`Cargo.toml version is already ${version}`);
      return false;
    }
    
    cargoToml = cargoToml.replace(versionRegex, `version = "${version}"`);
    writeFileSync(cargoTomlPath, cargoToml, 'utf8');
    logSuccess(`Updated Cargo.toml: ${currentVersion} -> ${version}`);
    return true;
  } catch (error) {
    logError(`Failed to update Cargo.toml: ${error.message}`);
    return false;
  }
}

/**
 * 更新 Cargo.lock 版本号
 */
function updateCargoLock(version) {
  try {
    const cargoLockPath = resolve(rootDir, 'src-tauri/Cargo.lock');
    let cargoLock = readFileSync(cargoLockPath, 'utf8');
    
    // 匹配 ai-ask 包的版本行
    // 格式: [[package]]\nname = "ai-ask"\nversion = "x.x.x"
    const versionRegex = /(\[\[package\]\]\s*\nname\s*=\s*"ai-ask"\s*\nversion\s*=\s*)"([^"]*)"/;
    const match = cargoLock.match(versionRegex);
    
    if (!match) {
      throw new Error('ai-ask version not found in Cargo.lock');
    }
    
    const currentVersion = match[2];
    
    if (currentVersion === version) {
      logInfo(`Cargo.lock version is already ${version}`);
      return false;
    }
    
    cargoLock = cargoLock.replace(versionRegex, `$1"${version}"`);
    writeFileSync(cargoLockPath, cargoLock, 'utf8');
    logSuccess(`Updated Cargo.lock: ${currentVersion} -> ${version}`);
    return true;
  } catch (error) {
    logError(`Failed to update Cargo.lock: ${error.message}`);
    return false;
  }
}

/**
 * 更新 constants.ts 中的 APP_INFO.version
 */
function updateConstantsTs(version) {
  try {
    const constantsPath = resolve(rootDir, 'src/lib/utils/constants.ts');
    let constants = readFileSync(constantsPath, 'utf8');
    
    // 匹配 APP_INFO 对象中的 version 属性
    const versionRegex = /(export\s+const\s+APP_INFO\s*=\s*\{[^}]*version:\s*)"([^"]*)"/s;
    const match = constants.match(versionRegex);
    
    if (!match) {
      throw new Error('APP_INFO.version not found in constants.ts');
    }
    
    const currentVersion = match[2];
    
    if (currentVersion === version) {
      logInfo(`constants.ts APP_INFO.version is already ${version}`);
      return false;
    }
    
    constants = constants.replace(versionRegex, `$1"${version}"`);
    writeFileSync(constantsPath, constants, 'utf8');
    logSuccess(`Updated constants.ts: ${currentVersion} -> ${version}`);
    return true;
  } catch (error) {
    logError(`Failed to update constants.ts: ${error.message}`);
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  log('\n🔄 Synchronizing version from tauri.conf.json...\n', 'blue');
  
  // 1. 读取版本号
  const version = getVersionFromTauriConfig();
  logInfo(`Source version: ${version}`);
  log('');
  
  // 2. 同步到各个文件
  const results = {
    packageJson: updatePackageJson(version),
    cargoToml: updateCargoToml(version),
    cargoLock: updateCargoLock(version),
    constantsTs: updateConstantsTs(version),
  };
  
  // 3. 总结
  log('');
  const updated = Object.values(results).filter(Boolean).length;
  
  if (updated === 0) {
    logInfo('All files are already up to date!');
  } else {
    logSuccess(`Version synchronized successfully! (${updated} file(s) updated)`);
  }
  
  log('');
}

// 执行主函数
main();
