---
description: AI Ask 项目代码全面审查 — 按 P0/P1/P2 优先级输出问题清单与可直接落地的修复代码。
---

# 代码审查与质量提升（AI Ask 项目定制版）

适用项目：**Tauri 2.x + SvelteKit 2 SPA + Svelte 5 Runes**
回复语言：**中文**；日志消息：**英文**；代码注释：**中文**

---

## 0. 必读上下文（每次审查前先加载）

按以下顺序读取并以此为基线：

1. [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md) / [.github/copilot-instructions.md](../copilot-instructions.md) — 架构铁律
2. [src/lib/utils/constants.ts](../../src/lib/utils/constants.ts) — 硬编码值唯一来源
3. [src/lib/styles/base.css](../../src/lib/styles/base.css) — Design Token（CSS 变量）清单
4. [src/lib/i18n/locales/](../../src/lib/i18n/locales/) — 四语言资源
5. [src/lib/utils/childWebview.ts](../../src/lib/utils/childWebview.ts) — 子 WebView 唯一入口
6. [src/lib/utils/logger.ts](../../src/lib/utils/logger.ts) — 日志唯一入口
7. [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) — Tauri 命令注册表

> 任何违反上述铁律的代码，无论功能是否正常，都按 **P0** 处理。

---

## 1. 自动化扫描清单（先跑工具，再读代码）

### 1.1 一键基线

```bash
pnpm test:frontend                # 全部前端单测
pnpm vitest run src/lib/__tests__/i18n-parity.test.ts   # i18n key 一致性
node scripts/check-i18n-parity.mjs # 同上（脚本版）
pnpm run check                    # svelte-check：0 TS 错误
pnpm lint:frontend                # ESLint：0 error 0 warning
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings
cd src-tauri && cargo test
```

### 1.2 必扫违规模式（grep + 文件审阅）

| # | 模式 | 说明 |
|---|---|---|
| 1 | `new WebviewWindow\(` 在 `src/**/*.{ts,svelte}` | **必须**通过 `ChildWebviewProxy` |
| 2 | `from 'svelte/store'`、`writable\(`、`readable\(`、`(?<!\$)derived\(` | 新代码禁止 Svelte 4 stores |
| 3 | `console\.(log\|info\|warn\|error\|debug)` 在 `src/**`（排除测试与 logger.ts） | 必须用 `logger`，且日志英文 |
| 4 | 任意 `tailwind`、`@tailwind`、`@apply` | 项目禁用 CSS 框架 |
| 5 | `:\s*any\b`、`as any\b` | 必须具体类型或 `unknown` + 类型守卫 |
| 6 | `.svelte` 内 `<style>` 块的 `#[0-9a-f]{3,8}\b`、`rgba?\(\s*\d` | 必须使用 base.css 的 CSS 变量 |
| 7 | Rust 生产路径中的 `.unwrap\(\)`、`.expect\(` | 锁/Option/Result 都需安全处理（中毒锁用 `match { Err(p) => p.into_inner() }`） |
| 8 | `catch\s*\([^)]*\)\s*\{\s*\}` | 空 catch 必须加注释或日志 |
| 9 | `data-tauri-drag-region` 所在元素与子按钮 | 子按钮必须有 `-webkit-app-region: no-drag` |
| 10 | 未抽到 `constants.ts` 的魔法数字、URL 字面量、超时毫秒值 | 抽到 `UPPER_SNAKE_CASE` 常量 |

### 1.3 i18n key 一致性

四个 locale 文件 key 集合必须**完全相同**。运行：

```bash
node scripts/check-i18n-parity.mjs
```

或运行单测：`pnpm vitest run src/lib/__tests__/i18n-parity.test.ts`

新增 / 修改 / 删除 key 时，**zh-CN / en-US / ja-JP / ko-KR 四份必须同步更新**。

---

## 2. 业务领域审查重点（AI Ask 特有）

### 2.1 子 WebView 与窗口可见性时序

- **关闭主窗口**两条流程必须保持区分：
  - 用户点关闭：前端 dispatch DOM 事件 `hideAllWebviews` → 隐藏子 WebView → `appWindow.hide()`
  - 托盘 / 快捷键：Rust `emit('hideAllWebviews')` → 前端隐藏子 WebView → Rust 100ms 后再隐藏主窗
- 显示流：Rust 显示主窗 → emit `restoreWebviews` → 前端恢复子 WebView
- 检查每一处 `show_window` / `hide_window` / `toggle_window` 是否同时同步子 WebView 状态

### 2.2 注入模板（injection-templates.ts）

- 选择器变更 / 失效是否有用户可见反馈（`appState.setError`）
- 注入超时 30s（`INJECTION_TIMEOUT_MS`）后必须清理状态、解锁按钮
- 注入到外部网站的脚本中，用户文本必须经过 `JSON.stringify` 转义，禁止字符串拼接

### 2.3 划词工具栏（global_selection.rs / selection_toolbar.rs）

- 多显示器 / DPI 缩放下定位是否正确
- 选区文本最小长度（`MIN_TEXT_LENGTH`）过滤
- 工具栏禁用列表（按应用名）的匹配规则

### 2.4 桌面便签同步（notes-sync.ts / desktop_notes.rs）

- 本地 / 远端冲突合并策略（last-write-wins / 字段级合并）
- 离线模式降级
- bounds（位置 / 尺寸）改动应**只更新本地**而不触发 sync dirty 标记

### 2.5 危险操作必须二次确认

逐一核查：删除便签、清空会话、移除自定义平台、退出登录、卸载更新、重置设置。

---

## 3. 代码规范红线（每条违反 = P0/P1）

### 3.1 Svelte 5 Runes Only（P0）

```ts
// ✅ 正确
class AppState { value = $state(0); }
export const appState = new AppState();

// ❌ 禁止（新代码）
import { writable } from 'svelte/store';
export const value = writable(0);
```

### 3.2 子 WebView 唯一入口（P0）

```ts
// ✅
import { ChildWebviewProxy } from '$lib/utils/childWebview';
const proxy = new ChildWebviewProxy(platformId, url);

// ❌
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
new WebviewWindow(...);
```

### 3.3 日志（P1）

```ts
// ✅
import { logger } from '$lib/utils/logger';
logger.info('Platform enabled', { platformId, enabled });

// ❌
console.log('平台已启用', platformId);  // 同时违反「英文日志」与「禁用 console」
```

### 3.4 i18n（P1）

```ts
// ✅
import { i18n } from '$lib/i18n';
const t = i18n.t;
<button>{t('common.confirm')}</button>

// ❌
<button>确认</button>
{$t('common.confirm')}   // 禁止 store 订阅模式
```

### 3.5 设计 Token（P1）

```css
/* ✅ */
.btn-primary { color: var(--text-on-accent); background: var(--accent-color); }
.danger:hover { background: var(--error-color); }
.modal { box-shadow: var(--shadow-modal); }

/* ❌ */
.btn-primary { color: #fff; background: #3b82f6; }
.danger:hover { background: #ef4444; }
```

> 缺少所需 Token 时，**先在 `base.css` 的 `:root` 与 `.dark` 同时新增**，再在组件中引用。

### 3.6 Rust 安全锁定（P0）

```rust
// ✅ 中毒可恢复
let mut guard = match mutex.lock() {
    Ok(g) => g,
    Err(poisoned) => {
        log::warn!("mutex poisoned, recovering inner state");
        poisoned.into_inner()
    }
};

// ❌
let mut guard = mutex.lock().unwrap();   // 一次中毒，永久 panic
```

### 3.7 空 catch（P1）

```ts
// ✅
try { element.focus(); } catch (_focusErr) { /* ignored: non-critical */ }

// ❌
try { element.focus(); } catch (e) {}
```

### 3.8 Constants（P2）

任何业务逻辑中的数字 / URL / 毫秒数都必须落到 [src/lib/utils/constants.ts](../../src/lib/utils/constants.ts)，命名 `UPPER_SNAKE_CASE`。

---

## 4. 输出格式（强制）

按以下结构输出报告：

### 4.1 顶部摘要表

| 优先级 | 类别 | 数量 | 状态 |
|---|---|---:|---|
| P0 | … | n | ✅ 已修复 / ⏳ 待办 |

### 4.2 每项问题（按优先级排序）

```
[P?] 标题（≤ 20 字）
- 文件：path/to/file.ext:行号
- 现象：…
- 原因：违反 <具体规范条款>
- 修改前：```lang … ```
- 修改后：```lang … ```
- 影响 / 回归点：…
```

### 4.3 末尾验证

必须粘贴以下命令的最终输出（节选末尾即可）：

```text
pnpm test:frontend         → Test Files X passed, Tests Y passed
cd src-tauri && cargo test → test result: ok. N passed
pnpm lint:frontend         → exit 0
cd src-tauri && cargo clippy -- -D warnings → exit 0
node scripts/check-i18n-parity.mjs → ✅ All locales have identical key sets
pnpm run check             → 0 errors
```

---

## 5. 禁止事项（不得在审查中执行）

- ❌ 大规模重构与本次问题无关的代码（YAGNI）
- ❌ 为已有功能补充非必要的注释、类型、抽象
- ❌ 新建 `*.md` 总结性文档（除非用户显式要求）
- ❌ 删除"看似无用"但可能是在制品的代码（先确认）
- ❌ 修改 `package.json` 依赖版本、`tauri.conf.json` 关键配置
- ❌ 引入新的依赖包

## 6. 用户输入

```text
$ARGUMENTS
```
