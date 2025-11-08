# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Ask is a Tauri 2.x + Svelte 5 desktop application that embeds AI platforms (ChatGPT, Claude, Gemini, etc.) and translation services directly via their official websites. Users can switch between 11 AI platforms and 5 translation engines without API keys or subscriptions. Key features include global text selection toolbar, cross-platform webview injection system, and multi-language support (zh-CN, en-US, ja-JP, ko-KR).

## Development Commands

```bash
# Development
pnpm tauri dev              # Start dev server (Vite + Tauri)
pnpm run check              # TypeScript type checking
pnpm run check:watch        # Watch mode for type checking

# Testing
pnpm test                   # Run all tests (frontend + Rust)
pnpm test:frontend          # Vitest tests only
pnpm test:rust              # Cargo tests only

# Linting & Formatting
pnpm lint                   # Lint frontend + Rust (ESLint + cargo fmt + clippy)
pnpm lint:frontend          # ESLint only
pnpm lint:fix               # Auto-fix ESLint issues
pnpm lint:rust              # Check Rust formatting + clippy warnings
pnpm lint:rust:fix          # Auto-fix Rust formatting + clippy

# Building
pnpm build                  # Build frontend only (SvelteKit)
pnpm tauri build            # Full production build (creates installers)

# Utilities
pnpm version:sync           # Sync version across package.json and tauri.conf.json
pnpm release:validate       # Validate version consistency before release
```

## Critical Architecture Patterns

### 1. Child Webview Proxy System

**DO NOT** create Tauri `WebviewWindow` directly in frontend code. Always use the `ChildWebviewProxy` wrapper:

```typescript
// CORRECT: Use proxy wrapper
import { ChildWebviewProxy } from '$lib/utils/childWebview';
const proxy = new ChildWebviewProxy(platformId, url);
await proxy.ensure(bounds, proxyUrl);
await proxy.show();

// WRONG: Direct Tauri WebviewWindow creation
// This breaks the architecture!
```

**Backend commands** (Rust): `ensure_child_webview`, `show_child_webview`, `hide_child_webview`, `close_child_webview`, `focus_child_webview`, `set_child_webview_bounds`

Each AI platform gets an independent webview with isolated sessions (cookies, localStorage, IndexedDB).

### 2. Window Visibility Coordination

Two distinct flows for hiding the main window:

**Flow A: User clicks close button** (frontend-initiated)
```
1. Frontend dispatches DOM event `hideAllWebviews`
2. Frontend hides child webviews via ChildWebviewProxy
3. Frontend calls `appWindow.hide()`
```

**Flow B: Tray icon / global hotkey** (Rust-initiated)
```
1. Rust emits Tauri event `hideAllWebviews`
2. Frontend receives event → hides child webviews
3. Rust waits 100ms (coordination delay)
4. Rust hides main window
```

**Show flow**: Rust shows main window → emits `restoreWebviews` event → frontend restores child webviews

### 3. Injection Template System

The core mechanism for auto-filling text and clicking send buttons on AI/translation platforms. Templates defined in `src/lib/utils/injection-templates.ts`:

```typescript
{
  platformId: 'chatgpt',
  actions: [
    { type: 'fill', selector: '#prompt-textarea', content: '', delay: 300 },
    { type: 'click', selector: 'button[data-testid="send-button"]' },
    { type: 'extract', extractScript: '() => {...}', pollInterval: 1000, timeout: 30000 }
  ]
}
```

- **fill**: Sets text in input/textarea/contenteditable elements
- **click**: Triggers button/submit actions
- **extract**: Polls for AI response completion and extracts result text

**Injection result communication**: Uses navigation interception (`http://injection.localhost/begin|chunk|end`) because external webviews cannot use Tauri IPC. Rust intercepts navigation, aggregates chunked base64url data, decodes to JSON, and emits to main window.

### 4. Global Selection Toolbar

Cross-application text selection monitoring using:
- **Windows**: UI Automation API (provider pattern)
- **macOS**: Accessibility API
- **Linux**: Not implemented yet

Triggered on mouse release after text selection. Shows floating toolbar (120x38px) with translate/explain/copy actions. Toolbar window is independent, always-on-top, and positioned near cursor.

**Key files**:
- Rust: `src-tauri/src/global_selection.rs`, `src-tauri/src/selection_toolbar.rs`
- Frontend: `src/routes/toolbar/+page.svelte`, `src/lib/utils/selection-actions.ts`

## State Management (Svelte 5 Runes)

All stores use Svelte 5 Runes (`$state`, `$derived`, `$effect`). **DO NOT** use Svelte 4 stores (`writable`, `readable`, `derived`).

```typescript
// CORRECT: Svelte 5 Runes pattern
class MyStore {
  value = $state<number>(0);
  doubled = $derived(this.value * 2);

  increment() {
    this.value++;
  }
}
export const myStore = new MyStore();

// WRONG: Svelte 4 pattern (do not use)
// export const myStore = writable(0);
```

**Core stores** (`src/lib/stores/*.svelte.ts`):
- `app.svelte.ts`: Active platform, view mode, loading, errors, theme
- `config.svelte.ts`: User preferences (language, theme, hotkeys, auto-start, proxy)
- `platforms.svelte.ts`: AI platform list, enabled state, custom platforms, sorting
- `translation.svelte.ts`: Translation engine management
- `toolbar.svelte.ts`: Selection toolbar state

## Styling Rules

**NO Tailwind or CSS frameworks.** Pure CSS only with CSS custom properties from `src/lib/styles/base.css`:

```css
/* Use variables like: */
--bg-primary, --bg-secondary, --text-primary, --text-secondary
--accent-color, --border-color, --shadow-sm, --shadow-md
--success-color, --warning-color, --error-color
```

Theme switching via `.dark` class on `<body>`. Use scoped `<style>` blocks in components. Use `rem` units for sizing.

## Internationalization (i18n)

**Pattern**: `import { i18n } from '$lib/i18n'; const t = i18n.t;`

**DO NOT** use store subscriptions (`$t`). Use the function directly.

All user-facing text must use i18n keys with dot notation:
```typescript
t('settings.general.language')  // "语言" / "Language" / "言語" / "언어"
```

**Update all four locale files** when adding new keys:
- `src/lib/i18n/locales/zh-CN.ts` (default)
- `src/lib/i18n/locales/en-US.ts`
- `src/lib/i18n/locales/ja-JP.ts`
- `src/lib/i18n/locales/ko-KR.ts`

## Logging & Constants

**Logging**: Use `logger` from `$lib/utils/logger` (NOT `console.log`). All log messages must be in English.

```typescript
import { logger } from '$lib/utils/logger';
logger.info('Platform enabled', { platformId, enabled });
logger.error('Failed to load config', error);
```

**Constants**: All hardcoded values (URLs, timeouts, limits, magic numbers) must be defined in `src/lib/utils/constants.ts`:

```typescript
export const DEFAULT_WINDOW_WIDTH = 1200;
export const MIN_TEXT_LENGTH = 2;
export const INJECTION_TIMEOUT_MS = 30000;
```

## Rust Backend Modules

```
src-tauri/src/
├── lib.rs               # Tauri command registration, app entry point
├── window_control.rs    # Main window visibility, tray, global shortcuts
├── webview.rs           # Child webview lifecycle, injection result handling
├── selection_toolbar.rs # Floating toolbar window management
├── global_selection.rs  # System-wide text selection monitoring
├── proxy.rs             # Proxy configuration & connection testing
├── update.rs            # Auto-update via GitHub releases
└── utils.rs             # Base64 decoding utilities
```

**Key Tauri commands**:
- Window: `show_window`, `hide_window`, `toggle_window`
- Webview: `ensure_child_webview`, `show_child_webview`, `hide_child_webview`, `evaluate_child_webview_script`
- Toolbar: `show_selection_toolbar`, `hide_selection_toolbar`, `set_selection_toolbar_enabled`, `get_cursor_position`
- Proxy: `test_proxy_connection`
- Update: `check_update`, `download_update`, `install_update_now`
- Auto-launch: `enable_auto_launch`, `disable_auto_launch`, `is_auto_launch_enabled`

## Testing

**Frontend tests**: `src/lib/__tests__/*.test.ts` using Vitest + jsdom
- 63 unit tests covering stores, utilities, injection templates
- Mock Tauri APIs using `vitest.mock('@tauri-apps/api/*')`
- Test file must have `.test.ts` or `.test.svelte.ts` suffix

**Rust tests**: `src-tauri/src/*.rs` using `#[cfg(test)]` modules
- 27 unit tests covering proxy parsing, base64 decoding, webview management
- Use `tempfile` crate for testing data directories

Run `pnpm test` before committing. All tests must pass.

## Quality Gates (Pre-Commit Checklist)

Before marking any task complete:

1. `pnpm run check` → 0 TypeScript errors
2. `pnpm lint` → ESLint + Rust fmt/clippy pass
3. `pnpm test` → All tests pass
4. `pnpm tauri dev` → Starts without errors
5. All user-facing strings use i18n (no hardcoded text)
6. All constants defined in `constants.ts` (no magic numbers)
7. Use `logger` instead of `console.log`
8. CSS uses custom properties (no hardcoded colors)
9. Drag regions never applied to interactive elements
10. TypeScript types specified (minimize `any`)

## Common Pitfalls

1. **Don't create `WebviewWindow` directly** → Use `ChildWebviewProxy`
2. **Don't use Svelte 4 stores** → Use Runes (`$state`, `$derived`)
3. **Don't use inline styles** → Use scoped CSS with custom properties
4. **Don't hardcode strings** → Use i18n keys
5. **Don't hardcode values** → Define in `constants.ts`
6. **Don't use `console.log`** → Use `logger`
7. **Don't add Tailwind** → Pure CSS only
8. **Don't skip testing** → Write tests for new features
9. **Don't apply drag regions to buttons** → Use `data-tauri-drag-region` carefully
10. **Don't write non-English log messages** → All logs in English

## Adding New AI Platforms

1. Add platform metadata to `DEFAULT_PLATFORMS` in `src/lib/utils/constants.ts`
2. Create injection template in `src/lib/utils/injection-templates.ts`
3. Test selectors work on the actual website
4. Add platform icon to `src/lib/assets/icons/`
5. Update i18n keys if adding new UI text
6. Test webview isolation (cookies, sessions)

## Build & Release

- Version sync: `pnpm version:sync` (updates package.json + tauri.conf.json)
- Build targets: MSI/NSIS (Windows), DMG/App (macOS), DEB/AppImage (Linux)
- Auto-update: GitHub Releases with signature verification
- Bundle: `pnpm tauri build` → outputs to `src-tauri/target/release/bundle/`

## Important Notes

- SPA mode: `src/routes/+layout.ts` sets `export const ssr = false;`
- All data stored locally via `@tauri-apps/plugin-store` (no cloud sync)
- Proxy settings apply per-webview (each platform can have different proxy)
- Global shortcuts: Cmd/Ctrl+Shift+A (main), +T (translate), +S (selection toolbar)
- Minimum selection length: 2 characters (configurable in constants)
- Injection timeout: 30 seconds for AI responses, 15 seconds for translation

## Language Preference

请尽量使用中文进行回复与说明；仅在用户明确要求或上下文确有需要时再改用其他语言。
