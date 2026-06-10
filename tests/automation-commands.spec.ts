import { expect, test } from "@playwright/test"

import {
  conditionalModeChange,
  estimatePurgeSize,
  fitImageData,
  fitImageDimensions,
  flattenTransparency,
  generateCSS,
  generateSVGDocument,
  generateSVGPath,
  shouldChangeMode,
} from "../components/photoshop/automation-commands"
import { installFixtureDom } from "./photoshop-fixtures"

test.beforeAll(() => {
  installFixtureDom()
})

test.afterAll(() => {
  Reflect.deleteProperty(globalThis, "document")
})

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

test("fit image dimensions preserve aspect ratio and avoid enlargement when requested", () => {
  expect(fitImageDimensions(4000, 2000, { maxWidth: 1000, maxHeight: 1000 })).toEqual({
    width: 1000,
    height: 500,
    scale: 0.25,
  })
  expect(fitImageDimensions(100, 50, {
    maxWidth: 1000,
    maxHeight: 1000,
    dontEnlarge: true,
  })).toEqual({
    width: 100,
    height: 50,
    scale: 1,
  })
  expect(fitImageDimensions(400, 200, {
    maxWidth: 300,
    maxHeight: 80,
    constrainProportions: false,
  })).toEqual({
    width: 300,
    height: 80,
    scale: 0.4,
  })
})

test("fit image data returns a copy at the same size and bilinearly interpolates resized pixels", () => {
  const source = imageData(2, 2, [
    0, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    255, 255, 255, 255,
  ])
  const copied = fitImageData(source, { maxWidth: 2, maxHeight: 2 })
  const resized = fitImageData(source, { maxWidth: 3, maxHeight: 3 })

  expect(copied).not.toBe(source)
  expect(Array.from(copied.data)).toEqual(Array.from(source.data))
  expect(resized.width).toBe(3)
  expect(resized.height).toBe(3)
  expect(Array.from(resized.data.slice(16, 20))).toEqual([128, 128, 64, 255])
})

test("conditional mode changes normalize display labels and avoid no-op conversions", () => {
  expect(shouldChangeMode("RGB Color", { sourceMode: "rgb", targetMode: "cmyk" })).toBe(true)
  expect(shouldChangeMode("CMYK", { sourceMode: "rgb", targetMode: "lab" })).toBe(false)
  expect(shouldChangeMode("Lab Color", { sourceMode: "any", targetMode: "lab" })).toBe(false)
  expect(conditionalModeChange("Indexed Color", { sourceMode: "any", targetMode: "rgb" })).toBe("rgb")
  expect(conditionalModeChange("RGB", { sourceMode: "rgb", targetMode: "rgb" })).toBeNull()
})

test("purge estimates cover every supported target with an explicit cache description", () => {
  for (const target of ["undo", "clipboard", "histories", "video-cache", "all"] as const) {
    expect(estimatePurgeSize(target)).toMatch(/^~.+\(.+\)$/)
  }
})

test("flatten transparency composites RGB against the requested background and forces alpha opaque", () => {
  const flattened = flattenTransparency(imageData(2, 1, [
    200, 100, 50, 128,
    20, 40, 60, 0,
  ]), [10, 20, 30])

  expect(Array.from(flattened.data)).toEqual([
    105, 60, 40, 255,
    10, 20, 30, 255,
  ])
})

test("CSS generation emits only configured visual properties and preserves gradient order", () => {
  const css = generateCSS({
    width: 120,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#112233",
    opacity: 0.75,
    rotation: -15,
    dropShadow: { offsetX: 2, offsetY: 4, blur: 8, color: "rgba(0,0,0,.4)" },
    stroke: { color: "#ffffff", width: 3 },
    gradientOverlay: {
      type: "linear",
      angle: 45,
      stops: [{ color: "#000000", position: 0 }, { color: "#ffffff", position: 1 }],
    },
  })

  expect(css.split("\n")).toEqual([
    "width: 120px;",
    "height: 80px;",
    "border-radius: 12px;",
    "background-color: #112233;",
    "opacity: 0.75;",
    "transform: rotate(-15deg);",
    "box-shadow: 2px 4px 8px rgba(0,0,0,.4);",
    "border: 3px solid #ffffff;",
    "background: linear-gradient(45deg, #000000 0%, #ffffff 100%);",
  ])
  expect(generateCSS({ width: 1, height: 2, opacity: 1, rotation: 0 })).toBe("width: 1px;\nheight: 2px;")
})

test("SVG path generation handles lines, quadratic controls, cubic controls, and closure", () => {
  expect(generateSVGPath([])).toBe("")
  expect(generateSVGPath([
    { x: 0, y: 0, cp2: { x: 5, y: 10 } },
    { x: 20, y: 20 },
    { x: 40, y: 0, cp1: { x: 25, y: 30 }, cp2: { x: 35, y: 10 } },
  ], true)).toBe(
    "M 0 0 Q 5 10, 20 20 C 25 30, 35 10, 40 0 Z",
  )
})

test("SVG document generation emits viewBox, fill defaults, and optional stroke width", () => {
  expect(generateSVGDocument(80, 40, "M 0 0 L 80 40", "#ff0000", "#000000", 2)).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40">\n' +
    '  <path d="M 0 0 L 80 40" fill="#ff0000" stroke="#000000" stroke-width="2" />\n' +
    "</svg>",
  )
  expect(generateSVGDocument(1, 1, "M 0 0")).toContain('fill="none"')
})
