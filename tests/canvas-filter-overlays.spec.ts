import { expect, test } from "@playwright/test"

import {
  drawBlurGalleryOverlayCanvas,
  drawLightingEffectsOverlayCanvas,
} from "../components/photoshop/canvas-filter-overlays"
import { BLUR_GALLERY_CONTROL_STATE_KEY } from "../components/photoshop/blur-gallery-controls"
import { LIGHTING_EFFECTS_CONTROL_STATE_KEY } from "../components/photoshop/lighting-effects-controls"

function recordingOverlayCanvas(width = 200, height = 100) {
  const calls: string[] = []
  const target = {
    canvas: { width, height },
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    clearRect: (...values: number[]) => calls.push(`clear:${values.join(",")}`),
    beginPath: () => calls.push("begin"),
    arc: (...values: number[]) => calls.push(`arc:${values.join(",")}`),
    ellipse: (...values: number[]) => calls.push(`ellipse:${values.join(",")}`),
    moveTo: (...values: number[]) => calls.push(`move:${values.join(",")}`),
    lineTo: (...values: number[]) => calls.push(`line:${values.join(",")}`),
    closePath: () => calls.push("close"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    setLineDash: (values: number[]) => calls.push(`dash:${values.join(",")}`),
    roundRect: (...values: number[]) => calls.push(`roundRect:${values.join(",")}`),
    fillText: (label: string, x: number, y: number) => calls.push(`fillText:${label}:${x},${y}`),
    measureText: (label: string) => ({ width: label.length * 6 }),
  }
  const context = new Proxy(target, {
    set(object, property, value) {
      calls.push(`set:${String(property)}=${String(value)}`)
      Reflect.set(object, property, value)
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  return { calls, canvas }
}

test("blur gallery overlays clear stale state and stop drawing", () => {
  const { calls, canvas } = recordingOverlayCanvas()

  drawBlurGalleryOverlayCanvas(canvas, {
    id: "doc",
    width: 100,
    height: 50,
  }, 1, {
    docId: "other",
    filterId: "field-blur",
    params: { pins: "50,50,12" },
  })

  expect(calls).toEqual(["clear:0,0,200,100"])
})

test("selected field blur pins retain highlight, handle, and label geometry", () => {
  const { calls, canvas } = recordingOverlayCanvas()

  drawBlurGalleryOverlayCanvas(canvas, {
    id: "doc",
    width: 100,
    height: 50,
  }, 2, {
    docId: "doc",
    filterId: "field-blur",
    params: {
      pins: "50,50,12",
      [BLUR_GALLERY_CONTROL_STATE_KEY]: JSON.stringify({
        selectedFieldPinIndexes: [0],
        selectedPathPointIndexes: [],
        activeControl: null,
        previewQuality: "full",
      }),
    },
  })

  expect(calls).toContain("clear:0,0,200,100")
  expect(calls).toContain("set:fillStyle=rgba(251,191,36,0.08)")
  expect(calls).toContain(`arc:50,25,12,0,${Math.PI * 2}`)
  expect(calls).toContain("line:62,25")
  expect(calls).toContain("fillText:12px:66,21")
})

test("lighting effects overlays retain selected light handles and labels", () => {
  const { calls, canvas } = recordingOverlayCanvas()

  drawLightingEffectsOverlayCanvas(canvas, {
    id: "doc",
    width: 100,
    height: 80,
  }, 2, {
    docId: "doc",
    params: {
      lights: JSON.stringify([{
        type: "spot",
        x: 0.5,
        y: 0.5,
        z: 0.55,
        intensity: 1.2,
        color: [255, 240, 210],
        radius: 0.4,
        focus: 0.5,
      }]),
      [LIGHTING_EFFECTS_CONTROL_STATE_KEY]: JSON.stringify({
        selectedLightIndex: 0,
        activeControl: "light-radius:0",
        previewQuality: "full",
      }),
    },
  })

  expect(calls).toContain("clear:0,0,200,100")
  expect(calls).toContain("arc:50,40,32,0,6.283185307179586")
  expect(calls).toContain("line:82,40")
  expect(calls).toContain("fillText:spot 120%:54,35")
})
