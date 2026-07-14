import { makeCanvas } from "../canvas-utils"
import {
  buildOfflineObjectAwareSelectionMaskData,
  type OfflineObjectAwareSelectionResult,
} from "../selection-algorithms"
import {
  clamp,
  distanceToFeature,
  MASK_THRESHOLD,
  type Rect,
} from "../tool-helpers-shared"
import {
  alphaDataToMask,
  binaryToMask,
  cleanBinaryMask,
  featherMask,
  imageDataToMask,
  keepScoredComponents,
} from "./selection-masks"

/* ---------------------------------------------------------------- */
/*  SUBJECT DETECTION (heuristic)                                     */
/* ---------------------------------------------------------------- */

function rgbDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function imagePixel(img: ImageData, x: number, y: number) {
  const cx = clamp(Math.floor(x), 0, img.width - 1)
  const cy = clamp(Math.floor(y), 0, img.height - 1)
  const i = (cy * img.width + cx) * 4
  return {
    r: img.data[i],
    g: img.data[i + 1],
    b: img.data[i + 2],
    a: img.data[i + 3],
  }
}

function localGradient(img: ImageData, x: number, y: number) {
  if (x <= 0 || y <= 0 || x >= img.width - 1 || y >= img.height - 1) return 0
  const lx1 = imagePixel(img, x - 1, y)
  const lx2 = imagePixel(img, x + 1, y)
  const ly1 = imagePixel(img, x, y - 1)
  const ly2 = imagePixel(img, x, y + 1)
  const gx = luma(lx2.r, lx2.g, lx2.b) - luma(lx1.r, lx1.g, lx1.b)
  const gy = luma(ly2.r, ly2.g, ly2.b) - luma(ly1.r, ly1.g, ly1.b)
  return Math.hypot(gx, gy)
}

export interface SelectionHeuristicMaskOptions {
  kind: "object" | "subject" | "sky"
  objectBounds?: Rect
  tolerance?: number
}

export interface SelectionHeuristicMaskResult {
  maskData: Uint8ClampedArray
  width: number
  height: number
  bounds: Rect | null
  score: number
  diagnostics: {
    method: "local-heuristic" | "offline-object-aware"
    nativeAiParity: false
    candidatePixels: number
    keptPixels: number
    rejectedPixels?: number
    sourcePrecision?: OfflineObjectAwareSelectionResult["diagnostics"]["sourcePrecision"]
  }
}

export function buildSelectionHeuristicMaskData(
  src: ImageData,
  options: SelectionHeuristicMaskOptions,
): SelectionHeuristicMaskResult {
  return buildOfflineObjectAwareSelectionMaskData(src, options) as SelectionHeuristicMaskResult
}

function offlineSelectionMaskFromCanvas(
  src: HTMLCanvasElement,
  options: Parameters<typeof buildOfflineObjectAwareSelectionMaskData>[1],
  featherRadius: number,
) {
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const result = buildOfflineObjectAwareSelectionMaskData(img, options)
  const mask = alphaDataToMask(result.maskData, result.width, result.height)
  return featherRadius > 0 ? featherMask(mask, featherRadius) : mask
}

export function selectSubjectMask(
  src: HTMLCanvasElement,
  tolerance = 48,
): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "subject", tolerance }, 0.85)
}

export function selectSkyMask(src: HTMLCanvasElement): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "sky" }, 1.1)
}

export function selectBackgroundMask(src: HTMLCanvasElement, tolerance = 48): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "background", tolerance }, 1)
}

export function focusAreaMask(src: HTMLCanvasElement, sensitivity = 0.42): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  const sharpness = new Float32Array(w * h)
  let sum = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const c = luma(img.data[i], img.data[i + 1], img.data[i + 2]) * 4
      const left = imagePixel(img, x - 1, y)
      const right = imagePixel(img, x + 1, y)
      const up = imagePixel(img, x, y - 1)
      const down = imagePixel(img, x, y + 1)
      const v =
        Math.abs(
          c -
            luma(left.r, left.g, left.b) -
            luma(right.r, right.g, right.b) -
            luma(up.r, up.g, up.b) -
            luma(down.r, down.g, down.b),
        ) + localGradient(img, x, y) * 0.85
      sharpness[p] = v
      sum += v
      count++
    }
  }
  if (!count) return makeCanvas(w, h)
  const mean = sum / count
  let variance = 0
  for (let i = 0; i < sharpness.length; i++) {
    if (sharpness[i] > 0) variance += (sharpness[i] - mean) * (sharpness[i] - mean)
  }
  const stdev = Math.sqrt(variance / count)
  const threshold = mean + stdev * sensitivity
  const candidate = new Uint8Array(w * h)
  for (let i = 0; i < sharpness.length; i++) {
    if (sharpness[i] >= threshold) candidate[i] = 1
  }
  const grow = Math.max(4, Math.round(Math.min(w, h) / 70))
  const cleaned = cleanBinaryMask(candidate, w, h, grow, 1)
  const kept = keepScoredComponents(
    cleaned,
    w,
    h,
    (pixels) => pixels.length,
    0.18,
    Math.max(12, Math.floor(w * h * 0.0007)),
  )
  return featherMask(binaryToMask(kept, w, h), 1.2)
}

export function objectSelectionMask(
  src: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  tolerance = 44,
): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "object", objectBounds: rect, tolerance }, 0.85)
}

export function refineEdgeBrushMask(
  src: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  points: { x: number; y: number }[],
  brushSize: number,
  mode: "expand" | "subtract" = "expand",
): HTMLCanvasElement {
  const w = selectionMask.width
  const h = selectionMask.height
  const srcCtx = src.getContext("2d")!
  const img = srcCtx.getImageData(0, 0, w, h)
  const maskCtx = selectionMask.getContext("2d")!
  const maskImg = maskCtx.getImageData(0, 0, w, h)
  const bin = new Uint8Array(w * h)
  const outside = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    bin[i] = maskImg.data[i * 4 + 3] > MASK_THRESHOLD ? 1 : 0
    outside[i] = bin[i] ? 0 : 1
  }
  const distToSelected = distanceToFeature(bin, w, h)
  const distToOutside = distanceToFeature(outside, w, h)
  const influence = new Float32Array(w * h)
  const radius = Math.max(2, brushSize / 2)
  for (const pt of points) {
    const x0 = clamp(Math.floor(pt.x - radius), 0, w - 1)
    const y0 = clamp(Math.floor(pt.y - radius), 0, h - 1)
    const x1 = clamp(Math.ceil(pt.x + radius), x0 + 1, w)
    const y1 = clamp(Math.ceil(pt.y + radius), y0 + 1, h)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - pt.x, y - pt.y)
        if (d > radius) continue
        const p = y * w + x
        influence[p] = Math.max(influence[p], 1 - d / radius)
      }
    }
  }

  let insideR = 0
  let insideG = 0
  let insideB = 0
  let insideWeight = 0
  let outsideR = 0
  let outsideG = 0
  let outsideB = 0
  let outsideWeight = 0
  const modelBand = Math.max(3, radius * 0.7)
  const modelBand2 = modelBand * modelBand
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inf = influence[p]
      if (inf <= 0) continue
      const nearModelEdge = distToSelected[p] <= modelBand2 || distToOutside[p] <= modelBand2
      if (!nearModelEdge) continue
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const weight = inf * (1 + Math.min(1, localGradient(img, x, y) / 96))
      if (bin[p]) {
        insideR += img.data[i] * weight
        insideG += img.data[i + 1] * weight
        insideB += img.data[i + 2] * weight
        insideWeight += weight
      } else {
        outsideR += img.data[i] * weight
        outsideG += img.data[i + 1] * weight
        outsideB += img.data[i + 2] * weight
        outsideWeight += weight
      }
    }
  }
  const colorModel =
    insideWeight > 0 && outsideWeight > 0
      ? {
          inside: { r: insideR / insideWeight, g: insideG / insideWeight, b: insideB / insideWeight },
          outside: { r: outsideR / outsideWeight, g: outsideG / outsideWeight, b: outsideB / outsideWeight },
        }
      : null

  const out = new ImageData(new Uint8ClampedArray(maskImg.data), w, h)
  const edgeBand = Math.max(3, radius * 0.55)
  const edgeBand2 = edgeBand * edgeBand
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inf = influence[p]
      if (inf <= 0) continue
      const i = p * 4
      const nearEdge = distToSelected[p] <= edgeBand2 || distToOutside[p] <= edgeBand2
      if (!nearEdge) continue
      const rgb = { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
      const insideDistance = colorModel ? rgbDistance(rgb, colorModel.inside) : 0
      const outsideDistance = colorModel ? rgbDistance(rgb, colorModel.outside) : 0
      const colorLooksInside = !!colorModel && insideDistance + 10 < outsideDistance
      const colorLooksOutside = !!colorModel && outsideDistance + 10 < insideDistance
      if (mode === "subtract") {
        const remove = colorLooksOutside || distToOutside[p] <= edgeBand2 || localGradient(img, x, y) < 18
        if (remove) out.data[i + 3] = Math.max(0, out.data[i + 3] - Math.round(255 * inf))
        continue
      }
      const sourceAlpha = img.data[i + 3]
      if (sourceAlpha <= MASK_THRESHOLD) continue
      const grad = localGradient(img, x, y)
      const add =
        colorLooksInside ||
        distToSelected[p] <= edgeBand2 * 0.85 ||
        grad > 18 ||
        (sourceAlpha > 80 && distToSelected[p] <= edgeBand2 * 1.2)
      if (add) {
        const feather = clamp(1 - Math.sqrt(distToSelected[p]) / Math.max(1, edgeBand * 1.2), 0.18, 1)
        const colorBoost = colorLooksInside ? 0.16 : 0
        const alpha = Math.round(255 * Math.max(inf * (0.75 + colorBoost), feather * (0.82 + colorBoost)))
        out.data[i] = 255
        out.data[i + 1] = 255
        out.data[i + 2] = 255
        out.data[i + 3] = Math.max(out.data[i + 3], alpha)
      }
    }
  }
  return featherMask(imageDataToMask(out), 0.55)
}
