import { expect, test } from "@playwright/test"

import {
  cursorForTool,
  labelForTool,
  normalizeViewRotation,
  resizePlainRect,
  resizeShapeRect,
  shapeHandles,
  shapePropsForTool,
  shapeRect,
} from "../components/photoshop/canvas-shape-helpers"
import type { ShapeProps } from "../components/photoshop/types"

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  })
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
})

test("tool labels and cursors retain current mappings and fallbacks", () => {
  expect(labelForTool("brush")).toBe("Brush Stroke")
  expect(labelForTool("remove-tool")).toBe("Remove Tool")
  expect(labelForTool("unknown-tool")).toBe("Edit")

  expect(cursorForTool("hand", false)).toBe("grab")
  expect(cursorForTool("zoom", false)).toBe("zoom-in")
  expect(cursorForTool("type", false)).toBe("text")
  expect(cursorForTool("move", false)).toBe("move")
  expect(cursorForTool("pen", false)).toBe("crosshair")
  expect(cursorForTool("path-select", false)).toBe("default")
  expect(cursorForTool("marquee-rect", false)).toBe("crosshair")
  expect(cursorForTool("unknown-tool", true)).toBe("none")
  expect(cursorForTool("unknown-tool", false)).toBe("default")
})

test("view rotation normalization retains modulo behavior", () => {
  expect(normalizeViewRotation(-90)).toBe(270)
  expect(normalizeViewRotation(0)).toBe(0)
  expect(normalizeViewRotation(450)).toBe(90)
  expect(normalizeViewRotation(720)).toBe(0)
})

test("shape construction retains ellipse polygon star triangle and custom contracts", () => {
  expect(shapePropsForTool("shape-ellipse", 1, 2, 30, 40, { x: 1, y: 2 }, { x: 31, y: 42 }, "#112233", "#445566")).toEqual({
    type: "ellipse",
    x: 1,
    y: 2,
    w: 30,
    h: 40,
    fill: "#112233",
    stroke: null,
    rotation: 0,
  })

  window.__psShapeOptions = {
    strokeWidth: 3,
    sides: 8,
    innerRadiusRatio: 0.35,
    vertexRoundness: 0.2,
    smoothCorners: true,
    smoothIndent: true,
    rotation: 15,
  }
  expect(shapePropsForTool("shape-polygon", 5, 6, 70, 80, { x: 5, y: 6 }, { x: 75, y: 86 }, "#abcdef", "#123456")).toEqual({
    type: "polygon",
    x: 5,
    y: 6,
    w: 70,
    h: 80,
    fill: "#abcdef",
    stroke: { color: "#123456", width: 3 },
    sides: 8,
    vertexRoundness: 0.2,
    smoothCorners: true,
    rotation: 15,
  })

  window.__psShapeOptions.polygonStarMode = true
  expect(shapePropsForTool("shape-polygon", 5, 6, 70, 80, { x: 5, y: 6 }, { x: 75, y: 86 }, "#abcdef", "#123456")).toMatchObject({
    type: "star",
    starPoints: 8,
    innerRadiusRatio: 0.35,
    vertexRoundness: 0.2,
    smoothCorners: true,
    smoothIndent: true,
    rotation: 15,
  })
  expect(shapePropsForTool("shape-triangle", 5, 6, 70, 80, { x: 5, y: 6 }, { x: 75, y: 86 }, "#abcdef", "#123456")).toMatchObject({
    type: "polygon",
    sides: 3,
    rotation: 15,
  })
  expect(shapePropsForTool("shape-star", 5, 6, 70, 80, { x: 5, y: 6 }, { x: 75, y: 86 }, "#abcdef", "#123456")).toMatchObject({
    type: "star",
    starPoints: 8,
    innerRadiusRatio: 0.35,
    rotation: 15,
  })

  window.__psCustomShape = "lightning"
  expect(shapePropsForTool("custom-shape", 5, 6, 70, 80, { x: 5, y: 6 }, { x: 75, y: 86 }, "#abcdef", "#123456")).toMatchObject({
    type: "custom",
    customId: "lightning",
    rotation: 15,
  })
})

test("rectangle construction retains stroke corner fallback and rounded radius behavior", () => {
  window.__psShapeOptions = {
    strokeWidth: 2,
    radius: 6,
    cornerRadiusTL: 1,
    cornerRadiusBR: 0,
    rotation: 12,
  }

  expect(shapePropsForTool("shape-rect", 10, 20, 100, 60, { x: 10, y: 20 }, { x: 110, y: 80 }, "#ffffff", "#000000")).toEqual({
    type: "rect",
    x: 10,
    y: 20,
    w: 100,
    h: 60,
    fill: "#ffffff",
    stroke: { color: "#000000", width: 2 },
    radius: 6,
    cornerRadii: [1, 6, 0, 6],
    rotation: 12,
  })

  window.__psShapeOptions = { radius: 0 }
  expect(shapePropsForTool("shape-rounded-rect", 0, 0, 20, 20, { x: 0, y: 0 }, { x: 20, y: 20 }, "#ffffff", "#000000").radius).toBe(18)

  window.__psShapeOptions = { radius: 2 }
  expect(shapePropsForTool("shape-rounded-rect", 0, 0, 20, 20, { x: 0, y: 0 }, { x: 20, y: 20 }, "#ffffff", "#000000").radius).toBe(4)
})

test("custom presets retain fitting fill stroke and rotation precedence", () => {
  const preset = {
    type: "rect",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    fill: "#old-fill",
    stroke: { color: "#old-stroke", width: 1 },
    radius: 2,
    cornerRadii: [2, 2, 2, 2],
    rotation: 25,
  } satisfies ShapeProps
  window.__psCustomShapePreset = preset
  window.__psShapeOptions = { strokeWidth: 2, rotation: 0 }

  expect(shapePropsForTool("custom-shape", 10, 20, 20, 30, { x: 10, y: 20 }, { x: 30, y: 50 }, "#new-fill", "#new-stroke")).toEqual({
    ...preset,
    x: 10,
    y: 20,
    w: 20,
    h: 30,
    fill: "#new-fill",
    stroke: { color: "#new-stroke", width: 2 },
    radius: 4,
    cornerRadii: [4, 4, 4, 4],
    rotation: 25,
    computedPath: undefined,
    components: undefined,
  })
})

test("shape bounds and direct handles retain current coordinates", () => {
  const shape = {
    type: "ellipse",
    x: 10,
    y: 20,
    w: 100,
    h: 60,
    fill: "#ffffff",
    stroke: null,
  } satisfies ShapeProps
  expect(shapeRect(shape)).toEqual({ x: 10, y: 20, w: 100, h: 60 })
  expect(shapeHandles(shapeRect(shape))).toEqual([
    { id: "nw", x: 10, y: 20 },
    { id: "ne", x: 110, y: 20 },
    { id: "se", x: 110, y: 80 },
    { id: "sw", x: 10, y: 80 },
    { id: "center", x: 60, y: 50 },
  ])
})

test("plain rectangle resizing retains translation crossing and minimum dimensions", () => {
  const rect = { x: 10, y: 20, w: 100, h: 60 }
  expect(resizePlainRect(rect, "center", { x: 0, y: 0 }, 5, -2)).toEqual({
    x: 15,
    y: 18,
    w: 100,
    h: 60,
  })
  expect(resizePlainRect(rect, "nw", { x: 120, y: 90 }, 0, 0)).toEqual({
    x: 110,
    y: 80,
    w: 10,
    h: 10,
  })
  expect(resizePlainRect(rect, "se", { x: 10, y: 20 }, 0, 0)).toEqual({
    x: 10,
    y: 20,
    w: 1,
    h: 1,
  })
})

test("shape resizing retains corner-radius scaling", () => {
  const shape = {
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    fill: "#ffffff",
    stroke: null,
    radius: 10,
    cornerRadii: [10, 20, 15, 5],
  } satisfies ShapeProps

  expect(resizeShapeRect(shape, "se", { x: 200, y: 100 }, 0, 0)).toEqual({
    ...shape,
    w: 200,
    h: 100,
    radius: 20,
    cornerRadii: [20, 40, 30, 10],
    computedPath: undefined,
    components: undefined,
  })
})
