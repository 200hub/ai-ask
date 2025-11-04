# Research & Decisions: 版本检查与自动更新

## Decision 1: 更新来源与渠道
- Decision: 使用 GitHub Releases 仓库 200hub/ai-ask，仅选择稳定版（prerelease=false）
- Rationale: 满足“来自 GitHub release 记录”；稳定性更高
- Alternatives: 接入自建更新服务（放弃：增加运维复杂度）

## Decision 2: 版本比较语义
- Decision: 使用语义化版本比较（主/次/补丁），严格大于才判定有更新
- Rationale: 避免同版本重复提示；行业通用
- Alternatives: 仅按发布时间（放弃：可能降级、无语义）

## Decision 3: 资产选择策略（平台/架构匹配）
- Decision: 基于当前平台与架构匹配资产名（示例：win-x64/arm64、macos-universal/x64/arm64、linux-x64/arm64）；优先正式构建
- Rationale: 保证正确性；与 Spec 一致
- Alternatives: 允许用户手动选择（放弃：增加复杂度）

## Decision 4: 代理遵循
- Decision: 完全遵循应用内代理设置（HTTP/HTTPS），未设置则直连
- Rationale: 满足“更新检查遵循代理设置”；统一出口
- Alternatives: 系统代理优先（放弃：与需求不符）

## Decision 5: 下载与安装时机
- Decision: 启动后后台检查；按开关自动或手动下载；下载完成提示“请重启”；在下次启动时执行安装（桌面端）
- Rationale: 符合用户体验与 Spec；避免运行时热替换风险
- Alternatives: 立即强制重启（放弃：打断任务）

## Decision 6: 移动端（Android/iOS）策略
- Decision: 检测到新版本仅提示并引导到应用商店或下载页；不在应用内直接安装
- Rationale: 符合平台分发政策
- Alternatives: 内置下载并侧载（放弃：合规与安全风险）

## Decision 7: 校验（可选）
- Decision: 若 Release 提供校验文件（如 .sha256），在安装前进行校验；未提供不阻断
- Rationale: 提升可靠性；不影响可用性
- Alternatives: 强校验（放弃：发行规范未强制）

## Decision 8: 依赖与技术选型（尽量复用）
- Decision: 前端完全复用现有 Svelte 5 Runes/i18n/logger 体系；后端复用 Tauri + Rust。仅新增：Rust semver（版本比较）、sha2（如需校验）、HTTP 客户端复用现有或增补 eqwest（若当前未使用 HTTP 插件）。
- Rationale: 满足“尽量复用目前的技术体系，仅在需要的时候引用新的技术”
- Alternatives: 引入额外前端库或新更新框架（放弃：超出最小必要）

## Decision 9: 错误与重试
- Decision: 所有阶段记录结构化日志；检查失败不打扰用户，启动重试；下载失败提示可重试
- Rationale: 体验友好、便于诊断
- Alternatives: 弹窗打断（放弃）

## Decision 10: 文案与本地化
- Decision: 新增 i18n key：update.available, update.downloading, update.readyToRestart, update.installFailed, settings.autoUpdate 等（四语言）
- Rationale: 宪章要求 i18n First
- Alternatives: 硬编码（放弃）
