import { expect, test } from "@playwright/test"

import {
  planIncrementalAutosave,
  planAutosaveDocuments,
} from "../components/photoshop/autosave-planner"
import {
  canUseOffscreenCanvas,
  planCanvasSurface,
} from "../components/photoshop/offscreen-canvas"
import {
  dirtyRectToTileKeys,
  planTiledBackingStore,
} from "../components/photoshop/tiled-backing-store"
import {
  planMemoryBudget,
} from "../components/photoshop/memory-budget"
import {
  planProgressiveRender,
} from "../components/photoshop/progressive-renderer"
import {
  planRasterExportExecution,
} from "../components/photoshop/export-worker"
import {
  getFilterWorkerSupport,
  isFilterWorkerSupported,
} from "../components/photoshop/filter-worker"

test("offscreen canvas policy prefers detached worker surfaces and falls back for DOM canvases", () => {
  expect(canUseOffscreenCanvas({ OffscreenCanvasCtor: undefined })).toBe(false)
  expect(canUseOffscreenCanvas({ OffscreenCanvasCtor: class FakeOffscreenCanvas {} })).toBe(true)

  expect(planCanvasSurface({
    width: 4096,
    height: 2048,
    purpose: "export",
    offscreenSupported: true,
    workerContext: true,
  })).toEqual({
    kind: "offscreen",
    reason: "worker-export",
    width: 4096,
    height: 2048,
    pixelCount: 8_388_608,
  })

  expect(planCanvasSurface({
    width: 1200,
    height: 800,
    purpose: "layer",
    offscreenSupported: true,
    workerContext: false,
  })).toMatchObject({
    kind: "html",
    reason: "dom-layer-compatibility",
  })
})

test("incremental autosave plans only changed documents and routes large snapshots to scratch", () => {
  const unchanged = planAutosaveDocuments({
    documents: [
      { id: "clean", name: "Clean", version: 3, dirty: false },
      { id: "dirty-same", name: "Dirty same", version: 7, dirty: true },
      { id: "dirty-next", name: "Dirty next", version: 8, dirty: true },
    ],
    lastSavedVersions: { clean: 3, "dirty-same": 7, "dirty-next": 4 },
  })

  expect(unchanged.documentsToSerialize.map((doc) => doc.id)).toEqual(["dirty-next"])

  const incremental = planIncrementalAutosave({
    documents: [
      {
        id: "doc-a",
        name: "A",
        version: 5,
        dirty: true,
        serializedLength: 7_000_000,
        changedLayerIds: ["layer-1"],
      },
      {
        id: "doc-b",
        name: "B",
        version: 2,
        dirty: false,
        serializedLength: 32_000,
      },
    ],
    previousManifest: {
      entries: {
        "doc-a": { version: 4, storage: "inline", bytes: 120_000, changedLayerIds: ["layer-0"] },
        "closed-doc": { version: 9, storage: "scratch", bytes: 900_000 },
      },
    },
    maxInlineChars: 5_000_000,
  })

  expect(incremental.documentsToWrite).toEqual([
    {
      id: "doc-a",
      name: "A",
      version: 5,
      storage: "scratch",
      serializedLength: 7_000_000,
      changedLayerIds: ["layer-1"],
    },
    {
      id: "doc-b",
      name: "B",
      version: 2,
      storage: "inline",
      serializedLength: 32_000,
      changedLayerIds: undefined,
    },
  ])
  expect(incremental.prunedDocumentIds).toEqual(["closed-doc"])
  expect(incremental.nextManifest.entries["doc-a"]).toMatchObject({
    version: 5,
    storage: "scratch",
    bytes: 7_000_000,
  })
  expect(incremental.nextManifest.entries["closed-doc"]).toBeUndefined()
})

test("tiled backing store maps dirty rects and memory pressure deterministically", () => {
  const resident = planTiledBackingStore({
    width: 2048,
    height: 1024,
    tileSize: 512,
    memoryBudgetMB: 16,
  })

  expect(resident).toMatchObject({
    tileColumns: 4,
    tileRows: 2,
    tileCount: 8,
    tileBytes: 1_048_576,
    totalBytes: 8_388_608,
    strategy: "resident",
  })
  expect(dirtyRectToTileKeys({ x: 500, y: 500, w: 40, h: 40 }, resident)).toEqual([
    "0:0",
    "1:0",
    "0:1",
    "1:1",
  ])

  expect(planTiledBackingStore({
    width: 8192,
    height: 8192,
    tileSize: 1024,
    memoryBudgetMB: 96,
  })).toMatchObject({
    tileCount: 64,
    strategy: "spill-to-opfs",
  })
})

test("memory budget enforcement chooses bounded actions before rejecting work", () => {
  expect(planMemoryBudget({
    width: 8192,
    height: 4096,
    layerCount: 10,
    historyStates: 32,
    memoryBudgetMB: 768,
  })).toMatchObject({
    status: "over-budget",
    actions: [
      "disable-composite-cache",
      "use-tiled-backing-store",
      "compress-history",
      "spill-scratch-to-opfs",
    ],
  })

  expect(planMemoryBudget({
    width: 1200,
    height: 800,
    layerCount: 4,
    historyStates: 8,
    memoryBudgetMB: 768,
  })).toMatchObject({
    status: "within-budget",
    actions: [],
  })
})

test("progressive renderer plans preview scale and tile order for large documents", () => {
  const plan = planProgressiveRender({
    width: 6000,
    height: 4000,
    viewport: { x: 1200, y: 800, w: 1600, h: 1200 },
    dirtyRects: [{ x: 1000, y: 700, w: 900, h: 700 }],
    tileSize: 512,
  })

  expect(plan.previewScale).toBe(0.25)
  expect(plan.mode).toBe("preview-then-full")
  expect(plan.tileKeys[0]).toBe("1:1")
  expect(plan.fullResolutionDelayMs).toBeGreaterThan(0)
})

test("raster export planner uses worker/offscreen encoding for large supported exports", () => {
  expect(planRasterExportExecution({
    width: 4096,
    height: 4096,
    format: "webp",
    scale: 1,
    workerSupported: true,
    offscreenSupported: true,
  })).toEqual({
    mode: "worker-offscreen",
    reason: "large-supported-export",
    outputWidth: 4096,
    outputHeight: 4096,
    pixelCount: 16_777_216,
  })

  expect(planRasterExportExecution({
    width: 640,
    height: 480,
    format: "png",
    scale: 1,
    workerSupported: true,
    offscreenSupported: true,
  })).toMatchObject({
    mode: "main-thread",
    reason: "small-export",
  })
})

test("expensive blur and paint filters advertise worker support", () => {
  expect(isFilterWorkerSupported("lens-blur")).toBe(true)
  expect(isFilterWorkerSupported("surface-blur")).toBe(true)
  expect(isFilterWorkerSupported("oil-paint")).toBe(true)
  expect(getFilterWorkerSupport().supportedFilters).toEqual(expect.arrayContaining([
    "lens-blur",
    "surface-blur",
    "oil-paint",
  ]))
})
