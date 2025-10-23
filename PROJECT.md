# AI Ask - 项目说明文档

## 项目概述

AI Ask 是一个基于 Tauri 2 + Svelte 5 构建的跨平台AI搜索助手应用，支持划词搜索功能和系统托盘常驻。

## 核心功能

### 1. 划词搜索
- **实现方式**: 通过监听 `mouseup` 和 `keyup` 事件检测文本选择
- **交互**: 选中文本后在选区上方显示"AI搜索"按钮
- **位置计算**: 使用 `Range.getBoundingClientRect()` 获取选区位置
- **组件**: `SelectionMonitor.svelte`

### 2. 快捷键支持
- **快捷键**: `Ctrl/Cmd + Shift + S`
- **功能**: 直接搜索当前选中的文本
- **跨平台**: 自动适配 Windows (Ctrl) 和 macOS (Cmd)

### 3. AI模型配置
- **支持的模型**:
  - ChatGPT (OpenAI)
  - Claude (Anthropic)
  - Gemini (Google)
  - Perplexity
- **配置持久化**: 使用 JSON 文件存储在系统配置目录
- **路径**: `~/.config/ai-ask/config.json` (Linux/macOS) 或 `%APPDATA%\ai-ask\config.json` (Windows)

### 4. 系统托盘
- **常驻后台**: 应用启动后最小化到系统托盘
- **托盘菜单**:
  - 显示窗口
  - 退出应用
- **单击托盘图标**: 显示/聚焦主窗口

### 5. 主题适配
- **自动适配**: 使用 CSS `prefers-color-scheme` 媒体查询
- **支持模式**: 浅色模式和深色模式
- **无缝切换**: 跟随系统主题自动切换

## 技术架构

### 前端技术栈
- **框架**: Svelte 5 (Runes Mode)
- **语言**: TypeScript
- **构建工具**: Vite 7
- **样式**: 原生 CSS (支持媒体查询)

### 后端技术栈
- **框架**: Tauri 2
- **语言**: Rust
- **依赖库**:
  - `serde`: JSON 序列化
  - `dirs`: 跨平台目录
  - `urlencoding`: URL 编码
  - `tauri-plugin-*`: 官方插件

### 关键组件

#### 前端组件

1. **App.svelte** (主应用)
   - 状态管理
   - 路由控制
   - 事件协调

2. **ConfigPanel.svelte** (配置面板)
   - 模型选择界面
   - 配置保存
   - 用户交互

3. **SearchResult.svelte** (搜索结果)
   - 结果展示
   - 加载状态
   - HTML 渲染

4. **SelectionMonitor.svelte** (划词监控)
   - 文本选择检测
   - 按钮定位
   - 快捷键处理

#### 后端命令

1. **get_config**
   - 读取配置文件
   - 返回当前模型设置

2. **save_config**
   - 保存模型配置
   - 写入配置文件

3. **search_with_ai**
   - 构造搜索 URL
   - 返回格式化的 HTML 结果

4. **show_main_window**
   - 显示主窗口
   - 设置窗口焦点

## 项目结构

```
ai-ask/
├── src/                          # 前端源码
│   ├── lib/                      # 组件库
│   │   ├── ConfigPanel.svelte    # 配置面板
│   │   ├── SearchResult.svelte   # 搜索结果
│   │   └── SelectionMonitor.svelte # 划词监控
│   ├── App.svelte                # 主应用
│   ├── main.ts                   # 入口文件
│   └── styles.css                # 全局样式
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # 主逻辑
│   │   └── main.rs               # 入口
│   ├── icons/                    # 应用图标
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置
├── index.html                    # HTML 入口
├── vite.config.ts                # Vite 配置
├── svelte.config.js              # Svelte 配置
├── tsconfig.json                 # TypeScript 配置
├── package.json                  # npm 依赖
└── README.md                     # 项目说明
```

## 开发指南

### 环境准备

1. 安装 Node.js 18+ 和 pnpm
2. 安装 Rust 1.70+
3. 安装 Tauri 系统依赖

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri:dev

# 构建前端
pnpm build

# 构建应用
pnpm tauri:build
```

### 代码规范

- 使用 TypeScript 严格模式
- 遵循 Svelte 5 Runes 最佳实践
- Rust 代码遵循 Clippy 建议
- 使用有意义的变量和函数命名

## 性能优化

### 前端优化
1. **按需渲染**: 使用 Svelte 的响应式系统
2. **组件懒加载**: 条件渲染减少初始加载
3. **CSS 优化**: 使用原生 CSS，避免运行时样式计算
4. **事件节流**: 避免频繁的 DOM 操作

### 后端优化
1. **异步处理**: 所有命令使用 async/await
2. **配置缓存**: 内存中缓存配置，减少磁盘读取
3. **轻量依赖**: 仅引入必要的 crate
4. **编译优化**: Release 模式启用 LTO

### 包体积优化
- Tauri 使用系统 WebView，无需打包浏览器引擎
- Svelte 编译时优化，无运行时开销
- Rust 静态编译，最小化依赖
- 资源压缩和 tree-shaking

## 跨平台支持

### Windows
- 使用 WebView2
- 系统托盘支持
- 快捷键: Ctrl + Shift + S
- 配置路径: `%APPDATA%\ai-ask`

### macOS
- 使用 WKWebView
- 菜单栏图标
- 快捷键: Cmd + Shift + S
- 配置路径: `~/Library/Application Support/ai-ask`

### Linux (计划中)
- 使用 WebKitGTK
- 系统托盘支持
- 快捷键: Ctrl + Shift + S
- 配置路径: `~/.config/ai-ask`

## 安全性

1. **CSP 策略**: 配置内容安全策略
2. **权限最小化**: 仅请求必要的系统权限
3. **输入验证**: 后端验证所有用户输入
4. **安全更新**: 及时更新依赖库

## 已知限制

1. **划词范围**: 当前仅支持应用内文本选择
2. **网络依赖**: 搜索功能需要互联网连接
3. **浏览器依赖**: 需要在浏览器中打开搜索链接

## 未来规划

### 短期计划
- [ ] 全局划词搜索支持
- [ ] 搜索历史记录
- [ ] 快捷键自定义

### 长期计划
- [ ] 本地 AI 模型集成
- [ ] 搜索结果缓存
- [ ] 多语言支持
- [ ] 插件系统

## 问题排查

### 常见问题

1. **应用无法启动**
   - 检查 Rust 和 Node.js 版本
   - 重新安装依赖: `pnpm install`
   - 清理构建缓存: `cargo clean`

2. **托盘图标不显示**
   - Windows: 确保 WebView2 已安装
   - macOS: 检查系统偏好设置

3. **快捷键不工作**
   - 检查是否与其他应用冲突
   - 确认应用有前台焦点

## 贡献指南

欢迎提交 Issues 和 Pull Requests！

### 提交规范
- Issue: 清晰描述问题和重现步骤
- PR: 包含测试和文档更新
- Commit: 使用语义化提交信息

## 许可证

MIT License - 详见 LICENSE 文件

## 联系方式

- GitHub Issues: 报告问题
- Discussions: 功能建议和讨论
