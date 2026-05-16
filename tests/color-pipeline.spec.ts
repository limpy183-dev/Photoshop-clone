import { expect, test } from "@playwright/test"

import {
  cmykToRgb,
  createHighBitImageFromImageData,
  describeColorPipeline,
  labToRgb,
  rgbToCmyk,
  rgbToLab,
  toneMapHighBitImageToImageData,
} from "../components/photoshop/color-pipeline"

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

test("high-bit pipeline stores 16-bit channel values and tone maps back to matching 8-bit preview", () => {
  const source = imageData(2, 1, [
    128, 64, 32, 255,
    255, 0, 17, 128,
  ])

  const highBit = createHighBitImageFromImageData(source, { bitDepth: 16, colorMode: "RGB", profile: "Adobe RGB (1998)" })
  const preview = toneMapHighBitImageToImageData(highBit)

  expect(highBit.bitDepth).toBe(16)
  expect(highBit.storage).toBe("uint16")
  expect(highBit.data[0]).toBeGreaterThan(32_000)
  expect(highBit.data[3]).toBe(65_535)
  expect(Array.from(preview.data)).toEqual(Array.from(source.data))
})

test("CMYK conversion uses black generation and round-trips neutral values predictably", () => {
  const cmyk = rgbToCmyk({ r: 128, g: 128, b: 128 }, { blackGeneration: "medium", totalInkLimit: 300 })
  const rgb = cmykToRgb(cmyk)

  expect(cmyk.k).toBeGreaterThan(0.45)
  expect(cmyk.c).toBeLessThan(0.08)
  expect(cmyk.m).toBeLessThan(0.08)
  expect(cmyk.y).toBeLessThan(0.08)
  expect(rgb.r).toBeGreaterThanOrEqual(120)
  expect(rgb.r).toBeLessThanOrEqual(136)
  expect(Math.abs(rgb.r - rgb.g)).toBeLessThanOrEqual(1)
})

test("Lab conversion provides a reversible D50-ish working transform for local color math", () => {
  const lab = rgbToLab({ r: 42, g: 120, b: 220 })
  const rgb = labToRgb(lab)

  expect(lab.l).toBeGreaterThan(45)
  expect(lab.l).toBeLessThan(55)
  expect(Math.abs(rgb.r - 42)).toBeLessThanOrEqual(2)
  expect(Math.abs(rgb.g - 120)).toBeLessThanOrEqual(2)
  expect(Math.abs(rgb.b - 220)).toBeLessThanOrEqual(2)
})

test("color pipeline descriptor distinguishes typed local depth from unsupported ICC-native conversion", () => {
  const report = describeColorPipeline({ bitDepth: 32, colorMode: "Lab", profile: "ProPhoto RGB" })

  expect(report.storage).toBe("float32")
  expect(report.supportsHighBitMath).toBe(true)
  expect(report.supportsIccTransforms).toBe(false)
  expect(report.warnings.join(" ")).toContain("not a full ICC transform engine")
})
