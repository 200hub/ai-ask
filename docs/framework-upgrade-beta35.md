# Hai beta.35 升级与能力复用

目标：`1.0.0-beta.34` → `1.0.0-beta.35`。2026-11-22 从项目实际 registry `https://registry.npmjs.org/` 查询 `@h-ai/core` / CLI 的 `latest`，并逐包校验精确发布版本、engines、依赖和完整性。所有已使用的 Hai 依赖统一精确版本，不使用本地源码映射或框架补丁。

发布依据：[beta.35 发布提交](https://github.com/hai-series/hai-framework/commit/4def5867)、已安装 npm 包公开 exports / 类型、同版 CLI 模板。工作区原有迁移和便签修复保留，未重置或 stash。清单、原依赖快照与实际解析记录位于忽略的 `test-results/hai-upgrade-beta35/`。

## 差异与处理

| 变化 | 应用影响与处理 | 验收 |
| --- | --- | --- |
| 全部已用 Hai 包升级 | 根、desktop、serv、contract 与传递依赖统一 beta.35；CLI 先以只读 `hai upgrade 1.0.0-beta.35` 确认发布完整性 | 每个 workspace 实际解析版本、lock 无 beta.34、冻结安装 |
| `reldb.tx.wrapResult` | 旧便签批次逐项提交，后项失败可能留下前项；改为批次写入及最终持久化校验同事务，失败完整回滚 | SQLite / PostgreSQL SQL 拒写与损坏行校验回滚 |
| `iam.user.updateUserWithRoles` | 上游 Serv 现有 `users.update` 尚未接入新原子 API；应用最小替换该路由，保留操作名、权限、二次认证与 IAM 审计钩子 | HTTP 权限、二次认证、角色失败时资料回滚；PostgreSQL 真实锁与角色操作 |
| IAM 单次票据 | 直接使用新版 purpose 校验、摘要键与 CAS 消费，不复制票据状态机；现有会话和便签表结构保留，升级前的临时动作票据需重新获取 | 错 purpose 不消耗票据、重复消费拒绝、密码重置并发单次生效 |
| 桌面签名更新模板 | 复用官方 Tauri Update 资源、下载、验签、平台/版本和安装 API；移除自制 GitHub 下载任务、版本比较、UA 猜包、轮询及下次启动安装记录 | 未配置明确不可用；检查/下载/验签/安装与退出保存失败路径 |
| 更新安装确认 | 保留自动更新偏好作为后台检查与下载，安装由用户确认并先完成所有便签保存回执。现有发布页下载入口保留 | 安装前保存；取消或失败不得强退 |
| Markdown 私密预览 | 使用新版 `remoteImages`；默认不请求外部图片，用户可显示当前内容的图片。保留内联图、正文、代码和待办元数据语义，所有图片仍经框架白名单 | 实际 Svelte 组件默认/显示/撤销许可，以及危险地址回归 |
| skills / AI 入口 | 用目标 CLI 在隔离目录生成并合并 22 个适用技能完整目录；根 AGENTS 保留 Tauri、纯 CSS、四语言、凭据库与保存规则 | 同版来源、完整相邻资源和入口路由 |

关键输入的前后结果：

- 同一批 `[便签 A 正常写入, 便签 B 被数据库拒写]`：升级前 A 可能已提交；现在 `reldb.tx.wrapResult(async tx => ...)` 收到 B 的失败后回滚整批，A 不留下部分写入。
- 同一用户提交“更名 + 无效角色”：原通用路由可能先更名再报角色失败；现在 `iam.user.updateUserWithRoles(id, { profile, roleIds })` 保持资料和角色一起成功或失败。未授权及缺二次认证请求仍被拒绝。
- 同一内容 `![图示](https://images.example.com/a.png)`：此前预览自动发起图片请求；现在默认显示“图示”，点击显示外部图片后由 `parseMarkdown(..., { remoteImages: true })` 生成经白名单检查的图片。切换便签或结果撤销许可，不改写原始内容。

## 框架能力边界

- 四语言 Runes 门面继续保留：当前 Core 消息 getter 只覆盖中、英、日，不能把韩语映射成中文。占位符格式化集中到单一门面，删除重复组件实现。
- 本地 Tauri Store、系统凭据、便签字段补丁、账号归属、同步墓碑和多窗口退出回执属于桌面业务；beta.35 没有可等效替代这些行为的公开接口。云请求继续由 `apiClient.create`、标准认证 actions 和 TokenStorage 处理。
- 新 AI 本地解析、审计聚合、反馈列表及部署回执能力没有当前业务调用点。本应用通过隔离 Webview 使用第三方 AI 网站，不据此增设 LLM 服务器、角色管理 UI、反馈或部署服务。
- UI 复用遵守现有纯 CSS 约束；没有为了使用组件而引入 Tailwind，或复制 SvelteKit 管线到 Vite SPA。
- CLI 最终只读检查为 `releaseComplete: true`、依赖 `drift: []`、22 个已交付技能 `current`。另 12 个未选用模块技能显示 `missing`，它们不属于当前项目依赖与技术栈，未据此安装无关模块或强加 SvelteKit / Capacitor 管线。
- Rust 编码工具改用标准 `base64` crate，删除手写解码算法；应用 Store 删除只写不读的设置/加载标志及旧更新元数据，保留聊天视图实际消费的 Webview 加载状态。

## 签名更新配置

更新信任根编译进正式安装包，不从同步服务、便签内容或运行期配置读取。发布流水线使用真实 `TAURI_UPDATE_PUBLIC_KEY`、HTTPS `TAURI_UPDATE_FEED_URL`，签名私钥及密码只通过 CI 的 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入签名步骤。

当前工程没有这些产品签名配置。此状态下桌面显示不可用并可打开发布页下载；不生成产品密钥、不假填签名、不退回旧的不验签安装器。自动更新投递的正式发布验收还需要实际密钥、通道清单与签名产物。预发布通道须使用会实际更新的清单地址，GitHub 的 `releases/latest` 不代表所有 beta 版本。

## 验证结果

| 验证 | 本轮结果 |
| --- | --- |
| 精确版本及 CLI 只读升级检查 | beta.35 发布完整、15 个 workspace 消费位置实际为目标版本、lock 无 beta.34、`drift=[]` |
| 工作区及技能 | 根 `check:workspace` 通过，22 个完整技能目录与相邻资源存在，应用私有约束保留 |
| 类型与语言 | 根 `pnpm check`、`check:i18n`、`release:validate` 通过，桌面 0 错误/0 警告、四语 0 差异 |
| 根 `pnpm test` | 全部通过：桌面 321、契约 3、服务端 29、Rust 单测 61、官方验签集成 1，共 415 项；未跳过生产数据库专项 |
| 根 `pnpm lint` | 通过；含实际启用的 `.github/scripts`、各 workspace、Rust fmt/clippy `-D warnings` |
| `pnpm test:ci` | 9/9 通过；官方 CLI 临时密钥、五平台签名/打包/合并、篡改/错 key/错版本拒绝、四份 YAML、PR secret 隔离及版本传播 |
| PostgreSQL / Redis | 真 production 守卫下运行认证、便签事务/墓碑/重启、IAM 原子组合更新及角色失败回滚 |
| 官方签名集成 | 隔离临时测试密钥、实际 CLI `--app-version` 与真实 HTTP 下载；接受正确签名，拒绝篡改字节及版本不符，不启动系统安装器 |
| `pnpm build` | Hai workspace 编译通过；仍保留 UI barrel 带来的约 2.7 MB Markdown chunk 与约 3.3 MB document worker 体积提示 |
| Windows 原生验收 | 最终单轮 18/18，无跳过、失败或重试；[机器报告](../test-results/hai-beta35-native-confirmed.json) |
| 根 `pnpm tauri dev` | beta.35 实际启动、隔离标识、Hash 主窗、`pageErrors=[]`、退出码 0；[机器报告](../test-results/hai-beta35-dev/tauri-dev.json) |
| 内嵌资源验收 | 无 Vite、2 次启动、`assetErrors=[]`、便签立即退出保存与重启还原均通过；[机器报告](../test-results/hai-beta35-embedded/embedded-assets.json) |
| 冻结安装复现 | 最终 `pnpm install --frozen-lockfile --lockfile-only` 通过供给链检查，未保留 beta.34 的临时安装例外 |

首次完整 Rust 门禁暴露 Common Controls v6 测试宿主入口和重复 manifest 问题。现将需要 MockRuntime 的真实验签测试放到独立 integration 宿主，仅为该目标嵌入 v6；正式应用及 bin-test 继续使用 Tauri 资源。完整 `cargo test` 和普通构建均已通过，没有更改系统 DLL 或关闭测试。原生验收使用隔离构建的固定 exe 副本，避免 integration 测试自动重建主程序后覆盖共享 `target/debug` 测试路径。

发布脚本已连接现有五平台 CI：普通安装包与 `updater-*` 签名副本分开上传，全部版本化文件上传后才上传 `latest.json` 并公开 draft。仅签名步骤取得私钥；PR 不取得签名 secrets。双空配置保留手动发布，部分配置、缺平台、资产/签名/版本错误均中止。未执行线上发布或修改 GitHub secrets。

原生覆盖便签即时退出/草稿/失败恢复/几何、真实 Hai 双端同步与系统凭据、待办排序/嵌套/粘贴、划词翻译和解释、防重复发送、Webview IPC/URL 边界，以及新增图片许可和更新未配置状态。图片默认请求数 0，授权后请求数 1，隐藏/刷新后不沿用许可；关于页面明确未配置并保留发布页入口。

初次验收发现测试使用共享 exe 路径会被 Cargo integration 构建覆盖，以及 About 定位和 Win+D 焦点前置条件错误。已修测试夹具并保留失败记录；最终 18 项在固定隔离副本上完整通过，没有放宽业务或测试超时。测试数据库容器及匿名卷已核对任务标签、名称和完整 ID 后清理。

本轮截图：[图片显示许可](../test-results/hai-beta35-native-confirmed/windows-native-Hai-Markdow-8c4e9-s-show-an-explicit-fallback/private-markdown-image-opt-in.png)、[签名更新未配置提示](../test-results/hai-beta35-native-confirmed/windows-native-Hai-Markdow-8c4e9-s-show-an-explicit-fallback/signed-updater-unconfigured-fallback.png)。

内嵌资源截图：[主窗](../test-results/hai-beta35-embedded/embedded-main.png)、[重启还原便签](../test-results/hai-beta35-embedded/embedded-note-restored.png)。本轮应用、Webview、Vite 与同步夹具已退出，1420 无监听，只有用户安装版进程保持运行。固定测试副本分别使用 `com.200hub.aiask.beta35`、`com.200hub.aiask.beta35-dev`、`com.200hub.aiask.beta35-embedded` 与独立数据目录，均为测试产物，不是发行安装包。

真实产品签名发布/安装、外部 AI 网站登录与外网、macOS/Linux 实机和移动端不由本轮 Windows 验收证明。此前 beta.34 的记录保留于 [validation-status.md](validation-status.md)，不作为本次升级通过证据。
