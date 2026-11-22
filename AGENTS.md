# AI Ask 工程规范

请用中文沟通；代码注释中文、日志英文。工程采用 Hai fullstack 桌面布局，不再使用 SvelteKit。

## Hai 工作流

框架依赖和 `.agents/skills/` 同步到 `1.0.0-beta.35`；来源记录在 `.agents/hai-framework.json`。先按任务读取对应入口及相邻参考，不加载整个技能树；本项目的实际业务规则和用户明确授权优先于模板初始约定。

- 新增、修改、修复：[hai-app-create](.agents/skills/hai-app-create/SKILL.md)，能力选择见其 [development.md](.agents/skills/hai-app-create/development.md)。
- 应用审查：[hai-app-review](.agents/skills/hai-app-review/SKILL.md)。
- 升级同步：[hai-framework-sync](.agents/skills/hai-framework-sync/SKILL.md)。
- 测试、构建与 CI：按需读取 hai-app-tests、hai-build、hai-ci；模块能力按实际使用选择，不为覆盖率安装无关模块。

## 结构与边界

- `apps/ai-ask-desktop`：Tauri 2 + Vite + Svelte 5，页面在 `src/lib/pages`，Hash 路由入口为 `src/App.svelte`。原生代码在该 workspace 的 `src-tauri`，公开资源在 `public`，四语言消息在 `messages/*.json`。
- `packages/ai-ask-contract`：共享 Zod schema 与 typed API contract，根导出编译后的 `dist`；不得引用服务端、数据库或私密配置。
- `packages/ai-ask-serv`：Hai Serv / IAM / Reldb / Cache / Crypto / Reach 服务；配置在 `config/_*.yml`，模块生命周期在 `src/server/runtime.ts`，procedure 与服务逻辑分层。
- 根目录只承担 workspace、环境、Hai 构建和验证编排。不要新增根级 src、src-tauri、static、独立同步服务器或第二份契约。
- 桌面端只通过 ai-ask-contract 与 @h-ai/api-client 访问服务，不依赖 service workspace。先判断 HaiResult.success。

## 桌面业务约束

- 响应式状态用 Svelte 5 Runes，不用 Svelte 4 writable/readable/derived。
- 沿用纯 CSS、自定义属性和深浅主题，不引入 Tailwind 或其他 CSS 框架。
- 用户文本通过 i18n.t()，同步维护 zh-CN、en-US、ja-JP、ko-KR 四份 JSON，不复制第二份字典。
- 常量放桌面 src/lib/utils/constants.ts；用 $lib/utils/logger（委托 Hai Core），不用 console.log。日志必须英文，不记录 token、密码或便签正文。
- 子 Webview 只通过 ChildWebviewProxy 到 Rust invoke 管理，不在前端新建 WebviewWindow。
- 主窗口隐藏仍遵循 hideAllWebviews / restoreWebviews 协调。拖拽区不能覆盖按钮和输入框。
- 本地配置与便签走 Tauri Store 和原生字段补丁；窗口位置仅保存在本机，登录凭据只存操作系统凭据库。
- 保存、同步、登录、退出及切换服务的队列和归属校验必须保留；远端关闭也先保存草稿。退出须收齐全部编辑窗口回执，失败不能强退。

## 配置与构建

- 配置使用 Hai YAML Schema 与 HAI_* 变量；公开 API 地址使用 PUBLIC_API_BASE，不把服务端配置复制到桌面 bundle。
- 环境优先级：进程 > .env.<mode>.local > .env.local > .env.<mode> > .env > YAML。
- 公共 .env/.env.dev/.env.test/.env.prod 提交，秘密只在忽略的本机覆盖或部署环境注入。
- 根 package.json 版本为发布入口；同步脚本处理桌面、Cargo 和应用常量。原生应用标识保持数据兼容。
- 业务变更同步实现、契约、调用方、配置、测试与文档；保留已有工作，不为未要求的能力新增空模块。

## 验证

交付必须运行并通过根 pnpm lint 与 pnpm test，并按影响执行 pnpm check、pnpm check:i18n、pnpm build 和原生 E2E。

- pnpm tauri dev：从根启动原生桌面开发。
- pnpm dev：构建 contract 后并行启动服务和桌面 Vite。
- pnpm build：Hai compile 目标，按 workspace 依赖构建。
- pnpm build:desktop：Hai 原生桌面打包。
- pnpm test:e2e：桌面 Playwright。Windows 入口 apps/ai-ask-desktop/e2e/run-windows.ps1 使用隔离标识与数据目录。

区分测试夹具与真实网站结果。不得覆盖用户安装版数据，不把隔离测试 exe 当发布包。
