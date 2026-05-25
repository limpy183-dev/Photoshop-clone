import { expect, test } from "@playwright/test"

import {
  applyFloatBufferFilter,
  applyHighBitAdjustment,
  applyIccTransformToImageData,
  buildGamutWarningMaskImageData,
  describeIccProfile,
  parseIccProfile,
  compareHighBitPixelToPreview,
  computeCanvasHistogram,
  computeHighBitHistogram,
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
  readHighBitPixel,
  softProofImageData,
  transformRgbColor,
  toneMapFloatBufferToImageData,
  toneMapHighBitImageToImageData,
} from "../components/photoshop/color-pipeline"
import {
  applyHighBitFilter,
  applyHighBitPaintDab,
  syncHighBitLayerFromCanvasDelta,
} from "../components/photoshop/high-bit-document"
import type { ColorManagementSettings } from "../components/photoshop/types"

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

const cmykProof: ColorManagementSettings = {
  assignedProfile: "sRGB IEC61966-2.1",
  workingSpace: "sRGB IEC61966-2.1",
  renderingIntent: "relative-colorimetric",
  blackPointCompensation: true,
  proofProfile: "U.S. Web Coated SWOP v2",
  proofColors: true,
  gamutWarning: true,
}

function ascii(text: string) {
  return Array.from(text, (char) => char.charCodeAt(0))
}

function fixed16(value: number) {
  return Math.round(value * 65536)
}

function u32be(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, false)
}

function s32be(view: DataView, offset: number, value: number) {
  view.setInt32(offset, value, false)
}

function pad4(value: number) {
  return Math.ceil(value / 4) * 4
}

function buildMatrixIccFixture(name: string, gamma: number) {
  const tags = [
    { sig: "desc", payload: (() => {
      const encoded = new TextEncoder().encode(name)
      const payload = new Uint8Array(pad4(12 + encoded.length + 1))
      const view = new DataView(payload.buffer)
      payload.set(ascii("desc"), 0)
      u32be(view, 8, encoded.length + 1)
      payload.set(encoded, 12)
      return payload
    })() },
    ...[
      ["rXYZ", [0.4360747, 0.2225045, 0.0139322]],
      ["gXYZ", [0.3850649, 0.7168786, 0.0971045]],
      ["bXYZ", [0.1430804, 0.0606169, 0.7141733]],
      ["wtpt", [0.96422, 1, 0.82521]],
    ].map(([sig, values]) => ({
      sig: sig as string,
      payload: (() => {
        const payload = new Uint8Array(20)
        const view = new DataView(payload.buffer)
        payload.set(ascii("XYZ "), 0)
        ;(values as number[]).forEach((value, index) => s32be(view, 8 + index * 4, fixed16(value)))
        return payload
      })(),
    })),
    ...["rTRC", "gTRC", "bTRC"].map((sig) => ({
      sig,
      payload: (() => {
        const payload = new Uint8Array(14)
        const view = new DataView(payload.buffer)
        payload.set(ascii("curv"), 0)
        u32be(view, 8, 1)
        view.setUint16(12, Math.round(gamma * 256), false)
        return payload
      })(),
    })),
  ]
  const tableOffset = 128
  const payloadOffset = tableOffset + 4 + tags.length * 12
  const total = payloadOffset + tags.reduce((sum, tag) => sum + pad4(tag.payload.length), 0)
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  u32be(view, 0, total)
  bytes.set(ascii("TEST"), 4)
  u32be(view, 8, 0x04300000)
  bytes.set(ascii("mntr"), 12)
  bytes.set(ascii("RGB "), 16)
  bytes.set(ascii("XYZ "), 20)
  bytes.set(ascii("acsp"), 36)
  bytes.set(ascii("APPL"), 40)
  u32be(view, tableOffset, tags.length)
  let dataOffset = payloadOffset
  tags.forEach((tag, index) => {
    const entry = tableOffset + 4 + index * 12
    bytes.set(ascii(tag.sig), entry)
    u32be(view, entry + 4, dataOffset)
    u32be(view, entry + 8, tag.payload.length)
    bytes.set(tag.payload, dataOffset)
    dataOffset += pad4(tag.payload.length)
  })
  return bytes
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
  expect(report.supportsIccTransforms).toBe(true)
  expect(report.warnings.join(" ")).toContain("browser-local ICC transform engine")
})

test("ICC profile transforms use profile matrices and round-trip RGB working spaces", () => {
  const adobeToSrgb = transformRgbColor(
    { r: 120, g: 200, b: 80 },
    { sourceProfile: "Adobe RGB (1998)", targetProfile: "sRGB IEC61966-2.1" },
  )
  const p3 = transformRgbColor(
    { r: 90, g: 160, b: 220 },
    { sourceProfile: "sRGB IEC61966-2.1", targetProfile: "Display P3" },
  )
  const backToSrgb = transformRgbColor(
    p3.rgb,
    { sourceProfile: "Display P3", targetProfile: "sRGB IEC61966-2.1" },
  )

  expect(adobeToSrgb.rgb.g).toBeGreaterThan(200)
  expect(adobeToSrgb.rgb.r).toBeLessThan(120)
  expect(adobeToSrgb.clipped).toBe(false)
  expect(Math.abs(backToSrgb.rgb.r - 90)).toBeLessThanOrEqual(2)
  expect(Math.abs(backToSrgb.rgb.g - 160)).toBeLessThanOrEqual(2)
  expect(Math.abs(backToSrgb.rgb.b - 220)).toBeLessThanOrEqual(2)
})

test("ICC parser builds matrix/TRC transforms from embedded profile bytes", () => {
  const gamma18Profile = buildMatrixIccFixture("Unit Test Matrix Gamma 1.8", 1.8)
  const parsed = parseIccProfile(gamma18Profile)
  const description = describeIccProfile(gamma18Profile)
  const converted = transformRgbColor(
    { r: 128, g: 128, b: 128 },
    { sourceProfileData: gamma18Profile, targetProfile: "sRGB IEC61966-2.1" },
  )
  const roundTrip = transformRgbColor(
    converted.rgb,
    { sourceProfile: "sRGB IEC61966-2.1", targetProfileData: gamma18Profile },
  )

  expect(parsed?.name).toBe("Unit Test Matrix Gamma 1.8")
  expect(parsed?.kind).toBe("rgb")
  expect(description?.colorSpace).toBe("RGB")
  expect(description?.connectionSpace).toBe("XYZ")
  expect(converted.rgb.r).toBeGreaterThan(128)
  expect(converted.clipped).toBe(false)
  expect(Math.abs(roundTrip.rgb.r - 128)).toBeLessThanOrEqual(2)
  expect(Math.abs(roundTrip.rgb.g - 128)).toBeLessThanOrEqual(2)
  expect(Math.abs(roundTrip.rgb.b - 128)).toBeLessThanOrEqual(2)
})

test("ICC image transform and soft proofing preserve alpha while using profile conversion math", () => {
  const source = imageData(2, 1, [
    120, 200, 80, 255,
    255, 0, 255, 127,
  ])

  const converted = applyIccTransformToImageData(source, {
    sourceProfile: "Adobe RGB (1998)",
    targetProfile: "sRGB IEC61966-2.1",
  })
  const proofed = softProofImageData(source, cmykProof)

  expect(Array.from(converted.data.slice(0, 3))).not.toEqual(Array.from(source.data.slice(0, 3)))
  expect(converted.data[3]).toBe(255)
  expect(proofed.data[4]).toBeLessThan(source.data[4])
  expect(proofed.data[5]).toBeGreaterThan(source.data[5])
  expect(proofed.data[7]).toBe(127)
})

test("gamut warning mask is driven by target profile conversion, not HSL heuristics", () => {
  const source = imageData(2, 1, [
    255, 0, 255, 255,
    128, 128, 128, 255,
  ])

  const mask = buildGamutWarningMaskImageData(source, cmykProof)

  expect(Array.from(mask.data.slice(0, 4))).toEqual([128, 0, 255, 210])
  expect(mask.data[7]).toBe(0)
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

test("float filter path exposes tonal adjustments without leaving Float32Array storage", () => {
  const floatBuffer = {
    width: 2,
    height: 1,
    channels: 4 as const,
    bitDepth: 32 as const,
    colorMode: "RGB" as const,
    storage: "float32" as const,
    data: new Float32Array([
      0.25, 0.25, 0.25, 1,
      0.75, 0.75, 0.75, 1,
    ]),
    warnings: [],
  }

  const leveled = applyFloatBufferFilter(floatBuffer, "levels", { inputBlack: 32, inputWhite: 224, gamma: 1, outputBlack: 0, outputWhite: 255 })
  const curved = applyFloatBufferFilter(floatBuffer, "curves", { points: "0,0;64,40;128,160;255,255" })
  const contrasted = applyFloatBufferFilter(floatBuffer, "brightness-contrast", { brightness: 10, contrast: 25 })

  expect(leveled.data).toBeInstanceOf(Float32Array)
  expect(leveled.data[0]).toBeLessThan(floatBuffer.data[0])
  expect(leveled.data[4]).toBeGreaterThan(floatBuffer.data[4])
  expect(curved.data[4]).toBeGreaterThan(floatBuffer.data[4])
  expect(contrasted.data[4]).toBeGreaterThan(floatBuffer.data[4])
})

test("high-bit curves and tone-mapping controls operate on float buffers before 8-bit preview", () => {
  const source = {
    width: 3,
    height: 1,
    channels: 4 as const,
    bitDepth: 32 as const,
    colorMode: "RGB" as const,
    storage: "float32" as const,
    data: new Float32Array([
      0.2, 0.2, 0.2, 1,
      0.5, 0.5, 0.5, 1,
      0.8, 0.8, 0.8, 1,
    ]),
    warnings: [],
  }

  const adjusted = applyHighBitAdjustment(source, {
    type: "curves",
    params: { shadows: -20, midtones: 28, highlights: 12 },
  })
  const preview = toneMapHighBitImageToImageData(adjusted, { exposure: 0.5, gamma: 2 })

  expect(adjusted.data).toBeInstanceOf(Float32Array)
  expect(adjusted.data[0]).toBeLessThan(source.data[0])
  expect(adjusted.data[4]).toBeGreaterThan(source.data[4])
  expect(adjusted.data[8]).toBeGreaterThan(source.data[8])
  expect(preview.data[4]).toBeGreaterThan(180)
})

test("histogram helpers expose canvas 256-bin and high-bit native-bin distributions", () => {
  const canvasHistogram = computeCanvasHistogram(imageData(2, 1, [
    0, 64, 128, 255,
    255, 128, 0, 255,
  ]))
  expect(canvasHistogram.bins).toBe(256)
  expect(canvasHistogram.channels.red[0]).toBe(1)
  expect(canvasHistogram.channels.red[255]).toBe(1)
  expect(canvasHistogram.channels.green[64]).toBe(1)
  expect(canvasHistogram.stats.pixels).toBe(2)

  const highBit16 = computeHighBitHistogram({
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    storage: "uint16",
    data: new Uint16Array([
      0, 32768, 65535, 65535,
      65535, 32768, 0, 65535,
    ]),
    warnings: [],
  })
  expect(highBit16.bins).toBe(65536)
  expect(highBit16.channels.red[0]).toBe(1)
  expect(highBit16.channels.red[65535]).toBe(1)
  expect(highBit16.channels.green[32768]).toBe(2)

  const floatHistogram = computeHighBitHistogram({
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    storage: "float32",
    data: new Float32Array([
      0, 0.25, 1, 1,
      2, 0.5, 0, 1,
    ]),
    warnings: [],
  }, { floatBins: 1024, floatMax: 2 })
  expect(floatHistogram.bins).toBe(1024)
  expect(floatHistogram.channels.red[0]).toBe(1)
  expect(floatHistogram.channels.red[1023]).toBe(1)
  expect(floatHistogram.stats.maxValue).toBe(2)
})

test("high-bit pixel readout returns source typed-array values without canvas quantization", () => {
  const source = {
    width: 2,
    height: 1,
    channels: 4 as const,
    bitDepth: 16 as const,
    colorMode: "RGB" as const,
    storage: "uint16" as const,
    data: new Uint16Array([
      1234, 32768, 65535, 65535,
      17, 18, 19, 65535,
    ]),
    warnings: [],
  }

  expect(readHighBitPixel(source, 0, 0)).toEqual({
    r: 1234,
    g: 32768,
    b: 65535,
    a: 65535,
    normalized: {
      r: expect.closeTo(1234 / 65535, 6),
      g: expect.closeTo(32768 / 65535, 6),
      b: 1,
      a: 1,
    },
  })
  expect(readHighBitPixel(source, 4, 4)).toBeNull()
})

test("high-bit filter routing preserves typed-array precision for routable filters", () => {
  const source = {
    width: 3,
    height: 1,
    channels: 4 as const,
    bitDepth: 16 as const,
    colorMode: "RGB" as const,
    storage: "uint16" as const,
    data: new Uint16Array([
      0, 0, 0, 65535,
      32768, 32769, 12000, 65535,
      65535, 65535, 65535, 65535,
    ]),
    warnings: [],
  }

  const blurred = applyHighBitFilter(source, "gaussian-blur", { radius: 1 })
  const inverted = applyHighBitFilter(source, "invert", {})

  expect(blurred.storage).toBe("uint16")
  expect(blurred.data).toBeInstanceOf(Uint16Array)
  expect(blurred.data[4]).toBeGreaterThan(10_000)
  expect(blurred.data[5] - blurred.data[4]).toBeGreaterThanOrEqual(0)
  expect(inverted.data[0]).toBe(65535)
  expect(inverted.data[8]).toBe(0)
  expect(blurred.warnings.join(" ")).not.toContain("8-bit fallback")
})

test("high-bit paint dabs and canvas delta sync update typed layer sources", () => {
  const source = createHighBitImageFromImageData(
    imageData(2, 1, [
      0, 0, 0, 255,
      128, 128, 128, 255,
    ]),
    { bitDepth: 16, colorMode: "RGB" },
  )

  const painted = applyHighBitPaintDab(source, {
    x: 0,
    y: 0,
    radius: 0.75,
    color: { r: 10, g: 20, b: 30, a: 255 },
    opacity: 1,
    mode: "source-over",
  })

  expect(painted.storage).toBe("uint16")
  expect(painted.data[0]).toBe(10 * 257)
  expect(painted.data[1]).toBe(20 * 257)
  expect(painted.data[2]).toBe(30 * 257)
  expect(painted.data[4]).toBe(source.data[4])

  const before = imageData(2, 1, [
    10, 20, 30, 255,
    128, 128, 128, 255,
  ])
  const after = imageData(2, 1, [
    10, 20, 30, 255,
    240, 12, 8, 128,
  ])
  const synced = syncHighBitLayerFromCanvasDelta(painted, before, after)

  expect(synced.data[0]).toBe(painted.data[0])
  expect(synced.data[4]).toBe(240 * 257)
  expect(synced.data[5]).toBe(12 * 257)
  expect(synced.data[7]).toBe(128 * 257)
})

test("high-bit readout comparison reports source preview and quantization delta", () => {
  const source = {
    width: 1,
    height: 1,
    channels: 4 as const,
    bitDepth: 16 as const,
    colorMode: "RGB" as const,
    storage: "uint16" as const,
    data: new Uint16Array([32769, 12000, 65535, 65535]),
    warnings: [],
  }
  const preview = imageData(1, 1, [128, 47, 255, 255])

  const comparison = compareHighBitPixelToPreview(source, preview, 0, 0)

  expect(comparison?.source.r).toBe(32769)
  expect(comparison?.preview.r).toBe(128)
  expect(comparison?.previewEquivalent.r).toBeGreaterThan(32700)
  expect(Math.abs(comparison!.delta.r)).toBeLessThanOrEqual(200)
})
