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
- `tauri-apps/tauri-action@v0`: 一站式Tauri构建和发布
- `actions/checkout`、`actions/setup-node`、`dtolnay/rust-toolchain`: 环境准备
- `Swatinem/rust-cache@v2`: 构建缓存加速
- GitHub Release API (tauri-action内置)

## Technical Context

**Language/Version**: 
- GitHub Actions Workflow YAML
- Shell Script (Bash/PowerShell，用于辅助脚本)
- Node.js 20.x LTS (runner预装，用于可选辅助工具)
- 项目现有技术栈：TypeScript 5.6、Rust 1.70+、Tauri CLI 2.x

**Primary Dependencies** (纯GitHub Actions生态): 
- **actions/checkout@v4**: 代码检出
- **actions/setup-node@v4**: Node.js环境（pnpm需要）
- **dtolnay/rust-toolchain@stable**: Rust工具链安装
- **Swatinem/rust-cache@v2**: Cargo构建缓存
- **tauri-apps/tauri-action@v0**: Tauri构建+Release创建（核心）
- **pnpm/action-setup@v2**: pnpm包管理器（可选，或用corepack）

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
└── workflows/
    └── release.yml          # 🆕 单一发布工作流（使用tauri-action）

src-tauri/
└── tauri.conf.json          # ✏️ 确认bundle配置（已有）

package.json                  # ✏️ 确认版本号（已有）
```

**Structure Decision**: 

采用**单一工作流文件**设计（最简方案）：
- `release.yml`：包含所有步骤（验证、构建、changelog、发布）
- 使用`tauri-apps/tauri-action`一站式解决方案
- 利用GitHub Actions矩阵策略实现多平台并行
- 无需额外脚本文件（逻辑内联在workflow中）

**为什么不拆分子工作流？**
1. 项目规模小，单文件更易维护
2. tauri-action已封装所有构建逻辑（依赖安装、缓存、构建、发布）
3. 避免过度工程化
4. 符合GitHub Actions最佳实践（简单场景用单文件）
5. 减少文件数量，降低维护成本

**为什么不用单独的脚本文件？**
1. Changelog逻辑简单，可内联在workflow的run步骤中
2. 版本验证用shell命令即可完成
3. GitHub runner预装所有必需工具（git、node、jq等）
4. 减少仓库文件，保持简洁

## Phase 0: Research & Design

### ✅ 研究已完成

`research.md`已包含详细技术研究（14,000字），涵盖：
- Tauri跨平台构建配置
- GitHub Actions工作流设计
- 缓存策略
- Changelog自动化方案

### 关键技术决策

#### 1. 使用tauri-action统一方案

**决策**：采用`tauri-apps/tauri-action@v0`作为核心action

**理由**：
- ✅ 官方维护，与Tauri CLI同步更新
- ✅ 内置多平台支持和矩阵构建
- ✅ 集成GitHub Release创建功能
- ✅ 自动处理依赖安装和缓存
- ✅ 支持代码签名配置（iOS/macOS）
- ✅ 一站式解决方案，减少配置复杂度

**替代方案（为什么不用）**：
- ❌ 手动调用`pnpm tauri build`：需要自行处理所有平台差异、依赖安装、缓存逻辑、Release创建
- ❌ 使用多个专用actions组合：增加复杂度，维护困难

**文档**: https://github.com/tauri-apps/tauri-action

#### 2. Changelog生成策略

**决策**：内联shell脚本 + git命令

**理由**：
- ✅ GitHub runner预装git（无需额外依赖）
- ✅ 逻辑简单（< 50行shell脚本）
- ✅ 完全控制格式和分类
- ✅ 符合"仅用GitHub Actions能力"约束

**实现方式**：
```bash
# 获取上一个标签
PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")

# 解析commits并分类
git log $RANGE --pretty=format:"%s" | grep "^feat:" | sed 's/^feat: /- /'
git log $RANGE --pretty=format:"%s" | grep "^fix:" | sed 's/^fix: /- /'
```

**替代方案（为什么不用）**：
- ❌ conventional-changelog-cli：需要npm安装，增加依赖
- ❌ GitHub API commits：速率限制，需要token管理，复杂度高

#### 3. 平台矩阵设计

**决策**：
```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - platform: 'macos-latest'
        args: '--target universal-apple-darwin'
      - platform: 'ubuntu-22.04'
        args: ''
      - platform: 'windows-latest'
        args: ''
```

**理由**：
- ✅ macOS构建Universal Binary（同时支持Intel和ARM）
- ✅ fail-fast: false允许部分平台失败时继续其他平台
- ✅ 使用最新LTS runner版本
- ✅ tauri-action自动处理平台特定配置

#### 4. 触发策略

**决策**：
```yaml
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:
```

**理由**：
- ✅ 标签触发：自动化发布流程
- ✅ 手动触发：支持测试和重试
- ✅ 语义化版本格式约束

**输出文档**: 
- ✅ `research.md`: 技术研究详细文档
- ✅ `quickstart.md`: 发布流程操作指南

## Phase 1: Implementation - MVP (P1 Platforms)

### 实施步骤

#### 步骤1: 创建release.yml工作流

**文件**: `.github/workflows/release.yml`

**核心结构**:
```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  # Job 1: 版本验证
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate Version Format
        run: |
          TAG=${GITHUB_REF#refs/tags/}
          if [[ ! $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "错误：标签格式无效，期望 vX.Y.Z"
            exit 1
          fi
          
  # Job 2: Changelog生成
  changelog:
    runs-on: ubuntu-latest
    needs: validate
    outputs:
      body: ${{ steps.generate.outputs.body }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: generate
        run: |
          PREV=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          RANGE="${PREV:+$PREV..}HEAD"
          {
            echo "body<<EOF"
            echo "## ✨ Features"
            git log $RANGE --pretty=format:"%s" | grep "^feat:" | sed 's/^feat: /- /' || echo "无"
            echo ""
            echo "## 🐛 Bug Fixes"
            git log $RANGE --pretty=format:"%s" | grep "^fix:" | sed 's/^fix: /- /' || echo "无"
            echo "EOF"
          } >> $GITHUB_OUTPUT
          
  # Job 3: 多平台构建和发布
  release:
    needs: [validate, changelog]
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target universal-apple-darwin'
          - platform: 'ubuntu-22.04'
            args: ''
          - platform: 'windows-latest'
            args: ''
    
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
          
      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
          
      - name: Install frontend dependencies
        run: |
          corepack enable
          pnpm install
          
      - name: Build and Release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'AI Ask ${{ github.ref_name }}'
          releaseBody: ${{ needs.changelog.outputs.body }}
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

**关键点**:
1. ✅ 使用tauri-action一站式解决构建和发布
2. ✅ 矩阵策略实现多平台并行
3. ✅ changelog内联生成（无需额外脚本文件）
4. ✅ 版本验证确保格式正确
5. ✅ Rust缓存加速二次构建

#### 步骤2: 验证tauri.conf.json配置

**检查点**:
```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [...],
    "windows": {
      "digestAlgorithm": "sha256"
    },
    "macOS": {
      "minimumSystemVersion": "10.13"
    }
  }
}
```

**Action**: 确认配置已正确（当前配置已包含）

#### 步骤3: 本地测试（可选）

**使用act工具**（如已安装）:
```bash
# 测试工作流语法
act -n

# 模拟标签推送（需要Docker）
act push -e <(echo '{"ref":"refs/tags/v0.0.1-test"}')
```

**或直接推送测试标签**:
```bash
git tag v0.0.1-test
git push origin v0.0.1-test
```

#### 步骤4: 首次发布验证

**验证清单**:
- [ ] GitHub Actions运行成功
- [ ] 3个平台（Windows、macOS、Linux）构建产物全部上传
- [ ] Release Notes包含格式化的changelog
- [ ] 下载文件命名正确（如`AI-Ask_1.0.0_x64_en-US.msi`）
- [ ] 安装包可在目标平台安装并启动应用

#### 步骤5: 文档更新

**更新quickstart.md**:
- 添加实际workflow文件路径
- 更新构建时间预估（基于实际运行数据）
- 补充故障排查案例（如遇到）

## Phase 2: Extended Platforms (P3)

### 扩展平台支持（后续实施）

#### Windows ARM64

**矩阵添加**:
```yaml
- platform: 'windows-latest'
  args: '--target aarch64-pc-windows-msvc'
```

**要求**:
- Rust target: `aarch64-pc-windows-msvc`
- 交叉编译配置
- ARM64设备测试

#### Android/iOS

**Tauri Mobile支持** (Tauri 2.0+):
- Android: 需要Android SDK、签名密钥
- iOS: 需要Xcode、Apple开发者证书

**GitHub Secrets配置**:
- `ANDROID_KEYSTORE`: Base64编码的keystore
- `IOS_CERTIFICATE`: Base64编码的p12证书
- 参考`research.md`的详细配置步骤

**注意**: 移动平台构建复杂度高，建议P1稳定后再实施

## Dependencies & Order

**Phase 0**: ✅ 已完成
- `research.md`: 技术研究文档
- `quickstart.md`: 发布流程指南

**Phase 1**: ⏭️ 待实施（本阶段）
1. 创建`.github/workflows/release.yml`
2. 测试工作流（推送测试标签）
3. 验证构建产物和Release创建
4. 更新文档（基于实际运行结果）

**Phase 2**: 🔮 未来扩展（可选）
- Windows ARM64支持
- Android/iOS构建
- 依赖Phase 1稳定运行

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

## Next Steps

### 当前状态
✅ **Phase 0完成**: 所有研究和设计文档已就绪
- `research.md`: 14,000字技术研究
- `quickstart.md`: 完整发布流程指南
- `plan.md`: 本文件（实施计划）
- 采用纯GitHub Actions方案（tauri-action + 内联脚本）

### 立即行动
⏭️ **Phase 1实施**（预估2-3小时）:
1. 创建`.github/workflows/release.yml`（复制本文档中的YAML配置）
2. 推送测试标签`v0.0.1-test`验证完整流程
3. 检查GitHub Actions运行日志
4. 验证Release创建和构建产物上传
5. 下载安装包测试实际可用性
6. 根据实际运行结果更新quickstart.md

### 后续计划
��� **Phase 2扩展**（可选，P1稳定后）:
- Windows ARM64支持
- Android/iOS移动平台
- 代码签名和公证配置

**准备就绪，可开始实施！使用纯GitHub Actions能力，无第三方依赖。**
