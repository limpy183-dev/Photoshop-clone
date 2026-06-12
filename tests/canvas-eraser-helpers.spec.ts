import { expect, test } from "@playwright/test"

import {
  colorDistance,
  connectedEraserMask,
  localPatchGradient,
} from "../components/photoshop/canvas-eraser-helpers"

function imageDataFromLuma(width: number, height: number, luma: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const value = luma(x, y)
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }
  return { data, width, height } as ImageData
}

test("color distance preserves alpha weighting", () => {
  expect(colorDistance({ r: 0, g: 0, b: 0, a: 255 }, { r: 3, g: 4, b: 12, a: 235 })).toBeCloseTo(Math.sqrt(269))
  expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 13, g: 24, b: 42 })).toBeCloseTo(13)
})

test("connected eraser mask flood fills only 4-neighbor contiguous pixels", () => {
  const mask = new Uint8Array([
    0, 1, 0, 1,
    1, 1, 0, 1,
    0, 0, 1, 1,
    1, 0, 1, 0,
  ])

  expect([...connectedEraserMask(mask, 4, 4, 1, 1)]).toEqual([
    0, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ])
  expect([...connectedEraserMask(mask, 4, 4, 3, 0)]).toEqual([
    0, 0, 0, 1,
    0, 0, 0, 1,
    0, 0, 1, 1,
    0, 0, 1, 0,
  ])
})

test("connected eraser mask returns empty output when the start pixel is unmatched", () => {
  const mask = new Uint8Array([1, 0, 1, 1])

  expect([...connectedEraserMask(mask, 2, 2, 1, 0)]).toEqual([0, 0, 0, 0])
})

test("local patch gradient samples clamped luminance neighbors", () => {
  const image = imageDataFromLuma(3, 3, (x, y) => x * 50 + y * 10)

  expect(localPatchGradient(image, 1, 1, 3, 3)).toBeCloseTo(120)
  expect(localPatchGradient(image, 0, 0, 3, 3)).toBeCloseTo(60)
})
