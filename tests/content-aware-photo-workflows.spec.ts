import { expect, test } from "@playwright/test"

import {
  buildContentAwareFillPlan,
  buildSelectionHeuristicMaskData,
} from "../components/photoshop/tool-helpers"
import {
  applyPromptInpaintImageData,
  buildGenerativeFillPlan,
  classifyGenerativeFillProvider,
  createModelBackedGenerativeFillRequest,
} from "../components/photoshop/generative-fill-engine"
import {
  autoAlignImageStack,
  autoBlendImageStack,
  buildSelectAndMaskPreviewModel,
  detectImageFeatures,
  focusStackImageData,
  applyWorkflowTransformToPoint,
  matchImageFeatures,
  mergeHdrSceneLinearImageStack,
  mergeHdrImageStack,
  photomergeImageStack,
  perspectiveCropImageData,
  seamCarveImageData,
  solveProjectiveTransformFromPointPairs,
} from "../components/photoshop/photo-workflow-engine"
import type { HighBitImage } from "../components/photoshop/color-pipeline"

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

test("content-aware fill plan exposes bounded patch synthesis controls", () => {
  const src = flatImage(8, 5, (x, y) => [30 + x * 14, 70 + y * 18, 110 + x * 3, 255])

  const plan = buildContentAwareFillPlan(src, {
    fillBounds: { x: 3, y: 1, w: 3, h: 3 },
    sampling: { mode: "auto" },
    patch: {
      patchRadius: 2,
      searchRadius: 9,
      candidateBudget: 12,
      boundaryCandidateBudget: 5,
      refinementPasses: 1,
      seamRelaxPasses: 0,
      coherence: 0.75,
      fillOrder: "center-first",
    },
    preview: true,
  })

  expect(plan.patch).toEqual({
    patchRadius: 2,
    searchRadius: 9,
    candidateBudget: 12,
    boundaryCandidateBudget: 5,
    refinementPasses: 1,
    seamRelaxPasses: 0,
    coherence: 0.75,
    fillOrder: "center-first",
  })
  expect(plan.previewData?.patchPriorityAlpha).toHaveLength(8 * 5)
  expect(plan.previewData?.patchPriorityAlpha[2 * 8 + 4]).toBeGreaterThan(plan.previewData?.patchPriorityAlpha[1 * 8 + 3] ?? 255)
})

test("prompt-guided generative fill plans local fallback and model-backed requests", () => {
  const src = flatImage(5, 3, (x, y) => [40 + x * 15, 55 + y * 20, 80, 255])
  const mask = new Uint8ClampedArray(5 * 3)
  mask[1 * 5 + 2] = 255

  const plan = buildGenerativeFillPlan(src, mask, {
    prompt: "blue sky replacement",
    mode: "fill",
    provider: "auto",
  })
  const local = applyPromptInpaintImageData(src, mask, plan)
  const request = createModelBackedGenerativeFillRequest({
    sourcePng: "data:image/png;base64,source",
    maskPng: "data:image/png;base64,mask",
    prompt: "remove the wire",
    mode: "remove",
    endpoint: "/api/photoshop/generative-fill",
  })

  expect(plan.maskBounds).toEqual({ x: 2, y: 1, w: 1, h: 1 })
  expect(plan.promptTokens).toContain("blue")
  expect(plan.provider.strategy).toBe("local-prompt-inpaint")
  expect(local.provenance.provider).toBe("local-prompt-inpaint")
  expect(local.provenance.promptHash).toMatch(/^gf_/)
  expect(local.image.data[(1 * 5 + 2) * 4 + 2]).toBeGreaterThan(src.data[(1 * 5 + 2) * 4 + 2])
  expect(request.body.mode).toBe("remove")
  expect(request.body.prompt).toBe("remove the wire")
  expect(classifyGenerativeFillProvider({ endpoint: request.endpoint, apiKeyPresent: true }).modelBacked).toBe(true)
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

test("photomerge can use similarity transforms instead of translation-only placement", () => {
  const reference = flatImage(10, 8, (x, y) => {
    const marker = `${x},${y}`
    if (marker === "3,2") return [230, 30, 30, 255]
    if (marker === "7,2") return [30, 210, 50, 255]
    if (marker === "3,6") return [40, 70, 235, 255]
    if (marker === "7,6") return [235, 210, 40, 255]
    return [20 + x * 6, 32 + y * 5, 58 + ((x * 13 + y * 7) % 29), 255]
  })
  const moving = flatImage(5, 5, (x, y) => {
    const marker = `${x},${y}`
    if (marker === "1,1") return [230, 30, 30, 255]
    if (marker === "3,1") return [30, 210, 50, 255]
    if (marker === "1,3") return [40, 70, 235, 255]
    if (marker === "3,3") return [235, 210, 40, 255]
    const rx = x * 2 + 1
    const ry = y * 2
    return [20 + rx * 6, 32 + ry * 5, 58 + ((rx * 13 + ry * 7) % 29), 255]
  })

  const matched = matchImageFeatures(reference, moving, {
    alignmentModel: "similarity",
    maxFeatures: 40,
    minFeatureDistance: 1,
    descriptorRadius: 1,
    ransacThreshold: 1.1,
  })
  expect(matched.placement.model).toBe("similarity")
  expect(matched.placement.transform?.a).toBeGreaterThan(1.5)
  expect(matched.placement.transform?.d).toBeGreaterThan(1.5)
  expect(Math.abs(matched.placement.transform?.b ?? 1)).toBeLessThan(0.35)
  expect(matched.inliers.length).toBeGreaterThanOrEqual(4)

  const panorama = photomergeImageStack([reference, moving], {
    alignmentModel: "similarity",
    maxFeatures: 40,
    minFeatureDistance: 1,
    descriptorRadius: 1,
    ransacThreshold: 1.1,
    projection: "cylindrical",
    projectionFocalLength: 12,
  })

  expect(panorama.projection).toBe("cylindrical")
  expect(panorama.placements[1].model).toBe("similarity")
  expect(panorama.image.width).toBeGreaterThanOrEqual(10)
  expect(panorama.transformDiagnostics[0].inliers).toBeGreaterThanOrEqual(4)
})

test("photomerge solves projective camera geometry and exposes production blend diagnostics", () => {
  const transform = solveProjectiveTransformFromPointPairs([
    { source: { x: 0, y: 0 }, target: { x: 1, y: 1 } },
    { source: { x: 4, y: 0 }, target: { x: 6, y: 0 } },
    { source: { x: 4, y: 3 }, target: { x: 5, y: 5 } },
    { source: { x: 0, y: 3 }, target: { x: 0, y: 4 } },
  ])

  expect(transform).toBeTruthy()
  for (const pair of [
    { source: { x: 0, y: 0 }, target: { x: 1, y: 1 } },
    { source: { x: 4, y: 0 }, target: { x: 6, y: 0 } },
    { source: { x: 4, y: 3 }, target: { x: 5, y: 5 } },
    { source: { x: 0, y: 3 }, target: { x: 0, y: 4 } },
  ]) {
    const projected = applyWorkflowTransformToPoint(transform!, pair.source.x, pair.source.y)
    expect(projected.x).toBeCloseTo(pair.target.x, 4)
    expect(projected.y).toBeCloseTo(pair.target.y, 4)
  }

  const reference = flatImage(8, 4, (x, y) => [30 + x * 14, 42 + y * 21, 90 + ((x + y) % 3) * 30, 255])
  const shifted = flatImage(8, 4, (x, y) => [30 + Math.max(0, x - 2) * 14, 42 + y * 21, 90 + (((Math.max(0, x - 2)) + y) % 3) * 30, 255])
  const panorama = photomergeImageStack([reference, shifted], {
    searchRadius: 3,
    alignmentModel: "homography",
    projection: "spherical",
    blendMode: "multiband",
    cameraModel: {
      focalLengthPx: 12,
      sensorWidthMm: 36,
      lens: { k1: -0.02, k2: 0.004, p1: 0.001, p2: -0.001 },
    },
  })

  expect(panorama.projection).toBe("spherical")
  expect(panorama.cameraModel?.focalLengthPx).toBe(12)
  expect(panorama.blendDiagnostics.mode).toBe("multiband")
  expect(panorama.blendDiagnostics.exposureCompensated).toBe(true)
  expect(panorama.image.width).toBeGreaterThanOrEqual(8)
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

test("HDR merge exposes deghost masks and exposure weighting controls", () => {
  const dark = flatImage(4, 2, (x, y) => {
    if (x === 1 && y === 0) return [40, 42, 44, 255]
    return [30 + x * 8, 34 + y * 9, 38 + x * 4, 255]
  })
  const normalWithGhost = flatImage(4, 2, (x, y) => {
    if (x === 1 && y === 0) return [235, 36, 34, 255]
    return [68 + x * 18, 72 + y * 16, 76 + x * 10, 255]
  })
  const bright = flatImage(4, 2, (x, y) => {
    if (x === 1 && y === 0) return [92, 94, 96, 255]
    return [120 + x * 24, 126 + y * 18, 132 + x * 13, 255]
  })

  const hdr = mergeHdrImageStack(
    [dark, normalWithGhost, bright],
    [{ ev: -1 }, { ev: 0 }, { ev: 1 }],
    {
      deghost: "high",
      referenceIndex: 0,
      exposureWeighting: "shadow-priority",
      manualExposureWeights: [1, 0.7, 1.4],
      toneMapping: { exposure: 0.1, compression: 0.85, gamma: 2.15 },
    },
  )
  const ghostPixel = 1

  expect(hdr.deghostMask[ghostPixel]).toBe(255)
  expect(hdr.sourceIndexByPixel[ghostPixel]).toBe(0)
  expect(hdr.image.data[ghostPixel * 4]).toBeLessThan(150)
  expect(hdr.exposureWeights[2][4]).toBeGreaterThan(hdr.exposureWeights[0][4])
  expect(hdr.toneMapping).toEqual({ exposure: 0.1, compression: 0.85, gamma: 2.15 })
})

test("HDR merge can emit scene-linear 32-bit high-bit output from RAW-style frames", () => {
  const dark: HighBitImage = {
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    storage: "float32",
    data: new Float32Array([0.02, 0.03, 0.04, 1, 0.12, 0.13, 0.14, 1]),
    warnings: [],
  }
  const bright: HighBitImage = {
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    storage: "float32",
    data: new Float32Array([0.28, 0.3, 0.32, 1, 0.82, 0.84, 0.86, 1]),
    warnings: [],
  }

  const hdr = mergeHdrSceneLinearImageStack(
    [
      { image: dark, ev: -2, sourceKind: "raw" },
      { image: bright, ev: 2, sourceKind: "raw" },
    ],
    { deghost: "low", toneMapping: { exposure: 0, compression: 0.9, gamma: 2.2 } },
  )

  expect(hdr.highBitImage.bitDepth).toBe(32)
  expect(hdr.highBitImage.storage).toBe("float32")
  expect(hdr.highBitImage.warnings.join(" ")).toContain("scene-linear")
  expect(hdr.preview.width).toBe(2)
  expect(hdr.rawStack).toBe(true)
  expect((hdr.highBitImage.data as Float32Array)[0]).toBeGreaterThan(0.02)
  expect(hdr.deghostMask).toHaveLength(2)
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
