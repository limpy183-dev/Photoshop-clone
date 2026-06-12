# Canvas View Filter Overlay Extraction Plan

**Goal:** Move Blur Gallery and Lighting Effects overlay canvas rendering out of `canvas-view.tsx` while preserving all drawing order, geometry, colors, zoom scaling, stale-state clearing, and control-state behavior.

**Files:**
- Create: `components/photoshop/canvas-filter-overlays.ts`
- Create: `tests/canvas-filter-overlays.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

## Steps

1. Add failing tests for stale-state clearing, selected field-blur pin rendering, iris/tilt/path/spin helpers through the shared renderer surface where practical, and Lighting Effects light handles/labels.
2. Move `drawBlurGalleryOverlay`, `drawLightingEffectsOverlay`, and their private drawing primitives to the new module as explicit canvas functions.
3. Replace the nested `CanvasView` implementations with thin wrappers that pass `overlayRef.current`, active document identity/dimensions, `visualZoomRef.current`, and overlay state.
4. Run focused tests, TypeScript, ESLint, and focused browser canvas workflow tests.
