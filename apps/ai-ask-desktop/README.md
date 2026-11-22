# ai-ask-desktop

Hai fullstack 桌面 workspace：Vite + Svelte 5 Runes + Tauri 2，沿用纯 CSS 和中英日韩消息。

页面在 `src/lib/pages`，HashRouter 从 `src/main.ts` 启动，动态发现路由；资源在 `public`，消息在 `messages/*.json`。原生窗口 URL 为 `index.html#/...`，应用状态与窗口控制仍通过原生 IPC 协调。

从工程根运行 `pnpm tauri dev`，先构建独立 `ai-ask-contract`，再由 Hai 模板 `scripts/run-tauri.mjs` 加载 Core 显示名并启动原生端。构建产物为本包 `dist`，完整打包入口为根 `pnpm build:desktop`。

本包的 typecheck/lint/test 分别检查前端类型、风格和 Vitest 行为；Rust 完整门禁由根 workspace 编排。原生 E2E 通过 `e2e/run-windows.ps1` 隔离数据，不使用用户安装版。

项目规则和所有运行入口见根 [AGENTS.md](../../AGENTS.md) 与 [README](../../README.md)。
