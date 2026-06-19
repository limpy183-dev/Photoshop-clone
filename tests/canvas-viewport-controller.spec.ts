import { expect, test } from "@playwright/test"

import {
  composeStageTransform,
  imageRenderingForZoom,
  wheelViewportChange,
} from "../components/photoshop/canvas-viewport-controller"

test("composeStageTransform keeps stable translate and rotation and omits identity scale", () => {
  expect(composeStageTransform({ x: 12, y: -5 }, 90)).toBe("translate(12px, -5px) rotate(90deg)")
  expect(composeStageTransform({ x: 12, y: -5 }, 90, 1.00001)).toBe("translate(12px, -5px) rotate(90deg)")
})

test("composeStageTransform appends transient scale when preview zoom differs from layout zoom", () => {
  expect(composeStageTransform({ x: 0, y: 4 }, 15, 1.25)).toBe("translate(0px, 4px) rotate(15deg) scale(1.25)")
})

test("imageRenderingForZoom matches canvas-view pixel grid threshold", () => {
  expect(imageRenderingForZoom(3.99)).toBe("auto")
  expect(imageRenderingForZoom(4)).toBe("pixelated")
})

test("wheelViewportChange returns clamped zoom targets for modifier-wheel input", () => {
  const zoomIn = wheelViewportChange({
    deltaX: 0,
    deltaY: -240,
    modifierPressed: true,
    currentZoom: 1,
    pan: { x: 3, y: 4 },
  })
  expect(zoomIn).toEqual({ kind: "zoom", zoom: Math.exp(0.36) })

  const clamped = wheelViewportChange({
    deltaX: 0,
    deltaY: 5000,
    modifierPressed: true,
    currentZoom: 0.02,
    pan: { x: 3, y: 4 },
  })
  expect(clamped).toEqual({ kind: "zoom", zoom: 0.05 })
})

test("wheelViewportChange returns panned offsets for plain wheel input", () => {
  expect(wheelViewportChange({
    deltaX: 8,
    deltaY: -12,
    modifierPressed: false,
    currentZoom: 1,
    pan: { x: 30, y: 40 },
  })).toEqual({
    kind: "pan",
    pan: { x: 22, y: 52 },
  })
})
