import { expect, test } from "@playwright/test"

import {
  applyTransformContext,
  clampTransformSkew,
  finiteOr,
  pickTransformHandle,
  pointInTransformBox,
  transformCorners,
  transformHandles,
  transformOrigin,
  transformPoint,
  transformedBounds,
  type TransformDragState,
  type TransformReferencePoint,
} from "../components/photoshop/canvas-transform-geometry"

function transformState(overrides: Partial<TransformDragState> = {}): TransformDragState {
  return {
    layerId: "layer-1",
    source: null,
    bounds: { x: 10, y: 20, w: 100, h: 60 },
    tx: 0,
    ty: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    ...overrides,
  }
}

test("finite values and transform skew retain current coercion and bounds", () => {
  expect(finiteOr("12.5", 4)).toBe(12.5)
  expect(finiteOr("not-a-number", 4)).toBe(4)
  expect(finiteOr(null, 4)).toBe(0)
  expect(clampTransformSkew(-120)).toBe(-89)
  expect(clampTransformSkew(22)).toBe(22)
  expect(clampTransformSkew(120)).toBe(89)
})

test("transform origins cover all reference-point positions", () => {
  const expected: Record<TransformReferencePoint, { x: number; y: number }> = {
    tl: { x: 10, y: 20 },
    tc: { x: 60, y: 20 },
    tr: { x: 110, y: 20 },
    ml: { x: 10, y: 50 },
    mc: { x: 60, y: 50 },
    mr: { x: 110, y: 50 },
    bl: { x: 10, y: 80 },
    bc: { x: 60, y: 80 },
    br: { x: 110, y: 80 },
  }

  for (const [referencePoint, origin] of Object.entries(expected)) {
    expect(transformOrigin(transformState({ referencePoint: referencePoint as TransformReferencePoint }))).toEqual(origin)
  }
  expect(transformOrigin(transformState())).toEqual(expected.mc)
})

test("transform points and bounds retain translation and non-uniform scale math", () => {
  const state = transformState({
    tx: 5,
    ty: -3,
    scaleX: 2,
    scaleY: 0.5,
  })

  expect(transformPoint(state, { x: 10, y: 20 })).toEqual({ x: -35, y: 32 })
  expect(transformPoint(state, { x: 110, y: 80 })).toEqual({ x: 165, y: 62 })
  expect(transformedBounds(state)).toEqual({ x: -35, y: 32, w: 200, h: 30 })
})

test("rotation, skew, and perspective retain numeric transform output", () => {
  const rotated = transformState({
    referencePoint: "tl",
    rotation: 90,
    skewX: 45,
    skewY: 0,
  })
  const point = transformPoint(rotated, { x: 20, y: 30 })
  expect(point.x).toBeCloseTo(0, 8)
  expect(point.y).toBeCloseTo(40, 8)

  const perspective = transformState({
    perspective: {
      tl: { x: 1, y: 2 },
      tr: { x: 3, y: 4 },
      br: { x: 5, y: 6 },
      bl: { x: 7, y: 8 },
    },
  })
  expect(transformCorners(perspective)).toEqual([
    { x: 11, y: 22 },
    { x: 113, y: 24 },
    { x: 115, y: 86 },
    { x: 17, y: 88 },
  ])
})

test("transform handles and hit testing keep current positions and strict radius", () => {
  const state = transformState()
  expect(transformHandles(state)).toEqual([
    { x: 10, y: 20, id: "nw" },
    { x: 60, y: 20, id: "n" },
    { x: 110, y: 20, id: "ne" },
    { x: 110, y: 50, id: "e" },
    { x: 110, y: 80, id: "se" },
    { x: 60, y: 80, id: "s" },
    { x: 10, y: 80, id: "sw" },
    { x: 10, y: 50, id: "w" },
    { x: 60, y: -4, id: "rotate" },
  ])

  expect(pickTransformHandle({ x: 17.999, y: 27.999 }, state)).toBe("nw")
  expect(pickTransformHandle({ x: 18, y: 28 }, state)).toBeNull()
  expect(pickTransformHandle({ x: 60, y: -4 }, state)).toBe("rotate")
})

test("transform box hit testing keeps polygon boundary behavior", () => {
  const state = transformState()
  expect(pointInTransformBox({ x: 60, y: 50 }, state)).toBe(true)
  expect(pointInTransformBox({ x: 109.999, y: 50 }, state)).toBe(true)
  expect(pointInTransformBox({ x: 110, y: 50 }, state)).toBe(false)
  expect(pointInTransformBox({ x: 111, y: 50 }, state)).toBe(false)
})

test("canvas transform context retains interpolation settings and mutation order", () => {
  const calls: Array<[string, ...number[]]> = []
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    translate: (x: number, y: number) => calls.push(["translate", x, y]),
    rotate: (angle: number) => calls.push(["rotate", angle]),
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      calls.push(["transform", a, b, c, d, e, f]),
    scale: (x: number, y: number) => calls.push(["scale", x, y]),
  } as unknown as CanvasRenderingContext2D
  const state = transformState({
    tx: 5,
    ty: -3,
    rotation: 30,
    scaleX: 2,
    scaleY: 0.5,
    skewX: 10,
    skewY: -15,
    referencePoint: "tl",
    interpolation: "bilinear",
  })

  applyTransformContext(context, state)

  expect(context.imageSmoothingEnabled).toBe(true)
  expect(context.imageSmoothingQuality).toBe("medium")
  expect(calls).toEqual([
    ["translate", 15, 17],
    ["rotate", Math.PI / 6],
    ["transform", 1, Math.tan(-15 * Math.PI / 180), Math.tan(10 * Math.PI / 180), 1, 0, 0],
    ["scale", 2, 0.5],
    ["translate", -10, -20],
  ])

  applyTransformContext(context, transformState({ interpolation: "nearest" }))
  expect(context.imageSmoothingEnabled).toBe(false)
  expect(context.imageSmoothingQuality).toBe("low")
})
