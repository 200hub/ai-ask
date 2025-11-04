# Tasks: 版本检查与自动更新

**Input**: Design documents from `C:\workspaces\200hub\ai-ask\specs\001-auto-update`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared config, i18n, and type scaffolding. Reuse existing stack; add only minimal essentials.

- [X] T001 Add i18n keys (zh-CN) in C:\workspaces\200hub\ai-ask\src\lib\i18n\locales\zh-CN.ts
- [X] T002 [P] Add i18n keys (en-US) in C:\workspaces\200hub\ai-ask\src\lib\i18n\locales\en-US.ts
- [X] T003 [P] Add i18n keys (ja-JP) in C:\workspaces\200hub\ai-ask\src\lib\i18n\locales\ja-JP.ts
- [X] T004 [P] Add i18n keys (ko-KR) in C:\workspaces\200hub\ai-ask\src\lib\i18n\locales\ko-KR.ts
- [X] T005 Add config flag autoUpdateEnabled with persistence in C:\workspaces\200hub\ai-ask\src\lib\stores\config.svelte.ts
- [X] T006 [P] Add update types (VersionInfo, ReleaseAsset, DownloadTask) in C:\workspaces\200hub\ai-ask\src\lib\types\update.ts
- [X] T007 [P] Add update IPC wrapper utilities in C:\workspaces\200hub\ai-ask\src\lib\utils\update.ts
- [X] T008 Define update event constants in C:\workspaces\200hub\ai-ask\src\lib\utils\constants.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core backend + wiring required by all stories. Must finish before story work.

- [X] T009 Create backend module skeleton with Tauri commands in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T010 Register update commands and spawn startup check in C:\workspaces\200hub\ai-ask\src-tauri\src\lib.rs
- [X] T011 [P] Implement semantic version compare utility in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T012 [P] Configure HTTP client with app proxy settings in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs (reuse C:\workspaces\200hub\ai-ask\src-tauri\src\proxy.rs helpers)
- [X] T013 [P] Frontend startup listener: handle update:available/update:downloaded events in C:\workspaces\200hub\ai-ask\src\lib\stores\app.svelte.ts
- [X] T014 [P] Settings UI: add toggle for auto update in C:\workspaces\200hub\ai-ask\src\lib\components\settings\GeneralSettings.svelte

**Checkpoint**: Foundation ready — user stories can proceed.

---

## Phase 3: User Story 1 - 启动检查并提示升级（未开启自动更新） (Priority: P1) 🎯 MVP

**Goal**: On startup, check for update; if available and auto-update is OFF, show Header banner. Clicking downloads package; on completion, prompt to restart and install on next launch.

**Independent Test**: Disable auto-update; simulate a higher release; verify banner -> download -> ready-to-restart -> restart triggers scheduled install on next launch.

### Implementation for User Story 1

- [X] T015 [US1] Header banner: show update.available prompt with button in C:\workspaces\200hub\ai-ask\src\lib\components\layout\Header.svelte
- [X] T016 [P] [US1] Create reusable UpdateBanner component in C:\workspaces\200hub\ai-ask\src\lib\components\common\UpdateBanner.svelte
- [X] T017 [US1] Wire banner click to update.download IPC via C:\workspaces\200hub\ai-ask\src\lib\utils\update.ts
- [X] T018 [US1] On download complete, show update.readyToRestart and call scheduleInstall in C:\workspaces\200hub\ai-ask\src\lib\utils\update.ts
- [X] T019 [US1] Add restart action using existing APIs in C:\workspaces\200hub\ai-ask\src\lib\components\common\UpdateBanner.svelte
- [X] T020 [US1] Backend: implement check_update to fetch latest stable release in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T021 [US1] Backend: implement download_update to download selected asset in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T022 [US1] Backend: emit update:available and update:downloaded events in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T023 [US1] Logging: structured logs for check/download in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs

**Checkpoint**: US1 delivers a fully testable manual download + restart flow.

---

## Phase 4: User Story 2 - 启动检查并自动下载（已开启自动更新） (Priority: P1)

**Goal**: With auto-update ON, automatically download available update on startup; then prompt for restart to install.

**Independent Test**: Enable auto-update; simulate newer release; verify auto download, then ready-to-restart prompt.

### Implementation for User Story 2

- [X] T024 [US2] Backend: on startup check, auto-start download when autoUpdateEnabled=true in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T025 [P] [US2] Frontend: show update.downloading non-blocking status in C:\workspaces\200hub\ai-ask\src\lib\components\common\UpdateBanner.svelte
- [X] T026 [US2] Frontend: ready-to-restart prompt after auto-download in C:\workspaces\200hub\ai-ask\src\lib\components\layout\Header.svelte
- [X] T027 [US2] Logging: trace auto-download decisions in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs

---

## Phase 5: User Story 3 - 代理环境下检查与下载 (Priority: P2)

**Goal**: All HTTP requests for checking/downloading respect app-level proxy settings.

**Independent Test**: Configure app proxy; confirm both check and download succeed through proxy; disable direct network to confirm reliance on proxy.

### Implementation for User Story 3

- [X] T028 [US3] Backend: build reqwest client using proxy from store in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs (reuse C:\workspaces\200hub\ai-ask\src-tauri\src\proxy.rs)
- [X] T029 [P] [US3] Add unit test for proxy client builder in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T030 [US3] Frontend: ensure proxy settings persisted via C:\workspaces\200hub\ai-ask\src\lib\components\settings\ProxySettings.svelte

---

## Phase 6: User Story 4 - 平台匹配与安装 (Priority: P2)

**Goal**: Select assets matching current OS/arch (Windows x64/ARM, macOS, Linux). On Android/iOS, show availability prompt and link to store/download page (no in-app install).

**Independent Test**: On different platforms/architectures, verify correct asset selection; on mobile builds, verify prompt and link behavior.

### Implementation for User Story 4

- [X] T031 [US4] Backend: implement asset filter (platform/arch mapping) in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T032 [P] [US4] Backend: ignore prerelease by default; allow flag for future in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T033 [US4] Frontend: mobile prompt & link handling in C:\workspaces\200hub\ai-ask\src\lib\components\common\UpdateBanner.svelte
- [X] T034 [US4] Backend: schedule install on next restart for desktop in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs

---

## Phase 7: User Story 5 - 无更新与失败降级 (Priority: P3)

**Goal**: If no update or on failures, do not show intrusive prompts; log errors and retry on next launch.

**Independent Test**: Simulate no update, network errors, rate limits; verify silent behavior with logs and retry next launch.

### Implementation for User Story 5

- [X] T035 [US5] Backend: handle no-update path (no UI) in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T036 [P] [US5] Backend: error capture + categorized logs in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs
- [X] T037 [US5] Frontend: optional lightweight toast for check-failed state in C:\workspaces\200hub\ai-ask\src\lib\components\layout\Header.svelte
- [X] T038 [US5] Restart-time installer + failure message in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs

---

## Phase N: Polish & Cross-Cutting Concerns

- [X] T039 [P] Documentation: update quickstart with proxy/edge cases in C:\workspaces\200hub\ai-ask\specs\001-auto-update\quickstart.md
- [X] T040 Code cleanup and comments across C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs and C:\workspaces\200hub\ai-ask\src\lib\utils\update.ts
- [X] T041 [P] i18n review for all new keys in C:\workspaces\200hub\ai-ask\src\lib\i18n\locales\*
- [X] T042 Performance: ensure startup check completes <10s (logs) in C:\workspaces\200hub\ai-ask\src-tauri\src\update.rs

---

## Dependencies & Execution Order

### Phase Dependencies
- Setup (Phase 1): none
- Foundational (Phase 2): depends on Setup; blocks all stories
- User Stories (Phase 3+): depend on Phase 2

### User Story Order (Priority)
- P1: US1 (manual), US2 (auto)
- P2: US3 (proxy), US4 (platform)
- P3: US5 (fallback)

### Parallel Opportunities
- [P] marked tasks in Setup and Foundational can run concurrently
- After Phase 2, US1/US2 can proceed in parallel by different owners
- Within US1/US2, frontend and backend tasks marked [P] can proceed in parallel

## MVP Scope
- Deliver Phase 3 (US1) only: manual update flow (check → prompt → download → ready-to-restart → install on next launch)

## Format Validation
- All tasks follow: `- [ ] T### [P?] [USn?] Description with file path`
- File paths are absolute; user story labels included for story phases
