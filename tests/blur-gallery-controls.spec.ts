import { expect, test } from "@playwright/test"

import {
  BLUR_GALLERY_CONTROL_STATE_KEY,
  applyBlurGalleryKeyboardCommand,
  beginBlurGalleryInteraction,
  createBlurGalleryMeshResource,
  paramsFromBlurGalleryMeshResource,
  finishBlurGalleryInteraction,
  formatFieldBlurPins,
  formatPathBlurPoints,
  getBlurGalleryControlState,
  normalizeBlurGalleryParams,
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

test("field blur control state persists multi-selection and moves selected pins together", () => {
  const initial = normalizeBlurGalleryParams("field-blur", {
    blur: 18,
    pins: formatFieldBlurPins([
      { x: 20, y: 50, blur: 10 },
      { x: 80, y: 50, blur: 20 },
    ]),
  })

  const first = beginBlurGalleryInteraction("field-blur", initial, { x: 20, y: 50 }, 100, 100)
  expect(getBlurGalleryControlState(first.params).selectedFieldPinIndexes).toEqual([0])
  expect(getBlurGalleryControlState(first.params).previewQuality).toBe("interactive")

  const second = beginBlurGalleryInteraction("field-blur", first.params, { x: 80, y: 50 }, 100, 100, 10, {
    multiSelect: true,
  })
  expect(second.drag).toEqual({ kind: "field-pin", index: 1 })
  expect(getBlurGalleryControlState(second.params).selectedFieldPinIndexes).toEqual([0, 1])

  const moved = updateBlurGalleryInteraction("field-blur", second.params, second.drag!, { x: 90, y: 60 }, 100, 100)
  expect(parseFieldBlurPins(String(moved.pins))).toEqual([
    { x: 30, y: 60, blur: 10 },
    { x: 90, y: 60, blur: 20 },
  ])

  const settled = finishBlurGalleryInteraction("field-blur", moved)
  expect(getBlurGalleryControlState(settled).previewQuality).toBe("full")
  expect(String(settled[BLUR_GALLERY_CONTROL_STATE_KEY])).toContain("selectedFieldPinIndexes")
})

test("blur gallery keyboard commands duplicate, nudge, and delete selected pins", () => {
  let params = normalizeBlurGalleryParams("field-blur", {
    blur: 12,
    pins: formatFieldBlurPins([
      { x: 30, y: 30, blur: 12 },
      { x: 60, y: 60, blur: 24 },
    ]),
    [BLUR_GALLERY_CONTROL_STATE_KEY]: JSON.stringify({ selectedFieldPinIndexes: [1] }),
  })

  params = applyBlurGalleryKeyboardCommand("field-blur", params, { kind: "duplicate", offset: 5 })
  expect(parseFieldBlurPins(String(params.pins))).toEqual([
    { x: 30, y: 30, blur: 12 },
    { x: 60, y: 60, blur: 24 },
    { x: 65, y: 65, blur: 24 },
  ])
  expect(getBlurGalleryControlState(params).selectedFieldPinIndexes).toEqual([2])

  params = applyBlurGalleryKeyboardCommand("field-blur", params, { kind: "nudge", dx: -2, dy: 3 })
  expect(parseFieldBlurPins(String(params.pins))[2]).toEqual({ x: 63, y: 68, blur: 24 })

  params = applyBlurGalleryKeyboardCommand("field-blur", params, { kind: "delete" })
  expect(parseFieldBlurPins(String(params.pins))).toEqual([
    { x: 30, y: 30, blur: 12 },
    { x: 60, y: 60, blur: 24 },
  ])
  expect(getBlurGalleryControlState(params).selectedFieldPinIndexes).toEqual([])
})

test("path blur keyboard edits preserve at least two handles and sync direction", () => {
  let params = normalizeBlurGalleryParams("path-blur", {
    path: formatPathBlurPoints([
      { x: 10, y: 20 },
      { x: 40, y: 50 },
      { x: 80, y: 50 },
    ]),
    [BLUR_GALLERY_CONTROL_STATE_KEY]: JSON.stringify({ selectedPathPointIndexes: [1] }),
  })

  params = applyBlurGalleryKeyboardCommand("path-blur", params, { kind: "nudge", dx: 5, dy: -10 })
  expect(parsePathBlurPoints(String(params.path))[1]).toEqual({ x: 45, y: 40 })

  params = applyBlurGalleryKeyboardCommand("path-blur", params, { kind: "delete" })
  expect(parsePathBlurPoints(String(params.path))).toEqual([
    { x: 10, y: 20 },
    { x: 80, y: 50 },
  ])
  expect(params.angle).toBe(23.2)

  const unchanged = applyBlurGalleryKeyboardCommand("path-blur", params, {
    kind: "delete",
    selection: { selectedPathPointIndexes: [0, 1] },
  })
  expect(parsePathBlurPoints(String(unchanged.path))).toEqual([
    { x: 10, y: 20 },
    { x: 80, y: 50 },
  ])
})

test("blur gallery mesh resources serialize Photoshop-style descriptor payloads and restore params", () => {
  const params = normalizeBlurGalleryParams("field-blur", {
    blur: 18,
    falloff: 40,
    pins: formatFieldBlurPins([
      { x: 20, y: 30, blur: 12 },
      { x: 80, y: 65, blur: 34 },
    ]),
    [BLUR_GALLERY_CONTROL_STATE_KEY]: JSON.stringify({
      selectedFieldPinIndexes: [1],
      activeControl: "field-pin:1",
      previewQuality: "interactive",
    }),
  })

  const resource = createBlurGalleryMeshResource("field-blur", params)
  expect(resource.signature).toBe("8BIM")
  expect(resource.resourceKey).toBe("blurGalleryMesh")
  expect(resource.descriptor.filterId).toBe("field-blur")
  expect(resource.descriptor.mesh.kind).toBe("field")
  expect(resource.payloadBase64.length).toBeGreaterThan(20)
  expect(resource.checksum).toMatch(/^[a-f0-9]{8}$/)

  const restored = paramsFromBlurGalleryMeshResource(resource)
  expect(parseFieldBlurPins(String(restored.params.pins))).toEqual([
    { x: 20, y: 30, blur: 12 },
    { x: 80, y: 65, blur: 34 },
  ])
  expect(getBlurGalleryControlState(restored.params).selectedFieldPinIndexes).toEqual([1])
})
