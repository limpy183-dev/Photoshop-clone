import { expect, test } from "@playwright/test"

import {
  analyzeContentAwareScale,
  buildEdgeAwareQuickSelectionMaskData,
} from "../components/photoshop/algorithmic-operations"
import {
  compositeFilterImageData,
  getFilter,
} from "../components/photoshop/filters"
import {
  applyFilterAsync,
  getFilterWorkerSupport,
  isFilterWorkerSupported,
} from "../components/photoshop/filter-worker"
import {
  sampleImageDataBilinear,
} from "../components/photoshop/warp-transform"

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
  ]

  for (const [filterId, params] of cases) {
    const filter = getFilter(filterId)
    expect(filter).toBeTruthy()
    const expected = filter!.apply(src, params)
    const actual = await applyFilterAsync(filterId, src, params)
    expect(Array.from(actual.data)).toEqual(Array.from(expected.data))
  }
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

test("warp transform bilinear sampling interpolates source pixels", () => {
  const src = imageData(2, 1, [
    0, 0, 0, 255,
    100, 40, 20, 255,
  ])

  expect(sampleImageDataBilinear(src, 0.5, 0)).toEqual([50, 20, 10, 255])
})
