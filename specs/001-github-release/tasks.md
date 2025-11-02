---
description: "Task list for GitHub自动打包发布 feature implementation"
---

# Tasks: GitHub自动打包发布

**Input**: Design documents from `/specs/001-github-release/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md (N/A), quickstart.md

**Tests**: Tests are NOT included - this is a CI/CD infrastructure feature verified through integration testing.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Repository root structure with CI/CD configuration:
- `.github/workflows/` - GitHub Actions workflows
- `.github/scripts/` - Build and release scripts
- `src-tauri/` - Tauri configuration (existing)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure and prepare configuration files

- [x] T001 Create `.github/workflows/` directory for GitHub Actions workflows
- [x] T002 Create `.github/scripts/` directory for build helper scripts
- [x] T003 [P] ~~Create `scripts/release/` directory for local testing tools~~ (已移除，无需本地构建脚本)
- [x] T004 [P] Update `src-tauri/tauri.conf.json` to configure bundle targets (MSI, NSIS, DMG, DEB, AppImage)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core validation and versioning infrastructure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement version validation script in `.github/scripts/validate-version.js` (checks tag format and version consistency)
- [x] T006 Update `package.json` with release validation script
- [x] T007 Create `version-check.yml` workflow to auto-sync versions and create tags from `src-tauri/tauri.conf.json` changes (uses optional `PAT_TOKEN` to trigger downstream workflows)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 自动构建多平台安装包 (Priority: P1) 🎯 MVP

**Goal**: 实现Windows x64、macOS (Intel/ARM)、Linux平台的自动构建流程，推送git标签自动触发构建并创建GitHub Release

**Independent Test**: 创建测试标签 `v0.0.1-test`，验证所有P1平台构建成功并生成Release，下载各平台安装包验证可安装启动

### Implementation for User Story 1

- [x] T008 [P] [US1] Create main release workflow in `.github/workflows/release.yml` (tag trigger, job orchestration)
- [x] T009 [P] [US1] Create desktop build workflow in `.github/workflows/build-desktop.yml` (matrix: Windows x64, macOS Intel/ARM, Linux)
- [x] T010 [US1] Configure tauri-action in build-desktop.yml with proper caching (Cargo, pnpm)
- [x] T011 [US1] Add platform matrix strategy to build-desktop.yml (os, target, artifact naming)
- [x] T012 [US1] Configure Linux dependencies installation step in build-desktop.yml (webkit2gtk, libgtk-3, etc.)
- [x] T013 [US1] Setup artifact upload steps in build-desktop.yml (separate artifacts per platform)
- [x] T014 [US1] Integrate validation job in release.yml (call validate-version.js script)
- [x] T015 [US1] Add desktop build job orchestration in release.yml (call build-desktop workflow)
- [x] T016 [US1] Implement Release creation job in release.yml (download artifacts, create GitHub Release with `softprops/action-gh-release@v1`)
- [x] T017 [US1] Configure workflow permissions in release.yml (contents: write for Release creation)

**Checkpoint**: 推送测试标签后，所有P1平台（Windows x64、macOS、Linux）构建成功，GitHub Release页面显示所有安装包可下载

---

## Phase 5: User Story 3 - 扩展平台支持 (Priority: P3)

**Goal**: 添加Windows ARM64、Android、iOS平台的构建支持，扩展平台覆盖范围

**Independent Test**: 推送标签后，Release中包含Windows ARM64、Android APK/AAB、iOS IPA的安装包（移动平台需要签名配置）

### Implementation for User Story 3

- [x] T027 [P] [US3] Update desktop build matrix in `.github/workflows/build-desktop.yml` to add Windows ARM64 target (aarch64-pc-windows-msvc)
- [x] T028 [P] [US3] Create mobile build workflow in `.github/workflows/build-mobile.yml` (Android and iOS builds)
- [x] T029 [US3] Configure Android build job in build-mobile.yml (setup Android SDK, Gradle configuration)
- [x] T030 [US3] Configure iOS build job in build-mobile.yml (setup Xcode, certificates, provisioning profiles)
- [x] T031 [US3] Add Android signing configuration in build-mobile.yml (keystore secrets handling)
- [x] T032 [US3] Add iOS signing configuration in build-mobile.yml (certificate and profile secrets handling)
- [x] T033 [US3] Integrate mobile build job in `.github/workflows/release.yml` (call build-mobile workflow with secrets)
- [x] T034 [US3] Update quickstart.md with mobile platform setup instructions (keystore, certificates)

**Checkpoint**: 所有扩展平台（Windows ARM64、Android、iOS）构建成功并上传到Release

---

## Phase 5.1: Platform Specific Polish

- [x] T035a [US1] Add Windows MSI pre-release sanitizer in `build-desktop.yml` (convert `x.y.z-word.n` → `x.y.z-n` during Windows builds)
- [x] T035b [US1] Ensure non-Windows platforms preserve original semantic pre-release tags (alpha/beta/rc)

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 优化、文档完善和质量改进

- [x] T035 [P] Add comprehensive comments to all workflow YAML files for maintainability
- [x] T036 [P] Optimize caching strategy in build workflows (reduce build times for repeated runs)
- [x] T037 [P] Add workflow dispatch manual trigger to release.yml (enable manual releases without tags)
- [x] T038 [P] Document GitHub Secrets setup in quickstart.md (all required secrets with instructions)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - 核心构建流程，无其他故事依赖
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - 依赖US1的工作流框架（release.yml），但可并行开发脚本
- **User Story 3 (P3)**: Depends on US1 completion - 扩展US1的构建矩阵和工作流

### Within Each User Story

**US1 执行顺序**:
1. 先创建工作流文件框架（T008, T009）
2. 再配置具体构建步骤（T010-T013）
3. 最后集成和测试（T014-T017）

**US2 执行顺序**:
1. 先开发脚本逻辑（T018-T023，可并行开发和测试）
2. 再集成到工作流（T024-T026）

**US3 执行顺序**:
1. 先扩展桌面平台（T027，直接修改现有工作流）
2. 再创建移动平台工作流（T028-T034）
3. 最后集成和文档更新（T035-T036）

### Parallel Opportunities

- **Phase 1 Setup**: T003, T004 可并行（不同目录）
- **Phase 2 Foundational**: T006, T007 可并行（不同文件）
- **US1**: T008, T009 可并行创建文件框架
- **US2**: T018, T019 可并行（脚本和模板）
- **US3**: T027, T028 可并行（不同工作流文件）；T033, T034 可并行（不同脚本）
- **Phase 6 Polish**: 大部分任务可并行（不同文件）

---

## Parallel Example: User Story 1

```bash
# 并行创建工作流文件框架:
Task T008: "Create main release workflow in .github/workflows/release.yml"
Task T009: "Create desktop build workflow in .github/workflows/build-desktop.yml"

# 并行配置不同文件:
Task T005: "Implement version validation script in .github/scripts/validate-version.js"
Task T006: "Update package.json with release validation script"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup（目录结构）
2. Complete Phase 2: Foundational（版本验证基础设施）- CRITICAL
3. Complete Phase 3: User Story 1（P1平台自动构建）
4. **STOP and VALIDATE**: 推送测试标签 `v0.0.1-test`，验证所有P1平台构建成功
5. **MVP Ready**: 可发布基础的自动构建功能

### Incremental Delivery

1. **Setup + Foundational** → 基础设施就绪
2. **Add US1 (P1)** → 测试独立功能 → 可立即使用（MVP！）
3. **Add US2 (P2)** → 测试changelog生成 → 提升发布质量
4. **Add US3 (P3)** → 测试扩展平台 → 覆盖更多用户群
5. 每个故事都增加价值而不破坏已有功能

### Parallel Team Strategy

多人协作策略（如果团队规模允许）:

1. 团队一起完成 Setup + Foundational
2. Foundational 完成后：
   - Developer A: User Story 1（桌面平台构建）
   - Developer B: User Story 2（changelog生成，可先开发脚本逻辑）
   - Developer C: User Story 3（需等US1完成后再开始，或提前准备脚本）
3. 各故事独立完成和集成

**推荐顺序**: 
- 单人: US1 → US2 → US3（严格按优先级）
- 双人: US1（A） + US2脚本开发（B并行） → US2集成（B） → US3（A或B）
- 多人: US1（A） + US2（B） + US3准备（C）→ US3集成（C）

---

## Success Metrics (from spec.md)

完成所有任务后，验证以下成功指标：

- [ ] **SC-001**: 推送版本标签后，10分钟内完成所有P1平台（Windows x64、macOS、Linux）的构建并创建Release
- [ ] **SC-002**: Release Notes 自动生成并涵盖关键变更（允许手动补充）
- [ ] **SC-003**: 所有构建产物可以在目标平台上成功安装并启动应用
- [ ] **SC-004**: Release页面清晰展示每个平台的下载选项，用户可以在30秒内找到并下载对应平台的安装包
- [ ] **SC-005**: 支持至少5个目标平台的并行构建（Windows x64、Windows ARM64、macOS、Linux、Android）
- [ ] **SC-006**: 构建失败率低于5%，失败时有清晰的错误提示和重试机制

---

## Notes

- **[P] 标记**: 表示任务操作不同文件，无依赖关系，可并行执行
- **[Story] 标签**: 将任务映射到特定用户故事，便于追溯和独立实现
- **测试策略**: 此功能为CI/CD基础设施，通过集成测试验证（推送测试标签）
- **文件路径**: 所有任务包含明确的文件路径，便于直接实施
- **检查点验证**: 每个用户故事完成后独立验证功能
- **提交频率**: 每完成一个任务或逻辑组提交一次
- **避免事项**: 模糊任务描述、相同文件冲突、跨故事依赖破坏独立性

---

## Quick Reference: File Structure After Implementation

```
.github/
├── workflows/
│   ├── release.yml              # T008 - 主发布工作流（标签触发协调）
│   ├── build-desktop.yml        # T009 - 桌面平台构建（矩阵策略）
│   └── build-mobile.yml         # T028 - 移动平台构建（Android/iOS）
└── scripts/
  ├── validate-version.js      # T005 - 版本号验证
  └── sync-version.js          # 版本同步

src-tauri/
└── tauri.conf.json              # T004 - 更新bundle配置

package.json                      # T006 - 添加发布相关scripts

specs/001-github-release/
├── quickstart.md                # T034, T038 - 使用文档更新
└── tasks.md                     # 本文件
```
