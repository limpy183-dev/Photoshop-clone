import { expect, test } from "@playwright/test"

import {
  buildContentAwareFillPlan,
  buildSelectionHeuristicMaskData,
} from "../components/photoshop/tool-helpers"
import {
  autoAlignImageStack,
  autoBlendImageStack,
  buildSelectAndMaskPreviewModel,
  detectImageFeatures,
  focusStackImageData,
  matchImageFeatures,
  mergeHdrImageStack,
  photomergeImageStack,
  perspectiveCropImageData,
  seamCarveImageData,
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
  expect(panorama.image.width).toBe(6)
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

test("photomerge uses classical feature matching diagnostics and expands the panorama canvas", () => {
  const worldColor = (x: number, y: number): [number, number, number, number] => {
    const marker = `${x},${y}`
    if (marker === "1,1") return [240, 30, 40, 255]
    if (marker === "3,1") return [40, 235, 60, 255]
    if (marker === "4,3") return [50, 70, 245, 255]
    if (marker === "6,2") return [235, 210, 40, 255]
    return [24 + x * 7, 35 + y * 9, 62 + ((x * 11 + y * 5) % 31), 255]
  }
  const reference = flatImage(6, 5, (x, y) => worldColor(x, y))
  const shifted = flatImage(6, 5, (x, y) => worldColor(x + 2, y))

  const features = detectImageFeatures(reference, { maxFeatures: 24 })
  expect(features.length).toBeGreaterThanOrEqual(4)

  const matched = matchImageFeatures(reference, shifted, { maxFeatures: 24, searchRadius: 4 })
  expect(matched.placement.dx).toBe(2)
  expect(matched.matches.length).toBeGreaterThanOrEqual(4)
  expect(matched.inliers.length).toBeGreaterThanOrEqual(3)

  const panorama = photomergeImageStack([reference, shifted], { searchRadius: 4, maxFeatures: 24 })
  expect(panorama.placements[1].dx).toBe(2)
  expect(panorama.image.width).toBe(8)
  expect(panorama.featureMatches[0].inliers.length).toBeGreaterThanOrEqual(3)
  expect(panorama.seamColumns).toContain(2)
})

test("HDR merge can align exposure brackets before tone mapping", () => {
  const scene = (x: number, y: number) => {
    if (x === 1 && y === 1) return [230, 40, 45, 255] as [number, number, number, number]
    if (x === 3 && y === 2) return [50, 220, 70, 255] as [number, number, number, number]
    if (x === 4 && y === 1) return [45, 70, 235, 255] as [number, number, number, number]
    return [42 + x * 23 + y * 8, 52 + x * 17, 64 + y * 24, 255] as [number, number, number, number]
  }
  const dark = flatImage(6, 4, (x, y) => {
    const [r, g, b, a] = scene(x, y)
    return [Math.round(r * 0.36), Math.round(g * 0.36), Math.round(b * 0.36), a]
  })
  const brightShifted = flatImage(6, 4, (x, y) => {
    const sourceX = Math.min(5, x + 1)
    const [r, g, b, a] = scene(sourceX, y)
    return [Math.min(255, Math.round(r * 1.35)), Math.min(255, Math.round(g * 1.35)), Math.min(255, Math.round(b * 1.35)), a]
  })

  const hdr = mergeHdrImageStack([dark, brightShifted], [{ ev: -1 }, { ev: 1 }], { align: true, searchRadius: 2 })

  expect(hdr.placements[1].dx).toBe(1)
  expect(hdr.image.width).toBe(6)
  expect(hdr.radiance.length).toBe(6 * 4 * 3)
  expect(hdr.exposureWeights[0][0]).toBeGreaterThan(0)
})

test("projective perspective crop maps a quadrilateral into a rectified image", () => {
  const source = flatImage(5, 5, (x, y) => [x * 45, y * 45, 40 + x * 10 + y * 5, 255])
  const crop = perspectiveCropImageData(source, [
    { x: 1, y: 0 },
    { x: 4, y: 1 },
    { x: 3, y: 4 },
    { x: 0, y: 3 },
  ])

  expect(crop.image.width).toBeGreaterThanOrEqual(3)
  expect(crop.image.height).toBeGreaterThanOrEqual(3)
  expect(crop.transform.corners[0]).toEqual({ x: 1, y: 0 })
  expect(crop.image.data[0]).toBeGreaterThan(35)
  const bottomRight = ((crop.image.height - 1) * crop.image.width + crop.image.width - 1) * 4
  expect(crop.image.data[bottomRight]).toBeGreaterThan(120)
  expect(crop.image.data[bottomRight + 1]).toBeGreaterThan(120)
})

test("seam carving removes low-energy seams while honoring protected pixels", () => {
  const source = flatImage(5, 3, (x, y) => (x === 2 ? [245, 30 + y * 5, 30, 255] : [20 + x * 3, 45 + y * 4, 80, 255]))
  const protectMask = new Uint8Array(5 * 3)
  for (let y = 0; y < 3; y++) protectMask[y * 5 + 2] = 255

  const carved = seamCarveImageData(source, 4, 3, { protectMask })

  expect(carved.image.width).toBe(4)
  expect(carved.image.height).toBe(3)
  expect(carved.removedVerticalSeams).toHaveLength(1)
  expect(Array.from(carved.removedVerticalSeams[0])).not.toContain(2)
  let protectedColumnFound = false
  for (let y = 0; y < carved.image.height; y++) {
    for (let x = 0; x < carved.image.width; x++) {
      const i = (y * carved.image.width + x) * 4
      protectedColumnFound ||= carved.image.data[i] > 220 && carved.image.data[i + 1] < 60
    }
  }
  expect(protectedColumnFound).toBe(true)
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
