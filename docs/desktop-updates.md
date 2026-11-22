# 桌面签名自动更新

2026-11-22 已配置产品签名身份及 GitHub Actions 配置，应用版本升级为 `0.0.1-beta.13`。本次未推送代码或创建正式发布；固定通道的首份清单会在首个五平台签名发布成功后生成。

## 产品配置

- 信任根：`apps/ai-ask-desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，本地正式构建与 CI 共用。
- 固定更新源：`https://github.com/200hub/ai-ask/releases/download/desktop-updates/latest.json`。
- 强制签名版本校验，禁止降级；签名更新副本独立生成，构建步骤不取得私钥。
- GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- GitHub Variables：`TAURI_UPDATE_PUBLIC_KEY`、`TAURI_UPDATE_FEED_URL`，已回读验证与提交配置一致。
- 公钥文本 SHA-256：`0bbb6f0288025e3ce392621888061f0340913d59814643c82e07e4145d99ab01`。

私钥已用随机密码加密。本机恢复副本位于 `C:\Users\gudao\.config\ai-ask\release-signing`，目录禁止继承权限，仅当前用户、SYSTEM 和管理员可访问，包含加密私钥、公钥、密码及配置元数据。请将该目录另行安全备份；不要将内容复制到 Git、公开环境文件或日志。后续发布沿用同一身份；直接更换公钥会使已安装客户端无法信任新签名。

## 发布与更新顺序

1. 将已验证的发布提交合并到 `main`，或推送匹配源码版本的 `v0.0.1-beta.13` 标签；现有 Release workflow 会构建五个平台。
2. 普通安装包与签名更新副本分别上传。五平台签名、文件、版本全部通过校验后才公开版本 release。
3. 独立 channel job 从已公开版本取得清单，串行晋升固定 `desktop-updates` 预发布通道。版本资产保留在原 `v版本号` release，不改写旧版本标签。
4. channel 晋升检查 SemVer、源提交和已有公开版本，旧构建迟到或重跑不能将通道退回旧版。失败后可重跑发布工作流修复通道。

GitHub 的 `releases/latest` 不包含所有 beta，因此产品使用独立通道。只有正式打包且携带该公钥的应用启用自动更新；开发和 debug 构建禁用更新网络。Windows NSIS/MSI、macOS 安装后的 `.app`、Linux AppImage 支持插件更新；DEB 使用发布页下载。

用户允许自动更新时可后台检查及下载，安装仍需确认。安装前必须收到所有便签编辑器的保存回执，保存失败或取消时不退出。

## 首次迁移与验收边界

旧 beta.12 安装包没有本次新增的信任根和固定通道，需要从发布页手动安装首个签名版本。此后的版本沿用同一密钥，通过上述通道更新。

本机已使用产品身份和官方 Tauri CLI 对惰性测试文件签名，并通过同一产物校验逻辑验证公私钥、密码和版本绑定；测试文件未上传、未执行。常规回归另覆盖实际官方插件下载、篡改拒绝、错误版本拒绝及安装前保存。五平台线上构建、首份公开 feed、真实系统安装器升级仍以首次发布后的实机验收为准。

## 本轮验证

- `pnpm check`：桌面 0 错误、0 警告；三个工作区包类型检查通过。
- `pnpm lint`：根脚本、工作区、Rust fmt/clippy 均通过。
- `pnpm test`：415 项通过（桌面 321、契约 3、服务端 28、Rust 62、官方插件签名集成 1）；依赖显式外部 PostgreSQL/Redis 的 1 项本轮按条件跳过，前序真实数据库通过记录保留在框架升级文档中。
- `pnpm test:ci`：13/13，通过实际 CLI 签名与临时 Git 历史验证通道版本顺序、祖先关系、错 key/错版本/篡改拒绝及配置漂移；24 个 workflow Bash 步骤额外通过语法检查。
- `pnpm build`：通过；保留前序已记录的 Markdown/document worker 体积提示。
- 根 `pnpm tauri dev`：独立身份及数据目录下，原生/UI 均为 beta.13，Hash 主窗正常，debug 更新不可用，优雅退出码 0、页面错误为空。[报告](../test-results/hai-beta13-dev/tauri-dev.json)。用户已安装实例保持运行，隔离实例的默认快捷键因此出现占用提示，本次不计为快捷键注册验收。
- 产品密钥签名校验：[本机报告](../test-results/updater-product-signing/verification.json)；测试文件未上传、未执行安装器。
