import { expect, test } from "@playwright/test"

import {
  estimateHistoryMemoryBudget,
  planBrushStrokeBenchmark,
  planLargeCanvasBenchmark,
  planMergeWorkflowTiling,
} from "../components/photoshop/performance-engine"
import {
  applyFilterAsync,
  planExpensiveFilterTiling,
  planWorkerFallback,
} from "../components/photoshop/filter-worker"

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

function imageData(width: number, height: number, rgba: number[]) {
  return new ImageData(new Uint8ClampedArray(rgba), width, height)
}

test("large-canvas benchmark summary uses deterministic pixels, tiles, and memory budgets", () => {
  const summary = planLargeCanvasBenchmark({
    width: 12000,
    height: 8000,
    layerCount: 6,
    tileSize: 512,
    memoryBudgetMB: 1024,
  })

  expect(summary.pixelCount).toBe(96_000_000)
  expect(summary.megapixels).toBe(96)
  expect(summary.tileColumns).toBe(24)
  expect(summary.tileRows).toBe(16)
  expect(summary.tileCount).toBe(384)
  expect(summary.bytesPerLayer).toBe(384_000_000)
  expect(summary.estimatedWorkingSetMB).toBeGreaterThan(1024)
  expect(summary.strategy).toBe("tiled")
  expect(summary.warnings).toEqual(expect.arrayContaining([expect.stringContaining("memory budget")]))
})

test("brush stroke benchmark plan estimates dabs, affected bounds, and patch budget pressure", () => {
  const plan = planBrushStrokeBenchmark({
    canvasWidth: 4096,
    canvasHeight: 4096,
    start: { x: 64, y: 128 },
    end: { x: 4032, y: 3840 },
    brushSize: 96,
    spacingPercent: 25,
  })

  expect(plan.dabCount).toBe(228)
  expect(plan.dabSpacingPx).toBe(24)
  expect(plan.affectedBounds).toEqual({ x: 16, y: 80, w: 4064, h: 3808 })
  expect(plan.affectedPixels).toBe(15_475_712)
  expect(plan.patchAreaRatio).toBeCloseTo(0.9224, 4)
  expect(plan.historyRecommendation).toBe("full-snapshot")
  expect(plan.warnings).toEqual(expect.arrayContaining([expect.stringContaining("patch budget")]))
})

test("history memory budget warns before patch chains exceed configured budgets", () => {
  const budget = estimateHistoryMemoryBudget({
    width: 6000,
    height: 4000,
    layerCount: 5,
    historyStates: 40,
    averageChangedLayerRatio: 0.12,
    memoryBudgetMB: 768,
  })

  expect(budget.fullSnapshotMB).toBe(458)
  expect(budget.projectedHistoryMB).toBe(2197)
  expect(budget.maxPatchAreaRatio).toBe(0.42)
  expect(budget.maxPatchesPerLayer).toBe(24)
  expect(budget.status).toBe("over-budget")
  expect(budget.warnings).toEqual(expect.arrayContaining([expect.stringContaining("history memory")]))
})

test("worker fallback plan and applyFilterAsync use registry fallback after worker failure", async () => {
  const fallback = planWorkerFallback({
    filterId: "invert",
    workerAvailable: true,
    workerSupported: true,
    workerFailed: true,
  })

  expect(fallback.strategy).toBe("main-thread-fallback")
  expect(fallback.reason).toBe("worker-failed")
  expect(fallback.retryWorker).toBe(false)

  const src = imageData(1, 1, [10, 20, 30, 255])
  const result = await applyFilterAsync("invert", src, {}, {
    workerExecutor: () => Promise.reject(new Error("boom")),
  })

  expect(Array.from(result.data)).toEqual([245, 235, 225, 255])
})

test("expensive filters and merge workflows get tiled plans with overlap and yields", () => {
  const blur = planExpensiveFilterTiling("gaussian-blur", 4096, 2048, { radius: 18 }, { tileSize: 512 })
  const merge = planMergeWorkflowTiling({
    width: 8192,
    height: 4096,
    layerCount: 12,
    tileSize: 1024,
  })

  expect(blur.strategy).toBe("tiled-worker-preferred")
  expect(blur.overlap).toBe(18)
  expect(blur.tileCount).toBe(32)
  expect(blur.yieldEveryTiles).toBe(4)

  expect(merge.strategy).toBe("tiled-merge")
  expect(merge.tileCount).toBe(32)
  expect(merge.estimatedCompositeOps).toBe(384)
  expect(merge.memoryPeakMB).toBeLessThan(merge.fullFrameWorkingSetMB)
})
