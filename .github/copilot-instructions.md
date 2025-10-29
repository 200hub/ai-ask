# Copilot Instructions — AI Ask

These instructions help AI coding agents work productively in this repo. Focus on these concrete patterns and workflows; avoid introducing foreign paradigms.

## Big picture

- App type: Desktop app using Tauri 2.0 (Rust) + SvelteKit 2 + Svelte 5 Runes (SPA, no SSR) with @sveltejs/adapter-static.
- Frontend root: `src/` (routes, lib/components, stores, i18n, utils, styles). Backend root: `src-tauri/` (Rust, config, icons).
- Major flow: Svelte SPA renders the main window; individual AI platforms load in independent Tauri WebviewWindow children managed by `src/lib/components/pages/AIChat.svelte`.
- Why this structure: SPA keeps UI simple/fast; child webviews isolate each AI site, preserve sessions, and allow fine control (show/hide, always-on-top, bounds) based on main-window geometry.

## Core conventions

- Svelte 5 Runes only. Do not use Svelte 4 stores.
  - Example store: `class Something { value = $state(0); } export const something = new Something();`
  - Read as plain props/fields; use `$effect` and `$derived` for reactivity.
- Routing: SPA only. `src/routes/+layout.ts` sets `export const ssr = false;`.
- Styling: pure CSS with repo variables; use rem units. See `src/lib/styles/base.css`.
- i18n: use direct translator function, not a store. Example:
  - `import { i18n } from '$lib/i18n'; const t = i18n.t;` then `t('common.confirm')`.
- Naming: components PascalCase; files kebab/Pascal; variables camelCase; constants UPPER_SNAKE_CASE.

## Key components and cross-cutting patterns

- Webviews lifecycle: `src/lib/components/pages/AIChat.svelte`
  - Manages a Map<platformId, WebviewWindow>; creates, positions, shows/hides; syncs always-on-top with focus.
  - Listens main window events: resize/move/scale, `tauri://focus|blur`, `tauri://window-event` (`minimized`/`hidden`).
  - Custom event `hideAllWebviews` is emitted from Rust before hiding the main window; handler calls `hideAllWebviews()`.
- Window chrome & tray: `src/lib/components/layout/Header.svelte` (drag region, close→hide). Rust tray/global shortcuts in `src-tauri/src/lib.rs`.
  - Tray left-click and global shortcut toggle show/hide; before hide, Rust emits `hideAllWebviews` to ensure child webviews hide first.
- Platforms management: `src/lib/stores/platforms.svelte.ts` and `src/lib/components/settings/PlatformSettings.svelte`.
  - Sorting uses `sortOrder` swap (not array index). Trigger reactivity with spread assignment and persist via storage utils.
- App state & config stores live under `src/lib/stores/*.svelte.ts` using Runes.

## External deps / integration

- Tauri plugins: `tauri_plugin_store`, `tauri_plugin_global_shortcut`, `tauri_plugin_shell`, `tauri_plugin_opener`.
- Frontend uses `@tauri-apps/api/webviewWindow` for WebviewWindow control and `@tauri-apps/api/webviewWindow`. Rust emits window events consumed by frontend.

## Developer workflows

- Typecheck: `pnpm run check` (runs svelte-kit sync + svelte-check).
- Dev run: `pnpm tauri dev` (starts Vite and Tauri together).
- Build: `pnpm tauri build`.
- Icons: place SVG at `src-tauri/icons/app-icon.svg`, then generate via `npx @tauri-apps/cli icon src-tauri/icons/app-icon.svg`.

## Project-specific do/don't

- Do: Use Runes ($state/$derived/$effect) for all state. Keep SSR disabled.
- Do: Use CSS variables and rem; minimal spacing (< 1rem by default). Mark drag regions with `data-tauri-drag-region` and disable on buttons.
- Do: For window visibility, propagate via events: Rust emits `hideAllWebviews` → frontend hides children → Rust hides main.
- Don’t: Introduce Svelte 4 `writable`/`$store` patterns. Don’t add SSR-only features.

## Adding features (examples)

- New component: place under `src/lib/components/...`; define a Props interface; wire i18n via `i18n.t`; follow the Svelte 5 structure order (imports → props → state → derived → effects → functions → lifecycle → template → styles).
- New store: create `*.svelte.ts` class with `$state` fields and async methods; export a singleton.
- New i18n keys: add to all four locale files in `src/lib/i18n/locales/` (zh-CN, en-US, ja-JP, ko-KR) with consistent key paths.

## Quality gates (green-before-done)

- PASS: `pnpm run check` shows 0 errors. PASS: `pnpm tauri dev` starts without runtime errors. PASS build via `pnpm tauri build` when applicable.

References: `AGENTS.md` (full conventions), `src/lib/components/pages/AIChat.svelte`, `src/lib/components/layout/Header.svelte`, `src/lib/stores/*.svelte.ts`, `src-tauri/src/lib.rs`, `src/routes/+layout.ts`.
