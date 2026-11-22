# AI Ask

AI Ask 是 Hai Framework `1.0.0-beta.34` fullstack 桌面工程，使用 Tauri 2、Vite 和 Svelte 5 Runes，在独立 Webview 中打开 AI/翻译网站，并提供划词、Markdown 便签与待办便签。

## 工程结构

```text
ai-ask/
├─ apps/
│  └─ ai-ask-desktop/       # Vite + Svelte + Tauri 桌面端
│     ├─ src/lib/pages/     # Hash 路由页面
│     ├─ messages/          # 中英日韩 JSON
│     ├─ public/            # 使用中的公开资源
│     ├─ src-tauri/         # 原生窗口、划词、凭据库、退出保存
│     └─ e2e/               # 原生验收与测试夹具
├─ packages/
│  ├─ ai-ask-contract/      # 共享 schema / typed API，独立构建并导出 dist
│  └─ ai-ask-serv/          # Hai Serv / IAM / Reldb 服务
│     ├─ config/_*.yml     # Core、DB、Cache、IAM、Serv、Reach
│     ├─ src/server/        # 生命周期、procedures、业务服务
│     ├─ messages/          # 密码重置页面文本
│     └─ data/              # 本地运行数据，不提交 Git
├─ scripts/                # Hai 环境与原生构建入口、工程检查
├─ .env / .env.dev / .env.test / .env.prod
├─ hai.json                # Hai build 目标
└─ pnpm-workspace.yaml
```

根目录承担 workspace 编排。桌面端通过独立 `ai-ask-contract` 与 `@h-ai/api-client` 调用服务；服务端使用 Hai YAML Schema 和 `core.module.createRuntime` 管理初始化、失败回滚与关闭。契约不依赖服务端或 Node 初始化代码。

本机持久化、子 Webview、快捷键和系统凭据库由 Tauri 管理；窗口位置留在当前设备。界面继续使用纯 CSS、自定义属性、深浅主题和四语言 `i18n.t()`。

## 开发运行

要求 Node.js 满足 `^22.23.4 || ^24.22.1 || ^26.12.1`、pnpm 12.18.0、Rust stable 与本机 Tauri SDK。Windows 需 C++ 构建工具和 WebView2。

```powershell
pnpm install
pnpm tauri dev
```

根 `tauri` 入口先构建共享契约，再进入桌面 workspace；Vite 由 Tauri 启动，默认端口 1420。只有桌面本地功能时无需启动云端。

需要本机云同步服务时，另开终端运行：

```powershell
pnpm dev:serv
```

开发服务默认 `http://127.0.0.1:1422`，API 为 `/api/v1`。在桌面便签设置中保存完整 API 地址、注册或登录 Hai 账号并启用同步。跨设备使用需部署各设备可达的 HTTPS 服务。

`pnpm dev` 同时启动服务和桌面 Vite，适合不另起 Tauri 的前端开发；不要同时启动两个占用 1420 的 Vite 实例。便签窗口、原生凭据和退出行为须在 Tauri 内验收。

## 配置

公共环境文件提交 Git，私密覆盖放 `.env.local` 或 `.env.<mode>.local`。Hai 的优先级为进程、模式私有、共享私有、模式公共、公共基础、YAML。文件 mode 使用 dev/test/prod，Core 环境值使用 development/test/production。

- `PUBLIC_API_BASE`：桌面可公开的默认 API；生产留空时由用户在设置中指定。
- `HAI_CORE_*`：应用显示名、版本、环境、语言和日志。
- `HAI_DB_DATABASE`：SQLite 路径，相对于 `packages/ai-ask-serv`，默认 `./data/ai-ask.sqlite`。
- `HAI_SERV_*`：HTTP 监听、API 与 CORS；来源白名单为逗号分隔字符串。
- `HAI_IAM_PASSWORDRESET_*` / `HAI_REACH_*`：可选密码重置和 SMTP，私密凭据只在服务端注入。

开发和测试使用单进程 SQLite/内存缓存。`pnpm start` / `start:prod` 运行构建产物并加载 `.env.prod`，生产使用 PostgreSQL 和 Redis，需要按实际部署注入连接地址与私密凭据，不能把开发 SQLite/内存会话当生产配置。完整字段见 [.env.example](.env.example) 和 [服务包说明](packages/ai-ask-serv/README.md)。

## 框架与桌面更新

当前 Hai Framework 为 `1.0.0-beta.35`，适用的工作流和模块技能同步在 `.agents/skills`，项目约束仍以根 `AGENTS.md` 为入口。累计差异、复用依据和验收见 [beta.35 升级记录](docs/framework-upgrade-beta35.md)。

桌面更新采用新版 Hai 模板与官方 Tauri 签名更新插件。自动更新偏好控制后台检查与下载，安装需要用户确认，并先保存所有便签。产品公钥和固定 beta 更新地址已写入正式构建配置，GitHub 签名 Secrets 与公开变量已配置。私钥只用于独立签名步骤，不进入源码或安装包；发布页保留手动下载入口。首次签名发布及旧版本迁移说明见 [自动更新配置](docs/desktop-updates.md)。

Markdown 预览默认阻止外部图片请求，可按当前便签或划词结果手动显示和隐藏；内联图片和原始内容保留。

## 构建与验证

```powershell
pnpm check:workspace  # 结构、版本及依赖边界
pnpm check           # 契约构建、各 workspace 类型检查
pnpm check:i18n      # 四语言 JSON key 一致
pnpm lint            # 工程脚本、各 workspace、Rust fmt/clippy
pnpm test            # 契约、桌面、服务端、Rust
pnpm test:ci         # 版本传播、签名更新产物与发布流水线
pnpm build           # Hai compile 目标，按依赖构建全部 workspace
pnpm build:desktop   # Hai Tauri 桌面打包
```

服务从 `dist/index.js` 启动，前端从桌面 `dist/index.html` 加载；本机辅助页面使用 `index.html#/sticky-note`、`#/toolbar`、`#/toolbar-result`。不依赖 SvelteKit SSR 或开发服务器路径回退。

Windows 原生 E2E 使用独立标识与数据目录：

```powershell
powershell -ExecutionPolicy Bypass -File apps/ai-ask-desktop/e2e/run-windows.ps1
```

根 `package.json` 是发布版本来源，`pnpm version:sync` 同步 workspace、Cargo、应用常量及 Core 配置；`pnpm release:validate` 校验一致性。重构验收结果和未验证边界见 [验证记录](docs/validation-status.md)。

## 数据迁移

本次工程迁移移动源码、配置和静态资源，保留 Tauri 应用标识、本地便签格式及操作系统凭据命名。原服务 `data` 目录随包移动，未删除数据库。

旧 Supabase 账号与 Hai 账号独立，仅存在于旧云端的便签需先通过旧版拉取或由管理员迁出。本地已有便签在首次归属 Hai 账号时重新标记待同步。升级前保留本地数据备份和旧云项目，核对迁移完整性后再处理旧后端。

## 许可证

本项目采用 MIT，见 [LICENSE](LICENSE)。Hai Framework 依赖采用其各自的 Apache-2.0 许可证。
