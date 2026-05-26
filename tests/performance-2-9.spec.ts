import { expect, test } from "@playwright/test"

import {
  TiledBackingStore,
  createLayerTileAddress,
} from "../components/photoshop/tiled-backing-store"
import {
  layerTileAddressForLayer,
  materializeLayerContentCanvas,
  planDocumentTileRecomposition,
  planLayerTileRender,
  renderLayerContentTile,
  renderLayerTileForBackingStore,
  renderThreeDLayerTilePreview,
  renderTileCanvas,
} from "../components/photoshop/layer-tile-renderer"
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
  planRuntimeMemoryPressure,
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
  getWebGLLayerCapability,
  isWebGLBlendModeCompatible,
  planGpuFilterChain,
  planWebGLLayerStack,
  planWebGLCompositor,
} from "../components/photoshop/webgl-compositor"
import {
  createRafScheduler,
} from "../components/photoshop/raf-coalescer"
import type { BlendMode, Layer, PsDocument } from "../components/photoshop/types"
import { fixtureCanvas, fixtureMask, installFixtureDom } from "./photoshop-fixtures"

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

test("layer tile renderer keys smart objects by source changes and editable layer metadata", () => {
  installFixtureDom()
  const smartSourceCanvas = document.createElement("canvas")
  smartSourceCanvas.width = 96
  smartSourceCanvas.height = 48
  const smartCanvas = document.createElement("canvas")
  smartCanvas.width = 192
  smartCanvas.height = 96
  const smartLayer = {
    id: "smart-layer",
    name: "Linked Product",
    kind: "smart-object",
    smartObject: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: smartCanvas,
    smartSource: {
      id: "source-a",
      name: "source-a.png",
      linkType: "linked",
      embedded: true,
      status: "current",
      width: 96,
      height: 48,
      updatedAt: 10,
      sourceHash: "hash-a",
      canvas: smartSourceCanvas,
    },
  } satisfies Layer

  const first = layerTileAddressForLayer(smartLayer, { col: 0, row: 0, tileSize: 64, documentWidth: 192, documentHeight: 96 })
  const second = layerTileAddressForLayer(
    {
      ...smartLayer,
      smartSource: {
        ...smartLayer.smartSource!,
        updatedAt: 20,
        sourceHash: "hash-b",
      },
    },
    { col: 0, row: 0, tileSize: 64, documentWidth: 192, documentHeight: 96 },
  )

  expect(first.layerKind).toBe("smart-object")
  expect(first.sourceVersion).toContain("hash-a")
  expect(second.sourceVersion).toContain("hash-b")
  expect(second.key).not.toBe(first.key)

  const textCanvas = document.createElement("canvas")
  textCanvas.width = 192
  textCanvas.height = 96
  const textLayer = {
    ...smartLayer,
    id: "text-layer",
    name: "Headline",
    kind: "text",
    smartObject: false,
    smartSource: undefined,
    canvas: textCanvas,
    text: {
      content: "Sale",
      font: "Arial",
      size: 32,
      weight: "bold",
      italic: false,
      color: "#111111",
      align: "center",
      x: 20,
      y: 42,
    },
  } satisfies Layer
  const textPlan = planLayerTileRender(textLayer, { col: 1, row: 0, tileSize: 64, documentWidth: 192, documentHeight: 96 })
  expect(textPlan.cacheable).toBe(true)
  expect(textPlan.address.layerKind).toBe("text")
  expect(textPlan.dependencies.join("|")).toContain("Sale")

  const pathLayer = {
    ...textLayer,
    id: "vector-layer",
    kind: "shape",
    text: undefined,
    shape: { type: "rect", x: 8, y: 8, w: 48, h: 32, fill: "#00aaee", stroke: { color: "#111111", width: 2 } },
    path: { closed: true, points: [{ x: 8, y: 8 }, { x: 56, y: 8 }, { x: 56, y: 40 }, { x: 8, y: 40 }] },
  } satisfies Layer
  const vectorPlan = planLayerTileRender(pathLayer, { col: 0, row: 0, tileSize: 64, documentWidth: 192, documentHeight: 96 })
  expect(vectorPlan.address.layerKind).toBe("vector")
  expect(vectorPlan.dependencies.join("|")).toContain("rect")
})

test("smart object tile keys include filter stack changes and content tiles render filtered sources", () => {
  installFixtureDom()
  const solidCanvas = (width: number, height: number, fill: string) => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, width, height)
    return canvas
  }
  const smartSourceCanvas = solidCanvas(96, 48, "#000000")
  const smartCanvas = solidCanvas(192, 96, "#000000")
  const smartLayer = {
    id: "smart-filtered",
    name: "Filtered Smart",
    kind: "smart-object",
    smartObject: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: smartCanvas,
    smartSource: {
      id: "source-filtered",
      name: "source.png",
      linkType: "linked",
      embedded: true,
      status: "current",
      width: 96,
      height: 48,
      updatedAt: 10,
      sourceHash: "hash-a",
      canvas: smartSourceCanvas,
    },
    smartFilters: [
      { id: "sf", filterId: "invert", name: "Invert", enabled: true, params: {} },
    ],
  } satisfies Layer

  const ref = { col: 0, row: 0, tileSize: 64, documentWidth: 192, documentHeight: 96 }
  const first = planLayerTileRender(smartLayer, ref)
  const second = planLayerTileRender({
    ...smartLayer,
    smartFilters: [
      { id: "sf", filterId: "invert", name: "Invert", enabled: false, params: {} },
    ],
  }, ref)
  const tile = renderLayerContentTile(smartLayer, first.rect)
  const pixel = tile.getContext("2d")!.getImageData(2, 2, 1, 1).data

  expect(first.contentSource).toBe("smart-source")
  expect(first.dependencies.join("|")).toContain("smartFilters")
  expect(second.address.key).not.toBe(first.address.key)
  expect(tile.width).toBe(64)
  expect(tile.height).toBe(64)
  expect(Array.from(pixel.slice(0, 4))).toEqual([255, 255, 255, 255])
})

test("3D layer tile previews render only the requested tile and cache by camera", () => {
  const scene = {
    objects: [
      {
        id: "obj",
        name: "Triangle",
        vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [{ indices: [0, 1, 2], materialId: "mat" }],
        materialId: "mat",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    materials: [{ id: "mat", name: "Red", color: "#ff0000", roughness: 0.5, metallic: 0, opacity: 1 }],
    lights: [],
    camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 42, focalLength: 50 },
    renderMode: "solid" as const,
  } satisfies NonNullable<Layer["threeD"]>
  const layer = {
    id: "three-d-layer",
    name: "Scene",
    kind: "3d",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: {} as HTMLCanvasElement,
    threeD: scene,
  } satisfies Layer

  const address = layerTileAddressForLayer(layer, { col: 1, row: 0, tileSize: 16, documentWidth: 32, documentHeight: 16 })
  const preview = renderThreeDLayerTilePreview(layer, { x: 16, y: 0, w: 16, h: 16 }, { width: 32, height: 16 })
  expect(address.layerKind).toBe("3d")
  expect(address.cameraKey).toContain("fov:42")
  expect(preview.width).toBe(16)
  expect(preview.height).toBe(16)
  expect(preview.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
})

test("3D layer content tiles render from scene metadata instead of full-frame raster previews", () => {
  const scene = {
    objects: [
      {
        id: "obj",
        name: "Triangle",
        vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [{ indices: [0, 1, 2], materialId: "mat" }],
        materialId: "mat",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    materials: [{ id: "mat", name: "Red", color: "#ff0000", roughness: 0.5, metallic: 0, opacity: 1 }],
    lights: [],
    camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 42, focalLength: 50 },
    renderMode: "solid" as const,
  } satisfies NonNullable<Layer["threeD"]>
  const layer = {
    id: "three-d-layer",
    name: "Scene",
    kind: "3d",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(32, 16, "#000000"),
    threeD: scene,
  } satisfies Layer
  const tile = renderLayerContentTile(layer, { x: 16, y: 0, w: 16, h: 16 }, { width: 32, height: 16 })
  const image = tile.getContext("2d")!.getImageData(0, 0, 16, 16)

  expect(tile.width).toBe(16)
  expect(tile.height).toBe(16)
  expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
})

test("3D layer materialization produces a concrete full-size preview canvas", () => {
  installFixtureDom()
  const scene = {
    objects: [
      {
        id: "obj",
        name: "Triangle",
        vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [{ indices: [0, 1, 2], materialId: "mat" }],
        materialId: "mat",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    materials: [{ id: "mat", name: "Red", color: "#ff0000", roughness: 0.5, metallic: 0, opacity: 1 }],
    lights: [],
    camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 42, focalLength: 50 },
    renderMode: "solid" as const,
  } satisfies NonNullable<Layer["threeD"]>
  const layer = {
    id: "three-d-materialized",
    name: "Scene",
    kind: "3d",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(32, 24),
    threeD: scene,
  } satisfies Layer

  const preview = materializeLayerContentCanvas(layer, { documentSize: { width: 32, height: 24 } })
  const image = preview.getContext("2d")!.getImageData(0, 0, 32, 24)

  expect(preview.width).toBe(32)
  expect(preview.height).toBe(24)
  expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
})

test("smart object and 3D layer tiles materialize through the backing store cache", async () => {
  installFixtureDom()
  const store = new TiledBackingStore({ width: 128, height: 96, tileSize: 64, memoryBudgetMB: 4 })
  const source = fixtureCanvas(256, 192, "#aa6633")
  const smartCanvas = fixtureCanvas(128, 96, "#3355aa")
  const smartLayer = {
    id: "smart-materialized",
    name: "Placed Source",
    kind: "smart-object",
    smartObject: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: smartCanvas,
    smartSource: {
      id: "source",
      name: "source.png",
      linkType: "embedded",
      embedded: true,
      status: "current",
      width: 256,
      height: 192,
      sourceHash: "v1",
      canvas: source,
    },
  } satisfies Layer

  const encoded: string[] = []
  const codec = {
    encodeCanvas: async (canvas: HTMLCanvasElement, plan: ReturnType<typeof planLayerTileRender>) => {
      encoded.push(plan.address.key)
      return new Blob([`${canvas.width}x${canvas.height}`])
    },
    decodeCanvas: async (blob: Blob) => {
      const [width, height] = (await blob.text()).split("x").map(Number)
      return fixtureCanvas(width, height, "#ffcc00")
    },
  }
  const first = await renderLayerTileForBackingStore(store, smartLayer, {
    col: 1,
    row: 0,
    tileSize: 64,
    documentWidth: 128,
    documentHeight: 96,
  }, codec)
  const second = await renderLayerTileForBackingStore(store, smartLayer, {
    col: 1,
    row: 0,
    tileSize: 64,
    documentWidth: 128,
    documentHeight: 96,
  }, codec)

  expect(first.width).toBe(64)
  expect(first.height).toBe(64)
  expect(second.width).toBe(64)
  expect(encoded).toHaveLength(1)

  const sceneLayer = {
    id: "scene-materialized",
    name: "Scene",
    kind: "3d",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(128, 96),
    threeD: {
      objects: [
        {
          id: "obj",
          name: "Triangle",
          vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
          faces: [{ indices: [0, 1, 2], materialId: "mat" }],
          materialId: "mat",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
      materials: [{ id: "mat", name: "Red", color: "#ff0000", roughness: 0.5, metallic: 0, opacity: 1 }],
      lights: [],
      camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 42, focalLength: 50 },
      renderMode: "solid",
    },
  } satisfies Layer
  const threeDTile = await renderLayerTileForBackingStore(store, sceneLayer, {
    col: 0,
    row: 1,
    tileSize: 64,
    documentWidth: 128,
    documentHeight: 96,
  }, {
    encodeCanvas: async (canvas) => new Blob([`${canvas.width}x${canvas.height}`]),
    decodeCanvas: async (blob) => {
      const [width, height] = (await blob.text()).split("x").map(Number)
      return fixtureCanvas(width, height, "#ff0000")
    },
  })
  expect(threeDTile.width).toBe(64)
  expect(threeDTile.height).toBe(32)
})

test("document tile recomposition stays layer-isolated with masks, effects, adjustments, and clipping", () => {
  installFixtureDom()
  const baseCanvas = document.createElement("canvas")
  baseCanvas.width = 128
  baseCanvas.height = 96
  const mask = document.createElement("canvas")
  mask.width = 128
  mask.height = 96
  const clippedCanvas = document.createElement("canvas")
  clippedCanvas.width = 128
  clippedCanvas.height = 96
  const adjustmentCanvas = document.createElement("canvas")
  adjustmentCanvas.width = 128
  adjustmentCanvas.height = 96
  const layers: Layer[] = [
    {
      id: "base",
      name: "Masked Base",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      fillOpacity: 1,
      blendMode: "normal",
      canvas: baseCanvas,
      mask,
      maskEnabled: true,
      style: { dropShadow: { enabled: true, color: "#000000", size: 4, offsetX: 2, offsetY: 2, opacity: 0.5 } },
    },
    {
      id: "clipped",
      name: "Clipped Texture",
      kind: "shape",
      visible: true,
      locked: false,
      opacity: 0.75,
      fillOpacity: 1,
      blendMode: "multiply",
      canvas: clippedCanvas,
      clipped: true,
      shape: { type: "rect", x: 0, y: 0, w: 128, h: 96, fill: "#4466ee", stroke: null },
    },
    {
      id: "adjustment",
      name: "Brightness",
      kind: "adjustment",
      visible: true,
      locked: false,
      opacity: 1,
      fillOpacity: 1,
      blendMode: "normal",
      canvas: adjustmentCanvas,
      clipped: true,
      mask,
      adjustment: { type: "brightness-contrast", params: { brightness: 12, contrast: 0 } },
    },
  ]
  const doc = {
    id: "doc",
    name: "Doc",
    width: 128,
    height: 96,
    zoom: 1,
    layers,
    activeLayerId: "base",
    selectedLayerIds: ["base"],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
  } satisfies PsDocument

  const plan = planDocumentTileRecomposition(doc, {
    dirtyByLayer: { base: [{ x: 8, y: 8, w: 32, h: 24 }] },
    tileSize: 32,
  })
  expect(plan.strategy).toBe("tile-isolated")
  expect(plan.tiles.map((tile) => tile.key)).toEqual(["0:0", "1:0"])
  expect(plan.layersNeedingRecomposition).toEqual(["base", "clipped", "adjustment"])
  expect(plan.reasons).toEqual(expect.arrayContaining(["mask", "effects", "adjustment", "clipping-group"]))
})

test("renderTileCanvas crops non-raster layer pixels to stable tile dimensions", () => {
  installFixtureDom()
  const source = document.createElement("canvas")
  source.width = 96
  source.height = 64
  const tile = renderTileCanvas(source, { x: 32, y: 16, w: 48, h: 32 })
  expect(tile.width).toBe(48)
  expect(tile.height).toBe(32)
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

test("runtime memory pressure uses observed heap usage when it exceeds declared allocations", () => {
  const plan = planRuntimeMemoryPressure({
    budgetMB: 1024,
    declaredBytes: 128 * MIB,
    usedJSHeapSize: 990 * MIB,
    jsHeapSizeLimit: 1024 * MIB,
    softRatio: 0.75,
    hardRatio: 0.95,
  })

  expect(plan.effectiveUsedBytes).toBe(990 * MIB)
  expect(plan.level).toBe("hard")
  expect(plan.actions).toEqual(expect.arrayContaining([
    "spill-scratch-to-opfs",
    "disable-composite-cache",
    "reject-allocation",
  ]))
  expect(plan.recommendedEvictBytes).toBeGreaterThan(200 * MIB)
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
  expect(isWebGLBlendModeCompatible("hue")).toBe(true)

  expect(planWebGLCompositor({
    width: 800,
    height: 600,
    layerCount: 1,
    preferWebGL: true,
    webglAvailable: true,
    maxTextureSize: 4096,
  })).toMatchObject({
    path: "webgl",
    reason: "webgl-preferred",
  })

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

  expect(planGpuFilterChain(["brightness-contrast", "gaussian-blur", "box-blur", "motion-blur"], { webglAvailable: true })).toEqual({
    mode: "webgl",
    compatibleFilters: ["brightness-contrast", "gaussian-blur", "box-blur", "motion-blur"],
    cpuFilters: [],
  })
})

test("WebGL layer-stack planner keeps compatible filters effects adjustments and knockout on the GPU path", () => {
  installFixtureDom()
  const allBlendModes: BlendMode[] = [
    "normal",
    "dissolve",
    "behind",
    "clear",
    "darken",
    "multiply",
    "color-burn",
    "linear-burn",
    "darker-color",
    "lighten",
    "screen",
    "color-dodge",
    "linear-dodge",
    "lighter-color",
    "overlay",
    "soft-light",
    "hard-light",
    "vivid-light",
    "linear-light",
    "pin-light",
    "hard-mix",
    "difference",
    "exclusion",
    "subtract",
    "divide",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ]

  expect(allBlendModes.every((mode) => isWebGLBlendModeCompatible(mode))).toBe(true)

  const base: Layer = {
    id: "base",
    name: "Base",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(128, 96),
  }
  const complex: Layer = {
    id: "complex",
    name: "Masked Smart",
    kind: "smart-object",
    visible: true,
    locked: false,
    opacity: 0.75,
    fillOpacity: 0.6,
    blendMode: "hue",
    canvas: fixtureCanvas(128, 96),
    mask: fixtureMask(128, 96),
    maskEnabled: true,
    vectorMask: {
      closed: true,
      points: [
        { x: 8, y: 8 },
        { x: 120, y: 8 },
        { x: 120, y: 88 },
        { x: 8, y: 88 },
      ],
    },
    clipped: true,
    style: {
      dropShadow: { enabled: true, color: "#000000", size: 6, offsetX: 2, offsetY: 3, opacity: 0.4 },
      outerGlow: { enabled: true, color: "#66ccff", size: 8, opacity: 0.35, blendMode: "screen" },
      innerGlow: { enabled: true, color: "#ffffff", size: 4, opacity: 0.2, blendMode: "screen" },
      innerShadow: { enabled: true, color: "#000000", size: 3, offsetX: 1, offsetY: 2, opacity: 0.25 },
      bevel: {
        enabled: true,
        style: "inner",
        depth: 80,
        size: 3,
        soften: 1,
        angle: 120,
        altitude: 30,
        highlight: "#ffffff",
        shadow: "#000000",
        opacity: 0.5,
      },
      colorOverlay: { enabled: true, color: "#3366ff", opacity: 0.15, blendMode: "overlay" },
    },
    smartFilters: [
      { id: "sf", filterId: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: { radius: 2 } },
      { id: "sf2", filterId: "brightness-contrast", name: "Brightness/Contrast", enabled: true, opacity: 0.8, blendMode: "normal", params: { brightness: 10, contrast: 12 } },
    ],
    advancedBlending: {
      fillOpacity: 0.6,
      knockout: "shallow",
      channels: { r: true, g: true, b: true },
      blendIfThis: { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 },
      blendIfUnderlying: { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 },
    },
  }
  const adjustment: Layer = {
    id: "adjustment",
    name: "Invert",
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(128, 96),
    adjustment: { type: "invert", params: {} },
    clipped: true,
  }

  expect(getWebGLLayerCapability(complex, { cpuLayerFallbackAvailable: true })).toMatchObject({
    supported: true,
    gpuMasks: true,
    gpuVectorMasks: true,
    gpuClipping: true,
    requiresCpuCheckpoint: false,
    effectFallbacks: [],
    unsupportedReasons: [],
  })

  const plan = planWebGLLayerStack({
    width: 16000,
    height: 9000,
    layerCount: 3,
    layers: [base, complex, adjustment],
    webglAvailable: true,
    maxTextureSize: 8192,
    cpuLayerFallbackAvailable: true,
    cpuAdjustmentFallbackAvailable: true,
  })

  expect(plan.compatible).toBe(true)
  expect(plan.path).toBe("tiled-webgl")
  expect(plan.tileSize).toBe(8192)
  expect(plan.gpuLayerCount).toBe(3)
  expect(plan.cpuCheckpointLayerIds).toEqual([])
  expect(plan.effectFallbacks).toEqual([])
})

test("WebGL layer-stack planner keeps masked smart filters on the full GPU path", () => {
  installFixtureDom()
  const maskedSmartLayer: Layer = {
    id: "masked-smart",
    name: "Masked Smart Filter",
    kind: "smart-object",
    visible: true,
    locked: false,
    opacity: 0.82,
    blendMode: "screen",
    canvas: fixtureCanvas(128, 96),
    smartFilters: [
      {
        id: "sf-blur",
        filterId: "gaussian-blur",
        name: "Gaussian Blur",
        enabled: true,
        opacity: 0.7,
        blendMode: "overlay",
        params: { radius: 5 },
        mask: fixtureMask(128, 96),
        maskEnabled: true,
        maskDensity: 0.55,
        maskFeather: 6,
      },
      {
        id: "sf-tonal",
        filterId: "brightness-contrast",
        name: "Brightness/Contrast",
        enabled: true,
        params: { brightness: 12, contrast: 18 },
      },
    ],
  }
  const maskedAdjustment: Layer = {
    id: "masked-adjustment",
    name: "Masked Shadows/Highlights",
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 0.6,
    blendMode: "normal",
    canvas: fixtureCanvas(128, 96),
    mask: fixtureMask(128, 96),
    maskEnabled: true,
    clipped: true,
    adjustment: { type: "shadows-highlights", params: { shadows: 25, highlights: 20 } },
  }

  expect(getWebGLLayerCapability(maskedSmartLayer)).toMatchObject({
    supported: true,
    effectFallbacks: [],
    unsupportedReasons: [],
  })

  const plan = planWebGLLayerStack({
    width: 4096,
    height: 3072,
    layerCount: 2,
    layers: [maskedSmartLayer, maskedAdjustment],
    preferWebGL: true,
    webglAvailable: true,
    maxTextureSize: 8192,
  })

  expect(plan.compatible).toBe(true)
  expect(plan.gpuLayerCount).toBe(2)
  expect(plan.effectFallbacks).toEqual([])
  expect(plan.unsupportedLayers).toEqual([])
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
