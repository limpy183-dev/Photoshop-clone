import { expect, test } from "@playwright/test"

import {
  TiledBackingStore,
  createLayerTileAddress,
} from "../components/photoshop/tiled-backing-store"
import {
  createProgressiveTileRefiner,
} from "../components/photoshop/progressive-renderer"
import {
  downsampleImageData,
} from "../components/photoshop/progressive-preview"
import {
  adaptiveDirtyRedrawThreshold,
  planLayerDirtyRects,
} from "../components/photoshop/dirty-rect"
import {
  MemoryBudgetTracker,
  createHeapMemoryMonitor,
  formatMemoryUsage,
} from "../components/photoshop/memory-budget"
import {
  compactIncrementalAutosaveChain,
  compressAutosaveDelta,
  mergeNearIdenticalDeltas,
  scheduleIncrementalAutosaveCompaction,
  type IncrementalAutosaveBase,
  type IncrementalAutosaveDelta,
} from "../components/photoshop/autosave-incremental"
import {
  diagnoseOffscreenCanvasTransfer,
} from "../components/photoshop/offscreen-canvas"
import {
  acquirePooledCanvas,
  cleanupIdleCanvases,
  getCanvasPoolStats,
  releasePooledCanvas,
  resetCanvasPoolForTests,
} from "../components/photoshop/canvas-utils"
import {
  isWebGLBlendModeCompatible,
  planGpuFilterChain,
  planWebGLCompositor,
} from "../components/photoshop/webgl-compositor"
import {
  createRafScheduler,
} from "../components/photoshop/raf-coalescer"
import { installFixtureDom } from "./photoshop-fixtures"

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

const MIB = 1024 * 1024

test("tile store caches smart object and 3D layer tiles by source version and camera", async () => {
  const store = new TiledBackingStore({ width: 1024, height: 1024, tileSize: 512, memoryBudgetMB: 64 })
  let smartRenders = 0
  const smartTile = createLayerTileAddress({
    layerId: "smart-1",
    layerKind: "smart-object",
    col: 0,
    row: 0,
    sourceVersion: "v1",
  })

  const first = await store.getOrRenderLayerTile(smartTile, async () => {
    smartRenders += 1
    return new Blob(["smart-v1"])
  })
  const second = await store.getOrRenderLayerTile(smartTile, async () => {
    smartRenders += 1
    return new Blob(["stale"])
  })

  expect(await first.text()).toBe("smart-v1")
  expect(await second.text()).toBe("smart-v1")
  expect(smartRenders).toBe(1)

  const dirtied = store.invalidateLayerTiles({
    layerId: "smart-1",
    layerKind: "smart-object",
    rect: { x: 0, y: 0, w: 256, h: 256 },
    reason: "source-changed",
  })
  expect(dirtied).toEqual([smartTile.key])

  const updated = await store.getOrRenderLayerTile({ ...smartTile, sourceVersion: "v2" }, async () => {
    smartRenders += 1
    return new Blob(["smart-v2"])
  })
  expect(await updated.text()).toBe("smart-v2")
  expect(smartRenders).toBe(2)

  let threeDRenders = 0
  const cameraA = createLayerTileAddress({
    layerId: "scene-1",
    layerKind: "3d",
    col: 1,
    row: 0,
    cameraKey: "front",
  })
  const cameraB = createLayerTileAddress({
    layerId: "scene-1",
    layerKind: "3d",
    col: 1,
    row: 0,
    cameraKey: "side",
  })
  await store.getOrRenderLayerTile(cameraA, async () => {
    threeDRenders += 1
    return new Blob(["front"])
  })
  await store.getOrRenderLayerTile(cameraA, async () => {
    threeDRenders += 1
    return new Blob(["front-again"])
  })
  await store.getOrRenderLayerTile(cameraB, async () => {
    threeDRenders += 1
    return new Blob(["side"])
  })
  expect(threeDRenders).toBe(2)
})

test("progressive preview uses bilinear downsampling and cancels stale tile refinement frames", () => {
  const src = new ImageData(
    new Uint8ClampedArray([
      0, 0, 0, 255,
      100, 0, 0, 255,
      150, 0, 0, 255,
      250, 0, 0, 255,
    ]),
    2,
    2,
  )

  const downsampled = downsampleImageData(src, 0.5)
  expect(downsampled.width).toBe(1)
  expect(downsampled.height).toBe(1)
  expect(downsampled.data[0]).toBe(125)

  const scheduled: FrameRequestCallback[] = []
  const cancelled: number[] = []
  const rendered: string[] = []
  const refiner = createProgressiveTileRefiner({
    tileKeys: ["0:0", "1:0"],
    renderTile: (tileKey) => {
      rendered.push(tileKey)
    },
    requestFrame: (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    cancelFrame: (id) => cancelled.push(id),
  })

  refiner.start()
  refiner.start(["2:0"])
  expect(cancelled).toEqual([1])

  scheduled[0](16)
  scheduled[1](32)
  expect(rendered).toEqual(["2:0"])
})

test("dirty rect planner keeps layer-local redraws until adaptive coverage crosses threshold", () => {
  const small = planLayerDirtyRects({
    bounds: { width: 4096, height: 4096 },
    dirtyByLayer: {
      "layer-a": [{ x: 16, y: 20, w: 256, h: 200 }],
    },
  })

  expect(small.fullFrame).toBe(false)
  expect(small.strategy).toBe("layer-isolated")
  expect(small.layers["layer-a"].partial).toBe(true)
  expect(small.compositeRect).toEqual({ x: 16, y: 20, w: 256, h: 200 })

  const largeThreshold = adaptiveDirtyRedrawThreshold({ width: 12000, height: 8000 })
  const smallThreshold = adaptiveDirtyRedrawThreshold({ width: 1200, height: 800 })
  expect(largeThreshold).toBeLessThan(smallThreshold)

  const promoted = planLayerDirtyRects({
    bounds: { width: 12000, height: 8000 },
    dirtyByLayer: {
      "layer-a": [{ x: 0, y: 0, w: 9000, h: 7000 }],
    },
  })
  expect(promoted.fullFrame).toBe(true)
  expect(promoted.strategy).toBe("full-frame")
})

test("heap monitor cross-references browser heap usage and detects GC pressure drops", () => {
  const tracker = new MemoryBudgetTracker({ budgetMB: 128 })
  tracker.commit({ id: "tiles", category: "tile-cache", bytes: 32 * MIB })
  const perf = {
    memory: {
      usedJSHeapSize: 96 * MIB,
      totalJSHeapSize: 120 * MIB,
      jsHeapSizeLimit: 256 * MIB,
    },
  }
  const monitor = createHeapMemoryMonitor({ tracker, performance: perf as unknown as Performance, now: () => 1 })

  const first = monitor.sample()
  expect(first.supported).toBe(true)
  expect(first.declaredBytes).toBe(32 * MIB)
  expect(first.usedJSHeapSize).toBe(96 * MIB)
  expect(first.discrepancyBytes).toBe(64 * MIB)

  perf.memory.usedJSHeapSize = 44 * MIB
  const second = monitor.sample()
  expect(second.gcDetected).toBe(true)
  expect(second.recommendedEvictBytes).toBeGreaterThan(0)
  expect(formatMemoryUsage(second)).toContain("Heap 44.0 MB")
})

test("incremental autosave compacts near-identical deltas and schedules idle work", async () => {
  const base: IncrementalAutosaveBase = {
    documentId: "doc",
    documentVersion: 1,
    createdAt: 1,
    layers: [{ id: "layer", version: 1, fingerprint: "a", serialized: "abcdef" }],
  }
  const deltas: IncrementalAutosaveDelta[] = [
    {
      documentId: "doc",
      documentVersion: 2,
      baseVersion: 1,
      baseSequence: 0,
      sequence: 1,
      createdAt: 2,
      changedLayers: [{ id: "layer", version: 2, fingerprint: "b", serialized: "abcdef!" }],
      removedLayerIds: [],
    },
    {
      documentId: "doc",
      documentVersion: 3,
      baseVersion: 1,
      baseSequence: 0,
      sequence: 2,
      createdAt: 3,
      changedLayers: [{ id: "layer", version: 3, fingerprint: "c", serialized: "abcdef!!" }],
      removedLayerIds: [],
    },
  ]

  const merged = mergeNearIdenticalDeltas(deltas, { similarityThreshold: 0.8 })
  expect(merged).toHaveLength(1)
  expect(merged[0].sequence).toBe(2)

  const compacted = compactIncrementalAutosaveChain(base, deltas, { maxDeltas: 1, similarityThreshold: 0.8 })
  expect(compacted.compacted).toBe(true)
  expect(compacted.base.documentVersion).toBe(3)
  expect(compacted.base.layers[0].serialized).toBe("abcdef!!")
  expect(compacted.deltas).toEqual([])

  const blob = await compressAutosaveDelta(deltas[0])
  expect(blob.size).toBeGreaterThan(0)

  const scheduled: IdleRequestCallback[] = []
  const cancelers: number[] = []
  const handle = scheduleIncrementalAutosaveCompaction(
    async () => "compacted",
    {
      requestIdle: (callback) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancelIdle: (id) => cancelers.push(id),
    },
  )
  expect(scheduled).toHaveLength(1)
  scheduled[0]({ didTimeout: false, timeRemaining: () => 20 })
  expect(await handle.result).toBe("compacted")
  handle.cancel()
  expect(cancelers).toEqual([])
})

test("offscreen diagnostics explain worker fallback", () => {
  expect(diagnoseOffscreenCanvasTransfer({
    requestedWorker: true,
    offscreenCanvasSupported: true,
    workerTransferSupported: false,
    transferToImageBitmapSupported: true,
  })).toMatchObject({
    active: false,
    reason: "worker-transfer-api-missing",
    badge: "Canvas fallback",
  })

  expect(diagnoseOffscreenCanvasTransfer({
    requestedWorker: true,
    offscreenCanvasSupported: true,
    workerTransferSupported: true,
    transferToImageBitmapSupported: true,
  })).toMatchObject({
    active: true,
    reason: "worker-offscreen-active",
  })
})

test("canvas pool uses size buckets, tracks hit rate, and cleans idle oversized surfaces", () => {
  installFixtureDom()
  resetCanvasPoolForTests()

  const first = acquirePooledCanvas(64, 64)
  releasePooledCanvas(first, 10)
  const second = acquirePooledCanvas(64, 64)
  expect(second).toBe(first)

  const large = acquirePooledCanvas(4096, 4096)
  releasePooledCanvas(large, 10)
  const evicted = cleanupIdleCanvases({ now: 10_000, maxIdleMs: 1000, oversizedArea: 4_000_000 })
  expect(evicted).toBe(1)

  const stats = getCanvasPoolStats()
  expect(stats.byBucket.small.hits).toBe(1)
  expect(stats.byBucket.large.evictions).toBe(1)
  expect(stats.hitRate).toBeGreaterThan(0)
})

test("WebGL compositor planner selects GPU paths for large compatible documents", () => {
  expect(isWebGLBlendModeCompatible("normal")).toBe(true)
  expect(isWebGLBlendModeCompatible("hue")).toBe(false)

  expect(planWebGLCompositor({
    width: 12000,
    height: 9000,
    layerCount: 8,
    preferWebGL: true,
    webglAvailable: true,
    maxTextureSize: 8192,
  })).toMatchObject({
    path: "tiled-webgl",
    reason: "exceeds-max-texture-size",
    tileSize: 8192,
  })

  expect(planGpuFilterChain(["brightness-contrast", "gaussian-blur"], { webglAvailable: true })).toEqual({
    mode: "mixed",
    compatibleFilters: ["brightness-contrast"],
    cpuFilters: ["gaussian-blur"],
  })
})

test("priority RAF scheduler coalesces filter previews and skips low priority work over budget", () => {
  const callbacks: FrameRequestCallback[] = []
  const emitted: string[] = []
  let now = 0
  const scheduler = createRafScheduler<string>({
    emit: (value) => {
      emitted.push(value)
      now += value === "input" ? 4 : 10
    },
    now: () => now,
    frameBudgetMs: 12,
    requestFrame: (callback) => {
      callbacks.push(callback)
      return callbacks.length
    },
  })

  scheduler.schedule("preview-1", { priority: "medium", key: "filter-preview" })
  scheduler.schedule("preview-2", { priority: "medium", key: "filter-preview" })
  scheduler.schedule("ui", { priority: "low" })
  scheduler.schedule("input", { priority: "high" })

  callbacks[0](16)
  expect(emitted).toEqual(["input", "preview-2"])
  expect(scheduler.stats().skippedLowPriority).toBe(1)
})
