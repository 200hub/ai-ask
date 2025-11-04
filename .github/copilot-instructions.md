# Instructions — AI Ask

These instructions help AI coding agents work productively in this repo. Focus on core architectural patterns and critical constraints; avoid over-specification of implementation details.

## Language Preference

- 请尽量使用中文进行回复与说明；仅在用户明确要求或上下文确有需要时再改用其他语言。

## Big Picture

- **Tech stack**: Tauri 2.x (Rust backend) + SvelteKit 2 (SPA mode) + Svelte 5 Runes
- **Architecture**: Main window (Svelte SPA) + child webviews (one per AI platform, managed by Rust)
- **Why**: SPA for fast UI; child webviews isolate AI sites (sessions, proxy, security)
- **Key pattern**: Frontend coordinates via `ChildWebviewProxy` wrapper → Rust manages actual webviews via `invoke()` commands

## Core Conventions

### Svelte 5 Runes Only

- Use `$state`, `$derived`, `$effect` for all reactive state
- Example: `class Store { value = $state(0); } export const store = new Store();`
- **Do NOT** introduce Svelte 4 `writable`/`readable`/`derived` patterns in new code

### SPA Mode

- `src/routes/+layout.ts` sets `export const ssr = false;`
- All routing is client-side only

### Styling: Pure CSS with Custom Properties

- **NO Tailwind or other CSS frameworks**
- Use CSS variables defined in `src/lib/styles/base.css`: `--bg-primary`, `--text-primary`, `--accent-color`, etc.
- Supports light/dark themes via `.dark` class
- Use `rem` units; minimal spacing (< 1rem default)
- Scoped styles in `<style>` blocks

### i18n

- Use `i18n.t()` function (NOT a store subscription)
- Pattern: `import { i18n } from '$lib/i18n'; const t = i18n.t;`
- Four locales: `zh-CN` (default), `en-US`, `ja-JP`, `ko-KR`
- All user-facing text must use i18n keys (dot notation: `settings.general.title`)
- Update all four locale files when adding keys

### Naming

- Components: PascalCase
- Files: kebab-case or PascalCase
- Variables: camelCase
- Constants: UPPER_SNAKE_CASE

## Critical Architecture Patterns

### Child Webview Management

- **Frontend**: `ChildWebviewProxy` wrapper (from `src/lib/utils/childWebview.ts`)
- **Backend**: Rust manages actual webviews via commands: `ensure_child_webview`, `show_child_webview`, `hide_child_webview`, etc.
- **Never** create `WebviewWindow` directly in frontend code
- Proxy methods: `ensure()`, `show()`, `hide()`, `close()`, `setFocus()`, `updateBounds()`

### Window Visibility Coordination

Two flows for hiding main window:

1. **User clicks close button** (Header):

   - Frontend dispatches DOM event `hideAllWebviews`
   - Frontend hides child webviews
   - Frontend calls `appWindow.hide()`

2. **Tray/hotkey triggered** (Rust):
   - Rust emits Tauri event `hideAllWebviews`
   - Frontend hides child webviews
   - Rust waits 100ms
   - Rust hides main window

**Show flow**: Rust shows main → emits `restoreWebviews` → frontend restores children

### Drag Regions

- Mark with `data-tauri-drag-region` attribute (or `-webkit-app-region: drag` CSS)
- **Never** apply to interactive elements (buttons, inputs, links)

### State Management (Stores)

- All stores in `src/lib/stores/*.svelte.ts` using Runes
- Export singleton instance: `export const appState = new AppState();`
- Use `@tauri-apps/plugin-store` for persistence via `src/lib/utils/storage.ts` helpers

### Logging

- Use `logger` from `$lib/utils/logger` (NOT `console.log`)
- Dev: logs all; Prod: logs errors/warnings only
- **All log messages must be in English** for consistency and debugging across teams
- Format: Use clear, structured log messages with context (e.g., `logger.info('Platform enabled', { platformId, enabled })`)

### Constants Management

- **All hardcoded values MUST be defined in `src/lib/utils/constants.ts`**
- Include: URLs, timeouts, limits, default values, magic numbers, API endpoints, feature flags
- Pattern: Export as named constants with UPPER_SNAKE_CASE naming
- Example: `export const DEFAULT_WINDOW_WIDTH = 800;`
- Never use magic numbers or hardcoded strings directly in code

## Project-Specific Rules

### DO

- Use Runes for all new reactive state
- Use CSS custom properties from `base.css` for theming
- Use `i18n.t()` for all user-facing text
- Use `ChildWebviewProxy` for child webview operations
- Use `logger` for intentional logging (all messages in English)
- Define all hardcoded values in `constants.ts`
- Order imports: Svelte/external → Tauri → internal
- Follow Svelte 5 component structure: imports → props → state → derived → effects → functions → template → styles
- Handle errors gracefully with `appState.setError()`

### DON'T

- Don't add Tailwind CSS or CSS frameworks
- Don't use Svelte 4 store patterns in new code
- Don't hardcode user-facing strings (use i18n)
- Don't hardcode configuration values (use constants.ts)
- Don't use inline styles (prefer scoped styles with CSS variables)
- Don't manage Tauri webviews directly in frontend
- Don't use `console.log` (use `logger` instead)
- Don't write log messages in non-English languages
- Don't use `any` type without strong justification

## Pre-Task Requirements

Before starting any task:

1. **Understand the context**:

   - Use Context7 to read relevant files and understand existing patterns
   - Check how similar features are already implemented
   - Understand dependencies and their interfaces

2. **Clarify uncertainties**:
   - If task requirements are vague, ask for specific examples or expected behavior
   - If unsure about API usage, search official documentation
   - Never assume - always verify

## Task Completion Checklist

Before reporting any task as complete, you MUST run and pass `pnpm lint` (covers frontend and Rust style checks) and `pnpm test`. Record failures, fix them, and rerun until they succeed.

After completing each task:

1. **Code Quality**:

   - Remove unused imports/code
   - Extract duplicate logic into reusable functions
   - Use `logger` instead of `console.log`
   - Proper error handling with user-friendly messages
   - CSS uses custom properties (no hardcoded colors)

2. **i18n**:

   - All four locale files updated with matching keys
   - No hardcoded strings in UI

3. **Testing**:

   - Create unit tests in `src/lib/__tests__/` (`.test.ts` or `.test.svelte.ts`)
   - Use Vitest framework
   - Test happy paths, edge cases, errors, reactive state changes
   - All tests pass: `pnpm test`

4. **Quality Gates**:
   - `pnpm run check` -> 0 errors
   - `pnpm tauri dev` -> starts without errors
   - `pnpm lint` -> passes (runs frontend ESLint and Rust fmt/clippy)
   - `pnpm test` -> passes
   - Proper TypeScript types (minimize `any`)
   - Accessibility: semantic HTML, ARIA labels, keyboard nav
   - Drag regions correct (never on interactive elements)

## Developer Commands

- **Typecheck**: `pnpm run check`
- **Dev**: `pnpm tauri dev`
- **Build**: `pnpm tauri build`
- **Test**: `pnpm test`
- **Icons**: `pnpm tauri icon src-tauri/icons/app-icon.svg`

## Adding New Features

- **Component**: Define `type Props = {...}`, use `const t = i18n.t;`, scoped styles with CSS vars
- **Store**: Class with `$state` fields, async methods, singleton export
- **i18n keys**: Add to all four locale files with dot notation paths
- **Rust command**: `#[tauri::command]` in `lib.rs`, register in `.invoke_handler()`, call via `invoke()`

---

Focus on these patterns and constraints. Implementation details will evolve; these principles should remain stable.
