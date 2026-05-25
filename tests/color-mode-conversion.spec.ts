import { expect, test } from "@playwright/test"

import {
  buildIndexedColorTable,
  convertImageDataToDocumentMode,
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
