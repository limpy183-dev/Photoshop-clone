import { expect, test } from "@playwright/test"

import {
  appGlobalLightToPsdResources,
  appGuidesToPsd,
  appLayerCompsToPsd,
  appMetadataToPsdResources,
  appNotesToPsd,
  appPrintSettingsToPsdResources,
  appResolutionToPsd,
  appSlicesToPsd,
  appSmartObjectToPsdLayer,
  psdGlobalLightToApp,
  psdGuidesToApp,
  psdLayerCompsToApp,
  psdMetadataToApp,
  psdNotesToApp,
  psdPrintSettingsToApp,
  psdResolutionToApp,
  psdSlicesToApp,
  psdSmartObjectToAppLayer,
  RESOURCES_METADATA_CAPABILITY,
} from "../components/photoshop/psd-resources-metadata"
import type {
  DocumentMetadata,
  Guide,
  Layer,
  LayerComp,
  Note,
  PrintSettings,
  PsDocument,
  Slice,
} from "../components/photoshop/types"
import { fixtureCanvas } from "./photoshop-fixtures"

test("RESOURCES_METADATA_CAPABILITY is a non-empty marker", () => {
  expect(typeof RESOURCES_METADATA_CAPABILITY).toBe("string")
  expect(RESOURCES_METADATA_CAPABILITY.length).toBeGreaterThan(0)
})

test("guides round-trip through PSD encoding", () => {
  const guides: Guide[] = [
    { id: "v1", orientation: "vertical", position: 12.5 },
    { id: "h1", orientation: "horizontal", position: 48.25 },
    { id: "v2", orientation: "vertical", position: 100 },
  ]
  const psd = appGuidesToPsd(guides)
  expect(Array.isArray(psd)).toBe(true)
  expect(psd?.length).toBe(3)
  expect(psd?.[0]).toMatchObject({ direction: "vertical", location: Math.round(12.5 * 32) })
  expect(psd?.[1]).toMatchObject({ direction: "horizontal", location: Math.round(48.25 * 32) })

  const back = psdGuidesToApp(psd)
  expect(back.length).toBe(3)
  expect(back[0].orientation).toBe("vertical")
  expect(back[0].position).toBeCloseTo(12.5, 5)
  expect(back[1].orientation).toBe("horizontal")
  expect(back[1].position).toBeCloseTo(48.25, 5)
  expect(back[2].position).toBeCloseTo(100, 5)
})

test("slices round-trip through PSD encoding (3 named slices)", () => {
  const slices: Slice[] = [
    { id: "a", name: "Hero", x: 0, y: 0, w: 200, h: 100 },
    { id: "b", name: "Nav", x: 200, y: 0, w: 200, h: 100 },
    { id: "c", name: "Footer", x: 0, y: 100, w: 400, h: 50 },
  ]
  const psd = appSlicesToPsd(slices, 400, 150)
  expect(Array.isArray(psd)).toBe(true)
  expect(psd?.[0].slices.length).toBe(3)
  expect(psd?.[0].slices[0].name).toBe("Hero")
  expect(psd?.[0].slices[1].bounds).toMatchObject({ left: 200, top: 0, right: 400, bottom: 100 })

  const back = psdSlicesToApp(psd)
  expect(back.length).toBe(3)
  expect(back[0]).toMatchObject({ name: "Hero", x: 0, y: 0, w: 200, h: 100 })
  expect(back[1]).toMatchObject({ name: "Nav", x: 200, y: 0, w: 200, h: 100 })
  expect(back[2]).toMatchObject({ name: "Footer", x: 0, y: 100, w: 400, h: 50 })
})

test("layer comps round-trip with embedded per-layer state", () => {
  const comps: LayerComp[] = [
    {
      id: "comp_1",
      name: "Hero Variant",
      state: {
        layer_raster: {
          visible: true,
          opacity: 0.8,
          blendMode: "multiply",
          fillOpacity: 0.6,
        },
        layer_text: {
          visible: false,
          opacity: 1,
          blendMode: "normal",
        },
      },
      activeLayerId: "layer_raster",
      selectedLayerIds: ["layer_raster", "layer_text"],
    },
  ]
  const psd = appLayerCompsToPsd(comps)
  expect(psd?.list.length).toBe(1)
  expect(psd?.list[0].name).toBe("Hero Variant")
  expect(typeof psd?.list[0].comment).toBe("string")
  expect(psd?.list[0].comment?.startsWith("__ps-web-comp:")).toBe(true)

  const back = psdLayerCompsToApp(psd, [])
  expect(back.length).toBe(1)
  expect(back[0].name).toBe("Hero Variant")
  expect(back[0].state.layer_raster.opacity).toBeCloseTo(0.8, 5)
  expect(back[0].state.layer_raster.blendMode).toBe("multiply")
  expect(back[0].state.layer_text.visible).toBe(false)
  expect(back[0].activeLayerId).toBe("layer_raster")
})

test("smart object placement encodes id, type, transform and links embedded data", async () => {
  const sourceCanvas = fixtureCanvas(32, 24, "#cc6633")
  const renderCanvas = fixtureCanvas(64, 48, "#aabbcc")
  const layer: Layer = {
    id: "layer_smart",
    name: "Product",
    kind: "smart-object",
    visible: true,
    locked: false,
    smartObject: true,
    opacity: 1,
    blendMode: "normal",
    canvas: renderCanvas,
    smartSource: {
      width: 32,
      height: 24,
      canvas: sourceCanvas,
      id: "smart_src_1",
      name: "product.png",
      fileName: "product.png",
      relativePath: "assets/product.png",
      linkType: "linked",
      status: "current",
      embedded: true,
      updatedAt: 1_800_000_000_000,
    },
  }

  const result = appSmartObjectToPsdLayer(layer)
  expect(result).not.toBeNull()
  // ag-psd requires placedLayer.id be a GUID; we hash the app id to a
  // deterministic GUID so PSD writes succeed while remaining round-trippable.
  expect(result?.placedLayer.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  const placedGuid = result?.placedLayer.id
  expect(result?.placedLayer.type).toBe("raster")
  expect(result?.placedLayer.width).toBe(32)
  expect(result?.placedLayer.height).toBe(24)
  expect(result?.placedLayer.transform?.length).toBe(8)

  // Linked file embedding is optional (fixture canvases produce tiny PNGs).
  if (result?.linkedFile) {
    expect(result.linkedFile.id).toBe(placedGuid)
    expect(result.linkedFile.linkedFile?.relativePath).toBe("assets/product.png")
  }

  // Inverse: feed the produced placed-layer + linkedFile through the
  // import path. In a node test environment createImageBitmap is missing,
  // so the recovered canvas is null but everything else should be intact.
  const linkedById = new Map(
    result?.linkedFile ? [[result.linkedFile.id, result.linkedFile] as const] : [],
  )
  const recovered = await psdSmartObjectToAppLayer(
    { placedLayer: result?.placedLayer } as Parameters<typeof psdSmartObjectToAppLayer>[0],
    64,
    48,
    linkedById,
  )
  expect(recovered).not.toBeNull()
  expect(recovered?.width).toBe(32)
  expect(recovered?.height).toBe(24)
  expect(recovered?.id).toBe(placedGuid)
})

test("smart object returns null for layers without smartSource", () => {
  const layer: Layer = {
    id: "raster_only",
    name: "Plain",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(16, 16, "#ffffff"),
  }
  expect(appSmartObjectToPsdLayer(layer)).toBeNull()
})

test("document metadata round-trips through XMP packet", () => {
  const meta: DocumentMetadata = {
    title: "Sunset",
    author: "Ada Lovelace",
    description: "Long-exposure shot of the Pacific.",
    copyright: "(c) 2026 Ada",
    keywords: ["sunset", "ocean", "long-exposure"],
    credit: "Photo by Ada",
    source: "Pacific Coast Highway",
    createdAt: "2026-04-01T10:00:00Z",
    modifiedAt: "2026-04-02T12:00:00Z",
  }
  const resources = appMetadataToPsdResources(meta)
  expect(typeof resources.xmpMetadata).toBe("string")
  expect(resources.xmpMetadata?.includes("Sunset")).toBe(true)
  expect(resources.xmpMetadata?.includes("Ada Lovelace")).toBe(true)
  expect(resources.xmpMetadata?.includes("sunset")).toBe(true)

  const back = psdMetadataToApp({
    imageResources: { xmpMetadata: resources.xmpMetadata },
  } as Parameters<typeof psdMetadataToApp>[0])
  expect(back.title).toBe("Sunset")
  expect(back.author).toBe("Ada Lovelace")
  expect(back.description).toBe("Long-exposure shot of the Pacific.")
  expect(back.copyright).toBe("(c) 2026 Ada")
  expect(back.keywords).toEqual(["sunset", "ocean", "long-exposure"])
  expect(back.credit).toBe("Photo by Ada")
  expect(back.source).toBe("Pacific Coast Highway")
  expect(back.createdAt).toBe("2026-04-01T10:00:00Z")
  expect(back.modifiedAt).toBe("2026-04-02T12:00:00Z")
})

test("XMP escapes XML special characters and survives round-trip", () => {
  const meta: DocumentMetadata = {
    title: "<Test> & \"Demo\"",
    description: "5 < 10 && 12 > 11",
  }
  const resources = appMetadataToPsdResources(meta)
  expect(resources.xmpMetadata?.includes("&amp;")).toBe(true)
  const back = psdMetadataToApp({
    imageResources: { xmpMetadata: resources.xmpMetadata },
  } as Parameters<typeof psdMetadataToApp>[0])
  expect(back.title).toBe('<Test> & "Demo"')
  expect(back.description).toBe("5 < 10 && 12 > 11")
})

test("print settings round-trip via printScale + printFlags", () => {
  const print: PrintSettings = {
    paperSize: "A4",
    orientation: "portrait",
    scale: 75,
    bleedMm: 3,
    cropMarks: true,
    registrationMarks: true,
    colorHandling: "app",
    proofPrint: false,
  }
  const resources = appPrintSettingsToPsdResources(print)
  expect(resources.printScale?.scale).toBeCloseTo(0.75, 5)
  expect(resources.printFlags?.cropMarks).toBe(true)
  expect(resources.printFlags?.registrationMarks).toBe(true)

  const back = psdPrintSettingsToApp({
    imageResources: {
      printScale: resources.printScale,
      printFlags: resources.printFlags,
    },
  } as Parameters<typeof psdPrintSettingsToApp>[0])
  expect(back).not.toBeUndefined()
  expect(back?.scale).toBe(75)
  expect(back?.cropMarks).toBe(true)
  expect(back?.registrationMarks).toBe(true)
})

test("DPI round-trips through resolutionInfo", () => {
  const doc: PsDocument = {
    id: "d",
    name: "doc",
    width: 100,
    height: 100,
    zoom: 1,
    layers: [],
    activeLayerId: "",
    selectedLayerIds: [],
    background: "#fff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    dpi: 144,
  }
  const psd = appResolutionToPsd(doc)
  expect(psd.horizontalResolution).toBe(144)
  expect(psd.verticalResolution).toBe(144)
  expect(psd.horizontalResolutionUnit).toBe("PPI")
  expect(psd.widthUnit).toBe("Inches")

  expect(psdResolutionToApp(psd)).toBe(144)
  expect(psdResolutionToApp(undefined)).toBeUndefined()
})

test("global light round-trips", () => {
  const light = { angle: 120, altitude: 45 }
  const psd = appGlobalLightToPsdResources(light)
  expect(psd?.globalAngle).toBe(120)
  expect(psd?.globalAltitude).toBe(45)
  const back = psdGlobalLightToApp({
    imageResources: psd,
  } as Parameters<typeof psdGlobalLightToApp>[0])
  expect(back).toEqual({ angle: 120, altitude: 45 })

  expect(appGlobalLightToPsdResources(undefined)).toBeUndefined()
  expect(psdGlobalLightToApp({ imageResources: {} } as Parameters<typeof psdGlobalLightToApp>[0])).toBeUndefined()
})

test("notes round-trip via PSD annotations", () => {
  const notes: Note[] = [
    { id: "n1", x: 10, y: 20, author: "Reviewer", text: "Tighten this gradient", color: "#ff6600" },
    { id: "n2", x: 80, y: 100, author: "Ada", text: "Approve", color: "#33aa55" },
  ]
  const psd = appNotesToPsd(notes)
  expect(psd.length).toBe(2)
  expect(psd[0].type).toBe("text")
  expect(psd[0].author).toBe("Reviewer")
  expect(psd[0].data).toBe("Tighten this gradient")
  expect(psd[0].iconLocation).toMatchObject({ left: 10, top: 20 })

  const back = psdNotesToApp({ annotations: psd } as Parameters<typeof psdNotesToApp>[0])
  expect(back.length).toBe(2)
  expect(back[0].text).toBe("Tighten this gradient")
  expect(back[0].author).toBe("Reviewer")
  expect(back[0].x).toBe(10)
  expect(back[0].y).toBe(20)
  expect(back[1].text).toBe("Approve")
  expect(back[1].color.toLowerCase()).toBe("#33aa55")
})

test("empty inputs degrade gracefully", () => {
  expect(appGuidesToPsd(undefined)).toEqual([])
  expect(psdGuidesToApp(undefined)).toEqual([])
  expect(appSlicesToPsd(undefined, 100, 100)).toBeUndefined()
  expect(psdSlicesToApp(undefined)).toEqual([])
  expect(appLayerCompsToPsd(undefined)).toBeUndefined()
  expect(psdLayerCompsToApp(undefined, [])).toEqual([])
  expect(appNotesToPsd(undefined)).toEqual([])
  expect(psdNotesToApp({} as Parameters<typeof psdNotesToApp>[0])).toEqual([])
  expect(appMetadataToPsdResources(undefined)).toEqual({})
  expect(psdMetadataToApp({} as Parameters<typeof psdMetadataToApp>[0])).toEqual({})
})
