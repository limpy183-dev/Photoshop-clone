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

Use Node 24 to match CI. On Windows PowerShell setups that block `npm.ps1`,
run commands through `npm.cmd`, for example `npm.cmd run verify`.

Run a single Playwright test file:
```bash
npx playwright test tests/canvas/interaction-performance.spec.ts
```

Run tests matching a tag:
```bash
npx playwright test --grep @matrix-smoke
```

## Architecture

This is a browser-based Photoshop-style image editor built with Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, and Radix UI.

### Layout

The editor spans two roots, split by layer:

- `editor/` — the engine. Pure TypeScript: reducer, history, filters, codecs, PSD I/O, colour pipeline, brush and selection algorithms. No JSX.
- `components/photoshop/` — the React layer. Panels, dialogs, menus, canvas host.

Inside each, files are grouped by the prefix they already had: `canvas/`, `psd/`,
`raster/`, `document/`, `color/`, `tool/`, `filters/`, `export/`, `advanced/`. The
`editor-*` group is the `editor/` root itself (`editor/reducer.ts`,
`editor/store.ts`). `tests/` mirrors the same folders.

Two conventions worth knowing before adding a file:

- **Import through `@/`, never relatively.** Enforced by `no-restricted-imports`.
  Alias paths survive a `git mv`; relative ones make every file move a diff in its
  neighbours.
- **No per-folder `index.ts` barrels.** Import the file. The one barrel that
  exists, `editor/types.ts`, is a deliberate single import site for shared types.

### State Management

All editor state lives in `components/photoshop/editor/context.tsx` — a single `EditorProvider` using a reducer pattern. Every state mutation dispatches a typed action (e.g., `set-brush`, `add-layer`, `apply-filter`). This keeps keyboard shortcuts, menu commands, and the command palette all routing through the same dispatch path.

### Cross-Component Communication

Rather than prop drilling, cross-component signals use custom window events:
- `ps-open-command-palette`, `ps-open-export-as` — open dialogs
- `ps-preferences-changed` — reload prefs
- `ps-set-dock-width` — resize the right dock

The right-click context menu (`ContextMenuLayer`) uses this pattern to avoid triggering canvas re-renders on menu open/close.

### Canvas & Rendering

`components/photoshop/canvas/view.tsx` coordinates rendering and pointer input. Layer composition can use the WebGL compositor with a Canvas 2D fallback. Expensive filters run in a Web Worker with optional tiling (`editor/filters/worker.ts`) — large documents are split into tiles to avoid blocking the main thread. Filter output is verified with golden-image Playwright tests.

`view.tsx` is a coordinator, not a dumping ground: it holds the refs, mounts the
controllers, assembles the pointer context, and renders. **Nothing a tool gesture
*does* lives there** — it all lives in `editor/canvas/*`.

The controllers are hooks that own a subsystem's refs and expose its verbs.
`view.tsx` mounts each one once and passes the bundle around:

| Controller | Owns |
|------------|------|
| `paint-session.ts` | a stroke's lifetime: paint target, frozen sources, stroke buffer, mixer reservoir, dirty rects, `drawSegment` |
| `path-editing-controller.ts` | the pen draft, the direct-selection anchor set, anchor-level edits |
| `transform-controller.ts` | the Free Transform session and the transform menu commands |
| `selection-commit.ts` | every path from a gesture to `set-selection`, plus the magnetic lasso |
| `document-operations.ts` | one-shot pixel rewrites: both crops, gradient commit, red-eye, magic eraser |
| `overlay-preview-bindings.ts` | binds the pure painters below to the live overlay canvas |
| `color-hud-controller.ts` | the Alt+Shift+right-click colour HUD |
| `viewport-controller.ts` | pan / zoom / wheel |
| `filter-overlay-controller.ts` | Blur Gallery / Lighting Effects on-canvas widgets |
| `text-edit-controller.ts` | the type tool's DOM editing session |

Pointer input is routed, not handled, by `view.tsx`. The handlers are plain
functions over one context object:

| Module | Holds |
|--------|-------|
| `pointer-context.ts` | `CanvasPointerContext` — everything the handlers may reach |
| `pointer-down.ts` | the tool dispatch that starts a gesture |
| `pointer-move.ts` | advancing whatever gesture is open |
| `pointer-up.ts` | commit, cancel, and double-click |
| `drag-state.ts` | `CanvasDragState`, the one in-progress gesture |

The pure leaves those call, none of which touch React:

| Module | Holds |
|--------|-------|
| `composite-renderer.ts` | the whole render decision tree (cache, tiles, high-bit, WebGL, Canvas 2D) |
| `brush-stamping.ts` | one brush sample → pixels: dab shapes, textures, symmetry, scatter |
| `replacement-stamps.ts` | the two read-before-write dabs (background eraser, colour replacement) |
| `overlay-previews.ts` | pure overlay-canvas draws (marquee, gradient ramp, path skeleton, transform handles) |
| `vector-editing.ts` | vector hit-testing and direct-selection drags |
| `transform-geometry.ts` | free-transform math, including handle drags |

`components/photoshop/canvas/view-overlays.tsx` is the sibling holding the DOM
layers stacked over the canvases (marching ants, guides, grids, type editor).

`view.tsx` has an import budget in `scripts/architecture-budgets.json` for
exactly this reason — a new import there is a prompt to check whether the logic
belongs in `editor/canvas/` instead.

### History / Undo

Last 12 history entries are kept as raw snapshots; older canvas-bearing history fields are encoded losslessly as PNG blobs and restored on demand via `createImageBitmap`. Compression jobs are cancellable and verify entry liveness before publishing blobs.

### Panels & Dialogs

Panels are registered in `panel-registry.tsx` — this is the single source of truth for the right dock, workspace presets, and command-palette discovery. Heavy dialogs (`CommandPalette`, `ImageSizeDialog`, etc.) are lazy-loaded with `React.lazy` to reduce first-paint bundle size.

The big panels and dialogs are split rather than grown, along two seams. Anything
pure — a probe, a picker list, an image-math pass — belongs in `editor/`, not in a
`.tsx` file; `editor/document/` collects the layer-side ones (`mask-state.ts`,
`layer-health.ts`, `layer-filtering.ts`, `layer-options.ts`, `auto-adjust.ts`).
Anything that is one self-contained region of UI gets a sibling file next to its
parent:

| Parent | Siblings |
|--------|----------|
| `properties-panel.tsx` | `properties-tool-section.tsx` (per-tool controls), `properties-controls.tsx` (shared primitives) |
| `layers-panel.tsx` | `layers-panel-thumbs.tsx` (row leaf components) |
| `options-bar.tsx` | `options-bar-tools.tsx` (per-tool option groups), `options-bar-shared.tsx` |
| `advanced/subsystems-dialog.tsx` | one `subsystems-<tab>-workspace.tsx` per tab |
| `rich-tooltip.tsx` | `editor/tool/preview-{painters,primitives,raster,vector,viewport}.ts` |

The shared primitives live in their own file for a reason: a section file and its
parent must not import each other, or the import-cycle gate fails.

### PSD I/O

PSD import/export uses `ag-psd` plus dedicated PSD color-mode/resource modules. The document model supports high-bit/color intent, ICC metadata, and CMYK/Lab/multichannel compatibility paths. Browser Canvas editing still resolves through RGBA surfaces, so unsupported native fidelity is reported rather than silently promised.

### Testing

Lanes live in `playwright/`, sharing `playwright/base.ts` (test root, timeouts,
the Next smoke server). Root `playwright.config.ts` re-exports the main lane so
bare `npx playwright test <file>` works.

| Lane | Runs |
|------|------|
| `playwright/main.config.ts` | full desktop suite + `@matrix-smoke` on Pixel 5, port 3000 |
| `playwright/smoke.config.ts` | `photoshop-smoke.spec.ts`, desktop + mobile, port 3000 |
| `playwright/dev.config.ts` | hydration spec against a real `next dev`, port 3001 |
| `playwright/static.config.ts` | static export from `out/`, port 3001 |
| `playwright/repeat.config.ts` | one critical spec, repeated, port 3002 |
| `playwright/node.config.ts` | no server; **always invoked with explicit spec files** |

Trace is captured on first retry. Base URL is `http://127.0.0.1:3000`.

## Key Files

| File | Purpose |
|------|---------|
| `components/photoshop/editor/context.tsx` | Central state machine |
| `editor/types.ts` | All shared types (ToolId, BlendMode, LayerKind, …) |
| `components/photoshop/canvas/view.tsx` | Canvas coordinator: refs, controllers, pointer routing |
| `editor/canvas/composite-renderer.ts` | Which of the five composite paths draws this frame |
| `editor/canvas/paint-session.ts` | A paint stroke, from first dab to history commit |
| `editor/canvas/pointer-down.ts` | Which gesture the active tool starts |
| `editor/canvas/overlay-previews.ts` | Overlay-canvas tool previews |
| `editor/canvas/vector-editing.ts` | Vector hit-test + direct-selection drags |
| `editor/webgl-compositor.ts` | WebGL composition with Canvas fallback |
| `editor/history-storage.ts` | Lossless, cancellable history blob storage |
| `components/photoshop/panel-registry.tsx` | Panel definitions + workspace presets |
| `editor/filters.ts` | Filter registry (60+ filters) |
| `editor/filters/worker.ts` | Async + tiled filter execution |
| `editor/document/io.ts` | PSD + raster file I/O |
| `editor/document/mask-state.ts` | Mask coverage probe behind every mask thumbnail |
| `editor/document/layer-options.ts` | Blend-mode and colour-label picker vocabulary |
| `editor/brush-engine.ts` | Brush rendering, pressure, dynamics |
| `playwright/base.ts` | Shared Playwright lane skeleton |
| `scripts/measure-route-bundles.mjs` | Production startup measurement by route |
