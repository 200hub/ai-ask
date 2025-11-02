# Implementation Plan: GitHub自动打包发布

**Branch**: `001-github-release` | **Date**: 2025-11-01 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/001-github-release/spec.md`

## Summary

为AI Ask项目添加**纯GitHub Actions**的CI/CD流程，实现：
1. 标签触发：推送`v*.*.*`标签自动触发构建
2. 多平台构建：Windows x64、macOS (Universal)、Linux (DEB/AppImage)
3. Changelog生成：解析conventional commits，按类别格式化
4. 自动发布：创建GitHub Release并上传所有构建产物

**技术约束**：仅使用GitHub Actions生态系统（官方marketplace actions + GitHub Release API），无第三方CI/CD服务。

**核心依赖**：
- `actions/checkout@v4`、`actions/setup-node@v4`、`dtolnay/rust-toolchain@stable`: 环境准备
- `Swatinem/rust-cache@v2`: 构建缓存加速
- `softprops/action-gh-release@v1`: 创建 GitHub Release 并上传构建产物
- `pnpm` + `tauri CLI`: 直接执行 `pnpm tauri build` 进行各平台构建（不使用 tauri-action）

## Technical Context

**Language/Version**: 
- GitHub Actions Workflow YAML
- Shell Script (Bash/PowerShell，用于辅助脚本)
- Node.js 20.x LTS (runner预装，用于可选辅助工具)
- 项目现有技术栈：TypeScript 5.6、Rust 1.70+、Tauri CLI 2.x

**Primary Dependencies** (纯GitHub Actions生态): 
- **actions/checkout@v4**: 代码检出（支持使用可选 PAT_TOKEN 以触发下游工作流）
- **actions/setup-node@v4**: Node.js环境（pnpm需要）
- **dtolnay/rust-toolchain@stable**: Rust工具链安装
- **Swatinem/rust-cache@v2**: Cargo构建缓存
- **softprops/action-gh-release@v1**: 创建 Release 与上传附件
- **pnpm/action-setup@v2**: pnpm 包管理器（或使用 corepack）

**Storage**: GitHub Release附件存储（无限制，永久保存）

**Testing**: 
- 工作流语法验证：GitHub Actions editor + `act`本地测试（可选）
- 集成测试：推送测试标签验证完整流程
- 安装测试：下载构建产物验证可安装性

**Target Platform**: 
- **P1（MVP）**: Windows x64、macOS Universal (Intel+ARM)、Linux x64
- **P3（扩展）**: Windows ARM64、Android、iOS

**Project Type**: CI/CD配置项目（GitHub Actions工作流）

**Performance Goals**: 
- P1平台并行构建总时间 < 12分钟（利用矩阵并行）
- Changelog生成 < 30秒
- Release创建和上传 < 2分钟
- 二次构建（有缓存）< 5分钟

**Constraints**: 
- ✅ **仅使用GitHub Actions提供的能力**（hosted runners + marketplace actions）
- ✅ 不依赖外部CI/CD服务（CircleCI、Travis、Jenkins等）
- ✅ 不使用自定义runner（仅GitHub托管runner）
- ⚠️ macOS runner成本10倍（限制构建频率）
- ⚠️ 免费账户月度限额2000分钟（约30-40次完整构建）

**Scale/Scope**: 
- 3个目标平台（Windows、macOS、Linux）
- 每平台2-3种格式，共6-8个构建产物
- Changelog解析支持100+ commits

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 检查项目

✅ **Svelte 5 Runes Only**: 本功能不涉及前端状态管理，无冲突  
✅ **Child Webview Isolation**: 本功能为CI/CD流程，不涉及webview架构  
✅ **Pure CSS**: 本功能无UI组件  
✅ **i18n First**: 本功能无用户界面文本  
✅ **Structured Logging**: 构建日志由GitHub Actions管理  
✅ **Context-Driven Development**: 已分析现有package.json和tauri.conf.json配置  
✅ **Test-Driven Quality**: 将为build scripts创建测试

**结论**: 所有constitution检查通过，无违规项。

## Project Structure

### Documentation (this feature)

```text
specs/001-github-release/
├── plan.md              # 本文件
├── research.md          # 工作流配置研究、平台构建参数
├── data-model.md        # N/A (无数据模型)
├── quickstart.md        # 发布流程快速指南
├── contracts/           # N/A (无API契约)
└── tasks.md             # 任务分解
```

### Source Code (repository root)

```text
.github/
├── workflows/
│   ├── version-check.yml     # 版本变更检测与自动打 tag（使用可选 PAT_TOKEN）
│   ├── release.yml           # 主发布工作流（tag 触发，协调构建+发布）
│   ├── build-desktop.yml     # 桌面平台构建（直接运行 tauri CLI）
│   └── build-mobile.yml      # 移动平台构建（Android/iOS，可选）
└── scripts/
   ├── generate-changelog.js # Changelog 生成脚本（输出当前版本内容用于 Release Notes）
   ├── validate-version.js   # 版本号验证
   └── sync-version.js       # 从 tauri.conf.json 同步版本到各文件

src-tauri/
├── tauri.conf.json          # 配置与版本单一来源
└── Cargo.toml               # 版本同步

package.json                  # 添加发布与校验脚本
```

**Structure Decision**: 

采用GitHub Actions工作流模块化结构：
- 主工作流(`release.yml`)负责协调和Release创建
- 子工作流按平台类型分离（桌面/移动），便于独立测试和维护
- 辅助脚本放在`.github/scripts/`目录，测试放在`tests/release/`
- **所有构建完全通过GitHub Actions自动化执行，无本地构建脚本**

## Phase 0: Research & Design

### Research Areas

1. **Tauri跨平台构建配置**
   - Windows: MSI vs NSIS配置差异
   - macOS: DMG vs App Bundle，代码签名要求
   - Linux: DEB/AppImage/RPM打包参数
   - ARM架构支持：Windows ARM64、macOS Apple Silicon
   - 移动平台：Android Gradle配置、iOS Xcode项目设置

2. **GitHub Actions矩阵策略**
   - 平台矩阵定义（os、arch、target）
   - Runner选择：ubuntu-latest、windows-latest、macos-latest
   - 跨平台依赖安装（Node.js、Rust、Tauri CLI）
   - 缓存策略（cargo、npm缓存）

3. **Changelog自动化方案**
   - conventional commits规范解析
   - commit类型映射（feat → Features, fix → Bug Fixes）
   - 版本范围确定（上一个tag到当前tag）
   - changelog格式模板（Markdown）

4. **敏感信息管理**
   - GitHub Secrets存储签名证书
   - 环境变量注入方式
   - iOS证书和provisioning profile处理
   - Android keystore管理

**输出**: `research.md` - 详细记录各平台构建参数、工作流最佳实践、签名配置方案

### Design Decisions

#### 工作流触发策略
- **版本变更检测**: main 分支上 `src-tauri/tauri.conf.json` 变更 → 运行 `version-check.yml`
   - 同步版本到 `package.json`、`Cargo.toml`、`constants.ts`、`Cargo.lock`
   - 创建并推送版本 tag（优先使用 `PAT_TOKEN`，否则使用 `GITHUB_TOKEN`）
- **主触发器**: 推送符合 `v*.*.*` 模式的标签 → 触发 `release.yml`
- **手动触发**: `workflow_dispatch` 支持手动运行并指定版本
- **分支限制**: 仅 main 分支的标签触发发布

#### 构建矩阵设计
```yaml
strategy:
  matrix:
    platform:
      - os: ubuntu-latest
        target: x86_64-unknown-linux-gnu
        artifact: linux-x64
      - os: windows-latest
        target: x86_64-pc-windows-msvc
        artifact: windows-x64
      - os: macos-latest
        target: x86_64-apple-darwin
        artifact: macos-intel
      - os: macos-latest
        target: aarch64-apple-darwin
        artifact: macos-arm64
```

#### Changelog生成流程
1. 获取上一个版本标签（git describe）
2. 提取commit范围（git log）
3. 按conventional commits解析
4. 分类汇总（Features、Fixes、Breaking Changes）
5. 生成 Markdown，并通过 job outputs 传递“当前版本变更”（而非整个历史）用于 Release Notes
6. 将完整历史写入仓库 `CHANGELOG.md`（新增版本内容追加到顶部）

#### 失败处理策略
- 单个平台失败不阻断其他平台
- 使用`continue-on-error: true`配置
- 汇总结果，创建部分Release并标注失败平台

**输出**: `quickstart.md` - 发布流程操作指南（如何创建标签、触发构建、处理失败）

#### Windows MSI 版本兼容

- Windows MSI 要求预发布标识符为纯数字且 ≤ 65535
- 在 `build-desktop.yml` 的 Windows 任务中自动将 `x.y.z-word.n` 转换为 `x.y.z-n`
- 其他平台保持原始语义化版本（如 `alpha.1`、`beta.2`）

## Phase 1: Implementation - MVP (P1 Platforms)

### User Story 1: 自动构建多平台安装包

**目标**: 实现Windows x64、macOS、Linux平台的自动构建和发布

**任务分解**:

1. **创建主发布工作流**
   - 文件: `.github/workflows/release.yml`
   - 触发条件: 标签推送`v*.*.*`
   - 调用桌面构建子工作流
   - 汇总构建产物
   - 创建GitHub Release

2. **实现桌面平台构建**
   - 文件: `.github/workflows/build-desktop.yml`
   - 矩阵构建: Windows x64、macOS Intel/ARM、Linux
   - 安装依赖: Node.js、Rust、Tauri CLI
   - 执行构建: `pnpm tauri build`
   - 上传artifacts

3. **版本号验证脚本**
   - 文件: `.github/scripts/validate-version.js`
   - 验证tag格式（语义化版本）
   - 检查package.json和tauri.conf.json版本一致性

4. **配置构建参数**
   - 更新`src-tauri/tauri.conf.json`: 配置bundle targets
   - Windows: 同时生成MSI和NSIS
   - macOS: 生成DMG和App Bundle
   - Linux: 生成DEB、AppImage、RPM

5. **配置package.json脚本**
   - 添加版本验证脚本: `pnpm release:validate`
   - 所有构建在GitHub Actions中执行

**测试**:
- 创建测试标签`v0.0.1-test`
- 验证所有P1平台构建成功
- 验证Release页面显示所有安装包
- 下载并安装每个平台的包，验证应用启动

### User Story 2: 自动生成版本说明

**目标**: 根据commit历史生成结构化changelog

**任务分解**:

1. **Changelog生成脚本**
   - 文件: `.github/scripts/generate-changelog.js`
   - 获取commit范围（上一个tag到当前tag）
   - 解析conventional commits格式
   - 按类型分组（Features、Bug Fixes、Breaking Changes）
   - 生成Markdown输出

2. **集成到发布工作流**
   - 在release.yml中调用changelog生成
   - 将changelog作为Release Notes内容
   - 首次发布时处理无上一个tag的情况

3. **Changelog模板**
   - 文件: `.github/scripts/changelog-template.md`
   - 定义输出格式
   - 包含版本号、日期、分类内容

4. **测试用例**
   - 文件: `tests/release/changelog.test.js`
   - 测试commit解析逻辑
   - 测试分类汇总
   - 测试边界情况（无commit、非规范commit）

**测试**:
- 准备多个符合conventional commits的测试commit
- 生成changelog并验证格式
- 验证不同类型commit正确分类
- 验证Release Notes显示完整内容

## Phase 2: Extended Platforms (P3)

### User Story 3: 扩展平台支持

**目标**: 添加Windows ARM64、Android、iOS构建支持

**任务分解**:

1. **Windows ARM64支持**
   - 更新build-desktop.yml矩阵
   - 添加`aarch64-pc-windows-msvc` target
   - 配置ARM64编译参数

2. **移动平台构建工作流**
   - 文件: `.github/workflows/build-mobile.yml`
   - Android构建: 配置Gradle、签名密钥
   - iOS构建: 配置Xcode、证书、provisioning profile

3. **签名密钥管理**
   - 配置GitHub Secrets
   - Android: KEYSTORE_FILE、KEYSTORE_PASSWORD
   - iOS: CERTIFICATE_P12、PROVISIONING_PROFILE

4. **移动平台GitHub Actions集成**
   - 配置Android签名环境变量
   - 配置iOS证书和provisioning profile
   - 所有签名和打包在GitHub Actions中自动处理

**测试**:
- 验证Windows ARM64包生成
- 验证Android APK/AAB签名和可安装性
- 验证iOS IPA可通过TestFlight分发

## Dependencies & Order

1. **Phase 0 (Research)** → 必须首先完成，提供技术决策依据
2. **Phase 1 - US1 (多平台构建)** → 核心功能，阻塞US2和US3
3. **Phase 1 - US2 (Changelog)** → 依赖US1的工作流框架，但可并行开发
4. **Phase 2 - US3 (扩展平台)** → 依赖US1稳定后再扩展

**并行开发建议**:
- US1的工作流框架完成后，US2可并行开发changelog脚本
- US3的移动平台可在US1和US2稳定后独立开发

## Complexity Tracking

> 无constitution违规项，此节为空。

## Risks & Mitigation

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| GitHub Actions构建时间超限 | 超出免费额度 | 优化缓存策略，减少重复构建；考虑付费plan |
| iOS构建需要macOS runner | 成本高（10x计费） | 限制iOS构建频率；考虑使用self-hosted runner |
| 移动平台签名证书管理复杂 | 安全风险、配置困难 | 详细文档化流程；使用GitHub Secrets加密存储 |
| 不同平台构建失败率不一致 | 发布不完整 | 实现部分Release创建；失败平台清晰标注 |
| Conventional commits不规范 | Changelog质量差 | 提供commit规范文档；实现fallback处理 |

## Success Metrics

- [ ] P1平台构建成功率 > 95%
- [ ] 单次发布完成时间 < 15分钟（P1平台）
- [ ] Changelog覆盖率 100%（所有commit）
- [ ] 安装包可用性 100%（下载后可安装启动）
- [ ] 发布流程文档完整性（quickstart.md）
