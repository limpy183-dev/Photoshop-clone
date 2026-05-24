import { expect, test } from "@playwright/test"

import { deserializeProject, serializeProject } from "../components/photoshop/document-io"
import { exportSmartObjectContents, replaceSmartObjectContents, smartObjectStatus } from "../components/photoshop/smart-objects"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

test("project round trip preserves rich app-only fixture metadata", async () => {
  const doc = richFixtureDocument()
  const restored = await deserializeProject(serializeProject(doc))

  expect(restored.layers).toHaveLength(4)
  expect(restored.guides?.[0]).toMatchObject({ orientation: "vertical", position: 20 })
  expect(restored.slices?.[0]).toMatchObject({ name: "Hero", w: 32, h: 24 })
  expect(restored.selectedSliceId).toBe("slice_1")
  expect(restored.comps?.[0].name).toBe("Hero Comp")
  expect(restored.channels?.[0].name).toBe("Alpha Fixture")
  expect(restored.assetLibrary?.[0]).toMatchObject({ name: "PNG Export", kind: "export" })
  expect(restored.selection.bounds).toEqual({ x: 8, y: 8, w: 24, h: 18 })
  expect(restored.selection.mask?.width).toBe(64)

  const raster = restored.layers.find((layer) => layer.id === "layer_raster")!
  expect(raster.mask?.width).toBe(64)
  expect(raster.smartFilters?.[0]).toMatchObject({ filterId: "box-blur", name: "Box Blur", maskEnabled: true })
  expect(raster.smartFilters?.[0].mask?.height).toBe(48)

  const text = restored.layers.find((layer) => layer.id === "layer_text")!
  expect(text.text).toMatchObject({ content: "Fixture", vertical: true, tracking: 20 })

  const smart = restored.layers.find((layer) => layer.id === "layer_smart")!
  expect(smart.smartSource).toMatchObject({
    id: "smart_source_product",
    linkType: "linked",
    fileName: "product-source.png",
    relativePath: "assets/product-source.png",
    status: "current",
    embedded: true,
  })
  expect(smart.smartSource?.canvas?.width).toBe(32)
})

test("project round trip preserves per-slice export settings", async () => {
  const doc = {
    ...richFixtureDocument(),
    slices: [
      {
        id: "slice_export",
        name: "Hero Card",
        x: 2,
        y: 3,
        w: 24,
        h: 12,
        format: "gif" as const,
        quality: 0.72,
        compression: 6,
        filename: "hero-card-mobile",
      },
    ],
    selectedSliceId: "slice_export",
  }

  const restored = await deserializeProject(serializeProject(doc))

  expect(restored.slices?.[0]).toMatchObject({
    format: "gif",
    quality: 0.72,
    compression: 6,
    filename: "hero-card-mobile",
  })
  expect(restored.selectedSliceId).toBe("slice_export")
})

test("smart object helpers track linked lifecycle, replacement, and export payloads", () => {
  const doc = richFixtureDocument()
  const smart = doc.layers.find((layer) => layer.id === "layer_smart")!

  expect(smartObjectStatus(smart)).toBe("current")

  const replacement = fixtureCanvas(20, 18, "#22cc88")
  const replaced = replaceSmartObjectContents(smart, replacement, {
    name: "replacement.png",
    fileName: "replacement.png",
    relativePath: "assets/replacement.png",
    linkType: "linked",
  })

  expect(replaced.kind).toBe("smart-object")
  expect(replaced.smartObject).toBe(true)
  expect(replaced.canvas.width).toBe(smart.canvas.width)
  expect(replaced.smartSource).toMatchObject({
    name: "replacement.png",
    fileName: "replacement.png",
    relativePath: "assets/replacement.png",
    linkType: "linked",
    status: "current",
    embedded: true,
    width: 20,
    height: 18,
  })

  const exported = exportSmartObjectContents(replaced)
  expect(exported?.filename).toBe("replacement.png")
  expect(exported?.width).toBe(20)
  expect(exported?.height).toBe(18)
  expect(exported?.dataUrl).toContain("data:image/png")

  const missing = { ...replaced, smartSource: { ...replaced.smartSource!, status: "missing" as const, canvas: null } }
  expect(smartObjectStatus(missing)).toBe("missing")
})
