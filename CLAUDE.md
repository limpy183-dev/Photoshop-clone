# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Before proposing work on features marked impossible in the browser (Adobe cloud/AI services, native plugin runtimes, certified CMM, codecs beyond `MediaRecorder`, exact native Photoshop algorithm parity), read [BOUNDARIES.md](BOUNDARIES.md) — those are intentional non-goals, not backlog.

## Commands

```bash
npm run dev          # Start dev server on http://localhost:3000
npm run doctor       # Check Node/npm/Playwright setup
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check (no emit)
npm run check:architecture # import-cycle and architecture budgets
npm run test:smoke   # fast desktop/mobile Playwright smoke matrix
npm run verify       # lint + typecheck + capability + architecture + build + bundle + smoke
```

Use Node 22 to match CI. On Windows PowerShell setups that block `npm.ps1`,
run commands through `npm.cmd`, for example `npm.cmd run verify`.

Run a single Playwright test file:
```bash
npx playwright test tests/canvas-interaction-performance.spec.ts
```

Run tests matching a tag:
```bash
npx playwright test --grep @matrix-smoke
```

## Architecture

This is a browser-based Photoshop-style image editor built with Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, and Radix UI.

### State Management

All editor state lives in `components/photoshop/editor-context.tsx` — a single `EditorProvider` using a reducer pattern. Every state mutation dispatches a typed action (e.g., `set-brush`, `add-layer`, `apply-filter`). This keeps keyboard shortcuts, menu commands, and the command palette all routing through the same dispatch path.

### Cross-Component Communication

Rather than prop drilling, cross-component signals use custom window events:
- `ps-open-command-palette`, `ps-open-export-as` — open dialogs
- `ps-preferences-changed` — reload prefs
- `ps-set-dock-width` — resize the right dock

The right-click context menu (`ContextMenuLayer`) uses this pattern to avoid triggering canvas re-renders on menu open/close.

### Canvas & Rendering

`components/photoshop/canvas-view.tsx` handles canvas rendering and pointer input routing. The canvas uses HTML5 2D (no WebGL). Expensive filters run in a Web Worker with optional tiling (`filter-worker.ts`) — large documents are split into tiles to avoid blocking the main thread. Filter output is verified with golden-image Playwright tests.

### History / Undo

Last 12 history entries are kept as raw snapshots; older entries are compressed to WebP blobs in a Map and decompressed on demand via `createImageBitmap`. This bounds memory usage for long sessions.

### Panels & Dialogs

Panels are registered in `panel-registry.tsx` — this is the single source of truth for the right dock, workspace presets, and command-palette discovery. Heavy dialogs (`CommandPalette`, `ImageSizeDialog`, etc.) are lazy-loaded with `React.lazy` to reduce first-paint bundle size.

### PSD I/O

PSD import/export uses the `ag-psd` library (`document-io.ts`). The app intentionally surfaces browser limitations rather than hiding them: 8-bit RGBA only (no CMYK, ICC profiles, 16/32-bit), and generates compatibility reports for unsupported PSD constructs.

### Testing

Playwright config (`playwright.config.ts`) auto-starts the dev server and runs two projects:
- `chromium` — full desktop suite, excludes `@matrix-smoke`
- `mobile-chromium-smoke` — Pixel 5 viewport, only `@matrix-smoke` tagged tests

Trace is captured on first retry. Base URL is `http://127.0.0.1:3000`.

## Key Files

| File | Purpose |
|------|---------|
| `components/photoshop/editor-context.tsx` | Central state machine |
| `components/photoshop/types.ts` | All shared types (ToolId, BlendMode, LayerKind, …) |
| `components/photoshop/canvas-view.tsx` | Canvas render + pointer routing |
| `components/photoshop/panel-registry.tsx` | Panel definitions + workspace presets |
| `components/photoshop/filters.ts` | Filter registry (60+ filters) |
| `components/photoshop/filter-worker.ts` | Async + tiled filter execution |
| `components/photoshop/document-io.ts` | PSD + raster file I/O |
| `components/photoshop/brush-engine.ts` | Brush rendering, pressure, dynamics |
| `playwright.config.ts` | Test configuration |
