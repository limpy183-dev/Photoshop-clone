import { expect, test } from "@playwright/test"

import {
  applyFloatBufferFilter,
  applyHighBitAdjustment,
  cmykToRgb,
  convertColorToRgb,
  convertRgbToColorMode,
  createHighBitImageFromImageData,
  createFloatBufferFromImageData,
  describeColorPipeline,
  grayscaleToRgb,
  labToRgb,
  rgbToGrayscale,
  rgbToCmyk,
  rgbToLab,
  toneMapFloatBufferToImageData,
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

test("RGB conversion helpers cover grayscale, CMYK, Lab, and RGB round trips", () => {
  const rgb = { r: 48, g: 128, b: 220 }
  const gray = rgbToGrayscale(rgb)
  const cmyk = convertRgbToColorMode(rgb, "CMYK")
  const lab = convertRgbToColorMode(rgb, "Lab")
  const same = convertRgbToColorMode(rgb, "RGB")

  expect(gray.gray).toBeGreaterThan(110)
  expect(gray.gray).toBeLessThan(135)
  expect(grayscaleToRgb(gray)).toEqual({ r: gray.gray, g: gray.gray, b: gray.gray })
  expect(convertColorToRgb(cmyk, "CMYK").r).toBeGreaterThan(40)
  expect(convertColorToRgb(lab, "Lab").b).toBeGreaterThan(210)
  expect(same).toEqual(rgb)
})

test("selected adjustments run directly on 16-bit integer buffers without first flattening to 8-bit", () => {
  const highBit = {
    width: 2,
    height: 1,
    channels: 4 as const,
    bitDepth: 16 as const,
    colorMode: "RGB" as const,
    storage: "uint16" as const,
    data: new Uint16Array([
      32768, 32769, 12000, 65535,
      32769, 32770, 12001, 65535,
    ]),
    warnings: [],
  }

  const adjusted = applyHighBitAdjustment(highBit, {
    type: "exposure",
    params: { ev: 0.1 },
  })

  expect(adjusted.storage).toBe("uint16")
  expect(adjusted.data).toBeInstanceOf(Uint16Array)
  expect(adjusted.data[0]).toBeGreaterThan(32768)
  expect(adjusted.data[1] - adjusted.data[0]).toBeGreaterThanOrEqual(1)
  expect(adjusted.data[3]).toBe(65535)
})

test("16-bit channel mixer uses high-range constants and channel math", () => {
  const source = createHighBitImageFromImageData(
    imageData(1, 1, [64, 128, 192, 255]),
    { bitDepth: 16, colorMode: "RGB" },
  )

  const mixed = applyHighBitAdjustment(source, {
    type: "channel-mixer",
    params: {
      rR: 0, rG: 100, rB: 0, constantR: 5,
      gR: 0, gG: 100, gB: 0, constantG: 0,
      bR: 0, bG: 0, bB: 100, constantB: 0,
    },
  })

  expect(mixed.storage).toBe("uint16")
  expect(mixed.data[0]).toBeGreaterThan(source.data[1])
  expect(mixed.data[0]).toBeLessThanOrEqual(65535)
  expect(mixed.data[2]).toBe(source.data[2])
})

test("selected filters can process float buffers before tone-mapping to canvas ImageData", () => {
  const source = imageData(3, 1, [
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])

  const floatBuffer = createFloatBufferFromImageData(source)
  const blurred = applyFloatBufferFilter(floatBuffer, "box-blur", { radius: 1 })
  const preview = toneMapFloatBufferToImageData(blurred)

  expect(blurred.storage).toBe("float32")
  expect(blurred.data[4]).toBeCloseTo(1 / 3, 4)
  expect(Array.from(preview.data.slice(4, 8))).toEqual([85, 85, 85, 255])
})
