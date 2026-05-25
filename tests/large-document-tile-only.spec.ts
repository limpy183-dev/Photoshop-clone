import { expect, test } from "@playwright/test"

import {
  composeDocumentTile,
  planTileOnlyEdit,
  planTileOnlyExport,
  planTileOnlyFilter,
  planTileOnlySelection,
  supportsTileOnlyLayer,
} from "../components/photoshop/tile-only-pipeline"
import { exportRasterTileSequenceBlob } from "../components/photoshop/document-io"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { installFixtureDom, fixtureCanvas } from "./photoshop-fixtures"

function canvasPayload(canvas: HTMLCanvasElement) {
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
