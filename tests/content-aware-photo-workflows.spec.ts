import { expect, test } from "@playwright/test"

import {
  buildContentAwareFillPlan,
  buildSelectionHeuristicMaskData,
} from "../components/photoshop/tool-helpers"
import {
  autoAlignImageStack,
  autoBlendImageStack,
  buildSelectAndMaskPreviewModel,
  focusStackImageData,
  mergeHdrImageStack,
  photomergeImageStack,
} from "../components/photoshop/photo-workflow-engine"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function flatImage(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number, number]) {
  const pixels: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.push(...colorAt(x, y))
  }
  return imageData(width, height, pixels)
}

test("content-aware fill plan exposes sampling controls, adaptation, output target, and preview masks", () => {
  const src = flatImage(6, 4, (x, y) => [30 + x * 20, 80 + y * 15, 140, 255])

  const plan = buildContentAwareFillPlan(src, {
    fillBounds: { x: 2, y: 1, w: 2, h: 2 },
    sampling: {
      mode: "custom",
      regions: [{ x: 0, y: 0, w: 2, h: 4 }],
      excludeRegions: [{ x: 0, y: 3, w: 2, h: 1 }],
    },
    adaptation: {
      color: 0.65,
      rotation: "low",
      scale: "medium",
      mirror: true,
    },
    outputTarget: "new-layer",
    preview: true,
  })

  expect(plan.fillPixels).toBe(4)
  expect(plan.samplePixels).toBe(6)
  expect(plan.sampling.bounds).toEqual({ x: 0, y: 0, w: 2, h: 3 })
  expect(plan.adaptation).toEqual({ color: 0.65, rotation: "low", scale: "medium", mirror: true })
  expect(plan.outputTarget).toBe("new-layer")
  expect(plan.previewData?.width).toBe(6)
  expect(plan.previewData?.height).toBe(4)
  expect(plan.previewData?.fillAlpha[1 * 6 + 2]).toBe(255)
  expect(plan.previewData?.sampleAlpha[2 * 6 + 1]).toBe(255)
  expect(plan.previewData?.sampleAlpha[3 * 6 + 1]).toBe(0)
  expect(plan.previewData?.confidenceAlpha[1 * 6 + 2]).toBeGreaterThan(0)
})

test("photo workflow helpers align, blend, photomerge, HDR merge, and focus stack deterministic fixtures", () => {
  const base = flatImage(5, 3, (x, y) => {
    const hit = x === 1 && y === 1
    return hit ? [240, 40, 30, 255] : [10 + x, 20 + y, 30, 255]
  })
  const moved = flatImage(5, 3, (x, y) => {
    const hit = x === 2 && y === 1
    return hit ? [240, 40, 30, 255] : [10 + Math.max(0, x - 1), 20 + y, 30, 255]
  })

  const aligned = autoAlignImageStack([base, moved], { searchRadius: 2 })
  expect(aligned.placements.map((placement) => ({ dx: placement.dx, dy: placement.dy }))).toEqual([
    { dx: 0, dy: 0 },
    { dx: -1, dy: 0 },
  ])

  const blended = autoBlendImageStack([base, moved], aligned.placements)
  expect(blended.image.width).toBe(5)
  expect(blended.image.data[(1 * 5 + 1) * 4]).toBeGreaterThan(220)
  expect(blended.coverage[1 * 5 + 1]).toBe(2)

  const panorama = photomergeImageStack([base, moved], { searchRadius: 2 })
  expect(panorama.placements[1].dx).toBe(-1)
  expect(panorama.image.width).toBe(5)
  expect(panorama.seamColumns).toContain(1)

  const dark = flatImage(2, 1, (x) => [x === 0 ? 12 : 80, x === 0 ? 14 : 90, x === 0 ? 16 : 100, 255])
  const bright = flatImage(2, 1, (x) => [x === 0 ? 220 : 170, x === 0 ? 230 : 180, x === 0 ? 240 : 190, 255])
  const hdr = mergeHdrImageStack([dark, bright], [{ ev: -2 }, { ev: 2 }])
  expect(hdr.image.data[0]).toBeGreaterThan(12)
  expect(hdr.image.data[0]).toBeLessThan(220)
  expect(hdr.exposureWeights[0][0]).toBeGreaterThan(hdr.exposureWeights[1][0])

  const leftSharp = flatImage(3, 3, (x, y) => [x === 1 && y === 1 ? 255 : 20, 20, 20, 255])
  const rightSharp = flatImage(3, 3, (x, y) => [20, x === 1 && y === 1 ? 255 : 20, 20, 255])
  const focused = focusStackImageData([leftSharp, rightSharp])
  expect(focused.sourceIndexByPixel[4]).toBe(0)
  expect(focused.image.data[4 * 4]).toBe(255)
})

test("select and mask modeling includes expanded view modes and output targets", () => {
  const model = buildSelectAndMaskPreviewModel({
    viewMode: "on-transparent",
    outputTo: "new-document",
    opacity: 65,
    decontaminateColors: true,
  })

  expect(model.background).toBe("transparent-grid")
  expect(model.showsComposite).toBe(false)
  expect(model.overlayOpacity).toBe(0.65)
  expect(model.output.createsDocument).toBe(true)
  expect(model.output.preservesSource).toBe(true)
  expect(model.output.supportsDecontamination).toBe(true)
})

test("selection heuristics distinguish object, subject, and sky regions without native AI claims", () => {
  const scene = flatImage(6, 5, (x, y) => {
    if (y <= 1) return [80, 150, 230, 255]
    if (x >= 2 && x <= 3 && y >= 2 && y <= 3) return [220, 50, 35, 255]
    if (x === 0 && y === 4) return [210, 55, 40, 255]
    return [45, 120, 55, 255]
  })

  const sky = buildSelectionHeuristicMaskData(scene, { kind: "sky" })
  expect(sky.bounds).toEqual({ x: 0, y: 0, w: 6, h: 2 })
  expect(sky.maskData[0]).toBe(255)
  expect(sky.maskData[4 * 6 + 0]).toBe(0)

  const subject = buildSelectionHeuristicMaskData(scene, { kind: "subject", tolerance: 36 })
  expect(subject.bounds).toEqual({ x: 2, y: 2, w: 2, h: 2 })
  expect(subject.diagnostics.nativeAiParity).toBe(false)

  const object = buildSelectionHeuristicMaskData(scene, {
    kind: "object",
    objectBounds: { x: 1, y: 1, w: 4, h: 4 },
    tolerance: 32,
  })
  expect(object.bounds).toEqual({ x: 2, y: 2, w: 2, h: 2 })
  expect(object.maskData[4 * 6 + 0]).toBe(0)
})
