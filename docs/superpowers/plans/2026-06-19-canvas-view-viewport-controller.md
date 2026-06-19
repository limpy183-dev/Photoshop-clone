# Canvas View Viewport Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract zoom/pan viewport state and helpers from `canvas-view.tsx` into a focused controller module without changing canvas interaction behavior.

**Architecture:** Keep `CanvasView` responsible for rendering, pointer tools, and editor integration. Move transient zoom refs, stage transform application, wheel zoom/pan handling, and Photoshop zoom event subscriptions into `components/photoshop/canvas-viewport-controller.ts`. Export small pure helpers from that module so the math can be tested without a browser-rendered React tree.

**Tech Stack:** React 19 hooks, Next.js client components, TypeScript, Canvas DOM refs, Playwright node/browser tests.

---

### Task 1: Characterize Viewport Math

**Files:**
- Create: `tests/canvas-viewport-controller.spec.ts`

- [x] **Step 1: Add module tests**

Create tests that import `composeStageTransform`, `imageRenderingForZoom`, and `wheelViewportChange` from `components/photoshop/canvas-viewport-controller.ts`.

Cover:
- Stage transforms include translate and rotation, and omit scale when the transient scale is effectively `1`.
- Stage transforms include a scale suffix when transient zoom previewing needs it.
- Zooms below `4` use `"auto"` image rendering; zooms at or above `4` use `"pixelated"`.
- Ctrl/meta/alt wheel input returns a clamped zoom target using the current exponential wheel factor.
- Plain wheel input returns the panned stage offset.

- [x] **Step 2: Run red test**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-viewport-controller.spec.ts --workers=1
```

Expected: fail because `components/photoshop/canvas-viewport-controller.ts` does not exist yet.

### Task 2: Extract The Controller

**Files:**
- Create: `components/photoshop/canvas-viewport-controller.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [x] **Step 1: Create helper and hook module**

Add these exports:

```ts
export const ZOOM_COMMIT_IDLE_MS = 420
export function composeStageTransform(pan: { x: number; y: number }, rotation = 0, transientScale = 1): string
export function imageRenderingForZoom(zoom: number): "pixelated" | "auto"
export function wheelViewportChange(input: WheelViewportInput): WheelViewportChange
export function useCanvasViewportController(options: CanvasViewportControllerOptions): CanvasViewportController
```

The hook owns `panRef`, `viewZoom`, `layoutZoomRef`, `visualZoomRef`, pending zoom animation frame/timer refs, `applyStageTransform`, `applyViewZoom`, cleanup, `ps-request-zoom`, `ps-request-print-size-view`, and wheel handling.

- [x] **Step 2: Wire `canvas-view.tsx` to the hook**

Remove the local viewport refs/effects and local `onWheel` implementation from `CanvasView`.

Import:

```ts
import { useCanvasViewportController } from "./canvas-viewport-controller"
```

Then initialize:

```ts
const {
  panRef,
  viewZoom,
  visualZoomRef,
  applyStageTransform,
  applyViewZoom,
  onWheel,
} = useCanvasViewportController({
  activeDoc,
  canvasPrefs,
  compositeRef,
  overlayRef,
  stageRef,
  onCommitZoom: (zoom) => dispatch({ type: "set-zoom", zoom }),
})
```

All existing call sites for `panRef`, `viewZoom`, `visualZoomRef`, `applyStageTransform`, `applyViewZoom`, and `onWheel` should keep working.

- [x] **Step 3: Run focused tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-viewport-controller.spec.ts tests/canvas-view-runtime.spec.ts tests/canvas-interaction-performance.spec.ts --workers=1
```

Expected: all selected tests pass.

### Task 3: Verify And Commit

**Files:**
- Commit: `components/photoshop/canvas-view.tsx`
- Commit: `components/photoshop/canvas-viewport-controller.ts`
- Commit: `tests/canvas-viewport-controller.spec.ts`
- Commit: `docs/superpowers/plans/2026-06-19-canvas-view-viewport-controller.md`

- [x] **Step 1: Run static checks**

Run:

```powershell
npm run typecheck
npx eslint components/photoshop/canvas-view.tsx components/photoshop/canvas-viewport-controller.ts tests/canvas-viewport-controller.spec.ts
```

Expected: both commands pass.

- [x] **Step 2: Run broader verification**

Run:

```powershell
npm run lint
npm run build
npm run test:smoke -- --workers=2
```

Expected: all commands pass. The existing webpack circular dependency warning may still appear during build/browser tests.

In this managed sandbox, the normal Playwright web-server wrapper completed test output but hung during server teardown. Full smoke was verified with a temporary no-webserver config against a manually started dev server on `http://127.0.0.1:3000`, preserving the same project filters as `playwright.config.ts`.

- [ ] **Step 3: Commit**

Run:

```powershell
git add components/photoshop/canvas-view.tsx components/photoshop/canvas-viewport-controller.ts tests/canvas-viewport-controller.spec.ts docs/superpowers/plans/2026-06-19-canvas-view-viewport-controller.md
git commit -m "refactor: extract canvas viewport controller"
```
