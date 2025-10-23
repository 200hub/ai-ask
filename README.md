# AI Ask - 智能划词搜索助手# Tauri + Vanilla



一个基于 Tauri + Svelte 5 的轻量级AI搜索助手，支持划词搜索和快捷键触发。This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.



## ✨ 功能特性## Recommended IDE Setup



- 🎯 **划词搜索**: 选中文本后自动显示"AI搜索"按钮- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

- ⌨️ **快捷键支持**: `Ctrl/Cmd + Shift + S` 快速搜索选中文本
- 🤖 **多模型支持**: ChatGPT、Claude、Gemini、Perplexity
- 🎨 **主题适配**: 自动适配系统浅色/深色主题
- 💾 **轻量设计**: 内存占用低，安装体积小
- 🔄 **后台常驻**: 最小化到系统托盘，随时可用
- 🆓 **免费使用**: 仅使用免费的网页搜索，无需API密钥

## 🚀 快速开始

### 安装依赖
```bash
pnpm install
```

### 开发模式
```bash
pnpm tauri:dev
```

### 构建应用
```bash
pnpm tauri:build
```

## 📖 使用说明

1. 启动应用后，它会最小化到系统托盘
2. 点击托盘图标打开窗口，配置想要使用的AI模型
3. 选中文本后点击"AI搜索"按钮，或使用快捷键 `Ctrl/Cmd + Shift + S`
4. 应用会显示搜索链接，点击在浏览器中打开相应AI服务

## 🛠️ 技术栈

- Svelte 5 + TypeScript
- Tauri 2 + Rust
- Vite + pnpm
