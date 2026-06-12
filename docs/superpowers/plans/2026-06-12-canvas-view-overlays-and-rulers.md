# Canvas View Overlays and Rulers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract smart-guide calculations, selection/text overlays, and ruler UI from `canvas-view.tsx` while preserving exact DOM, timing, pointer-cancel, and snapping behavior.

**Architecture:** Smart-guide alpha scanning and snap calculations live with the smart-guide overlay because they share one geometry contract. Selection and text overlays remain presentational client components with explicit props. Rulers own their existing local drag state and global pointer listeners, while `CanvasView` continues to create guide IDs and dispatch editor actions.

**Tech Stack:** TypeScript 5.7, React 19, React DOM server rendering, Next.js 16, Playwright 1.59.

---

## Task 1: Extract Smart Guides and Snap Geometry

**Files:**
- Create: `components/photoshop/canvas-smart-guides.tsx`
- Create: `tests/canvas-smart-guides.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add the failing smart-guide characterization test**

Create a test importing:

```ts
import {
  SmartGuidesOverlay,
  alphaBoundsForCanvas,
  alphaBoundsForLayer,
  smartSnapLayerDelta,
} from "../components/photoshop/canvas-smart-guides"
```

Use a local canvas stub whose `getImageData()` returns controlled alpha bytes. Verify:

```ts
expect(alphaBoundsForCanvas(alphaCanvas(5, 4, [[1, 1], [3, 2]]))).toEqual({
  x: 1,
  y: 1,
  w: 3,
  h: 2,
})
expect(alphaBoundsForCanvas(alphaCanvas(5, 4, []))).toBeNull()
```

Also verify `alphaBoundsForLayer` delegates to the layer canvas, `smartSnapLayerDelta` returns unchanged values when snapping is disabled, guide snapping uses the strict six-pixel threshold, and grid snapping keeps the existing nearest-target scoring.

Render `SmartGuidesOverlay` with `renderToStaticMarkup(React.createElement(...))` and assert that aligned layers emit magenta horizontal and vertical guide elements, while missing or hidden active layers emit an empty string.

- [ ] **Step 2: Run the test and verify RED**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-smart-guides.spec.ts
```

Expected: module resolution fails because `canvas-smart-guides.tsx` does not exist.

- [ ] **Step 3: Move the existing smart-guide implementation**

Move exact implementations and export:

```ts
export function SmartGuidesOverlay(...)
export function alphaBoundsForLayer(layer: Layer)
export function alphaBoundsForCanvas(canvas: HTMLCanvasElement | null | undefined)
export function smartSnapLayerDelta(
  doc: PsDocument,
  movingLayer: Layer,
  snapshot: HTMLCanvasElement,
  dx: number,
  dy: number,
)
```

Keep the alpha threshold at `> 8`, visual snap threshold at `3`, movement snap threshold at `6`, target ordering, rounding, deduplication, and magenta styles unchanged.

- [ ] **Step 4: Replace definitions in CanvasView with imports**

Import `SmartGuidesOverlay` and `smartSnapLayerDelta`. Remove only the four moved definitions; do not change move-tool pointer calculations or layer snapshot timing.

- [ ] **Step 5: Verify and commit**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-smart-guides.spec.ts
npm run typecheck
git add components/photoshop/canvas-smart-guides.tsx components/photoshop/canvas-view.tsx tests/canvas-smart-guides.spec.ts
git commit -m "refactor: extract canvas smart guides"
```

## Task 2: Extract Selection and Text Overlays

**Files:**
- Create: `components/photoshop/canvas-selection-overlays.tsx`
- Create: `tests/canvas-selection-overlays.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add the failing overlay characterization test**

Import:

```ts
import {
  MaskSelectionOverlay,
  SelectionOverlay,
  TextEditOverlay,
} from "../components/photoshop/canvas-selection-overlays"
```

Use `renderToStaticMarkup` to verify:

```ts
const rectangular = renderToStaticMarkup(
  React.createElement(SelectionOverlay, {
    bounds: { x: 10, y: 20, w: 30, h: 40 },
    shape: "rect",
    docW: 100,
    docH: 200,
  }),
)
expect(rectangular).toContain("left:10%")
expect(rectangular).toContain("top:10%")
expect(rectangular).toContain("width:30%")
expect(rectangular).toContain("height:20%")
expect(rectangular).not.toContain("rounded-[100%]")
```

Verify ellipse markup includes `rounded-[100%]`, `MaskSelectionOverlay` renders the unchanged full-stage canvas class, and `TextEditOverlay`:

- returns empty markup for a missing/non-text layer;
- renders the current value;
- preserves percentage positioning, font family, scaled font size, weight, italic style, color, alignment, and minimum height.

- [ ] **Step 2: Run the test and verify RED**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-selection-overlays.spec.ts
```

Expected: module resolution fails because `canvas-selection-overlays.tsx` does not exist.

- [ ] **Step 3: Move the overlay implementations**

Move exact implementations of:

```ts
export function MaskSelectionOverlay(...)
export function SelectionOverlay(...)
export function TextEditOverlay(...)
```

Keep the marching-ants timer at `90ms`, both dash passes, phase modulo `8`, effect cleanup, textarea keyboard propagation, Escape cancellation, modifier-Enter commit, auto-focus, and all classes/styles unchanged.

- [ ] **Step 4: Replace definitions in CanvasView with imports**

Remove only the three moved components. Keep `editingText` state and `commitTextEdit` in `CanvasView`.

- [ ] **Step 5: Verify and commit**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-selection-overlays.spec.ts
npx playwright test --config=playwright.node.config.ts tests/canvas-smart-guides.spec.ts
npm run typecheck
git add components/photoshop/canvas-selection-overlays.tsx components/photoshop/canvas-view.tsx tests/canvas-selection-overlays.spec.ts
git commit -m "refactor: extract canvas selection overlays"
```

## Task 3: Extract Rulers and Guide Drag Lifecycle

**Files:**
- Create: `components/photoshop/canvas-rulers.tsx`
- Create: `tests/canvas-rulers.spec.ts`
- Create: `tests/canvas-ruler-interactions.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add the failing ruler render test**

Import `Rulers` and `RulerTicks` from the planned module. Use `renderToStaticMarkup` to verify horizontal and vertical ruler markup retains:

- `18px` dimensions and offsets;
- `cursor-s-resize` and `cursor-e-resize`;
- current panel/divider classes;
- horizontal labels in normal writing mode;
- vertical labels with `writing-mode:vertical-rl` and `rotate(180deg)`;
- tick positions based on `buildRulerTickMarks`.

- [ ] **Step 2: Run the render test and verify RED**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-rulers.spec.ts
```

Expected: module resolution fails because `canvas-rulers.tsx` does not exist.

- [ ] **Step 3: Move the ruler implementation**

Move and export:

```ts
export function Rulers(...)
export const RulerTicks = React.memo(function RulerTicks(...) { ... })
```

Keep local state, `dragGuideRef`, stage lookup, clamping, initial `move(e.nativeEvent)`, window listener registration/removal, guide commit on pointer-up, guide discard on pointer-cancel, preview formulas, classes, and tick JSX unchanged.

- [ ] **Step 4: Replace definitions in CanvasView with imports**

`CanvasView` continues to pass width, height, zoom, unit, DPI, create random guide IDs, round final positions, and dispatch `add-guide`.

- [ ] **Step 5: Add browser interaction coverage**

Create `tests/canvas-ruler-interactions.spec.ts`:

```ts
test("ruler pointer-up creates a guide and pointer-cancel discards the preview", async ({ page }) => {
  await page.goto("/editor")
  const stage = page.locator("[data-canvas-stage]")
  const horizontalRuler = page.locator('[class~="cursor-s-resize"]').first()
  await expect(stage).toBeVisible()
  await expect(horizontalRuler).toBeVisible()

  const rulerBox = await horizontalRuler.boundingBox()
  const stageBox = await stage.boundingBox()
  if (!rulerBox || !stageBox) throw new Error("Canvas ruler geometry is unavailable")

  await page.mouse.move(rulerBox.x + 80, rulerBox.y + 9)
  await page.mouse.down()
  await page.mouse.move(stageBox.x + 80, stageBox.y + 40)
  await page.mouse.up()
  await expect(page.locator('[title="Guide"]')).toHaveCount(1)

  await page.mouse.move(rulerBox.x + 120, rulerBox.y + 9)
  await page.mouse.down()
  await page.mouse.move(stageBox.x + 120, stageBox.y + 70)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })))
  await page.mouse.up()
  await expect(page.locator('[title="Guide"]')).toHaveCount(1)
})
```

If the browser reports a different mouse pointer ID, derive it from a temporary page-level pointerdown listener without changing production DOM.

- [ ] **Step 6: Verify and commit**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-rulers.spec.ts
npx playwright test tests/canvas-ruler-interactions.spec.ts
npm run typecheck
git add components/photoshop/canvas-rulers.tsx components/photoshop/canvas-view.tsx tests/canvas-rulers.spec.ts tests/canvas-ruler-interactions.spec.ts
git commit -m "refactor: extract canvas rulers"
```

## Task 4: Verify the Overlay and Ruler Slice

**Files:**
- Modify only if verification exposes a scoped regression.

- [ ] **Step 1: Run focused tests**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-smart-guides.spec.ts tests/canvas-selection-overlays.spec.ts tests/canvas-rulers.spec.ts tests/canvas-shape-helpers.spec.ts tests/canvas-transform-geometry.spec.ts tests/canvas-view-runtime.spec.ts
npx playwright test tests/canvas-ruler-interactions.spec.ts tests/canvas-tools.spec.ts tests/canvas-interaction-performance.spec.ts
```

- [ ] **Step 2: Run repository checks**

```powershell
npm run lint
npm run typecheck
npm run check:capabilities
npm run build
```

- [ ] **Step 3: Inspect boundaries and status**

```powershell
git diff 6a69cb5 --stat
rg -n "^export " components/photoshop/canvas-view.tsx
git status --short
```

Confirm `CanvasView` remains the sole public export in its file, React editor state did not move, and unrelated report deletions remain unstaged.

- [ ] **Step 4: Run the complete suite with stable worker count**

```powershell
npm run test:smoke -- --workers=2
```

Expected: all 847 tests plus the new tests pass.
