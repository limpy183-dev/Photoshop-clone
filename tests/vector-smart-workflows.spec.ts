import { expect, test } from "@playwright/test"

import {
  addAnchorPointToPath,
  applyShapeBooleanOperation,
  createDefaultShapeAppearance,
  convertAnchorPoint,
  deleteNearestAnchorPoint,
  exportPathToSvgPath,
  fitFreeformPath,
  getRoundedRectCornerRadiusHandles,
  hitTestPathControls,
  movePathAnchor,
  movePathHandle,
  normalizeCornerRadii,
  pathContainsPoint,
  resizeShapeWithCornerRadii,
  resolveShapeBooleanPath,
  shapeToEditablePath,
  updateRoundedRectCornerRadius,
} from "../components/photoshop/vector-path-operations"
import { appShapeToPsd, psdShapeToApp } from "../components/photoshop/psd-vector-text"
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

test("rounded rectangle corner radius handles edit individual corners and survive PSD markers", () => {
  const rounded: ShapeProps = {
    type: "rect",
    x: 10,
    y: 20,
    w: 120,
    h: 80,
    fill: "#ffffff",
    stroke: null,
    cornerRadii: [6, 18, 30, 12],
  }

  const handles = getRoundedRectCornerRadiusHandles(rounded)
  const edited = updateRoundedRectCornerRadius(rounded, "br", { x: 96, y: 66 })
  const psd = appShapeToPsd(edited, 200, 160)
  const restored = psdShapeToApp({
    name: psd.markerName,
    vectorMask: psd.vectorMask,
    vectorFill: psd.vectorFill,
    vectorStroke: psd.vectorStroke,
  } as Parameters<typeof psdShapeToApp>[0])

  expect(handles.map((handle) => handle.corner)).toEqual(["tl", "tr", "br", "bl"])
  expect(handles[0]).toMatchObject({ corner: "tl", radius: 6, x: 16, y: 26 })
  expect(normalizeCornerRadii(edited)).toEqual([6, 18, 34, 12])
  expect(restored?.cornerRadii).toEqual([6, 18, 34, 12])
})

test("star smoothing can round outer corners independently from inner indents", () => {
  const outerOnly: ShapeProps = {
    type: "star",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    fill: "#ffffff",
    stroke: null,
    starPoints: 5,
    innerRadiusRatio: 0.42,
    vertexRoundness: 0.6,
    smoothCorners: true,
    smoothIndent: false,
  }
  const both: ShapeProps = { ...outerOnly, smoothIndent: true }

  const outerPath = shapeToEditablePath(outerOnly)
  const bothPath = shapeToEditablePath(both)
  const roundedOuter = outerPath.points.filter((point, index) => index % 2 === 0 && (point.cp1 || point.cp2))
  const roundedInner = outerPath.points.filter((point, index) => index % 2 === 1 && (point.cp1 || point.cp2))
  const bothInner = bothPath.points.filter((point, index) => index % 2 === 1 && (point.cp1 || point.cp2))

  expect(roundedOuter).toHaveLength(5)
  expect(roundedInner).toHaveLength(0)
  expect(bothInner).toHaveLength(5)
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
  expect(pathContainsPoint(shapeToEditablePath(combined), { x: 20, y: 20 })).toBe(true)
  expect(pathContainsPoint(shapeToEditablePath(combined), { x: 60, y: 40 })).toBe(false)
  expect(appearance.fills.map((fill) => fill.id)).toEqual(["fill-shadow", "fill-main"])
  expect(appearance.strokes.map((stroke) => stroke.alignment)).toEqual(["inside", "outside"])
})

test("boolean shape operations resolve to filled paths for unite subtract intersect and exclude", () => {
  const base: ShapeProps = { type: "rect", x: 0, y: 0, w: 100, h: 80, fill: "#112233", stroke: null }
  const operand: ShapeProps = { type: "rect", x: 60, y: 20, w: 60, h: 40, fill: "#ff0000", stroke: null }

  const subtract = resolveShapeBooleanPath(applyShapeBooleanOperation(base, operand, "subtract"), { tolerance: 4 })
  const intersect = resolveShapeBooleanPath(applyShapeBooleanOperation(base, operand, "intersect"), { tolerance: 4 })
  const exclude = resolveShapeBooleanPath(applyShapeBooleanOperation(base, operand, "exclude"), { tolerance: 4 })
  const unite = resolveShapeBooleanPath(applyShapeBooleanOperation(base, operand, "unite"), { tolerance: 4 })
  const hole = resolveShapeBooleanPath(
    applyShapeBooleanOperation(base, { type: "rect", x: 40, y: 20, w: 30, h: 30, fill: "#ff0000", stroke: null }, "subtract"),
    { tolerance: 4 },
  )

  expect(pathContainsPoint(subtract, { x: 10, y: 10 })).toBe(true)
  expect(pathContainsPoint(subtract, { x: 70, y: 30 })).toBe(false)
  expect(exportPathToSvgPath(hole).match(/\bM\b/g)?.length).toBeGreaterThan(1)
  expect(pathContainsPoint(intersect, { x: 70, y: 30 })).toBe(true)
  expect(pathContainsPoint(intersect, { x: 10, y: 10 })).toBe(false)
  expect(pathContainsPoint(exclude, { x: 10, y: 10 })).toBe(true)
  expect(pathContainsPoint(exclude, { x: 70, y: 30 })).toBe(false)
  expect(pathContainsPoint(unite, { x: 110, y: 30 })).toBe(true)
  expect(unite.points.length + (unite.subpaths?.reduce((sum, path) => sum + path.points.length, 0) ?? 0)).toBeGreaterThan(4)
})

test("boolean shape operations preserve fractional rectangle edges without grid quantization", () => {
  const base: ShapeProps = { type: "rect", x: 0, y: 0, w: 100, h: 80, fill: "#112233", stroke: null }
  const cutter: ShapeProps = { type: "rect", x: 33.5, y: 17.25, w: 21.5, h: 22.5, fill: "#ff0000", stroke: null }

  const path = resolveShapeBooleanPath(applyShapeBooleanOperation(base, cutter, "subtract"), { tolerance: 4 })
  const allPoints = [path, ...(path.subpaths ?? [])].flatMap((part) => part.points)

  expect(pathContainsPoint(path, { x: 10, y: 10 })).toBe(true)
  expect(pathContainsPoint(path, { x: 44, y: 28 })).toBe(false)
  expect(allPoints).toEqual(expect.arrayContaining([
    expect.objectContaining({ x: 33.5, y: 17.25 }),
    expect.objectContaining({ x: 55, y: 39.75 }),
  ]))
})

test("path handle editing supports symmetric and broken modes with subpath-aware hit testing", () => {
  const smooth = convertAnchorPoint({ closed: false, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] }, 1).path
  const movedIncoming = movePathHandle(smooth, 1, "in", { x: 35, y: -20 }, { mode: "symmetric" })
  const movedOutgoing = movePathHandle(movedIncoming, 1, "out", { x: 70, y: 25 }, { mode: "broken" })
  const compound = {
    closed: false,
    points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
    subpaths: [movedOutgoing],
  }
  const hit = hitTestPathControls(compound, { x: 70, y: 25 }, { maxHandleDistance: 6 })

  expect(movedIncoming.points[1].cp1).toEqual({ x: 35, y: -20 })
  expect(movedIncoming.points[1].cp2).toEqual({ x: 65, y: 20 })
  expect(movedIncoming.points[1].handleMode).toBe("symmetric")
  expect(movedOutgoing.points[1]).toMatchObject({ x: 50, y: 0, cp2: { x: 70, y: 25 } })
  expect(movedOutgoing.points[1].cp1).toEqual({ x: 35, y: -20 })
  expect(movedOutgoing.points[1].handleMode).toBe("broken")
  expect(hit).toMatchObject({ kind: "handle", subpathIndex: 0, pointIndex: 1, handle: "out" })
})

test("path anchor movement preserves relative Bezier handles for direct on-canvas edits", () => {
  const path = {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 40, cp1: { x: 35, y: 20 }, cp2: { x: 70, y: 60 }, handleMode: "broken" as const },
      { x: 100, y: 80 },
    ],
  }

  const moved = movePathAnchor(path, 1, { x: 64, y: 30 })

  expect(moved.points[1]).toMatchObject({
    x: 64,
    y: 30,
    cp1: { x: 49, y: 10 },
    cp2: { x: 84, y: 50 },
    handleMode: "broken",
  })
})

test("rounded rectangle radii scale across direct resize transforms", () => {
  const rounded: ShapeProps = {
    type: "rect",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    fill: "#ffffff",
    stroke: null,
    cornerRadii: [10, 20, 30, 40],
  }

  const doubled = resizeShapeWithCornerRadii(rounded, { x: 10, y: 20, w: 200, h: 160 })
  const squeezed = resizeShapeWithCornerRadii(doubled, { x: 10, y: 20, w: 80, h: 60 })

  expect(normalizeCornerRadii(doubled)).toEqual([20, 40, 60, 80])
  expect(normalizeCornerRadii(squeezed)).toEqual([8, 16, 24, 30])
  expect(shapeToEditablePath(squeezed).points.some((point) => point.cp1 || point.cp2)).toBe(true)
})

test("rounded rectangle direct resize transforms cached editable paths and handles", () => {
  const rounded: ShapeProps = {
    type: "rect",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    fill: "#ffffff",
    stroke: null,
    cornerRadii: [10, 14, 18, 22],
    computedPath: {
      closed: true,
      points: [
        { x: 10, y: 20, cp2: { x: 25, y: 20 } },
        { x: 110, y: 20 },
        { x: 110, y: 70, cp1: { x: 110, y: 58 } },
        { x: 10, y: 70 },
      ],
    },
  }

  const resized = resizeShapeWithCornerRadii(rounded, { x: 30, y: 40, w: 200, h: 100 })

  expect(resized.computedPath?.points[0]).toMatchObject({ x: 30, y: 40, cp2: { x: 60, y: 40 } })
  expect(resized.computedPath?.points[2]).toMatchObject({ x: 230, y: 140, cp1: { x: 230, y: 116 } })
})

test("freeform path fitting removes jitter and emits smooth Bezier handles", () => {
  const raw = [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 4, y: -1 },
    { x: 12, y: 4 },
    { x: 24, y: 10 },
    { x: 38, y: 9 },
    { x: 50, y: 16 },
  ]
  const fitted = fitFreeformPath(raw, { tolerance: 3, smoothness: 0.8 })

  expect(fitted.length).toBeLessThan(raw.length)
  expect(fitted.length).toBeGreaterThanOrEqual(3)
  expect(fitted.slice(1, -1).some((point) => point.cp1 || point.cp2)).toBe(true)
  expect(fitted[0]).toMatchObject({ x: 0, y: 0 })
  expect(fitted[fitted.length - 1]).toMatchObject({ x: 50, y: 16 })
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
