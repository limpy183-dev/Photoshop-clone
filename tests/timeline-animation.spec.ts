import { expect, test } from "@playwright/test"

import {
  DEFAULT_TIMELINE_SETTINGS,
  buildDocumentForFrame,
  captureFrameFromDocument,
  generateTweenFrames,
  renderOnionSkinOverlay,
} from "../components/photoshop/timeline-engine"
import {
  collectAnimationFramesAtFps,
  encodeAnimatedGif,
  encodeAnimatedWebP,
  encodeApngFromFrames,
} from "../components/photoshop/animation-encoding"
import { createExportLimitationReport } from "../components/photoshop/document-io"
import type { AnimatedExportFrame } from "../components/photoshop/animation-encoding"
import type { Layer, PsDocument, TimelineFrame } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function textFromBytes(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
}

function makeLayer(id: string, patch: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(4, 3, "#3366cc"),
    ...patch,
  }
}

function makeDoc(patch: Partial<PsDocument> = {}): PsDocument {
  installFixtureDom()
  const layerA = makeLayer("layer_a", {
    opacity: 0.4,
    fillOpacity: 0.8,
    blendMode: "multiply",
    style: {
      dropShadow: {
        enabled: true,
        color: "#000000",
        size: 6,
        offsetX: 2,
        offsetY: 3,
        opacity: 0.25,
      },
    },
  })
  const layerB = makeLayer("layer_b", { visible: false, opacity: 0.9 })
  return {
    id: "doc_timeline",
    name: "Timeline Fixture",
    width: 4,
    height: 3,
    zoom: 1,
    layers: [layerA, layerB],
    activeLayerId: layerA.id,
    selectedLayerIds: [layerA.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    ...patch,
  }
}

function frame(id: string, patch: Partial<TimelineFrame> = {}): TimelineFrame {
  return {
    id,
    name: id,
    durationMs: 100,
    layerVisibility: { layer_a: true, layer_b: false },
    layerOpacity: { layer_a: 0.4, layer_b: 0 },
    layerFillOpacity: { layer_a: 0.8, layer_b: 1 },
    layerBlend: { layer_a: "multiply", layer_b: "normal" },
    transition: "hold",
    easing: "linear",
    ...patch,
  }
}

function webpFixtureBytes(width = 4, height = 3) {
  const wMinusOne = width - 1
  const hMinusOne = height - 1
  const b1 = wMinusOne & 0xff
  const b2 = ((wMinusOne >> 8) & 0x3f) | ((hMinusOne & 0x03) << 6)
  const b3 = (hMinusOne >> 2) & 0xff
  const b4 = (hMinusOne >> 10) & 0x0f
  const vp8lPayload = new Uint8Array([0x2f, b1, b2, b3, b4])
  const vp8lChunk = new Uint8Array(14)
  vp8lChunk.set([0x56, 0x50, 0x38, 0x4c], 0)
  vp8lChunk.set([5, 0, 0, 0], 4)
  vp8lChunk.set(vp8lPayload, 8)
  const riffSize = 4 + vp8lChunk.length
  const riff = new Uint8Array(8)
  riff.set([0x52, 0x49, 0x46, 0x46], 0)
  riff.set([riffSize & 255, (riffSize >> 8) & 255, (riffSize >> 16) & 255, (riffSize >> 24) & 255], 4)
  return new Uint8Array([...riff, 0x57, 0x45, 0x42, 0x50, ...vp8lChunk])
}

function animatedFrames(): AnimatedExportFrame[] {
  const a = fixtureCanvas(4, 3, "#ff0000")
  const b = fixtureCanvas(4, 3, "#00ff00")
  const toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
    callback(new Blob([webpFixtureBytes(this.width, this.height)], { type: type ?? "image/webp" }))
  }
  ;(a as HTMLCanvasElement & { toBlob: HTMLCanvasElement["toBlob"] }).toBlob = toBlob
  ;(b as HTMLCanvasElement & { toBlob: HTMLCanvasElement["toBlob"] }).toBlob = toBlob
  return [
    { durationMs: 120, canvas: a },
    { durationMs: 240, canvas: b },
  ]
}

test("timeline engine captures frame metadata and projects transform/effect overrides", () => {
  const doc = makeDoc()
  const captured = captureFrameFromDocument(doc, "Pose A")
  const projected = buildDocumentForFrame(doc, {
    ...captured,
    layerVisibility: { layer_a: true, layer_b: true },
    layerOpacity: { layer_a: 0.75, layer_b: 0.5 },
    layerFillOpacity: { layer_a: 0.6, layer_b: 1 },
    layerBlend: { layer_a: "screen", layer_b: "normal" },
    layerTransform: { layer_a: { tx: 1, ty: 2, scaleX: 1.5, scaleY: 0.5, rotation: 10 } },
    layerStyle: { layer_a: null },
  })

  expect(captured.name).toBe("Pose A")
  expect(captured.layerOpacity?.layer_a).toBe(0.4)
  expect(captured.layerFillOpacity?.layer_a).toBe(0.8)
  expect(captured.layerBlend?.layer_a).toBe("multiply")
  expect(captured.layerStyle?.layer_a?.dropShadow?.size).toBe(6)

  expect(projected.layers[0].visible).toBe(true)
  expect(projected.layers[0].opacity).toBe(0.75)
  expect(projected.layers[0].fillOpacity).toBe(0.6)
  expect(projected.layers[0].blendMode).toBe("screen")
  expect(projected.layers[0].style).toBeUndefined()
  expect(projected.layers[0].canvas).not.toBe(doc.layers[0].canvas)
})

test("timeline engine generates eased tween frames for opacity, transform, and effects", () => {
  const from = frame("from", {
    layerStyle: {
      layer_a: { dropShadow: { enabled: true, color: "#000000", size: 2, offsetX: 1, offsetY: 1, opacity: 0.2 } },
    },
    layerTransform: { layer_a: { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: 0 } },
  })
  const to = frame("to", {
    layerVisibility: { layer_a: true, layer_b: true },
    layerOpacity: { layer_a: 1, layer_b: 1 },
    layerStyle: {
      layer_a: { dropShadow: { enabled: true, color: "#000000", size: 10, offsetX: 5, offsetY: 5, opacity: 0.8 } },
    },
    layerTransform: { layer_a: { tx: 10, ty: 20, scaleX: 2, scaleY: 3, rotation: 90 } },
  })

  const tweens = generateTweenFrames(from, to, {
    steps: 1,
    easing: "linear",
    properties: { opacity: true, transform: true, style: true, visibility: true },
  })

  expect(tweens).toHaveLength(1)
  expect(tweens[0].layerOpacity?.layer_a).toBeCloseTo(0.7)
  expect(tweens[0].layerVisibility.layer_b).toBe(true)
  expect(tweens[0].layerTransform?.layer_a.tx).toBeCloseTo(5)
  expect(tweens[0].layerTransform?.layer_a.rotation).toBeCloseTo(45)
  expect(tweens[0].layerStyle?.layer_a?.dropShadow?.size).toBeCloseTo(6)
  expect(tweens[0].layerStyle?.layer_a?.dropShadow?.opacity).toBeCloseTo(0.5)
})

test("timeline engine renders onion-skin overlays at document size", () => {
  const doc = makeDoc({
    timelineFrames: [
      frame("before", { layerOpacity: { layer_a: 0.1, layer_b: 0 } }),
      frame("current", { layerOpacity: { layer_a: 0.5, layer_b: 0 } }),
      frame("after", { layerOpacity: { layer_a: 1, layer_b: 1 } }),
    ],
  })

  const overlay = renderOnionSkinOverlay(doc, doc.timelineFrames!, 1, {
    ...DEFAULT_TIMELINE_SETTINGS.onionSkin!,
    enabled: true,
    before: 1,
    after: 1,
    tint: "red-cyan",
  })

  expect(overlay?.width).toBe(doc.width)
  expect(overlay?.height).toBe(doc.height)
})

test("animation export encoders emit animated GIF, APNG, and WebP containers", async () => {
  const frames = animatedFrames()

  const gif = encodeAnimatedGif(frames, { transparent: true, loopCount: 0 })
  const apng = await encodeApngFromFrames(frames, { loopCount: 0 })
  const webp = await encodeAnimatedWebP(frames, { transparent: true, loopCount: 0 })
  const gifText = textFromBytes(gif)
  const apngText = textFromBytes(apng)
  const webpText = textFromBytes(webp)

  expect(gifText.slice(0, 6)).toBe("GIF89a")
  expect((gifText.match(/,/g) ?? []).length).toBe(2)
  expect(gifText).toContain("NETSCAPE2.0")

  expect(Array.from(apng.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(apngText).toContain("acTL")
  expect(apngText).toContain("fcTL")
  expect(apngText).toContain("fdAT")

  expect(webpText.slice(0, 4)).toBe("RIFF")
  expect(webpText.slice(8, 12)).toBe("WEBP")
  expect(webpText).toContain("VP8X")
  expect(webpText).toContain("ANIM")
  expect(webpText).toContain("ANMF")
})

test("timeline frame extraction samples document frames at a requested FPS", () => {
  const doc = makeDoc({
    timelineFrames: [
      frame("one", { durationMs: 500 }),
      frame("two", { durationMs: 250, layerOpacity: { layer_a: 1, layer_b: 0 } }),
    ],
  })

  const sampled = collectAnimationFramesAtFps(doc, { fps: 4, transparent: true })

  expect(sampled).toHaveLength(3)
  expect(sampled.map((item) => item.durationMs)).toEqual([250, 250, 250])
  expect(sampled[0].sourceFrameId).toBe("one")
  expect(sampled[1].sourceFrameId).toBe("one")
  expect(sampled[2].sourceFrameId).toBe("two")
  expect(sampled.every((item) => (item.timeMs ?? 0) % 250 === 0)).toBe(true)
})

test("animation export reports describe native APNG and RIFF animated WebP output", () => {
  const doc = makeDoc({ timelineFrames: [frame("one"), frame("two")] })
  const apng = createExportLimitationReport(doc, { format: "apng", transparent: true })
  const webp = createExportLimitationReport(doc, { format: "animated-webp", transparent: true })
  const apngDetails = apng.items.map((item) => item.detail).join("\n")
  const webpDetails = webp.items.map((item) => item.detail).join("\n")

  expect(apngDetails).toContain("APNG frames")
  expect(webpDetails).toContain("RIFF")
  expect(webpDetails).not.toContain("JSON frame package")
})
