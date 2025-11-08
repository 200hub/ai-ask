# Translation Injection Templates - Implementation Summary

## 完成情况

已完成为 5 个内置翻译平台（Google Translate、DeepL、Youdao、Baidu、Bing）添加 injection templates，实现了自动文本填充和翻译结果提取功能。

## 实现内容

### 1. 语言映射常量（`constants.ts`）

添加了 `TRANSLATION_LANG_CODES` 常量，为每个翻译平台定义了从内部 locale 到平台特定语言代码的映射：

- **Google**: `zh-CN`, `en`, `ja`, `ko`
- **DeepL**: `zh`, `en`, `ja`, `ko`
- **Youdao**: `zh-CHS`, `en`, `ja`, `ko`
- **Baidu**: `zh`, `en`, `jp`, `kor`
- **Bing**: `zh-Hans`, `en`, `ja`, `ko`

源语言固定为 `auto`（自动检测），目标语言根据当前 i18n 选择动态确定。

### 2. 翻译注入模板（`injection-templates.ts`）

为 5 个平台各创建了一个 `InjectionTemplate`：

```typescript
// 示例：Google Translate
{
  platformId: 'google',
  name: 'Translate Text',
  actions: [
    { type: 'fill', selector: '...', content: '', ... },
    { type: 'extract', timeout: 15000, pollInterval: 800, extractScript: `...` }
  ]
}
```

**特点**：
- 自动翻译平台无需 `click` 操作
- 提取超时设为 15s（比 AI 聊天的 30s 更短）
- 轮询间隔 800ms
- 每个平台都有多个备用选择器，提升稳定性

### 3. 翻译辅助函数（`translation-helpers.ts`）

创建了新工具文件，包含 4 个核心函数：

#### `buildTranslationUrl(platformId, baseUrl, targetLocale, sourceText?)`
根据平台和目标语言构建正确的 URL：
- Google: `?sl=auto&tl=zh-CN&op=translate`
- DeepL: `#auto/zh/`
- Baidu: `#auto/zh`
- Bing: `?from=auto-detect&to=zh-Hans`
- Youdao: 返回 base URL（不支持 URL 参数）

#### `getTargetLangCode(platformId, locale)`
获取平台特定的语言代码：
```typescript
getTargetLangCode('baidu', 'ja-JP') // 返回 'jp'
```

#### `isPlatformLocaleSupported(platformId, locale)`
检查平台是否支持特定语言：
```typescript
isPlatformLocaleSupported('google', 'zh-CN') // true
```

#### `retryTranslation(fn, maxRetries, baseDelay)`
带指数退避的重试机制：
- 默认最多重试 3 次
- 基础延迟 600ms
- 指数退避：600ms → 1200ms → 2400ms
- 自动处理空结果

### 4. i18n 键值（4 种语言）

在 `zh-CN.ts`、`en-US.ts`、`ja-JP.ts`、`ko-KR.ts` 中添加了翻译注入相关的所有 UI 文本：

```typescript
translation.inject: {
  button: "翻译",
  inputPlaceholder: "输入要翻译的文本...",
  executing: "翻译中...",
  success: "翻译成功",
  failed: "翻译失败",
  retry: "重试",
  resultLabel: "翻译结果：",
  noResult: "暂无结果",
  timeout: "翻译超时，请重试",
  networkError: "网络错误，请检查连接",
  unsupportedLanguage: "当前语言不受支持",
}
```

### 5. 单元测试（`translation-helpers.test.ts`）

创建了 17 个测试用例，覆盖：
- ✅ URL 构建（所有 5 个平台）
- ✅ 语言代码获取
- ✅ 语言支持检测
- ✅ 重试逻辑（成功、空结果、失败、指数退避）

**测试结果**：所有 57 个测试全部通过 ✓

### 6. 配置常量

添加了翻译专用的注入常量：

```typescript
TRANSLATION_INJECTION = {
  EXTRACT_TIMEOUT_MS: 15000,    // 翻译结果提取超时
  POLL_INTERVAL_MS: 800,        // 轮询间隔
  FILL_TIMEOUT_MS: 5000,        // 填充超时
  CLICK_TIMEOUT_MS: 3000,       // 点击超时
  FILL_DELAY_MS: 300,           // 填充前延迟
  MAX_RETRIES: 3,               // 最大重试次数
  RETRY_DELAY_MS: 600,          // 重试延迟
}
```

### 7. 文档

创建了详细的技术文档 `docs/TRANSLATION_INJECTION.md`，包含：
- 功能概述
- 模板结构说明
- 辅助函数使用示例
- 各平台提取逻辑详解
- 使用示例代码
- 测试方法
- 最佳实践
- 故障排查指南
- 未来增强建议

## 提取逻辑特点

### Google Translate
- 等待 `span[data-language-for-alternatives]` 出现
- 过滤占位文本（"Translation"、"翻译"）
- 备用多个选择器保证稳定性

### DeepL
- 检查 `textarea[data-testid="translator-target-input"]`
- 过滤加载状态（"Translating..."、"翻译中..."）
- 支持 textarea 和 contenteditable 两种元素

### Youdao
- 主选择器：`#transTarget`
- 备用容器选择器确保兼容性
- 直接提取文本内容

### Baidu
- 提取多个 `p.target-output` 段落
- 用换行符连接多段结果
- 备用容器选择器

### Bing
- 检查 `textarea#tta_output_ta` 的 value
- 备用多个 ID 模式匹配
- 优先使用 textarea.value

## 使用方式

### 在翻译组件中集成

```svelte
<script>
import { buildTranslationUrl, retryTranslation } from '$lib/utils/translation-helpers';
import { i18n } from '$lib/i18n';

async function translate(text: string) {
  const platform = translationStore.currentPlatform;
  
  // 1. 构建带语言参数的 URL
  const url = buildTranslationUrl(
    platform.id,
    platform.url,
    i18n.locale.get()
  );
  
  // 2. 导航到正确 URL
  await webviewProxy.navigate(url);
  
  // 3. 执行注入（带重试）
  const result = await retryTranslation(
    async () => injectionManager.executeInjection(webviewProxy, template, text),
    3,
    600
  );
  
  return result;
}
</script>
```

### 在 Debug Injection 页面测试

1. 导航到 设置 → 关于 → 调试注入功能
2. 选择翻译平台（如 Google）
3. 初始化 WebView
4. 输入要翻译的文本
5. 执行注入
6. 验证结果提取

## 质量保证

### ✅ 类型检查通过
```bash
pnpm run check
# svelte-check found 0 errors and 0 warnings
```

### ✅ Lint 通过
```bash
pnpm lint
# Frontend: 0 errors (1 pre-existing warning in debug page)
# Rust: 0 errors, 0 warnings
```

### ✅ 测试通过
```bash
pnpm test
# 8 test files, 57 tests passed
# Including 17 new translation-helpers tests
```

## 关键设计决策

### 1. 语言选择策略
**决策**：URL 参数优先，UI 操作备用

**理由**：
- URL 参数更可靠（Google、DeepL、Bing 支持）
- 避免复杂的 UI 元素定位
- 减少注入失败概率

### 2. 超时配置
**决策**：翻译 15s，AI 聊天 30s

**理由**：
- 翻译通常比 AI 生成更快
- 减少用户等待时间
- 配合重试机制（3 次 × 15s = 45s 总时长）

### 3. 不使用 Click 操作
**决策**：所有 5 个平台都自动翻译

**理由**：
- 所有平台均支持输入即翻译
- 简化注入流程（fill → extract）
- 减少选择器维护成本

### 4. 重试机制
**决策**：实现 `retryTranslation` 独立函数

**理由**：
- 可复用，不绑定到特定平台
- 指数退避避免频繁请求
- 空结果自动重试（翻译未完成）

## 后续集成建议

### 前端组件集成

在 `src/lib/components/pages/Translation.svelte` 中添加：

1. **翻译输入框**：用户输入源文本
2. **翻译按钮**：触发注入执行（使用 `translation.inject.button` i18n 键）
3. **结果显示区**：展示翻译结果
4. **错误处理**：显示超时、网络错误等（使用 `translation.inject.*` i18n 键）
5. **加载状态**：执行中显示"翻译中..."

### 快捷键集成

利用现有 `TRANSLATION_SHORTCUTS` 常量：
- 快捷键触发时自动获取选中文本
- 调用翻译注入
- 显示结果通知

### WebView 生命周期集成

监听 `CHILD_WEBVIEW_READY` 事件：
- WebView 加载完成后才执行注入
- 避免页面未就绪导致失败

## 文件清单

### 新增文件
- ✅ `src/lib/utils/translation-helpers.ts` - 翻译辅助函数
- ✅ `src/lib/__tests__/translation-helpers.test.ts` - 单元测试
- ✅ `docs/TRANSLATION_INJECTION.md` - 技术文档

### 修改文件
- ✅ `src/lib/utils/constants.ts` - 添加语言映射和翻译常量
- ✅ `src/lib/utils/injection-templates.ts` - 添加 5 个翻译模板
- ✅ `src/lib/i18n/locales/zh-CN.ts` - 添加中文 i18n 键
- ✅ `src/lib/i18n/locales/en-US.ts` - 添加英文 i18n 键
- ✅ `src/lib/i18n/locales/ja-JP.ts` - 添加日文 i18n 键
- ✅ `src/lib/i18n/locales/ko-KR.ts` - 添加韩文 i18n 键

## 总结

已完成翻译平台注入模板的核心实现，包括：

✅ 5 个翻译平台的完整注入模板  
✅ 动态语言选择（基于 i18n 当前语言）  
✅ 平台专用 URL 构建  
✅ 带指数退避的重试机制  
✅ 完善的单元测试（100% 通过）  
✅ 4 种语言的完整 i18n 支持  
✅ 详细的技术文档  
✅ 类型安全（0 type errors）  
✅ 代码质量（0 lint errors）  

**下一步**：在翻译页面组件中集成这些模板，实现完整的用户交互流程。
