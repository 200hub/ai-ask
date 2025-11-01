# Quick Ask 功能实现进度报告

**日期**: 2025-01-XX  
**分支**: 001-quick-ask  
**状态**: Phase 3 (User Story 2 - 注入功能) 部分完成

## 已完成工作

### ✅ Phase 1: Setup (T001-T006)
- 添加剪贴板插件依赖（前端 + 后端）
- 扩展 AppConfig 和 AIPlatform 类型
- 更新 .gitignore 和 .eslintignore

### ✅ Phase 2: Foundational (T007-T015)
- **Quick Ask Store** (`src/lib/stores/quick-ask.svelte.ts`)
  - Svelte 5 Runes 状态管理：`isOpen`, `question`, `loading`, `error`
  - 自动剪贴板读取功能
  - 方法：`open()`, `close()`, `setQuestion()`, `submit()`
  
- **UI 组件完成**
  - `QuickAsk.svelte`: 问答框 modal，支持 ESC/Ctrl+Enter 快捷键
  - `QuickAskSettings.svelte`: 设置面板，平台单选、语音开关
  
- **注入工具** (`src/lib/utils/injection.ts`)
  - 平台策略定义（ChatGPT, Claude, Gemini）
  - `injectQuestionToPlatform()` 调用后端命令
  
- **国际化 (i18n)**
  - 四语言完整支持：zh-CN, en-US, ja-JP, ko-KR
  - 所有 Quick Ask UI 文案已翻译

- **全局快捷键**
  - Rust 后端注册 Ctrl+Shift+Space (MVP 占位)
  - 触发时发送 'open-quick-ask' 事件
  - 200ms 节流保护

### ✅ Phase 3: User Story 2 - 注入功能架构完成

#### 后端实现 (src-tauri/src/webview.rs)

1. **初始化脚本注入** (ensure_child_webview)
   - 在每个子 webview 创建时自动注入 `window.__quickAskInject` 函数
   - 支持多平台策略（ChatGPT, Claude, Gemini）
   - 自动选择器检测和输入框填充

2. **JS 执行命令** (inject_script_to_child_webview)
   - 新增 Tauri command: `inject_script_to_child_webview`
   - 接受平台 ID 和问题文本
   - 转义特殊字符并调用 `__quickAskInject` 函数
   - 已在 lib.rs 中注册

#### 前端集成 (src/lib/utils/injection.ts)

- `injectQuestionToPlatform()` 现在调用 Tauri backend command
- 使用 `invoke()` API 发送请求到 Rust
- 完整错误处理和日志记录

### ✅ 质量保证

- **类型检查**: `pnpm run check` - 0 errors, 0 warnings ✅
- **代码规范**: `pnpm run lint` - 前端 + Rust 全部通过 ✅
- **测试套件**: `pnpm test` - 39 frontend + 8 Rust tests 全部通过 ✅

---

## 当前架构说明

### 注入流程

```text
1. 用户按 Ctrl+Shift+Space
   ↓
2. Rust 触发 'open-quick-ask' 事件
   ↓
3. 前端显示 QuickAsk modal
   ↓
4. 用户输入问题 + 按 Ctrl+Enter
   ↓
5. 前端调用 quickAskStore.submit()
   ↓
6. 调用 injectQuestionToPlatform(platformId, question)
   ↓
7. invoke('inject_script_to_child_webview', { id, script: question })
   ↓
8. Rust 查找子 webview
   ↓
9. Rust 构造调用 window.__quickAskInject("question")
   ↓
10. with_webview() 访问平台特定 webview
    ↓
11. (当前状态：脚本已生成并记录日志，等待实际 JS 执行)
```

### 初始化脚本内容

在 webview 创建时注入的 `window.__quickAskInject` 函数包含：
- **多策略尝试**: 依次尝试 ChatGPT, Claude, Gemini 的选择器
- **自动填充**: 根据输入框类型（textarea vs contenteditable）设置值
- **事件触发**: 触发 input/change 事件确保 React/Vue 等框架响应
- **自动发送**: 延迟 200ms 后点击发送按钮

---

## 待完成工作

### 高优先级

#### T041-T044: 实际 JS 执行

**问题**: 当前实现中，`with_webview()` 闭包内无法直接执行 JavaScript。

**原因**: Tauri 2 的跨平台 JS 执行需要使用平台特定 API：
- **Windows**: WebView2's ExecuteScript (需要 webview2-com crate)
- **macOS**: WKWebView's evaluateJavaScript (需要 objc2 bindings)
- **Linux**: webkit2gtk's evaluate_javascript (已有 API)

**解决方案选项**:

1. **方案 A: 使用 Tauri 的 window.eval() 变通方案** (推荐)
   - 通过特殊 URL scheme 或 window message 触发
   - 相对简单，跨平台兼容
   
2. **方案 B: 添加平台特定依赖**
   - Windows: 添加 webview2-com
   - macOS: 使用 objc2_web_kit
   - Linux: 使用现有 webkit2gtk
   - 更可靠但复杂度高

3. **方案 C: 使用 ipc:// 协议通信** (最灵活)
   - 注入监听器脚本监听自定义事件
   - 通过 Tauri 事件系统发送命令
   - 需要修改 webview 的 CSP 设置

**推荐行动**: 先尝试方案 A，如不可行再考虑方案 B。

#### T047-T048: 未登录状态检测

- 在注入前检查登录状态
- 显示友好提示并引导用户登录
- 提供"前往登录"跳转功能

#### T050-T051: 平台切换集成

- 注入成功后自动显示目标平台 webview
- 隐藏 Quick Ask modal
- 确保平台 webview 正确接收焦点

### 中优先级

#### T016-T020: 双击 Shift 热键

- 当前使用 Ctrl+Shift+Space 作为 MVP 占位
- 需要实现低级键盘钩子监听双击 Shift
- 阈值默认 400ms（可在设置中调整）

#### T052-T053: 注入脚本单元测试

- 测试占位符替换
- 测试特殊字符转义
- 测试错误处理（NOT_LOGGED_IN 等）

### 低优先级

#### T067-T082: 语音输入功能

- UI 开关已预留
- 需要集成 Web Speech API
- 转写后手动确认再发送

---

## 技术债务

1. **JS 执行方案待定**: 当前 `with_webview()` 内仅记录日志，需实现真正的脚本执行
2. **平台 DOM 验证**: 需要在实际环境中测试各平台的选择器准确性
3. **错误处理增强**: 网络超时、DOM 未找到、平台结构变化等情况的处理
4. **性能监控**: SC-001 (≤300ms), SC-003 (≥95% 成功率) 需要在实际环境中验证

---

## 下一步建议

### 立即行动

1. **启动应用测试初始化脚本**: `pnpm tauri dev`
2. **打开开发工具**: 在子 webview 中检查 `window.__quickAskInject` 是否存在
3. **手动测试注入**: 在控制台执行 `window.__quickAskInject("Test question")`
4. **验证各平台选择器**: ChatGPT, Claude, Gemini 的实际 DOM 结构

### 短期目标 (本周)

- 完成 JS 执行方案选型（方案 A vs B）
- 实现选定方案并验证端到端流程
- 在至少一个平台上测试完整注入链路
- 补充单元测试

### 中期目标 (下周)

- 双击 Shift 热键实现
- 未登录状态检测与友好提示
- 扩展支持更多平台（Llama, Qwen 等）
- 性能优化与成功率监控

---

## 附录：关键文件清单

### 前端

- `src/lib/stores/quick-ask.svelte.ts` - Quick Ask 状态管理
- `src/lib/components/pages/QuickAsk.svelte` - 问答框 UI
- `src/lib/components/settings/QuickAskSettings.svelte` - 设置面板
- `src/lib/utils/injection.ts` - 注入工具与策略

### 后端

- `src-tauri/src/webview.rs` - 子 webview 管理 + 注入命令
- `src-tauri/src/lib.rs` - 快捷键注册 + command 注册

### 配置

- `src/lib/types/config.ts` - AppConfig.quickAsk 字段
- `src/lib/i18n/locales/*.ts` - 四语言 i18n 文本

### 文档

- `specs/001-quick-ask/IMPLEMENTATION_SUMMARY.md` - MVP 完成总结
- `specs/001-quick-ask/tasks.md` - 任务清单 (T001-T095)
- `specs/001-quick-ask/spec.md` - 功能规范
- `specs/001-quick-ask/plan.md` - 实施计划

---

**状态摘要**: 架构完整，等待 JS 执行方案实现以完成端到端流程。基础设施稳定，质量门已通过。
