# Translation Injection Templates

This document describes the translation injection templates added to support automated text translation across multiple platforms.

## Overview

Translation injection templates enable automatic text filling and result extraction from 5 built-in translation platforms:

1. **Google Translate** (`google`)
2. **DeepL** (`deepl`)
3. **Youdao Translate** (`youdao`)
4. **Baidu Translate** (`baidu`)
5. **Bing Translator** (`bing`)

## Features

### Language Configuration

- **Source Language**: Always set to `auto` (automatic detection)
- **Target Language**: Dynamically selected based on current i18n locale setting
- Supports 4 locales: `zh-CN`, `en-US`, `ja-JP`, `ko-KR`

### Platform-Specific Language Codes

Each platform uses different language code formats. The mapping is defined in `constants.ts`:

```typescript
TRANSLATION_LANG_CODES = {
  google: { 'zh-CN': 'zh-CN', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko' },
  deepl: { 'zh-CN': 'zh', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko' },
  youdao: { 'zh-CN': 'zh-CHS', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko' },
  baidu: { 'zh-CN': 'zh', 'en-US': 'en', 'ja-JP': 'jp', 'ko-KR': 'kor' },
  bing: { 'zh-CN': 'zh-Hans', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko' },
}
```

## Template Structure

Each translation template follows this pattern:

```typescript
{
  platformId: 'google',
  name: 'Translate Text',
  description: 'Fill source text and extract translation result',
  urlPattern: 'https://translate\\.google\\.com.*',
  actions: [
    {
      type: 'fill',
      selector: '...',      // CSS selector for input field
      content: '',          // Text to translate (injected at runtime)
      triggerEvents: true,
      delay: 300,
      timeout: 5000
    },
    {
      type: 'extract',
      timeout: 15000,       // Longer timeout for translation
      pollInterval: 800,    // Check for result every 800ms
      extractScript: `() => { /* extraction logic */ }`
    }
  ]
}
```

### Key Differences from AI Chat Templates

| Aspect | AI Chat | Translation |
|--------|---------|-------------|
| Actions | fill → click → extract | fill → extract |
| Click needed? | Yes (send button) | No (auto-translates) |
| Extract timeout | 30000ms | 15000ms |
| Poll interval | 1000ms | 800ms |
| Complexity | High (wait for streaming) | Medium (wait for translation) |

## Helper Functions

### `buildTranslationUrl(platformId, baseUrl, targetLocale, sourceText?)`

Builds platform-specific URLs with correct language parameters:

```typescript
import { buildTranslationUrl } from '$lib/utils/translation-helpers';
import { i18n } from '$lib/i18n';

const url = buildTranslationUrl('google', '', i18n.locale.get());
// Result: https://translate.google.com/?sl=auto&tl=zh-CN&op=translate
```

**Platform URL Formats:**

- **Google**: `?sl=auto&tl={lang}&op=translate&text={text}`
- **DeepL**: `#auto/{lang}/{text}`
- **Baidu**: `#auto/{lang}`
- **Bing**: `?from=auto-detect&to={lang}&text={text}`
- **Youdao**: Base URL only (doesn't support URL params reliably)

### `getTargetLangCode(platformId, locale)`

Returns platform-specific language code for a locale:

```typescript
const langCode = getTargetLangCode('baidu', 'ja-JP');
// Returns: 'jp' (Baidu uses 'jp' instead of 'ja')
```

### `retryTranslation(fn, maxRetries, baseDelay)`

Retry mechanism with exponential backoff:

```typescript
const result = await retryTranslation(
  async () => executeInjection(...),
  3,    // Max retries
  600   // Base delay (ms)
);
// Delays: 600ms, 1200ms, 2400ms (exponential)
```

## Extraction Logic

Each platform has custom extraction logic to handle different DOM structures:

### Google Translate
```javascript
// Waits for translation result spans
const resultSelectors = [
  'span[data-language-for-alternatives]',
  'span.ryNqvb',
  'div[data-language-for-alternatives]',
  // ... more selectors
];
```

### DeepL
```javascript
// Checks textarea or contenteditable result
const resultSelectors = [
  'textarea[data-testid="translator-target-input"]',
  'd-textarea[data-testid="translator-target-input"] textarea',
  // ... fallbacks
];
```

### Youdao
```javascript
const resultSelectors = [
  '#transTarget',
  '#js_fanyi_output_resultOutput',
  '.output-bd p',
  // ... fallbacks
];
```

### Baidu
```javascript
// Handles multiple paragraph results
const resultSelectors = [
  'p.target-output',
  '.target-output',
  '#transTarget p',
  // ... fallbacks
];
// Joins multiple paragraphs with newlines
```

### Bing
```javascript
// Checks textarea value
const resultSelectors = [
  'textarea#tta_output_ta',
  'textarea[id*="output"]',
  // ... fallbacks
];
```

## Usage Example

### In Translation Component

```svelte
<script lang="ts">
  import { injectionManager } from '$lib/utils/injection';
  import { buildTranslationUrl } from '$lib/utils/translation-helpers';
  import { i18n } from '$lib/i18n';
  import { translationStore } from '$lib/stores/translation.svelte';
  
  let sourceText = $state('');
  let result = $state('');
  
  async function translate() {
    const platform = translationStore.currentPlatform;
    if (!platform) return;
    
    // Build URL with target language
    const url = buildTranslationUrl(
      platform.id as any,
      platform.url,
      i18n.locale.get()
    );
    
    // Navigate to correct URL
    await webviewProxy.navigate(url);
    
    // Execute injection
    const template = injectionManager.getTemplate(platform.id, 'Translate Text');
    if (template) {
      const injectionResult = await injectionManager.executeInjection(
        webviewProxy,
        template,
        sourceText
      );
      
      result = injectionResult || '';
    }
  }
</script>
```

## Testing

### Unit Tests

Run translation helper tests:

```bash
pnpm test translation-helpers
```

Tests cover:
- URL building for all platforms
- Language code mapping
- Locale support checking
- Retry logic with exponential backoff

### Debug Injection Page

Use the built-in Debug Injection page to test templates:

1. Navigate to Settings → About → Debug Injection
2. Select a translation platform (e.g., Google)
3. Initialize WebView
4. Enter text to translate
5. Execute injection
6. Verify result extraction

## Configuration Constants

All translation-specific constants are in `constants.ts`:

```typescript
export const TRANSLATION_INJECTION = {
  EXTRACT_TIMEOUT_MS: 15000,      // Translation result timeout
  POLL_INTERVAL_MS: 800,          // Polling frequency
  FILL_TIMEOUT_MS: 5000,          // Input fill timeout
  CLICK_TIMEOUT_MS: 3000,         // Click timeout (if needed)
  FILL_DELAY_MS: 300,             // Pre-fill delay
  MAX_RETRIES: 3,                 // Maximum retry attempts
  RETRY_DELAY_MS: 600,            // Base retry delay
};
```

## i18n Keys

All translation injection UI strings are localized in 4 languages:

```typescript
translation.inject.{
  button,              // "翻译" / "Translate"
  inputPlaceholder,    // "输入要翻译的文本..."
  executing,           // "翻译中..."
  success,             // "翻译成功"
  failed,              // "翻译失败"
  retry,               // "重试"
  resultLabel,         // "翻译结果："
  noResult,            // "暂无结果"
  timeout,             // "翻译超时，请重试"
  networkError,        // "网络错误，请检查连接"
  unsupportedLanguage, // "当前语言不受支持"
}
```

## Best Practices

### 1. Language Selection Strategy

**Recommended**: Use URL-based language selection when possible (Google, DeepL, Bing) for reliability. Fallback to UI-based selection for platforms that don't support URL params (Youdao).

### 2. Timeout Configuration

- Use longer timeouts for translation (15s) vs chat (30s)
- Consider text length: longer texts may need more time
- Implement retry logic for transient failures

### 3. Selector Maintenance

- Provide multiple fallback selectors for each platform
- Monitor for UI changes that break selectors
- Use data attributes over class names when available

### 4. Error Handling

```typescript
try {
  const result = await retryTranslation(
    async () => {
      const res = await executeInjection(...);
      if (!res || res === '') {
        throw new Error('Empty result');
      }
      return res;
    },
    TRANSLATION_INJECTION.MAX_RETRIES,
    TRANSLATION_INJECTION.RETRY_DELAY_MS
  );
} catch (error) {
  logger.error('Translation failed', { platformId, error });
  // Show user-friendly error message
}
```

### 5. Performance Optimization

- Reuse existing webviews instead of recreating
- Cache translation results for repeated queries
- Implement debouncing for real-time translation

## Troubleshooting

### Empty Results

**Issue**: Extraction returns empty string

**Causes**:
- Translation not complete yet (increase timeout)
- Selector doesn't match current DOM structure
- Page still loading (check CHILD_WEBVIEW_READY event)

**Solution**:
1. Check extraction script in Debug Injection page
2. Verify selectors in browser DevTools
3. Increase `timeout` in template
4. Add more fallback selectors

### Incorrect Language

**Issue**: Translation uses wrong target language

**Causes**:
- URL not rebuilt after locale change
- Platform doesn't support current locale
- Language code mapping incorrect

**Solution**:
1. Call `buildTranslationUrl()` before each translation
2. Check `isPlatformLocaleSupported()`
3. Verify `TRANSLATION_LANG_CODES` mapping

### Timeout Errors

**Issue**: Injection times out frequently

**Causes**:
- Network latency
- Platform response slow
- Timeout too short for text length

**Solution**:
1. Increase `TRANSLATION_INJECTION.EXTRACT_TIMEOUT_MS`
2. Implement retry with `retryTranslation()`
3. Check network/proxy settings

## Future Enhancements

1. **Custom Translation Platforms**: Allow users to add custom translation services
2. **Batch Translation**: Translate multiple texts in one request
3. **Translation History**: Cache and display previous translations
4. **Language Auto-Detection UI**: Show detected source language
5. **Platform-Specific Options**: Custom settings per platform (formality, etc.)

## Related Files

- `src/lib/utils/injection-templates.ts` - Template definitions
- `src/lib/utils/translation-helpers.ts` - Helper functions
- `src/lib/utils/constants.ts` - Configuration constants
- `src/lib/stores/translation.svelte.ts` - Translation state management
- `src/lib/__tests__/translation-helpers.test.ts` - Unit tests
