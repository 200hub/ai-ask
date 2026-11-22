# ai-ask-serv

AI Ask 的 Hai Serv 服务包，与 `apps/ai-ask-desktop`、`packages/ai-ask-contract` 构成 Hai fullstack 工程。服务仅处理标准 IAM 账号、便签云同步及可选邮件密码重置，Tauri 继续处理本机窗口与落盘。

## 结构与生命周期

- `src/index.ts`：读取已初始化的 Core / Serv 配置并启动 HTTP 监听。
- `src/app-server.ts`：组合共享 contract、IAM、业务 procedures 与框架安全/CORS 策略。
- `src/server/runtime.ts`：通过 `core.module.createRuntime` 按顺序初始化配置、Reldb、Cache、Crypto、可选 Reach、IAM 和便签表，失败时反序回滚，关闭由同一编排负责。
- `src/server/procedures/`：认证守卫与 procedure 装配，IAM 单条更新路由的原子适配；`notes-service.ts` 处理便签领域读写。
- `config/`：`_core.yml`、`_db.yml`、`_cache.yml`、`_iam.yml`、`_serv.yml`、`_reach.yml`，直接复用 Hai 公开 Schema。
- `messages/`：密码重置页及便签服务错误的中英日韩文本。

应用名称、版本、环境和日志来自 `_core.yml`。每次启动都检查本次必需配置文件的加载结果；配置读取失败时停止启动，重启不会沿用 Core 保留的旧缓存。数据库及凭据规则由 Hai 模块管理；不再使用独立 `readServerConfig`、`AI_ASK_SYNC_*` 变量或 `tsx` 源码启动。

## 构建和运行

从工程根执行：

```powershell
pnpm --filter ai-ask-contract build
pnpm --filter ai-ask-serv build
pnpm --filter ai-ask-serv dev
```

`dev` 先用 tsup 构建，再经根 `scripts/run-node.mjs` 按 `dev` 模式加载环境后运行 `dist/index.js`。`dev:test` / `start:test` 读取 test 文件；`start` / `start:prod` 运行已构建产物并读取 prod 文件。服务运行目录必须为本包根目录，以便读取 `./config` 和相对数据路径。

默认开发监听 `127.0.0.1:1422`，API 前缀 `/api/v1`，健康检查 `/health`。桌面便签设置填完整 API 地址，例如 `http://127.0.0.1:1422/api/v1`。跨设备使用需部署浏览器与桌面可访问的 HTTPS 服务；桌面安装包不包含自动运行的服务进程。

## 配置

完整字段、类型、默认值及约束见 [包级环境示例](.env.example)。实际环境文件在工程根：`.env` 为公共基础，`.env.dev` / `.env.test` / `.env.prod` 为公开模式覆盖，`.env.local` 和 `.env.<mode>.local` 为不提交的私有配置。优先级为进程、模式私有、共享私有、模式公共、公共基础、YAML。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HAI_DB_DATABASE` | `./data/ai-ask.sqlite` | SQLite 数据库；相对本包工作目录 |
| `HAI_CACHE_TYPE` | 开发为 `memory` | 生产环境须使用 `redis` 并配置实际连接 |
| `HAI_SERV_SERVER_HOST` / `HAI_SERV_SERVER_PORT` | `127.0.0.1` / `1422` | HTTP 监听 |
| `HAI_SERV_CORS_ORIGIN` | 本机开发网页来源 | 逗号分隔字符串，非 JSON 数组 |
| `HAI_SERV_CORS_NATIVEORIGINS` | Tauri 本机来源 | 原生来源白名单 |
| `HAI_IAM_PASSWORDRESET_ENABLED` | `false` | 启用后初始化 Reach SMTP |
| `HAI_IAM_PASSWORDRESET_RESETURL` | 本机 `/reset-password` 地址 | 邮件中浏览器可访问的重置页绝对地址 |
| `HAI_REACH_PROVIDERS_0_*` | 见示例 | SMTP 主机、端口、TLS、账号、密码与发件人 |

Core 的 `env` 接受 `development` / `production` / `test` / `staging`；`dev` / `prod` 是环境文件模式名，不是 Core env 的合法值。默认开发可用本机内存缓存。生产启动受框架共享状态守卫保护，必须提供真实 Redis；未配置时启动失败，不降级到内存。便签业务支持 SQLite 与 PostgreSQL，MySQL 在初始化阶段明确拒绝。生产模式同时需要 PostgreSQL 与 Redis；SQLite 自动化与隔离 PostgreSQL / Redis 的真实 production 模式专项均已通过；真实生产部署与多副本尚未验收。

默认 SQLite 文件及已有 IAM / `ai_ask_notes` 表结构保持原样，`data/` 已随包移动并保留。新建表的时间戳使用 BIGINT，兼容 PostgreSQL 毫秒时间；已存在 SQLite 表不会被改写。请备份整个数据目录，生产将路径指向持久卷。HTTP bearer 认证的生产连接需由部署入口提供 TLS；当前客户端没有启用 Hai 应用层加密传输，`_serv.yml` 显式设为 `transport: false`。

## 协议与同步规则

客户端使用 `apiClient.create(syncContract)`；契约仅从 `ai-ask-contract` 的已构建根入口导入，并先检查每次 `HaiResult.success`。

- `iam.auth.register/login/currentUser/logout/refresh`：标准 Hai IAM 流程，桌面终端类型为 `desktop`。
- `notes.list({})`：返回当前账号全部便签与删除墓碑。
- `notes.push({ notes })`：每批最多 100 条，返回当前账号最终全量行。写入 owner 强制来自已认证会话，忽略输入 `user_id`。整批通过 Hai `reldb.tx.wrapResult` 执行，任一写入或最终回复校验失败均回滚；返回原始 `HaiResult` 业务失败，不用异常模拟回滚。

数据库原子提交更新，旧时间戳不能覆盖新内容；删除优先于活跃内容，快时钟不能阻断删除。墓碑永久保留，旧设备即使携带更大时间戳也不能复活相同 ID。窗口位置与尺寸仅保存在设备本地，云端 `bounds` 只收 `visible/kind`。

读出的持久化行再次使用共享 schema 校验，并核对账号和便签 ID；损坏或身份不一致时返回失败，由 Serv 生成关联追踪编号。服务不会静默丢弃损坏行或改写原数据，日志只记录错误类型和字段路径，不包含便签正文或 JSON 解析错误中的原文片段。

IAM 处理密码策略、登录失败锁定、会话和令牌刷新，不创建默认管理员账号。默认密码至少 8 位并包含大小写字母和数字。重置页的长度约束直接使用 IAM 已生效的密码策略，表单按实际流量限制为 4 KiB，超限会中止读取。启用 SMTP 后，重置邮件提供一次性链接，浏览器表单提交后由 IAM 校验、限时和单次消费，并撤销旧会话。未启用邮件时标准 API 明确返回不可用，不把日志输出当作邮件送达。

## beta.35 的原子接口适配

当前依赖固定为已发布的 Hai `1.0.0-beta.35`，不调用框架工作目录的未发布源码。标准 Serv 的 `users.update` 在该版本仍先更新资料、再同步角色；角色失败时资料不会撤销。本应用仅覆盖这条已有路由，改用公开的 `iam.user.updateUserWithRoles`，保留原 HTTP 契约、`iam.users.write` 权限、`iam.users.update` 敏感操作验证及 IAM 审计钩子，其余 IAM procedure 继续使用框架实现。框架标准 Serv 接入同一原子 API，并通过本应用权限、二次认证及回滚回归后，可删除 `iam-procedures.ts` 的适配。

beta.35 的一次性能力票据由 IAM 使用摘要缓存键和原子比较消费，用途错误不会消耗原票据。应用沿用标准二次认证和密码重置接口，不创建第二份票据状态，也不把密码重置令牌与能力票据混用。测试覆盖敏感操作凭据单次消费、错误用途保留、角色失败时资料回滚，以及重置表单并发提交只有一次成功。

## 数据迁移边界

旧版 Supabase 账号与 Hai 账号不同。升级前用旧版拉取所需云端便签并备份本地应用数据；升级后注册 Hai 账号，同步现有本地便签。仅在旧云端的数据需先下载或由管理员导出，服务不会自动读取或删除旧 Supabase 项目。待所需数据核对完成后再处置旧项目。

## 验证

`pnpm --filter ai-ask-serv typecheck`、`lint`、`build`、`test` 分别检查类型、风格、可运行 ESM 产物和真实 HTTP / SQLite / SMTP 行为。测试使用临时数据库、本地 HTTP 与 SMTP 协议夹具，覆盖用户隔离、版本比较、墓碑、批量写入与回复校验失败回滚、服务重启、配置加载失败、持久化数据校验、日志正文保护、标准认证、IAM 资料与角色原子更新和一次性密码重置。它们不证明真实外部 SMTP、线上部署或多副本环境已经通过。可选生产专项由显式 `HAI_TEST_POSTGRES_URL` 与 `HAI_TEST_REDIS_URL` 启用，仅接受名为 `ai_ask_test` 的隔离 PostgreSQL 测试库；未配置时跳过。该专项使用真实生产守卫、PostgreSQL 和 Redis，验证认证、版本更新、墓碑、事务失败回滚及运行时重启持久化，最后仅清理本用例注册的账号和便签，不清空共享表。
