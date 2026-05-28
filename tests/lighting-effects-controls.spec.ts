import { expect, test } from "@playwright/test"

import {
  beginLightingEffectsInteraction,
  formatLightingEffectsLights,
  getLightingEffectsControlState,
  normalizeLightingEffectsParams,
  parseLightingEffectsLights,
  updateLightingEffectsInteraction,
} from "../components/photoshop/lighting-effects-controls"

test("lighting effects normalizes editable spot lights from filter params", () => {
  const params = normalizeLightingEffectsParams({ style: "spot", intensity: 120 })
  const lights = parseLightingEffectsLights(String(params.lights))

  expect(lights).toHaveLength(1)
  expect(lights[0]).toMatchObject({
    type: "spot",
    x: 0.45,
    y: 0.35,
    intensity: 1.2,
    radius: 0.6,
    focus: 0.4,
  })
  expect(getLightingEffectsControlState(params).selectedLightIndex).toBe(0)
})

test("lighting effects canvas interactions drag lights and edit radius", () => {
  const params = normalizeLightingEffectsParams({
    style: "spot",
    lights: formatLightingEffectsLights([
      { type: "spot", x: 0.4, y: 0.35, z: 0.6, intensity: 1, color: [255, 240, 210], radius: 0.5, focus: 0.4 },
    ]),
  })

  const start = beginLightingEffectsInteraction(params, { x: 40, y: 35 }, 100, 100)
  expect(start.drag).toEqual({ kind: "light-position", index: 0 })

  const moved = updateLightingEffectsInteraction(start.params, start.drag!, { x: 70, y: 62 }, 100, 100)
  expect(parseLightingEffectsLights(String(moved.lights))[0]).toMatchObject({ x: 0.7, y: 0.62 })

  const radiusDrag = beginLightingEffectsInteraction(moved, { x: 100, y: 62 }, 100, 100)
  expect(radiusDrag.drag).toEqual({ kind: "light-radius", index: 0 })

  const resized = updateLightingEffectsInteraction(radiusDrag.params, radiusDrag.drag!, { x: 95, y: 62 }, 100, 100)
  expect(parseLightingEffectsLights(String(resized.lights))[0].radius).toBeCloseTo(0.25, 2)
})

test("lighting effects canvas interactions edit focus and intensity", () => {
  const params = normalizeLightingEffectsParams({
    style: "spot",
    lights: formatLightingEffectsLights([
      { type: "spot", x: 0.5, y: 0.5, z: 0.55, intensity: 0.75, color: [255, 255, 255], radius: 0.5, focus: 0.35 },
    ]),
  })

  const focused = updateLightingEffectsInteraction(params, { kind: "light-focus", index: 0 }, { x: 69, y: 50 }, 100, 100)
  expect(parseLightingEffectsLights(String(focused.lights))[0].focus).toBeCloseTo(0.76, 2)

  const brightened = updateLightingEffectsInteraction(focused, { kind: "light-intensity", index: 0 }, { x: 50, y: 18 }, 100, 100)
  expect(parseLightingEffectsLights(String(brightened.lights))[0].intensity).toBeCloseTo(1.28, 2)
  expect(getLightingEffectsControlState(brightened).previewQuality).toBe("interactive")
})
