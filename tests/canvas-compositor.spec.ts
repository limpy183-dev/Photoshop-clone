import { expect, test } from "@playwright/test"

import {
  adjustmentParamsKey,
  applyAdjustmentLayer,
  applySmartFilters,
  makeOpaqueMask,
  paramsWithDefaults,
  readSmartFilterMask,
  renderLayerSourceForCompositor,
} from "../components/photoshop/canvas-compositor"
import { invalidateMaskAlphaCache } from "../components/photoshop/canvas-compositor-cache"
import { getFilter, type FilterDef } from "../components/photoshop/filters"
import type { Layer } from "../components/photoshop/types"
import { fixtureCanvas, fixtureMask, installFixtureDom } from "./photoshop-fixtures"

function fixtureLayer(canvas: HTMLCanvasElement, overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer",
    name: "Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    ...overrides,
  }
}

test.beforeAll(() => {
  installFixtureDom()
})

test("filter parameter defaults preserve clamping and type coercion", () => {
  const gaussianBlur = getFilter("gaussian-blur")
  expect(gaussianBlur).not.toBeNull()
  expect(paramsWithDefaults(gaussianBlur!, { radius: 500 })).toEqual({ radius: 100 })
  expect(paramsWithDefaults(gaussianBlur!, { radius: "invalid" })).toEqual({ radius: 4 })

  const filter: FilterDef = {
    id: "fixture",
    name: "Fixture",
    category: "Test",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 10, default: 3 },
      { type: "checkbox", key: "enabled", label: "Enabled", default: true },
      {
        type: "select",
        key: "mode",
        label: "Mode",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        default: "a",
      },
      { type: "text", key: "label", label: "Label", default: "default" },
    ],
    apply: (source) => source,
  }
  expect(paramsWithDefaults(filter, {
    amount: "12",
    enabled: "true",
    mode: "invalid",
    label: false,
  })).toEqual({
    amount: 10,
    enabled: false,
    mode: "a",
    label: "default",
  })
})

test("adjustment keys retain type and JSON parameter ordering", () => {
  const canvas = fixtureCanvas()
  expect(adjustmentParamsKey(fixtureLayer(canvas))).toBe("")
  expect(adjustmentParamsKey(fixtureLayer(canvas, {
    kind: "adjustment",
    adjustment: {
      type: "brightness-contrast",
      params: { brightness: 10, contrast: -5 },
    },
  }))).toBe('brightness-contrast|{"brightness":10,"contrast":-5}')
})

test("smart filter results reuse the source or cached output", () => {
  const source = fixtureCanvas(8, 6)
  expect(applySmartFilters(source, undefined)).toBe(source)

  const filters: NonNullable<Layer["smartFilters"]> = [{
    id: "blur",
    filterId: "gaussian-blur",
    name: "Gaussian Blur",
    enabled: true,
    params: { radius: 0 },
  }]
  const first = applySmartFilters(source, filters)
  const second = applySmartFilters(source, filters)
  expect(first).not.toBe(source)
  expect(second).toBe(first)
})

test("mask helpers preserve dimensions and cache until invalidation", () => {
  const opaque = makeOpaqueMask(7, 5)
  expect({ width: opaque.width, height: opaque.height }).toEqual({ width: 7, height: 5 })

  const mask = fixtureMask(8, 6)
  expect(readSmartFilterMask(mask, 0, 6)).toBeNull()
  const first = readSmartFilterMask(mask, 8, 6)
  const second = readSmartFilterMask(mask, 8, 6)
  expect(first).not.toBeNull()
  expect(second).toBe(first)

  invalidateMaskAlphaCache()
  expect(readSmartFilterMask(mask, 8, 6)).not.toBe(first)
})

test("no-op adjustments leave the destination context untouched", () => {
  const layer = fixtureLayer(fixtureCanvas(8, 6), {
    kind: "adjustment",
    adjustment: {
      type: "brightness-contrast",
      params: { brightness: 0, contrast: 0, legacy: false },
    },
  })
  let reads = 0
  const context = {
    getImageData: () => {
      reads++
      throw new Error("no-op adjustment should not read pixels")
    },
  } as unknown as CanvasRenderingContext2D

  applyAdjustmentLayer(context, layer, 8, 6)
  expect(reads).toBe(0)
})

test("unstyled layer preparation preserves source and fill opacity", () => {
  const source = fixtureCanvas(8, 6)
  const rendered = renderLayerSourceForCompositor(fixtureLayer(source, { fillOpacity: 0.4 }))

  expect(rendered.canvas).toBe(source)
  expect(rendered.fillOpacity).toBe(0.4)
  expect(rendered.styleRendered).toBe(false)
  expect({
    width: rendered.knockoutMask.width,
    height: rendered.knockoutMask.height,
  }).toEqual({
    width: source.width,
    height: source.height,
  })
})
