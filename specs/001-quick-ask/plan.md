# Implementation Plan: 快速问答（Quick Ask）

**Branch**: `001-quick-ask` | **Date**: 2025-11-01 | **Spec**: [spec.md](./spec.md)

## Summary

实现全局双击 Shift 热键唤起轻量问答框，自动填充剪贴板内容，发送后隐藏问答框并切换到指定 AI 平台 WebView 查看回答。支持平台单选配置、WebView 脚本注入自动发送、可选语音输入等能力。核心目标是"随时随地、低干扰"地快速获取 AI 回答。

**技术方案**：基于 Tauri 2 + Rust + SvelteKit 2 + Svelte 5 Runes 架构，通过全局键盘钩子监听双击 Shift，创建独立的轻量问答窗口（Tauri WebviewWindow），读取剪贴板并预填，发送时向目标平台子 WebView 注入 JS 脚本自动化提问，可选集成 Web Speech API 实现语音转文字。

## Technical Context

**Language/Version**: 
- **Frontend**: TypeScript 5.6 + Svelte 5 (Runes) + SvelteKit 2 (SPA mode)
- **Backend**: Rust 1.75+ (edition 2021)

**Primary Dependencies**:
- **Tauri Core**: `tauri@2`, `@tauri-apps/api@2`
- **Tauri Plugins**: 
  - `tauri-plugin-global-shortcut@2` (全局热键)
  - `tauri-plugin-store@2` (配置持久化)
  - `tauri-plugin-clipboard-manager@2` (剪贴板，**需新增**)
- **Frontend**: `lucide-svelte` (图标), Web Speech API (语音，浏览器内置)
- **Rust**: `serde`, `serde_json`, `tokio`, `log`, `env_logger`

**Storage**: 
- Tauri Store (JSON) 用于配置持久化（快速问答设置、平台启用状态等）

**Testing**: 
- **Frontend**: Vitest + jsdom
- **Rust**: `cargo test`
- **E2E**: 手动测试（热键、WebView 注入、语音）

**Target Platform**: 
- Windows 10/11, macOS 11+, Linux (X11/Wayland)

**Project Type**: 
- Desktop application (Tauri SPA)

**Performance Goals**:
- 双击 Shift → 问答框可见 ≤300ms (SC-001)
- 剪贴板预填成功率 ≥99% (SC-002)
- WebView 注入并触发发送成功率 ≥95% (SC-003)
- ESC 关闭 ≤100ms (SC-005)

**Constraints**:
- 问答框必须轻量（无头部、边框最小化、半透明背景）
- 不阻塞主窗口 UI
- 支持分阶段扩展平台清单

**Scale/Scope**:
- MVP 支持 3-5 个主流 AI 平台（ChatGPT、Claude、Gemini 等）
- 后续按版本逐步扩展清单

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**检查项**:
- ✅ 遵循现有 Tauri + SvelteKit 架构
- ✅ 使用 Svelte 5 Runes（不引入 Svelte 4 stores）
- ✅ 使用纯 CSS + CSS 自定义属性（不引入 Tailwind）
- ✅ i18n 覆盖所有 UI 文本（四种语言）
- ✅ 使用 `logger` 而非 `console.log`
- ⚠️ **新增依赖**: `tauri-plugin-clipboard-manager` (需评审)
- ⚠️ **新增窗口**: 快速问答独立窗口 (需评审轻量化设计)

**理由说明**:
- **剪贴板插件**: Tauri 2 原生 API 无法直接读取剪贴板文本，需官方插件
- **独立窗口**: 问答框需要全局热键唤起且不干扰主窗口，独立窗口是最佳方案

## Project Structure

### Documentation (this feature)

```text
specs/001-quick-ask/
├── spec.md                      # 功能规范
├── plan.md                      # 本文件 - 实施计划
├── checklists/
│   └── requirements.md          # 规格质量检查清单
└── tasks.md                     # 任务清单 (稍后由 /speckit.tasks 生成)
```

### Source Code (repository root)

```text
src-tauri/
├── src/
│   ├── lib.rs                   # 注册 quick_ask 相关命令
│   ├── quick_ask.rs             # 新增：快速问答模块（热键、窗口管理、注入）
│   └── webview.rs               # 扩展：WebView 注入脚本能力
├── Cargo.toml                   # 新增 tauri-plugin-clipboard-manager 依赖

src/
├── lib/
│   ├── components/
│   │   ├── quick-ask/
│   │   │   ├── QuickAskDialog.svelte     # 新增：问答框 UI 组件
│   │   │   ├── VoiceInput.svelte         # 新增：语音输入组件（可选）
│   │   │   └── ClipboardPreview.svelte   # 新增：剪贴板预览组件
│   │   └── settings/
│   │       └── QuickAskSettings.svelte   # 新增：设置页快速问答配置
│   ├── stores/
│   │   ├── quick-ask.svelte.ts            # 新增：快速问答状态管理
│   │   ├── config.svelte.ts               # 扩展：增加 quickAskHotkey/quickAskPlatform
│   │   └── platforms.svelte.ts            # 扩展：增加 quickAskEnabled 字段
│   ├── utils/
│   │   ├── hotkey.ts                      # 新增：热键注册与双击 Shift 检测
│   │   ├── clipboard.ts                   # 新增：剪贴板读取封装
│   │   ├── injection.ts                   # 新增：平台脚本注入模板
│   │   └── voice.ts                       # 新增：语音识别封装（可选）
│   ├── i18n/
│   │   └── locales/
│   │       ├── zh-CN.json                 # 扩展：快速问答相关文本
│   │       ├── en-US.json
│   │       ├── ja-JP.json
│   │       └── ko-KR.json
│   └── types/
│       ├── config.ts                      # 扩展：QuickAskConfig 接口
│       └── platform.ts                    # 扩展：quickAskEnabled, injectionScript 字段
├── routes/
│   └── quick-ask/
│       └── +page.svelte                   # 新增：问答框路由（独立窗口加载）

tests/
└── lib/
    ├── quick-ask.test.ts                  # 新增：快速问答逻辑单测
    ├── hotkey.test.ts                     # 新增：热键检测逻辑单测
    └── injection.test.ts                  # 新增：注入脚本生成单测
```

**Structure Decision**: 
- 沿用现有单体 SPA 架构（`src/` 前端 + `src-tauri/` 后端）
- 快速问答模块新增独立 Rust 模块 `quick_ask.rs` 与前端 `quick-ask/` 目录
- 复用现有 `webview.rs`、`stores/` 与 i18n 基础设施

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增独立窗口 | 快速问答需全局热键唤起且不干扰主窗口 | 使用主窗口 Modal 无法满足"后台唤起"与"轻量"要求 |
| 新增剪贴板插件 | Tauri 2 原生 API 无直接剪贴板文本读取 | 手动实现跨平台剪贴板访问复杂度过高 |

---

## Architecture Overview

### Components Map

```text
┌─────────────────────────────────────────────────────────────┐
│                     User Interactions                        │
└─────────────────────────────────────────────────────────────┘
                             │
                             ├──► 双击 Shift 热键 (OS Level)
                             │          │
                             │          ▼
┌────────────────────────────┴──────────────────────────────┐
│              Rust Backend (src-tauri/)                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  quick_ask.rs (新增模块)                             │ │
│  │  - register_quick_ask_hotkey()                       │ │
│  │  - open_quick_ask_window()                           │ │
│  │  - close_quick_ask_window()                          │ │
│  │  - inject_question_to_platform()                     │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  webview.rs (扩展)                                    │ │
│  │  - inject_script_to_child_webview()                  │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│           Svelte Frontend (src/)                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  QuickAskDialog.svelte                               │  │
│  │  - 显示输入框、剪贴板预填、语音按钮                  │  │
│  │  - 监听 Enter/ESC 键盘事件                           │  │
│  │  - 调用 inject_question_to_platform()               │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  quick-ask.svelte.ts (Store)                         │  │
│  │  - enabled: boolean (快速问答开关)                    │  │
│  │  - selectedPlatformId: string | null                 │  │
│  │  - hotkeyInterval: number (默认 400ms)               │  │
│  │  - voiceEnabled: boolean                             │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  QuickAskSettings.svelte                             │  │
│  │  - 单选平台列表（radio button）                      │  │
│  │  - 热键时间窗调节                                     │  │
│  │  - 语音输入开关                                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│          Platform Child WebViews (已有)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ChatGPT / Claude / Gemini / ...                     │  │
│  │  - 接收注入脚本                                       │  │
│  │  - 自动填充输入框 + 触发发送按钮                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

**热键触发流程**:
```text
1. OS 检测到双击 Shift (≤400ms 间隔)
2. tauri-plugin-global-shortcut 触发回调
3. Rust quick_ask.rs::open_quick_ask_window()
4. 创建独立 WebviewWindow 加载 /quick-ask 路由
5. 前端 QuickAskDialog.svelte 挂载
6. 调用 Tauri 剪贴板插件读取文本
7. 自动填充 <textarea> 并聚焦
```

**发送与注入流程**:
```text
1. 用户在问答框按 Enter
2. 前端调用 invoke('inject_question_to_platform', { platformId, question })
3. Rust 查找 ChildWebviewManager 中对应平台的 Webview
4. 根据 platformId 选择注入脚本模板 (injection.ts)
5. 调用 webview.evaluate_script() 注入 JS
6. JS 填充平台输入框 + 触发 click 事件
7. 关闭问答框窗口
8. 显示目标平台 child webview
```

**配置持久化流程**:
```text
1. 用户在设置页勾选"快速问答平台"单选
2. 前端 quick-ask.svelte.ts::setSelectedPlatform(id)
3. 调用 storage.ts::updateConfig({ quickAskPlatform: id })
4. Tauri Store 写入 JSON
5. 同步更新 platforms.svelte.ts 中 quickAskEnabled 字段
```

---

## Milestones & Tasks

### Milestone 1: 全局热键 + 轻量问答窗口 (P1 - 核心)

**目标**: 实现双击 Shift → 弹窗 → 输入 → ESC 关闭的基础闭环，验证热键与窗口性能。

**优先级**: P1 (必须)  
**预计时间**: 3-4 天

#### Tasks

**M1.1 注册全局双击 Shift 热键 (Rust)**
- **文件**: `src-tauri/src/quick_ask.rs` (新建)
- **依赖**: 无
- **工作内容**:
  - 新建 `quick_ask.rs` 模块
  - 实现 `register_double_shift_hotkey()` 函数
  - 使用 `tauri-plugin-global-shortcut` 监听单次 Shift
  - 维护时间戳队列检测双击（默认 400ms 阈值）
  - 触发时调用 `open_quick_ask_window()`
- **验收标准**:
  - 任意界面双击 Shift（≤400ms）触发回调
  - 日志记录触发时间戳
  - 误触发率可控（连续单击不触发）
- **预计时间**: 4-6h

**M1.2 创建轻量问答窗口 (Rust)**
- **文件**: `src-tauri/src/quick_ask.rs`
- **依赖**: M1.1
- **工作内容**:
  - 实现 `open_quick_ask_window()` Tauri command
  - 创建 WebviewWindow 加载 `/quick-ask` 路由
  - 设置窗口属性：
    - 无边框 (`decorations: false`)
    - 始终置顶 (`always_on_top: true`)
    - 半透明背景 (`transparent: true`)
    - 居中显示
    - 固定尺寸 (600x120)
  - 实现 `close_quick_ask_window()` command
- **验收标准**:
  - 热键触发后 ≤300ms 窗口可见
  - 窗口位于屏幕中央且置顶
  - ESC 键可快速关闭（≤100ms）
- **预计时间**: 4-6h

**M1.3 问答框 UI 组件 (Svelte)**
- **文件**: 
  - `src/routes/quick-ask/+page.svelte` (新建)
  - `src/lib/components/quick-ask/QuickAskDialog.svelte` (新建)
- **依赖**: M1.2
- **工作内容**:
  - 创建 `/quick-ask` 路由页面
  - 实现 QuickAskDialog 组件：
    - `<textarea>` 输入框（自动聚焦）
    - 监听 `Enter` 键发送
    - 监听 `ESC` 键关闭（调用 Rust command）
    - 简洁样式（纯 CSS，半透明背景，圆角）
  - i18n 文本占位符（placeholder）
- **验收标准**:
  - 窗口打开时自动聚焦输入框
  - ESC 立即关闭窗口
  - Enter 触发发送事件（本阶段仅 console.log）
- **预计时间**: 3-4h

**M1.4 快速问答状态 Store (Svelte)**
- **文件**: `src/lib/stores/quick-ask.svelte.ts` (新建)
- **依赖**: 无
- **工作内容**:
  - 创建 `QuickAskStore` 类（Svelte 5 Runes）
  - 状态字段：
    - `enabled: boolean`
    - `selectedPlatformId: string | null`
    - `hotkeyInterval: number` (默认 400)
    - `voiceEnabled: boolean` (默认 false)
  - 方法：
    - `setSelectedPlatform(id: string)`
    - `setHotkeyInterval(ms: number)`
    - `toggleVoiceEnabled()`
  - 集成 storage.ts 持久化
- **验收标准**:
  - 配置可读写 Tauri Store
  - 响应式更新 UI
- **预计时间**: 2-3h

**M1.5 扩展 config.ts 类型与 i18n**
- **文件**: 
  - `src/lib/types/config.ts`
  - `src/lib/i18n/locales/*.json` (四个语言文件)
- **依赖**: M1.4
- **工作内容**:
  - 扩展 `AppConfig` 接口：
    ```typescript
    quickAsk: {
      enabled: boolean;
      selectedPlatformId: string | null;
      hotkeyInterval: number;
      voiceEnabled: boolean;
    }
    ```
  - 添加 i18n keys：
    - `quickAsk.dialog.placeholder`
    - `quickAsk.dialog.send`
    - `quickAsk.dialog.voiceInput`
    - `quickAsk.settings.title`
    - `quickAsk.settings.selectPlatform`
    - `quickAsk.settings.hotkeyInterval`
  - 四种语言翻译
- **验收标准**:
  - 类型检查通过
  - 所有 UI 文本使用 i18n
- **预计时间**: 2h

**M1.6 单元测试 (热键检测逻辑)**
- **文件**: `src/lib/__tests__/hotkey.test.ts` (新建)
- **依赖**: M1.1
- **工作内容**:
  - 测试双击时间窗判定逻辑
  - 测试边界情况（刚好 400ms、超时、三击）
- **验收标准**:
  - `pnpm test` 通过
- **预计时间**: 1-2h

---

### Milestone 2: 剪贴板预填 + 平台配置 (P2)

**目标**: 实现剪贴板自动预填与设置页平台单选配置。

**优先级**: P2 (高)  
**预计时间**: 2-3 天

#### Tasks

**M2.1 添加剪贴板插件依赖 (Rust)**
- **文件**: `src-tauri/Cargo.toml`
- **依赖**: 无
- **工作内容**:
  - 添加 `tauri-plugin-clipboard-manager = "2"` 到 dependencies
  - 在 `src-tauri/src/lib.rs` 中注册插件：
    ```rust
    .plugin(tauri_plugin_clipboard_manager::init())
    ```
  - 前端安装 `@tauri-apps/plugin-clipboard-manager`
- **验收标准**:
  - `cargo build` 成功
  - `pnpm tauri dev` 无错误
- **预计时间**: 1h

**M2.2 剪贴板读取封装 (Svelte)**
- **文件**: `src/lib/utils/clipboard.ts` (新建)
- **依赖**: M2.1
- **工作内容**:
  - 封装 `readClipboardText(): Promise<string | null>` 函数
  - 调用 Tauri 剪贴板插件 API
  - 错误处理（权限拒绝、空剪贴板）
  - 文本长度限制（8k 字符，超出截断）
- **验收标准**:
  - 剪贴板有文本时正确读取
  - 空剪贴板返回 null
  - 超长文本截断并提示
- **预计时间**: 2-3h

**M2.3 问答框集成剪贴板预填 (Svelte)**
- **文件**: `src/lib/components/quick-ask/QuickAskDialog.svelte`
- **依赖**: M2.2
- **工作内容**:
  - 在组件 `onMount` 中调用 `readClipboardText()`
  - 自动填充 `<textarea>` value
  - 用户可编辑预填内容
  - 显示剪贴板来源提示（可选）
- **验收标准**:
  - 剪贴板有文本时自动预填
  - ≥99% 成功率（SC-002）
  - 用户可编辑或清空
- **预计时间**: 2h

**M2.4 平台单选配置 UI (Svelte)**
- **文件**: `src/lib/components/settings/QuickAskSettings.svelte` (新建)
- **依赖**: M1.4
- **工作内容**:
  - 在设置页新增"快速问答"标签
  - 显示平台列表（radio button 单选）
  - 绑定 `quickAskStore.setSelectedPlatform(id)`
  - 显示当前选中平台
  - 热键时间窗调节（slider 200-1000ms）
- **验收标准**:
  - 单选互斥（同时只能一个平台启用）
  - 配置持久化
  - 切换立即生效
- **预计时间**: 3-4h

**M2.5 扩展 platforms.svelte.ts (Svelte)**
- **文件**: `src/lib/stores/platforms.svelte.ts`
- **依赖**: M2.4
- **工作内容**:
  - 扩展 `AIPlatform` 接口：
    ```typescript
    quickAskEnabled: boolean; // 是否作为快速问答平台
    ```
  - 添加方法：
    - `setQuickAskPlatform(id: string)` (设置唯一启用)
    - `getQuickAskPlatform(): AIPlatform | null`
  - 确保单一平台约束
- **验收标准**:
  - 任一时刻仅一个平台 `quickAskEnabled: true`
  - 切换时旧平台自动失效
- **预计时间**: 2h

**M2.6 单元测试 (剪贴板与配置)**
- **文件**: 
  - `src/lib/__tests__/clipboard.test.ts` (新建)
  - `src/lib/__tests__/quick-ask-store.test.ts` (新建)
- **依赖**: M2.2, M2.5
- **工作内容**:
  - 测试剪贴板读取边界（空、超长、特殊字符）
  - 测试平台单选互斥逻辑
- **验收标准**:
  - `pnpm test` 通过
- **预计时间**: 2h

---

### Milestone 3: WebView 注入与自动发送 (P2 - 核心)

**目标**: 实现向目标平台 WebView 注入脚本并自动填充+发送。

**优先级**: P2 (高)  
**预计时间**: 4-5 天

#### Tasks

**M3.1 注入脚本模板设计 (Svelte)**
- **文件**: `src/lib/utils/injection.ts` (新建)
- **依赖**: 无
- **工作内容**:
  - 定义 `PlatformInjectionScript` 接口：
    ```typescript
    interface PlatformInjectionScript {
      platformId: string;
      inputSelector: string;      // 输入框 CSS 选择器
      submitSelector: string;      // 发送按钮选择器
      waitForReady?: string;       // 等待页面就绪的选择器（可选）
    }
    ```
  - 实现 `generateInjectionScript(platform: PlatformInjectionScript, question: string): string`
  - 初始化 MVP 平台脚本模板：
    - ChatGPT: `#prompt-textarea`, `button[data-testid="send-button"]`
    - Claude: `div[contenteditable="true"]`, `button[aria-label="Send"]`
    - Gemini: `textarea.query`, `button.send-button`
  - 脚本逻辑：
    1. 等待输入框就绪（轮询或 MutationObserver）
    2. 填充文本（textarea.value 或 contentEditable.innerText）
    3. 触发 input/change 事件
    4. 点击发送按钮
    5. 返回执行结果（成功/失败/元素未找到）
- **验收标准**:
  - 生成的 JS 脚本语法正确
  - 包含错误处理与超时机制
- **预计时间**: 4-6h

**M3.2 Rust 注入命令实现 (Rust)**
- **文件**: 
  - `src-tauri/src/quick_ask.rs`
  - `src-tauri/src/webview.rs` (扩展)
- **依赖**: M3.1
- **工作内容**:
  - 在 `webview.rs` 新增：
    ```rust
    pub async fn inject_script_to_child_webview(
        state: State<'_, ChildWebviewManager>,
        payload: InjectScriptPayload,
    ) -> Result<String, String>
    ```
  - 查找 `ChildWebviewManager` 中对应 `platformId` 的 Webview
  - 调用 `webview.evaluate_script(script)` 执行注入
  - 返回执行结果（JS 返回值）
  - 在 `quick_ask.rs` 实现：
    ```rust
    #[tauri::command]
    pub async fn inject_question_to_platform(
        window: Window,
        state: State<'_, ChildWebviewManager>,
        platform_id: String,
        question: String,
    ) -> Result<(), String>
    ```
  - 流程：
    1. 根据 `platform_id` 获取注入脚本模板（从前端传递）
    2. 替换 `{{QUESTION}}` 占位符
    3. 调用 `inject_script_to_child_webview()`
    4. 检查返回结果（失败时记录日志）
- **验收标准**:
  - 脚本成功注入到目标 WebView
  - 输入框填充并触发发送
  - 错误时返回清晰错误信息
- **预计时间**: 6-8h

**M3.3 前端集成注入调用 (Svelte)**
- **文件**: `src/lib/components/quick-ask/QuickAskDialog.svelte`
- **依赖**: M3.2
- **工作内容**:
  - 在 Enter 键监听中：
    1. 调用 `invoke('inject_question_to_platform', { platformId, question })`
    2. 等待结果（≤3s 超时）
    3. 成功：关闭问答框，调用 `show_child_webview({ id: platformId })`
    4. 失败：显示错误提示（toast 或内联消息）
  - 集成 `appState.setError()` 显示错误
- **验收标准**:
  - 发送后问答框隐藏
  - 目标平台 WebView 显示
  - 注入成功率 ≥95% (SC-003)
- **预计时间**: 3-4h

**M3.4 登录状态检测与提示 (Rust + Svelte)**
- **文件**: `src-tauri/src/quick_ask.rs`
- **依赖**: M3.2
- **工作内容**:
  - 注入前检测页面是否包含登录按钮（通过选择器）
  - 未登录时返回特定错误码：`NOT_LOGGED_IN`
  - 前端显示友好提示："请先登录 [平台名]"
  - 提供"前往登录"按钮（打开主窗口并切换到该平台）
- **验收标准**:
  - 未登录时不尝试注入
  - 用户可跳转登录
- **预计时间**: 3-4h

**M3.5 注入脚本生成单元测试 (Svelte)**
- **文件**: `src/lib/__tests__/injection.test.ts` (新建)
- **依赖**: M3.1
- **工作内容**:
  - 测试 `generateInjectionScript()` 输出
  - 测试占位符替换
  - 测试特殊字符转义（引号、换行）
- **验收标准**:
  - `pnpm test` 通过
- **预计时间**: 2h

**M3.6 集成测试 (手动)**
- **依赖**: M3.3, M3.4
- **工作内容**:
  - 手动测试 3-5 个主流平台
  - 验证注入成功率
  - 验证登录状态检测
  - 记录失败案例并优化选择器
- **验收标准**:
  - 受支持清单内平台 ≥95% 成功率
- **预计时间**: 4-6h

---

### Milestone 4: 语音输入 (P4 - 可选)

**目标**: 集成 Web Speech API 实现语音转文字。

**优先级**: P4 (低)  
**预计时间**: 2-3 天

#### Tasks

**M4.1 语音识别封装 (Svelte)**
- **文件**: `src/lib/utils/voice.ts` (新建)
- **依赖**: 无
- **工作内容**:
  - 封装 `SpeechRecognition` API：
    ```typescript
    class VoiceRecognition {
      start(): Promise<void>
      stop(): Promise<string>
      on(event: 'result' | 'error', handler: Function)
    }
    ```
  - 检测浏览器支持（fallback 提示）
  - 请求麦克风权限
  - 实时转写或结束后返回文本
- **验收标准**:
  - 麦克风权限正常授予
  - 识别文本准确率 ≥80%
- **预计时间**: 4-6h

**M4.2 语音输入 UI 组件 (Svelte)**
- **文件**: `src/lib/components/quick-ask/VoiceInput.svelte` (新建)
- **依赖**: M4.1
- **工作内容**:
  - 麦克风按钮（Lucide icon）
  - 录音中动画（波形或脉冲）
  - 停止按钮
  - 错误提示（权限拒绝、不支持）
- **验收标准**:
  - 点击开始录音
  - 再次点击停止并回填文本到 textarea
- **预计时间**: 3-4h

**M4.3 集成到问答框 (Svelte)**
- **文件**: `src/lib/components/quick-ask/QuickAskDialog.svelte`
- **依赖**: M4.2
- **工作内容**:
  - 在输入框右侧添加语音按钮
  - 绑定 `VoiceInput` 组件
  - 识别完成后自动填充 textarea
  - 用户确认后 Enter 发送
- **验收标准**:
  - 语音转写文本可编辑
  - 不自动发送（手动确认）
- **预计时间**: 2h

**M4.4 设置页语音开关 (Svelte)**
- **文件**: `src/lib/components/settings/QuickAskSettings.svelte`
- **依赖**: M1.4
- **工作内容**:
  - 添加"启用语音输入"开关
  - 绑定 `quickAskStore.voiceEnabled`
  - 关闭时隐藏语音按钮
- **验收标准**:
  - 开关切换生效
- **预计时间**: 1h

**M4.5 语音权限错误处理 (Svelte)**
- **文件**: `src/lib/utils/voice.ts`
- **依赖**: M4.1
- **工作内容**:
  - 权限拒绝时显示提示
  - 不支持时显示兼容性提示
  - 识别失败时回退到文本输入
- **验收标准**:
  - 错误提示清晰
  - 不阻塞主流程
- **预计时间**: 2h

---

### Milestone 5: 完善与发布 (P3)

**目标**: 代码质量保证、文档补充、E2E 测试。

**优先级**: P3 (中)  
**预计时间**: 2-3 天

#### Tasks

**M5.1 Rust 代码质量检查**
- **工作内容**:
  - `cargo fmt`
  - `cargo clippy -- -D warnings`
  - 修复所有 warnings
- **预计时间**: 1-2h

**M5.2 前端代码质量检查**
- **工作内容**:
  - `pnpm lint`
  - `pnpm run check`
  - 修复类型错误与 lint 问题
- **预计时间**: 1-2h

**M5.3 全量单元测试运行**
- **工作内容**:
  - `pnpm test` 确保所有测试通过
  - 覆盖率检查（目标 ≥70%）
- **预计时间**: 1h

**M5.4 E2E 手动测试**
- **工作内容**:
  - Windows/macOS/Linux 三平台测试
  - 验证所有 Success Criteria (SC-001 ~ SC-006)
  - 记录性能指标
- **预计时间**: 4-6h

**M5.5 更新用户文档**
- **文件**: `README.md`, `specs/001-quick-ask/quickstart.md` (新建)
- **工作内容**:
  - 快速问答使用指南
  - 设置步骤
  - 支持平台清单
  - 常见问题 FAQ
- **预计时间**: 2-3h

**M5.6 PR 准备与 Review**
- **工作内容**:
  - 提交前自查 checklist
  - 撰写 PR 描述
  - 请求 Code Review
- **预计时间**: 1-2h

---

## Dependencies & Risks

### Technical Dependencies

**新增依赖**:
1. `tauri-plugin-clipboard-manager@2` (Rust + JS)
   - **风险**: 跨平台兼容性（Wayland 剪贴板限制）
   - **缓解**: 提前测试 Linux 各桌面环境

**现有依赖扩展**:
1. `tauri-plugin-global-shortcut@2`
   - **风险**: 双击 Shift 检测可能与 OS 快捷键冲突
   - **缓解**: 提供备用热键配置（Ctrl+Shift+Q）

### External Risks

1. **平台 DOM 结构变化**
   - **影响**: 注入脚本失效
   - **概率**: 中
   - **缓解**: 
     - 提供脚本更新机制（配置文件）
     - 记录失败日志供用户反馈
     - 分阶段扩展清单

2. **CSP 限制脚本注入**
   - **影响**: 部分平台无法注入
   - **概率**: 低
   - **缓解**: 
     - 在 MVP 测试中提前验证
     - 不支持的平台标记并排除清单

3. **语音识别浏览器兼容性**
   - **影响**: 部分平台不支持 Web Speech API
   - **概率**: 中
   - **缓解**: 
     - 检测支持并降级提示
     - 标记为"可选"功能

### Implementation Risks

1. **热键性能 (SC-001: ≤300ms)**
   - **风险**: 窗口创建耗时超标
   - **缓解**: 
     - 预加载问答框路由
     - 使用轻量 DOM（避免重渲染）

2. **注入成功率 (SC-003: ≥95%)**
   - **风险**: 平台登录状态、网络延迟导致失败
   - **缓解**: 
     - 增加重试机制（3次）
     - 超时时间宽裕（5s）
     - 清晰错误提示

---

## Acceptance Criteria

基于规范中的 Success Criteria (SC-001 ~ SC-006)：

### Performance Criteria

- **SC-001**: 双击 Shift → 问答框可见 ≤300ms (≥95% 情况)
  - **验证**: 使用性能监控工具记录 100 次触发
- **SC-002**: 剪贴板预填成功率 ≥99%
  - **验证**: 自动化测试 + 手动测试各 50 次
- **SC-003**: 注入并触发发送成功率 ≥95% (受支持清单)
  - **验证**: 每个平台测试 20 次发送
- **SC-004**: 唤起到首个可读答案中位用时 ≤10s
  - **验证**: 记录 50 次完整流程时间
- **SC-005**: ESC → 关闭 ≤100ms
  - **验证**: 性能测试 50 次关闭操作
- **SC-006**: 单一平台约束 ≥99%
  - **验证**: 自动化测试切换 100 次

### Functional Criteria

- 全局热键在任意应用下生效
- 剪贴板内容正确预填（包括空、超长、特殊字符）
- 设置页平台单选互斥
- 注入后平台页面正确接收文本并发送
- 未登录时友好提示
- 语音转写准确且可编辑
- 所有 UI 文本 i18n 覆盖

### Quality Criteria

- `pnpm lint` 无错误
- `pnpm test` 全部通过
- `cargo clippy` 无 warnings
- 代码覆盖率 ≥70%

---

## Next Steps

1. **开始实施**: 按 Milestone 顺序执行任务
2. **每日同步**: 记录进度与阻塞问题
3. **里程碑验收**: 每完成一个 Milestone 进行验收测试
4. **持续集成**: 每次 commit 触发 lint + test
5. **PR Review**: M5 完成后提交 Pull Request

---

## Notes

- **MVP 平台清单** (初始支持):
  - ChatGPT (OpenAI)
  - Claude (Anthropic)
  - Gemini (Google)
  - 可扩展：Llama, Qwen, 等

- **后续扩展**:
  - 历史记录/草稿持久化
  - 多轮对话上下文
  - 自定义注入脚本配置
  - 问答框主题自定义

- **参考资源**:
  - Tauri 全局快捷键文档: https://v2.tauri.app/plugin/global-shortcut/
  - Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
  - Tauri 剪贴板插件: https://v2.tauri.app/plugin/clipboard-manager/
