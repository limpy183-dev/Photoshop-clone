# Canvas View Sponge Stamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the sponge brush pixel operation from `canvas-view.tsx` into the shared retouch helper module without changing canvas interaction behavior.

**Architecture:** Keep `CanvasView` responsible for pointer routing, selection checks, and stroke lifecycle. Move only the pure `spongeStamp` canvas mutation into `components/photoshop/tool-helpers.ts`, next to `blurStamp`, `sharpenStamp`, and `dodgeBurnStamp`.

**Tech Stack:** React 19, Next.js 16, TypeScript, Canvas 2D APIs, Playwright module tests.

---

### Task 1: Characterize Sponge Stamp Pixels

**Files:**
- Create: `tests/tool-helpers-retouch.spec.ts`
- Modify: none

- [ ] **Step 1: Add a focused sponge stamp test**

Create a fake `CanvasRenderingContext2D` with `canvas`, `getImageData`, and `putImageData`. Use a small `ImageData` fixture with a saturated opaque center pixel, a transparent pixel inside the brush footprint, and an outside pixel.

- [ ] **Step 2: Run the test before extraction**

Run: `npx playwright test --config=playwright.node.config.ts tests/tool-helpers-retouch.spec.ts --workers=1`

Expected: fail because `spongeStamp` is not exported from `tool-helpers.ts`.

### Task 2: Move Sponge Stamp

**Files:**
- Modify: `components/photoshop/tool-helpers.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Export `spongeStamp` from `tool-helpers.ts`**

Place the function after `dodgeBurnStamp`, preserving the existing loop and pixel math exactly.

- [ ] **Step 2: Import `spongeStamp` in `canvas-view.tsx`**

Add it to the existing `tool-helpers` import list and remove the local `spongeStamp` function.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/tool-helpers-retouch.spec.ts --workers=1
npx playwright test --config=playwright.node.config.ts tests/canvas-brush-dynamics.spec.ts tests/canvas-tools.spec.ts --workers=1
```

Expected: all selected tests pass.

### Task 3: Verify And Commit

**Files:**
- Commit: `components/photoshop/tool-helpers.ts`
- Commit: `components/photoshop/canvas-view.tsx`
- Commit: `tests/tool-helpers-retouch.spec.ts`
- Commit: `docs/superpowers/plans/2026-06-16-canvas-view-sponge-stamp.md`

- [ ] **Step 1: Run static checks**

Run:

```powershell
npm run typecheck
npx eslint components/photoshop/canvas-view.tsx components/photoshop/tool-helpers.ts tests/tool-helpers-retouch.spec.ts
```

Expected: both commands pass.

- [ ] **Step 2: Run broader verification**

Run:

```powershell
npm run lint
npm run build
```

Expected: both pass. The existing webpack circular dependency warning may still appear.

- [ ] **Step 3: Commit**

Run:

```powershell
git add components/photoshop/canvas-view.tsx components/photoshop/tool-helpers.ts tests/tool-helpers-retouch.spec.ts docs/superpowers/plans/2026-06-16-canvas-view-sponge-stamp.md
git commit -m "refactor: extract canvas sponge stamp"
```
