# Canvas View Brush Dynamics Extraction Plan

**Goal:** Move the pure brush dynamics calculations out of `canvas-view.tsx` while preserving current dab color, size, angle, roundness, opacity multiplier, flow multiplier, seeded tip simulation, and random jitter ordering.

**Files:**
- Create: `components/photoshop/canvas-brush-dynamics.ts`
- Create: `tests/canvas-brush-dynamics.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

## Steps

1. Add characterization tests for HSL conversion, color dynamics jitter, brush input controls, shape dynamics, transfer dynamics, and tip simulation seed usage.
2. Extract the current helper logic into a dedicated module with explicit `brush`, `input`, color, and injectable random parameters.
3. Replace `CanvasView` helper calls with the extracted functions, keeping canvas drawing and stroke lifecycle local.
4. Run focused helper tests, TypeScript, ESLint, focused canvas workflow tests, then full verification.
