import { expect, test } from "@playwright/test"

import {
  firstDirtySmartFilterPreviewIndex,
  smartFilterPreviewEntryKey,
} from "../components/photoshop/smart-filter-preview"

test("smart filter preview keys are stable for equivalent entry state", () => {
  const a = smartFilterPreviewEntryKey({
    id: "sf_a",
    filterId: "gaussian-blur",
    params: { radius: 4, quality: "draft" },
    visible: true,
    opacity: 0.75,
    blendMode: "screen",
    maskEnabled: true,
    maskDensity: 0.5,
    maskFeather: 12,
  })
  const b = smartFilterPreviewEntryKey({
    id: "sf_a",
    filterId: "gaussian-blur",
    params: { quality: "draft", radius: 4 },
    visible: true,
    opacity: 0.75,
    blendMode: "screen",
    maskEnabled: true,
    maskDensity: 0.5,
    maskFeather: 12,
  })

  expect(a).toBe(b)
})

test("smart filter preview cache recomputes from the first changed stack entry", () => {
  const previous = [
    "a:blur:radius=2",
    "b:noise:amount=4",
    "c:sharpen:amount=1",
  ]

  expect(firstDirtySmartFilterPreviewIndex(previous, previous.slice())).toBe(-1)
  expect(firstDirtySmartFilterPreviewIndex(previous, [
    "a:blur:radius=2",
    "b:noise:amount=8",
    "c:sharpen:amount=1",
  ])).toBe(1)
  expect(firstDirtySmartFilterPreviewIndex(previous, [
    "x:exposure:amount=1",
    "a:blur:radius=2",
    "b:noise:amount=4",
    "c:sharpen:amount=1",
  ])).toBe(0)
  expect(firstDirtySmartFilterPreviewIndex(previous, [
    "a:blur:radius=2",
    "b:noise:amount=4",
  ])).toBe(2)
})
