# Hai 工程迁移验证记录

后续 beta.35 升级与能力替换记录见 [framework-upgrade-beta35.md](framework-upgrade-beta35.md)。下文的 beta.34 验收保留为历史基线。

日期：2026-11-22。本轮在上一轮便签保存/同步修复基础上，按 Hai fullstack desktop 模板迁移工程。

## 迁移后的第二轮全面审查

按 Hai `hai-app-review`、应用约定及 beta.34 已安装公开类型重新检查 desktop / contract / serv / native 边界。原生宿主、纯 CSS 和四语言是本应用保留的业务约束；不将它们强行改成 SvelteKit 或 Tailwind。

本轮修复清单：

- 删除旧同步 schema 预查询、无意义增量同步参数、只供旧单测调用的同步入口；联网恢复和轮询统一归便签 Store 管理。
- 本地读取失败直接报告错误，不用默认配置或空便签伪装成功；初始化去重且可重试。关闭窗口失败不再误报隐藏或继续删除，退出期间禁止晚到的开窗请求。
- 开启同步立即恢复会话、建立观察并安排同步；首次网络错误可恢复，慢网络自动任务合并，关闭同步后队列执行前再次检查。离线切服务仍清理旧系统凭据，保险库清理失败必须中止切换；登录即认领未归属便签。
- 两处 Markdown 改用 Hai UI 的公开 `parseMarkdown`，移除本地 HTML 过滤器、直接 marked 依赖和手写类型声明；安全用例覆盖 iframe、srcdoc、SVG、事件和危险 URL。应用私有待办元数据保持隐藏，正文和代码示例保持可见。
- 删除重复 Shell 外链插件，统一使用已有 Opener；删除 UA 安装包猜测，使用 Rust 按真实系统/架构选择的安装包。下载去重、独立文件、长度校验及落盘错误处理均有回归，失败安装保留待安装记录。
- 收紧远端 Webview IPC 权限，保留导航结果桥；provider 仅接受 HTTP(S)。前后端代理按同一 HTTP/SOCKS5、端口及 URL 边界校验，错误配置不能静默回退系统代理。
- 修复更新监听器、主页面和调试页面的异步注册清理；调试脚本发送不再伪造泛型执行结果。生产构建不加载调试页。
- 共享 schema 校验持久化便签，并检查数据库 owner/ID；错误日志不包含正文。重置页遵循实际 IAM 密码策略，按流限制请求体；配置本次加载失败时拒绝沿旧缓存启动，启动与清理同时失败保留两条根因。
- 删除未引用图标、过时声明和多处正文/脚本/配置快照日志，保留 Hai Core 错误链与脱敏。语言加载失败保持原语言，快速切换时按最后一次选择生效。

本轮根门禁结果：

| 验证 | 结果 |
| --- | --- |
| `pnpm check` | 通过；结构边界与三包类型检查，桌面 0 错误、0 警告 |
| `pnpm check:i18n` | 通过；四语言消息 key 完全一致 |
| `pnpm lint` | 通过；工程与包级 ESLint、Rust fmt/clippy `-D warnings` |
| `pnpm test` | 通过；桌面 311、契约 3、服务端 23、Rust 75、文档 2，共 414 项 |
| 真实生产数据库 | 上述服务端测试包含隔离 PostgreSQL/Redis production 集成，无跳过；仅本轮容器与匿名测试卷已核对标签/ID后清理 |
| `pnpm build` | 通过；Hai workspace 编译；Hai UI 公开 Markdown barrel 会带入高亮及文档依赖，仍有 chunk 体积提示（Markdown 约 2.8 MB、文档 worker 约 3.3 MB），未压制提示 |
| 发行版本一致性 | `release:validate` 与版本传播回归通过 |
| Windows 自动验收 | 最终单轮 17/17 通过，无失败、跳过或自动重试；[机器报告](../test-results/hai-review-native-final.json) |
| 根 `pnpm tauri dev` | 通过；隔离配置、Hash 主窗、`pageErrors=[]`、优雅退出码 0；[机器报告](../test-results/hai-review-dev/tauri-dev.json) |
| 内嵌资源烟测 | 通过；无 Vite、`tauri.localhost`、2 次启动、`assetErrors=[]`，立即保存/退出/重启还原；[机器报告](../test-results/hai-review-embedded/embedded-assets.json) |

本轮原生覆盖：Markdown/Todo 即时退出与重启、未提交草稿、多窗口/几何、初始化读取失败时退出取消与恢复重试、退出中新建窗口拒绝、系统凭据与第二客户端同步、排序/嵌套/粘贴、Win+D、快捷键、划词翻译/解释、远端 IPC 拒绝及本地 URL 拒绝。未确认的发送不会自动重发。

首次整批有测试夹具、文件写入中轮询和前台焦点前置条件失败，已修测试并保留初次与定向复跑记录。另一次划词“未确认提交”在默认 12 秒断言时仍在加载；产品另有 20 秒就绪等待与 60 秒执行超时，不能据此判定无限等待。原样定向及最终完整批均未复现，最终诊断确认约 5.9 秒返回 `SUBMISSION_NOT_CONFIRMED`。未放宽业务或测试超时，初次失败结果未冒充最终通过结果。

本轮截图：[开发启动](../test-results/hai-review-dev/tauri-dev-started.png)、[内嵌主窗](../test-results/hai-review-embedded/embedded-main.png)、[退出重启后便签](../test-results/hai-review-embedded/embedded-note-restored.png)。本轮测试应用、Webview、Vite 与服务夹具已退出，1420 无监听；用户安装版进程保持原样。最终 debug exe 使用 `com.200hub.aiask.review-embedded` 与独立 `windows-profile`，是测试产物，不是发行安装包。

下方为首次工程迁移的既有验收，不能替代本轮结果。

## 目录与边界

| 旧位置或做法 | 当前位置或做法 |
| --- | --- |
| 根 src / src-tauri | apps/ai-ask-desktop/src 与 src-tauri |
| 根 sync-server | packages/ai-ask-serv，YAML 配置与 Hai Runtime |
| 服务包导出源码 contract | packages/ai-ask-contract 独立 schema / contract / dist 导出 |
| 根 static | 使用中的 favicon 迁 public，移除未使用的 Vite/Svelte/Tauri 标识 |
| SvelteKit routes / app.html | Vite index.html / main.ts / App.svelte / HashRouter / src/lib/pages |
| TS locale 字典 | 桌面 messages/*.json，保留四语言和 i18n.t() |
| AI_ASK_SYNC / SMTP 私有配置分支 | HAI_* + config/_*.yml + 标准环境加载器 |
| 重复 Claude/Copilot/Speckit 规则 | 根 AGENTS.md 为单一工程规范，其他助手桥接 |

根 src、src-tauri、sync-server、static、supabase、.specify、.svelte-kit 已移出活动工程。旧模板与旧构建缓存归档于忽略的 test-results/legacy-engineering，不进入构建或发行；Git 保留原文件删除记录。原服务 data 完整随包迁移。

## 首次工程迁移质量门禁

| 项目 | 结果 |
| --- | --- |
| 依赖安装与本地 Hai CLI beta.34 | 通过 |
| pnpm check:workspace | 通过，检查 legacy 目录缺席与三包依赖边界 |
| pnpm check:i18n | 通过，四语言 JSON key 一致 |
| pnpm check | 通过，含三包 typecheck；桌面 0 错误/0 警告 |
| pnpm lint | 通过，根脚本、三包、Rust fmt/clippy |
| pnpm test | 通过：桌面 241、契约 3、服务端 15（含真实 production PG/Redis）、Rust 65 和文档测试 2 |
| pnpm build（Hai compile） | 通过，依赖有序构建三包；保留一个前端 chunk 超过 500 kB 的体积提示 |
| 桌面 workspace 分项 | Vite 构建、0 错误/警告类型检查、241 项测试通过；最终全局门禁另列 |
| 共享契约与服务分项 | 契约 3 项、服务常规 14 项、显式 PostgreSQL/Redis 生产模式 1 项通过 |
| Rust 分项 | 迁后 65 项测试和 clippy 通过 |
| 版本与 CI 路径 | 临时 monorepo 版本同步/校验与 4 份 workflow YAML 检查通过 |
| Windows 原生 E2E | 15 个不同场景取得通过结果；两项异步桌面/焦点场景经定向复跑和精确状态同步后通过 |
| pnpm tauri dev | 根入口构建 contract → Hai run-tauri → Vite → Rust，通过 Hash 主窗渲染与优雅退出验收 |
| 生产内嵌资源烟测 | 通过：根 Tauri debug/no-bundle 构建、无 Vite 的 tauri.localhost 主窗/便签 Hash 页面、CSS/lazy chunk、立即退出保存和重启还原 |

## 首次迁移行为验收范围

本轮原生验收已覆盖 Hash 路由主窗与三个辅助窗口、退出前保存、待办草稿、多窗口、高 DPI 位置恢复、真实 Hai 服务注册/系统凭据/重启登录/第二客户端读写与删除，以及远端隐藏时草稿保存。保留上一轮便签队列、CAS、账号归属和墓碑修复。

生产构建与开发构建均通过 Hai Core 读取根环境文件。新增 3 项配置/真实 bundle 回归，验证 .env.prod 的公开 API 进入产物、进程值优先、HAI 私密变量不下发；另一次真实桌面构建标记实验已恢复为正常产物。

PostgreSQL/Redis 容器仅用于本轮显式隔离数据库测试，已验证标签与 ID 后关闭并自动删除，未操作用户既有数据库或容器。

## 实证边界

- 真实第三方 AI/翻译站点的账号、上传与外网可用性需单独验收，HTTP 夹具不代替外部网站。
- 隔离 PostgreSQL 16 与 Redis 7 的真实 production 初始化、IAM、便签版本/删除、关闭重启与持久化已通过；实际远程部署、外部 SMTP 和多副本运维未由本机测试证明。
- macOS/Linux、双屏拓扑与虚拟桌面专项未在本轮 Windows 验收中证明。
- 用户安装版保持原样。首次烟测使用 com.200hub.aiask.embedded-test；最新一轮 debug exe 使用 com.200hub.aiask.review-embedded 隔离标识，均为测试产物；自建应用/服务/测试容器已退出。

## 首次迁移原生截图

- [Hai 同步账号与服务](../test-results/hai-monorepo-cloud/windows-native-Hai-authent-a8327--the-operating-system-vault/hai-native-authenticated-sync.png)
- [远端隐藏后的草稿恢复](../test-results/hai-monorepo-cloud/windows-native-Hai-authent-a8327--the-operating-system-vault/hai-remote-hide-draft-restored.png)
- [根入口开发启动](../test-results/hai-monorepo-dev/tauri-dev-started.png)

## 首次迁移内嵌资源烟测

使用根 `pnpm tauri build --debug --no-bundle --config <隔离配置>`，不启动 Vite。两次真实运行均由 `tauri.localhost` 提供页面和样式；主窗为 `http://tauri.localhost/#/`，便签为 `http://tauri.localhost/index.html#/sticky-note?...`。验证 `assetErrors=[]`，立即退出前输入已写入磁盘，重新启动后内容还原。

- [机器记录](../test-results/hai-embedded-assets/embedded-assets.json)
- [主窗口](../test-results/hai-embedded-assets/embedded-main.png)
- [便签还原](../test-results/hai-embedded-assets/embedded-note-restored.png)
- 复现脚本：`apps/ai-ask-desktop/e2e/embedded-assets.mjs`，使用独立 exe 与 windows-profile。
