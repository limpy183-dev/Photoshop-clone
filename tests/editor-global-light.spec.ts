import { expect, test } from "@playwright/test"

import {
  applyGlobalLightToStyle,
  normalizeGlobalLight,
  offsetFromGlobalLight,
  type EditorGlobalLight,
} from "../components/photoshop/editor-global-light"
import type { LayerStyle } from "../components/photoshop/types"

test("normalizes global light angle and altitude with current fallbacks", () => {
  expect(normalizeGlobalLight({ angle: 220, altitude: -10 })).toEqual({ angle: 180, altitude: 0 })
  expect(normalizeGlobalLight({ angle: -220, altitude: 120 })).toEqual({ angle: -180, altitude: 90 })
  expect(normalizeGlobalLight({ angle: Number.NaN, altitude: Number.POSITIVE_INFINITY })).toEqual({ angle: 120, altitude: 30 })
  expect(normalizeGlobalLight({ angle: 12.6, altitude: 44.4 })).toEqual({ angle: 13, altitude: 44 })
})

test("converts global light angles to shadow offsets with preserved distance", () => {
  expect(offsetFromGlobalLight({ distance: 10 }, 0)).toEqual({
    angle: 0,
    distance: 10,
    offsetX: -10,
    offsetY: 0,
  })

  const fromOffsets = offsetFromGlobalLight({ offsetX: 3, offsetY: 4 }, 90)
  expect(fromOffsets.angle).toBe(90)
  expect(fromOffsets.distance).toBeCloseTo(5)
  expect(fromOffsets.offsetX).toBeCloseTo(0)
  expect(fromOffsets.offsetY).toBeCloseTo(5)
})

test("applies global light to opted-in shadows and bevel without mutating the source", () => {
  const style: LayerStyle = {
    dropShadow: {
      enabled: true,
      color: "#000000",
      size: 12,
      offsetX: 5,
      offsetY: 0,
      opacity: 0.4,
      distance: 5,
    },
    innerShadow: {
      enabled: true,
      color: "#222222",
      size: 6,
      offsetX: 0,
      offsetY: 7,
      opacity: 0.3,
      distance: 7,
      useGlobalLight: true,
    },
    bevel: {
      enabled: true,
      style: "inner",
      depth: 100,
      size: 5,
      soften: 0,
      angle: 10,
      altitude: 20,
      highlight: "#ffffff",
      shadow: "#000000",
      opacity: 1,
    },
  }
  const light: EditorGlobalLight = { angle: 90, altitude: 45 }
  const next = applyGlobalLightToStyle(style, light)

  expect(next).not.toBe(style)
  expect(style.dropShadow?.angle).toBeUndefined()
  expect(next?.dropShadow).toMatchObject({ angle: 90, distance: 5 })
  expect(next?.dropShadow?.offsetX).toBeCloseTo(0)
  expect(next?.dropShadow?.offsetY).toBeCloseTo(5)
  expect(next?.innerShadow).toMatchObject({ angle: 90, distance: 7 })
  expect(next?.innerShadow?.offsetX).toBeCloseTo(0)
  expect(next?.innerShadow?.offsetY).toBeCloseTo(7)
  expect(next?.bevel).toMatchObject({ angle: 90, altitude: 45 })
})

test("keeps style identity when no effects follow global light", () => {
  const style: LayerStyle = {
    dropShadow: {
      enabled: true,
      color: "#000000",
      size: 12,
      offsetX: 5,
      offsetY: 0,
      opacity: 0.4,
      distance: 5,
      useGlobalLight: false,
    },
  }

  expect(applyGlobalLightToStyle(undefined, { angle: 90, altitude: 45 })).toBeUndefined()
  expect(applyGlobalLightToStyle(style, { angle: 90, altitude: 45 })).toBe(style)
})
