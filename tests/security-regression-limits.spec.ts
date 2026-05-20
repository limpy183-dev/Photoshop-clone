import { expect, test } from "@playwright/test"

import { POST as postFeedback } from "../app/api/feedback/route"
import { POST as postSubscribe } from "../app/api/subscribe/route"
import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_PROJECT_CHANNELS,
  MAX_PROJECT_LAYERS,
  assertCanvasSize,
  assertFileSize,
  clampCanvasSize,
} from "../components/photoshop/canvas-limits"
import { canvasFromDataUrl, deserializeProject } from "../components/photoshop/document-io"
import { installFixtureDom } from "./photoshop-fixtures"

function jsonRequest(payload: unknown): Request {
  return new Request("http://127.0.0.1/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

function serializedLayer(id: string) {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
  }
}

test("API JSON schemas reject malformed and over-budget payloads", async () => {
  const malformedFeedback = await postFeedback(jsonRequest("{"))
  expect(malformedFeedback.status).toBe(400)
  await expect(malformedFeedback.json()).resolves.toMatchObject({
    ok: false,
    error: "Body must be valid JSON.",
  })

  const longFeedback = await postFeedback(jsonRequest({ message: "x".repeat(2001) }))
  expect(longFeedback.status).toBe(400)
  await expect(longFeedback.json()).resolves.toMatchObject({
    ok: false,
    error: "Keep it under 2000 characters.",
  })

  const longSubscribeSource = await postSubscribe(jsonRequest({
    email: "artist@example.com",
    source: "x".repeat(65),
  }))
  expect(longSubscribeSource.status).toBe(400)
  await expect(longSubscribeSource.json()).resolves.toMatchObject({ ok: false })
})

test("shared import limit helpers reject oversized canvases and files", () => {
  expect(() => assertCanvasSize(MAX_CANVAS_DIMENSION + 1, 1, "Project canvas")).toThrow(
    /Project canvas is too large/,
  )

  const clamped = clampCanvasSize(100_000, 100_000)
  expect(clamped.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(clamped.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(clamped.width * clamped.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)

  const file = { size: 2 * 1024 * 1024 } as File
  expect(() => assertFileSize(file, 1024 * 1024, "Project file")).toThrow(
    "Project file is too large. Maximum file size is 1 MB.",
  )
})

test("project JSON import enforces layer, channel, and canvas payload limits", async () => {
  installFixtureDom()

  const tooManyLayers = JSON.stringify({
    width: 16,
    height: 16,
    layers: Array.from({ length: MAX_PROJECT_LAYERS + 1 }, (_, index) => serializedLayer(`layer_${index}`)),
  })
  await expect(deserializeProject(`wrapped-prefix ${tooManyLayers} wrapped-suffix`)).rejects.toThrow(
    `Project contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`,
  )

  const tooManyChannels = JSON.stringify({
    width: 16,
    height: 16,
    layers: [serializedLayer("layer_1")],
    channels: Array.from({ length: MAX_PROJECT_CHANNELS + 1 }, (_, index) => ({
      id: `channel_${index}`,
      name: `Channel ${index}`,
    })),
  })
  await expect(deserializeProject(tooManyChannels)).rejects.toThrow(
    `Project contains too many alpha channels. Maximum supported channels: ${MAX_PROJECT_CHANNELS}.`,
  )

  await expect(canvasFromDataUrl("https://example.com/tracker.png", 1, 1)).rejects.toThrow(
    "Project contains unsupported or oversized canvas image data",
  )
})
