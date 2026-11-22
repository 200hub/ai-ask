# ai-ask-contract

桌面端与 Hai Serv 共用的纯 TypeScript API 契约。包根入口导出 `syncContract`、`notesContract`、`noteRowSchema`、`SyncedNoteRow` 和容量约束；不依赖服务端源码、数据库、Tauri 或 DOM。

`src/notes-schemas.ts` 定义边界输入输出，`notes-contract.ts` 定义唯一 HTTP 业务路径，`ai-ask-contract.ts` 组合标准 Hai IAM 与便签接口。所有消费者从 `ai-ask-contract` 导入已构建的 `dist/index.js` 和类型声明。

从工程根运行 `pnpm --filter ai-ask-contract build`，再构建桌面端和服务端。`typecheck`、`lint`、`test` 分别验证类型、风格和契约边界。构建输出 ESM、声明与 sourcemap，不把源码入口当作发布产物。

本包没有独立运行配置或数据库表。协议与数据行为见 [服务说明](../ai-ask-serv/README.md)。

Hai beta.35 升级保持既有 IAM 与便签 HTTP 路径、输入和响应形状；事务及 IAM 原子更新属于服务端实现，不另建契约或服务端源码导出。
