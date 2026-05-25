import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import {
  createCompatibilityManifest,
  createDocumentReport,
  deserializeProject,
  serializeProject,
} from "../components/photoshop/document-io"
import {
  captureLayerCompState,
  createLayerMetadata,
  defaultAdvancedBlending,
  deleteEmptyLayersFromDocument,
  duplicateSlice,
  isLayerEmpty,
  layerMatchesQuery,
  normalizeGuide,
  normalizeSlice,
  normalizeAdvancedBlending,
  reorderSmartFilterStack,
  setBlendIfRangeHandle,
} from "../components/photoshop/layer-workflows"
import type { Layer, SmartFilter } from "../components/photoshop/types"
import { fixtureCanvas, fixtureMask, installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

type FixtureState = ReturnType<typeof stateWithFixtureDoc>

function stateWithFixtureDoc() {
  const doc = richFixtureDocument()
  return {
    documents: [doc],
    activeDocId: doc.id,
    tool: "move",
    foreground: "#000000",
    background: "#ffffff",
    histories: {},
    snapshots: {},
    closedDocuments: [],
    documentLifecycle: {},
    clipboard: null,
    styleClipboard: null,
    brush: {},
    gradient: {},
    paintBucket: {},
    eraser: {},
    cloneSource: {},
    symmetry: {},
    selectionOptions: {},
    transform: null,
    brushPresets: [],
    actions: [],
    recordingActionId: null,
    isPlayingAction: false,
  }
}

function setFixtureAlpha(canvas: HTMLCanvasElement, alpha: number) {
  const ctx = canvas.getContext("2d")!
  const image = new ImageData(new Uint8ClampedArray(canvas.width * canvas.height * 4), canvas.width, canvas.height)
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 16
    image.data[i + 1] = 32
    image.data[i + 2] = 48
    image.data[i + 3] = alpha
  }
  ctx.putImageData(image, 0, 0)
}

test("layer comp capture includes appearance, editable metadata, masks, smart filters, notes, and selection", () => {
  const doc = richFixtureDocument()
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  raster.notes = [{ id: "ln_1", text: "Retouch edge", author: "Ada", createdAt: 1 }]
  raster.metadata = createLayerMetadata({ tags: ["hero", "retouch"], custom: { review: "needed" } })

  const state = captureLayerCompState(doc)

  expect(state.layer_raster).toMatchObject({
    visible: true,
    opacity: 0.9,
    fillOpacity: 0.8,
    blendMode: "multiply",
    maskEnabled: true,
    colorLabel: undefined,
    metadata: { tags: ["hero", "retouch"], custom: { review: "needed" } },
    notes: [{ text: "Retouch edge", author: "Ada" }],
  })
  expect(state.layer_raster.smartFilters?.[0]).toMatchObject({
    id: "sf_blur",
    filterId: "box-blur",
    opacity: 0.75,
    blendMode: "normal",
    maskEnabled: true,
  })
  expect(state.layer_text.text).toMatchObject({ content: "Fixture", vertical: true })
})

test("layer search supports names, notes, metadata, smart-object state, filter, mask, visibility, and lock tokens", () => {
  const doc = richFixtureDocument()
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!
  smart.notes = [{ id: "ln_1", text: "Relink before export", author: "Ada", createdAt: 1 }]
  smart.metadata = createLayerMetadata({ tags: ["product"], custom: { sku: "A-42" } })
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  raster.colorLabel = "blue"
  raster.locked = true

  expect(layerMatchesQuery(smart, "product smart:linked note:relink meta:A-42")).toBe(true)
  expect(layerMatchesQuery(raster, "kind:raster label:blue filter:box mask:true locked:true")).toBe(true)
  expect(layerMatchesQuery(raster, "visible:false")).toBe(false)
})

test("layer search supports Photoshop-style kind, effect, mode, and attribute filters", () => {
  const doc = richFixtureDocument()
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  raster.style = {
    ...raster.style,
    stroke: { enabled: true, color: "#ffffff", size: 4, position: "outside", opacity: 1 },
    outerGlow: { enabled: true, color: "#00ffff", size: 10, opacity: 0.7 },
  }
  raster.advancedBlending = {
    ...defaultAdvancedBlending(),
    knockout: "deep",
    channels: { r: true, g: false, b: true },
  }

  expect(layerMatchesQuery(raster, "kind:pixel effect:drop-shadow effect:stroke mode:multiply attr:masked attr:effects")).toBe(true)
  expect(layerMatchesQuery(raster, "attribute:knockout channel:g-off")).toBe(true)
  expect(layerMatchesQuery(raster, "effect:bevel")).toBe(false)
  expect(layerMatchesQuery(raster, "mode:screen")).toBe(false)
})

test("advanced blending helpers normalize Photoshop defaults and split Blend If handles", () => {
  expect(normalizeAdvancedBlending()).toMatchObject({
    fillOpacity: 1,
    knockout: "none",
    channels: { r: true, g: true, b: true },
    blendIfThis: { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 },
    blendIfUnderlying: { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 },
    transparencyShapesLayer: true,
    layerMaskHidesEffects: false,
    vectorMaskHidesEffects: false,
  })

  const pairedBlack = setBlendIfRangeHandle(defaultAdvancedBlending().blendIfThis, "black", 52, { split: false })
  expect(pairedBlack).toMatchObject({ black: 52, blackFeather: 52, whiteFeather: 255, white: 255 })

  const splitBlack = setBlendIfRangeHandle(pairedBlack, "blackFeather", 96)
  expect(splitBlack).toMatchObject({ black: 52, blackFeather: 96, whiteFeather: 255, white: 255 })

  const pairedWhite = setBlendIfRangeHandle(splitBlack, "white", 188, { split: false })
  expect(pairedWhite).toMatchObject({ black: 52, blackFeather: 96, whiteFeather: 188, white: 188 })

  const splitWhite = setBlendIfRangeHandle(pairedWhite, "whiteFeather", 144)
  expect(splitWhite).toMatchObject({ black: 52, blackFeather: 96, whiteFeather: 144, white: 188 })
})

test("empty-layer helper only deletes unlocked raster layers with no pixels or metadata", () => {
  const doc = richFixtureDocument()
  const emptyCanvas = fixtureCanvas(8, 8, "#000000")
  const filledCanvas = fixtureCanvas(8, 8, "#ffffff")
  setFixtureAlpha(emptyCanvas, 0)
  setFixtureAlpha(filledCanvas, 255)
  const empty: Layer = {
    id: "empty",
    name: "Empty Pixel Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: emptyCanvas,
  }
  const filled: Layer = {
    ...empty,
    id: "filled",
    name: "Filled Pixel Layer",
    canvas: filledCanvas,
  }
  doc.layers = [empty, filled, ...doc.layers]
  doc.activeLayerId = empty.id
  doc.selectedLayerIds = [empty.id, filled.id]

  expect(isLayerEmpty(empty)).toBe(true)
  expect(isLayerEmpty(filled)).toBe(false)
  const cleaned = deleteEmptyLayersFromDocument(doc)
  expect(cleaned.layers.map((layer) => layer.id)).not.toContain("empty")
  expect(cleaned.layers.map((layer) => layer.id)).toContain("filled")
  expect(cleaned.selectedLayerIds).toEqual(["filled"])
})

test("guide and slice helpers clamp document workflows and preserve export metadata", () => {
  expect(normalizeGuide({ id: "g", orientation: "vertical", position: 999, color: "#fff", locked: true }, 64, 48)).toMatchObject({
    id: "g",
    orientation: "vertical",
    position: 64,
    locked: true,
    visible: true,
  })

  const slice = normalizeSlice({
    id: "s",
    name: "Hero",
    x: -10,
    y: 42,
    w: 99,
    h: 99,
    url: "/hero",
    altText: "Hero crop",
    format: "webp",
  }, 64, 48)
  expect(slice).toMatchObject({ x: 0, y: 42, w: 64, h: 6, url: "/hero", altText: "Hero crop", format: "webp", visible: true })

  const duplicate = duplicateSlice(slice, ["Hero", "Hero Copy"], 64, 48)
  expect(duplicate.name).toBe("Hero Copy 2")
  expect(duplicate.id).not.toBe(slice.id)
  expect(duplicate.x).toBeGreaterThanOrEqual(slice.x)
})

test("smart-filter stack helpers support reordering and preserve masks", () => {
  installFixtureDom()
  const filters: SmartFilter[] = [
    { id: "a", filterId: "box-blur", name: "Box Blur", enabled: true, params: {}, mask: fixtureMask(8, 8), maskEnabled: true },
    { id: "b", filterId: "sharpen", name: "Sharpen", enabled: true, params: {}, opacity: 0.5, blendMode: "overlay" },
    { id: "c", filterId: "noise", name: "Noise", enabled: false, params: {} },
  ]

  const moved = reorderSmartFilterStack(filters, "c", -2)
  expect(moved.map((filter) => filter.id)).toEqual(["c", "a", "b"])
  expect(moved[1].mask).toBe(filters[0].mask)
  expect(reorderSmartFilterStack(filters, "missing", 1)).toEqual(filters)
})

test("reducer updates layer notes, metadata, guide state, slices, smart filters, masks, and smart edit packages", () => {
  let state: FixtureState = stateWithFixtureDoc()

  state = reducer(state as never, {
    type: "set-layer-metadata",
    id: "layer_smart",
    metadata: createLayerMetadata({ tags: ["linked"], custom: { owner: "design" } }),
  } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "add-layer-note",
    id: "layer_smart",
    note: { id: "note_1", text: "Check linked source", author: "Ada", createdAt: 1 },
  } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "update-guide-state",
    id: "guide_v",
    patch: { locked: true, visible: false, name: "Fold" },
  } as never) as unknown as FixtureState
  state = reducer(state as never, { type: "duplicate-slice", id: "slice_1" } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "update-smart-filter",
    layerId: "layer_raster",
    filterId: "sf_blur",
    patch: { opacity: 0.25, blendMode: "screen" },
  } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "set-smart-filter-mask",
    layerId: "layer_raster",
    filterId: "sf_blur",
    mask: fixtureMask(64, 48),
    enabled: false,
  } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "fill-layer-mask",
    id: "layer_raster",
    value: "black",
  } as never) as unknown as FixtureState
  state = reducer(state as never, {
    type: "set-smart-object-edit-package",
    id: "layer_smart",
    editPackage: { id: "pkg_1", name: "Product Contents", version: 2, createdAt: 1, updatedAt: 2, layerCount: 3 },
  } as never) as unknown as FixtureState

  const doc = state.documents[0]
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!

  expect(smart.metadata).toMatchObject({ tags: ["linked"], custom: { owner: "design" } })
  expect(smart.notes?.[0].text).toBe("Check linked source")
  expect(smart.smartSource?.editPackage).toMatchObject({ id: "pkg_1", version: 2, layerCount: 3 })
  expect(doc.guides?.[0]).toMatchObject({ name: "Fold", locked: true, visible: false })
  expect(doc.slices).toHaveLength(2)
  expect(doc.slices?.[1].name).toBe("Hero Copy")
  expect(raster.smartFilters?.[0]).toMatchObject({ opacity: 0.25, blendMode: "screen", maskEnabled: false })
  expect(raster.mask).not.toBeNull()
})

test("reducer updates advanced blending and runs layer cleanup/rasterize commands", () => {
  let state: FixtureState = stateWithFixtureDoc()
  const emptyCanvas = fixtureCanvas(64, 48, "#000000")
  setFixtureAlpha(emptyCanvas, 0)
  state.documents[0].layers.unshift({
    id: "layer_empty",
    name: "Empty Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: emptyCanvas,
  })
  setFixtureAlpha(state.documents[0].layers.find((layer) => layer.id === "layer_text")!.canvas, 255)
  state.documents[0].selectedLayerIds = ["layer_empty", "layer_text", "layer_raster"]

  state = reducer(state as never, {
    type: "set-layer-advanced-blending",
    id: "layer_raster",
    advancedBlending: {
      ...defaultAdvancedBlending(),
      knockout: "shallow",
      blendIfThis: { black: 12, blackFeather: 28, whiteFeather: 220, white: 244 },
      layerMaskHidesEffects: true,
      vectorMaskHidesEffects: true,
    },
  } as never) as unknown as FixtureState
  state = reducer(state as never, { type: "flatten-all-layer-effects" } as never) as unknown as FixtureState
  state = reducer(state as never, { type: "flatten-all-masks" } as never) as unknown as FixtureState
  state = reducer(state as never, { type: "rasterize-layers", ids: ["layer_text"], option: "type" } as never) as unknown as FixtureState
  state = reducer(state as never, { type: "delete-empty-layers" } as never) as unknown as FixtureState

  const doc = state.documents[0]
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  const text = doc.layers.find((layer) => layer.id === "layer_text")!

  expect(raster.advancedBlending).toMatchObject({ knockout: "shallow", layerMaskHidesEffects: true })
  expect(raster.style).toBeUndefined()
  expect(raster.mask).toBeFalsy()
  expect(raster.vectorMask).toBeFalsy()
  expect(text.kind).toBe("raster")
  expect(text.text).toBeUndefined()
  expect(doc.layers.map((layer) => layer.id)).not.toContain("layer_empty")
})

test("smart-object relink metadata stores browser file-handle metadata without requiring serializable handles", () => {
  const state = reducer(stateWithFixtureDoc() as never, {
    type: "replace-smart-object-contents",
    id: "layer_smart",
    canvas: fixtureCanvas(20, 18, "#00aa88"),
    source: {
      fileName: "replacement.png",
      fileHandleName: "replacement.png",
      relativePath: "links/replacement.png",
      linkType: "linked",
      sourceHash: "hash-123",
      lastKnownModified: 1_800_000_001_000,
      relinkedAt: 1_800_000_002_000,
    },
  } as never) as unknown as FixtureState

  const layer = state.documents[0].layers.find((item: Layer) => item.id === "layer_smart")!
  expect(layer.smartSource).toMatchObject({
    fileName: "replacement.png",
    fileHandleName: "replacement.png",
    relativePath: "links/replacement.png",
    linkType: "linked",
    sourceHash: "hash-123",
    lastKnownModified: 1_800_000_001_000,
    relinkedAt: 1_800_000_002_000,
  })
})

test("project serialization preserves app-only layer and smart-object metadata without live file handles", async () => {
  const doc = richFixtureDocument()
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!
  raster.notes = [{ id: "ln_1", text: "Retouch edge", createdAt: 1 }]
  raster.metadata = createLayerMetadata({ tags: ["retouch"], custom: { owner: "design" } })
  smart.smartSource = {
    ...smart.smartSource!,
    fileHandle: { name: "product-source.png" } as FileSystemFileHandle,
    fileHandleName: "product-source.png",
    handlePermission: "granted",
    lastKnownModified: 1_800_000_003_000,
    sourceHash: "hash-product",
    editPackage: { id: "pkg_1", name: "Product Contents", version: 1, createdAt: 1, updatedAt: 2, layerCount: 2 },
    exportedAt: 1_800_000_004_000,
    relinkedAt: 1_800_000_005_000,
  }

  const project = serializeProject(doc)
  expect(project).toContain("fileHandleName")
  expect(project).not.toContain("\"fileHandle\"")
  expect(project).toContain("editPackage")
  expect(project).toContain("Retouch edge")

  const restored = await deserializeProject(project)
  const restoredRaster = restored.layers.find((layer) => layer.name === raster.name)!
  const restoredSmart = restored.layers.find((layer) => layer.name === smart.name)!
  expect(restoredRaster.notes?.[0].text).toBe("Retouch edge")
  expect(restoredRaster.metadata).toMatchObject({ tags: ["retouch"], custom: { owner: "design" } })
  expect(restoredRaster.smartFilters?.[0].mask).toBeTruthy()
  expect(restoredSmart.smartSource).toMatchObject({
    fileHandleName: "product-source.png",
    handlePermission: "granted",
    sourceHash: "hash-product",
    editPackage: { id: "pkg_1", layerCount: 2 },
    exportedAt: 1_800_000_004_000,
    relinkedAt: 1_800_000_005_000,
  })
  expect(restoredSmart.smartSource?.fileHandle).toBeUndefined()
})

test("compatibility reports include app-only layer metadata and file-system smart links", () => {
  const doc = richFixtureDocument()
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!
  raster.notes = [{ id: "ln_1", text: "Review", createdAt: 1 }]
  raster.metadata = createLayerMetadata({ tags: ["review"] })
  smart.smartSource = {
    ...smart.smartSource!,
    fileHandleName: "product-source.png",
    handlePermission: "prompt",
    editPackage: { id: "pkg_1", name: "Contents", version: 1, createdAt: 1, updatedAt: 2 },
  }

  const manifest = createCompatibilityManifest(doc, "project")
  expect(manifest.entries.map((entry) => entry.label)).toContain("Layer notes and metadata")
  expect(manifest.entries.map((entry) => entry.label)).toContain("File System Access links")

  const report = createDocumentReport(doc, "Project Export")
  expect(report.items.map((item) => item.label)).toContain("Layer notes and metadata")
  expect(report.items.map((item) => item.label)).toContain("File System Access smart links")
})
