import { expect, test } from "@playwright/test"

import { getNativeComposite, needsPixelBlend, compositeLayer } from "../components/photoshop/blend-modes"
import {
  buildAdaptivePalette,
  convertToBitmap,
  convertToDuotone,
  convertToIndexedColor,
  convertToMultichannel,
  createLinearDuotoneCurve,
  createSCurveDuotoneCurve,
  DUOTONE_PRESETS,
  WEB_SAFE_PALETTE,
} from "../components/photoshop/color-mode-engines"
import { flattenTransparencyCanvas, layerHasPartialAlpha } from "../components/photoshop/flatten-transparency"
import {
  DIRECT_HIGH_BIT_ADJUSTMENTS,
  HIGH_BIT_BLUR_FILTERS,
  HIGH_BIT_SHARPEN_FILTERS,
} from "../components/photoshop/high-bit-filter-sets"
import { DEFAULT_COLOR_MANAGEMENT } from "../components/photoshop/menus/color-management-defaults"
import { floodFillMask } from "../components/photoshop/tool-helpers/flood-fill"
import { perspectiveUnwarp } from "../components/photoshop/tool-helpers/perspective-liquify"
import { resolveBezierBooleanFallback } from "../components/photoshop/vector-bezier-boolean"
import type { Layer, PathProps } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function imageData(width: number, height: number, pixels: number[]) {
  installFixtureDom()
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function canvasWithPixels(width: number, height: number, pixels: number[]) {
  const canvas = fixtureCanvas(width, height)
  canvas.getContext("2d")!.putImageData(imageData(width, height, pixels), 0, 0)
  return canvas
}

function readPixels(canvas: HTMLCanvasElement) {
  return [...canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data]
}

function rectPath(x: number, y: number, w: number, h: number): PathProps {
  return {
    closed: true,
    source: "shape",
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  }
}

test("custom blend modes use pixel compositing when Canvas has no native operation", () => {
  expect(getNativeComposite("multiply")).toBe("multiply")
  expect(getNativeComposite("linear-dodge")).toBeNull()
  expect(needsPixelBlend("normal")).toBe(false)
  expect(needsPixelBlend("linear-dodge")).toBe(true)

  const dest = canvasWithPixels(1, 1, [100, 50, 0, 255])
  const src = canvasWithPixels(1, 1, [200, 240, 20, 255])
  const destCtx = dest.getContext("2d")! as CanvasRenderingContext2D & { canvas: HTMLCanvasElement }
  destCtx.canvas = dest

  compositeLayer(destCtx, src, "linear-dodge", 1)

  expect(readPixels(dest)).toEqual([255, 255, 20, 255])
})

test("flatten transparency mattes transparent pixels and reports alpha statistics", () => {
  const canvas = canvasWithPixels(2, 1, [
    100, 0, 0, 128,
    0, 0, 0, 0,
  ])

  const stats = flattenTransparencyCanvas(canvas, { matte: "#ffffff", alphaMode: "clear" })

  expect(stats).toEqual({ changedPixels: 2, transparentPixels: 1, semiTransparentPixels: 1 })
  expect(readPixels(canvas)).toEqual([
    177, 127, 127, 255,
    255, 255, 255, 255,
  ])
  expect(layerHasPartialAlpha({ canvas } as Layer)).toBe(false)
})

test("color mode engines convert duotone, bitmap, indexed, and multichannel data", () => {
  const source = imageData(2, 1, [
    0, 0, 0, 255,
    255, 255, 255, 128,
  ])

  const linear = createLinearDuotoneCurve("#804000", "Brown")
  const sCurve = createSCurveDuotoneCurve("#ffffff", "White")
  expect(linear.curve[0]).toBe(0)
  expect(linear.curve[255]).toBe(1)
  expect(sCurve.curve[128]).toBeGreaterThan(0.45)
  expect(DUOTONE_PRESETS.some((preset) => preset.settings.inks.length > 1)).toBe(true)

  const duotone = convertToDuotone(source, { mode: "monotone", inks: [linear], overprint: false })
  expect([...duotone.data]).toEqual([
    0, 0, 0, 255,
    128, 64, 0, 128,
  ])

  const bitmap = convertToBitmap(source, { method: "50-percent-threshold", threshold: 128 })
  expect([...bitmap.data]).toEqual([
    0, 0, 0, 255,
    255, 255, 255, 128,
  ])

  const indexed = convertToIndexedColor(source, {
    palette: "custom",
    colors: 2,
    forcedColors: ["#000000", "#ffffff"],
    transparency: true,
  })
  expect(indexed.colorTable.entries).toEqual(["#000000", "#ffffff"])
  expect([...indexed.imageData.data]).toEqual([
    0, 0, 0, 255,
    255, 255, 255, 128,
  ])

  expect(buildAdaptivePalette(source, 2)).toEqual(["#000000", "#ffffff"])
  expect(WEB_SAFE_PALETTE).toHaveLength(216)

  const multichannel = convertToMultichannel(source)
  expect(multichannel.channels.map((channel) => channel.name)).toEqual(["Cyan", "Magenta", "Yellow"])
  expect([...multichannel.channels[0].data]).toEqual([0, 255])
})

test("flood fill distinguishes contiguous regions from document-wide color matching", () => {
  const source = imageData(3, 1, [
    255, 0, 0, 255,
    0, 0, 255, 255,
    252, 0, 0, 255,
  ])

  const contiguous = floodFillMask(source, 0, 0, 10, true)
  const global = floodFillMask(source, 0, 0, 10, false)

  expect([contiguous.data[3], contiguous.data[7], contiguous.data[11]]).toEqual([255, 0, 0])
  expect([global.data[3], global.data[7], global.data[11]]).toEqual([255, 0, 255])
})

test("perspective unwarp samples a quadrilateral into a rectangular canvas", () => {
  const source = canvasWithPixels(2, 2, [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ])

  const out = perspectiveUnwarp(
    source,
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    2,
    2,
  )

  expect(readPixels(out)).toEqual(readPixels(source))
})

test("Bezier boolean fallback returns cloned closed paths for base-only components", () => {
  const path = rectPath(0, 0, 10, 10)
  const result = resolveBezierBooleanFallback([{ operation: "base", path }])

  expect(result?.closed).toBe(true)
  expect(result?.source).toBe("compound")
  expect(result?.points).toHaveLength(4)
  expect(result?.points[0]).toMatchObject({ x: 0, y: 0, cp1: { x: 0, y: 0 }, cp2: { x: 0, y: 0 }, handleMode: "broken" })
  expect(result?.points[0]).not.toBe(path.points[0])
})

test("high-bit and color-management constants expose the expected editing capabilities", () => {
  expect([...DIRECT_HIGH_BIT_ADJUSTMENTS]).toEqual(expect.arrayContaining(["curves", "threshold"]))
  expect([...HIGH_BIT_BLUR_FILTERS]).toEqual(expect.arrayContaining(["gaussian-blur", "tilt-shift"]))
  expect([...HIGH_BIT_SHARPEN_FILTERS]).toEqual(expect.arrayContaining(["unsharp-mask", "smart-sharpen"]))
  expect(DEFAULT_COLOR_MANAGEMENT).toMatchObject({
    assignedProfile: "sRGB IEC61966-2.1",
    renderingIntent: "relative-colorimetric",
    blackPointCompensation: true,
    proofPlateView: "composite",
  })
})
