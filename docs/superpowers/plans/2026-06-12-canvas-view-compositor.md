# Canvas View Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract compositor fingerprints, cache epochs, smart-filter rendering, layer-style preparation, WebGL CPU fallbacks, and adjustment-layer rendering from `canvas-view.tsx` without changing cache identity or pixel behavior.

**Architecture:** `canvas-compositor-cache.ts` owns stable canvas IDs, parameter/path fingerprints, style/smart-filter keys, and the shared mask-alpha epoch used by render planning. `canvas-compositor.ts` owns offscreen allocation, result caches, layer preparation, CPU/WebGL fallback callbacks, smart-filter blending, mask conversion, and adjustment-layer application. `CanvasView` remains responsible for scheduling and document traversal.

**Tech Stack:** TypeScript 5.7, Canvas 2D, WebGL fallback adapters, Playwright 1.59.

---

## Task 1: Extract Shared Compositor Identities and Cache Keys

**Files:**
- Create: `components/photoshop/canvas-compositor-cache.ts`
- Create: `tests/canvas-compositor-cache.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add the failing cache contract test**

Import:

```ts
import {
  adjustmentParamsFingerprint,
  advancedBlendingFingerprint,
  canvasIdFor,
  invalidateMaskAlphaCache,
  layerStyleCacheKey,
  maskAlphaEpoch,
  offsetPath,
  pathFingerprint,
  smartFilterCacheKey,
} from "../components/photoshop/canvas-compositor-cache"
```

Verify:

- `canvasIdFor` returns a stable ID for the same canvas and a different ID for another canvas;
- object adjustment params use stable JSON output while scalar/null params retain current string coercion;
- path fingerprints are JSON or empty strings;
- `offsetPath` translates anchors, both controls, and nested subpaths without mutating the source;
- advanced-blending fingerprints match normalized JSON;
- disabled smart filters are omitted;
- smart-filter keys include mask identity and change after `invalidateMaskAlphaCache`;
- layer-style keys include only enabled effects, sort effect fields, and cache by style identity;
- `maskAlphaEpoch` increments exactly once per invalidation.

- [ ] **Step 2: Run and verify RED**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-compositor-cache.spec.ts
```

Expected: missing `canvas-compositor-cache.ts`.

- [ ] **Step 3: Move exact cache/fingerprint implementations**

Move:

```ts
canvasIdFor
adjustmentParamsFingerprint
pathFingerprint
advancedBlendingFingerprint
offsetPath
smartFilterCacheKey
styleEffectFp
layerStyleCacheKey
maskAlphaEpoch
invalidateMaskAlphaCache
```

Replace direct `_canvasIdMap.get(...) ?? _assignCanvasId(...)` call sites with `canvasIdFor(...)`. Preserve initial ID `1`, WeakMap identity, JSON ordering, style prefixes, enabled-filter ordering, and epoch semantics.

- [ ] **Step 4: Keep alpha-bounds cache on the shared epoch**

Import the live `maskAlphaEpoch` binding in `canvas-view.tsx` and replace its two remaining `_maskAlphaEpoch` reads. Do not move `alphaBounds` yet.

- [ ] **Step 5: Verify and commit**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-compositor-cache.spec.ts
npm run typecheck
git add components/photoshop/canvas-compositor-cache.ts components/photoshop/canvas-view.tsx tests/canvas-compositor-cache.spec.ts
git commit -m "refactor: extract canvas compositor cache keys"
```

## Task 2: Extract the Compositor Engine

**Files:**
- Create: `components/photoshop/canvas-compositor.ts`
- Create: `tests/canvas-compositor.spec.ts`
- Modify: `components/photoshop/canvas-view.tsx`

- [ ] **Step 1: Add the failing compositor contract test**

Import:

```ts
import {
  adjustmentParamsKey,
  applyAdjustmentLayer,
  applySmartFilters,
  drawLayer,
  makeOpaqueMask,
  paramsWithDefaults,
  readSmartFilterMask,
  renderLayerSourceForCompositor,
} from "../components/photoshop/canvas-compositor"
```

Use `installFixtureDom()` and controlled canvas stubs. Verify:

- `paramsWithDefaults(getFilter("gaussian-blur"), ...)` clamps numeric input;
- checkbox/select/color/default coercion uses existing filter metadata;
- `adjustmentParamsKey` returns empty for non-adjustment layers and stable type/JSON for adjustment layers;
- `applySmartFilters` returns the original canvas when no filters are enabled and returns the cached result for an unchanged enabled-filter list;
- `makeOpaqueMask` preserves requested dimensions;
- `readSmartFilterMask` returns `null` for zero dimensions and reuses the cached `ImageData` until invalidation;
- a no-op or zero-opacity adjustment leaves the destination context untouched;
- `renderLayerSourceForCompositor` without styles/masks returns the source, current fill opacity, `styleRendered: false`, and an opaque knockout mask.

- [ ] **Step 2: Run and verify RED**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-compositor.spec.ts
```

Expected: missing `canvas-compositor.ts`.

- [ ] **Step 3: Move the compositor implementation**

Move exact implementations and supporting private caches/types from `acquireCanvas` through `applyAdjustmentLayer`, excluding selection helpers:

```ts
renderLayerSourceForCompositor
makeOpaqueMask
restoreKnockoutBackdrop
drawLayer
drawLayerForCompositorContext
applyAdjustmentForCompositorContext
paramsWithDefaults
imageDataToCanvas
readSmartFilterMask
smartFilterResult
applySmartFilters
getMaskAsAlphaCanvas
adjustmentParamsKey
applyAdjustmentLayer
```

Also move the pooled-canvas wrappers and private smart-filter, style, mask, and adjustment result WeakMaps. Import shared identities/keys/epoch from `canvas-compositor-cache.ts`.

- [ ] **Step 4: Replace definitions in CanvasView with imports**

Import only:

```ts
applyAdjustmentForCompositorContext
applyAdjustmentLayer
drawLayer
drawLayerForCompositorContext
renderLayerSourceForCompositor
```

Keep document traversal, tile planning, render scheduling, prefix fingerprints, and WebGL orchestration in `CanvasView`.

- [ ] **Step 5: Verify and commit**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-compositor.spec.ts tests/canvas-compositor-cache.spec.ts
npm run typecheck
git add components/photoshop/canvas-compositor.ts components/photoshop/canvas-view.tsx tests/canvas-compositor.spec.ts
git commit -m "refactor: extract canvas compositor engine"
```

## Task 3: Verify the Compositor Slice

**Files:**
- Modify only for scoped verification corrections.

- [ ] **Step 1: Run focused compositor and canvas tests**

```powershell
npx playwright test --config=playwright.node.config.ts tests/canvas-compositor.spec.ts tests/canvas-compositor-cache.spec.ts tests/canvas-smart-guides.spec.ts tests/canvas-selection-overlays.spec.ts tests/canvas-rulers.spec.ts
npx playwright test tests/canvas-ruler-interactions.spec.ts tests/canvas-tools.spec.ts tests/canvas-interaction-performance.spec.ts tests/adjustment-layer-workflow.spec.ts
```

- [ ] **Step 2: Run repository checks**

```powershell
npm run lint
npm run typecheck
npm run check:capabilities
npm run build
```

- [ ] **Step 3: Inspect the boundary**

```powershell
rg -n "^export " components/photoshop/canvas-view.tsx
rg -n "function (renderLayerSourceForCompositor|applySmartFilters|applyAdjustmentLayer|drawLayer)" components/photoshop/canvas-view.tsx
git status --short
```

Confirm `CanvasView` owns no compositor cache and unrelated report deletions remain unstaged.

- [ ] **Step 4: Run the complete suite**

```powershell
npm run test:smoke -- --workers=2
```

Expected: all 858 existing tests plus the new compositor tests pass.
