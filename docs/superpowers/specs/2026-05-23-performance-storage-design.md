# Performance / Storage Design

## Goal

Implement browser-native performance and storage infrastructure for large Photoshop-style documents while preserving the current HTML canvas editing model and graceful fallbacks.

## Scope

- Adopt OffscreenCanvas for scratch surfaces and export encoding where the runtime supports it.
- Expand worker-backed filters and add worker-backed raster export encoding.
- Use OPFS scratch storage for large transient blobs, autosave deltas, and tile spillover with in-memory fallback.
- Add a tiled backing store abstraction for large documents and dirty-region writes.
- Make autosave incremental by tracking per-document versions and changed document snapshots.
- Improve render invalidation by preserving layer-specific changes through the render bus and progressive renderer.
- Enforce memory budgets with deterministic planner decisions and non-destructive pressure actions.
- Render progressive previews before full-resolution work for large documents.

## Architecture

The implementation adds small modules under `components/photoshop/` and connects them to existing integration points:

- `offscreen-canvas.ts`: feature detection, surface policy, and blob conversion helpers.
- `tiled-backing-store.ts`: tile grid, dirty rect mapping, tile read/write state, and OPFS spill metadata.
- `memory-budget.ts`: estimates document/history/export/tile memory and recommends actions.
- `progressive-renderer.ts`: preview scale, tile order, and progressive scheduling decisions.
- `export-worker.ts`: worker-backed raster encoding from ImageData with OffscreenCanvas fallback.
- `autosave-planner.ts`: extended incremental autosave manifest and delta planning.
- Existing `filter-worker.ts`: more worker-supported expensive filters.
- Existing `canvas-view.tsx`, `document-io.ts`, and `autosave-recovery.tsx`: runtime integration.

## Behavior

OffscreenCanvas is preferred only for detached scratch/export work. Layer canvases remain `HTMLCanvasElement` so existing tools, panels, tests, and PSD I/O keep working.

OPFS writes are best effort. If OPFS is absent, quota is uncertain, or writes fail, the storage API falls back to memory/localStorage/IndexedDB instead of blocking editing.

Large document rendering uses progressive preview planning and tile-aware dirty rects. Full renders still produce the same final pixels, but preview work can be lower resolution and partial invalidations can avoid re-rendering unrelated tiles.

Memory enforcement is planner-driven and conservative: avoid allocating full-frame caches, compress/spill scratch blobs, prefer tiled processing, and reject only clearly impossible writes.

## Testing

Add Playwright unit-style tests for deterministic planners and runtime fallbacks:

- OffscreenCanvas policy and fallback conversion.
- OPFS storage planning and incremental autosave delta manifests.
- Tiled backing store dirty rect mapping and tile budgets.
- Memory budget recommendations.
- Progressive preview render plans.
- Worker filter support growth.
- Raster export worker fallback behavior.

