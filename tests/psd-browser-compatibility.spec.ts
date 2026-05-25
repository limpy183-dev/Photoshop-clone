import { expect, test } from "@playwright/test"

import {
  applyPsdAppPreservationPayload,
  createPsdNativeSourceSnapshot,
  createPsdAppPreservationPayload,
  createPsdExportActionPlan,
  createPsdRepairPlanFromParsedPsd,
  embedPsdAppPreservationInXmp,
  extractPsdAppPreservationFromXmp,
  restorePsdNativeSourceSnapshot,
} from "../components/photoshop/psd-compatibility"
import { createEmbeddedFontFromBuffer } from "../components/photoshop/typography-engine"
import { createLargeDocumentInspectionDocument, planLargeDocumentOpen } from "../components/photoshop/large-document"
import type { Layer, PsDocument } from "../components/photoshop/types"
import type { Psd } from "ag-psd"
import { fixtureCanvas, fixtureMask, installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

test("PSD app-preservation payload restores app-only layer data without marker names", async () => {
  installFixtureDom()
  const doc = richFixtureDocument()
  const raster = doc.layers.find((layer) => layer.id === "layer_raster")!
  const text = doc.layers.find((layer) => layer.id === "layer_text")!
  raster.notes = [{ id: "note_1", text: "Keep this editable", createdAt: 1_800_000_000_001 }]
  raster.metadata = { tags: ["review"], custom: { owner: "design" } }
  raster.smartFilters = [
    {
      id: "sf_camera_blur",
      filterId: "box-blur",
      name: "Box Blur",
      enabled: true,
      opacity: 0.62,
      blendMode: "screen",
      params: { radius: 5 },
      mask: fixtureMask(64, 48),
      maskEnabled: false,
      maskDensity: 0.7,
      maskFeather: 3,
    },
  ]
  text.text = {
    ...text.text!,
    variableAxes: { wght: 712 },
    openType: { ligatures: true, stylisticAlternates: true },
    textPath: [{ x: 4, y: 6 }, { x: 30, y: 18 }],
  }

  const payload = createPsdAppPreservationPayload(doc)
  const xmp = embedPsdAppPreservationInXmp(undefined, payload)
  const extracted = extractPsdAppPreservationFromXmp(xmp)
  expect(extracted?.layers).toHaveLength(doc.layers.length)

  const imported: PsDocument = {
    ...doc,
    layers: doc.layers.map((layer): Layer => ({
      ...layer,
      id: `imported_${layer.id}`,
      notes: undefined,
      metadata: undefined,
      smartFilters: undefined,
      text: layer.text ? { ...layer.text, variableAxes: undefined, openType: undefined, textPath: undefined } : undefined,
    })),
  }

  await applyPsdAppPreservationPayload(imported, extracted!)
  const restoredRaster = imported.layers[0]
  const restoredText = imported.layers[1]
  expect(restoredRaster.notes?.[0].text).toBe("Keep this editable")
  expect(restoredRaster.metadata?.custom?.owner).toBe("design")
  expect(restoredRaster.smartFilters?.[0]).toMatchObject({
    filterId: "box-blur",
    opacity: 0.62,
    blendMode: "screen",
    maskEnabled: false,
    maskDensity: 0.7,
    maskFeather: 3,
  })
  expect(restoredRaster.smartFilters?.[0].mask?.width).toBe(64)
  expect(restoredText.text?.variableAxes?.wght).toBe(712)
  expect(restoredText.text?.openType?.stylisticAlternates).toBe(true)
  expect(restoredText.text?.textPath).toEqual([{ x: 4, y: 6 }, { x: 30, y: 18 }])
})

test("PSD app-preservation embeds used local font files and restores them as library assets", async () => {
  installFixtureDom()
  const doc = richFixtureDocument()
  const font = createEmbeddedFontFromBuffer(
    "Fixture Sans",
    "fixture-sans.ttf",
    new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]).buffer,
    "font/ttf",
  )
  doc.layers[1].text = { ...doc.layers[1].text!, font: "Fixture Sans", embeddedFont: font }
  doc.assetLibrary = [
    ...(doc.assetLibrary ?? []),
    { id: "asset_font_fixture", name: "Fixture Sans", kind: "font", group: "Local Fonts", payload: font, createdAt: 1_800_000_000_002 },
  ]

  const payload = createPsdAppPreservationPayload(doc)
  const xmp = embedPsdAppPreservationInXmp(undefined, payload)
  const extracted = extractPsdAppPreservationFromXmp(xmp)!
  const imported: PsDocument = {
    ...doc,
    assetLibrary: [],
    layers: doc.layers.map((layer) => ({
      ...layer,
      text: layer.text ? { ...layer.text, embeddedFont: undefined } : undefined,
    })),
  }

  expect(extracted.fonts?.map((entry) => entry.family)).toEqual(["Fixture Sans"])
  expect(xmp).toContain("AppPreservation")

  await applyPsdAppPreservationPayload(imported, extracted)

  expect(imported.assetLibrary?.some((asset) => asset.kind === "font" && asset.name === "Fixture Sans")).toBe(true)
  expect(imported.layers[1].text?.embeddedFont?.dataBase64).toBe(font.dataBase64)
})

test("PSD export action plan itemizes rasterized, approximated, and project-only elements", () => {
  const doc = richFixtureDocument()
  doc.layers.push({
    id: "layer_video",
    name: "Launch Clip",
    kind: "video",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(64, 48, "#202020"),
    video: {
      sourceName: "launch.mov",
      durationMs: 2000,
      currentTimeMs: 500,
      playbackRate: 1,
      inPointMs: 0,
      outPointMs: 2000,
      keyframes: [],
    },
  })
  doc.plugins = [{ id: "cep", name: "CEP Panel", kind: "cep-panel", enabled: true, createdAt: 1 }]

  const plan = createPsdExportActionPlan(doc)

  expect(plan.summary).toContain("rasterized")
  expect(plan.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ layerName: "Masked Raster", status: "rasterized", label: "Smart filters" }),
    expect.objectContaining({ layerName: "Editable Text", status: "approximated", label: "Extended text controls" }),
    expect.objectContaining({ layerName: "Launch Clip", status: "rasterized", label: "Video layer" }),
    expect.objectContaining({ status: "project-only", label: "Plugin descriptors" }),
  ]))
})

test("PSD native source snapshots restore exact source bytes for unmodified native exports", () => {
  const source = new Uint8Array([
    0x38, 0x42, 0x50, 0x53,
    0x00, 0x02,
    0, 0, 0, 0, 0, 0,
    0x00, 0x04,
    0, 0, 0, 1,
    0, 0, 0, 1,
    0x00, 0x10,
    0x00, 0x04,
  ])
  const snapshot = createPsdNativeSourceSnapshot(source.buffer, "source.psb", {
    format: "psb",
    width: 1,
    height: 1,
    colorMode: "CMYK",
    bitDepth: 16,
  })

  expect(snapshot?.byteLength).toBe(source.byteLength)
  expect(snapshot?.checksum.length).toBeGreaterThan(8)
  expect(snapshot?.data.length).toBeGreaterThan(source.byteLength)

  const restored = restorePsdNativeSourceSnapshot(snapshot!)
  expect(Array.from(restored ?? [])).toEqual(Array.from(source))
})

test("large document recovery plans carry parsed PSD structure into inspection documents", () => {
  installFixtureDom()
  const plan = planLargeDocumentOpen({
    fileName: "oversized.psd",
    kind: "psd",
    width: 18000,
    height: 12000,
    layerCount: 42,
    parsedStructure: {
      layerCount: 42,
      colorMode: "CMYK",
      bitDepth: 16,
      resources: ["gridAndGuidesInformation", "layerComps"],
      repairableItems: ["Artboard Group -> local artboard layer", "Video Preview -> local video layer"],
    },
  })

  expect(plan.parsedStructure?.layerCount).toBe(42)
  expect(plan.warnings.join("\n")).toContain("42 parsed layers")

  const doc = createLargeDocumentInspectionDocument({
    fileName: "oversized.psd",
    kind: "psd",
    width: plan.width,
    height: plan.height,
    reason: "PSD parsed, but full pixels exceed browser canvas limits.",
    warnings: plan.warnings,
    parsedStructure: plan.parsedStructure,
  })

  expect(doc.metadata?.largeDocumentInspection?.parsedStructure).toMatchObject({
    layerCount: 42,
    colorMode: "CMYK",
    bitDepth: 16,
  })
  expect(doc.layers[0].metadata?.custom?.repairableItems).toBe(2)
})

test("PSD repair plan identifies unsupported parsed structures that can be represented locally", () => {
  const parsed = {
    width: 800,
    height: 600,
    bitsPerChannel: 16,
    colorMode: 4,
    imageResources: {
      gridAndGuidesInformation: { guides: [{ location: 320, direction: "vertical" }] },
      layerComps: { list: [{ id: 1, name: "Comp", capturedInfo: 5 }] },
      slices: [{ bounds: { left: 0, top: 0, right: 800, bottom: 600 }, groupName: "Slices", slices: [] }],
    },
    children: [
      {
        name: "Artboard Group",
        artboard: { rect: { left: 10, top: 12, right: 410, bottom: 312 }, backgroundType: 1 },
        children: [],
      },
      {
        name: "Vector Smart",
        placedLayer: { id: "smart_1", placed: "logo.ai", type: "vector", transform: [0, 0, 100, 0, 100, 100, 0, 100] },
      },
      {
        name: "Video Preview",
        pixelSource: {
          type: "vdPS",
          origin: { x: 0, y: 0 },
          interpretation: { interpretAlpha: "straight", profile: new Uint8Array() },
          frameReader: {
            type: "QTFR",
            link: { name: "clip.mov", fullPath: "/clip.mov", originalPath: "/clip.mov", relativePath: "clip.mov", alias: "" },
            mediaDescriptor: "fixture",
          },
          showAlteredVideo: true,
        },
      },
    ],
  } as unknown as Psd

  const repair = createPsdRepairPlanFromParsedPsd(parsed)

  expect(repair.actions.map((action) => action.label)).toEqual(expect.arrayContaining([
    "Artboard Group",
    "Vector Smart",
    "Video Preview",
    "Guides",
    "Layer comps",
  ]))
  expect(repair.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Artboard Group", localRepresentation: "artboard layer" }),
    expect.objectContaining({ label: "Vector Smart", localRepresentation: "smart object placeholder" }),
    expect.objectContaining({ label: "Video Preview", localRepresentation: "video layer" }),
  ]))
})
