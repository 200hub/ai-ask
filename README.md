# AI Ask

<div align="center">

[![AI Ask Version](https://img.shields.io/github/v/release/200hub/ai-ask?include_prereleases&style=for-the-badge&label=AI%20Ask&color=blue)](https://github.com/200hub/ai-ask/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00?style=for-the-badge&logo=svelte)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-CE422B?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**🆓 完全免费 · 直接使用 AI 官网 · 无需 API Key · 多平台一键切换**

💰 零成本使用 11 个 AI 平台 · 🌐 内嵌真实网页界面 · ✂️ 全局划词翻译/解释 · 🌍 四语言国际化

> **核心优势**：直接集成 ChatGPT、Claude、Gemini 等 AI 平台的**官方网页界面**，而非调用 API。  
> 无需付费订阅 API、无需管理密钥、无需担心额度，像在浏览器中一样自然使用，但体验更优雅。

[功能特性](#-功能清单) • [快速开始](#-快速开始) • [开发文档](#️-开发与架构) • [问题反馈](https://github.com/200hub/ai-ask/issues)

</div>

---

## 📖 项目简介

AI Ask 是基于 **Tauri 2.x** + **Svelte 5** 构建的现代化桌面应用，通过**直接嵌入 AI 平台官方网页**的方式，让您在一个窗口中优雅地使用多个 AI 服务和翻译工具，无需在浏览器标签间频繁切换。

### 💡 为什么选择 AI Ask？

#### 🆓 完全免费，零成本使用

- **无需 API Key**：直接使用 AI 平台官网，不调用付费 API
- **无需订阅**：只要 AI 平台本身免费，就能零成本使用
- **无额度限制**：不受 API 调用次数限制，使用自由度与网页版一致
- **保持登录**：每个平台独立会话，免费账号也能正常登录使用

#### 🌐 直接集成官方界面，而非 API

- **真实网页体验**：内嵌 ChatGPT、Claude、Gemini 等平台的**完整官网界面**
- **功能完全一致**：支持多轮对话、上传文件、代码高亮、Markdown 渲染等所有官网功能
- **无二次开发成本**：平台更新功能时自动可用，无需等待 API 适配
- **无限制对话**：不受 API 返回长度、格式限制，体验与网页版完全相同

#### 🚀 更优雅的多平台管理

- **一键切换**：侧边栏快速切换 11 个 AI 平台，无需多个浏览器标签
- **独立会话**：每个平台独立 Cookie/存储，互不干扰
- **全局划词**：选中文字后自动显示工具栏，一键发送到任意 AI 平台解释
- **智能翻译**：集成 5 个翻译引擎，划词翻译、快捷键翻译一应俱全

### 🎯 核心价值

- **🤖 多平台聚合**：11 个内置 AI 平台（ChatGPT、Claude、Gemini 等）+ 自定义平台
- **💰 完全免费**：直接使用官网界面，无需 API Key 和付费订阅
- **🌐 智能翻译**：5 个翻译引擎（Google、DeepL、有道、百度、微软）
- **✂️ 全局划词**：跨应用文字选择监听，一键翻译或 AI 解释
- **🔒 隐私优先**：所有数据本地存储，独立 Webview 会话隔离
- **🌍 多语言支持**：中文、英文、日文、韩文完整翻译
- **⚡ 高性能**：Rust 后端 + Svelte 5 响应式前端，启动迅速、切换流畅
- **🎨 现代设计**：无边框窗口、自定义标题栏、深色/浅色主题
- **🔧 高度可扩展**：支持自定义平台、注入模板、代理配置

---

## ✨ 功能清单

### 🤖 AI 问答

- **多平台支持**（11 个内置平台）
  - **国际平台**：ChatGPT、Claude、Gemini、Copilot、Grok
  - **国内平台**：DeepSeek、Kimi、通义千问、文心一言、豆包、腾讯元宝
  - **直接嵌入官方网页**：完整保留原网站所有功能（多轮对话、文件上传、代码高亮等）
  - **无需 API Key**：使用平台免费账号即可，零成本使用
  - 每个平台独立 Webview，保持登录状态和对话历史
  - 侧边栏快速切换，响应迅速
- **与传统 API 方案的区别**
  - ❌ **传统方案**：调用 API 需要付费订阅、管理密钥、受额度限制、功能受限于 API 接口
  - ✅ **AI Ask**：直接使用官网免费账号、零成本、功能完整、平台更新自动可用
  - 🎯 **最佳适用场景**：个人用户、学习研究、多平台对比、不想为 API 付费的开发者
- **自定义平台**
  - 添加任意 AI 网站（支持自定义名称、URL、图标）
  - 拖拽排序，管理显示顺序
  - 独立启用/禁用控制
- **平台隔离**
  - 每个平台独立 Cookie/LocalStorage
  - 代理设置独立生效
  - 互不干扰的会话管理
- **Webview 智能管理**
  - 前端通过 `ChildWebviewProxy` 统一管理 11+ 个 Webview，实时跟随主窗口变更位置/尺寸，并通过 0.5px 容差校验避免抖动
  - 自动区分冷启动（首次创建，加载动画 ≥ 800ms）与暖启动（复用窗口，动画 ≥ 120ms），窗口聚焦后还会额外等待 200ms，确保首帧稳定
  - 支持 per-platform 代理、焦点控制、隐藏/恢复联动；窗口切换/Tray 操作均通过 `hideAllWebviews → show` 事件串行处理，杜绝闪烁
- **预加载与暖启动**
  - `preloadDefaultPlatforms` 开启后，启动约 1 秒内后台静默创建默认翻译器与优先 AI 平台 Webview，真正做到“点开即用”
  - 预加载优先级：划词默认平台 > 上次使用平台 > 手动指定默认平台 > 第一个启用平台
  - 可在通用设置中随时关闭预加载以节省内存

### 🌐 翻译功能

- **内置翻译引擎**（5 个）
  - Google 翻译、DeepL、有道翻译、百度翻译、微软翻译
  - 独立翻译视图，快速切换引擎
  - 默认翻译器配置
- **智能翻译**
  - 支持自动语言检测
  - 翻译快捷键快速打开（Ctrl/Cmd+Shift+T）
  - 翻译结果保留在页面中，无需重新输入
- **独立 Webview 管理**
  - 每个翻译引擎拥有独立的子 Webview，切换时只隐藏其它实例而非销毁，保持登录态与上下文
  - 主窗口移动/缩放/失焦会触发重排，子窗口始终与主视图对齐；代理配置变更后自动重建，避免旧连接泄漏
- **注入联动**
  - 划词翻译或快捷键打开时，自动等待目标 Webview 就绪，再按模板填充输入框并触发发送按钮
  - 模板拆分填充/点击动作，可调节延迟与超时，避免页面尚未渲染完就注入导致失败
  - 任何注入异常都会通过 `appState.setError` 提示，并记录结构化日志便于排查
- **热切体验**
  - 翻译页面同样区分冷/暖切换，最小加载动画 800ms/120ms，并在聚焦后追加 200ms 缓冲
  - `ensureTranslationVisible` 自定义事件可保证在多次注入时始终聚焦当前翻译器

### ✂️ 划词工具栏（Selection Toolbar）

- **全局文字选择监听**
  - 跨应用文字选择检测（Windows/macOS/Linux），基于系统 Accessibility API 实现
  - 鼠标抬起后自动 350ms 去抖，确认真实选区再弹出工具栏
  - 自动跳过输入框、文本域、下拉框等可编辑控件，避免干扰表单操作
  - 通过「文本+坐标」生成选区签名，相同选区不会重复唤起工具栏
- **三大核心操作**
  - **翻译**：选中文字自动填入翻译平台，一键翻译，并在后台等待 Webview 就绪后再注入
  - **AI 解释**：选中文字作为提示词发送到默认 AI 平台，支持模板化 prompt
  - **收藏**：入口已预留，当前版本展示“功能开发中”提醒，后续会接入收藏夹/剪贴板能力
- **智能交互**
  - 鼠标悬浮保持显示，离开后自动隐藏（10 秒延迟）
  - 按 Esc 键快速关闭
  - 窗口失焦自动隐藏
  - 最小选择长度验证（2 个字符）
  - 智能光标定位（避免遮挡选中文字）
- **策略与安全**
  - **忽略应用列表**：在设置中维护命中名单（进程/窗口名），被忽略的应用永不弹出工具栏
  - **临时禁用**：可设定自动恢复时间，前端实时显示倒计时，并提供“一键恢复”按钮
  - **辅助功能权限**：macOS 自动检测/请求可访问性权限，缺失时会弹出操作提示
  - **快捷键联动**：`Ctrl/Cmd+Shift+S` 可强制唤起工具栏；所有状态变更同步到 Rust 端 `ToolbarManager`
- **注入模板系统**
  - 为 11 个 AI 平台预配置注入模板
  - 为 5 个翻译平台预配置注入模板
  - 自动填充输入框 + 自动点击发送按钮
  - 支持 CSS 选择器、延迟、超时配置
- **多语言支持**
  - 工具栏界面支持中英日韩四种语言
  - AI 提示词模板自动适配当前语言
- **可配置选项**
  - 启用/禁用划词工具栏
  - 自定义全局快捷键（默认 Ctrl/Cmd+Shift+S）
  - 选择默认 AI 解释平台 / 默认翻译器
  - 维护忽略应用清单、临时禁用时长、倒计时提示
  - 临时禁用结束时间、忽略列表等策略会实时同步到 Rust 端，跨进程保持一致

### 🔄 自动更新

- **更新横幅**：标题栏内置 `UpdateBanner`，自动展示版本号、发布日期、更新日志与 Release 链接，状态覆盖「可下载 / 下载中 / 可安装 / 失败」四种情况
- **自动后台下载**：开启「自动更新」后，检测到新版本会自动匹配当前操作系统的安装包，触发下载并通过日志+轮询展示进度；失败会自动重试并恢复「待下载」状态
- **快速安装**：下载完成即可点击「立即安装」，前端调用 `installUpdateNow`，Rust 端负责启动安装器并安全退出主进程；更新信息同步到 About 页面，方便回顾

### 🧪 注入调试实验室

- **一键创建调试 Webview**：可为任意平台生成 `debug-*` 子窗口，窗口布局与主界面保持一致，并支持手动隐藏/恢复/关闭
- **脚本与模板自检**：内置多组脚本（简单日志、诊断脚本、注入模板）可逐条执行，实时显示执行耗时与错误信息
- **结果可视化**：注入结果、提取内容、事件日志会分块展示，同时解码自定义导航回传的数据，便于核对动作序列
- **事件联动**：与主应用共用 `hideAllWebviews / restoreWebviews` 事件，托盘/快捷键行为完全一致，可在不影响主流程的情况下调试模板

### 🪟 窗口与交互

- **主窗口**
  - 单页应用（SPA），渲染稳定、切换迅速
  - 无边框设计，自定义标题栏
  - 顶部标题栏可拖拽（按钮区域禁用拖拽，避免误操作）
  - 关闭按钮行为：隐藏到系统托盘（非直接退出）
  - 最小化按钮已移除（更简洁）
  - 默认尺寸：1200x800，最小尺寸：900x600
- **子窗口（Webview）**
  - 每个 AI/翻译平台独立 Webview 子窗口
  - 无边框、透明背景、始终置顶
  - 自动跟随主窗口位置/大小/DPI 缩放变化
  - 智能焦点管理：切换平台时仅显示当前平台，`hideAllWebviews → show` 流程贯穿托盘/快捷键
  - 跟随主窗口隐藏/显示：同步动画避免闪烁，支持标记需恢复的窗口集合
  - 冷/暖启动策略：首次创建等待完整加载（≥800ms），复用窗口则快速切换（≥120ms）并在聚焦后额外等待 200ms
  - Webview Ready 事件：前端与 Rust 之间通过 `child-webview:*` 事件同步加载状态，便于选择注入时机
  - 独立代理配置，支持热切换
- **划词工具栏窗口**
  - 独立浮动窗口，无边框、始终置顶
  - 尺寸：120x38 逻辑像素（自适应 DPI）
  - 智能定位：光标偏移 (10, 12) 避免遮挡
  - 自动跟随系统深色/浅色主题
  - 跨平台 Webview 渲染，支持自定义样式
- **系统托盘**
  - 左键点击：显示/隐藏主窗口
  - 右键菜单：显示、偏好设置、退出
  - 托盘图标适配系统主题（macOS Template Icon）
- **全局快捷键**
  - **主窗口切换**：Ctrl/Cmd+Shift+A（可自定义）
  - **翻译快捷键**：Ctrl/Cmd+Shift+T（可自定义）
  - **划词工具栏**：Ctrl/Cmd+Shift+S（可自定义）
  - 隐藏流程：事件广播 → 隐藏 Webview → 延迟 100ms → 隐藏主窗口
  - 快捷键节流：350ms 内重复触发会被自动忽略，避免经常性抖动

### 🔧 平台管理

- **内置平台管理**
  - 11 个预配置 AI 平台，5 个翻译平台
  - 独立启用/禁用开关
  - 平台图标本地化（避免网络加载）
- **自定义平台**
  - 添加任意 AI 网站（名称、URL、图标）
  - 自定义平台标记（Custom 标签）
  - 仅自定义平台可删除（内置平台仅可禁用）
- **排序与组织**
  - 拖拽排序（基于 sortOrder 持久化）
  - 上移/下移快捷按钮
  - 侧边栏实时同步显示顺序
- **Webview 生命周期管理**
  - 懒加载：首次切换时创建 Webview
  - 自动缓存：切换后保持后台状态
  - 缓存清理：设置中一键清除所有后台页面

### ⚙️ 设置中心

- **通用设置（General）**
  - **语言**：简体中文、English、日本語、한국어
  - **外观**：跟随系统、浅色模式、深色模式
  - **快捷键**：
    - 全局快捷键（主窗口切换）
    - 翻译快捷键（快速打开翻译）
    - 划词工具栏快捷键（选中文字后显示）
    - 支持 8 种预设组合，并同步到 Rust 端注册，含 350ms 节流
  - **启动**：
    - 开机自启动（系统登录时自动运行）
    - 自动更新（后台下载，下次启动安装，可选择自动或手动下载）
  - **划词工具栏**：
    - 启用/禁用全局划词功能、切换默认 AI 解释平台/默认翻译器
    - 维护忽略应用列表，防止在指定程序中弹出
    - 配置临时禁用时长与到期时间，前端实时显示倒计时并可一键恢复
  - **性能与预加载**：
    - 是否在启动后后台预加载默认平台（可降低首次打开等待）
    - 预加载顺序遵循「划词默认→上次使用→手动默认→第一个启用」
  - **权限**：
    - macOS 自动检测/请求 Accessibility 权限，缺失时提供指引按钮
  - **缓存管理**：
    - 清理所有后台 AI/翻译 WebView（重置会话与登录状态）
- **平台设置（Platforms）**
  - **显示顺序**：拖拽或上移/下移调整
  - **内置平台**：启用/禁用 11 个 AI 平台
  - **自定义平台**：添加、编辑、删除自定义平台
- **翻译设置（Translation）**
  - **默认翻译引擎**：Google、DeepL、有道、百度、微软
  - **翻译平台管理**：同一时间仅启用一个
  - **支持的语言列表**展示
- **代理设置（Proxy）**
  - **代理类型**：系统代理 / 自定义代理
  - **自定义配置**：代理地址 + 端口（1-65535）
  - **连接测试**：一键测试连通性和延迟
- **关于（About）**
  - 应用名称、版本号、许可证信息

### 🌍 国际化（i18n）

- **支持语言**（4 种）
  - 简体中文（zh-CN）- 默认
  - English（en-US）
  - 日本語（ja-JP）
  - 한국어（ko-KR）
- **完整翻译覆盖**
  - 所有 UI 界面文字
  - 设置面板提示信息
  - 错误消息与警告
  - 划词工具栏提示
  - AI 提示词模板
- **技术实现**
  - 按需加载语言包（减少初始加载）
  - 结构化键值管理（点分隔命名）
  - 运行时语言切换（无需重启）
  - 浏览器语言自动检测

### 🔒 持久化与安全

- **本地数据存储**
  - **Tauri Store**：用户配置、平台设置、翻译偏好
  - **Webview 独立存储**：每个平台独立 Cookie、LocalStorage、IndexedDB
  - **数据位置**：
    - Windows: `%APPDATA%/com.200hub.aiask`
    - macOS: `~/Library/Application Support/com.200hub.aiask`
    - Linux: `~/.config/com.200hub.aiask`
- **隐私保护**
  - 所有 UI 本地渲染，无外部数据收集
  - AI 对话数据存储在各平台 Webview 中
  - 不上传用户选择的文字或翻译内容
- **网络安全**
  - 代理配置支持（全局或平台级）
  - HTTPS 强制（翻译和 AI 平台）
  - CSP 内容安全策略
- **更新机制**
  - 自动检查 GitHub Releases
  - 后台静默下载（可配置）
  - 下次启动时安装（不中断当前会话）

### 🏗️ 开发与架构

#### 技术栈

- **前端**
  - 框架：SvelteKit 2.x + Svelte 5（Runes API）
  - 语言：TypeScript 5.6
  - 构建：Vite 6
  - UI 库：lucide-svelte（图标）
  - 样式：纯 CSS + CSS Variables
  - 测试：Vitest + jsdom
- **后端**
  - 框架：Tauri 2.0
  - 语言：Rust 1.70+（Edition 2021）
  - 核心依赖：tauri-plugin-store、global-shortcut、autostart、rdev、reqwest
  - 平台特定：windows crate（Windows）、accessibility（macOS）
  - 测试：Cargo test + tempfile

#### 后端模块

```
src-tauri/src/
├── lib.rs               # Tauri 命令注册
├── window_control.rs    # 主窗口管理、托盘、快捷键
├── webview.rs           # 子 Webview 管理
├── selection_toolbar.rs # 划词工具栏窗口
├── global_selection.rs  # 全局选择监听
├── proxy.rs             # 代理配置与测试
├── update.rs            # 自动更新
└── utils.rs             # 工具函数
```

#### 前端架构

```
src/
├── routes/              # SvelteKit 路由（SPA 模式）
│   ├── +page.svelte     # 主页面
│   └── toolbar/         # 划词工具栏页面
├── lib/
│   ├── components/      # UI 组件
│   │   ├── common/      # Button、LoadingSpinner、UpdateBanner
│   │   ├── layout/      # Header、Sidebar、MainContent
│   │   ├── pages/       # AIChat、TranslationPage、SelectionToolbar
│   │   └── settings/    # 设置面板组件
│   ├── stores/          # Svelte 5 Runes 状态管理
│   │   ├── app.svelte.ts
│   │   ├── config.svelte.ts
│   │   ├── platforms.svelte.ts
│   │   ├── translation.svelte.ts
│   │   └── toolbar.svelte.ts
│   ├── utils/           # 工具函数
│   │   ├── constants.ts          # 常量定义
│   │   ├── injection-templates.ts # 注入模板注册表
│   │   ├── selection-actions.ts  # 划词操作逻辑
│   │   └── ...
│   ├── i18n/            # 国际化（zh-CN/en-US/ja-JP/ko-KR）
│   ├── types/           # TypeScript 类型定义
│   └── __tests__/       # 单元测试（63 个用例）
```

#### 核心设计模式

- **状态管理**：Svelte 5 Runes（$state/$derived/$effect）
- **Webview 管理**：代理模式（ChildWebviewProxy）
- **注入系统**：模板注册表 + 脚本生成器
- **事件通信**：Tauri invoke/emit + DOM CustomEvent

#### 开发命令

```bash
pnpm tauri dev          # 开发模式
pnpm tauri build        # 生产构建
pnpm run check          # TypeScript 检查
pnpm lint               # ESLint + Rust fmt/clippy
pnpm test               # 所有测试（前后端）
pnpm version:sync       # 同步版本号
```

### ✨ 体验优化

- **窗口管理**：`ChildWebviewProxy` 统一计算边界，`hideAllWebviews → show` 事件链兼容托盘/快捷键/设置页；翻译/聊天窗口移动、缩放、失焦都会同步重排
- **性能优化**：
  - 组件层面使用懒加载（chat/translation/settings/debug），首屏仅加载 Welcome
  - `preloadDefaultPlatforms` + 冷/暖启动最小加载时间，兼顾响应速度与视觉稳定
  - Webview Ready 事件 + 智能超时（新建 8s/复用 2s），注入逻辑始终等待可用后再执行
  - i18n 包按需加载，图标本地化避免网络抖动
- **用户体验**：
  - Header UpdateBanner、LoadingSpinner、错误 toast、倒计时提示完善反馈链路
  - 划词工具栏签名/去抖/光标对齐策略，保证跨应用体验一致
  - 代理测试、快捷键切换等操作均给出即时提示
- **调试友好**：结构化 logger（四级别 + 内存缓冲）、Debug Injection Page、详细错误堆栈、DevTools 支持，方便排查注入/网络问题

### 🛡️ 质量保障

- **代码规范**：TypeScript 严格模式、Svelte Runes only、CSS Variables、Rust clippy
- **测试覆盖**：前端 63 个测试、后端 27 个测试
- **质量门禁**：类型检查零错误、Lint 零警告、所有测试通过

---

## 🚀 快速开始

### 环境要求

- **Node.js**: 18.0+
- **pnpm**: 8.0+
- **Rust**: 1.70+ （会自动通过 rustup 安装）
- **操作系统**：Windows 10/11、macOS 10.15+、Linux（主流发行版）

### 平台特定要求

**macOS**:

```bash
xcode-select --install
```

**Linux (Ubuntu/Debian)**:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Linux (Fedora)**:

```bash
sudo dnf install webkit2gtk4.0-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel
```

**Linux (Arch)**:

```bash
sudo pacman -S webkit2gtk base-devel curl wget file openssl \
  appmenu-gtk-module gtk3 libappindicator-gtk3 librsvg
```

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/ai-ask.git
cd ai-ask

# 2. 安装依赖
pnpm install

# 3. 启动开发模式
pnpm tauri dev

# 或使用快捷脚本
./start.sh   # macOS/Linux
start.bat    # Windows
```

### 生产构建

```bash
# 构建应用
pnpm tauri build

# 构建输出位置：src-tauri/target/release/bundle/
```

**支持的构建格式**：

- Windows: MSI、NSIS 安装包
- macOS: DMG、App Bundle
- Linux: DEB、AppImage、RPM

## ⚖️ 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。
