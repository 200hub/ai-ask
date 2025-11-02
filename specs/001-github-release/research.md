# 技术研究：GitHub Actions多平台构建

本文档记录GitHub Actions自动构建和发布的技术调研结果。

## 1. Tauri跨平台构建配置

### 1.1 Windows平台

#### MSI安装包

**配置** (`src-tauri/tauri.conf.json`):
```json
{
  "bundle": {
    "targets": ["msi"],
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": ""
    }
  }
}
```

**特点**:
- Windows Installer标准格式
- 支持静默安装
- 可通过GPO部署
- 文件大小较小

#### NSIS安装包

**配置**:
```json
{
  "bundle": {
    "targets": ["nsis"]
  }
}
```

**特点**:
- 自定义安装界面
- 更灵活的安装逻辑
- 支持自定义组件选择

#### Windows ARM64支持

**Rust target**: `aarch64-pc-windows-msvc`

**GitHub Actions配置**:
```yaml
- name: Build Windows ARM64
  run: |
    rustup target add aarch64-pc-windows-msvc
    pnpm tauri build --target aarch64-pc-windows-msvc
```

**注意事项**:
- 需要交叉编译
- 测试需要ARM64设备或虚拟机
- 依赖库需要支持ARM64

### 1.2 macOS平台

#### DMG磁盘映像

**配置**:
```json
{
  "bundle": {
    "targets": ["dmg"],
    "macOS": {
      "minimumSystemVersion": "10.13"
    }
  }
}
```

**特点**:
- 用户友好的拖拽安装
- 可自定义背景和图标布局
- 适合分发

#### App Bundle

**配置**:
```json
{
  "bundle": {
    "targets": ["app"]
  }
}
```

**特点**:
- 原生.app格式
- 可用于签名和公证
- 适合上传到Mac App Store

#### 代码签名和公证

**要求**:
- Apple Developer账号
- 开发者ID证书
- 公证（notarization）流程

**配置示例**:
```yaml
- name: Sign and Notarize
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
  run: |
    # 导入证书
    echo $APPLE_CERTIFICATE | base64 --decode > certificate.p12
    security import certificate.p12 -P $APPLE_CERTIFICATE_PASSWORD
    
    # 签名
    codesign --deep --force --verify --verbose \
      --sign "Developer ID Application" \
      "target/release/bundle/macos/AI Ask.app"
    
    # 公证
    xcrun notarytool submit "target/release/bundle/dmg/AI Ask.dmg" \
      --apple-id $APPLE_ID --password $APPLE_ID_PASSWORD \
      --wait
```

#### Apple Silicon支持

**Rust target**: `aarch64-apple-darwin`

**通用二进制（Universal Binary）**:
```yaml
- name: Build Universal Binary
  run: |
    rustup target add x86_64-apple-darwin
    rustup target add aarch64-apple-darwin
    pnpm tauri build --target universal-apple-darwin
```

### 1.3 Linux平台

#### DEB包（Debian/Ubuntu）

**配置**:
```json
{
  "bundle": {
    "targets": ["deb"],
    "deb": {
      "depends": ["libwebkit2gtk-4.0-37", "libgtk-3-0"]
    }
  }
}
```

**特点**:
- 包管理器集成
- 自动依赖解析
- 适合Debian系发行版

#### AppImage

**配置**:
```json
{
  "bundle": {
    "targets": ["appimage"]
  }
}
```

**特点**:
- 独立可执行文件
- 无需安装
- 跨发行版兼容
- 文件大小较大（包含所有依赖）

#### RPM包（Fedora/RHEL）

**配置**:
```json
{
  "bundle": {
    "targets": ["rpm"]
  }
}
```

**特点**:
- 适合Red Hat系发行版
- 包管理器集成

**构建依赖**:
```yaml
- name: Install Linux Dependencies
  if: matrix.os == 'ubuntu-latest'
  run: |
    sudo apt-get update
    sudo apt-get install -y \
      libwebkit2gtk-4.0-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      patchelf
```

### 1.4 移动平台

#### Android

**Tauri Mobile支持**: Tauri 2.0+原生支持Android

**配置** (`src-tauri/gen/android/app/build.gradle`):
```gradle
android {
    compileSdkVersion 33
    defaultConfig {
        applicationId "com.200hub.aiask"
        minSdkVersion 24
        targetSdkVersion 33
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
}
```

**GitHub Actions配置**:
```yaml
- name: Setup Android SDK
  uses: android-actions/setup-android@v2
  
- name: Build Android
  env:
    KEYSTORE_PATH: ${{ github.workspace }}/ai-ask.keystore
    KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
    KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
    KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
  run: |
    echo "${{ secrets.ANDROID_KEYSTORE }}" | base64 -d > ai-ask.keystore
    pnpm tauri android build --release
```

**产物**:
- APK: 直接安装包
- AAB: Google Play上传格式

#### iOS

**要求**:
- macOS构建环境
- Xcode
- Apple开发者账号
- 签名证书和provisioning profile

**配置** (`src-tauri/gen/apple/project.yml`):
```yaml
name: AI Ask
bundleIdPrefix: com.200hub.aiask
targets:
  AI Ask iOS:
    type: application
    platform: iOS
    deploymentTarget: "13.0"
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: com.200hub.aiask
      DEVELOPMENT_TEAM: YOUR_TEAM_ID
```

**GitHub Actions配置**:
```yaml
- name: Setup iOS Certificates
  env:
    IOS_CERTIFICATE_P12: ${{ secrets.IOS_CERTIFICATE_P12 }}
    IOS_CERTIFICATE_PASSWORD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}
    IOS_PROVISIONING_PROFILE: ${{ secrets.IOS_PROVISIONING_PROFILE }}
  run: |
    # 创建keychain
    security create-keychain -p "" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    
    # 导入证书
    echo "$IOS_CERTIFICATE_P12" | base64 -d > certificate.p12
    security import certificate.p12 -k build.keychain \
      -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    
    # 安装provisioning profile
    mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
    echo "$IOS_PROVISIONING_PROFILE" | base64 -d > \
      ~/Library/MobileDevice/Provisioning\ Profiles/profile.mobileprovision
    
- name: Build iOS
  run: |
    pnpm tauri ios build --release
```

## 2. GitHub Actions工作流设计

### 2.1 工作流架构

#### 主工作流（release.yml）

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version number (without v prefix)'
        required: true
        type: string

jobs:
  validate:
    name: Validate Version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate Version Format
        run: node .github/scripts/validate-version.js
        
  build-desktop:
    name: Build Desktop Platforms
    needs: validate
    uses: ./.github/workflows/build-desktop.yml
    
  build-mobile:
    name: Build Mobile Platforms
    needs: validate
    uses: ./.github/workflows/build-mobile.yml
    secrets: inherit
    
  changelog:
    name: Generate Changelog
    needs: validate
    runs-on: ubuntu-latest
    outputs:
      changelog: ${{ steps.generate.outputs.changelog }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Generate Changelog
        id: generate
        run: node .github/scripts/generate-changelog.js
        
  release:
    name: Create GitHub Release
    needs: [build-desktop, build-mobile, changelog]
    runs-on: ubuntu-latest
    steps:
      - name: Download All Artifacts
        uses: actions/download-artifact@v4
        
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          body: ${{ needs.changelog.outputs.changelog }}
          files: |
            artifacts/**/*
          draft: false
          prerelease: false
```

#### 桌面平台构建工作流（build-desktop.yml）

```yaml
name: Build Desktop

on:
  workflow_call:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            platform: linux
            arch: x64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            platform: windows
            arch: x64
          - os: macos-latest
            target: x86_64-apple-darwin
            platform: macos
            arch: intel
          - os: macos-latest
            target: aarch64-apple-darwin
            platform: macos
            arch: arm64
            
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
          
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
          
      - name: Install Dependencies (Linux)
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.0-dev \
            libgtk-3-dev libayatana-appindicator3-dev \
            librsvg2-dev patchelf
            
      - name: Cache Cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            src-tauri/target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          
      - name: Install Frontend Dependencies
        run: pnpm install
        
      - name: Build
        run: pnpm tauri build --target ${{ matrix.target }}
        
      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.platform }}-${{ matrix.arch }}
          path: |
            src-tauri/target/${{ matrix.target }}/release/bundle/**/*
          if-no-files-found: error
```

### 2.2 缓存策略

#### Cargo缓存

```yaml
- name: Cache Cargo
  uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/bin/
      ~/.cargo/registry/index/
      ~/.cargo/registry/cache/
      ~/.cargo/git/db/
      src-tauri/target/
    key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
    restore-keys: |
      ${{ runner.os }}-cargo-
```

**节省时间**: 首次构建40分钟 → 后续5-10分钟

#### pnpm缓存

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v2
  with:
    version: 8
    run_install: false
    
- name: Get pnpm store directory
  id: pnpm-cache
  run: |
    echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT
    
- name: Setup pnpm cache
  uses: actions/cache@v4
  with:
    path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      ${{ runner.os }}-pnpm-store-
```

### 2.3 矩阵策略优化

#### 动态矩阵（按需构建）

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: |
          # 根据标签决定构建哪些平台
          if [[ "${{ github.ref }}" == *"-beta" ]]; then
            # Beta版本只构建核心平台
            echo 'matrix={"os":["ubuntu-latest","windows-latest"]}' >> $GITHUB_OUTPUT
          else
            # 正式版本构建所有平台
            echo 'matrix={"os":["ubuntu-latest","windows-latest","macos-latest"]}' >> $GITHUB_OUTPUT
          fi
          
  build:
    needs: setup
    strategy:
      matrix: ${{ fromJson(needs.setup.outputs.matrix) }}
```

## 3. Changelog自动化

### 3.1 Conventional Commits解析

**Commit类型映射**:

| Prefix | 类别 | 说明 |
|--------|------|------|
| feat: | Features | 新功能 |
| fix: | Bug Fixes | 问题修复 |
| perf: | Performance | 性能优化 |
| refactor: | Refactor | 代码重构 |
| docs: | Documentation | 文档更新 |
| style: | Styles | 代码格式 |
| test: | Tests | 测试相关 |
| chore: | Chores | 构建/工具 |
| feat!: | Breaking Changes | 破坏性变更 |

### 3.2 生成脚本实现

**核心逻辑** (`.github/scripts/generate-changelog.js`):

```javascript
const { execSync } = require('child_process');

// 获取上一个标签
function getPreviousTag() {
  try {
    return execSync('git describe --tags --abbrev=0 HEAD^')
      .toString().trim();
  } catch (e) {
    // 首次发布，无上一个标签
    return null;
  }
}

// 获取commit范围
function getCommits(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const commits = execSync(`git log ${range} --pretty=format:"%H|%s|%an|%ae"`)
    .toString().split('\n');
  
  return commits.map(line => {
    const [hash, subject, author, email] = line.split('|');
    return { hash, subject, author, email };
  });
}

// 解析conventional commit
function parseCommit(subject) {
  const match = subject.match(/^(\w+)(\([\w-]+\))?(!)?:\s*(.+)$/);
  if (!match) return { type: 'other', scope: null, breaking: false, message: subject };
  
  const [, type, scope, breaking, message] = match;
  return {
    type,
    scope: scope ? scope.slice(1, -1) : null,
    breaking: !!breaking,
    message
  };
}

// 分类commits
function categorizeCommits(commits) {
  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    performance: [],
    refactor: [],
    docs: [],
    others: []
  };
  
  commits.forEach(commit => {
    const parsed = parseCommit(commit.subject);
    
    if (parsed.breaking) {
      categories.breaking.push({ ...commit, ...parsed });
    } else if (parsed.type === 'feat') {
      categories.features.push({ ...commit, ...parsed });
    } else if (parsed.type === 'fix') {
      categories.fixes.push({ ...commit, ...parsed });
    } else if (parsed.type === 'perf') {
      categories.performance.push({ ...commit, ...parsed });
    } else if (parsed.type === 'refactor') {
      categories.refactor.push({ ...commit, ...parsed });
    } else if (parsed.type === 'docs') {
      categories.docs.push({ ...commit, ...parsed });
    } else {
      categories.others.push({ ...commit, ...parsed });
    }
  });
  
  return categories;
}

// 生成Markdown
function generateMarkdown(categories, version) {
  let md = `# ${version}\n\n`;
  
  if (categories.breaking.length > 0) {
    md += `## ⚠️ Breaking Changes\n\n`;
    categories.breaking.forEach(c => {
      md += `- ${c.message} (${c.hash.slice(0, 7)})\n`;
    });
    md += '\n';
  }
  
  if (categories.features.length > 0) {
    md += `## ✨ Features\n\n`;
    categories.features.forEach(c => {
      md += `- ${c.message} (${c.hash.slice(0, 7)})\n`;
    });
    md += '\n';
  }
  
  if (categories.fixes.length > 0) {
    md += `## 🐛 Bug Fixes\n\n`;
    categories.fixes.forEach(c => {
      md += `- ${c.message} (${c.hash.slice(0, 7)})\n`;
    });
    md += '\n';
  }
  
  if (categories.performance.length > 0) {
    md += `## ⚡ Performance\n\n`;
    categories.performance.forEach(c => {
      md += `- ${c.message} (${c.hash.slice(0, 7)})\n`;
    });
    md += '\n';
  }
  
  return md;
}

// 主函数
function main() {
  const version = process.env.GITHUB_REF_NAME || 'v0.0.0';
  const prevTag = getPreviousTag();
  const commits = getCommits(prevTag);
  const categories = categorizeCommits(commits);
  const changelog = generateMarkdown(categories, version);
  
  // 输出到GitHub Actions
  console.log(`::set-output name=changelog::${changelog}`);
}

main();
```

### 3.3 Changelog模板

**格式示例**:

```markdown
# v1.0.1

**发布日期**: 2025-11-01

## ⚠️ Breaking Changes

- 重构状态管理，移除旧的store API (a1b2c3d)

## ✨ Features

- 添加深色模式支持 (d4e5f6)
- 新增快捷键自定义功能 (g7h8i9)

## 🐛 Bug Fixes

- 修复窗口拖动区域问题 (j1k2l3)
- 修复翻译页面布局错误 (m4n5o6)

## ⚡ Performance

- 优化子webview加载速度 (p7q8r9)

## 📝 Documentation

- 更新README安装说明 (s1t2u3)

---

**完整Changelog**: [v1.0.0...v1.0.1](https://github.com/yourusername/ai-ask/compare/v1.0.0...v1.0.1)
```

## 4. 敏感信息管理

### 4.1 GitHub Secrets配置

#### 必需的Secrets

**Android**:
- `ANDROID_KEYSTORE`: Base64编码的keystore文件
- `ANDROID_KEYSTORE_PASSWORD`: keystore密码
- `ANDROID_KEY_ALIAS`: 密钥别名
- `ANDROID_KEY_PASSWORD`: 密钥密码

**iOS**:
- `IOS_CERTIFICATE_P12`: Base64编码的开发者证书
- `IOS_CERTIFICATE_PASSWORD`: 证书密码
- `IOS_PROVISIONING_PROFILE`: Base64编码的provisioning profile
- `APPLE_ID`: Apple ID（用于公证）
- `APPLE_ID_PASSWORD`: 应用专用密码

**macOS签名**:
- `APPLE_CERTIFICATE`: Base64编码的开发者ID证书
- `APPLE_CERTIFICATE_PASSWORD`: 证书密码

#### 设置方法

1. 进入仓库Settings → Secrets and variables → Actions
2. 点击"New repository secret"
3. 输入名称和值
4. 保存

### 4.2 密钥轮换策略

**最佳实践**:
- 每年更新签名证书
- 使用短期访问令牌（Apple ID应用专用密码）
- 定期审计Secrets使用情况
- 限制Secrets访问权限（仅特定工作流）

### 4.3 本地开发vs CI/CD

**环境变量分离**:

```yaml
# 本地开发（.env.local - 不提交）
ANDROID_KEYSTORE_PATH=./debug.keystore
ANDROID_KEY_PASSWORD=android

# CI/CD（GitHub Secrets）
ANDROID_KEYSTORE_PATH=${{ github.workspace }}/release.keystore
ANDROID_KEY_PASSWORD=${{ secrets.ANDROID_KEY_PASSWORD }}
```

## 5. 性能优化

### 5.1 构建时间优化

#### 并行构建

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
  max-parallel: 3  # 同时运行3个作业
```

#### 增量构建

```yaml
- name: Cache Rust Build
  uses: Swatinem/rust-cache@v2
  with:
    shared-key: "release"
    cache-on-failure: true
```

### 5.2 构建资源管理

#### macOS Runner成本控制

macOS runner计费倍数为10x，优化策略：

1. 仅在正式发布时构建macOS
2. 使用self-hosted runner（如有条件）
3. 合并macOS Intel和ARM构建

```yaml
build-macos:
  if: github.ref_type == 'tag'  # 仅标签触发
  runs-on: macos-latest
```

### 5.3 Artifact管理

#### 压缩上传

```yaml
- name: Compress Artifacts
  run: |
    cd src-tauri/target/release/bundle
    tar -czf ai-ask-${{ matrix.platform }}-${{ matrix.arch }}.tar.gz *
    
- name: Upload Compressed Artifacts
  uses: actions/upload-artifact@v4
  with:
    name: ${{ matrix.platform }}-${{ matrix.arch }}
    path: src-tauri/target/release/bundle/*.tar.gz
    compression-level: 0  # 已压缩，无需再压
```

## 6. 测试策略

### 6.1 构建验证

#### 完整性检查

```yaml
- name: Verify Build Artifacts
  run: |
    # 检查文件是否存在
    ls -lh src-tauri/target/release/bundle
    
    # 检查文件大小（不应小于阈值）
    MIN_SIZE=10000000  # 10MB
    for file in src-tauri/target/release/bundle/**/*; do
      size=$(stat -f%z "$file")
      if [ $size -lt $MIN_SIZE ]; then
        echo "Error: $file is too small ($size bytes)"
        exit 1
      fi
    done
```

#### 签名验证

```yaml
- name: Verify macOS Signature
  run: |
    codesign --verify --deep --strict \
      "target/release/bundle/macos/AI Ask.app"
    
    codesign --display --verbose=4 \
      "target/release/bundle/macos/AI Ask.app"
```

### 6.2 集成测试

#### 安装测试（Docker）

```yaml
test-install:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - name: Download DEB Package
      uses: actions/download-artifact@v4
      with:
        name: linux-x64
        
    - name: Test Installation
      run: |
        docker run --rm -v $(pwd):/workspace ubuntu:22.04 bash -c "
          apt-get update &&
          apt-get install -y /workspace/*.deb &&
          ai-ask --version
        "
```

## 7. 故障排查

### 7.1 常见构建错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `error: linker 'cc' not found` | Linux依赖缺失 | 安装build-essential |
| `error: failed to run custom build command` | Rust版本不兼容 | 更新Rust工具链 |
| `ENOENT: no such file or directory` | 前端构建失败 | 检查pnpm install |
| `Code signing failed` | 签名配置错误 | 验证证书和profile |

### 7.2 调试技巧

#### 启用详细日志

```yaml
- name: Build with Verbose Logging
  env:
    RUST_LOG: debug
    RUST_BACKTRACE: 1
  run: pnpm tauri build --verbose
```

#### SSH调试

使用[action-tmate](https://github.com/marketplace/actions/debugging-with-tmate):

```yaml
- name: Setup tmate session
  uses: mxschmitt/action-tmate@v3
  if: ${{ failure() }}
  timeout-minutes: 15
```

## 8. 最佳实践总结

### 8.1 工作流设计原则

1. **模块化**: 拆分可重用的工作流
2. **失败容忍**: 使用`continue-on-error`和`fail-fast: false`
3. **清晰输出**: 提供详细的步骤说明和日志
4. **版本锁定**: 固定action版本（如`@v4`而非`@latest`）

### 8.2 安全原则

1. **最小权限**: Secrets仅授予必需的工作流
2. **定期轮换**: 更新签名证书和密钥
3. **审计日志**: 监控Secrets使用情况
4. **分离环境**: 开发和生产使用不同的证书

### 8.3 成本优化

1. **条件构建**: 仅在需要时构建昂贵平台（macOS）
2. **缓存复用**: 充分利用Cargo和pnpm缓存
3. **并发控制**: 限制同时运行的作业数
4. **Self-hosted**: 考虑自建runner（如有资源）

### 8.4 维护策略

1. **定期更新**: 更新GitHub Actions和依赖版本
2. **监控构建时间**: 跟踪性能回归
3. **文档同步**: 保持quickstart.md和实际流程一致
4. **版本测试**: 定期测试发布流程（使用beta标签）
