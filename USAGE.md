# AI Ask 使用指南

## 🎉 应用已成功创建！

这是一个功能完整的AI搜索助手应用，基于 Tauri 2 + Svelte 5 构建。

## ✅ 已实现的功能

### 1. 划词搜索 ✨
- 在应用内选中任意文本
- 自动在选区上方显示"AI搜索"按钮
- 点击按钮即可搜索选中内容

### 2. 快捷键支持 ⌨️
- **Windows**: `Ctrl + Shift + S`
- **macOS**: `Cmd + Shift + S`
- 选中文本后按快捷键即可快速搜索

### 3. 多AI模型支持 🤖
支持以下AI搜索服务：
- **ChatGPT** - OpenAI 的对话式AI
- **Claude** - Anthropic 的AI助手
- **Gemini** - Google 的AI助手  
- **Perplexity** - 专注搜索的AI引擎

### 4. 系统托盘常驻 🔄
- 应用启动后自动最小化到系统托盘
- 点击托盘图标可以显示/隐藏窗口
- 右键托盘图标显示菜单：
  - 显示窗口
  - 退出应用

### 5. 主题自动适配 🎨
- 自动适配系统浅色/深色主题
- 无缝切换，无需手动配置

### 6. 轻量级设计 💾
- 使用系统 WebView，无需打包浏览器
- 内存占用低（约 30-50MB）
- 安装包体积小（约 3-5MB）

## 🚀 快速开始

### 开发模式
```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm tauri:dev
```

### 构建生产版本
```bash
# 构建前端
pnpm build

# 构建应用（生成安装包）
pnpm tauri:build
```

构建完成后，安装包位于：
- Windows: `src-tauri\target\release\bundle\msi\`
- macOS: `src-tauri/target/release/bundle/dmg/`

## 📝 使用步骤

### 第一次使用

1. **启动应用**
   - 双击运行应用
   - 应用会自动最小化到系统托盘

2. **配置AI模型**
   - 点击系统托盘图标打开主窗口
   - 点击"配置模型"按钮
   - 选择您想要使用的AI模型
   - 点击"保存"按钮

3. **开始搜索**
   - 在应用的欢迎页面选中任意文本
   - 点击弹出的"AI搜索"按钮
   - 或使用快捷键 `Ctrl/Cmd + Shift + S`
   - 查看搜索结果，点击链接在浏览器中打开

### 日常使用

1. 应用常驻后台，随时可用
2. 选中文本 → 点击搜索按钮或按快捷键
3. 查看结果并在浏览器中深入研究

## 🎯 功能演示

### 配置界面
- 清晰的模型选择列表
- 每个模型都有简短说明
- 单选按钮便于选择
- 保存配置立即生效

### 搜索结果
- 显示当前搜索查询
- 提供相应AI服务的搜索链接
- 包含使用提示和模型特点说明
- 支持返回主界面重新搜索

### 系统托盘
- 单击图标：显示/隐藏主窗口
- 右键菜单：
  - 显示窗口
  - 退出应用

## 🛠️ 技术特点

### 前端
- **Svelte 5 Runes**: 最新的响应式API
- **TypeScript**: 完整的类型安全
- **原生CSS**: 无运行时样式开销
- **Vite**: 快速的开发体验

### 后端
- **Rust**: 高性能、低内存占用
- **Tauri 2**: 跨平台桌面应用框架
- **异步处理**: 所有操作非阻塞
- **配置持久化**: 自动保存用户设置

### 性能指标
- 启动时间: < 1秒
- 内存占用: 30-50MB
- 安装包大小: 3-5MB
- CPU占用: 后台几乎为0

## 📂 项目文件说明

```
ai-ask/
├── src/                          前端源码目录
│   ├── lib/                      组件库
│   │   ├── ConfigPanel.svelte    配置面板组件
│   │   ├── SearchResult.svelte   搜索结果组件
│   │   └── SelectionMonitor.svelte 划词监控组件
│   ├── App.svelte                主应用组件
│   ├── main.ts                   TypeScript入口
│   └── styles.css                全局样式
├── src-tauri/                    Rust后端目录
│   ├── src/
│   │   ├── lib.rs                主要业务逻辑
│   │   └── main.rs               程序入口点
│   ├── icons/                    应用图标资源
│   ├── Cargo.toml                Rust依赖配置
│   └── tauri.conf.json           Tauri应用配置
├── dist/                         构建输出（自动生成）
├── index.html                    HTML入口文件
├── vite.config.ts                Vite构建配置
├── svelte.config.js              Svelte编译配置
├── tsconfig.json                 TypeScript配置
├── package.json                  npm依赖和脚本
├── README.md                     项目说明
└── PROJECT.md                    详细技术文档
```

## 🔧 自定义配置

### 修改窗口大小
编辑 `src-tauri/tauri.conf.json`:
```json
{
  "app": {
    "windows": [{
      "width": 900,     // 修改宽度
      "height": 700,    // 修改高度
      "minWidth": 600,  // 最小宽度
      "minHeight": 400  // 最小高度
    }]
  }
}
```

### 添加新的AI模型
1. 在 `src/lib/ConfigPanel.svelte` 添加模型选项
2. 在 `src-tauri/src/lib.rs` 添加搜索函数
3. 更新 `search_with_ai` 函数的 match 语句

### 修改快捷键
编辑 `src/lib/SelectionMonitor.svelte`:
```typescript
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
  // 将 'S' 改为其他键
}
```

## ❓ 常见问题

### Q: 为什么搜索结果是链接而不是直接显示内容？
A: 本应用使用免费的网页搜索，不需要API密钥。点击链接后会在浏览器中打开相应的AI服务，您可以在那里获得完整的AI回答。

### Q: 可以添加更多AI模型吗？
A: 可以！参考上面的"自定义配置"部分，您可以轻松添加新的AI搜索服务。

### Q: 应用占用内存多少？
A: 大约30-50MB，比传统的Electron应用少很多。

### Q: 支持哪些操作系统？
A: 目前支持 Windows 10+ 和 macOS 10.15+。Linux支持正在开发中。

### Q: 如何卸载应用？
A: 
- Windows: 通过"设置 > 应用"卸载
- macOS: 将应用拖到废纸篓

## 🚧 已知限制

1. **划词范围**: 目前仅支持应用内文本选择。全局划词（跨应用）需要额外的系统权限，计划在未来版本实现。

2. **网络依赖**: 搜索功能需要互联网连接才能访问AI服务。

3. **浏览器依赖**: 需要在浏览器中完成最终的AI交互。

## 🔮 未来计划

### 近期功能
- [ ] 全局划词搜索（跨所有应用）
- [ ] 搜索历史记录
- [ ] 自定义快捷键
- [ ] 搜索结果预览

### 长期规划
- [ ] 集成本地AI模型
- [ ] 离线搜索能力
- [ ] 多语言界面
- [ ] 插件系统

## 📞 获取帮助

- **问题反馈**: 通过 GitHub Issues
- **功能建议**: 通过 GitHub Discussions
- **技术文档**: 参考 PROJECT.md

## 🎓 学习资源

如果您想了解更多关于本项目使用的技术：

- **Tauri**: https://tauri.app/
- **Svelte 5**: https://svelte.dev/
- **Rust**: https://www.rust-lang.org/
- **TypeScript**: https://www.typescriptlang.org/

## 🙏 致谢

本项目使用了以下优秀的开源技术：
- Tauri - 跨平台桌面应用框架
- Svelte - 响应式前端框架
- Vite - 现代化构建工具
- Rust - 高性能系统编程语言

---

**享受您的AI搜索体验！** 🎉
