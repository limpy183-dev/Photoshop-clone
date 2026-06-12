# Canvas View Selection and Preview Helpers Plan

**Goal:** Remove the remaining file-level selection, alpha-bound, and preview-drawing helpers from `canvas-view.tsx` without changing active behavior.

**Architecture:** `canvas-selection-helpers.ts` owns selection clipping, remove masks, layer picking, cached alpha bounds, selection-mask application, and background selection delegation. `canvas-preview-drawing.ts` owns frame, artboard, and slice canvas drawing. `CanvasView` keeps interaction state and calls these modules.

## Task 1: Extract Selection Helpers

**Files:**
- Create: `components/photoshop/canvas-selection-helpers.ts`
- Create: `tests/canvas-selection-helpers.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

1. Add failing characterization tests for remove-mask coverage, rectangular and elliptical clipping, topmost visible layer picking, alpha threshold and cache invalidation, selection mask application, and background-mask delegation.
2. Move the active implementations and the alpha-bounds WeakMap into the focused module.
3. Keep the alpha-bounds cache on `maskAlphaEpoch`.
4. Delete the unused `_createSelectSubjectMask`, `_createSelectSkyMask`, and `_createSelectBackgroundMask` definitions; live selection tools continue to use the existing algorithmic helpers.
5. Run focused tests, typecheck, and ESLint.

## Task 2: Extract Preview Drawing

**Files:**
- Create: `components/photoshop/canvas-preview-drawing.ts`
- Create: `tests/canvas-preview-drawing.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

1. Add failing characterization tests with a recording 2D context.
2. Move frame, artboard, and slice drawing implementations without changing operation order, colors, line widths, dash patterns, or bounds.
3. Run focused tests, typecheck, and ESLint.

## Task 3: Verify the Slice

1. Run the new helper tests and focused canvas tool tests.
2. Run lint, typecheck, capability reconciliation, and production build.
3. Confirm `CanvasView` has no remaining file-level helper implementations except `textLayerPath`.
4. Run the complete smoke suite with two workers.
