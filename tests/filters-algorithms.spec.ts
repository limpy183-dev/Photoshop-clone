import { expect, test } from "@playwright/test"

import {
  analyzeContentAwareScale,
  buildEdgeAwareQuickSelectionMaskData,
} from "../components/photoshop/algorithmic-operations"
import {
  FILTERS,
  compositeFilterImageData,
  getFilter,
} from "../components/photoshop/filters"
import {
  applyFilterBatch,
  applyFilterAsync,
  getFilterWorkerAudit,
  getFilterWorkerSupport,
  isFilterWorkerSupported,
  type FilterBatchOperation,
} from "../components/photoshop/filter-worker"
import {
  sampleImageDataBilinear,
} from "../components/photoshop/warp-transform"
import { magneticLassoSnap } from "../components/photoshop/tool-helpers"

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

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

test("filter compositing honors opacity, blend mode, and enabled masks", () => {
  const before = imageData(2, 1, [
    100, 100, 100, 255,
    100, 100, 100, 255,
  ])
  const after = imageData(2, 1, [
    200, 50, 50, 255,
    200, 50, 50, 255,
  ])
  const maskData = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 0,
  ])

  const result = compositeFilterImageData(before, after, {
    opacity: 0.5,
    blendMode: "normal",
    maskData,
    maskWidth: 2,
    maskHeight: 1,
    maskEnabled: true,
  })

  expect(Array.from(result.data.slice(0, 4))).toEqual([150, 75, 75, 255])
  expect(Array.from(result.data.slice(4, 8))).toEqual([100, 100, 100, 255])
})

test("filter compositing reads rgba masks as grayscale mask pixels", () => {
  const before = imageData(2, 1, [
    100, 100, 100, 255,
    100, 100, 100, 255,
  ])
  const after = imageData(2, 1, [
    200, 50, 50, 255,
    200, 50, 50, 255,
  ])
  const maskData = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])

  const result = compositeFilterImageData(before, after, {
    opacity: 1,
    blendMode: "normal",
    maskData,
    maskWidth: 2,
    maskHeight: 1,
    maskEnabled: true,
  })

  expect(Array.from(result.data.slice(0, 4))).toEqual([200, 50, 50, 255])
  expect(Array.from(result.data.slice(4, 8))).toEqual([100, 100, 100, 255])
})

test("filter worker capability reports real off-main-thread coverage", () => {
  const support = getFilterWorkerSupport()

  expect(support.strategy).toContain("worker")
  expect(support.supportedFilters).toContain("invert")
  expect(support.supportedFilters).toContain("gaussian-blur")
  expect(support.supportedFilters).toContain("box-blur")
  expect(support.supportedFilters).toContain("motion-blur")
  expect(support.supportedFilters).toContain("sharpen")
  expect(support.supportedFilters).toContain("unsharp-mask")
  expect(support.supportedFilters).toContain("noise")
  expect(support.supportedFilters).toContain("ripple")
  expect(support.supportedFilters).toContain("clouds")
  expect(isFilterWorkerSupported("grayscale")).toBe(true)
  expect(isFilterWorkerSupported("gaussian-blur")).toBe(true)
  expect(isFilterWorkerSupported("box-blur")).toBe(true)
  expect(isFilterWorkerSupported("motion-blur")).toBe(true)
  expect(isFilterWorkerSupported("sharpen")).toBe(true)
  expect(isFilterWorkerSupported("unsharp-mask")).toBe(true)
  expect(isFilterWorkerSupported("noise")).toBe(true)
  expect(isFilterWorkerSupported("ripple")).toBe(true)
  expect(isFilterWorkerSupported("clouds")).toBe(true)
  expect(isFilterWorkerSupported("field-blur")).toBe(true)
  expect(isFilterWorkerSupported("iris-blur")).toBe(true)
  expect(isFilterWorkerSupported("tilt-shift")).toBe(true)
  expect(isFilterWorkerSupported("path-blur")).toBe(true)
  expect(isFilterWorkerSupported("spin-blur")).toBe(true)
})

test("filter worker audit covers the full registry and classifies fallback reasons", () => {
  const audit = getFilterWorkerAudit()
  const registryIds = Object.keys(FILTERS).sort()

  expect(audit.totalFilters).toBe(registryIds.length)
  expect(audit.entries.map((entry) => entry.filterId).sort()).toEqual(registryIds)
  expect(audit.workerSupportedCount).toBeGreaterThan(25)
  expect(audit.entries.find((entry) => entry.filterId === "field-blur")?.strategy).toBe("worker")
  expect(audit.entries.find((entry) => entry.filterId === "match-color")?.strategy).toBe("main-thread-context")
})

test("worker-backed deterministic filters match registry output", async () => {
  const src = imageData(3, 2, [
    10, 20, 30, 255,
    80, 90, 100, 240,
    150, 160, 170, 230,
    40, 60, 90, 220,
    120, 130, 140, 210,
    210, 200, 180, 200,
  ])
  const cases: Array<[string, Record<string, number | string | boolean>]> = [
    ["gaussian-blur", { radius: 3 }],
    ["box-blur", { radius: 1 }],
    ["motion-blur", { distance: 2, angle: 0 }],
    ["sharpen", { amount: 50 }],
    ["unsharp-mask", { amount: 100, radius: 3 }],
    ["noise", { amount: 0, mono: true, distribution: "uniform" }],
    ["ripple", { amount: 20, size: "medium" }],
    ["clouds", { scale: 50, seed: 3 }],
    ["difference-clouds", { scale: 50, seed: 3 }],
    ["fibers", { variance: 16, strength: 4, seed: 5 }],
    ["field-blur", { blur: 8, pins: "0,50,2;100,50,16" }],
    ["iris-blur", { blur: 8, centerX: 50, centerY: 50, radius: 40, feather: 25 }],
    ["tilt-shift", { blur: 8, centerX: 50, centerY: 50, angle: 0, radius: 30, feather: 25 }],
    ["path-blur", { distance: 5, angle: 0, taper: 20, path: "0,50;100,50" }],
    ["spin-blur", { amount: 18, centerX: 50, centerY: 50, radius: 60 }],
  ]

  for (const [filterId, params] of cases) {
    const filter = getFilter(filterId)
    expect(filter).toBeTruthy()
    const expected = filter!.apply(src, params)
    const actual = await applyFilterAsync(filterId, src, params)
    expect(Array.from(actual.data)).toEqual(Array.from(expected.data))
  }
})

test("batched filter execution runs sequentially and reports progress", async () => {
  const src = imageData(2, 1, [
    40, 80, 120, 255,
    160, 120, 80, 255,
  ])
  const operations: FilterBatchOperation[] = [
    { filterId: "brightness-contrast", params: { brightness: 15, contrast: 20, useLegacy: false } },
    { filterId: "invert", params: {} },
  ]
  const progress: Array<{ completed: number; total: number; filterId: string }> = []

  const expected = getFilter("invert")!.apply(
    getFilter("brightness-contrast")!.apply(src, operations[0].params),
    operations[1].params,
  )
  const actual = await applyFilterBatch(src, operations, {
    onProgress: (event) => progress.push({ completed: event.completed, total: event.total, filterId: event.filterId }),
  })

  expect(Array.from(actual.data)).toEqual(Array.from(expected.data))
  expect(progress).toEqual([
    { completed: 1, total: 2, filterId: "brightness-contrast" },
    { completed: 2, total: 2, filterId: "invert" },
  ])
})

test("content-aware scale analysis uses an explicit fallback plan for large reductions", () => {
  const plan = analyzeContentAwareScale(500, 100, 100, 100)

  expect(plan.widthSeams).toBeGreaterThan(96)
  expect(plan.widthFallbackPixels).toBeGreaterThan(0)
  expect(plan.quality).toBe("partial-seam-fallback")
  expect(plan.message).toContain("resized")
})

test("edge-aware quick selection grows locally and stops at strong color edges", () => {
  const src = imageData(5, 1, [
    220, 20, 20, 255,
    218, 24, 22, 255,
    20, 20, 220, 255,
    22, 22, 218, 255,
    24, 20, 216, 255,
  ])

  const result = buildEdgeAwareQuickSelectionMaskData(src, {
    seed: { x: 0, y: 0 },
    tolerance: 36,
  })

  expect(result.bounds).toEqual({ x: 0, y: 0, w: 2, h: 1 })
  expect(Array.from(result.maskData)).toEqual([255, 255, 0, 0, 0])
})

test("quick selection supports sample size and non-contiguous matching", () => {
  const src = imageData(7, 3, [
    10, 10, 220, 255,  218, 22, 20, 255,  220, 20, 20, 255,  218, 22, 20, 255,  10, 10, 220, 255,  10, 10, 220, 255,  220, 20, 20, 255,
    10, 10, 220, 255,  220, 20, 20, 255,  20, 220, 20, 255,  220, 20, 20, 255,  10, 10, 220, 255,  10, 10, 220, 255,  220, 20, 20, 255,
    10, 10, 220, 255,  218, 22, 20, 255,  220, 20, 20, 255,  218, 22, 20, 255,  10, 10, 220, 255,  10, 10, 220, 255,  220, 20, 20, 255,
  ])

  const contiguous = buildEdgeAwareQuickSelectionMaskData(src, {
    seed: { x: 1, y: 1 },
    tolerance: 34,
    sampleSize: "3x3",
    contiguous: true,
  })
  const nonContiguous = buildEdgeAwareQuickSelectionMaskData(src, {
    seed: { x: 1, y: 1 },
    tolerance: 34,
    sampleSize: "3x3",
    contiguous: false,
  })

  expect(Array.from(contiguous.maskData)).toEqual([
    0, 255, 255, 255, 0, 0, 0,
    0, 255, 0, 255, 0, 0, 0,
    0, 255, 255, 255, 0, 0, 0,
  ])
  expect(nonContiguous.bounds).toEqual({ x: 1, y: 0, w: 6, h: 3 })
  expect(nonContiguous.maskData[6]).toBe(255)
})

test("magnetic lasso snap honors width and contrast threshold options", () => {
  const src = imageData(9, 5, Array.from({ length: 9 * 5 }, (_, index) => {
    const x = index % 9
    return x < 4
      ? [20, 20, 20, 255]
      : [230, 230, 230, 255]
  }).flat())
  const canvas = {
    width: src.width,
    height: src.height,
    getContext: () => ({
      getImageData: (x: number, y: number, w: number, h: number) => {
        const out = new ImageData(w, h)
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const sx = Math.max(0, Math.min(src.width - 1, x + xx))
            const sy = Math.max(0, Math.min(src.height - 1, y + yy))
            const si = (sy * src.width + sx) * 4
            const di = (yy * w + xx) * 4
            out.data[di] = src.data[si]
            out.data[di + 1] = src.data[si + 1]
            out.data[di + 2] = src.data[si + 2]
            out.data[di + 3] = src.data[si + 3]
          }
        }
        return out
      },
    }),
  } as unknown as HTMLCanvasElement

  const snapped = magneticLassoSnap(canvas, 2, 2, { searchWidth: 4, contrastThreshold: 24 })
  const rejected = magneticLassoSnap(canvas, 2, 2, { searchWidth: 4, contrastThreshold: 900 })

  expect(snapped.x).toBeGreaterThanOrEqual(3)
  expect(snapped.x).toBeLessThanOrEqual(4)
  expect(rejected).toEqual({ x: 2, y: 2 })
})

test("warp transform bilinear sampling interpolates source pixels", () => {
  const src = imageData(2, 1, [
    0, 0, 0, 255,
    100, 40, 20, 255,
  ])

  expect(sampleImageDataBilinear(src, 0.5, 0)).toEqual([50, 20, 10, 255])
})
