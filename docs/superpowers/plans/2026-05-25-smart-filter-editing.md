# Smart Filter Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete smart-filter mask editing, controls, reordering, and stacked preview behavior in the existing Photoshop Web editor.

**Architecture:** Keep the reducer and existing panel architecture. Add small pure preview-cache helpers, then wire the Filter Gallery, Layers panel, Properties panel, and CanvasView to those helpers and existing smart-filter actions.

**Tech Stack:** Next.js 16, React 19, TypeScript, Canvas 2D, Playwright.

---

### Task 1: Smart-Filter Preview Cache Helpers

**Files:**
- Create: `components/photoshop/smart-filter-preview.ts`
- Test: `tests/smart-filter-preview.spec.ts`

- [ ] Write failing tests for stable stack-entry keys and first-dirty-index detection.
- [ ] Implement pure helper functions for preview stack caching.
- [ ] Run `npx playwright test tests/smart-filter-preview.spec.ts`.

### Task 2: Filter Gallery Preview Reuse

**Files:**
- Modify: `components/photoshop/filter-gallery.tsx`
- Test: `tests/smart-filter-ui.spec.ts`

- [ ] Wire Filter Gallery preview rendering to reuse the scaled base preview and cached per-entry outputs.
- [ ] Keep existing stack add, toggle, parameter, blend, opacity, density, feather, and drag behavior.
- [ ] Run `npx playwright test tests/smart-filter-ui.spec.ts`.

### Task 3: Layer-Panel Reordering

**Files:**
- Modify: `components/photoshop/panels/layers-panel.tsx`
- Test: `tests/smart-filter-ui.spec.ts`

- [ ] Add a failing UI test that drags a Layers panel smart-filter sub-row onto another and verifies order changes.
- [ ] Add drag handles/drop handling to the smart-filter sub-item rows.
- [ ] Run `npx playwright test tests/smart-filter-ui.spec.ts --grep "layer panel"`.

### Task 4: Canvas Mask Edit Mode

**Files:**
- Modify: `components/photoshop/canvas-view.tsx`
- Test: `tests/smart-filter-ui.spec.ts`

- [ ] Add a failing UI test that activating a smart-filter mask shows a canvas edit banner with filter, layer, density, feather, and exit control.
- [ ] Render the compact banner over the canvas and wire exit to `set-active-smart-filter-mask`.
- [ ] Run `npx playwright test tests/smart-filter-ui.spec.ts --grep "mask edit"`.

### Task 5: Documentation And Verification

**Files:**
- Modify: `browser-implementable-status-report.md`

- [ ] Update the smart-filter status section to reflect completed browser-implementable work and remaining PSD-native limits.
- [ ] Run `npm run typecheck`.
- [ ] Run focused Playwright tests for smart-filter masks, previews, and UI.
