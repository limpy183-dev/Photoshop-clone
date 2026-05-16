import { expect, test } from "@playwright/test"

import {
  addAnchorPointToPath,
  convertAnchorPoint,
  deleteNearestAnchorPoint,
  exportPathToSvgPath,
  shapeToEditablePath,
} from "../components/photoshop/vector-path-operations"
import {
  applySmartObjectStackMode,
  convertSmartObjectToLayers,
  createSmartObjectEditDocument,
  reorderSmartFilters,
  saveSmartObjectEditDocumentBack,
} from "../components/photoshop/smart-objects"
import type { SmartFilter } from "../components/photoshop/types"
import { installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

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

test("vector anchor tools insert on the nearest segment, convert smooth handles, and export Bezier SVG path data", () => {
  const base = { closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }

  const inserted = addAnchorPointToPath(base, { x: 52, y: 4 })
  const converted = convertAnchorPoint(inserted.path, inserted.index)
  const deleted = deleteNearestAnchorPoint(converted.path, { x: 100, y: 0 }, 8)

  expect(inserted.index).toBe(1)
  expect(inserted.path.points[1]).toEqual({ x: 52, y: 0 })
  expect(converted.path.points[1].cp1).toBeTruthy()
  expect(converted.path.points[1].cp2).toBeTruthy()
  expect(deleted.removedIndex).toBe(2)
  expect(exportPathToSvgPath(converted.path)).toContain("C")
})

test("shape conversion creates editable path points for rounded rectangles and polygons", () => {
  const rounded = shapeToEditablePath({ type: "rect", x: 10, y: 20, w: 80, h: 40, fill: "#fff", stroke: null, radius: 12 })
  const triangle = shapeToEditablePath({ type: "polygon", x: 0, y: 0, w: 40, h: 40, fill: "#fff", stroke: null, sides: 3 })

  expect(rounded.closed).toBe(true)
  expect(rounded.points.some((point) => point.cp1 || point.cp2)).toBe(true)
  expect(triangle.points).toHaveLength(3)
})

test("smart object edit document saves back to the parent layer and convert-to-layers preserves source plus filter records", () => {
  installFixtureDom()
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.kind === "smart-object")!

  const editDoc = createSmartObjectEditDocument(doc, layer)
  const saved = saveSmartObjectEditDocumentBack(layer, editDoc)
  const layers = convertSmartObjectToLayers({ ...saved, smartFilters: [{ id: "sf", filterId: "box-blur", name: "Box Blur", enabled: true, params: { radius: 2 } }] })

  expect(editDoc.smartObjectParent).toEqual({ docId: doc.id, layerId: layer.id })
  expect(saved.smartSource?.width).toBe(editDoc.width)
  expect(saved.canvas.width).toBe(layer.canvas.width)
  expect(layers[0]).toMatchObject({ kind: "raster", name: expect.stringContaining("Contents") })
  expect(layers.some((item) => item.name.includes("Smart Filter"))).toBe(true)
})

test("smart object stack modes calculate deterministic image statistics", () => {
  const a = new ImageData(new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]), 2, 1)
  const b = new ImageData(new Uint8ClampedArray([30, 40, 50, 255, 100, 110, 120, 255]), 2, 1)
  const c = new ImageData(new Uint8ClampedArray([50, 60, 70, 255, 0, 10, 20, 255]), 2, 1)

  const mean = applySmartObjectStackMode([a, b, c], "mean")
  const median = applySmartObjectStackMode([a, b, c], "median")
  const range = applySmartObjectStackMode([a, b, c], "range")

  expect(Array.from(mean.data.slice(0, 8))).toEqual([30, 40, 50, 255, 100, 110, 120, 255])
  expect(Array.from(median.data.slice(0, 8))).toEqual([30, 40, 50, 255, 100, 110, 120, 255])
  expect(Array.from(range.data.slice(0, 4))).toEqual([40, 40, 40, 255])
})

test("smart filter reorder helper preserves masks and moves only the requested filter", () => {
  const filters: SmartFilter[] = [
    { id: "a", filterId: "box-blur", name: "Blur", enabled: true, params: { radius: 2 } },
    { id: "b", filterId: "sharpen", name: "Sharpen", enabled: true, params: { amount: 50 }, maskEnabled: false },
    { id: "c", filterId: "noise", name: "Noise", enabled: false, params: { amount: 10 } },
  ]

  const reordered = reorderSmartFilters(filters, "b", -1)

  expect(reordered.map((filter) => filter.id)).toEqual(["b", "a", "c"])
  expect(reordered[0].maskEnabled).toBe(false)
})
