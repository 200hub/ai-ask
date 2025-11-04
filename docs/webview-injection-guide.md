# WebView 自动注入功能使用指南

## 概述

WebView 自动注入功能允许你在子 WebView 中自动执行 JavaScript 代码，实现以下功能：

1. **自动填充文本区域** - 根据传入内容填充表单字段
2. **自动点击按钮** - 模拟用户点击操作
3. **模板化配置** - 为不同 AI 平台配置不同的自动化行为
4. **复杂操作序列** - 组合多个操作形成完整工作流

## 核心组件

### 1. 类型定义 (`src/lib/types/injection.ts`)

定义了所有注入相关的 TypeScript 接口：

- `SelectorConfig` - 选择器配置
- `FillTextAction` - 填充文本操作
- `ClickAction` - 点击操作
- `WaitAction` - 等待操作
- `CustomScriptAction` - 自定义脚本操作
- `InjectionTemplate` - 注入模板
- `InjectionResult` - 执行结果

### 2. 注入管理器 (`src/lib/utils/injection.ts`)

`InjectionManager` 类负责：

- 注册和管理注入模板
- 生成 JavaScript 注入脚本
- 解析执行结果

### 3. 平台模板 (`src/lib/utils/injection-templates.ts`)

预配置的平台模板，包括：

- ChatGPT
- Claude
- Gemini
- DeepSeek
- Kimi

### 4. ChildWebviewProxy 扩展

`ChildWebviewProxy` 新增 `evaluateScript()` 方法用于执行注入脚本。

## 使用示例

### 基础用法：填充文本并点击按钮

```typescript
import { injectionManager } from '$lib/utils/injection';
import type { InjectionTemplate } from '$lib/types/injection';

// 创建注入模板
const template: InjectionTemplate = {
	platformId: 'chatgpt',
	name: 'Send Message',
	description: '填充消息并点击发送',
	urlPattern: 'https://chat\\.openai\\.com.*',
	actions: [
		// 1. 填充文本
		{
			type: 'fill',
			target: {
				selector: '#prompt-textarea',
				timeout: 5000
			},
			content: '你好，请帮我解答这个问题',
			triggerEvents: true // 触发 input 和 change 事件
		},
		// 2. 等待一下
		{
			type: 'wait',
			duration: 300
		},
		// 3. 点击发送按钮
		{
			type: 'click',
			target: {
				selector: 'button[data-testid="send-button"]',
				timeout: 3000
			},
			waitForVisible: true
		}
	],
	autoExecute: false
};

// 注册模板
injectionManager.registerTemplate(template);

// 生成脚本
const script = injectionManager.generateTemplateScript(template);

// 在 WebView 中执行
const webviewProxy = new ChildWebviewProxy('chatgpt', 'https://chat.openai.com', null);
await webviewProxy.ensure(bounds);
await webviewProxy.show();

// evaluateScript 现在返回脚本的实际执行结果
// 脚本应该返回一个可序列化为 JSON 的值
const result = await webviewProxy.evaluateScript(script);
console.log('Injection result:', result);
// 例如: { success: true, duration: 1234, actionsExecuted: 3 }
```

### 高级用法：处理 iframe 和 Shadow DOM

```typescript
const template: InjectionTemplate = {
	platformId: 'custom-platform',
	name: 'Complex Injection',
	urlPattern: 'https://example\\.com.*',
	actions: [
		{
			type: 'fill',
			target: {
				selector: '#input-field',
				// 如果元素在 iframe 中
				iframeSelector: '#my-iframe',
				// 如果使用 Shadow DOM
				shadowRoot: '#shadow-host',
				timeout: 8000
			},
			content: 'Hello from injection',
			delay: 500 // 执行前延迟 500ms
		}
	]
};
```

### 使用预配置模板

```typescript
import { ALL_TEMPLATES, findTemplate } from '$lib/utils/injection-templates';

// 方式 1：获取所有模板
ALL_TEMPLATES.forEach((template) => {
	injectionManager.registerTemplate(template);
});

// 方式 2：查找特定模板
const chatgptTemplate = findTemplate('chatgpt', 'Send Message');
if (chatgptTemplate) {
	// 自定义内容
	chatgptTemplate.actions[0].content = '我的问题是...';
	const script = injectionManager.generateTemplateScript(chatgptTemplate);
}

// 方式 3：根据 URL 自动匹配
const url = 'https://chat.openai.com/chat';
const matchedTemplate = injectionManager.findTemplateForUrl(url);
if (matchedTemplate) {
	console.log('Found template:', matchedTemplate.name);
}
```

### 自定义脚本操作并获取返回值

```typescript
const template: InjectionTemplate = {
	platformId: 'custom',
	name: 'Custom Script',
	urlPattern: '.*',
	actions: [
		{
			type: 'custom',
			script: `
				// 自定义 JavaScript 代码
				const elements = document.querySelectorAll('.message');
				// 返回的对象会通过 IPC 传回前端
				return {
					success: true,
					messageCount: elements.length,
					messages: Array.from(elements).map(el => el.textContent)
				};
			`,
			delay: 0
		}
	]
};

// 执行并获取结果
const script = injectionManager.generateTemplateScript(template);
const result = await webviewProxy.evaluateScript(script);
console.log('Found messages:', result.messageCount);
console.log('Message texts:', result.messages);
```

### 在 Svelte 组件中使用

```svelte
<script lang="ts">
	import { ChildWebviewProxy } from '$lib/utils/childWebview';
	import { injectionManager } from '$lib/utils/injection';
	import { ALL_TEMPLATES } from '$lib/utils/injection-templates';

	let webviewProxy: ChildWebviewProxy | null = null;

	async function initializeWebview() {
		// 注册所有模板
		ALL_TEMPLATES.forEach((t) => injectionManager.registerTemplate(t));

		// 创建 WebView
		webviewProxy = new ChildWebviewProxy('chatgpt', 'https://chat.openai.com', null);
		await webviewProxy.ensure(bounds);
		await webviewProxy.show();
	}

	async function sendMessage(message: string) {
		if (!webviewProxy) return;

		// 找到 ChatGPT 模板
		const template = injectionManager.findTemplateForUrl(
			'https://chat.openai.com',
			'chatgpt'
		);
		if (!template) return;

		// 自定义消息内容
		template.actions[0].content = message;

		// 生成并执行脚本
		const script = injectionManager.generateTemplateScript(template);
		const result = await webviewProxy.evaluateScript(script);

		if (result.success) {
			console.log('Message sent successfully');
		} else {
			console.error('Failed to send message:', result.error);
		}
	}
</script>

<button onclick={() => sendMessage('你好，AI！')}>发送消息</button>
```

## 错误处理

```typescript
try {
	const result = await webviewProxy.evaluateScript(script);
	const parsed = injectionManager.parseResult(result);

	if (parsed.success) {
		console.log(`成功执行 ${parsed.actionsExecuted} 个操作`);
		console.log(`耗时: ${parsed.duration}ms`);
	} else {
		console.error('执行失败:', parsed.error);
	}
} catch (error) {
	console.error('脚本评估失败:', error);
}
```

## 配置选项

### InjectionConfig

```typescript
const manager = new InjectionManager({
	defaultTimeout: 5000, // 默认选择器超时（毫秒）
	debug: true, // 启用调试日志
	maxRetries: 3 // 最大重试次数
});
```

### SelectorConfig

```typescript
{
	selector: '#my-element',       // CSS 选择器（必需）
	iframeSelector: '#frame',      // iframe 选择器（可选）
	shadowRoot: '#shadow-host',    // Shadow DOM 选择器（可选）
	timeout: 5000                  // 超时时间（可选，默认 5000ms）
}
```

## 注意事项

1. **安全性**: 只注入可信的 JavaScript 代码
2. **性能**: 避免执行耗时操作，使用 timeout 防止死锁
3. **可靠性**: 使用 wait 操作等待 DOM 更新
4. **测试**: 在实际环境中充分测试选择器和操作序列
5. **返回值机制**: `evaluateScript()` 通过 IPC 事件异步返回脚本执行结果，默认超时 10 秒
6. **结果序列化**: 脚本返回的值必须可以序列化为 JSON（不能包含函数、DOM 元素等）

## 单元测试

所有注入功能都有完整的单元测试覆盖，参见 `src/lib/__tests__/injection.test.ts`。

运行测试：

```bash
pnpm test
```

## 扩展和自定义

### 添加新平台模板

1. 在 `injection-templates.ts` 中定义新模板
2. 添加到 `ALL_TEMPLATES` 数组
3. 确保 URL 模式正确匹配目标网站

### 添加新操作类型

1. 在 `injection.ts` 中定义新接口
2. 更新 `InjectionAction` 联合类型
3. 在 `generateActionScript()` 中添加处理逻辑
4. 添加相应的单元测试

## 相关文件

- `src/lib/types/injection.ts` - 类型定义
- `src/lib/utils/injection.ts` - 核心逻辑
- `src/lib/utils/injection-templates.ts` - 平台模板
- `src/lib/utils/childWebview.ts` - WebView 代理
- `src-tauri/src/webview.rs` - Rust 后端
- `src/lib/__tests__/injection.test.ts` - 单元测试
