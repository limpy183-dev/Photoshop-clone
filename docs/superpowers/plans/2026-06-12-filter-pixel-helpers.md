# Filter Pixel Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one canonical module for filter cloning, clamping, luminance, parameter parsing, and RGB/HSL conversion while preserving every existing call site and numerical result.

**Architecture:** Add `components/photoshop/filters/pixel-helpers.ts`. `registry.ts` imports the helpers with aliases matching its existing local names, and `basic-algorithms.ts` imports the clone and clamp helpers instead of carrying duplicates. This creates a dependency-free foundation for later adjustment and distortion extraction.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59 node project, browser `ImageData`.

---

### Task 1: Characterize Pixel Helpers

**Files:**
- Modify: `tests/filter-module-boundaries.spec.ts`

- [ ] **Step 1: Import the planned helpers**

```typescript
import {
  clamp01,
  clamp8,
  cloneImageData,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
  parseNumber,
  rgbToHsl,
} from "../components/photoshop/filters/pixel-helpers"
```

- [ ] **Step 2: Add exact behavior tests**

```typescript
test("pixel helpers preserve the registry's numeric behavior", () => {
  expect(clamp8(-1)).toBe(0)
  expect(clamp8(12.5)).toBe(12.5)
  expect(clamp8(300)).toBe(255)
  expect(clamp01(-0.1)).toBe(0)
  expect(clamp01(0.25)).toBe(0.25)
  expect(clamp01(1.1)).toBe(1)
  expect(luma(100, 150, 200)).toBeCloseTo(140.75, 10)
  expect(numberParam("12.5", 3)).toBe(12.5)
  expect(numberParam("not-a-number", 3)).toBe(3)
  expect(parseBool(true, false)).toBe(true)
  expect(parseBool("true", false)).toBe(false)
  expect(parseNumber("9.5", 2)).toBe(9.5)
  expect(parseNumber("bad", 2)).toBe(2)
})

test("pixel helpers clone image data and preserve RGB/HSL conversion", () => {
  const src = fixture3x3()
  const copy = cloneImageData(src)
  expect(copy).not.toBe(src)
  expect(copy.data).not.toBe(src.data)
  expectSamePixels(copy, src)

  const hsl = rgbToHsl(64, 128, 192)
  expect(hsl.h).toBeCloseTo(0.5833333333333334, 12)
  expect(hsl.s).toBeCloseTo(0.5039370078740157, 12)
  expect(hsl.l).toBeCloseTo(0.5019607843137255, 12)
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l)
  expect(rgb.r).toBeCloseTo(64, 10)
  expect(rgb.g).toBeCloseTo(128, 10)
  expect(rgb.b).toBeCloseTo(192, 10)
})
```

- [ ] **Step 3: Run and verify the missing-module failure**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts
```

Expected: FAIL during module resolution for `filters/pixel-helpers`.

- [ ] **Step 4: Commit the red tests**

```powershell
git add tests/filter-module-boundaries.spec.ts
git commit -m "test: characterize filter pixel helpers"
```

### Task 2: Extract Canonical Helpers

**Files:**
- Create: `components/photoshop/filters/pixel-helpers.ts`
- Modify: `components/photoshop/filters/registry.ts`
- Modify: `components/photoshop/filters/basic-algorithms.ts`

- [ ] **Step 1: Create the helper module**

```typescript
export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

export function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

export function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function numberParam(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function parseBool(v: number | string | boolean | undefined, fallback = false) {
  return typeof v === "boolean" ? v : fallback
}

export function parseNumber(v: number | string | boolean | undefined, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return { h, s, l }
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

export function hslToRgb(h: number, s: number, l: number) {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return { r: r * 255, g: g * 255, b: b * 255 }
}
```

- [ ] **Step 2: Replace registry-local declarations with imports**

Add:

```typescript
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
  parseNumber,
  rgbToHsl,
} from "./pixel-helpers"
```

Remove the corresponding local declarations, including private `hue2rgb`.

- [ ] **Step 3: Remove duplicate basic-algorithm helpers**

In `basic-algorithms.ts`, remove local `clone` and `clamp8`, then add:

```typescript
import {
  clamp8,
  cloneImageData as clone,
} from "./pixel-helpers"
```

- [ ] **Step 4: Run focused and static checks**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/filter-module-boundaries.spec.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts tests/requested-filters-adjustments.spec.ts tests/photo-workflow-depth.spec.ts
npm run lint
npm run typecheck
```

Expected: all tests pass; lint and typecheck exit 0.

- [ ] **Step 5: Commit the extraction**

```powershell
git add components/photoshop/filters/pixel-helpers.ts components/photoshop/filters/registry.ts components/photoshop/filters/basic-algorithms.ts
git commit -m "refactor: extract filter pixel helpers"
```

### Task 3: Verify the Helper Slice

**Files:**
- Modify only files required to correct regressions introduced by Task 2.

- [ ] **Step 1: Run capability and build gates**

```powershell
npm run check:capabilities
npm run build
```

Expected: both commands exit 0; the existing circular runtime warning may remain.

- [ ] **Step 2: Inspect the diff and working tree**

```powershell
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; unrelated working-tree changes remain untouched.

- [ ] **Step 3: Prepare the adjustment-engine plan**

The next plan may move adjustment algorithms after explicitly resolving their dependencies on curve interpolation and deterministic dithering helpers.
