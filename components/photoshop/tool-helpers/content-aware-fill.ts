import {
  clamp,
  clampByte,
  distanceToFeature,
  MASK_THRESHOLD,
  sampleImageData,
  type Rect,
} from "../tool-helpers-shared"
import { featherMask } from "./selection-masks"

/* ---------------------------------------------------------------- */
/*  CONTENT-AWARE FILL / PATCH                                        */
/* ---------------------------------------------------------------- */

function buildFillAlpha(
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
  mask?: ImageData,
) {
  const alpha = new Uint8Array(width * height)
  if (mask) {
    const mw = Math.min(width, mask.width)
    const mh = Math.min(height, mask.height)
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        alpha[y * width + x] = mask.data[(y * mask.width + x) * 4 + 3]
      }
    }
    return alpha
  }

  const x0 = Math.max(0, Math.floor(bounds.x))
  const y0 = Math.max(0, Math.floor(bounds.y))
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.w))
  const y1 = Math.min(height, Math.ceil(bounds.y + bounds.h))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) alpha[y * width + x] = 255
  }
  return alpha
}

function alphaBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold = MASK_THRESHOLD,
) {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= threshold) continue
      any = true
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

function hasOutsideNeighbor(alpha: Uint8Array, width: number, height: number, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
      if (alpha[ny * width + nx] <= MASK_THRESHOLD) return true
    }
  }
  return false
}

function pseudoRandomIndex(seed: number, max: number) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return Math.abs(x) % max
}

function averageAround(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  accept: (p: number) => boolean,
) {
  const r = Math.max(1, Math.round(radius))
  const x0 = Math.max(0, Math.floor(x - r))
  const y0 = Math.max(0, Math.floor(y - r))
  const x1 = Math.min(width - 1, Math.ceil(x + r))
  const y1 = Math.min(height - 1, Math.ceil(y + r))
  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0
  let count = 0
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (Math.hypot(xx - x, yy - y) > r) continue
      const p = yy * width + xx
      if (!accept(p)) continue
      const i = p * 4
      red += data[i]
      green += data[i + 1]
      blue += data[i + 2]
      alpha += data[i + 3]
      count++
    }
  }
  return count ? { r: red / count, g: green / count, b: blue / count, a: alpha / count, count } : null
}

function fallbackFillColor(
  data: Uint8ClampedArray,
  filled: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  for (const radius of [3, 7, 15, 31]) {
    const avg = averageAround(data, width, height, x, y, radius, (p) => filled[p] > 0)
    if (avg && avg.count > 0) return avg
  }
  return { r: 0, g: 0, b: 0, a: 0, count: 0 }
}

type ContentAwareFillOutputTarget = "current-layer" | "new-layer" | "duplicate-layer" | "selection-preview"
type ContentAwareAdaptation = {
  color: number
  rotation: "none" | "low" | "medium" | "high"
  scale: "none" | "low" | "medium" | "high"
  mirror: boolean
}
type ContentAwareFillOrder = "edge-first" | "center-first" | "randomized"
type ContentAwarePatchControls = {
  patchRadius: number
  searchRadius: number
  candidateBudget: number
  boundaryCandidateBudget: number
  refinementPasses: number
  seamRelaxPasses: number
  coherence: number
  fillOrder: ContentAwareFillOrder
}

export interface ContentAwareFillPlanOptions {
  fillBounds: Rect
  mask?: ImageData
  sampling?: {
    mode?: "auto" | "custom" | "all-except-fill"
    regions?: Rect[]
    excludeRegions?: Rect[]
  }
  adaptation?: Partial<ContentAwareAdaptation>
  patch?: Partial<ContentAwarePatchControls>
  outputTarget?: ContentAwareFillOutputTarget
  preview?: boolean
}

export interface ContentAwareFillPlan {
  width: number
  height: number
  fillPixels: number
  samplePixels: number
  sampling: {
    mode: "auto" | "custom" | "all-except-fill"
    bounds: Rect | null
    regions: Rect[]
    excludeRegions: Rect[]
  }
  adaptation: ContentAwareAdaptation
  patch: ContentAwarePatchControls
  outputTarget: ContentAwareFillOutputTarget
  previewData?: {
    width: number
    height: number
    fillAlpha: Uint8Array
    sampleAlpha: Uint8Array
    confidenceAlpha: Uint8Array
    patchPriorityAlpha: Uint8Array
  }
}

function clippedRect(rect: Rect, width: number, height: number): Rect | null {
  const x0 = clamp(Math.floor(rect.x), 0, width)
  const y0 = clamp(Math.floor(rect.y), 0, height)
  const x1 = clamp(Math.ceil(rect.x + rect.w), 0, width)
  const y1 = clamp(Math.ceil(rect.y + rect.h), 0, height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function paintRectAlpha(alpha: Uint8Array, width: number, height: number, rect: Rect, value: number) {
  const clipped = clippedRect(rect, width, height)
  if (!clipped) return
  for (let y = clipped.y; y < clipped.y + clipped.h; y++) {
    for (let x = clipped.x; x < clipped.x + clipped.w; x++) alpha[y * width + x] = value
  }
}

function countAlpha(alpha: Uint8Array, threshold = MASK_THRESHOLD) {
  let count = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) count++
  return count
}

function normalizedFillOrder(value: unknown): ContentAwareFillOrder {
  return value === "center-first" || value === "randomized" ? value : "edge-first"
}

function normalizeContentAwarePatchControls(
  width: number,
  height: number,
  fillBounds: Rect,
  fillPixelCount: number,
  options?: Partial<ContentAwarePatchControls>,
): ContentAwarePatchControls {
  const defaultPatchRadius = fillPixelCount > 100000 ? 2 : fillPixelCount > 35000 ? 3 : 4
  const defaultSearchRadius = Math.max(36, Math.round(Math.max(fillBounds.w, fillBounds.h) * 1.35))
  const maxSearchRadius = Math.max(4, Math.ceil(Math.hypot(width, height)))
  return {
    patchRadius: clamp(Math.round(options?.patchRadius ?? defaultPatchRadius), 1, 10),
    searchRadius: clamp(Math.round(options?.searchRadius ?? defaultSearchRadius), 1, maxSearchRadius),
    candidateBudget: clamp(Math.round(options?.candidateBudget ?? (fillPixelCount > 80000 ? 32 : 56)), 1, 256),
    boundaryCandidateBudget: clamp(Math.round(options?.boundaryCandidateBudget ?? 18), 0, 128),
    refinementPasses: clamp(Math.round(options?.refinementPasses ?? (fillPixelCount > 60000 ? 1 : fillPixelCount > 12000 ? 2 : 3)), 0, 8),
    seamRelaxPasses: clamp(Math.round(options?.seamRelaxPasses ?? 2), 0, 8),
    coherence: clamp(options?.coherence ?? 1, 0, 4),
    fillOrder: normalizedFillOrder(options?.fillOrder),
  }
}

function buildPatchPriorityAlpha(
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  fillPixels: number[],
  distToOutside: Float64Array,
  fillOrder: ContentAwareFillOrder,
) {
  const out = new Uint8Array(width * height)
  let maxDist = 0
  for (const p of fillPixels) maxDist = Math.max(maxDist, distToOutside[p] || 0)
  for (const p of fillPixels) {
    if (fillAlpha[p] <= MASK_THRESHOLD) continue
    const normalized = maxDist <= 0 ? 1 : clamp(distToOutside[p] / maxDist, 0, 1)
    const priority =
      fillOrder === "center-first"
        ? normalized
        : fillOrder === "randomized"
          ? pseudoRandomIndex(p + width * 131 + height * 17, 256) / 255
          : 1 - normalized
    out[p] = clampByte(32 + priority * 223)
  }
  return out
}

function buildSamplingAlpha(width: number, height: number, fillAlpha: Uint8Array, fillBounds: Rect, options: ContentAwareFillPlanOptions["sampling"]) {
  const mode = options?.mode ?? "auto"
  const sampleAlpha = new Uint8Array(width * height)
  const regions = (options?.regions ?? []).map((rect) => clippedRect(rect, width, height)).filter(Boolean) as Rect[]
  const excludeRegions = (options?.excludeRegions ?? []).map((rect) => clippedRect(rect, width, height)).filter(Boolean) as Rect[]

  if (mode === "custom" && regions.length) {
    for (const region of regions) paintRectAlpha(sampleAlpha, width, height, region, 255)
  } else if (mode === "all-except-fill") {
    sampleAlpha.fill(255)
  } else {
    const pad = Math.max(4, Math.round(Math.max(fillBounds.w, fillBounds.h) * 1.5))
    const outer = { x: fillBounds.x - pad, y: fillBounds.y - pad, w: fillBounds.w + pad * 2, h: fillBounds.h + pad * 2 }
    paintRectAlpha(sampleAlpha, width, height, outer, 255)
  }

  for (let i = 0; i < sampleAlpha.length; i++) {
    if (fillAlpha[i] > MASK_THRESHOLD) sampleAlpha[i] = 0
  }
  for (const region of excludeRegions) paintRectAlpha(sampleAlpha, width, height, region, 0)
  return { mode, sampleAlpha, regions, excludeRegions }
}

export function buildContentAwareFillPlan(src: ImageData, options: ContentAwareFillPlanOptions): ContentAwareFillPlan {
  const width = src.width
  const height = src.height
  const fillAlpha = buildFillAlpha(width, height, options.fillBounds, options.mask)
  const fillBounds = alphaBounds(fillAlpha, width, height) ?? clippedRect(options.fillBounds, width, height) ?? { x: 0, y: 0, w: 0, h: 0 }
  const sampling = buildSamplingAlpha(width, height, fillAlpha, fillBounds, options.sampling)
  const fillPixels: number[] = []
  const outside = new Uint8Array(width * height)
  for (let p = 0; p < width * height; p++) {
    if (fillAlpha[p] > MASK_THRESHOLD) fillPixels.push(p)
    else outside[p] = 1
  }
  const distToOutside = distanceToFeature(outside, width, height)
  const patch = normalizeContentAwarePatchControls(width, height, fillBounds, fillPixels.length, options.patch)
  const confidenceAlpha = new Uint8Array(width * height)
  const samplePixels = countAlpha(sampling.sampleAlpha)
  if (samplePixels > 0) {
    for (let p = 0; p < confidenceAlpha.length; p++) {
      if (fillAlpha[p] <= MASK_THRESHOLD) continue
      const x = p % width
      const y = (p - x) / width
      const distToEdge = Math.min(
        Math.abs(x - fillBounds.x),
        Math.abs(y - fillBounds.y),
        Math.abs(fillBounds.x + fillBounds.w - 1 - x),
        Math.abs(fillBounds.y + fillBounds.h - 1 - y),
      )
      confidenceAlpha[p] = clampByte(210 - distToEdge * 24)
    }
  }
  const patchPriorityAlpha = buildPatchPriorityAlpha(fillAlpha, width, height, fillPixels, distToOutside, patch.fillOrder)

  return {
    width,
    height,
    fillPixels: countAlpha(fillAlpha),
    samplePixels,
    sampling: {
      mode: sampling.mode,
      bounds: alphaBounds(sampling.sampleAlpha, width, height),
      regions: sampling.regions,
      excludeRegions: sampling.excludeRegions,
    },
    adaptation: {
      color: clamp(options.adaptation?.color ?? 0.5, 0, 1),
      rotation: options.adaptation?.rotation ?? "none",
      scale: options.adaptation?.scale ?? "none",
      mirror: options.adaptation?.mirror ?? false,
    },
    patch,
    outputTarget: options.outputTarget ?? "current-layer",
    previewData: options.preview
      ? { width, height, fillAlpha, sampleAlpha: sampling.sampleAlpha, confidenceAlpha, patchPriorityAlpha }
      : undefined,
  }
}

function patchMatchScore(
  source: Uint8ClampedArray,
  work: Uint8ClampedArray,
  filled: Uint8Array,
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  radius: number,
  coherence: number,
) {
  if (sx < radius || sy < radius || sx >= width - radius || sy >= height - radius) return Number.POSITIVE_INFINITY
  if (fillAlpha[sy * width + sx] > MASK_THRESHOLD) return Number.POSITIVE_INFINITY

  let score = 0
  let samples = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const txx = tx + dx
      const tyy = ty + dy
      const sxx = sx + dx
      const syy = sy + dy
      if (txx < 0 || tyy < 0 || txx >= width || tyy >= height) continue
      if (sxx < 0 || syy < 0 || sxx >= width || syy >= height) {
        score += 200000
        continue
      }
      const tp = tyy * width + txx
      const sp = syy * width + sxx
      if (fillAlpha[sp] > MASK_THRESHOLD) {
        score += 8500
        continue
      }
      if (!filled[tp]) continue
      const ti = tp * 4
      const si = sp * 4
      const dr = work[ti] - source[si]
      const dg = work[ti + 1] - source[si + 1]
      const db = work[ti + 2] - source[si + 2]
      const da = work[ti + 3] - source[si + 3]
      const centerWeight = 1.3 - Math.hypot(dx, dy) / Math.max(1, radius * 2)
      score += (dr * dr + dg * dg + db * db + da * da * 0.35) * centerWeight
      samples++
    }
  }
  if (samples < Math.max(4, radius * 2)) return Number.POSITIVE_INFINITY
  return score / samples + Math.hypot(tx - sx, ty - sy) * 0.02 * coherence
}

function seamRelax(
  work: Uint8ClampedArray,
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
  passes: number,
) {
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < outside.length; i++) outside[i] = fillAlpha[i] > MASK_THRESHOLD ? 0 : 1
  const dist = distanceToFeature(outside, width, height)
  const x0 = Math.max(0, bounds.x - 2)
  const y0 = Math.max(0, bounds.y - 2)
  const x1 = Math.min(width, bounds.x + bounds.w + 2)
  const y1 = Math.min(height, bounds.y + bounds.h + 2)
  const maxDist = 16

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8ClampedArray(work)
    for (let y = y0 + 1; y < y1 - 1; y++) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        const p = y * width + x
        if (fillAlpha[p] <= MASK_THRESHOLD || dist[p] > maxDist) continue
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const ni = ((y + dy) * width + x + dx) * 4
            r += work[ni]
            g += work[ni + 1]
            b += work[ni + 2]
            a += work[ni + 3]
            count++
          }
        }
        const i = p * 4
        const edgeBlend = Math.max(0.18, 0.42 * (1 - Math.sqrt(dist[p]) / Math.sqrt(maxDist)))
        next[i] = clampByte(work[i] * (1 - edgeBlend) + (r / count) * edgeBlend)
        next[i + 1] = clampByte(work[i + 1] * (1 - edgeBlend) + (g / count) * edgeBlend)
        next[i + 2] = clampByte(work[i + 2] * (1 - edgeBlend) + (b / count) * edgeBlend)
        next[i + 3] = clampByte(work[i + 3] * (1 - edgeBlend) + (a / count) * edgeBlend)
      }
    }
    work.set(next)
  }
}

/** Patch-synthesis content-aware fill with masked fill order, exemplar search, and seam relaxation. */
export function contentAwareFill(
  canvas: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number },
  mask?: ImageData,
  options?: Omit<ContentAwareFillPlanOptions, "fillBounds" | "mask">,
) {
  const ctx = canvas.getContext("2d")!
  const width = canvas.width
  const height = canvas.height
  if (width <= 0 || height <= 0) return

  const fillAlpha = buildFillAlpha(width, height, bounds, mask)
  const fillBounds = alphaBounds(fillAlpha, width, height)
  if (!fillBounds) return

  const original = ctx.getImageData(0, 0, width, height)
  const sampling = buildSamplingAlpha(width, height, fillAlpha, fillBounds, options?.sampling)
  const source = new Uint8ClampedArray(original.data)
  const work = new Uint8ClampedArray(original.data)
  const filled = new Uint8Array(width * height)
  const outside = new Uint8Array(width * height)
  const fillPixels: number[] = []

  for (let p = 0; p < width * height; p++) {
    if (fillAlpha[p] > MASK_THRESHOLD) {
      fillPixels.push(p)
    } else {
      filled[p] = 1
      outside[p] = 1
    }
  }

  const distToOutside = distanceToFeature(outside, width, height)
  const patch = normalizeContentAwarePatchControls(width, height, fillBounds, fillPixels.length, options?.patch)
  fillPixels.sort((a, b) => {
    if (patch.fillOrder === "center-first") return distToOutside[b] - distToOutside[a]
    if (patch.fillOrder === "randomized") {
      return pseudoRandomIndex(a + 7919, 1 << 20) - pseudoRandomIndex(b + 7919, 1 << 20)
    }
    return distToOutside[a] - distToOutside[b]
  })

  const searchPad = patch.searchRadius
  const sx0 = Math.max(0, fillBounds.x - searchPad)
  const sy0 = Math.max(0, fillBounds.y - searchPad)
  const sx1 = Math.min(width, fillBounds.x + fillBounds.w + searchPad)
  const sy1 = Math.min(height, fillBounds.y + fillBounds.h + searchPad)
  const stride = Math.max(1, Math.floor(Math.max(sx1 - sx0, sy1 - sy0) / 220))
  const sourceCenters: number[] = []
  const boundaryCenters: number[] = []

  for (let y = sy0; y < sy1; y += stride) {
    for (let x = sx0; x < sx1; x += stride) {
      const p = y * width + x
      if (fillAlpha[p] > MASK_THRESHOLD) continue
      if (sampling.sampleAlpha[p] <= MASK_THRESHOLD) continue
      sourceCenters.push(p)
      if (hasOutsideNeighbor(fillAlpha, width, height, x, y)) boundaryCenters.push(p)
    }
  }

  if (!sourceCenters.length) return

  const patchRadius = patch.patchRadius
  const candidateBudget = patch.candidateBudget
  const boundaryBudget = Math.min(patch.boundaryCandidateBudget, boundaryCenters.length)

  // PatchMatch-style neighbour offset cache: for each filled pixel we
  // remember the source it picked, so neighbours can propagate that
  // offset as a candidate. This dramatically improves coherence over
  // pure random search.
  const matchSourceX = new Int32Array(width * height)
  const matchSourceY = new Int32Array(width * height)
  matchSourceX.fill(-1)
  matchSourceY.fill(-1)

  for (let n = 0; n < fillPixels.length; n++) {
    const p = fillPixels[n]
    const x = p % width
    const y = (p - x) / width
    let best = -1
    let bestScore = Number.POSITIVE_INFINITY

    for (let c = 0; c < boundaryBudget; c++) {
      const candidate = boundaryCenters[pseudoRandomIndex(p + c * 7919 + n, boundaryCenters.length)]
      const cx = candidate % width
      const cy = (candidate - cx) / width
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }

    for (let c = 0; c < candidateBudget; c++) {
      const candidate = sourceCenters[pseudoRandomIndex(p + c * 104729 + n * 17, sourceCenters.length)]
      const cx = candidate % width
      const cy = (candidate - cx) / width
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }

    // PatchMatch propagation: try the offsets used by already-filled
    // neighbours. If a neighbour at (-1,0) picked source (sx,sy), then
    // (sx+1,sy) is a strong candidate for the current pixel.
    for (const [ndx, ndy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
      const np = (y + ndy) * width + (x + ndx)
      if (np < 0 || np >= width * height) continue
      const nSx = matchSourceX[np]
      const nSy = matchSourceY[np]
      if (nSx < 0) continue
      const cx = nSx - ndx
      const cy = nSy - ndy
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = cy * width + cx
      }
    }

    // PatchMatch random search around the current best (expanding
    // window halved each iteration).
    if (best >= 0) {
      const bx = best % width
      const by = (best - bx) / width
      let radius = Math.max(8, Math.floor(Math.min(width, height) / 4))
      for (let s = 0; s < 5 && radius > 1; s++) {
        const rx = pseudoRandomIndex(p + s * 31337 + n * 27, 1 << 16) / (1 << 15) - 1
        const ry = pseudoRandomIndex(p + s * 17329 + n * 41, 1 << 16) / (1 << 15) - 1
        const cx = Math.round(bx + rx * radius)
        const cy = Math.round(by + ry * radius)
        const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
        if (score < bestScore) {
          bestScore = score
          best = cy * width + cx
        }
        radius = Math.floor(radius / 2)
      }
    }

    const i = p * 4
    if (best >= 0 && Number.isFinite(bestScore)) {
      const bx = best % width
      const by = (best - bx) / width
      const bi = best * 4
      const targetAvg = averageAround(work, width, height, x, y, patchRadius + 2, (ap) => filled[ap] > 0)
      const sourceAvg = averageAround(source, width, height, bx, by, patchRadius + 2, (ap) => sampling.sampleAlpha[ap] > MASK_THRESHOLD)
      const colorAdaptation = clamp(options?.adaptation?.color ?? 0.48, 0, 1)
      const dr = targetAvg && sourceAvg ? (targetAvg.r - sourceAvg.r) * colorAdaptation : 0
      const dg = targetAvg && sourceAvg ? (targetAvg.g - sourceAvg.g) * colorAdaptation : 0
      const db = targetAvg && sourceAvg ? (targetAvg.b - sourceAvg.b) * colorAdaptation : 0
      work[i] = clampByte(source[bi] + dr)
      work[i + 1] = clampByte(source[bi + 1] + dg)
      work[i + 2] = clampByte(source[bi + 2] + db)
      work[i + 3] = source[bi + 3]
      matchSourceX[p] = bx
      matchSourceY[p] = by
    } else {
      const avg = fallbackFillColor(work, filled, width, height, x, y)
      work[i] = clampByte(avg.r)
      work[i + 1] = clampByte(avg.g)
      work[i + 2] = clampByte(avg.b)
      work[i + 3] = clampByte(avg.a || 255)
    }
    filled[p] = 1
  }

  // Iterative coarse-to-fine refinement: re-run the patch search with
  // the now-filled work buffer as the reference, which lets later
  // passes pull in coherent textures from neighbouring patches.
  const refinementPasses = patch.refinementPasses
  for (let pass = 0; pass < refinementPasses; pass++) {
    const reverseStride = 1 + (pass % 2)
    for (let n = 0; n < fillPixels.length; n += reverseStride) {
      const idx = pass % 2 === 0 ? n : fillPixels.length - 1 - n
      if (idx < 0 || idx >= fillPixels.length) continue
      const p = fillPixels[idx]
      const x = p % width
      const y = (p - x) / width
      let best = matchSourceY[p] >= 0 ? matchSourceY[p] * width + matchSourceX[p] : -1
      let bestScore = best >= 0
        ? patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, matchSourceX[p], matchSourceY[p], patchRadius, patch.coherence)
        : Number.POSITIVE_INFINITY

      for (const [ndx, ndy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
        const np = (y + ndy) * width + (x + ndx)
        if (np < 0 || np >= width * height) continue
        const nSx = matchSourceX[np]
        const nSy = matchSourceY[np]
        if (nSx < 0) continue
        const cx = nSx - ndx
        const cy = nSy - ndy
        const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
        if (score < bestScore) {
          bestScore = score
          best = cy * width + cx
        }
      }
      // Random search around best
      if (best >= 0) {
        const bx0 = best % width
        const by0 = (best - bx0) / width
        let radius = Math.max(4, Math.floor(Math.min(width, height) / 8))
        for (let s = 0; s < 3 && radius > 1; s++) {
          const rx = pseudoRandomIndex(p + s * 31337 + pass * 27, 1 << 16) / (1 << 15) - 1
          const ry = pseudoRandomIndex(p + s * 17329 + pass * 41, 1 << 16) / (1 << 15) - 1
          const cx = Math.round(bx0 + rx * radius)
          const cy = Math.round(by0 + ry * radius)
          const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
          if (score < bestScore) {
            bestScore = score
            best = cy * width + cx
          }
          radius = Math.floor(radius / 2)
        }
      }

      if (best >= 0 && Number.isFinite(bestScore)) {
        const bx = best % width
        const by = (best - bx) / width
        const bi = best * 4
        const i = p * 4
        const targetAvg = averageAround(work, width, height, x, y, patchRadius + 2, (ap) => filled[ap] > 0)
        const sourceAvg = averageAround(source, width, height, bx, by, patchRadius + 2, (ap) => sampling.sampleAlpha[ap] > MASK_THRESHOLD)
        const colorAdaptation = clamp(options?.adaptation?.color ?? 0.48, 0, 1)
        const dr = targetAvg && sourceAvg ? (targetAvg.r - sourceAvg.r) * colorAdaptation : 0
        const dg = targetAvg && sourceAvg ? (targetAvg.g - sourceAvg.g) * colorAdaptation : 0
        const db = targetAvg && sourceAvg ? (targetAvg.b - sourceAvg.b) * colorAdaptation : 0
        // Cross-fade with previous pass so refinement doesn't overshoot.
        const blend = 0.55
        work[i] = clampByte(work[i] * (1 - blend) + (source[bi] + dr) * blend)
        work[i + 1] = clampByte(work[i + 1] * (1 - blend) + (source[bi + 1] + dg) * blend)
        work[i + 2] = clampByte(work[i + 2] * (1 - blend) + (source[bi + 2] + db) * blend)
        work[i + 3] = clampByte(work[i + 3] * (1 - blend) + source[bi + 3] * blend)
        matchSourceX[p] = bx
        matchSourceY[p] = by
      }
    }
  }

  seamRelax(work, fillAlpha, width, height, fillBounds, patch.seamRelaxPasses)
  ctx.putImageData(new ImageData(work, width, height), 0, 0)
}

/** Patch tool core: blend a selected target from a dragged source offset with feathered healing. */
export function patchSelectionFromSource(
  canvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  featherRadius = 8,
) {
  const ctx = canvas.getContext("2d")!
  const width = canvas.width
  const height = canvas.height
  const hardMask = selectionMask.getContext("2d")!.getImageData(0, 0, width, height)
  const softMaskCanvas = featherRadius > 0 ? featherMask(selectionMask, featherRadius) : selectionMask
  const softMask = softMaskCanvas.getContext("2d")!.getImageData(0, 0, width, height)
  const alpha = new Uint8Array(width * height)
  for (let p = 0; p < width * height; p++) alpha[p] = hardMask.data[p * 4 + 3]
  const bounds = alphaBounds(alpha, width, height)
  if (!bounds) return

  const original = ctx.getImageData(0, 0, width, height)
  const data = original.data
  const out = new Uint8ClampedArray(data)

  let targetR = 0
  let targetG = 0
  let targetB = 0
  let sourceR = 0
  let sourceG = 0
  let sourceB = 0
  let pairs = 0

  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const p = y * width + x
      if (alpha[p] <= MASK_THRESHOLD || !hasOutsideNeighbor(alpha, width, height, x, y)) continue
      const target = averageAround(data, width, height, x, y, 3, (ap) => alpha[ap] <= MASK_THRESHOLD)
      const sx = x + offsetX
      const sy = y + offsetY
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !target) continue
      const sourceSample = sampleImageData(data, width, height, sx, sy)
      targetR += target.r
      targetG += target.g
      targetB += target.b
      sourceR += sourceSample.r
      sourceG += sourceSample.g
      sourceB += sourceSample.b
      pairs++
    }
  }

  const dr = pairs ? (targetR / pairs - sourceR / pairs) * 0.62 : 0
  const dg = pairs ? (targetG / pairs - sourceG / pairs) * 0.62 : 0
  const db = pairs ? (targetB / pairs - sourceB / pairs) * 0.62 : 0
  const x0 = bounds.x
  const y0 = bounds.y
  const x1 = bounds.x + bounds.w
  const y1 = bounds.y + bounds.h

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x
      if (alpha[p] <= MASK_THRESHOLD) continue
      const sx = x + offsetX
      const sy = y + offsetY
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) continue
      const sample = sampleImageData(data, width, height, sx, sy)
      const i = p * 4
      const mix = Math.max(alpha[p], softMask.data[i + 3]) / 255
      out[i] = clampByte(data[i] * (1 - mix) + (sample.r + dr) * mix)
      out[i + 1] = clampByte(data[i + 1] * (1 - mix) + (sample.g + dg) * mix)
      out[i + 2] = clampByte(data[i + 2] * (1 - mix) + (sample.b + db) * mix)
      out[i + 3] = clampByte(data[i + 3] * (1 - mix) + sample.a * mix)
    }
  }

  seamRelax(out, alpha, width, height, bounds, 1)
  ctx.putImageData(new ImageData(out, width, height), 0, 0)
}
