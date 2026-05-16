import { expect, test } from "@playwright/test"

import {
  compositeFilterImageData,
  getFilter,
} from "../components/photoshop/filters"

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

function fixture3x3() {
  return imageData(3, 3, [
    10, 20, 30, 255, 70, 80, 90, 255, 130, 120, 100, 255,
    35, 55, 85, 255, 125, 135, 145, 255, 220, 210, 180, 255,
    20, 90, 60, 255, 155, 80, 45, 255, 245, 245, 230, 255,
  ])
}

function applyFilter(id: string, params: Record<string, number | string | boolean>) {
  const filter = getFilter(id)
  expect(filter, id).toBeTruthy()
  return filter!.apply(fixture3x3(), params)
}

function dataOf(image: ImageData) {
  return Array.from(image.data)
}

test("filter algorithms match deterministic tiny-image goldens", () => {
  const cases: Array<[
    string,
    Record<string, number | string | boolean>,
    number[],
  ]> = [
    ["blur-more", {}, [
      74, 86, 81, 255, 97, 104, 96, 255, 120, 122, 111, 255,
      82, 97, 88, 255, 106, 116, 105, 255, 131, 135, 121, 255,
      89, 108, 95, 255, 116, 128, 114, 255, 143, 148, 132, 255,
    ]],
    ["sharpen", { amount: 100 }, [
      0, 0, 0, 255, 15, 45, 85, 255, 100, 70, 30, 255,
      0, 0, 105, 255, 145, 250, 255, 255, 255, 255, 245, 255,
      0, 135, 50, 255, 230, 0, 0, 255, 255, 255, 255, 255,
    ]],
    ["lens-correction", { distortion: 45, vignette: 35, chromatic: 45 }, [
      7, 14, 35, 255, 58, 67, 83, 255, 91, 84, 78, 255,
      29, 46, 80, 255, 125, 135, 145, 255, 184, 175, 145, 255,
      14, 63, 45, 255, 129, 67, 52, 255, 172, 172, 137, 255,
    ]],
    ["lighting-effects", { style: "spot", intensity: 120, ambient: 45, height: 35 }, [
      4, 9, 14, 255, 46, 53, 60, 255, 72, 67, 56, 255,
      16, 25, 39, 255, 142, 155, 172, 255, 216, 209, 184, 255,
      9, 40, 27, 255, 103, 56, 35, 255, 145, 145, 138, 255,
    ]],
    ["surface-blur", { radius: 2, threshold: 80 }, [
      21, 34, 47, 255, 80, 82, 85, 255, 120, 115, 103, 255,
      35, 61, 64, 255, 126, 114, 103, 255, 224, 219, 196, 255,
      47, 81, 64, 255, 100, 88, 67, 255, 240, 238, 220, 255,
    ]],
    ["lens-blur", { radius: 1, bladeCount: 6, rotation: 30, brightness: 35, threshold: 120, noiseAmount: 10, noiseMono: false }, [
      29, 43, 58, 255, 90, 88, 86, 255, 155, 143, 128, 255,
      39, 84, 79, 255, 142, 124, 119, 255, 207, 200, 177, 255,
      66, 80, 67, 255, 159, 127, 111, 255, 218, 208, 185, 255,
    ]],
    ["reduce-noise", { strength: 5, colorNoise: 40, detail: 35, sharpen: 20 }, [
      75, 90, 82, 255, 93, 105, 94, 255, 109, 117, 105, 255,
      83, 100, 88, 255, 104, 117, 104, 255, 126, 134, 120, 255,
      85, 105, 91, 255, 104, 118, 105, 255, 137, 145, 131, 255,
    ]],
    ["dust-scratches", { radius: 1, threshold: 25 }, [
      11, 21, 32, 255, 74, 83, 91, 255, 130, 120, 100, 255,
      35, 55, 85, 255, 125, 133, 143, 255, 205, 193, 172, 255,
      20, 90, 60, 255, 155, 82, 49, 255, 244, 244, 228, 255,
    ]],
    ["colored-pencil", { intensity: 70 }, [
      90, 95, 99, 255, 132, 137, 142, 255, 169, 163, 152, 255,
      110, 120, 135, 255, 166, 172, 178, 255, 244, 239, 218, 255,
      92, 128, 112, 255, 172, 130, 111, 255, 252, 252, 248, 255,
    ]],
    ["graphic-pen", { intensity: 70 }, [
      16, 19, 22, 255, 34, 37, 40, 255, 52, 49, 43, 255,
      23, 29, 38, 255, 50, 53, 56, 255, 79, 76, 67, 255,
      19, 40, 31, 255, 59, 37, 26, 255, 245, 245, 240, 255,
    ]],
    ["craquelure", { intensity: 70 }, [
      10, 20, 30, 255, 67, 77, 87, 255, 130, 120, 100, 255,
      33, 53, 83, 255, 121, 131, 141, 255, 218, 208, 178, 255,
      16, 86, 56, 255, 152, 77, 42, 255, 95, 95, 80, 255,
    ]],
  ]

  for (const [id, params, expected] of cases) {
    expect(dataOf(applyFilter(id, params)), id).toEqual(expected)
  }
})

test("lens blur noise is deterministic and changes the blurred image", () => {
  const params = {
    radius: 1,
    bladeCount: 6,
    rotation: 30,
    brightness: 35,
    threshold: 120,
    noiseAmount: 10,
    noiseMono: false,
  }

  const first = applyFilter("lens-blur", params)
  const second = applyFilter("lens-blur", params)
  const noNoise = applyFilter("lens-blur", { ...params, noiseAmount: 0 })

  expect(dataOf(first)).toEqual(dataOf(second))
  expect(dataOf(first)).not.toEqual(dataOf(noNoise))
})

test("reduce noise strength zero is an identity golden case", () => {
  const result = applyFilter("reduce-noise", {
    strength: 0,
    colorNoise: 0,
    detail: 100,
    sharpen: 0,
  })

  expect(dataOf(result)).toEqual(dataOf(fixture3x3()))
})

test("legacy gallery filters are promoted to concrete filter definitions", () => {
  const promotedIds = [
    "colored-pencil",
    "dry-brush",
    "watercolor",
    "crosshatch",
    "graphic-pen",
    "craquelure",
    "mosaic-tiles",
  ]

  for (const id of promotedIds) {
    const filter = getFilter(id)
    expect(filter, id).toBeTruthy()
    expect(filter!.name).not.toContain("(approx.)")
  }
})

test("gallery filters produce distinct deterministic stylize goldens", () => {
  const params = { intensity: 70 }
  const outputs = new Map([
    ["colored-pencil", dataOf(applyFilter("colored-pencil", params))],
    ["dry-brush", dataOf(applyFilter("dry-brush", params))],
    ["watercolor", dataOf(applyFilter("watercolor", params))],
    ["crosshatch", dataOf(applyFilter("crosshatch", params))],
    ["graphic-pen", dataOf(applyFilter("graphic-pen", params))],
    ["craquelure", dataOf(applyFilter("craquelure", params))],
    ["mosaic-tiles", dataOf(applyFilter("mosaic-tiles", params))],
  ])

  const unique = new Set(Array.from(outputs.values(), (pixels) => pixels.join(",")))
  expect(unique.size).toBe(outputs.size)
})

test("blend mode compositing has a multiply golden fixture", () => {
  const before = imageData(2, 1, [
    80, 120, 200, 255,
    200, 100, 50, 255,
  ])
  const after = imageData(2, 1, [
    128, 64, 255, 255,
    50, 200, 100, 128,
  ])

  const result = compositeFilterImageData(before, after, {
    opacity: 1,
    blendMode: "multiply",
  })

  expect(dataOf(result)).toEqual([
    40, 30, 200, 255,
    119, 89, 35, 255,
  ])
})
