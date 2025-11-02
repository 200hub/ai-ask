# Feature Specification: GitHub自动打包发布

**Feature Branch**: `001-github-release`  
**Created**: 2025-11-01  
**Status**: Draft  
**Input**: User description: "添加github打包发布功能。自动给出不同版本的说明并打包windows(x64、arm) macos linux android ios等不同平台的包，提供下载。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 自动构建多平台安装包 (Priority: P1)

当开发者推送新的git标签时，GitHub Actions自动构建所有平台的安装包并创建GitHub Release，用户可以直接从Releases页面下载对应平台的安装包。

**Why this priority**: 这是核心功能，提供基础的CI/CD能力。没有这个功能，其他功能都无法实现。

**Independent Test**: 开发者创建并推送一个新的版本标签（如v1.0.1），系统自动触发构建流程，在GitHub Releases页面生成包含Windows(x64)、macOS、Linux安装包的发布版本。

**Acceptance Scenarios**:

1. **Given** 项目有新的代码提交，**When** 开发者创建并推送git标签（v1.0.0），**Then** GitHub Actions自动触发构建流程
2. **Given** 构建流程已触发，**When** 所有平台构建完成，**Then** 自动创建GitHub Release并上传所有构建产物
3. **Given** Release已创建，**When** 用户访问GitHub Releases页面，**Then** 可以看到并下载Windows MSI/NSIS、macOS DMG/App、Linux DEB/AppImage安装包

---

### User Story 2 - 自动生成版本说明 (Priority: P2)

系统根据两个版本之间的git commit历史自动生成changelog，并将其作为Release Notes发布到GitHub Release中。

**Why this priority**: 提升发布质量和用户体验，让用户了解每个版本的更新内容。

**Independent Test**: 推送新标签后，生成的Release包含从上一个标签到当前标签之间所有commit的格式化changelog。

**Acceptance Scenarios**:

1. **Given** 项目有多个commit，**When** 创建新的Release，**Then** 系统自动提取commit信息并生成结构化的changelog
2. **Given** changelog已生成，**When** 访问Release页面，**Then** 可以看到按类别分组的更新内容（Features、Bug Fixes、Breaking Changes等）
3. **Given** 没有上一个标签，**When** 创建第一个Release，**Then** 生成包含所有重要commit的初始版本说明

---

### User Story 3 - 扩展平台支持（ARM架构和移动端） (Priority: P3)

除了基础的x64平台外，支持Windows ARM64、Android、iOS平台的构建和发布。

**Why this priority**: 扩展平台覆盖范围，但不是MVP所必需。可以在基础功能稳定后再添加。

**Independent Test**: 推送标签后，Release中包含Windows ARM64、Android APK/AAB、iOS IPA的安装包。

**Acceptance Scenarios**:

1. **Given** 支持ARM架构，**When** 触发构建，**Then** 生成Windows ARM64版本的安装包
2. **Given** 支持移动平台，**When** 触发构建，**Then** 生成Android APK/AAB和iOS IPA（需要签名配置）
3. **Given** 所有平台构建完成，**When** 访问Release页面，**Then** 可以看到所有平台的下载选项

---

### Edge Cases

- 当构建过程中某个平台失败时，其他平台是否继续？是否创建部分Release？
- 如何处理没有commit信息或commit信息不规范的情况？
- 如何处理版本标签格式不正确的情况（如非语义化版本）？
- 移动平台构建需要签名证书和密钥，如何安全管理这些敏感信息？
- 如何处理构建超时或资源不足的情况？

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须在git标签推送时自动触发GitHub Actions工作流
- **FR-002**: 系统必须支持构建Windows x64平台的MSI和NSIS安装包
- **FR-003**: 系统必须支持构建macOS平台的DMG和App Bundle
- **FR-004**: 系统必须支持构建Linux平台的DEB、AppImage、RPM包
- **FR-005**: 系统必须将所有构建产物自动上传到GitHub Release
- **FR-006**: 系统必须从git commit历史自动生成版本更新说明
- **FR-007**: 系统必须使用conventional commits格式解析commit信息（feat:, fix:, breaking:等）
- **FR-008**: 系统必须在Release Notes中按类别组织更新内容
- **FR-009**: 系统必须支持Windows ARM64架构的构建（P3优先级）
- **FR-010**: 系统必须支持Android平台的APK/AAB构建（P3优先级）
- **FR-011**: 系统必须支持iOS平台的IPA构建（P3优先级，需要Apple开发者证书）
- **FR-012**: 系统必须验证版本标签格式符合语义化版本规范（vX.Y.Z）
- **FR-013**: 系统必须在构建失败时提供清晰的错误信息和日志
- **FR-014**: 系统必须支持手动触发构建流程（不依赖标签推送）

### Key Entities

- **GitHub Release**: 包含版本号、发布日期、changelog、构建产物的发布实体
- **Build Artifact**: 特定平台的安装包文件，包含平台标识、架构、文件类型等元数据
- **Changelog Entry**: 单个commit或功能变更的描述，包含类型（feature/bugfix/breaking）、描述、作者信息
- **Version Tag**: 遵循语义化版本的git标签，触发构建流程的入口

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 推送版本标签后，10分钟内完成所有P1平台（Windows x64、macOS、Linux）的构建并创建Release
- **SC-002**: 自动生成的changelog覆盖两个版本之间100%的commit信息
- **SC-003**: 所有构建产物可以在目标平台上成功安装并启动应用
- **SC-004**: Release页面清晰展示每个平台的下载选项，用户可以在30秒内找到并下载对应平台的安装包
- **SC-005**: 支持至少5个目标平台的并行构建（Windows x64、Windows ARM64、macOS、Linux、Android）
- **SC-006**: 构建失败率低于5%，失败时有清晰的错误提示和重试机制
