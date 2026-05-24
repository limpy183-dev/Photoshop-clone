import { expect, test } from "@playwright/test"

import {
  applyChannelMixerToImageData,
  applyImageData,
  calculateChannelImageData,
  isApproximatelyOutOfGamut,
  parseAlphaChannelMetadata,
  simulateSpotChannelPreview,
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
