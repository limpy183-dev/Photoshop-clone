import { expect, test } from "@playwright/test"

import {
  collectImageAssetGeneratorPlan,
  createImageAssetGeneratorReport,
  createImageAssetGeneratorSignature,
  exportImageAssetsToZip,
  parseImageAssetLayerName,
  shouldRunImageAssetGenerator,
} from "../components/photoshop/image-assets-generator"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { createStoredZipBlob } from "../components/photoshop/zip-packaging"
import { fixtureCanvas, installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

function generatorDoc(layers: Layer[]): PsDocument {
  return {
    ...richFixtureDocument(),
    id: "doc_generator",
    name: "Generator Test",
    width: 64,
    height: 48,
    colorMode: "RGB",
    bitDepth: 8,
    layers,
    activeLayerId: layers[0]?.id ?? "",
    selectedLayerIds: layers[0] ? [layers[0].id] : [],
    metadata: {
      imageAssetGenerator: {
        enabled: true,
        autoExportOnSave: true,
        autoExportOnChange: true,
      },
    },
  }
}

function layer(id: string, name: string, fill = "#3366cc"): Layer {
  return {
    id,
    name,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(16, 12, fill),
  }
}

test("image asset generator parses comma-separated layer-name specs with scales and formats", () => {
  const parsed = parseImageAssetLayerName("icon.png, 200% icon@2x.png, 0.5x preview.webp, 150% sprites/menu.jpg")

  expect(parsed.assets).toEqual([
    { sourceText: "icon.png", filename: "icon.png", scale: 1, format: "png", extension: "png" },
    { sourceText: "200% icon@2x.png", filename: "icon@2x.png", scale: 2, format: "png", extension: "png" },
    { sourceText: "0.5x preview.webp", filename: "preview.webp", scale: 0.5, format: "webp", extension: "webp" },
    { sourceText: "150% sprites/menu.jpg", filename: "sprites/menu.jpg", scale: 1.5, format: "jpeg", extension: "jpg" },
  ])
  expect(parsed.issues).toEqual([])
})

test("image asset generator reports invalid layer-name exports and duplicate targets", () => {
  installFixtureDom()
  const doc = generatorDoc([
    layer("icon", "icon.png, 200% icon@2x.png"),
    layer("duplicate", "icon.png"),
    layer("invalid", "../escape.png, zero% nope.png, bad.svg"),
    layer("plain", "Regular Layer Name"),
  ])

  const plan = collectImageAssetGeneratorPlan(doc)

  expect(plan.assets.map((asset) => `${asset.layerId}:${asset.filename}:${asset.scale}:${asset.format}`)).toEqual([
    "icon:icon.png:1:png",
    "icon:icon@2x.png:2:png",
  ])
  expect(plan.issues.map((issue) => `${issue.kind}:${issue.filename ?? issue.layerName}`)).toEqual([
    "conflict:icon.png",
    "conflict:icon.png",
    "invalid:../escape.png",
    "invalid:nope.png",
    "invalid:bad.svg",
  ])
})

test("image asset generator exports entries, creates reports, and gates save/change autoruns", async () => {
  installFixtureDom()
  const doc = generatorDoc([
    layer("button", "button.png, 50% button-small.webp", "#cc6633"),
  ])
  const plan = collectImageAssetGeneratorPlan(doc)
  const signature = createImageAssetGeneratorSignature(doc)

  expect(shouldRunImageAssetGenerator({ trigger: "save", plan, settings: doc.metadata?.imageAssetGenerator })).toBe(true)
  expect(shouldRunImageAssetGenerator({ trigger: "change", plan, settings: doc.metadata?.imageAssetGenerator, previousSignature: signature, currentSignature: signature })).toBe(false)
  expect(shouldRunImageAssetGenerator({
    trigger: "change",
    plan,
    settings: doc.metadata?.imageAssetGenerator,
    previousSignature: signature,
    currentSignature: createImageAssetGeneratorSignature({ ...doc, layers: [{ ...doc.layers[0], name: "renamed.png" }] }),
  })).toBe(true)

  const result = await exportImageAssetsToZip(doc, { trigger: "save" })
  const report = createImageAssetGeneratorReport(doc, result)
  const zip = createStoredZipBlob(result.entries)

  expect(result.entries.map((entry) => entry.name)).toEqual(["button.png", "button-small.webp"])
  expect(result.written.map((asset) => `${asset.filename}:${asset.outputWidth}x${asset.outputHeight}`)).toEqual([
    "button.png:16x12",
    "button-small.webp:8x6",
  ])
  expect(zip.type).toBe("application/zip")
  expect(report.source).toBe("Image Assets Generator")
  expect(report.items.some((item) => item.label === "Generated assets" && item.status === "preserved")).toBe(true)
})
