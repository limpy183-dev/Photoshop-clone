# Filter Facade and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first behavior-preserving refactor slice by converting `components/photoshop/filters.ts` into a stable compatibility facade and extracting filter contracts and compositing into focused modules.

**Architecture:** The existing filter implementation moves unchanged to `components/photoshop/filters/registry.ts`. The original `filters.ts` path remains the public facade. Public types move to `filters/contracts.ts`, compositing moves to `filters/composite.ts`, and `registry.ts` re-exports them so both the original facade and the new internal modules expose one canonical implementation.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59 node project, Next.js 16, browser `ImageData`.

---

### Task 1: Characterize the Filter Public Surface

**Files:**
- Create: `tests/filter-module-boundaries.spec.ts`
- Test: `components/photoshop/filters.ts`

- [ ] **Step 1: Write the failing internal-boundary test**

Create `tests/filter-module-boundaries.spec.ts`:

```typescript
import { expect, test } from "@playwright/test"

import {
  FILTERS as facadeFilters,
  compositeFilterImageData as facadeComposite,
  getFilter as facadeGetFilter,
} from "../components/photoshop/filters"
import {
  FILTERS as registryFilters,
  getFilter as registryGetFilter,
} from "../components/photoshop/filters/registry"
import {
  compositeFilterImageData as moduleComposite,
} from "../components/photoshop/filters/composite"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

test("filter facade and registry expose the same objects", () => {
  expect(facadeFilters).toBe(registryFilters)
  expect(facadeGetFilter).toBe(registryGetFilter)
  expect(Object.keys(facadeFilters)).toEqual(Object.keys(registryFilters))
})

test("filter facade and composite module share the canonical implementation", () => {
  expect(facadeComposite).toBe(moduleComposite)

  const before = new ImageData(new Uint8ClampedArray([100, 120, 140, 255]), 1, 1)
  const after = new ImageData(new Uint8ClampedArray([200, 40, 80, 255]), 1, 1)
  const result = moduleComposite(before, after, {
    opacity: 0.5,
    blendMode: "normal",
  })

  expect(Array.from(result.data)).toEqual([150, 80, 110, 255])
})
```

- [ ] **Step 2: Run the test and verify it fails because internal modules do not exist**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: FAIL during module resolution for `components/photoshop/filters/registry` or `components/photoshop/filters/composite`.

- [ ] **Step 3: Record the existing deterministic filter baseline**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts
```

Expected: all existing filter tests pass before production files move.

- [ ] **Step 4: Commit the failing characterization test**

```powershell
git add tests/filter-module-boundaries.spec.ts
git commit -m "test: characterize filter module boundaries"
```

### Task 2: Introduce the Stable Filter Facade

**Files:**
- Create by move: `components/photoshop/filters/registry.ts`
- Create: `components/photoshop/filters/composite.ts`
- Replace: `components/photoshop/filters.ts`
- Test: `tests/filter-module-boundaries.spec.ts`

- [ ] **Step 1: Move the implementation without editing it**

Run:

```powershell
New-Item -ItemType Directory -Force components/photoshop/filters | Out-Null
git mv components/photoshop/filters.ts components/photoshop/filters/registry.ts
```

- [ ] **Step 2: Correct only the moved file's relative imports**

Change the imports at the top of `components/photoshop/filters/registry.ts` from:

```typescript
import type { BlendMode } from "./types"
import { hexToRgb as hexToRgbFilter } from "./color-utils"
import { applyChannelMixerToImageData, type ChannelMixerParams } from "./color-channel-ops"
import { parseFieldBlurPins, parsePathBlurPoints } from "./blur-gallery-controls"
```

to:

```typescript
import type { BlendMode } from "../types"
import { hexToRgb as hexToRgbFilter } from "../color-utils"
import { applyChannelMixerToImageData, type ChannelMixerParams } from "../color-channel-ops"
import { parseFieldBlurPins, parsePathBlurPoints } from "../blur-gallery-controls"
```

- [ ] **Step 3: Create the original-path compatibility facade**

Create `components/photoshop/filters.ts`:

```typescript
/**
 * Stable public filter API.
 *
 * Implementations live under ./filters so existing consumers can keep using
 * the original import path while the subsystem is decomposed.
 */
export * from "./filters/registry"
```

- [ ] **Step 4: Create a transitional compositing re-export**

Create `components/photoshop/filters/composite.ts`:

```typescript
export {
  compositeFilterImageData,
  type FilterCompositeOptions,
} from "./registry"
```

This keeps TypeScript and the boundary test green until Task 4 moves the implementation into this module.

- [ ] **Step 5: Run static validation**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Run the existing deterministic filter tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts
```

Expected: all tests pass with unchanged pixel outputs and registry behavior.

- [ ] **Step 7: Commit the facade move**

```powershell
git add components/photoshop/filters.ts components/photoshop/filters/composite.ts components/photoshop/filters/registry.ts
git commit -m "refactor: add stable filter facade"
```

### Task 3: Extract Filter Contracts

**Files:**
- Create: `components/photoshop/filters/contracts.ts`
- Modify: `components/photoshop/filters/registry.ts`
- Test: `tests/filter-module-boundaries.spec.ts`

- [ ] **Step 1: Create the canonical contracts module**

Create `components/photoshop/filters/contracts.ts`:

```typescript
export type FilterParam =
  | { type: "slider"; key: string; label: string; min: number; max: number; step?: number; default: number; suffix?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; default: string }
  | { type: "checkbox"; key: string; label: string; default: boolean }
  | { type: "text"; key: string; label: string; default: string; multiline?: boolean; placeholder?: string; accept?: string }

export interface FilterDef {
  id: string
  name: string
  category: string
  params: FilterParam[]
  apply: (src: ImageData, params: Record<string, number | string | boolean>, context?: FilterContext) => ImageData
}

export interface FilterContext {
  matchColorSource?: ImageData | null
  displacementMap?: ImageData | null
  applyImageSource?: ImageData | null
  calcSourceA?: ImageData | null
  calcSourceB?: ImageData | null
  selectionMask?: Uint8Array | null
  selectionMode?: "image" | "selection-only" | "selection-source"
  lensBlurDepthSource?: ImageData | null
  lightingBumpSource?: ImageData | null
}
```

- [ ] **Step 2: Make the registry consume and re-export the contracts**

In `components/photoshop/filters/registry.ts`, remove the local `FilterParam`, `FilterDef`, and `FilterContext` declarations. Add:

```typescript
import type { FilterContext, FilterDef } from "./contracts"

export type {
  FilterContext,
  FilterDef,
  FilterParam,
} from "./contracts"
```

Keep the runtime registry and every filter definition unchanged.

- [ ] **Step 3: Run static and focused verification**

Run:

```powershell
npm run typecheck
npx playwright test --config=playwright.node.config.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts
```

Expected: typecheck and every focused test pass.

- [ ] **Step 4: Commit the contracts extraction**

```powershell
git add components/photoshop/filters/contracts.ts components/photoshop/filters/registry.ts
git commit -m "refactor: extract filter contracts"
```

### Task 4: Extract Filter Compositing

**Files:**
- Create: `components/photoshop/filters/composite.ts`
- Modify: `components/photoshop/filters/registry.ts`
- Test: `tests/filter-module-boundaries.spec.ts`
- Test: `tests/filter-fidelity-golden.spec.ts`
- Test: `tests/filters-algorithms.spec.ts`

- [ ] **Step 1: Create the compositing module with the existing implementation**

Create `components/photoshop/filters/composite.ts` by moving, without semantic edits, the `FilterCompositeOptions`, `blendFilterChannel`, `filterMaskAlpha`, and `compositeFilterImageData` definitions from `registry.ts`.

The module imports `BlendMode` from `../types` and contains its own unchanged `clamp8` and `clamp01` helpers:

```typescript
import type { BlendMode } from "../types"

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export interface FilterCompositeOptions {
  opacity?: number
  blendMode?: BlendMode
  maskData?: Uint8ClampedArray | null
  maskWidth?: number
  maskHeight?: number
  maskEnabled?: boolean
  maskDensity?: number
}

function blendFilterChannel(src: number, dest: number, mode: BlendMode) {
  switch (mode) {
    case "multiply":
      return (src * dest) / 255
    case "screen":
      return 255 - ((255 - src) * (255 - dest)) / 255
    case "overlay":
      return dest < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "hard-light":
      return src < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "soft-light": {
      const s = src / 255
      const d = dest / 255
      const value = s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (Math.sqrt(d) - d)
      return value * 255
    }
    case "darken":
      return Math.min(src, dest)
    case "lighten":
      return Math.max(src, dest)
    case "difference":
      return Math.abs(dest - src)
    default:
      return src
  }
}

function filterMaskAlpha(options: FilterCompositeOptions, x: number, y: number, width: number, height: number) {
  if (options.maskEnabled === false || !options.maskData || !options.maskWidth || !options.maskHeight) return 1
  const mx = Math.max(0, Math.min(options.maskWidth - 1, Math.floor((x / width) * options.maskWidth)))
  const my = Math.max(0, Math.min(options.maskHeight - 1, Math.floor((y / height) * options.maskHeight)))
  const pixelCount = options.maskWidth * options.maskHeight
  if (options.maskData.length >= pixelCount * 4) {
    const i = (my * options.maskWidth + mx) * 4
    const luminance = (options.maskData[i] + options.maskData[i + 1] + options.maskData[i + 2]) / 765
    const raw = luminance * (options.maskData[i + 3] / 255)
    const density = clamp01(options.maskDensity ?? 1)
    return 1 - density + raw * density
  }
  const raw = options.maskData[my * options.maskWidth + mx] / 255
  const density = clamp01(options.maskDensity ?? 1)
  return 1 - density + raw * density
}

export function compositeFilterImageData(
  before: ImageData,
  after: ImageData,
  options: FilterCompositeOptions = {},
): ImageData {
  const width = Math.min(before.width, after.width)
  const height = Math.min(before.height, after.height)
  const out = new Uint8ClampedArray(before.data)
  const opacity = clamp01(options.opacity ?? 1)
  const blendMode = options.blendMode ?? "normal"

  if (opacity <= 0) return new ImageData(out, before.width, before.height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * before.width + x) * 4
      const si = (y * after.width + x) * 4
      const maskAlpha = filterMaskAlpha(options, x, y, width, height)
      const srcAlpha = (after.data[si + 3] / 255) * opacity * maskAlpha
      if (srcAlpha <= 0) continue

      const destAlpha = before.data[i + 3] / 255
      const outAlpha = srcAlpha + destAlpha * (1 - srcAlpha)
      if (outAlpha <= 0) {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
        continue
      }

      for (let c = 0; c < 3; c++) {
        const src = after.data[si + c]
        const dest = before.data[i + c]
        const blended = blendFilterChannel(src, dest, blendMode)
        out[i + c] = clamp8(Math.round((blended * srcAlpha + dest * destAlpha * (1 - srcAlpha)) / outAlpha))
      }
      out[i + 3] = clamp8(Math.round(outAlpha * 255))
    }
  }

  return new ImageData(out, before.width, before.height)
}
```

- [ ] **Step 2: Re-export compositing from the registry**

In `components/photoshop/filters/registry.ts`, remove the moved compositing declarations and add:

```typescript
export {
  compositeFilterImageData,
  type FilterCompositeOptions,
} from "./composite"
```

Remove the now-unused `BlendMode` import from `registry.ts`. Keep its local `clamp8` and `clamp01` helpers because filter algorithms still use them.

- [ ] **Step 3: Run the new boundary test**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: both tests pass, proving facade and internal modules share object and function identity.

- [ ] **Step 4: Run all focused filter tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts
```

Expected: all tests pass with unchanged pixel goldens.

- [ ] **Step 5: Commit the compositing extraction**

```powershell
git add components/photoshop/filters/composite.ts components/photoshop/filters/registry.ts tests/filter-module-boundaries.spec.ts
git commit -m "refactor: extract filter compositing"
```

### Task 5: Verify the First Refactor Slice

**Files:**
- Modify only files required to correct regressions introduced by Tasks 1-4.

- [ ] **Step 1: Run static validation**

Run:

```powershell
npm run lint
npm run typecheck
```

Expected: both commands exit 0 without new warnings.

- [ ] **Step 2: Run capability reconciliation**

Run:

```powershell
npm run check:capabilities
```

Expected: capability records reconcile successfully.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js production build exits 0.

- [ ] **Step 4: Run focused filter verification**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts tests/photo-workflow-depth.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Inspect the final slice**

Run:

```powershell
git diff --check HEAD~4..HEAD
git status --short
git log -5 --oneline
```

Expected: no whitespace errors; only filter-refactor files and the plan/test commits are new. The pre-existing deletions and `next-env.d.ts` modification remain untouched.

- [ ] **Step 6: Record the next plan boundary**

The next implementation plan must split `components/photoshop/filters/registry.ts` by algorithm family while keeping `components/photoshop/filters.ts`, `contracts.ts`, and `composite.ts` unchanged as compatibility boundaries.
