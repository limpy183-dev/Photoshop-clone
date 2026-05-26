import { expect, test } from "@playwright/test"

import {
  buildIndexedColorTable,
  convertImageDataToDocumentMode,
  resolveBitmapScreenCellSize,
} from "../components/photoshop/color-mode-conversion"
import type { DocumentModeSettings } from "../components/photoshop/types"

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

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

test("indexed conversion uses editable color tables and keeps transparency when requested", () => {
  const source = imageData(3, 1, [
    248, 248, 248, 255,
    12, 18, 24, 255,
    128, 0, 0, 0,
  ])
  const settings: DocumentModeSettings = {
    mode: "Indexed",
    indexed: {
      colors: 2,
      dither: false,
      palette: "custom",
      transparency: true,
      colorTable: ["#000000", "#ffffff"],
    },
  }

  const converted = convertImageDataToDocumentMode(source, settings)

  expect(Array.from(converted.data)).toEqual([
    255, 255, 255, 255,
    0, 0, 0, 255,
    128, 0, 0, 0,
  ])
})

test("indexed color tables can be generated adaptively from image frequency", () => {
  const source = imageData(4, 1, [
    0, 0, 0, 255,
    0, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
  ])

  const table = buildIndexedColorTable(source, { colors: 2, palette: "adaptive" })

  expect(table[0]).toBe("#000000")
  expect(table).toContain("#ff0000")
})

test("bitmap conversion supports threshold, halftone, and diffusion dither methods", () => {
  const source = imageData(4, 1, [
    64, 64, 64, 255,
    127, 127, 127, 255,
    128, 128, 128, 255,
    224, 224, 224, 255,
  ])

  const threshold = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "threshold", threshold: 128, frequency: 10, angle: 45 },
  })
  const halftone = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 2, angle: 0, shape: "line" },
  })
  const diffusion = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "diffusion-dither", threshold: 128, frequency: 10, angle: 45 },
  })

  expect(Array.from(threshold.data)).toEqual([
    0, 0, 0, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ])
  expect(new Set([halftone.data[0], halftone.data[4], halftone.data[8], halftone.data[12]])).toEqual(new Set([0, 255]))
  expect(new Set([diffusion.data[0], diffusion.data[4], diffusion.data[8], diffusion.data[12]])).toEqual(new Set([0, 255]))
})

test("bitmap halftone controls derive screen cell size from output resolution and frequency", () => {
  expect(resolveBitmapScreenCellSize({ outputResolution: 600, frequency: 60 })).toBe(10)
  expect(resolveBitmapScreenCellSize({ outputResolution: 300, frequency: 75 })).toBe(4)
  expect(resolveBitmapScreenCellSize({ outputResolution: 72, frequency: 200 })).toBe(1)
})

test("bitmap halftone conversion honors resolution and screen shape controls", () => {
  const pixels = Array.from({ length: 8 * 8 }, (_, index) => {
    const x = index % 8
    const y = Math.floor(index / 8)
    const value = 72 + x * 14 + y * 9
    return [value, value, value, 255]
  }).flat()
  const source = imageData(8, 8, pixels)

  const coarseRound = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 0, outputResolution: 80, shape: "round" },
  })
  const fineRound = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 0, outputResolution: 20, shape: "round" },
  })
  const square = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 0, outputResolution: 40, shape: "square" },
  } as unknown as DocumentModeSettings)
  const cross = convertImageDataToDocumentMode(source, {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 0, outputResolution: 40, shape: "cross" },
  } as unknown as DocumentModeSettings)

  expect(Array.from(coarseRound.data)).not.toEqual(Array.from(fineRound.data))
  expect(Array.from(square.data)).not.toEqual(Array.from(cross.data))
  expect(new Set([square.data[0], square.data[4], cross.data[0], cross.data[4]])).toEqual(new Set([0, 255]))
})

test("duotone conversion uses paper-white highlights and inked shadows", () => {
  const source = imageData(2, 1, [
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])

  const converted = convertImageDataToDocumentMode(source, {
    mode: "Duotone",
    duotone: {
      ink1: "#000000",
      ink2: "#ff0000",
      ink1Name: "Black",
      ink2Name: "Warm Red",
      curve: 1,
      balance: 1,
      opacity1: 100,
      opacity2: 50,
    },
  })

  expect(Array.from(converted.data.slice(0, 4))).toEqual([255, 255, 255, 255])
  expect(converted.data[4]).toBeGreaterThan(converted.data[5])
  expect(converted.data[5]).toBe(0)
  expect(converted.data[6]).toBe(0)
})

test("duotone conversion supports paper color and multiply overprint inks", () => {
  const whiteAndBlack = imageData(2, 1, [
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])

  const paper = convertImageDataToDocumentMode(whiteAndBlack, {
    mode: "Duotone",
    duotone: {
      inkCount: 1,
      ink1: "#000000",
      ink2: "#000000",
      ink1Name: "Black",
      curve: 1,
      paper: "#f0e0c0",
      opacity1: 100,
    },
  } as unknown as DocumentModeSettings)

  expect(Array.from(paper.data.slice(0, 4))).toEqual([240, 224, 192, 255])

  const overprint = convertImageDataToDocumentMode(whiteAndBlack, {
    mode: "Duotone",
    duotone: {
      inkCount: 2,
      ink1: "#00ffff",
      ink2: "#ff00ff",
      ink1Name: "Cyan",
      ink2Name: "Magenta",
      curve: 1,
      opacity1: 100,
      opacity2: 100,
      overprint: "multiply",
    },
  } as unknown as DocumentModeSettings)

  expect(Array.from(overprint.data.slice(4, 8))).toEqual([0, 0, 255, 255])
})
