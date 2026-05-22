# Pixel Fidelity and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a depth-first pixel fidelity package covering filter execution metadata, worker/fallback parity, layer-style raster checks, direct stamp/tool pixel checks, and honest reporting surfaces.

**Architecture:** Keep the editor on the existing Next.js, React, TypeScript, Canvas 2D, reducer, and worker architecture. Add a small browser-backed pixel harness for tests that need real Canvas APIs, a pure filter execution classifier for reporting, and focused tests around the existing filter, layer-style, and tool-helper boundaries.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright, browser Canvas/ImageData APIs, existing Photoshop editor modules.

---

## Scope Check

The approved spec contains three connected tracks rather than fully independent products: filter fidelity/performance, layer FX raster fidelity, and stamp/tool pixel fidelity. This plan keeps them in one release because they share the same test fixtures, capability reporting, and pixel-pipeline language.

## File Structure

- Create `tests/pixel-fixtures.ts`: shared `ImageData` test constructor, deterministic fixtures, pixel comparison helpers, and sample utilities for Node-side Playwright tests.
- Create `app/__pixel-harness/page.tsx`: hidden development-only route that provides real browser Canvas APIs for pixel tests.
- Create `app/__pixel-harness/pixel-harness-client.tsx`: client component that imports production pixel helpers and exposes a tiny `window.__psPixelHarness` test API.
- Create `tests/pixel-harness.spec.ts`: smoke test for the harness itself.
- Create `components/photoshop/filter-execution.ts`: pure classifier for worker, tiled worker, main-thread fallback, approximate, and unsupported filter execution.
- Modify `components/photoshop/filter-worker.ts`: expose support metadata needed by the classifier and keep existing async fallback behavior intact.
- Modify `components/photoshop/capabilities.ts`: include pixel/filter execution warnings in capability summaries.
- Modify `components/photoshop/document-io.ts`: include pixel/filter execution report items in document reports.
- Modify `components/photoshop/preflight-engine.ts`: this already consumes `capabilityWarningsForDocument`; update warning details through `capabilities.ts` rather than adding a separate preflight path.
- Modify `components/photoshop/tool-helpers.ts`: extract reusable `patternStampDab` and `spongeStamp` helpers from `canvas-view.tsx`.
- Modify `components/photoshop/canvas-view.tsx`: replace local pattern/sponge implementations with the extracted helpers.
- Create `tests/filter-execution.spec.ts`: pure filter execution metadata tests.
- Modify `tests/filters-algorithms.spec.ts`: broaden worker/fallback parity coverage.
- Create `tests/layer-style-raster.spec.ts`: browser-backed pixel tests for layer styles.
- Create `tests/tool-pixel-fidelity.spec.ts`: browser-backed pixel tests for clone/heal/blur/sharpen/dodge/burn/sponge/pattern/fill behavior.
- Modify `tests/capabilities.spec.ts`: assert capability/document warnings include filter execution details.
- Modify `tests/io-color-filter-hardening.spec.ts`: assert production/reporting surfaces describe worker/fallback pixel limits.

---

### Task 1: Shared Pixel Fixtures

**Files:**
- Create: `tests/pixel-fixtures.ts`
- Modify: `tests/filter-fidelity-golden.spec.ts`
- Modify: `tests/filters-algorithms.spec.ts`

- [ ] **Step 1: Create the shared fixture file**

Add `tests/pixel-fixtures.ts`:

```ts
import { expect } from "@playwright/test"

export class TestImageData {
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

export function installTestImageData() {
  globalThis.ImageData = TestImageData as unknown as typeof ImageData
}

export function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

export function fixture3x3() {
  return imageData(3, 3, [
    10, 20, 30, 255, 70, 80, 90, 255, 130, 120, 100, 255,
    35, 55, 85, 255, 125, 135, 145, 255, 220, 210, 180, 255,
    20, 90, 60, 255, 155, 80, 45, 255, 245, 245, 230, 255,
  ])
}

export function gradientFixture(width = 5, height = 5) {
  const pixels: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.push(x * 40 + y * 5, y * 42, 180 - x * 20, 255)
    }
  }
  return imageData(width, height, pixels)
}

export function dataOf(image: ImageData) {
  return Array.from(image.data)
}

export function pixelAt(image: ImageData, x: number, y: number) {
  const i = (y * image.width + x) * 4
  return Array.from(image.data.slice(i, i + 4))
}

export function expectImageDataClose(actual: ImageData, expected: ImageData, tolerance = 0) {
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  expect(actual.data.length).toBe(expected.data.length)
  for (let i = 0; i < actual.data.length; i++) {
    expect(Math.abs(actual.data[i] - expected.data[i]), `pixel byte ${i}`).toBeLessThanOrEqual(tolerance)
  }
}
```

- [ ] **Step 2: Refactor duplicate fixture setup in filter tests**

In `tests/filter-fidelity-golden.spec.ts`, remove the local `TestImageData`, `imageData`, `fixture3x3`, and `dataOf` definitions. Add this import and setup at the top:

```ts
import {
  dataOf,
  fixture3x3,
  imageData,
  installTestImageData,
} from "./pixel-fixtures"

installTestImageData()
```

In `tests/filters-algorithms.spec.ts`, remove the local `TestImageData` and `imageData` definitions. Add this import and setup at the top:

```ts
import {
  dataOf,
  imageData,
  installTestImageData,
} from "./pixel-fixtures"

installTestImageData()
```

Replace `Array.from(actual.data)` assertions in this file with `dataOf(actual)` only when it makes the test shorter.

- [ ] **Step 3: Run the refactor target tests**

Run:

```bash
npx playwright test tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts
```

Expected: PASS. If this fails, fix only import paths or helper names; do not change filter behavior in this task.

- [ ] **Step 4: Commit**

```bash
git add tests/pixel-fixtures.ts tests/filter-fidelity-golden.spec.ts tests/filters-algorithms.spec.ts
git commit -m "test: share pixel fixtures"
```

---

### Task 2: Browser Pixel Harness

**Files:**
- Create: `app/__pixel-harness/page.tsx`
- Create: `app/__pixel-harness/pixel-harness-client.tsx`
- Create: `tests/pixel-harness.spec.ts`

- [ ] **Step 1: Write the failing harness test**

Add `tests/pixel-harness.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

type HarnessResult = {
  size: { width: number; height: number }
  samples: Record<string, [number, number, number, number]>
}

declare global {
  interface Window {
    __psPixelHarness?: {
      layerStyleSample: (kind: string) => HarnessResult
      stampSample: (kind: string) => HarnessResult
    }
  }
}

test("pixel harness exposes real browser canvas samples", async ({ page }) => {
  await page.goto("/__pixel-harness")
  await expect(page.getByTestId("pixel-harness-ready")).toBeVisible()

  const layer = await page.evaluate(() => window.__psPixelHarness!.layerStyleSample("drop-shadow"))
  expect(layer.size).toEqual({ width: 32, height: 32 })
  expect(layer.samples.fill).toEqual([255, 255, 255, 255])
  expect(layer.samples.shadow[3]).toBeGreaterThan(0)

  const stamp = await page.evaluate(() => window.__psPixelHarness!.stampSample("clone"))
  expect(stamp.samples.target[0]).toBeGreaterThan(stamp.samples.before[0])
  expect(stamp.samples.target[3]).toBe(255)
})
```

- [ ] **Step 2: Run the harness test and verify red**

Run:

```bash
npx playwright test tests/pixel-harness.spec.ts
```

Expected: FAIL because `/__pixel-harness` does not exist.

- [ ] **Step 3: Add the hidden route**

Create `app/__pixel-harness/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { PixelHarnessClient } from "./pixel-harness-client"

export default function PixelHarnessPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_PIXEL_HARNESS !== "1") {
    notFound()
  }

  return <PixelHarnessClient />
}
```

- [ ] **Step 4: Add the client harness**

Create `app/__pixel-harness/pixel-harness-client.tsx`:

```tsx
"use client"

import * as React from "react"
import { applyLayerStyle } from "@/components/photoshop/layer-styles"
import {
  blurStamp,
  cloneStamp,
  dodgeBurnStamp,
  healStamp,
  makeCanvas,
  paintBucketFill,
  sharpenStamp,
  transformedCloneStamp,
} from "@/components/photoshop/tool-helpers"
import type { Layer, LayerStyle } from "@/components/photoshop/types"

type Pixel = [number, number, number, number]
type HarnessResult = {
  size: { width: number; height: number }
  samples: Record<string, Pixel>
}

declare global {
  interface Window {
    __psPixelHarness?: {
      layerStyleSample: (kind: string) => HarnessResult
      stampSample: (kind: string) => HarnessResult
    }
  }
}

function sample(ctx: CanvasRenderingContext2D, x: number, y: number): Pixel {
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0], data[1], data[2], data[3]]
}

function baseLayer(style: LayerStyle): Layer {
  const canvas = makeCanvas(32, 32)
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, 32, 32)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(10, 10, 10, 10)
  return {
    id: "harness-layer",
    name: "Harness Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    style,
  }
}

function styleFor(kind: string): LayerStyle {
  switch (kind) {
    case "drop-shadow":
      return { dropShadow: { enabled: true, color: "#000000", size: 4, offsetX: 4, offsetY: 4, opacity: 0.8, blendMode: "normal" } }
    case "outer-glow":
      return { outerGlow: { enabled: true, color: "#ffee44", size: 5, opacity: 0.9, blendMode: "normal", spread: 0, range: 60 } }
    case "inner-glow":
      return { innerGlow: { enabled: true, color: "#44aaff", size: 4, opacity: 0.9, blendMode: "normal", source: "edge", choke: 0, range: 70 } }
    case "inner-shadow":
      return { innerShadow: { enabled: true, color: "#000000", size: 5, offsetX: 2, offsetY: 2, opacity: 0.8, blendMode: "normal" } }
    case "bevel":
      return { bevel: { enabled: true, style: "inner", direction: "up", depth: 120, size: 4, soften: 0, angle: 135, altitude: 35, highlight: "#ffffff", shadow: "#000000", opacity: 0.8 } }
    case "satin":
      return { satin: { enabled: true, color: "#3344aa", angle: 45, distance: 5, size: 4, opacity: 0.8, blendMode: "normal" } }
    case "stroke":
      return { stroke: { enabled: true, color: "#ff0000", size: 3, position: "outside", opacity: 1, blendMode: "normal", fillType: "color" } }
    default:
      throw new Error(`Unknown layer style harness case: ${kind}`)
  }
}

function layerStyleSample(kind: string): HarnessResult {
  const output = applyLayerStyle(baseLayer(styleFor(kind)))
  const ctx = output.getContext("2d")!
  return {
    size: { width: output.width, height: output.height },
    samples: {
      fill: sample(ctx, 14, 14),
      edge: sample(ctx, 10, 14),
      outside: sample(ctx, 8, 14),
      shadow: sample(ctx, 23, 23),
      highlight: sample(ctx, 11, 11),
      lowlight: sample(ctx, 18, 18),
    },
  }
}

function sourceCanvas() {
  const canvas = makeCanvas(32, 32)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#102030"
  ctx.fillRect(0, 0, 32, 32)
  ctx.fillStyle = "#f05030"
  ctx.fillRect(8, 8, 10, 10)
  ctx.fillStyle = "#30d070"
  ctx.fillRect(18, 18, 8, 8)
  return canvas
}

function targetCanvas() {
  const canvas = makeCanvas(32, 32)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#202020"
  ctx.fillRect(0, 0, 32, 32)
  ctx.fillStyle = "#606060"
  ctx.fillRect(12, 12, 8, 8)
  return canvas
}

function stampSample(kind: string): HarnessResult {
  const src = sourceCanvas()
  const dest = targetCanvas()
  const ctx = dest.getContext("2d")!
  const before = sample(ctx, 16, 16)

  if (kind === "clone") {
    cloneStamp(ctx, src, 13, 13, 16, 16, 5, 100, 1)
  } else if (kind === "transformed-clone") {
    transformedCloneStamp(ctx, src, { x: 13, y: 13 }, { x: 16, y: 16 }, 16, 16, 5, 100, 1, 100, 0, false)
  } else if (kind === "heal") {
    healStamp(ctx, src, 13, 13, 16, 16, 5)
  } else if (kind === "blur") {
    ctx.fillStyle = "#000000"
    ctx.fillRect(15, 10, 2, 12)
    blurStamp(ctx, 16, 16, 6)
  } else if (kind === "sharpen") {
    ctx.fillStyle = "#444444"
    ctx.fillRect(0, 0, 32, 32)
    ctx.fillStyle = "#888888"
    ctx.fillRect(12, 12, 8, 8)
    sharpenStamp(ctx, 16, 16, 6)
  } else if (kind === "dodge") {
    dodgeBurnStamp(ctx, 16, 16, 6, "dodge", 0.8)
  } else if (kind === "burn") {
    dodgeBurnStamp(ctx, 16, 16, 6, "burn", 0.8)
  } else if (kind === "paint-bucket") {
    paintBucketFill(dest, 0, 0, "#00aaff", 12, true, null)
  } else {
    throw new Error(`Unknown stamp harness case: ${kind}`)
  }

  return {
    size: { width: dest.width, height: dest.height },
    samples: {
      before,
      target: sample(ctx, 16, 16),
      corner: sample(ctx, 0, 0),
      edge: sample(ctx, 15, 16),
    },
  }
}

export function PixelHarnessClient() {
  React.useEffect(() => {
    window.__psPixelHarness = { layerStyleSample, stampSample }
    return () => {
      delete window.__psPixelHarness
    }
  }, [])

  return (
    <main data-testid="pixel-harness-ready" style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      Pixel harness ready
    </main>
  )
}
```

- [ ] **Step 5: Run the harness test and verify green**

Run:

```bash
npx playwright test tests/pixel-harness.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/__pixel-harness/page.tsx app/__pixel-harness/pixel-harness-client.tsx tests/pixel-harness.spec.ts
git commit -m "test: add browser pixel harness"
```

---

### Task 3: Filter Execution Classifier

**Files:**
- Create: `components/photoshop/filter-execution.ts`
- Create: `tests/filter-execution.spec.ts`

- [ ] **Step 1: Write the failing classifier tests**

Add `tests/filter-execution.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

import {
  classifyFilterExecution,
  describeFilterExecution,
  trackedPixelFilterIds,
} from "../components/photoshop/filter-execution"

test("filter execution classifier distinguishes worker, tiled worker, fallback, approximation, and unsupported paths", () => {
  expect(classifyFilterExecution("brightness-contrast", 256, 256).strategy).toBe("worker")
  expect(classifyFilterExecution("gaussian-blur", 5000, 4000, { radius: 6 }).strategy).toBe("tiled-worker")
  expect(classifyFilterExecution("surface-blur", 5000, 4000, { radius: 8, threshold: 40 }).strategy).toBe("tiled-main-thread")
  expect(classifyFilterExecution("lens-blur", 1200, 900, { radius: 6 }).quality).toBe("approximation")
  expect(classifyFilterExecution("not-a-filter", 64, 64).strategy).toBe("unsupported")
})

test("filter execution descriptions are stable for reports", () => {
  expect(describeFilterExecution("gaussian-blur", 5000, 4000, { radius: 6 })).toContain("tiled worker")
  expect(describeFilterExecution("surface-blur", 5000, 4000, { radius: 8, threshold: 40 })).toContain("main-thread fallback")
  expect(describeFilterExecution("not-a-filter", 64, 64)).toContain("Unsupported filter")
})

test("tracked pixel filters include high-risk fidelity cases", () => {
  expect(trackedPixelFilterIds).toEqual(
    expect.arrayContaining([
      "brightness-contrast",
      "gaussian-blur",
      "motion-blur",
      "surface-blur",
      "lens-blur",
      "radial-blur",
    ]),
  )
})
```

- [ ] **Step 2: Run the classifier tests and verify red**

Run:

```bash
npx playwright test tests/filter-execution.spec.ts
```

Expected: FAIL because `components/photoshop/filter-execution.ts` does not exist.

- [ ] **Step 3: Implement the classifier**

Create `components/photoshop/filter-execution.ts`:

```ts
import { getFilter } from "./filters"
import {
  isFilterWorkerSupported,
  planExpensiveFilterTiling,
} from "./filter-worker"

export type FilterExecutionStrategy =
  | "worker"
  | "tiled-worker"
  | "main-thread-fallback"
  | "tiled-main-thread"
  | "unsupported"

export type FilterExecutionQuality = "native-browser" | "deterministic" | "approximation" | "unsupported"

export interface FilterExecutionClassification {
  filterId: string
  strategy: FilterExecutionStrategy
  quality: FilterExecutionQuality
  tileCount: number
  overlap: number
  warnings: string[]
}

export const trackedPixelFilterIds = [
  "brightness-contrast",
  "threshold",
  "posterize",
  "gaussian-blur",
  "box-blur",
  "motion-blur",
  "sharpen",
  "unsharp-mask",
  "surface-blur",
  "lens-blur",
  "radial-blur",
  "ripple",
  "clouds",
  "difference-clouds",
  "fibers",
] as const

const APPROXIMATE_FILTERS = new Set<string>([
  "surface-blur",
  "lens-blur",
  "radial-blur",
  "field-blur",
  "iris-blur",
  "tilt-shift",
  "path-blur",
  "spin-blur",
])

export function classifyFilterExecution(
  filterId: string,
  width = 1,
  height = 1,
  params: Record<string, number | string | boolean> = {},
): FilterExecutionClassification {
  const filter = getFilter(filterId)
  if (!filter) {
    return {
      filterId,
      strategy: "unsupported",
      quality: "unsupported",
      tileCount: 0,
      overlap: 0,
      warnings: [`Unsupported filter: ${filterId}`],
    }
  }

  const tiling = planExpensiveFilterTiling(filterId, width, height, params)
  const workerSupported = isFilterWorkerSupported(filterId)
  const approximate = APPROXIMATE_FILTERS.has(filterId)
  const strategy: FilterExecutionStrategy =
    tiling.strategy === "tiled-worker-preferred"
      ? "tiled-worker"
      : tiling.strategy === "tiled-main-thread"
        ? "tiled-main-thread"
        : workerSupported
          ? "worker"
          : "main-thread-fallback"

  const warnings = [...tiling.warnings]
  if (!workerSupported) warnings.push("Uses scheduled main-thread fallback in this browser build.")
  if (approximate) warnings.push("Uses a browser-local approximation rather than Photoshop-native filter semantics.")

  return {
    filterId,
    strategy,
    quality: approximate ? "approximation" : workerSupported ? "deterministic" : "native-browser",
    tileCount: tiling.tileCount,
    overlap: tiling.overlap,
    warnings,
  }
}

export function describeFilterExecution(
  filterId: string,
  width = 1,
  height = 1,
  params: Record<string, number | string | boolean> = {},
) {
  const plan = classifyFilterExecution(filterId, width, height, params)
  if (plan.strategy === "unsupported") return plan.warnings[0]

  const strategyLabel: Record<FilterExecutionStrategy, string> = {
    worker: "worker",
    "tiled-worker": "tiled worker",
    "main-thread-fallback": "main-thread fallback",
    "tiled-main-thread": "tiled main-thread fallback",
    unsupported: "unsupported",
  }

  const base = `${filterId} uses ${strategyLabel[plan.strategy]} execution`
  const tiled = plan.tileCount > 1 ? ` across ${plan.tileCount} tiles with ${plan.overlap}px overlap` : ""
  const quality = plan.quality === "approximation" ? " and is classified as a browser-local approximation" : ""
  return `${base}${tiled}${quality}.`
}
```

- [ ] **Step 4: Run the classifier tests and verify green**

Run:

```bash
npx playwright test tests/filter-execution.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/photoshop/filter-execution.ts tests/filter-execution.spec.ts
git commit -m "feat: classify filter execution paths"
```

---

### Task 4: Worker and Filter Parity Coverage

**Files:**
- Modify: `tests/filters-algorithms.spec.ts`
- Modify: `tests/filter-fidelity-golden.spec.ts`
- Modify: `components/photoshop/filter-worker.ts`

- [ ] **Step 1: Add failing or broader worker parity tests**

In `tests/filters-algorithms.spec.ts`, extend the `"worker-backed deterministic filters match registry output"` case by adding these cases:

```ts
    ["brightness-contrast", { brightness: 18, contrast: 22, useLegacy: false }],
    ["threshold", { level: 110 }],
    ["posterize", { levels: 4 }],
    ["exposure", { ev: 0.35 }],
```

Add a new test below it:

```ts
test("worker error fallback preserves output when worker execution fails", async () => {
  const src = imageData(2, 1, [
    20, 40, 60, 255,
    200, 180, 160, 255,
  ])
  const expected = getFilter("brightness-contrast")!.apply(src, { brightness: 12, contrast: 18, useLegacy: false })
  const actual = await applyFilterAsync("brightness-contrast", src, { brightness: 12, contrast: 18, useLegacy: false }, {
    workerExecutor: async () => {
      throw new Error("forced worker failure")
    },
  })

  expect(dataOf(actual)).toEqual(dataOf(expected))
})
```

- [ ] **Step 2: Add a deterministic golden for a newly covered filter**

In `tests/filter-fidelity-golden.spec.ts`, add this case to the `cases` array:

```ts
    ["brightness-contrast", { brightness: 18, contrast: 22, useLegacy: false }, [
      28, 42, 57, 255, 98, 110, 122, 255, 168, 158, 136, 255,
      57, 80, 114, 255, 162, 174, 186, 255, 255, 255, 236, 255,
      40, 120, 85, 255, 197, 109, 67, 255, 255, 255, 255, 255,
    ]],
```

If this exact golden differs by one byte after running the test, inspect the current `brightness-contrast` formula in `components/photoshop/filters.ts`, update only this expected array to the current deterministic output, and mention the one-byte browser/rounding delta in the commit message body.

- [ ] **Step 3: Run the target tests**

Run:

```bash
npx playwright test tests/filters-algorithms.spec.ts tests/filter-fidelity-golden.spec.ts
```

Expected: PASS for existing worker-supported filters. If the new brightness/contrast golden fails, update only that expected array to match the current registry output.

- [ ] **Step 4: Tighten support metadata if a parity case exposes drift**

If a worker parity case fails because `filter-worker.ts` and `filters.ts` differ, update the worker implementation for that specific filter. For `brightness-contrast`, the worker-side function must use the same non-legacy formula as the registry:

```ts
// Inside workerSource(), keep this body aligned with filters.ts.
function brightnessContrast(data, params) {
  const brightness = num(params.brightness, 0);
  const contrast = num(params.contrast, 0);
  if (bool(params.useLegacy, false)) {
    const c = (contrast + 100) / 100;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp8((data[i] - 128) * c + 128 + brightness);
      data[i + 1] = clamp8((data[i + 1] - 128) * c + 128 + brightness);
      data[i + 2] = clamp8((data[i + 2] - 128) * c + 128 + brightness);
    }
    return;
  }
  const b = brightness / 150;
  const c = contrast / 100;
  const pivot = 0.5 + b * 0.12;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = data[i + k] / 255;
      v = b >= 0 ? v + (1 - v) * b : v * (1 + b);
      if (c !== 0) {
        const slope = c >= 0 ? 1 + c * 2.2 : 1 + c * 0.85;
        v = (v - pivot) * slope + pivot;
      }
      data[i + k] = clamp8(v * 255);
    }
  }
}
```

- [ ] **Step 5: Re-run tests and commit**

Run:

```bash
npx playwright test tests/filters-algorithms.spec.ts tests/filter-fidelity-golden.spec.ts
```

Expected: PASS.

Commit:

```bash
git add tests/filters-algorithms.spec.ts tests/filter-fidelity-golden.spec.ts components/photoshop/filter-worker.ts
git commit -m "test: expand filter worker parity coverage"
```

---

### Task 5: Layer Style Raster Coverage

**Files:**
- Create: `tests/layer-style-raster.spec.ts`
- Modify: `components/photoshop/layer-styles.ts` only if tests expose a real renderer bug

- [ ] **Step 1: Write browser-backed layer style tests**

Add `tests/layer-style-raster.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

type Pixel = [number, number, number, number]
type HarnessResult = {
  samples: Record<string, Pixel>
}

async function styleCase(page: import("@playwright/test").Page, kind: string) {
  return page.evaluate((styleKind) => window.__psPixelHarness!.layerStyleSample(styleKind), kind) as Promise<HarnessResult>
}

test.beforeEach(async ({ page }) => {
  await page.goto("/__pixel-harness")
  await expect(page.getByTestId("pixel-harness-ready")).toBeVisible()
})

test("drop shadow and outer glow render pixels outside the source alpha", async ({ page }) => {
  const shadow = await styleCase(page, "drop-shadow")
  const glow = await styleCase(page, "outer-glow")

  expect(shadow.samples.fill).toEqual([255, 255, 255, 255])
  expect(shadow.samples.shadow[3]).toBeGreaterThan(0)
  expect(glow.samples.outside[3]).toBeGreaterThan(0)
  expect(glow.samples.outside[0] + glow.samples.outside[1]).toBeGreaterThan(glow.samples.outside[2])
})

test("inner effects change only pixels inside the source alpha", async ({ page }) => {
  const innerShadow = await styleCase(page, "inner-shadow")
  const innerGlow = await styleCase(page, "inner-glow")

  expect(innerShadow.samples.fill[3]).toBe(255)
  expect(innerShadow.samples.edge[0]).toBeLessThan(innerShadow.samples.fill[0])
  expect(innerGlow.samples.edge[2]).toBeGreaterThan(innerGlow.samples.fill[2] - 5)
})

test("bevel satin and stroke produce distinct raster changes", async ({ page }) => {
  const bevel = await styleCase(page, "bevel")
  const satin = await styleCase(page, "satin")
  const stroke = await styleCase(page, "stroke")

  expect(bevel.samples.highlight[0]).toBeGreaterThanOrEqual(bevel.samples.lowlight[0])
  expect(satin.samples.fill).not.toEqual([255, 255, 255, 255])
  expect(stroke.samples.outside[0]).toBeGreaterThan(180)
  expect(stroke.samples.outside[3]).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the layer style tests**

Run:

```bash
npx playwright test tests/layer-style-raster.spec.ts
```

Expected: Either PASS or FAIL with a concrete layer-style renderer issue.

- [ ] **Step 3: Fix only renderer issues exposed by the tests**

If `drop-shadow`, `outer-glow`, or `stroke` outside pixels are transparent, inspect `drawDropShadow`, `drawOuterGlow`, or `drawStroke` in `components/photoshop/layer-styles.ts`. Fix the smallest failing mask or draw order issue.

If `inner-shadow`, `inner-glow`, `bevel`, or `satin` fails to alter inside pixels, inspect only these local helper implementations in `components/photoshop/layer-styles.ts`:

- `drawInnerGlow`
- `drawInnerShadow`
- `drawBevel`
- `drawSatin`

Keep `applyLayerStyle` draw order unchanged unless the failing test proves the order is wrong.

- [ ] **Step 4: Re-run tests and commit**

Run:

```bash
npx playwright test tests/layer-style-raster.spec.ts
```

Expected: PASS.

Commit:

```bash
git add tests/layer-style-raster.spec.ts components/photoshop/layer-styles.ts
git commit -m "test: cover layer style raster output"
```

---

### Task 6: Extract Pattern and Sponge Stamp Helpers

**Files:**
- Modify: `components/photoshop/tool-helpers.ts`
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `app/__pixel-harness/pixel-harness-client.tsx`
- Create: `tests/tool-pixel-fidelity.spec.ts`

- [ ] **Step 1: Write failing tool pixel tests**

Add `tests/tool-pixel-fidelity.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

type Pixel = [number, number, number, number]
type HarnessResult = {
  samples: Record<string, Pixel>
}

async function stampCase(page: import("@playwright/test").Page, kind: string) {
  return page.evaluate((stampKind) => window.__psPixelHarness!.stampSample(stampKind), kind) as Promise<HarnessResult>
}

test.beforeEach(async ({ page }) => {
  await page.goto("/__pixel-harness")
  await expect(page.getByTestId("pixel-harness-ready")).toBeVisible()
})

test("clone healing and transformed clone alter target pixels through production helpers", async ({ page }) => {
  for (const kind of ["clone", "transformed-clone", "heal"]) {
    const result = await stampCase(page, kind)
    expect(result.samples.target).not.toEqual(result.samples.before)
    expect(result.samples.target[3]).toBe(255)
  }
})

test("blur sharpen dodge burn and fill produce expected local pixel changes", async ({ page }) => {
  const blur = await stampCase(page, "blur")
  const sharpen = await stampCase(page, "sharpen")
  const dodge = await stampCase(page, "dodge")
  const burn = await stampCase(page, "burn")
  const fill = await stampCase(page, "paint-bucket")

  expect(blur.samples.corner).toEqual([32, 32, 32, 255])
  expect(sharpen.samples.target).not.toEqual(sharpen.samples.before)
  expect(dodge.samples.target[0]).toBeGreaterThan(dodge.samples.before[0])
  expect(burn.samples.target[0]).toBeLessThan(burn.samples.before[0])
  expect(fill.samples.corner).toEqual([0, 170, 255, 255])
})

test("pattern stamp and sponge are testable through extracted helpers", async ({ page }) => {
  const pattern = await stampCase(page, "pattern-stamp")
  const sponge = await stampCase(page, "sponge")

  expect(pattern.samples.target).not.toEqual(pattern.samples.before)
  expect(sponge.samples.target[0]).toBeCloseTo(sponge.samples.target[1], 12)
  expect(sponge.samples.target[1]).toBeCloseTo(sponge.samples.target[2], 12)
})
```

- [ ] **Step 2: Run the tool tests and verify red**

Run:

```bash
npx playwright test tests/tool-pixel-fidelity.spec.ts
```

Expected: FAIL because the harness does not expose `pattern-stamp` or `sponge`, and those helpers are local to `canvas-view.tsx`.

- [ ] **Step 3: Extract helpers into `tool-helpers.ts`**

Add this code near the existing stamp helpers in `components/photoshop/tool-helpers.ts`:

```ts
export type PatternStampKind = "checker" | "dots" | "paper" | "lines" | "linen" | "noise"

function patternHashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

export function patternStampDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dabSize: number,
  dabAngle: number,
  dabRoundness: number,
  opacity: number,
  options: {
    foreground: string
    background: string
    pattern?: string
    tipShape?: "round" | "square" | "bristle" | "erodible"
  },
) {
  const r = dabSize / 2
  const pattern = options.pattern ?? "checker"
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dabAngle)
  ctx.scale(1, dabRoundness)
  ctx.beginPath()
  if ((options.tipShape ?? "round") === "square") ctx.rect(-r, -r, r * 2, r * 2)
  else ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = opacity

  const tile = makeCanvas(32, 32)
  const tctx = tile.getContext("2d")!
  tctx.fillStyle = options.foreground
  tctx.fillRect(0, 0, 32, 32)
  tctx.fillStyle = options.background

  if (pattern === "dots" || pattern === "paper") {
    for (let py = 4; py < 32; py += 8) {
      for (let px = 4; px < 32; px += 8) {
        tctx.beginPath()
        tctx.arc(px, py, 2.2, 0, Math.PI * 2)
        tctx.fill()
      }
    }
  } else if (pattern === "lines" || pattern === "linen") {
    tctx.lineWidth = 3
    tctx.strokeStyle = options.background
    for (let offset = -32; offset < 64; offset += 10) {
      tctx.beginPath()
      tctx.moveTo(offset, 32)
      tctx.lineTo(offset + 32, 0)
      tctx.stroke()
    }
  } else if (pattern === "noise") {
    const img = tctx.getImageData(0, 0, 32, 32)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = patternHashNoise(i, x + y, 17) > 0.5
      const c = n ? hexToRgb(options.foreground) : hexToRgb(options.background)
      img.data[i] = c.r
      img.data[i + 1] = c.g
      img.data[i + 2] = c.b
    }
    tctx.putImageData(img, 0, 0)
  } else {
    tctx.fillRect(0, 0, 16, 16)
    tctx.fillRect(16, 16, 16, 16)
  }

  const fill = ctx.createPattern(tile, "repeat")
  if (fill) {
    ctx.fillStyle = fill
    ctx.translate(-x, -y)
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()
}

export function spongeStamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength: number) {
  const r = Math.max(2, Math.floor(radius))
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(ctx.canvas.width - sx, r * 2)
  const sh = Math.min(ctx.canvas.height - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const img = ctx.getImageData(sx, sy, sw, sh)
  const data = img.data
  const rSq = r * r
  for (let py = 0; py < sh; py++) {
    const dy = py - r
    const dy2 = dy * dy
    if (dy2 > rSq) continue
    const halfW = Math.sqrt(rSq - dy2)
    const pxStart = Math.max(0, Math.floor(r - halfW))
    const pxEnd = Math.min(sw - 1, Math.ceil(r + halfW))
    const rowStart = py * sw * 4
    for (let px = pxStart; px <= pxEnd; px++) {
      const i = rowStart + px * 4
      if (data[i + 3] === 0) continue
      const rr = data[i]
      const gg = data[i + 1]
      const bb = data[i + 2]
      const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
      data[i] = rr + (lum - rr) * strength
      data[i + 1] = gg + (lum - gg) * strength
      data[i + 2] = bb + (lum - bb) * strength
    }
  }
  ctx.putImageData(img, sx, sy)
}
```

- [ ] **Step 4: Replace local canvas-view implementations**

In `components/photoshop/canvas-view.tsx`, add imports from `tool-helpers.ts`:

```ts
import {
  patternStampDab,
  spongeStamp,
} from "./tool-helpers"
```

Use the existing grouped import from `./tool-helpers` if one already exists in the file.

Replace the body of local `drawPatternStampDab` with:

```ts
    patternStampDab(ctx, x, y, dabSize, dabAngle, dabRoundness, opacity, {
      foreground,
      background,
      pattern: activeDoc?.patternLibrary?.[0]?.type ?? brush.texture?.pattern ?? "checker",
      tipShape: brush.tipShape,
    })
```

Delete the local `spongeStamp` function from `canvas-view.tsx`; the existing call sites should now resolve to the imported helper.

- [ ] **Step 5: Extend the harness for extracted helpers**

In `app/__pixel-harness/pixel-harness-client.tsx`, add imports:

```ts
  patternStampDab,
  spongeStamp,
```

Add these cases inside `stampSample` before the final `else`:

```ts
  } else if (kind === "pattern-stamp") {
    patternStampDab(ctx, 16, 16, 12, 0, 1, 1, {
      foreground: "#ff0000",
      background: "#0000ff",
      pattern: "checker",
      tipShape: "round",
    })
  } else if (kind === "sponge") {
    ctx.fillStyle = "#f03090"
    ctx.fillRect(12, 12, 8, 8)
    spongeStamp(ctx, 16, 16, 6, 1)
```

- [ ] **Step 6: Run tool pixel tests**

Run:

```bash
npx playwright test tests/tool-pixel-fidelity.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck for extraction safety**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/photoshop/tool-helpers.ts components/photoshop/canvas-view.tsx app/__pixel-harness/pixel-harness-client.tsx tests/tool-pixel-fidelity.spec.ts
git commit -m "test: cover stamp pixel helpers"
```

---

### Task 7: Pixel Pipeline Reporting

**Files:**
- Modify: `components/photoshop/capabilities.ts`
- Modify: `components/photoshop/document-io.ts`
- Modify: `tests/capabilities.spec.ts`
- Modify: `tests/io-color-filter-hardening.spec.ts`

- [ ] **Step 1: Write failing capability/report tests**

In `tests/capabilities.spec.ts`, add:

```ts
test("document capability warnings include smart filter execution paths", () => {
  const warnings = capabilityWarningsForDocument({
    colorMode: "RGB",
    bitDepth: 8,
    layers: [
      { kind: "smart-object", smartFilters: [{ enabled: true }] },
      { kind: "raster", smartFilters: [{ enabled: true, filterId: "gaussian-blur" } as never] },
      { kind: "raster", smartFilters: [{ enabled: true, filterId: "surface-blur" } as never] },
    ],
  })

  expect(warnings.some((warning) => warning.label === "Filter execution")).toBe(true)
  expect(warnings.find((warning) => warning.label === "Filter execution")?.detail).toContain("worker")
  expect(warnings.find((warning) => warning.label === "Filter execution")?.detail).toContain("fallback")
})
```

In `tests/io-color-filter-hardening.spec.ts`, add:

```ts
test("document reports include filter execution limits for smart filters", () => {
  const doc = richFixtureDocument()
  doc.layers[0] = {
    ...doc.layers[0],
    smartFilters: [
      { id: "sf_gaussian", filterId: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: { radius: 4 } },
      { id: "sf_surface", filterId: "surface-blur", name: "Surface Blur", enabled: true, params: { radius: 8, threshold: 40 } },
    ],
  }

  const report = createDocumentReport(doc, "PSD Export")
  expect(report.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Filter execution" })]))
  expect(report.items.find((item) => item.label === "Filter execution")?.detail).toContain("main-thread fallback")
})
```

- [ ] **Step 2: Run report tests and verify red**

Run:

```bash
npx playwright test tests/capabilities.spec.ts tests/io-color-filter-hardening.spec.ts
```

Expected: FAIL because filter execution details are not yet included in warnings/reports.

- [ ] **Step 3: Extend capability document snapshot typing**

In `components/photoshop/capabilities.ts`, update the `CapabilityDocumentSnapshot.layers.smartFilters` type from:

```ts
smartFilters?: Array<{ enabled?: boolean }>
```

to:

```ts
smartFilters?: Array<{
  enabled?: boolean
  filterId?: string
  params?: Record<string, number | string | boolean>
}>
```

- [ ] **Step 4: Add filter execution warnings**

In `components/photoshop/capabilities.ts`, import:

```ts
import { classifyFilterExecution } from "./filter-execution"
```

Inside `capabilityWarningsForDocument`, after the existing smart-filter warning block, add:

```ts
  const enabledFilterPlans = layers
    .flatMap((layer) => layer.smartFilters ?? [])
    .filter((filter) => filter.enabled !== false && filter.filterId)
    .map((filter) => classifyFilterExecution(filter.filterId!, 4096, 4096, filter.params ?? {}))

  if (enabledFilterPlans.length) {
    const workerCount = enabledFilterPlans.filter((plan) => plan.strategy === "worker" || plan.strategy === "tiled-worker").length
    const fallbackCount = enabledFilterPlans.filter((plan) => plan.strategy === "main-thread-fallback" || plan.strategy === "tiled-main-thread").length
    const approximateCount = enabledFilterPlans.filter((plan) => plan.quality === "approximation").length
    warnings.push(warning(
      getCapability("filter.worker-expanded"),
      "Filter execution",
      `${workerCount} smart filter${workerCount === 1 ? "" : "s"} can use worker execution; ${fallbackCount} use main-thread fallback; ${approximateCount} are browser-local approximations.`,
    ))
  }
```

- [ ] **Step 5: Ensure document reports receive the warning**

In `components/photoshop/document-io.ts`, find the code path that appends `capabilityWarningsForDocument` items in `createDocumentReport`. If it already maps all capability warnings into report items, no code change is needed. If it filters warning labels, include `"Filter execution"` in the allowed labels.

Use this mapping for the new item if the report code needs an explicit conversion:

```ts
{
  label: warning.label,
  status: warning.status === "unsupported" ? "unsupported" : warning.status === "complete" ? "preserved" : "approximated",
  detail: warning.detail,
}
```

- [ ] **Step 6: Run report tests and verify green**

Run:

```bash
npx playwright test tests/capabilities.spec.ts tests/io-color-filter-hardening.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/photoshop/capabilities.ts components/photoshop/document-io.ts tests/capabilities.spec.ts tests/io-color-filter-hardening.spec.ts
git commit -m "feat: report filter execution limits"
```

---

### Task 8: UI Integration Smoke

**Files:**
- Modify: `tests/right-panel-status-context.spec.ts`
- Modify: `tests/menu-command-access.spec.ts`

- [ ] **Step 1: Add command/menu smoke coverage for pixel reporting**

In `tests/menu-command-access.spec.ts`, add:

```ts
test("preflight and document reports remain reachable after pixel pipeline reporting changes", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Preflight")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: /Preflight/ })).toBeVisible()
  await expect(page.getByText(/Browser pixel pipeline|Filter execution|Raster export/)).toBeVisible()
})
```

If `menu-command-access.spec.ts` already has a helper for command palette execution, use that helper instead of duplicating `Control+K`.

- [ ] **Step 2: Run the UI smoke test**

Run:

```bash
npx playwright test tests/menu-command-access.spec.ts
```

Expected: PASS. If the command label is different, inspect the command palette test snapshot and update only the query string to the existing label.

- [ ] **Step 3: Commit**

```bash
git add tests/menu-command-access.spec.ts tests/right-panel-status-context.spec.ts
git commit -m "test: cover pixel reporting access"
```

---

### Task 9: Targeted Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run targeted pixel/filter suite**

Run:

```bash
npx playwright test tests/pixel-harness.spec.ts tests/filter-execution.spec.ts tests/filters-algorithms.spec.ts tests/filter-fidelity-golden.spec.ts tests/layer-style-raster.spec.ts tests/tool-pixel-fidelity.spec.ts tests/capabilities.spec.ts tests/io-color-filter-hardening.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. Confirm that the hidden pixel harness route does not introduce client/server boundary errors.

- [ ] **Step 4: Run smoke suite if runtime allows**

Run:

```bash
npm run test:smoke
```

Expected: PASS. If the full suite is too slow for the current session, run these high-signal files instead:

```bash
npx playwright test tests/photoshop-smoke.spec.ts tests/menu-command-access.spec.ts tests/panel-dock-ux.spec.ts
```

- [ ] **Step 5: Handle verification-only fixes**

If verification required source changes, return to the task that introduced the failing area, apply the fix there, rerun that task's target command, and commit with that task's commit command. If no files changed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Filter fidelity and worker performance: Tasks 3, 4, 7, and 9.
- Layer effects raster fidelity: Tasks 2 and 5.
- Painting, clone, healing, and stamp fidelity: Tasks 2 and 6.
- Track B support surfaces: Task 7.
- Track C command/workflow exposure: Task 8.
- Existing architecture preserved: all tasks modify existing canvas, worker, capability, and report boundaries without introducing a new rendering engine.

Risk controls:

- Pixel tests needing real Canvas use a hidden browser harness instead of a fake Canvas implementation.
- Filter execution reporting uses a pure classifier so preflight/document reports stay deterministic.
- Pattern and sponge extraction is narrow and keeps canvas-view behavior intact.
- Every implementation task has a targeted test command before broader verification.
