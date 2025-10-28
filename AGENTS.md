# AI Ask - AI 任务指导文档

## 📋 文档目的

本文档为 AI 助手（AI Agents）提供项目开发指导，确保：
- 理解项目技术栈和架构
- 遵循统一的开发规范
- 完成任务时满足质量标准
- 维护代码的一致性和可维护性

## 🏗️ 项目概览

### 基本信息
- **项目名称**: AI Ask
- **项目类型**: 桌面应用（跨平台）
- **主要功能**: AI 问答助手，支持多 AI 平台切换和翻译功能
- **开发状态**: 生产就绪（v1.0.0）
- **许可证**: MIT

### 技术栈

#### 前端技术
- **框架**: SvelteKit 2.x
- **UI 库**: Svelte 5.x (使用 Runes API)
- **语言**: TypeScript 5.6
- **构建工具**: Vite 6.x
- **样式**: 自定义 CSS（无 Tailwind 依赖）
- **图标**: lucide-svelte

#### 后端技术
- **框架**: Tauri 2.0
- **语言**: Rust 1.70+
- **配置**: tauri.conf.json

#### 依赖管理
- **包管理器**: pnpm 8+
- **Node 版本**: 18+

#### 适配器
- **SvelteKit 适配器**: @sveltejs/adapter-static
- **渲染模式**: SPA (SSR 已禁用)

## 📁 项目结构

```
ai-ask/
├── src/                          # 前端源码
│   ├── lib/
│   │   ├── components/           # Svelte 组件
│   │   │   ├── common/          # 通用组件
│   │   │   ├── layout/          # 布局组件
│   │   │   ├── pages/           # 页面组件
│   │   │   └── settings/        # 设置相关组件
│   │   ├── stores/              # Svelte Store (使用 Runes)
│   │   ├── types/               # TypeScript 类型定义
│   │   ├── utils/               # 工具函数
│   │   ├── i18n/                # 国际化模块
│   │   │   ├── index.ts         # i18n 核心
│   │   │   └── locales/         # 语言包
│   │   │       ├── zh-CN.ts     # 简体中文
│   │   │       ├── en-US.ts     # 英文
│   │   │       ├── ja-JP.ts     # 日文
│   │   │       └── ko-KR.ts     # 韩文
│   │   └── styles/              # 全局样式
│   │       └── base.css         # 基础样式和 CSS 变量
│   ├── routes/                  # SvelteKit 路由
│   │   ├── +layout.svelte       # 根布局
│   │   ├── +layout.ts           # 布局配置 (SSR=false)
│   │   └── +page.svelte         # 主页面
│   └── app.html                 # HTML 模板
├── src-tauri/                   # Tauri 后端
│   ├── src/
│   │   └── lib.rs               # Rust 主文件
│   ├── icons/                   # 应用图标
│   │   └── app-icon.svg         # SVG 源文件
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 配置
├── static/                      # 静态资源
├── build/                       # 构建输出
├── package.json                 # Node 依赖
├── vite.config.js              # Vite 配置
├── svelte.config.js            # Svelte 配置
├── tsconfig.json               # TypeScript 配置
└── 文档文件/                   # 各种 .md 文档

```

## 🎯 核心架构

### 1. 状态管理 (Svelte 5 Runes)

**重要**: 本项目使用 Svelte 5 的 Runes API，**不是** Svelte 4 的 store。

#### Store 定义模式
```typescript
// ❌ 错误：使用 Svelte 4 writable
import { writable } from 'svelte/store';
const count = writable(0);

// ✅ 正确：使用 Svelte 5 $state
class MyStore {
  count = $state(0);
  items = $state<Item[]>([]);
}
export const myStore = new MyStore();
```

#### 在组件中使用
```svelte
<script lang="ts">
  import { myStore } from '$lib/stores/myStore';
  
  // ❌ 错误：使用 $myStore
  console.log($myStore.count);
  
  // ✅ 正确：直接访问
  console.log(myStore.count);
</script>

<div>{myStore.count}</div>
```

#### 响应式效果
```svelte
<script lang="ts">
  // ✅ 使用 $effect 监听变化
  $effect(() => {
    console.log('Count changed:', myStore.count);
  });
  
  // ✅ 使用 $derived 计算属性
  const doubled = $derived(myStore.count * 2);
</script>
```

### 2. 路由系统

- **类型**: SvelteKit 文件系统路由
- **模式**: SPA (单页应用)
- **SSR**: 禁用 (`export const ssr = false;`)
- **适配器**: adapter-static with fallback

### 3. 组件通信

#### 父子组件通信
```svelte
<!-- Parent.svelte -->
<Child value={parentValue} onUpdate={(v) => handleUpdate(v)} />

<!-- Child.svelte -->
<script lang="ts">
  let { value, onUpdate } = $props<{
    value: string;
    onUpdate: (v: string) => void;
  }>();
</script>
```

#### 全局事件通信
```typescript
// 发送自定义事件
const event = new CustomEvent("eventName", { detail: { data } });
window.dispatchEvent(event);

// 监听自定义事件
window.addEventListener("eventName", handleEvent);
```

### 4. i18n 国际化

#### 使用方式
```svelte
<script lang="ts">
  import { i18n } from '$lib/i18n';
  
  // 响应式获取翻译函数
  const t = $derived(i18n.t);
  
  // 切换语言
  i18n.locale.set('en-US');
</script>

<div>{t('app.title')}</div>
```

#### 支持的语言
- `zh-CN`: 简体中文
- `en-US`: 英语
- `ja-JP`: 日语
- `ko-KR`: 韩语

## 💻 开发规范

### 1. TypeScript 规范

#### 类型定义
- **必须**: 为所有公共 API 定义类型
- **必须**: 使用 interface 定义对象结构
- **禁止**: 使用 `any` 类型（除非绝对必要）
- **推荐**: 使用 `type` 定义联合类型和工具类型

```typescript
// ✅ 正确
interface UserConfig {
  theme: 'light' | 'dark' | 'system';
  locale: Locale;
}

type Locale = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR';

// ❌ 错误
const config: any = { theme: 'light' };
```

#### 导出规范
```typescript
// ✅ 具名导出（推荐）
export interface Config {}
export function handleClick() {}

// ✅ 默认导出（用于单一导出）
export default class MyStore {}

// ❌ 避免混合使用
export default function() {}
export const other = 123; // 不推荐
```

### 2. Svelte 组件规范

#### 组件结构顺序
```svelte
<script lang="ts">
  // 1. 导入
  import { Component } from './Component.svelte';
  import { store } from '$lib/stores';
  
  // 2. Props 定义
  let { prop1, prop2 } = $props<Props>();
  
  // 3. 状态定义
  let localState = $state(0);
  
  // 4. 派生状态
  const computed = $derived(localState * 2);
  
  // 5. 副作用
  $effect(() => {
    console.log('Effect');
  });
  
  // 6. 函数定义
  function handleClick() {}
  
  // 7. 生命周期
  onMount(() => {});
</script>

<!-- 8. 模板 -->
<div>Content</div>

<!-- 9. 样式 -->
<style>
  div {}
</style>
```

#### 命名规范
- **组件**: PascalCase (`UserProfile.svelte`)
- **文件**: kebab-case 或 PascalCase
- **变量**: camelCase
- **常量**: UPPER_SNAKE_CASE
- **CSS 类**: kebab-case

#### Props 类型定义
```svelte
<script lang="ts">
  // ✅ 正确：使用 interface
  interface Props {
    title: string;
    count?: number;
    onUpdate?: (value: number) => void;
  }
  
  let { title, count = 0, onUpdate } = $props<Props>();
</script>
```

### 3. CSS 规范

#### CSS 变量使用
```css
/* 使用项目定义的 CSS 变量 */
.element {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem; /* 使用 rem 单位 */
}
```

#### 可用的 CSS 变量
```css
/* 颜色 */
--bg-primary, --bg-secondary, --bg-tertiary
--text-primary, --text-secondary, --text-tertiary
--border-color
--accent-color, --accent-hover
--success-color, --error-color, --warning-color

/* 阴影 */
--shadow-sm, --shadow-md, --shadow-lg
```

#### 间距规范
- 使用 rem 单位而非 px
- 常用间距：0.25rem, 0.375rem, 0.5rem, 0.625rem, 0.75rem, 1rem
- 避免使用超过 2rem 的间距

### 4. Tauri 集成规范

#### 窗口拖拽
```svelte
<!-- ✅ 正确：只在需要拖拽的区域使用 -->
<div data-tauri-drag-region>Title</div>

<!-- ✅ 正确：按钮区域禁用拖拽 -->
<button style="-webkit-app-region: no-drag;">Click</button>
```

#### 调用 Tauri API
```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-shell';

const appWindow = getCurrentWebviewWindow();
await appWindow.hide();
await open('https://example.com');
```

## ✅ 任务完成标准

### 必须满足的条件

#### 1. 代码质量检查
```bash
# TypeScript 检查
pnpm run check

# 要求：无错误 (Error)
# 允许：警告 (Warning) - 特别是 a11y 相关
```

#### 2. 构建检查
```bash
# 前端构建
pnpm build

# 要求：构建成功，无错误
# 允许：Svelte 警告（如 a11y）
```

#### 3. 运行检查
```bash
# 开发模式
pnpm tauri dev

# 要求：
# - Vite 成功启动 (如http://localhost:1420)
# - Rust 编译成功
# - 应用窗口正常打开
# - 无 JavaScript 运行时错误
```

#### 4. 功能检查
- [ ] 所有修改的功能正常工作
- [ ] 未破坏现有功能
- [ ] UI 响应正常，无明显延迟
- [ ] 没有控制台错误

#### 5. 代码规范检查
- [ ] 使用正确的 Svelte 5 Runes API
- [ ] TypeScript 类型完整
- [ ] 遵循项目命名规范
- [ ] CSS 使用项目变量
- [ ] 代码格式一致（缩进、空格）


## 🌍 i18n 补充规范

### 添加新翻译的步骤

#### 1. 确定翻译键的结构
```typescript
// 按功能模块组织
export const zhCN = {
  common: {      // 通用文本
    confirm: "确认",
    cancel: "取消",
  },
  header: {      // Header 相关
    refresh: "刷新",
  },
  settings: {    // 设置相关
    title: "设置",
  },
};
```

#### 2. 在所有语言文件中添加
必须在以下 4 个文件中同步添加：
- `src/lib/i18n/locales/zh-CN.ts`
- `src/lib/i18n/locales/en-US.ts`
- `src/lib/i18n/locales/ja-JP.ts`
- `src/lib/i18n/locales/ko-KR.ts`

#### 3. 翻译质量要求

**中文 (zh-CN)**:
- 使用简体中文
- 简洁明了，符合中文习惯
- 统一术语（如：设置、配置、保存）

**英文 (en-US)**:
- 使用美式英语拼写
- 首字母大写规则：标题用 Title Case，句子用 Sentence case
- 简洁专业

**日文 (ja-JP)**:
- 使用日语汉字和假名混合
- 保持礼貌体（です・ます体）
- 技术术语可使用片假名

**韩文 (ko-KR)**:
- 使用韩语（谚文）
- 保持敬语形式
- 技术术语可保留英文或使用韩语音译

#### 4. 使用示例

```svelte
<script lang="ts">
  import { i18n } from '$lib/i18n';
  const t = $derived(i18n.t);
</script>

<!-- 基本使用 -->
<button>{t('common.confirm')}</button>

<!-- 使用回退值 -->
<span>{t('new.key', 'Default Text')}</span>

<!-- 嵌套键值 -->
<h1>{t('settings.general.title')}</h1>
```

#### 5. 检查翻译完整性

在添加新功能后，确保：
- [ ] 所有用户可见文本都使用了 i18n
- [ ] 4 种语言的翻译都已添加
- [ ] 翻译键命名一致且有意义
- [ ] 在所有语言下测试界面显示

---

## 🔧 常见任务指南

### 任务 1: 添加新组件

#### 步骤
1. 在 `src/lib/components/` 下创建组件文件
2. 定义 Props 接口
3. 实现组件逻辑
4. 添加样式（使用 CSS 变量）
5. 如有用户可见文本，添加 i18n
6. 在父组件中导入使用

#### 模板
```svelte
<script lang="ts">
  /**
   * 组件说明
   */
  import { i18n } from '$lib/i18n';
  
  interface Props {
    title: string;
    count?: number;
    onUpdate?: (value: number) => void;
  }
  
  let { title, count = 0, onUpdate } = $props<Props>();
  
  const t = $derived(i18n.t);
  let localState = $state(0);
  
  function handleClick() {
    localState++;
    onUpdate?.(localState);
  }
</script>

<div class="component">
  <h2>{t('component.title')}</h2>
  <p>{title}</p>
  <button onclick={handleClick}>{t('common.confirm')}</button>
</div>

<style>
  .component {
    padding: 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
  }
  
  h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0.5rem 0;
  }
</style>
```

### 任务 2: 修改样式

#### 注意事项
- **禁止**使用内联样式（除非绝对必要）
- **必须**使用 CSS 变量定义的颜色
- **必须**使用 rem 单位
- **保持**紧凑的间距（不超过 1rem）

#### 修改流程
1. 找到对应的 `<style>` 块
2. 使用项目 CSS 变量
3. 检查深色模式兼容性
4. 测试不同屏幕尺寸

### 任务 3: 添加新 Store

#### 步骤
```typescript
// src/lib/stores/myStore.svelte.ts
class MyStore {
  // 状态
  data = $state<Data[]>([]);
  loading = $state(false);
  
  // 方法
  async fetchData() {
    this.loading = true;
    try {
      // 获取数据
      this.data = await api.getData();
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      this.loading = false;
    }
  }
}

export const myStore = new MyStore();
```

### 任务 4: 修复 Bug

#### 调试流程
1. **复现问题**: 确认问题可复现
2. **定位代码**: 使用浏览器开发者工具
3. **分析原因**: 查看错误堆栈和日志
4. **修复代码**: 最小化修改范围
5. **测试验证**: 确认问题已修复
6. **回归测试**: 确保未破坏其他功能

#### 调试技巧
```typescript
// 添加调试日志
console.log('Debug:', variable);

// 使用 $effect 监听变化
$effect(() => {
  console.log('State changed:', myStore.data);
});

// 检查类型
console.log('Type:', typeof value);
```

## 📦 构建和部署

### 开发模式
```bash
# 启动开发服务器
pnpm tauri dev

# 或使用快捷脚本
./start.sh   # macOS/Linux
start.bat    # Windows
```

### 生产构建
```bash
# 构建应用
pnpm tauri build

# 输出位置
src-tauri/target/release/bundle/
```

### 构建前检查清单
- [ ] 运行 `pnpm run check` 无错误
- [ ] 运行 `pnpm build` 成功
- [ ] 测试所有核心功能
- [ ] 检查所有语言界面
- [ ] 更新版本号（package.json 和 tauri.conf.json）
- [ ] 更新 CHANGELOG（如有）

## 📚 参考文档

### 官方文档
- [Svelte 5 文档](https://svelte-5-preview.vercel.app/)
- [SvelteKit 文档](https://kit.svelte.dev/)
- [Tauri 文档](https://tauri.app/)
- [TypeScript 文档](https://www.typescriptlang.org/)

### 在线资源
- [Svelte REPL](https://svelte.dev/repl) - 在线测试
- [TypeScript Playground](https://www.typescriptlang.org/play) - 类型测试

## ✅ 任务完成检查表

在提交任务前，请确保：

### 代码质量
- [ ] 运行 `pnpm run check` 无错误
- [ ] 运行 `pnpm build` 成功
- [ ] 运行 `pnpm tauri dev` 正常启动
- [ ] 无控制台错误
- [ ] TypeScript 类型完整
- [ ] 代码格式一致

### 功能完整性
- [ ] 新功能正常工作
- [ ] 未破坏现有功能
- [ ] 在所有支持的语言下测试
- [ ] UI 响应流畅
- [ ] 错误处理完善

### i18n 完整性
- [ ] 所有用户可见文本使用 i18n
- [ ] 在 4 种语言文件中都添加了翻译
- [ ] 翻译键命名规范
- [ ] 翻译质量合格

### 文档更新
- [ ] 更新相关文档（如需要）
- [ ] 添加代码注释（复杂逻辑）
- [ ] 更新 CHANGELOG（重大变更）

### 样式规范
- [ ] 使用 CSS 变量
- [ ] 使用 rem 单位
- [ ] 间距紧凑（< 1rem）
- [ ] 深色模式兼容

use context7