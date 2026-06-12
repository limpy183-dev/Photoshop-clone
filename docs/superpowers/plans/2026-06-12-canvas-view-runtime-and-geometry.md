# Canvas View Runtime and Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the deterministic runtime, transform, and shape helpers from `canvas-view.tsx` without changing canvas rendering, event routing, React state ownership, or user-visible behavior.

**Architecture:** `CanvasView` remains the orchestration component. Three sibling modules will own exact copies of private helper implementations: runtime configuration and edit permissions, transform geometry, and shape/tool geometry. The modules expose internal exports for direct characterization tests, while `CanvasView` imports them through compatibility boundaries.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 16, Playwright 1.59.

---

## Task 1: Extract Runtime Configuration and Layer Permissions

**Files:**
- Create: `components/photoshop/canvas-view-runtime.ts`
- Create: `tests/canvas-view-runtime.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add a failing runtime characterization test**

Create `tests/canvas-view-runtime.spec.ts` importing:

```ts
import {
  canvasRuntimePreferencesFrom,
  clampZoom,
  getCustomShapeRuntimeId,
  getCustomShapeRuntimePreset,
  getEyedropperSampleSize,
  getFrameRuntimeOptions,
  getMoveRuntimeOptions,
  getPathRuntimeOptions,
  getShapeRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
  layerBlocksAllEdits,
} from "../components/photoshop/canvas-view-runtime"
```

Cover these current contracts:

- move, path, frame, and eyedropper globals retain their defaults;
- shape options retain existing lower and upper bounds;
- supported custom-shape IDs pass through and unsupported IDs fall back to `star5`;
- custom-shape presets return the same object identity or `null`;
- canvas preferences map only the current seven fields;
- zoom clamps to `0.05...32`;
- missing, locked, drawing-locked, move-locked, and group layers retain current permission results.

Install and remove a minimal `globalThis.window` in `beforeEach`/`afterEach` so the Node project can call the runtime readers.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-view-runtime.spec.ts
```

Expected: failure because `components/photoshop/canvas-view-runtime.ts` does not exist.

- [ ] **Step 3: Create the runtime module from the existing implementation**

Move, without semantic edits:

- `CanvasRuntimePreferences`;
- `MoveToolRuntimeOptions`;
- `ShapeToolRuntimeOptions`;
- `PathToolRuntimeOptions`;
- `FrameToolRuntimeOptions`;
- `EyedropperSampleSize`;
- the corresponding `Window` augmentation;
- `clampZoom`;
- all runtime option readers;
- canvas preference readers/conversion;
- layer edit-permission predicates.

Use type-only imports from `types.ts` and value imports from `preferences-engine.ts`. Keep current defaults, coercion behavior, object identity, and type guards unchanged.

- [ ] **Step 4: Replace the moved definitions in CanvasView with imports**

Import only the functions and types still consumed by `canvas-view.tsx`. Do not move `clamp01`, React state, preference event listeners, or zoom scheduling.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-view-runtime.spec.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit the runtime extraction**

```powershell
git add components/photoshop/canvas-view-runtime.ts components/photoshop/canvas-view.tsx tests/canvas-view-runtime.spec.ts
git commit -m "refactor: extract canvas runtime helpers"
```

## Task 2: Extract Transform Geometry

**Files:**
- Create: `components/photoshop/canvas-transform-geometry.ts`
- Create: `tests/canvas-transform-geometry.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add a failing transform characterization test**

Create `tests/canvas-transform-geometry.spec.ts` importing the planned transform module.

Cover:

- `finiteOr` and skew clamping;
- all nine transform reference-point origins;
- translation and non-uniform scaling output;
- rotation and skew output with numeric tolerance;
- transformed bounds and perspective corner offsets;
- handle positions and the 24-pixel rotation handle;
- strict eight-pixel handle hit boundaries;
- polygon hit testing for inside, outside, and edge-adjacent points;
- `applyTransformContext` call order and interpolation settings with a minimal recording context stub.

Use a helper that creates a complete `TransformDragState` with overridable fields.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-transform-geometry.spec.ts
```

Expected: failure because `components/photoshop/canvas-transform-geometry.ts` does not exist.

- [ ] **Step 3: Create the transform module from the existing implementation**

Move, without semantic edits:

- `TransformHandleId`;
- `TransformDragState`;
- `TransformReferencePoint`;
- `TransformInterpolation`;
- `TransformOptionsEvent`;
- `finiteOr`;
- `clampTransformSkew`;
- `transformOrigin`;
- `applyTransformContext`;
- `transformPoint`;
- `transformedBounds`;
- `transformCorners`;
- `transformHandles`;
- `pickTransformHandle`;
- `pointInTransformBox`.

Keep the perspective representation and canvas context mutation order identical.

- [ ] **Step 4: Replace the moved definitions in CanvasView with imports**

Import the helper functions and types at the existing call sites. Do not change transform state initialization, pointer handling, dispatch order, or transform commit behavior.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-transform-geometry.spec.ts
npx playwright test --config=playwright.node.config.ts tests/canvas-view-runtime.spec.ts
npm run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit the transform extraction**

```powershell
git add components/photoshop/canvas-transform-geometry.ts components/photoshop/canvas-view.tsx tests/canvas-transform-geometry.spec.ts
git commit -m "refactor: extract canvas transform geometry"
```

## Task 3: Extract Tool Labels and Shape Geometry

**Files:**
- Create: `components/photoshop/canvas-shape-helpers.ts`
- Create: `tests/canvas-shape-helpers.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add a failing shape characterization test**

Create `tests/canvas-shape-helpers.spec.ts` importing the planned shape module.

Cover:

- representative known and unknown tool labels;
- cursor selection for hand, zoom, text, move, vector, selection, brush, and default tools;
- view rotation normalization for negative and over-360 values;
- ellipse, polygon, star, triangle, custom-shape, rectangle, and rounded-rectangle construction;
- stroke creation and per-corner radius fallback;
- fitted custom presets retain current fill, stroke, and rotation precedence;
- shape bounds and five direct-selection handles;
- center translation and corner resizing;
- width and height crossing normalize to positive dimensions;
- dimensions retain the current minimum of one pixel;
- shape resize delegates through `resizeShapeWithCornerRadii`.

Install a minimal `globalThis.window` for shape option globals and remove it after each test.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-shape-helpers.spec.ts
```

Expected: failure because `components/photoshop/canvas-shape-helpers.ts` does not exist.

- [ ] **Step 3: Create the shape module from the existing implementation**

Move, without semantic edits:

- `DirectShapeHandleId`;
- `labelForTool`;
- `cursorForTool`;
- `shapePropsForTool`;
- `normalizeViewRotation`;
- `shapeRect`;
- `shapeHandles`;
- `resizePlainRect`;
- `resizeShapeRect`.

Import runtime readers from `canvas-view-runtime.ts` and rounded-rectangle behavior from `vector-path-operations.ts`. Preserve every tool string, default label, cursor string, corner-radius fallback, and custom-preset rotation expression.

- [ ] **Step 4: Replace the moved definitions in CanvasView with imports**

Remove only the extracted definitions and imports that become unused. Keep drawing preview helpers, selection masking, and direct-selection event logic in `canvas-view.tsx`.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-shape-helpers.spec.ts
npx playwright test --config=playwright.node.config.ts tests/canvas-transform-geometry.spec.ts tests/canvas-view-runtime.spec.ts
npm run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit the shape extraction**

```powershell
git add components/photoshop/canvas-shape-helpers.ts components/photoshop/canvas-view.tsx tests/canvas-shape-helpers.spec.ts
git commit -m "refactor: extract canvas shape helpers"
```

## Task 4: Verify the First Canvas-View Slice

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run focused canvas browser tests**

Run:

```powershell
npx playwright test tests/canvas-tools.spec.ts tests/canvas-interaction-performance.spec.ts
```

- [ ] **Step 2: Run repository checks**

Run:

```powershell
npm run lint
npm run typecheck
npm run check:capabilities
npm run build
```

- [ ] **Step 3: Inspect the resulting diff and module boundaries**

Run:

```powershell
git diff 3a7ba42 --stat
git diff 3a7ba42 -- components/photoshop/canvas-view.tsx components/photoshop/canvas-view-runtime.ts components/photoshop/canvas-transform-geometry.ts components/photoshop/canvas-shape-helpers.ts
git status --short
```

Confirm:

- no React state, refs, effects, pointer handlers, or JSX moved;
- helper bodies match their pre-extraction implementations;
- no unrelated working-tree changes are staged;
- `CanvasView` remains the sole public component export.

- [ ] **Step 4: Run the full smoke suite**

Run:

```powershell
npm run test:smoke
```

Expected: the complete suite passes.

- [ ] **Step 5: Record the checkpoint**

If verification required no source fixes, no extra commit is needed. If a behavior-preserving correction was required, commit only its scoped files with:

```powershell
git add <scoped-files>
git commit -m "test: verify canvas helper extraction"
```

Update the broader refactor checklist before beginning overlays and rulers.
