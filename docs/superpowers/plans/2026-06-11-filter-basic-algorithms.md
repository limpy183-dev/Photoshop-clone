# Basic Filter Algorithms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the foundational blur, convolution, sharpen, stylize, pixelate, noise, and brightness/contrast algorithms from `filters/registry.ts` without changing filter registry metadata or pixel behavior.

**Architecture:** Add `components/photoshop/filters/basic-algorithms.ts` as the canonical implementation module. `registry.ts` imports these functions for both registry definitions and advanced algorithms that reuse blur, convolution, and edge detection. The public `filters.ts` facade remains unchanged.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59 node project, browser `ImageData`.

---

### Task 1: Characterize Basic Algorithm Equivalence

**Files:**
- Modify: `tests/filter-module-boundaries.spec.ts`
- Test: `components/photoshop/filters.ts`

- [ ] **Step 1: Add imports for the planned module**

Add:

```typescript
import {
  boxBlur,
  brightnessContrast,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "../components/photoshop/filters/basic-algorithms"
```

- [ ] **Step 2: Add a deterministic fixture helper**

Add:

```typescript
function fixture3x3() {
  return new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255, 70, 80, 90, 255, 130, 120, 100, 255,
    35, 55, 85, 255, 125, 135, 145, 255, 220, 210, 180, 255,
    20, 90, 60, 255, 155, 80, 45, 255, 245, 245, 230, 255,
  ]), 3, 3)
}

function expectSamePixels(actual: ImageData, expected: ImageData) {
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  expect(Array.from(actual.data)).toEqual(Array.from(expected.data))
}
```

- [ ] **Step 3: Add registry-equivalence tests**

Add:

```typescript
test("basic algorithm module matches registry filter output", () => {
  const src = fixture3x3()
  const cases: Array<{
    id: string
    params: Record<string, number | string | boolean>
    direct: () => ImageData
  }> = [
    { id: "gaussian-blur", params: { radius: 3 }, direct: () => gaussianBlur(src, 3) },
    { id: "box-blur", params: { radius: 2 }, direct: () => boxBlur(src, 2) },
    { id: "motion-blur", params: { distance: 2, angle: 30 }, direct: () => motionBlur(src, 2, 30) },
    { id: "sharpen", params: { amount: 75 }, direct: () => sharpen(src, 75) },
    { id: "unsharp-mask", params: { amount: 80, radius: 2 }, direct: () => unsharpMask(src, 80, 2) },
    { id: "find-edges", params: {}, direct: () => findEdges(src) },
    { id: "emboss", params: { amount: 60 }, direct: () => emboss(src, 60) },
    { id: "solarize", params: { threshold: 120 }, direct: () => solarize(src, 120) },
    { id: "pixelate", params: { size: 2 }, direct: () => pixelate(src, 2) },
    { id: "noise", params: { amount: 0, mono: true, distribution: "uniform" }, direct: () => noise(src, 0, true, false) },
    {
      id: "brightness-contrast",
      params: { brightness: 20, contrast: -15, useLegacy: false },
      direct: () => brightnessContrast(src, 20, -15, false),
    },
  ]

  for (const item of cases) {
    const filter = facadeGetFilter(item.id)
    expect(filter, item.id).toBeTruthy()
    expectSamePixels(item.direct(), filter!.apply(src, item.params))
  }
})
```

- [ ] **Step 4: Run the test and verify it fails on the missing module**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: FAIL during module resolution for `filters/basic-algorithms`.

- [ ] **Step 5: Commit the red test**

```powershell
git add tests/filter-module-boundaries.spec.ts
git commit -m "test: characterize basic filter algorithms"
```

### Task 2: Extract Basic Algorithms

**Files:**
- Create: `components/photoshop/filters/basic-algorithms.ts`
- Modify: `components/photoshop/filters/registry.ts`
- Test: `tests/filter-module-boundaries.spec.ts`

- [ ] **Step 1: Create the new implementation module**

Move these functions from `registry.ts` to `basic-algorithms.ts`, preserving their bodies exactly and adding `export`:

```typescript
export function boxBlur(src: ImageData, radius: number): ImageData
export function gaussianBlur(src: ImageData, radius: number): ImageData
export function motionBlur(src: ImageData, distance: number, angleDeg: number): ImageData
export function convolve(src: ImageData, kernel: number[], divisor = 1): ImageData
export function sharpen(src: ImageData, amount: number): ImageData
export function unsharpMask(src: ImageData, amount: number, radius: number): ImageData
export function findEdges(src: ImageData): ImageData
export function emboss(src: ImageData, amount: number): ImageData
export function solarize(src: ImageData, threshold: number): ImageData
export function pixelate(src: ImageData, cellSize: number): ImageData
export function noise(src: ImageData, amount: number, mono: boolean, gaussian = false): ImageData
export function brightnessContrast(src: ImageData, brightness: number, contrast: number, useLegacy = false): ImageData
```

Define only the two private helpers required by those moved bodies:

```typescript
function clone(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
```

Do not alter loops, rounding, random-number calls, comments, or output construction.

- [ ] **Step 2: Import the extracted functions into the registry**

Add to `registry.ts`:

```typescript
import {
  boxBlur,
  brightnessContrast,
  convolve,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "./basic-algorithms"
```

Remove the original function declarations from `registry.ts`. Keep its local `clone`, `clamp8`, and `clamp01` helpers because later algorithms still use them.

- [ ] **Step 3: Verify the new boundary test is green**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: all module-boundary tests pass.

- [ ] **Step 4: Run deterministic filter coverage**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts tests/photo-workflow-depth.spec.ts
```

Expected: all tests pass with unchanged pixel arrays.

- [ ] **Step 5: Run static validation**

Run:

```powershell
npm run lint
npm run typecheck
```

Expected: both commands exit 0 with no new warnings.

- [ ] **Step 6: Commit the extraction**

```powershell
git add components/photoshop/filters/basic-algorithms.ts components/photoshop/filters/registry.ts
git commit -m "refactor: extract basic filter algorithms"
```

### Task 3: Verify the Algorithm Slice

**Files:**
- Modify only files required to correct regressions introduced by Task 2.

- [ ] **Step 1: Run capability reconciliation**

Run:

```powershell
npm run check:capabilities
```

Expected: capability records reconcile successfully.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: build exits 0; the known circular runtime chunk warning may remain unchanged.

- [ ] **Step 3: Run all focused tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts tests/photo-workflow-depth.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 4: Inspect module size and diff**

Run:

```powershell
git diff --check HEAD~2..HEAD
Get-ChildItem components/photoshop/filters/*.ts | ForEach-Object {
  "{0,6} {1}" -f ((Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines), $_.Name
}
git status --short
```

Expected: `registry.ts` is reduced by the extracted algorithm block, no whitespace errors exist, and the three pre-existing working-tree changes remain untouched.
