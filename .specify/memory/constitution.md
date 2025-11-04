# AI Ask Constitution

## Core Principles

### 0. 中文优先沟通
所有说明、解释与指令编写时必须优先使用中文进行表述；仅在用户明确要求或任务本身涉及其他语言时，方可切换到对应语言。

### I. Svelte 5 Runes Only (NON-NEGOTIABLE)
All reactive state MUST use Svelte 5 Runes: `$state`, `$derived`, `$effect`. Svelte 4 store patterns (`writable`, `readable`, `derived`) are strictly PROHIBITED in new code. Store pattern: `class Store { value = $state(0); } export const store = new Store();`

**Rationale**: Maintain consistency with Svelte 5's reactive paradigm and avoid mixing reactive patterns.

### II. Child Webview Isolation Architecture
Frontend coordinates via `ChildWebviewProxy` wrapper → Rust manages actual webviews via `invoke()` commands. Direct creation of `WebviewWindow` in frontend code is PROHIBITED. This ensures proper separation of concerns and security boundaries between main window and AI platform webviews.

**Required Pattern**:
- Frontend: Uses proxy methods (`ensure()`, `show()`, `hide()`, `close()`, `setFocus()`, `updateBounds()`)
- Backend: Rust provides commands (`ensure_child_webview`, `show_child_webview`, `hide_child_webview`, etc.)

### III. Pure CSS with Custom Properties
NO CSS frameworks (especially Tailwind CSS). All styling MUST use CSS custom properties defined in `src/lib/styles/base.css`. Theme variables: `--bg-primary`, `--text-primary`, `--accent-color`, etc. Use `rem` units for spacing (< 1rem default). Scoped styles in `<style>` blocks.

**Rationale**: Lightweight, maintainable, supports light/dark themes without framework overhead.

### IV. i18n First (NON-NEGOTIABLE)
All user-facing text MUST use i18n keys via `i18n.t()` function. Pattern: `import { i18n } from '$lib/i18n'; const t = i18n.t;`. Four locales required: `zh-CN` (default), `en-US`, `ja-JP`, `ko-KR`. When adding/modifying text, ALL four locale files MUST be updated with matching keys using dot notation (`settings.general.title`).

**Rationale**: Multi-language support is a core feature; hardcoded strings are unacceptable.

### V. Structured Logging Only
Use `logger` from `$lib/utils/logger` for all logging. `console.log` is PROHIBITED. Logger behavior: Dev logs all levels; Prod logs errors/warnings only. **All log messages MUST be in English** for consistency and debugging across teams. Format: Use clear, structured log messages with context (e.g., `logger.info('Platform enabled', { platformId, enabled })`).

**Rationale**: English logs ensure all developers can debug effectively regardless of their primary language; structured logs improve searchability and analysis.

### VI. Constants Management (NON-NEGOTIABLE)
**All hardcoded values MUST be defined in `src/lib/utils/constants.ts`**. This includes: URLs, timeouts, limits, default values, magic numbers, API endpoints, feature flags. Pattern: Export as named constants with UPPER_SNAKE_CASE naming (e.g., `export const DEFAULT_WINDOW_WIDTH = 800;`). Using magic numbers or hardcoded strings directly in code is PROHIBITED.

**Rationale**: Centralized constants improve maintainability, reduce duplication, and make configuration changes easier to track and test.

### VII. Context-Driven Development
Before implementing any feature:
1. Use Context7 to understand existing patterns, dependencies, and interfaces
2. If requirements are unclear, ASK for clarification rather than assume
3. If uncertain about APIs, SEARCH official documentation
4. Pattern: Read → Clarify → Implement

**Rationale**: Avoid assumptions, reduce rework, ensure compatibility with existing codebase.

### VIII. Test-Driven Quality
Unit tests MUST be created for new functions, utilities, and store methods. Tests live in `src/lib/__tests__/` with `.test.ts` or `.test.svelte.ts` extensions. Use Vitest framework. Coverage must include: happy paths, edge cases, errors, reactive state changes.

## Technical Constraints

### SPA Architecture
- `src/routes/+layout.ts` MUST set `export const ssr = false;`
- All routing is client-side only
- Use `@sveltejs/adapter-static` for builds

### Window Visibility Coordination
Two flows for hiding main window (MUST be maintained):

1. **User close button flow**: Frontend DOM event `hideAllWebviews` → Frontend hides children → Frontend calls `appWindow.hide()`
2. **Tray/hotkey flow**: Rust emits Tauri event `hideAllWebviews` → Frontend hides children → Rust waits 100ms → Rust hides main

**Show flow**: Rust shows main → emits `restoreWebviews` → Frontend restores children

### Drag Region Rules
- Mark with `data-tauri-drag-region` attribute OR `-webkit-app-region: drag` CSS
- NEVER apply to interactive elements (buttons, inputs, links)

### State Management Pattern
- All stores in `src/lib/stores/*.svelte.ts` using Runes
- Export singleton instances: `export const store = new Store();`
- Use `@tauri-apps/plugin-store` for persistence via `src/lib/utils/storage.ts` helpers

## Development Standards

### Code Organization
- Import order: Svelte/external → Tauri → internal
- Component structure: imports → props → state → derived → effects → functions → template → styles
- Naming: Components (PascalCase), files (kebab-case/PascalCase), variables (camelCase), constants (UPPER_SNAKE_CASE)

### Error Handling
- All errors MUST be handled with try-catch blocks
- User-facing errors via `appState.setError()` with friendly messages
- No silent failures

### TypeScript Standards
- Proper typing for all functions and variables
- Minimize `any` usage (requires strong justification if used)
- No implicit any

### Accessibility Requirements
- Semantic HTML elements
- ARIA labels on icon buttons
- Keyboard navigation support
- Test at different window sizes

## Task Completion Checklist

Every task completion MUST verify. Do not mark a task complete until `pnpm lint` (runs frontend and Rust style checks) and `pnpm test` both succeed.

### Code Quality
- No unused imports or code
- No duplicate logic (extract to reusable functions)
- Uses `logger` instead of `console.log` (all messages in English)
- All hardcoded values defined in `constants.ts`
- Proper error handling with user-friendly messages
- CSS uses custom properties (no hardcoded colors)

### i18n Compliance
- All four locale files updated with matching keys
- No hardcoded strings in UI

### Testing
- Unit tests created in `src/lib/__tests__/`
- Tests cover: happy paths, edge cases, errors, reactivity
- All tests pass (`pnpm test`)

### Quality Gates
- `pnpm run check` -> 0 errors (TypeScript & Svelte validation)
- `pnpm tauri dev` -> starts without errors
- `pnpm lint` -> passes (runs frontend ESLint and Rust fmt/clippy)
- `pnpm test` -> passes
- Proper TypeScript types (minimal `any`)
- Accessibility verified
- Drag regions correct (never on interactive elements)

## Governance

### Amendment Process
1. Propose amendment with rationale
2. Document impact on existing code
3. Require approval before implementation
4. Update this constitution with version bump

### Enforcement
- All code reviews MUST verify compliance with these principles
- Non-compliance requires immediate correction
- Exceptions require documented justification and approval

### Precedence
This constitution supersedes individual preferences, convenience shortcuts, and "quick fixes" that violate established principles. When in doubt, follow the constitution.

