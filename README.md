# AI Ask

<div align="center">

![AI Ask](https://img.shields.io/badge/AI%20Ask-v1.0.0-blue?style=for-the-badge)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00?style=for-the-badge&logo=svelte)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-CE422B?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**一个功能完整、架构优雅的跨平台 AI 问答助手桌面应用**

支持多 AI 平台切换 · 智能翻译 · 国际化 · 状态持久化

</div>

---

## 📖 项目简介

AI Ask 是一个基于 **Tauri 2.0** + **Svelte 5** 构建的现代化桌面应用，提供统一、优雅的界面来访问多个 AI 平台，无需在浏览器标签间频繁切换。

### 🎯 核心价值

- **统一入口**：一个应用访问所有 AI 平台
- **状态保持**：保持登录状态和对话历史（按平台独立存储）
- **跨平台**：Windows、macOS、Linux 完全支持
- **国际化**：完整支持中文、英文、日文、韩文
- **高性能**：Rust 后端 + Svelte 5 响应式前端
- **可扩展**：支持自定义 AI 平台和翻译服务

---

## ✨ 功能清单

### 核心功能
- AI 问答
  - 支持在应用内使用多个 AI 平台
  - 可在不同平台之间快速切换
  - 独立 Webview 窗口承载平台界面，体验接近原生
- 翻译功能
  - 独立“翻译”页面
  - 提供翻译相关的专用设置面板（如默认目标语言、行为等）

### 窗口与交互
- 主窗口
  - 单页应用（SPA），渲染稳定、切换迅速
  - 顶部标题栏可拖拽（按钮区域禁用拖拽，避免误操作）
  - 关闭按钮行为：隐藏到系统托盘（非直接退出）
  - 最小化按钮已移除（更简洁）
- 子窗口（Webview）
  - 每个平台对应一个无边框 Webview 子窗口
  - 自动跟随主窗口位置/大小/DPI 缩放变化进行重排
  - 焦点变化时自动管理“置顶”状态，切换平台时仅当前平台显示
  - 跟随主窗口隐藏/显示：从托盘或快捷键隐藏主窗口时，所有 Webview 同步隐藏
- 系统托盘
  - 左键点击：显示/隐藏主窗口（前端同步隐藏 Webview）
  - 菜单项：显示主窗口、偏好设置、退出
- 全局快捷键
  - 切换显示/隐藏主窗口：Windows/Linux 为 Ctrl+Shift+A，macOS 为 Cmd+Shift+A
  - 隐藏时先广播隐藏 Webview，再隐藏主窗口，避免闪烁/残留

### 平台管理
- 平台列表
  - 平台排序（上移/下移），基于 sortOrder 存储，顺序稳定
  - 切换平台时自动隐藏其它平台 Webview
  - 排序/切换行为带有调试日志，便于定位问题

### 设置中心
- 通用设置（General）
  - 常用行为选项（例如语言、基础偏好等）
- 平台设置（Platform）
  - 管理多 AI 平台
  - 调整展示顺序（稳定排序，持久化保存）
- 翻译设置（Translation）
  - 配置翻译相关参数（如默认目标语言等）
- 代理设置（Proxy）
  - 支持“自定义代理 / 不使用代理”
  - 一键测试代理连通性（含耗时）
- 关于（About）
  - 应用信息与版本

### 国际化（i18n）
- 内置多语言界面
  - 简体中文（zh-CN）
  - 英语（en-US）
  - 日语（ja-JP）
  - 韩语（ko-KR）
- 文案结构化管理，统一键值命名，新增文案需四语言同步补全

### 持久化与安全
- 本地数据持久化
  - 前端配置本地存储
  - 后端使用 tauri-plugin-store（无需额外服务）
- 隐私与网络
  - 所有 UI 本地渲染
  - 网络请求可通过代理策略控制

### 开发与架构
- 技术栈
  - 前端：SvelteKit 2.x + Svelte 5（Runes API）+ TypeScript 5.6 + Vite 6
  - 后端：Tauri 2.0（Rust 1.70+）
  - UI：纯 CSS，使用项目变量；图标 lucide-svelte
- 路由与渲染
  - SvelteKit 文件路由
  - 适配器：@sveltejs/adapter-static
  - 渲染模式：SPA（SSR 已禁用）
- 运行与构建
  - 开发：pnpm tauri dev（Vite + Tauri 同步启动）
  - 构建：pnpm tauri build（跨平台打包）
- 代码规范
  - 强制使用 Svelte 5 Runes（$state/$derived/$effect）
  - TypeScript 类型完整、公共 API 必有类型
  - CSS 使用项目变量与 rem 单位

### 体验优化
- Webview 动态置顶管理：聚焦主窗口时置顶，失焦时取消置顶，避免遮挡
- 主窗口移动/缩放/分辨率变化时，Webview 自动重排与重算布局
- 隐藏/显示流程带缓冲（事件 → 同步隐藏 Webview → 再隐藏主窗口），减少闪烁
- 全局与页面日志（带前缀），便于排查

### 质量基线
- 类型检查：svelte-check 全通过（0 error）
- 运行：Vite/Tauri Dev 均能稳定启动
- 构建：Tauri 打包成功（icons、配置完整）

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

### 添加新功能

详细的开发指南请参考 `AGENTS.md` 文档，包含：
- 添加新 AI 平台
- 添加新翻译服务
- 创建新组件
- 添加国际化翻译
- 调试技巧

## 📚 参考文档

### 项目文档

- [AGENTS.md](./AGENTS.md) - AI 任务指导文档
- [CHANGELOG.md](./CHANGELOG.md) - 版本更新日志

### 官方文档

- [Svelte 5 文档](https://svelte-5-preview.vercel.app/)
- [SvelteKit 文档](https://kit.svelte.dev/)
- [Tauri 文档](https://tauri.app/)
- [TypeScript 文档](https://www.typescriptlang.org/)

## ⚖️ 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。
