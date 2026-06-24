import { expect, test } from "@playwright/test"

import {
  composeDocumentTile,
  createTileOnlyCapabilityDashboard,
  describeTileOnlyExportDecision,
  planTileOnlyDefaultCompositor,
  planTileOnlyEdit,
  planTileOnlyExport,
  planTileOnlyFilter,
  planTileOnlyInteractiveTool,
  planTileOnlySelection,
  renderTileOnlyViewportComposite,
  supportsTileOnlyLayer,
} from "../components/photoshop/tile-only-pipeline"
import { exportRasterTileSequenceBlob } from "../components/photoshop/document-io"
import {
  commitPsbTileEditDocument,
  forgetPsbTileViewStore,
  openPsbTileEditDocument,
  registerPsbTileViewStore,
  writePsbTileViewCanvas,
} from "../components/photoshop/psb-tile-view"
import { TiledBackingStore } from "../components/photoshop/tiled-backing-store"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { installFixtureDom, fixtureCanvas } from "./photoshop-fixtures"

function canvasPayload(canvas: HTMLCanvasElement) {
  const fixtureFill = (canvas as HTMLCanvasElement & { fill?: unknown }).fill
  if (typeof fixtureFill === "string") return { width: canvas.width, height: canvas.height, fill: fixtureFill }
  const body = canvas.toDataURL("image/png").split(",", 2)[1] ?? ""
  return JSON.parse(atob(body)) as { width: number; height: number; fill: string }
}

function layer(id: string, canvas: HTMLCanvasElement, partial: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal",
    canvas,
    ...partial,
  }
}

function doc(layers: Layer[], partial: Partial<PsDocument> = {}): PsDocument {
  return {
    id: "doc",
    name: "Large",
    width: 128,
    height: 96,
    zoom: 1,
    layers,
    activeLayerId: layers[0]?.id ?? "",
    selectedLayerIds: layers[0] ? [layers[0].id] : [],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    ...partial,
  }
}

test("tile-only edit planner keeps broad tool families bounded to touched tiles", () => {
  const plan = planTileOnlyEdit({
    documentWidth: 12000,
    documentHeight: 6000,
    tileSize: 512,
    operation: {
      kind: "paint",
      tool: "healing-brush",
      layerId: "paint",
      bounds: { x: 990, y: 510, w: 80, h: 64 },
      radius: 24,
    },
  })

  expect(plan.materializesFullDocument).toBe(false)
  expect(plan.strategy).toBe("tile-local")
  expect(plan.readTiles.map((tile) => tile.key)).toEqual(["1:0", "2:0", "1:1", "2:1"])
  expect(plan.writeTiles.map((tile) => tile.key)).toEqual(["1:0", "2:0", "1:1", "2:1"])
  expect(plan.reasons).toEqual(expect.arrayContaining(["tool:healing-brush", "halo:24"]))
})

test("tile-only filter and selection planners expose overlap and mask-local writes", () => {
  const filterPlan = planTileOnlyFilter({
    documentWidth: 4096,
    documentHeight: 2048,
    tileSize: 512,
    layerId: "photo",
    filterId: "gaussian-blur",
    params: { radius: 12 },
    bounds: { x: 960, y: 256, w: 700, h: 480 },
  })

  expect(filterPlan.materializesFullDocument).toBe(false)
  expect(filterPlan.readHalo).toBe(12)
  expect(filterPlan.writeTiles.map((tile) => tile.key)).toEqual([
    "1:0",
    "2:0",
    "3:0",
    "1:1",
    "2:1",
    "3:1",
  ])
  expect(filterPlan.readTiles.length).toBeGreaterThan(filterPlan.writeTiles.length)

  const selectionPlan = planTileOnlySelection({
    documentWidth: 4096,
    documentHeight: 2048,
    tileSize: 512,
    kind: "quick-selection",
    bounds: { x: 1000, y: 700, w: 120, h: 90 },
    sampleAllLayers: true,
    tolerance: 24,
  })

  expect(selectionPlan.materializesFullDocument).toBe(false)
  expect(selectionPlan.selectionStorage).toBe("tile-mask")
  expect(selectionPlan.readTiles.map((tile) => tile.key)).toEqual(["1:1", "2:1"])
  expect(selectionPlan.reasons).toEqual(expect.arrayContaining(["selection:quick-selection", "sample-all-layers"]))
})

test("tile-only compositor renders raster, smart object, 3D, and video layers for one tile", () => {
  installFixtureDom()

  const base = fixtureCanvas(128, 96, "#202020")
  const smartSource = fixtureCanvas(256, 192, "#cc0000")
  const smartCanvas = fixtureCanvas(128, 96, "rgba(0,0,0,0)")
  const videoCanvas = fixtureCanvas(128, 96, "rgba(0,0,0,0)")
  videoCanvas.getContext("2d")!.fillStyle = "#0044ff"
  videoCanvas.getContext("2d")!.fillRect(64, 32, 64, 64)

  const sceneLayer = layer("scene", fixtureCanvas(128, 96, "rgba(0,0,0,0)"), {
    kind: "3d",
    threeD: {
      objects: [{
        id: "cube",
        name: "Cube",
        vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [{ indices: [0, 1, 2], materialId: "mat" }],
        materialId: "mat",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }],
      materials: [{ id: "mat", name: "Red", color: "#ff0000", roughness: 0.5, metallic: 0, opacity: 1 }],
      lights: [],
      camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 42, focalLength: 50 },
      renderMode: "solid",
    },
  })

  const sourceDoc = doc([
    layer("base", base),
    layer("smart", smartCanvas, {
      kind: "smart-object",
      smartObject: true,
      smartSource: { id: "so", name: "Smart", canvas: smartSource, width: 256, height: 192, embedded: true },
      opacity: 0.6,
    }),
    sceneLayer,
    layer("video", videoCanvas, {
      kind: "video",
      video: {
        sourceName: "clip.mp4",
        durationMs: 1000,
        inPointMs: 0,
        outPointMs: 1000,
        currentTimeMs: 500,
        playbackRate: 1,
        keyframes: [],
      },
      opacity: 0.5,
    }),
  ])

  for (const item of sourceDoc.layers) expect(supportsTileOnlyLayer(item)).toBe(true)

  const tile = composeDocumentTile(sourceDoc, {
    x: 64,
    y: 32,
    w: 32,
    h: 32,
    transparent: false,
    matte: "#ffffff",
  })

  expect(tile.width).toBe(32)
  expect(tile.height).toBe(32)
  expect(canvasPayload(tile).fill).not.toEqual(canvasPayload(base).fill)
})

test("tile-only export plan streams output tiles without a full composite canvas", () => {
  const exportPlan = planTileOnlyExport({
    documentWidth: 20000,
    documentHeight: 12000,
    tileSize: 1024,
    format: "png",
    scale: 1,
    layers: [
      { id: "photo", kind: "raster" },
      { id: "so", kind: "smart-object" },
      { id: "scene", kind: "3d" },
      { id: "clip", kind: "video" },
    ],
  })

  expect(exportPlan.mode).toBe("tile-stream")
  expect(exportPlan.materializesFullDocument).toBe(false)
  expect(exportPlan.tileCount).toBe(240)
  expect(exportPlan.encoder).toBe("tile-sequence")
  expect(exportPlan.warnings).toEqual(expect.arrayContaining([
    "PNG export streams tiles to the encoder plan instead of allocating a 20000 x 12000 canvas.",
  ]))
})

test("tile-only raster export writes a tile sequence package with manifest metadata", async () => {
  installFixtureDom()
  const sourceDoc = doc([layer("base", fixtureCanvas(96, 64, "#224466"))], {
    width: 96,
    height: 64,
  })

  const blob = await exportRasterTileSequenceBlob(sourceDoc, {
    format: "png",
    scale: 1,
    quality: 1,
    transparent: true,
    matte: "#ffffff",
    tileSize: 48,
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const text = new TextDecoder().decode(bytes)

  expect(blob.type).toBe("application/zip")
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  expect(text).toContain("manifest.json")
  expect(text).toContain("\"tileCount\": 4")
  expect(text).toContain("tiles/0_0.png")
})

test("tile-only capability dashboard reports safe approximate and blocked operation paths", () => {
  const dashboard = createTileOnlyCapabilityDashboard({
    documentWidth: 20000,
    documentHeight: 12000,
    tileSize: 1024,
    explicitTileOnly: true,
    format: "png",
    colorMode: "RGB",
    bitDepth: 8,
    layers: [
      { id: "photo", kind: "raster" },
      { id: "headline", kind: "text" },
      { id: "folder", kind: "group" },
    ],
  })

  expect(dashboard.summary).toContain("240 tiles")
  expect(dashboard.safeCount).toBeGreaterThan(0)
  expect(dashboard.approximateCount).toBeGreaterThan(0)
  expect(dashboard.blockedCount).toBeGreaterThan(0)
  expect(dashboard.rows.find((row) => row.id === "viewport-compositing")).toMatchObject({
    status: "blocked",
    mitigation: expect.stringContaining("unsupported layers"),
  })
  expect(dashboard.rows.find((row) => row.id === "vector-text-rasterization")).toMatchObject({
    status: "approximate",
  })
  expect(dashboard.rows.find((row) => row.id === "raster-export")).toMatchObject({
    status: "blocked",
    mitigation: expect.stringContaining("unsupported layer"),
  })
  expect(dashboard.unflushedPaths.map((path) => path.id)).toContain("history-snapshots")
})

test("tile-only export decision explains tile sequence versus full-canvas fallback", () => {
  const tileStream = describeTileOnlyExportDecision(planTileOnlyExport({
    documentWidth: 20000,
    documentHeight: 12000,
    tileSize: 1024,
    format: "png",
    scale: 1,
    layers: [{ id: "photo", kind: "raster" }],
  }))

  expect(tileStream.mode).toBe("tile-sequence")
  expect(tileStream.status).toBe("safe")
  expect(tileStream.detail).toContain("avoids a full-canvas allocation")

  const fallback = describeTileOnlyExportDecision(planTileOnlyExport({
    documentWidth: 20000,
    documentHeight: 12000,
    tileSize: 1024,
    format: "png",
    scale: 1,
    layers: [{ id: "folder", kind: "group" }],
  }))

  expect(fallback.mode).toBe("full-canvas-fallback")
  expect(fallback.status).toBe("blocked")
  expect(fallback.detail).toContain("folder")
})

test("default compositor switches huge and explicit tile-only documents to viewport tiles", () => {
  const explicit = planTileOnlyDefaultCompositor({
    documentWidth: 12000,
    documentHeight: 9000,
    tileSize: 1024,
    viewport: { x: 2048, y: 1024, w: 1100, h: 900 },
    layers: [{ id: "photo", kind: "raster" }],
    explicitTileOnly: true,
    colorMode: "RGB",
    bitDepth: 8,
  })

  expect(explicit.strategy).toBe("tile-local")
  expect(explicit.materializesFullDocument).toBe(false)
  expect(explicit.viewportPlan.materializeTiles.map((tile) => tile.key)).toEqual([
    "2:1",
    "3:1",
  ])

  const huge = planTileOnlyDefaultCompositor({
    documentWidth: 20000,
    documentHeight: 12000,
    tileSize: 1024,
    viewport: { x: 0, y: 0, w: 1200, h: 900 },
    layers: [{ id: "photo", kind: "raster" }],
    explicitTileOnly: false,
    colorMode: "RGB",
    bitDepth: 8,
    canvasBudgetPixels: 10000 * 10000,
  })

  expect(huge.strategy).toBe("tile-local")
  expect(huge.reasons).toEqual(expect.arrayContaining(["huge-document"]))
  expect(huge.materializesFullDocument).toBe(false)

  const normal = planTileOnlyDefaultCompositor({
    documentWidth: 2000,
    documentHeight: 1200,
    viewport: { x: 0, y: 0, w: 2000, h: 1200 },
    layers: [{ id: "photo", kind: "raster" }],
    explicitTileOnly: false,
    colorMode: "RGB",
    bitDepth: 8,
    canvasBudgetPixels: 10000 * 10000,
  })

  expect(normal.strategy).toBe("fallback-full")
  expect(normal.materializesFullDocument).toBe(true)
})

test("tile-only viewport renderer draws only visible tiles", () => {
  installFixtureDom()
  const sourceDoc = doc([layer("base", fixtureCanvas(128, 96, "#224466"))], {
    width: 128,
    height: 96,
  })
  const plan = planTileOnlyDefaultCompositor({
    documentWidth: 128,
    documentHeight: 96,
    tileSize: 32,
    viewport: { x: 48, y: 16, w: 40, h: 40 },
    layers: sourceDoc.layers,
    explicitTileOnly: true,
    colorMode: "RGB",
    bitDepth: 8,
  })

  const rendered = renderTileOnlyViewportComposite(sourceDoc, plan)

  expect(rendered.materializesFullDocument).toBe(false)
  expect(rendered.tiles.map((tile) => tile.key)).toEqual(["1:0", "2:0", "1:1", "2:1"])
  expect(rendered.tiles.every((tile) => tile.canvas.width <= 32 && tile.canvas.height <= 32)).toBe(true)
})

test("interactive paint and retouch tools plan tile-local read and write bounds", () => {
  const paint = planTileOnlyInteractiveTool({
    documentWidth: 8192,
    documentHeight: 8192,
    tileSize: 512,
    tool: "brush",
    layerId: "paint",
    bounds: { x: 480, y: 490, w: 120, h: 90 },
    radius: 40,
  })

  expect(paint.strategy).toBe("tile-local")
  expect(paint.materializesFullDocument).toBe(false)
  expect(paint.writeTiles.map((tile) => tile.key)).toEqual(["0:0", "1:0", "0:1", "1:1"])

  const clone = planTileOnlyInteractiveTool({
    documentWidth: 8192,
    documentHeight: 8192,
    tileSize: 512,
    tool: "healing-brush",
    layerId: "paint",
    bounds: { x: 2040, y: 2040, w: 80, h: 80 },
    sourceBounds: { x: 1000, y: 1000, w: 80, h: 80 },
    radius: 32,
  })

  expect(clone.strategy).toBe("tile-local")
  expect(clone.readTiles.map((tile) => tile.key)).toEqual(expect.arrayContaining(["1:1", "2:2", "3:3", "4:4"]))
  expect(clone.reasons).toEqual(expect.arrayContaining(["tool:healing-brush", "operation:heal"]))
})

test("PSB tile view opens and commits one full-resolution tile without materializing the document", async () => {
  installFixtureDom()
  const parentDoc = doc([layer("overview", fixtureCanvas(64, 48, "#333333"))], {
    id: "doc_psb",
    name: "mural.psb",
    width: 64,
    height: 48,
    metadata: {
      largeDocumentTileView: {
        mode: "psb-tile-view",
        sourceName: "mural.psb",
        originalWidth: 128,
        originalHeight: 96,
        overviewScale: 0.5,
        tileSize: 64,
        tileColumns: 2,
        tileRows: 2,
        tileCount: 4,
      },
    },
  })
  const store = new TiledBackingStore({ width: 128, height: 96, tileSize: 64, memoryBudgetMB: 32 })
  registerPsbTileViewStore(parentDoc.id, store)
  try {
    await writePsbTileViewCanvas(parentDoc.id, 1, 0, fixtureCanvas(64, 64, "#aa2200"))

    const editDoc = await openPsbTileEditDocument(parentDoc, 1, 0)
    expect(editDoc?.metadata?.largeDocumentTileEdit).toMatchObject({
      mode: "tile-edit",
      parentDocId: "doc_psb",
      tile: { col: 1, row: 0, x: 64, y: 0, width: 64, height: 64 },
    })

    editDoc!.layers[0].canvas = fixtureCanvas(64, 64, "#00aa55")
    await expect(commitPsbTileEditDocument(editDoc!)).resolves.toBe(true)

    const reopened = await openPsbTileEditDocument(parentDoc, 1, 0)
    expect(reopened!.layers[0].canvas.width).toBe(64)
    expect(reopened!.layers[0].canvas.height).toBe(64)
  } finally {
    forgetPsbTileViewStore(parentDoc.id)
  }
})
