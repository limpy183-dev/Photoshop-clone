# Canvas View Eraser Helper Extraction Plan

**Goal:** Move selective/background eraser helper math out of `canvas-view.tsx` while preserving color-distance weighting, 4-neighbor connected-mask behavior, and local luminance-gradient edge detection.

**Files:**
- Create: `components/photoshop/canvas-eraser-helpers.ts`
- Create: `tests/canvas-eraser-helpers.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

## Steps

1. Add focused tests for alpha-weighted color distance, contiguous mask flood fill, empty-start handling, and clamped local patch gradient sampling.
2. Extract `colorDistance`, `connectedEraserMask`, and `localPatchGradient` into a dedicated helper module.
3. Replace the nested `CanvasView` helpers with imported functions.
4. Run focused helper tests, TypeScript, ESLint, and focused canvas eraser/tool tests.
