import { expect, test } from "@playwright/test"

import {
  applyChannelMixerToImageData,
  applyImageData,
  buildColorSeparationModel,
  calculateChannelImageData,
  composeSeparationPreview,
  composeSeparationProofView,
  isApproximatelyOutOfGamut,
  mergeChannelImageData,
  parseAlphaChannelMetadata,
  summarizeSeparationPlates,
  simulateSpotChannelPreview,
  splitImageDataChannels,
  softProofImageDataApprox,
} from "../components/photoshop/color-channel-ops"
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
  proofProfile: "Working CMYK",
  proofColors: true,
  gamutWarning: false,
}

test("channel mixer supports matrix constants and monochrome output", () => {
  const source = imageData(1, 1, [100, 20, 10, 255])
  const swapped = applyChannelMixerToImageData(source, {
    rR: 0, rG: 100, rB: 0, constantR: 10,
    gR: 0, gG: 100, gB: 0,
    bR: 0, bG: 0, bB: 100,
  })
  const mono = applyChannelMixerToImageData(source, {
    monochrome: true,
    grayR: 0,
    grayG: 100,
    grayB: 0,
    constantGray: 0,
  })

  expect(Array.from(swapped.data)).toEqual([46, 20, 10, 255])
  expect(Array.from(mono.data)).toEqual([20, 20, 20, 255])
})

test("apply image can target one channel from an inverted source channel with opacity", () => {
  const target = imageData(1, 1, [100, 100, 100, 255])
  const source = imageData(1, 1, [200, 20, 40, 255])

  const result = applyImageData(target, source, {
    sourceChannel: "red",
    targetChannel: "blue",
    blendMode: "normal",
    opacity: 0.5,
    invertSource: true,
  })

  expect(Array.from(result.data)).toEqual([100, 100, 78, 255])
})

test("apply image supports masks, scale/offset, and transparency preservation", () => {
  const transparent = imageData(1, 1, [10, 20, 30, 0])
  const target = imageData(1, 1, [100, 100, 100, 255])
  const source = imageData(1, 1, [200, 20, 40, 255])
  const halfMask = imageData(1, 1, [0, 0, 0, 128])

  const masked = applyImageData(target, source, {
    sourceChannel: "red",
    targetChannel: "blue",
    blendMode: "normal",
    opacity: 1,
    mask: halfMask,
    maskChannel: "alpha",
    scale: 1,
    offset: 0,
  })
  const preserved = applyImageData(transparent, source, {
    sourceChannel: "red",
    targetChannel: "rgb",
    preserveTransparency: true,
  })
  const scaled = applyImageData(target, source, {
    sourceChannel: "red",
    targetChannel: "red",
    blendMode: "normal",
    scale: 0.5,
    offset: 20,
  })

  expect(Array.from(masked.data)).toEqual([100, 100, 150, 255])
  expect(Array.from(preserved.data)).toEqual([10, 20, 30, 0])
  expect(Array.from(scaled.data)).toEqual([120, 100, 100, 255])
})

test("calculations creates a grayscale alpha result from two selected channels", () => {
  const a = imageData(1, 1, [128, 20, 0, 255])
  const b = imageData(1, 1, [0, 128, 0, 255])

  const result = calculateChannelImageData(a, b, {
    sourceChannelA: "red",
    sourceChannelB: "green",
    blendMode: "multiply",
    opacity: 1,
  })

  expect(Array.from(result.data)).toEqual([64, 64, 64, 255])
})

test("calculations supports masks plus scale and offset before alpha output", () => {
  const a = imageData(1, 1, [200, 0, 0, 255])
  const b = imageData(1, 1, [0, 100, 0, 255])
  const halfMask = imageData(1, 1, [0, 0, 0, 128])

  const result = calculateChannelImageData(a, b, {
    sourceChannelA: "red",
    sourceChannelB: "green",
    blendMode: "multiply",
    opacity: 1,
    mask: halfMask,
    maskChannel: "alpha",
    scale: 1,
    offset: 20,
  })

  expect(Array.from(result.data)).toEqual([149, 149, 149, 255])
})

test("split and merge channel image data preserve RGB and alpha plates", () => {
  const source = imageData(2, 1, [
    10, 20, 30, 40,
    200, 150, 100, 255,
  ])

  const split = splitImageDataChannels(source, { includeAlpha: true })
  const merged = mergeChannelImageData({
    red: split.red,
    green: split.green,
    blue: split.blue,
    alpha: split.alpha,
  })

  expect(Array.from(split.red.data.slice(0, 8))).toEqual([10, 10, 10, 255, 200, 200, 200, 255])
  expect(Array.from(split.alpha!.data.slice(0, 8))).toEqual([40, 40, 40, 255, 255, 255, 255, 255])
  expect(Array.from(merged.data)).toEqual(Array.from(source.data))
})

test("spot-channel metadata can come from explicit fields or the PSD naming convention", () => {
  expect(parseAlphaChannelMetadata({
    name: "Varnish",
    kind: "spot",
    spotColor: "#ffaa00",
    spotOpacity: 65,
  })).toMatchObject({
    baseName: "Varnish",
    kind: "spot",
    spotColor: "#ffaa00",
    spotOpacity: 65,
  })

  expect(parseAlphaChannelMetadata({
    name: "[spot:#00aaff:70]Cyan Highlight",
  })).toMatchObject({
    baseName: "Cyan Highlight",
    kind: "spot",
    spotColor: "#00aaff",
    spotOpacity: 70,
  })
})

test("spot preview simulates ink over the composite without replacing alpha pixels", () => {
  const base = imageData(1, 1, [100, 100, 100, 255])
  const mask = imageData(1, 1, [255, 255, 255, 128])

  const preview = simulateSpotChannelPreview(base, mask, {
    spotColor: "#ff0000",
    spotOpacity: 50,
  })

  expect(preview.data[0]).toBeGreaterThan(100)
  expect(preview.data[1]).toBeLessThan(100)
  expect(preview.data[2]).toBeLessThan(100)
  expect(preview.data[3]).toBe(255)
})

test("separation model builds typed CMYK process plates plus spot plates", () => {
  const source = {
    width: 2,
    height: 1,
    channels: 4 as const,
    bitDepth: 16 as const,
    colorMode: "RGB" as const,
    storage: "uint16" as const,
    data: new Uint16Array([
      65535, 0, 0, 65535,
      32768, 32768, 32768, 65535,
    ]),
    warnings: [],
  }
  const spot = imageData(2, 1, [
    0, 0, 0, 0,
    255, 255, 255, 255,
  ])

  const model = buildColorSeparationModel(source, {
    mode: "CMYK",
    processProfile: "U.S. Web Coated SWOP v2",
    spotChannels: [{ id: "spot_v", name: "Varnish", color: "#ffaa00", opacity: 65, mask: spot }],
  })
  const preview = composeSeparationPreview(model, { paper: "#ffffff" })

  expect(model.process).toBe("CMYK")
  expect(model.bitDepth).toBe(16)
  expect(model.plates.map((plate) => plate.name)).toEqual(["Cyan", "Magenta", "Yellow", "Black", "Varnish"])
  expect(model.plates[0].data).toBeInstanceOf(Uint16Array)
  expect(model.plates[1].data[0]).toBeGreaterThan(model.plates[0].data[0])
  expect(model.plates[2].data[0]).toBeGreaterThan(model.plates[0].data[0])
  expect(model.plates[3].data[1]).toBeGreaterThan(25_000)
  expect(model.plates[4].kind).toBe("spot")
  expect(model.coverage.totalInkMax).toBeLessThanOrEqual(320)
  expect(preview.data[4]).toBeGreaterThan(preview.data[5])
})

test("Lab and multichannel separation plates preserve signed color axes and channel toggles", () => {
  const source = imageData(1, 1, [42, 120, 220, 255])
  const lab = buildColorSeparationModel(source, { mode: "Lab" })
  const multi = buildColorSeparationModel(source, {
    mode: "Multichannel",
    multichannel: { red: true, green: false, blue: true },
  })

  expect(lab.process).toBe("Lab")
  expect(lab.plates.map((plate) => plate.name)).toEqual(["Lightness", "a", "b"])
  expect(lab.plates[0].data).toBeInstanceOf(Float32Array)
  expect(lab.plates[1].range).toEqual([-128, 127])
  expect(Number(lab.plates[2].data[0])).toBeLessThan(0)

  expect(multi.process).toBe("Multichannel")
  expect(multi.plates.map((plate) => plate.name)).toEqual(["Red", "Blue"])
  expect(multi.plates.every((plate) => plate.kind === "process")).toBe(true)
})

test("separation proof view can isolate process plates and report richer coverage stats", () => {
  const source = imageData(2, 1, [
    255, 0, 0, 255,
    128, 128, 128, 255,
  ])
  const model = buildColorSeparationModel(source, { mode: "CMYK", processProfile: "Working CMYK" })

  const cyanOnly = composeSeparationProofView(model, {
    visiblePlateIds: ["process_c"],
    paper: "#ffffff",
  })
  const blackMask = composeSeparationProofView(model, {
    isolatedPlateId: "process_k",
    viewMode: "mask",
  })
  const stats = summarizeSeparationPlates(model)

  expect(cyanOnly.data[0]).toBe(255)
  expect(cyanOnly.data[2]).toBe(255)
  expect(cyanOnly.data[4]).toBeLessThan(255)
  expect(blackMask.data[4]).toBeGreaterThan(100)
  expect(blackMask.data[5]).toBe(blackMask.data[4])
  expect(stats.find((plate) => plate.id === "process_k")).toEqual(
    expect.objectContaining({
      name: "Black",
      kind: "process",
      maxCoverage: expect.any(Number),
      averageCoverage: expect.any(Number),
    }),
  )
})

test("gamut warning and soft-proof helpers expose explicit browser approximation behavior", () => {
  const saturated = { r: 255, g: 0, b: 255 }
  const neutral = { r: 128, g: 128, b: 128 }
  const source = imageData(1, 1, [255, 0, 255, 255])
  const proofed = softProofImageDataApprox(source, cmykProof)

  expect(isApproximatelyOutOfGamut(saturated, { ...cmykProof, gamutWarning: true })).toBe(true)
  expect(isApproximatelyOutOfGamut(neutral, { ...cmykProof, gamutWarning: true })).toBe(false)
  expect(Array.from(proofed.data)).not.toEqual(Array.from(source.data))
  expect(proofed.data[3]).toBe(255)
})
