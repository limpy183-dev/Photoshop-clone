import { expect, test } from "@playwright/test"

import {
  addAnchorPointToPath,
  applyShapeBooleanOperation,
  createDefaultShapeAppearance,
  convertAnchorPoint,
  deleteNearestAnchorPoint,
  exportPathToSvgPath,
  movePathHandle,
  normalizeCornerRadii,
  shapeToEditablePath,
} from "../components/photoshop/vector-path-operations"
import {
  applySmartObjectStackMode,
  convertSmartObjectToLayers,
  createSmartObjectEditDocument,
  reorderSmartFilters,
  saveSmartObjectEditDocumentBack,
} from "../components/photoshop/smart-objects"
import type { ShapeProps, SmartFilter } from "../components/photoshop/types"
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

test("per-corner rectangle radii and star controls create editable geometry", () => {
  const rounded: ShapeProps = {
    type: "rect",
    x: 10,
    y: 20,
    w: 120,
    h: 80,
    fill: "#ffffff",
    stroke: null,
    cornerRadii: [6, 18, 30, 42],
  }
  const star: ShapeProps = {
    type: "star",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    fill: "#ffffff",
    stroke: null,
    starPoints: 7,
    innerRadiusRatio: 0.32,
    rotation: 15,
  }

  expect(normalizeCornerRadii(rounded)).toEqual([6, 18, 30, 40])
  expect(shapeToEditablePath(rounded).points.some((point) => point.cp1 || point.cp2)).toBe(true)
  expect(shapeToEditablePath(star).points).toHaveLength(14)
  expect(shapeToEditablePath(star).points[0].x).not.toBe(50)
})

test("boolean shape operations remain editable and appearance stacks preserve paint order", () => {
  const base: ShapeProps = { type: "rect", x: 10, y: 10, w: 100, h: 80, fill: "#112233", stroke: { color: "#ffffff", width: 2 } }
  const operand: ShapeProps = { type: "ellipse", x: 40, y: 20, w: 70, h: 70, fill: "#ff0000", stroke: null }
  const combined = applyShapeBooleanOperation(base, operand, "subtract")
  const appearance = createDefaultShapeAppearance({
    ...combined,
    appearance: {
      fills: [
        { id: "fill-shadow", enabled: true, color: "#000000", opacity: 0.35 },
        { id: "fill-main", enabled: true, color: "#44aaee", opacity: 1 },
      ],
      strokes: [
        { id: "stroke-inner", enabled: true, color: "#ffffff", width: 2, opacity: 1, alignment: "inside" },
        { id: "stroke-outer", enabled: true, color: "#111111", width: 6, opacity: 0.6, alignment: "outside" },
      ],
    },
  })

  expect(combined.components).toHaveLength(2)
  expect(combined.components?.[1].operation).toBe("subtract")
  expect(shapeToEditablePath(combined).subpaths).toHaveLength(2)
  expect(appearance.fills.map((fill) => fill.id)).toEqual(["fill-shadow", "fill-main"])
  expect(appearance.strokes.map((stroke) => stroke.alignment)).toEqual(["inside", "outside"])
})

test("path handle editing moves incoming and outgoing handles without losing anchor data", () => {
  const smooth = convertAnchorPoint({ closed: false, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] }, 1).path
  const movedIncoming = movePathHandle(smooth, 1, "in", { x: 35, y: -20 }, { mirror: true })
  const movedOutgoing = movePathHandle(movedIncoming, 1, "out", { x: 70, y: 25 }, { mirror: false })

  expect(movedIncoming.points[1].cp1).toEqual({ x: 35, y: -20 })
  expect(movedIncoming.points[1].cp2).toEqual({ x: 65, y: 20 })
  expect(movedOutgoing.points[1]).toMatchObject({ x: 50, y: 0, cp2: { x: 70, y: 25 } })
  expect(movedOutgoing.points[1].cp1).toEqual({ x: 35, y: -20 })
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
