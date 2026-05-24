import { expect, test } from "@playwright/test"

import {
  beginBlurGalleryInteraction,
  formatFieldBlurPins,
  formatPathBlurPoints,
  parseFieldBlurPins,
  parsePathBlurPoints,
  updateBlurGalleryInteraction,
} from "../components/photoshop/blur-gallery-controls"

test("field blur interactions add pins, drag pins, and adjust per-pin blur amount", () => {
  const first = beginBlurGalleryInteraction("field-blur", { blur: 18 }, { x: 20, y: 30 }, 100, 100)

  expect(first.drag?.kind).toBe("field-pin")
  expect(parseFieldBlurPins(String(first.params.pins))).toEqual([{ x: 20, y: 30, blur: 18 }])

  const moved = updateBlurGalleryInteraction("field-blur", first.params, first.drag!, { x: 35, y: 40 }, 100, 100)
  expect(parseFieldBlurPins(String(moved.pins))).toEqual([{ x: 35, y: 40, blur: 18 }])

  const amountDrag = beginBlurGalleryInteraction("field-blur", moved, { x: 53, y: 40 }, 100, 100)
  expect(amountDrag.drag?.kind).toBe("field-amount")

  const adjusted = updateBlurGalleryInteraction("field-blur", amountDrag.params, amountDrag.drag!, { x: 75, y: 40 }, 100, 100)
  expect(parseFieldBlurPins(String(adjusted.pins))[0].blur).toBe(40)
})

test("iris, tilt-shift, path, and spin controls update normalized filter params", () => {
  const iris = updateBlurGalleryInteraction(
    "iris-blur",
    { centerX: 50, centerY: 50, radius: 40, feather: 25 },
    { kind: "iris-radius" },
    { x: 82, y: 50 },
    100,
    100,
  )
  expect(iris.radius).toBe(64)

  const tilt = updateBlurGalleryInteraction(
    "tilt-shift",
    { centerX: 50, centerY: 50, angle: 0, radius: 30, feather: 25 },
    { kind: "tilt-center" },
    { x: 50, y: 64 },
    100,
    100,
  )
  expect(tilt.centerY).toBe(64)

  const path = updateBlurGalleryInteraction(
    "path-blur",
    { path: formatPathBlurPoints([{ x: 20, y: 20 }, { x: 80, y: 50 }]) },
    { kind: "path-point", index: 1 },
    { x: 70, y: 75 },
    100,
    100,
  )
  expect(parsePathBlurPoints(String(path.path))).toEqual([{ x: 20, y: 20 }, { x: 70, y: 75 }])

  const spin = updateBlurGalleryInteraction(
    "spin-blur",
    { centerX: 50, centerY: 50, radius: 42 },
    { kind: "spin-radius" },
    { x: 85, y: 50 },
    100,
    100,
  )
  expect(spin.radius).toBe(70)
})

test("blur gallery serializers clamp values to stable percent-space strings", () => {
  expect(formatFieldBlurPins([{ x: -5, y: 120, blur: 120 }])).toBe("0,100,80")
  expect(formatPathBlurPoints([{ x: 12.345, y: 67.891 }])).toBe("12.35,67.89")
})
