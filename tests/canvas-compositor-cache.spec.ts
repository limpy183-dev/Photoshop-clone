import { expect, test } from "@playwright/test"

import {
  adjustmentParamsFingerprint,
  advancedBlendingFingerprint,
  canvasIdFor,
  invalidateMaskAlphaCache,
  layerStyleCacheKey,
  maskAlphaEpoch,
  offsetPath,
  pathFingerprint,
  smartFilterCacheKey,
} from "../components/photoshop/canvas-compositor-cache"
import { normalizeAdvancedBlending } from "../components/photoshop/layer-workflows"
import type { Layer, PathProps } from "../components/photoshop/types"

test("canvas identities remain stable per object and unique across objects", () => {
  const first = {} as HTMLCanvasElement
  const second = {} as HTMLCanvasElement

  expect(canvasIdFor(first)).toBe(canvasIdFor(first))
  expect(canvasIdFor(second)).not.toBe(canvasIdFor(first))
})

test("adjustment path and advanced blending fingerprints retain current serialization", () => {
  const params = { amount: 12, nested: { enabled: true } }
  expect(adjustmentParamsFingerprint(params)).toBe(JSON.stringify(params))
  expect(adjustmentParamsFingerprint(params)).toBe(JSON.stringify(params))
  expect(adjustmentParamsFingerprint(null)).toBe("")
  expect(adjustmentParamsFingerprint(3)).toBe("3")

  const path = {
    points: [
      { x: 1, y: 2, cp1: { x: 0, y: 1 }, cp2: { x: 2, y: 3 } },
    ],
    closed: false,
    subpaths: [
      {
        points: [{ x: 4, y: 5 }],
        closed: true,
      },
    ],
  } satisfies PathProps
  expect(pathFingerprint(path)).toBe(JSON.stringify(path))
  expect(pathFingerprint(null)).toBe("")

  const shifted = offsetPath(path, 10, -2)
  expect(shifted).toEqual({
    ...path,
    points: [
      { x: 11, y: 0, cp1: { x: 10, y: -1 }, cp2: { x: 12, y: 1 } },
    ],
    subpaths: [
      {
        points: [{ x: 14, y: 3, cp1: undefined, cp2: undefined }],
        closed: true,
        subpaths: undefined,
      },
    ],
  })
  expect(path.points[0].x).toBe(1)

  const advanced = {
    transparencyShapesLayer: false,
    layerMaskHidesEffects: true,
  } as Layer["advancedBlending"]
  expect(advancedBlendingFingerprint(advanced)).toBe(JSON.stringify(normalizeAdvancedBlending(advanced)))
  expect(advancedBlendingFingerprint(undefined)).toBe("")
})

test("smart filter keys omit disabled filters and track masks and invalidation epoch", () => {
  const mask = {} as HTMLCanvasElement
  const smartFilters = [
    {
      id: "enabled",
      filterId: "gaussian-blur",
      name: "Blur",
      enabled: true,
      params: { radius: 2 },
      mask,
    },
    {
      id: "disabled",
      filterId: "motion-blur",
      name: "Motion",
      enabled: false,
      params: { distance: 5 },
    },
  ] as NonNullable<Layer["smartFilters"]>

  const beforeEpoch = maskAlphaEpoch
  const before = smartFilterCacheKey(smartFilters)
  expect(before).toContain("enabled:gaussian-blur")
  expect(before).not.toContain("disabled")
  expect(before).toContain(String(canvasIdFor(mask)))

  invalidateMaskAlphaCache()
  expect(maskAlphaEpoch).toBe(beforeEpoch + 1)
  expect(smartFilterCacheKey(smartFilters)).not.toBe(before)
})

test("layer style keys include enabled effects with sorted fields", () => {
  const style = {
    stroke: {
      enabled: true,
      color: "#ffffff",
      size: 2,
      position: "inside",
    },
    dropShadow: {
      enabled: false,
      size: 20,
    },
  } as NonNullable<Layer["style"]>

  expect(layerStyleCacheKey(style)).toBe("st:color=#ffffff;position=inside;size=2;|")
  expect(layerStyleCacheKey(style)).toBe("st:color=#ffffff;position=inside;size=2;|")
})
