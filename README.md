# AI Ask

<div align="center">

![AI Ask](https://img.shields.io/badge/AI%20Ask-v1.0.0-blue?style=for-the-badge)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![Svelte](https://img.shields.io/badge/Svelte-5.0-FF3E00?style=for-the-badge&logo=svelte)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-CE422B?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**一个功能完整、架构优雅的跨平台 AI 问答助手桌面应用**

支持多 AI 平台切换 · 智能翻译 · 国际化 · 状态持久化 · LRU 缓存管理

</div>

---

## 📖 项目简介

AI Ask 是一个基于 **Tauri 2.0** + **Svelte 5** 构建的现代化桌面应用，提供统一、优雅的界面来访问多个 AI 平台，无需在浏览器标签间频繁切换。

### 🎯 核心价值

- **统一入口**：一个应用访问所有 AI 平台
- **状态保持**：智能 LRU 缓存，保持登录状态和对话历史
- **跨平台**：Windows、macOS、Linux 完全支持
- **国际化**：完整支持中文、英文、日文、韩文
- **高性能**：Rust 后端 + Svelte 5 响应式前端
- **可扩展**：支持自定义 AI 平台和翻译服务

---

## ✨ 功能特性

### 🤖 多 AI 平台支持

**内置 14+ 主流 AI 平台**，开箱即用：

| 国际平台 | 国内平台 |
|---------|---------|
| ChatGPT (OpenAI) | 通义千问 (阿里) |
| Claude (Anthropic) | 文心一言 (百度) |
| Gemini (Google) | Kimi (月之暗面) |
| Copilot (Microsoft) | DeepSeek (幻方) |
| Grok | 豆包 (字节) |
| Meta AI | 腾讯元宝 (腾讯) |

**特性**：
- iframe 方式内嵌各平台网页
- 独立状态管理，互不干扰
- 智能 LRU 缓存（最多保留 5 个活跃平台）
- 快速切换，保持登录状态和对话历史

### 🌐 智能翻译功能

**内置 5 个免费翻译平台**（无需登录）：
- Google 翻译
- DeepL 翻译
- 有道翻译
- 百度翻译
- 微软翻译

**特性**：
- 独立翻译页面
- 平台无缝切换
- 偏好设置持久化

### 🎨 主题系统

- **浅色主题**：适合白天使用
- **深色主题**：适合夜间使用
- **跟随系统**：自动同步系统主题

### 🌍 国际化支持

完整支持 4 种语言：
- 🇨🇳 简体中文 (zh-CN)
- 🇺🇸 英语 (en-US)
- 🇯🇵 日语 (ja-JP)
- 🇰🇷 韩语 (ko-KR)

### ⌨️ 全局快捷键

- **显示/隐藏窗口**：`Ctrl+Shift+A` (Windows/Linux) / `Cmd+Shift+A` (macOS)
- **快速翻译**：`Ctrl+Shift+T` (Windows/Linux) / `Cmd+Shift+T` (macOS)
- 支持自定义快捷键配置

### 🖥️ 系统托盘集成

- 关闭窗口最小化到托盘
- 左键点击显示/隐藏窗口
- 右键菜单快速操作
- 自定义托盘图标

### 🎯 自定义窗口控制

- 无边框窗口设计
- 自定义标题栏
- 窗口拖拽支持
- 最小化、关闭按钮

### 🧠 智能内存管理

**LRU (Least Recently Used) 缓存策略**：
- 最多保留 5 个活跃 iframe
- 自动清理最久未使用的页面
- 当前页面不会被清理
- 手动清理缓存选项

### 🔧 代理配置

三种代理模式：
- **无代理**：直接连接（默认）
- **系统代理**：使用操作系统配置
- **自定义代理**：手动配置服务器地址和端口

### 🔄 其他特性

- **智能刷新**：只刷新内容区域，不影响整体状态
- **Tooltip 提示**：完整覆盖所有交互元素
- **配置持久化**：所有设置自动保存
- **响应式 UI**：适配不同窗口大小

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
