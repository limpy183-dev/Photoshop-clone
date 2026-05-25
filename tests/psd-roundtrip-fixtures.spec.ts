import { expect, test } from "@playwright/test"

import { createDocumentReport, serializePsd } from "../components/photoshop/document-io"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { fixtureCanvas, fixtureMask, richFixtureDocument } from "./photoshop-fixtures"

test("PSD report classifies rich app-only fixture metadata without overclaiming", () => {
  const doc = richFixtureDocument()
  const report = createDocumentReport(doc, "PSD Export")
  const byLabel = new Map(report.items.map((item) => [item.label, item]))

  expect(byLabel.get("Text layers")?.status).toBe("approximated")
  expect(byLabel.get("Shape layers")?.status).toBe("approximated")
  expect(byLabel.get("Layer styles")?.status).toBe("approximated")
  expect(byLabel.get("Smart filters")?.status).toBe("approximated")
  expect(byLabel.get("Layer comps")?.status).toBe("unsupported")
  expect(byLabel.get("Guides")?.status).toBe("unsupported")
  expect(byLabel.get("Slices")?.status).toBe("unsupported")
  expect(byLabel.get("Smart object sources")?.status).toBe("approximated")
  expect(byLabel.get("Linked smart objects")?.status).toBe("approximated")
  expect(byLabel.get("PSD interoperability boundary")?.detail).toContain("raster-compatible approximation")
})

test("PSD serialization produces a Photoshop blob for fixture documents", async () => {
  const blob = await serializePsd(richFixtureDocument())

  expect(blob.type).toBe("image/vnd.adobe.photoshop")
  expect(blob.size).toBeGreaterThan(0)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("8BPS")
})

test("PSD serialization emits native smart object linkedFiles and smart filter descriptors", async () => {
  const doc = richFixtureDocument()
  doc.colorMode = "RGB"
  doc.bitDepth = 8
  doc.modeSettings = { mode: "RGB" }
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!
  smart.smartFilters = [
    {
      id: "sf_native_blur",
      filterId: "gaussian-blur",
      name: "Gaussian Blur",
      enabled: true,
      opacity: 0.8,
      blendMode: "normal",
      params: { radius: 4 },
      mask: fixtureMask(doc.width, doc.height),
      maskEnabled: true,
    },
  ]

  const blob = await serializePsd(doc)
  const { readPsd } = await import("ag-psd")
  const arrayBuffer = await blob.arrayBuffer()
  const payloadText = new TextDecoder("latin1").decode(new Uint8Array(arrayBuffer))
  const psd = readPsd(arrayBuffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    useImageData: false,
  })
  const layers: import("ag-psd").Layer[] = []
  const visit = (children: import("ag-psd").Layer[] | undefined) => {
    for (const child of children ?? []) {
      layers.push(child)
      visit(child.children)
    }
  }
  visit(psd.children)
  const smartPsdLayer = layers.find((layer) => layer.name === smart.name)

  expect(smartPsdLayer?.placedLayer?.id).toBeTruthy()
  expect(payloadText).toContain("lnk2")
  expect(payloadText).toContain("lnkE")
  expect(smartPsdLayer?.placedLayer?.filter?.list[0]).toMatchObject({
    type: "gaussian blur",
    name: "Gaussian Blur",
    opacity: 0.8,
  })
  expect(smartPsdLayer?.filterEffectsMasks?.[0].id).toBe("sf_native_blur")
})

function richPsdCompatibilityFixture(): PsDocument {
  const doc = richFixtureDocument()
  const adjustment: Layer = {
    id: "layer_adjustment",
    name: "Curves Adjustment",
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 0.72,
    blendMode: "soft-light",
    canvas: fixtureCanvas(64, 48, "#808080"),
    mask: fixtureMask(64, 48),
    maskEnabled: true,
    adjustment: { type: "curves", params: { shadows: -8, midtones: 6, highlights: 12 } },
  }
  const group: Layer = {
    id: "group_creative",
    name: "Creative Group",
    kind: "group",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(64, 48, "#000000"),
    childIds: [doc.layers[0].id, adjustment.id],
    expanded: true,
  }

  return {
    ...doc,
    layers: [
      { ...doc.layers[0], parentId: group.id },
      { ...adjustment, parentId: group.id },
      group,
      ...doc.layers.slice(1),
    ],
  }
}

test("PSD report itemizes blend modes, groups, masks, text, styles, and adjustments", () => {
  const report = createDocumentReport(richPsdCompatibilityFixture(), "PSD Export")
  const byLabel = new Map(report.items.map((item) => [item.label, item]))

  expect(byLabel.get("Blend modes")?.status).toBe("approximated")
  expect(byLabel.get("Blend modes")?.detail).toContain("multiply")
  expect(byLabel.get("Blend modes")?.detail).toContain("soft-light")
  expect(byLabel.get("Groups")?.status).toBe("approximated")
  expect(byLabel.get("Groups")?.detail).toContain("child relationship")
  expect(byLabel.get("Masks")?.status).toBe("preserved")
  expect(byLabel.get("Text layers")?.status).toBe("approximated")
  expect(byLabel.get("Layer styles")?.status).toBe("approximated")
  expect(byLabel.get("Adjustment layers")?.status).toBe("approximated")
  expect(byLabel.get("Adjustment layers")?.detail).toContain("current visual result")
})
