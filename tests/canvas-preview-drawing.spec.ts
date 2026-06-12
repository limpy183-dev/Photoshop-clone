import { expect, test } from "@playwright/test"

import {
  drawArtboardPreview,
  drawFramePlaceholder,
  drawSlicePreview,
} from "../components/photoshop/canvas-preview-drawing"

function recordingContext(width = 20, height = 16) {
  const calls: string[] = []
  const target = {
    canvas: { width, height },
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    clearRect: (...values: number[]) => calls.push(`clear:${values.join(",")}`),
    fillRect: (...values: number[]) => calls.push(`fillRect:${values.join(",")}`),
    strokeRect: (...values: number[]) => calls.push(`strokeRect:${values.join(",")}`),
    setLineDash: (values: number[]) => calls.push(`dash:${values.join(",")}`),
    beginPath: () => calls.push("begin"),
    rect: (...values: number[]) => calls.push(`rect:${values.join(",")}`),
    ellipse: (...values: number[]) => calls.push(`ellipse:${values.join(",")}`),
    moveTo: (...values: number[]) => calls.push(`move:${values.join(",")}`),
    lineTo: (...values: number[]) => calls.push(`line:${values.join(",")}`),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
  }
  const context = new Proxy(target, {
    set(object, property, value) {
      calls.push(`set:${String(property)}=${String(value)}`)
      Reflect.set(object, property, value)
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { calls, context }
}

test("frame placeholders retain rectangle styling and diagonal order", () => {
  const { calls, context } = recordingContext()
  drawFramePlaceholder(context, { shape: "rect", x: 2, y: 3, w: 8, h: 6 })

  expect(calls).toEqual([
    "save",
    "clear:0,0,20,16",
    "set:fillStyle=rgba(15, 23, 42, 0.18)",
    "set:strokeStyle=#38bdf8",
    "set:lineWidth=2",
    "dash:8,5",
    "begin",
    "rect:2,3,8,6",
    "fill",
    "stroke",
    "dash:",
    "set:strokeStyle=rgba(255, 255, 255, 0.8)",
    "begin",
    "move:2,3",
    "line:10,9",
    "move:10,3",
    "line:2,9",
    "stroke",
    "restore",
  ])
})

test("frame placeholders retain ellipse geometry", () => {
  const { calls, context } = recordingContext()
  drawFramePlaceholder(context, { shape: "ellipse", x: 2, y: 4, w: 8, h: 6 })

  expect(calls).toContain(`ellipse:6,7,4,3,0,0,${Math.PI * 2}`)
  expect(calls).not.toContain("rect:2,4,8,6")
})

test("artboard previews retain fills, borders, and clamped inset dimensions", () => {
  const { calls, context } = recordingContext(12, 10)
  drawArtboardPreview(context, 1, 2, 4, 5, "#123456")

  expect(calls).toEqual([
    "save",
    "clear:0,0,12,10",
    "set:fillStyle=#123456",
    "fillRect:1,2,4,5",
    "set:strokeStyle=#f8fafc",
    "set:lineWidth=2",
    "strokeRect:1,2,4,5",
    "set:strokeStyle=#0f172a",
    "set:lineWidth=1",
    "strokeRect:4,5,0,0",
    "restore",
  ])
})

test("slice previews retain orange dashed border and fill order", () => {
  const { calls, context } = recordingContext()
  drawSlicePreview(context, 3, 4, 7, 6)

  expect(calls).toEqual([
    "save",
    "set:strokeStyle=#f97316",
    "set:lineWidth=2",
    "dash:6,4",
    "strokeRect:3,4,7,6",
    "dash:",
    "set:fillStyle=rgba(249, 115, 22, 0.14)",
    "fillRect:3,4,7,6",
    "restore",
  ])
})
