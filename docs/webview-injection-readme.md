# WebView 自动注入功能 (WebView Injection)

## 功能概述

这是一个强大的子 WebView JavaScript 自动注入系统，允许在 AI 平台的 WebView 中自动执行 DOM 操作。

## 核心能力

✅ **自动填充文本** - 根据传入内容自动填充表单字段  
✅ **自动点击按钮** - 模拟用户点击操作  
✅ **模板化配置** - 为不同 AI 平台配置专属行为  
✅ **复杂选择器** - 支持 iframe、Shadow DOM 等复杂场景  
✅ **操作序列** - 组合多个操作形成完整工作流  
✅ **类型安全** - 完整的 TypeScript 类型支持  
✅ **单元测试** - 全面的测试覆盖

## 文件结构

```
src/lib/
├── types/
│   └── injection.ts                      # 类型定义
├── utils/
│   ├── injection.ts                      # 核心注入管理器
│   ├── injection-templates.ts            # 平台模板配置
│   ├── childWebview.ts                   # 扩展的 WebView 代理
│   └── constants.ts                      # 新增注入相关常量
└── __tests__/
    └── injection.test.ts                 # 单元测试（61个测试通过）

src-tauri/src/
├── webview.rs                            # 新增 evaluate_child_webview_script 命令
└── lib.rs                                # 注册新命令

docs/
└── webview-injection-guide.md            # 详细使用指南
```

## 快速开始

### 1. 基础使用

```typescript
import { injectionManager } from '$lib/utils/injection';
import { ALL_TEMPLATES } from '$lib/utils/injection-templates';

// 注册预置模板
ALL_TEMPLATES.forEach(t => injectionManager.registerTemplate(t));

// 创建 WebView
const webview = new ChildWebviewProxy('chatgpt', 'https://chat.openai.com', null);
await webview.ensure(bounds);
await webview.show();

// 查找并执行模板
const template = injectionManager.findTemplateForUrl('https://chat.openai.com', 'chatgpt');
template.actions[0].content = '你好！'; // 自定义消息

const script = injectionManager.generateTemplateScript(template);
const result = await webview.evaluateScript(script);
```

### 2. 自定义模板

```typescript
const customTemplate = {
	platformId: 'my-platform',
	name: 'Send and Wait',
	urlPattern: 'https://example\\.com.*',
	actions: [
		{
			type: 'fill',
			target: { selector: '#input' },
			content: 'Hello'
		},
		{
			type: 'wait',
			duration: 500
		},
		{
			type: 'click',
			target: { selector: 'button.submit' }
		}
	]
};

injectionManager.registerTemplate(customTemplate);
```

## 预置平台模板

- **ChatGPT** - `#prompt-textarea` → `button[data-testid="send-button"]`
- **Claude** - `div[contenteditable="true"]` → `button[aria-label*="Send"]`
- **Gemini** - `.ql-editor` → `button[aria-label*="Send"]`
- **DeepSeek** - `textarea[placeholder*="Send"]` → `button[type="submit"]`
- **Kimi** - `textarea` → `button[type="submit"]`

## 操作类型

### FillTextAction - 填充文本
```typescript
{
	type: 'fill',
	target: { selector: '#input' },
	content: 'Text to fill',
	triggerEvents: true,  // 触发 input/change 事件
	delay: 0              // 执行前延迟（毫秒）
}
```

### ClickAction - 点击按钮
```typescript
{
	type: 'click',
	target: { selector: 'button' },
	waitForVisible: true,  // 等待元素可见
	delay: 0
}
```

### WaitAction - 等待延迟
```typescript
{
	type: 'wait',
	duration: 1000  // 等待时间（毫秒）
}
```

### CustomScriptAction - 自定义脚本
```typescript
{
	type: 'custom',
	script: 'console.log("Custom code");',
	delay: 0
}
```

## 高级特性

### 复杂选择器

```typescript
target: {
	selector: '#element',
	iframeSelector: '#my-iframe',      // 处理 iframe
	shadowRoot: '#shadow-host',        // 处理 Shadow DOM
	timeout: 8000                      // 自定义超时
}
```

### 错误处理

```typescript
const result = await webview.evaluateScript(script);
const parsed = injectionManager.parseResult(result);

if (parsed.success) {
	console.log(`✓ 成功执行 ${parsed.actionsExecuted} 个操作，耗时 ${parsed.duration}ms`);
} else {
	console.error(`✗ 失败: ${parsed.error}`);
}
```

## API 参考

### InjectionManager

- `registerTemplate(template)` - 注册模板
- `getTemplates(platformId)` - 获取平台模板
- `findTemplateForUrl(url, platformId?)` - 根据 URL 查找模板
- `generateActionScript(action)` - 生成单个操作脚本
- `generateSequenceScript(actions)` - 生成操作序列脚本
- `generateTemplateScript(template)` - 生成完整模板脚本
- `parseResult(output)` - 解析执行结果

### ChildWebviewProxy (新增方法)

- `evaluateScript<T>(script, timeout?)` - 在子 WebView 中执行 JavaScript 并返回结果
  - `script`: 要执行的 JavaScript 代码（应该返回一个值）
  - `timeout`: 可选，等待结果的超时时间（毫秒，默认 10000）
  - 返回: Promise，解析为脚本执行的结果

## 测试

```bash
# 运行所有测试
pnpm test

# 运行 lint 检查
pnpm lint
```

测试覆盖：
- ✓ 模板管理
- ✓ 脚本生成（填充、点击、等待、自定义）
- ✓ 选择器处理（基础、iframe、Shadow DOM）
- ✓ 操作序列
- ✓ 结果解析
- ✓ 错误处理

## 注意事项

⚠️ **安全性**: 仅注入可信代码  
⚠️ **性能**: 设置合理的 timeout 防止死锁  
⚠️ **可靠性**: 在真实环境中测试选择器  
⚠️ **异步通信**: 脚本结果通过 IPC 事件异步返回，默认超时 10 秒

## 详细文档

完整使用指南: [docs/webview-injection-guide.md](../docs/webview-injection-guide.md)

## License

与主项目相同
