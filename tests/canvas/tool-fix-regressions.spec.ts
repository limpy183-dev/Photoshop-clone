import { expect, test } from "@playwright/test"

import { shapePropsForTool, snapViewRotation } from "@/editor/canvas/shape-helpers"
import { zoomAnchoredPan } from "@/editor/canvas/viewport-controller"
import { toneRangeWeight } from "@/editor/tool/helpers/retouch-stamps"
import { translateVectorLayerGeometry } from "@/editor/canvas/vector-editing"
import type { Layer } from "@/editor/types"

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} })
})

/* ---- rectangle tool corner radii ---- */

test("plain rectangle tool ignores the rounded-rect corner radii the options bar seeds", () => {
  // ShapeOptions writes all four corner radii even while their inputs are
  // hidden, which used to give the Rectangle tool rounded corners.
  window.__psShapeOptions = {
    radius: 18,
    cornerRadiusTL: 18,
    cornerRadiusTR: 18,
    cornerRadiusBR: 18,
    cornerRadiusBL: 18,
  }
  const rect = shapePropsForTool("shape-rect", 0, 0, 100, 50, { x: 0, y: 0 }, { x: 100, y: 50 }, "#fff", "#000")
  expect(rect.radius).toBe(0)
  expect(rect.cornerRadii).toBeUndefined()

  const rounded = shapePropsForTool("shape-rounded-rect", 0, 0, 100, 50, { x: 0, y: 0 }, { x: 100, y: 50 }, "#fff", "#000")
  expect(rounded.radius).toBeGreaterThan(0)
  expect(rounded.cornerRadii).toEqual([18, 18, 18, 18])
})

/* ---- rotate view snapping ---- */

test("snapViewRotation locks onto 15-degree steps near them and stays free elsewhere", () => {
  expect(snapViewRotation(88)).toBe(90)
  expect(snapViewRotation(31.5)).toBe(30)
  expect(snapViewRotation(178)).toBe(180)
  expect(snapViewRotation(-2)).toBe(0)
  // Outside the threshold rotation stays continuous.
  expect(snapViewRotation(37)).toBeCloseTo(37)
  // Shift forces the snap regardless of distance.
  expect(snapViewRotation(37, true)).toBe(30)
})

/* ---- zoom anchored at the cursor ---- */

test("zoomAnchoredPan holds the anchor point still across a zoom change", () => {
  const center = { x: 400, y: 300 }
  const anchor = { x: 700, y: 500 }
  const pan = { x: 0, y: 0 }
  const from = 1
  const to = 2
  const next = zoomAnchoredPan(pan, anchor, center, from, to)

  // Screen position of the anchor is stageCentre + pan + zoom * (anchor - centre).
  const screenBefore = {
    x: pan.x + from * (anchor.x - center.x),
    y: pan.y + from * (anchor.y - center.y),
  }
  const screenAfter = {
    x: next.x + to * (anchor.x - center.x),
    y: next.y + to * (anchor.y - center.y),
  }
  expect(screenAfter.x).toBeCloseTo(screenBefore.x)
  expect(screenAfter.y).toBeCloseTo(screenBefore.y)
})

test("zoomAnchoredPan leaves pan untouched when zooming about the centre", () => {
  const next = zoomAnchoredPan({ x: 10, y: -4 }, { x: 50, y: 50 }, { x: 50, y: 50 }, 1, 3)
  expect(next).toEqual({ x: 10, y: -4 })
})

/* ---- dodge / burn tonal range ---- */

test("toneRangeWeight confines each range to its own tones", () => {
  // Midtones peak at mid grey and fall away at both ends — this is what stops
  // dodge from driving highlights straight to white.
  expect(toneRangeWeight(0.5, "midtones")).toBeCloseTo(1)
  expect(toneRangeWeight(1, "midtones")).toBe(0)
  expect(toneRangeWeight(0, "midtones")).toBe(0)

  expect(toneRangeWeight(0, "shadows")).toBeCloseTo(1)
  expect(toneRangeWeight(1, "shadows")).toBe(0)

  expect(toneRangeWeight(1, "highlights")).toBeCloseTo(1)
  expect(toneRangeWeight(0, "highlights")).toBe(0)
})

/* ---- path selection moves geometry, not just pixels ---- */

test("translateVectorLayerGeometry shifts path points and their bezier handles", () => {
  const layer = {
    id: "l1",
    path: {
      closed: false,
      points: [
        { x: 10, y: 10, cp2: { x: 15, y: 10 } },
        { x: 30, y: 30, cp1: { x: 25, y: 30 } },
      ],
    },
  } as unknown as Layer

  expect(translateVectorLayerGeometry(layer, 5, -3)).toBe(true)
  expect(layer.path!.points[0]).toMatchObject({ x: 15, y: 7, cp2: { x: 20, y: 7 } })
  expect(layer.path!.points[1]).toMatchObject({ x: 35, y: 27, cp1: { x: 30, y: 27 } })
})

test("translateVectorLayerGeometry moves a shape layer's origin and reports no-ops", () => {
  const layer = { id: "l2", shape: { type: "rect", x: 4, y: 8, w: 10, h: 10 } } as unknown as Layer
  expect(translateVectorLayerGeometry(layer, 6, 2)).toBe(true)
  expect(layer.shape).toMatchObject({ x: 10, y: 10 })

  expect(translateVectorLayerGeometry(layer, 0, 0)).toBe(false)
  expect(translateVectorLayerGeometry({ id: "raster" } as unknown as Layer, 3, 3)).toBe(false)
})
