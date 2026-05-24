# Performance Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production performance and scratch-storage infrastructure for large browser Photoshop documents.

**Architecture:** Add focused planner/runtime modules for OffscreenCanvas, OPFS-backed tiles, progressive rendering, memory budgets, and export workers. Wire them into existing autosave, canvas render, filter, and export paths with fallbacks.

**Tech Stack:** Next.js 16, React 19, TypeScript, Canvas 2D, OffscreenCanvas, Web Workers, OPFS, Playwright tests.

---

### Task 1: Planner Tests

**Files:**
- Create: `tests/performance-storage.spec.ts`
- Modify: `components/photoshop/autosave-planner.ts`
- Create: `components/photoshop/offscreen-canvas.ts`
- Create: `components/photoshop/tiled-backing-store.ts`
- Create: `components/photoshop/memory-budget.ts`
- Create: `components/photoshop/progressive-renderer.ts`
- Create: `components/photoshop/export-worker.ts`

- [ ] Write failing tests for OffscreenCanvas policy, autosave deltas, tiled dirty rects, memory plans, progressive plans, export worker plans, and worker filter support.
- [ ] Run `npx playwright test tests/performance-storage.spec.ts --project=chromium` and confirm expected missing-module/missing-export failures.

### Task 2: Core Modules

**Files:**
- Create: `components/photoshop/offscreen-canvas.ts`
- Create: `components/photoshop/tiled-backing-store.ts`
- Create: `components/photoshop/memory-budget.ts`
- Create: `components/photoshop/progressive-renderer.ts`
- Create: `components/photoshop/export-worker.ts`
- Modify: `components/photoshop/autosave-planner.ts`

- [ ] Implement the smallest planner/runtime APIs needed by the tests.
- [ ] Run `npx playwright test tests/performance-storage.spec.ts --project=chromium` and confirm the new planner tests pass.

### Task 3: Filter Worker Coverage

**Files:**
- Modify: `components/photoshop/filter-worker.ts`
- Modify: `tests/performance-storage.spec.ts`

- [ ] Add worker support for `lens-blur`, `surface-blur`, and `oil-paint` style expensive filters.
- [ ] Keep tiled fallback behavior intact for unsupported filters.
- [ ] Run filter-specific tests.

### Task 4: Export and Autosave Integration

**Files:**
- Modify: `components/photoshop/document-io.ts`
- Modify: `components/photoshop/export-as-dialog.tsx`
- Modify: `components/photoshop/autosave-recovery.tsx`

- [ ] Add async raster blob export that uses worker encoding when eligible.
- [ ] Use blob download in export dialog for normal raster formats, keeping data URL fallback.
- [ ] Store incremental autosave snapshots through the existing async autosave path, using delta manifests to skip unchanged documents.

### Task 5: Render Integration

**Files:**
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `components/photoshop/performance-engine.ts`
- Modify: `components/photoshop/render-bus.ts`

- [ ] Preserve render-bus layer invalidation through compose.
- [ ] Use progressive preview plans for large renders.
- [ ] Avoid full composite cache copies when memory policy rejects them.

### Task 6: Verification

**Files:**
- No new files.

- [ ] Run `npm run typecheck`.
- [ ] Run `npx playwright test tests/performance-storage.spec.ts --project=chromium`.
- [ ] Run focused existing performance tests: `npx playwright test tests/performance-scale.spec.ts tests/optimization-infra.spec.ts --project=chromium`.

