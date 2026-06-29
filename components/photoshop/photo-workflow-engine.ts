import type { HighBitImage } from "./color-pipeline"
import { sampleImageDataBilinear } from "./photo-workflow-transforms"

export {
  perspectiveCropImageData,
  seamCarveImageData,
} from "./photo-workflow-transforms"
export type {
  PerspectiveCropResult,
  Point,
  SeamCarveOptions,
  SeamCarveResult,
} from "./photo-workflow-transforms"

export interface WorkflowPlacement {
  dx: number
  dy: number
  score: number
  transform?: WorkflowTransform
  model?: PanoramaAlignmentModel
}

export type PanoramaAlignmentModel = "translation" | "similarity" | "affine" | "homography"
export type PanoramaProjection = "planar" | "cylindrical" | "spherical"

export interface WorkflowTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g?: number
  h?: number
}

export interface PanoramaCameraModel {
  focalLengthPx?: number
  sensorWidthMm?: number
  lens?: {
    k1?: number
    k2?: number
    k3?: number
    p1?: number
    p2?: number
  }
}

export interface AutoAlignOptions {
  searchRadius?: number
  maxFeatures?: number
  minFeatureDistance?: number
  descriptorRadius?: number
  ratioTest?: number
  alignmentModel?: PanoramaAlignmentModel
  projection?: PanoramaProjection
  projectionFocalLength?: number
  cameraModel?: PanoramaCameraModel
  blendMode?: "feather" | "multiband"
  exposureCompensation?: boolean
  ransacIterations?: number
  ransacThreshold?: number
}

export interface ImageFeature {
  x: number
  y: number
  score: number
  descriptor: number[]
}

export interface FeatureMatch {
  reference: ImageFeature
  moving: ImageFeature
  dx: number
  dy: number
  distance: number
}

export interface FeatureMatchResult {
  placement: WorkflowPlacement
  matches: FeatureMatch[]
  inliers: FeatureMatch[]
  fallbackUsed: boolean
  model: PanoramaAlignmentModel
  transform?: WorkflowTransform
}

export interface BlendBounds {
  minX: number
  minY: number
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface SelectAndMaskPreviewOptions {
  viewMode: SelectAndMaskViewMode
  outputTo: SelectAndMaskOutputTarget
  opacity?: number
  decontaminateColors?: boolean
}

export type SelectAndMaskViewMode =
  | "onion"
  | "marching"
  | "overlay"
  | "on-black"
  | "on-white"
  | "bw"
  | "alpha-matte"
  | "edge-only"
  | "split"
  | "on-layers"
  | "on-transparent"
  | "on-blue"

export type SelectAndMaskOutputTarget =
  | "selection"
  | "layer-mask"
  | "new-layer"
  | "new-layer-mask"
  | "new-document"
  | "alpha-channel"

export const SELECT_AND_MASK_VIEW_MODES: Array<{ id: SelectAndMaskViewMode; label: string; background: string }> = [
  { id: "onion", label: "Onion Skin (O)", background: "checker" },
  { id: "marching", label: "Marching Ants (M)", background: "transparent" },
  { id: "overlay", label: "Overlay (V)", background: "red-overlay" },
  { id: "on-black", label: "On Black (A)", background: "black" },
  { id: "on-white", label: "On White (T)", background: "white" },
  { id: "bw", label: "Black & White (K)", background: "mask" },
  { id: "alpha-matte", label: "Alpha Matte", background: "transparent-grid" },
  { id: "edge-only", label: "Edge Only", background: "edge-map" },
  { id: "split", label: "Before/After Split", background: "layers" },
  { id: "on-layers", label: "On Layers (Y)", background: "layers" },
  { id: "on-transparent", label: "On Transparent", background: "transparent-grid" },
  { id: "on-blue", label: "On Blue", background: "blue" },
]

export const SELECT_AND_MASK_OUTPUT_TARGETS: Array<{ id: SelectAndMaskOutputTarget; label: string }> = [
  { id: "selection", label: "Selection" },
  { id: "layer-mask", label: "Layer Mask" },
  { id: "new-layer", label: "New Layer" },
  { id: "new-layer-mask", label: "New Layer with Layer Mask" },
  { id: "new-document", label: "New Document" },
  { id: "alpha-channel", label: "Alpha Channel" },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp8 = (value: number) => clamp(Math.round(value), 0, 255)
const IDENTITY_TRANSFORM: WorkflowTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function pseudoRandomIndex(seed: number, length: number) {
  if (length <= 1) return 0
  let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  n ^= n >>> 13
  n = Math.imul(n, 0xc2b2ae35)
  n ^= n >>> 16
  return Math.abs(n) % length
}

function makeImageData(width: number, height: number, data?: Uint8ClampedArray) {
  return new ImageData(data ?? new Uint8ClampedArray(width * height * 4), width, height)
}

function pixelIndex(img: ImageData, x: number, y: number) {
  return (y * img.width + x) * 4
}

function lumaFromData(data: Uint8ClampedArray, i: number) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

function lumaAt(img: ImageData, x: number, y: number) {
  const sx = clamp(Math.round(x), 0, img.width - 1)
  const sy = clamp(Math.round(y), 0, img.height - 1)
  return lumaFromData(img.data, pixelIndex(img, sx, sy))
}

function transformPoint(transform: WorkflowTransform, x: number, y: number) {
  const denom = (transform.g ?? 0) * x + (transform.h ?? 0) * y + 1
  const safeDenom = Math.abs(denom) < 1e-9 ? (denom < 0 ? -1e-9 : 1e-9) : denom
  return {
    x: (transform.a * x + transform.c * y + transform.e) / safeDenom,
    y: (transform.b * x + transform.d * y + transform.f) / safeDenom,
  }
}

export function applyWorkflowTransformToPoint(transform: WorkflowTransform, x: number, y: number) {
  return transformPoint(transform, x, y)
}

function transformForPlacement(placement?: WorkflowPlacement): WorkflowTransform {
  return placement?.transform ?? { ...IDENTITY_TRANSFORM, e: placement?.dx ?? 0, f: placement?.dy ?? 0 }
}

function placementFromTransform(transform: WorkflowTransform, score: number, model: PanoramaAlignmentModel): WorkflowPlacement {
  return {
    dx: Math.round(transform.e),
    dy: Math.round(transform.f),
    score,
    transform,
    model,
  }
}

function invertTransform(transform: WorkflowTransform): WorkflowTransform | null {
  if (transform.g || transform.h) {
    const m00 = transform.a, m01 = transform.c, m02 = transform.e
    const m10 = transform.b, m11 = transform.d, m12 = transform.f
    const m20 = transform.g ?? 0, m21 = transform.h ?? 0, m22 = 1
    const c00 = m11 * m22 - m12 * m21
    const c01 = -(m10 * m22 - m12 * m20)
    const c02 = m10 * m21 - m11 * m20
    const c10 = -(m01 * m22 - m02 * m21)
    const c11 = m00 * m22 - m02 * m20
    const c12 = -(m00 * m21 - m01 * m20)
    const c20 = m01 * m12 - m02 * m11
    const c21 = -(m00 * m12 - m02 * m10)
    const c22 = m00 * m11 - m01 * m10
    const det = m00 * c00 + m01 * c01 + m02 * c02
    if (Math.abs(det) < 1e-9 || Math.abs(c22) < 1e-9) return null
    const inv00 = c00 / det, inv01 = c10 / det, inv02 = c20 / det
    const inv10 = c01 / det, inv11 = c11 / det, inv12 = c21 / det
    const inv20 = c02 / det, inv21 = c12 / det, inv22 = c22 / det
    return {
      a: inv00 / inv22,
      b: inv10 / inv22,
      c: inv01 / inv22,
      d: inv11 / inv22,
      e: inv02 / inv22,
      f: inv12 / inv22,
      g: inv20 / inv22,
      h: inv21 / inv22,
    }
  }
  const det = transform.a * transform.d - transform.b * transform.c
  if (Math.abs(det) < 1e-9) return null
  const a = transform.d / det
  const b = -transform.b / det
  const c = -transform.c / det
  const d = transform.a / det
  return {
    a,
    b,
    c,
    d,
    e: -(a * transform.e + c * transform.f),
    f: -(b * transform.e + d * transform.f),
  }
}

function reprojectionError(transform: WorkflowTransform, match: FeatureMatch) {
  const projected = transformPoint(transform, match.moving.x, match.moving.y)
  return Math.hypot(projected.x - match.reference.x, projected.y - match.reference.y)
}

function rgbAt(img: ImageData, x: number, y: number) {
  const sx = clamp(x, 0, img.width - 1)
  const sy = clamp(y, 0, img.height - 1)
  const i = pixelIndex(img, sx, sy)
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
}

function localContrast(img: ImageData, x: number, y: number) {
  const center = rgbAt(img, x, y)
  const contrastTo = (sample: { r: number; g: number; b: number }) =>
    Math.abs(center.r - sample.r) + Math.abs(center.g - sample.g) + Math.abs(center.b - sample.b)
  return (
    contrastTo(rgbAt(img, x - 1, y)) +
    contrastTo(rgbAt(img, x + 1, y)) +
    contrastTo(rgbAt(img, x, y - 1)) +
    contrastTo(rgbAt(img, x, y + 1))
  )
}

function featureScore(img: ImageData, x: number, y: number) {
  const gx = lumaAt(img, x + 1, y) - lumaAt(img, x - 1, y)
  const gy = lumaAt(img, x, y + 1) - lumaAt(img, x, y - 1)
  const diagA = Math.abs(lumaAt(img, x + 1, y + 1) - lumaAt(img, x - 1, y - 1))
  const diagB = Math.abs(lumaAt(img, x + 1, y - 1) - lumaAt(img, x - 1, y + 1))
  const cornerness = Math.min(Math.abs(gx), Math.abs(gy)) + (diagA + diagB) * 0.25
  return localContrast(img, x, y) + cornerness
}

function descriptorFor(img: ImageData, x: number, y: number, radius: number) {
  const values: number[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      values.push(lumaAt(img, x + dx, y + dy))
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)
  const scale = Math.sqrt(variance) || 1
  const descriptor = values.map((value) => (value - mean) / scale)
  const center = rgbAt(img, x, y)
  const left = rgbAt(img, x - radius, y)
  const right = rgbAt(img, x + radius, y)
  const top = rgbAt(img, x, y - radius)
  const bottom = rgbAt(img, x, y + radius)
  descriptor.push(
    (center.r - 128) / 64,
    (center.g - 128) / 64,
    (center.b - 128) / 64,
    (right.r - left.r) / 96,
    (bottom.g - top.g) / 96,
    ((right.b - left.b) + (bottom.b - top.b)) / 160,
  )
  return descriptor
}

export function detectImageFeatures(image: ImageData, options: AutoAlignOptions = {}) {
  const maxFeatures = Math.max(4, Math.round(options.maxFeatures ?? 80))
  const descriptorRadius = Math.max(1, Math.round(options.descriptorRadius ?? 2))
  const minDistance = Math.max(1, Math.round(options.minFeatureDistance ?? Math.min(image.width, image.height) / 24))
  const candidates: ImageFeature[] = []

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = pixelIndex(image, x, y)
      if (image.data[i + 3] <= 8) continue
      const score = featureScore(image, x, y)
      if (score <= 0) continue
      candidates.push({ x, y, score, descriptor: descriptorFor(image, x, y, descriptorRadius) })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const features: ImageFeature[] = []
  const minDistanceSq = minDistance * minDistance
  for (const candidate of candidates) {
    let near = false
    for (const feature of features) {
      if ((feature.x - candidate.x) ** 2 + (feature.y - candidate.y) ** 2 < minDistanceSq) {
        near = true
        break
      }
    }
    if (near) continue
    features.push(candidate)
    if (features.length >= maxFeatures) break
  }
  return features
}

function descriptorDistance(a: number[], b: number[]) {
  const count = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < count; i++) sum += (a[i] - b[i]) ** 2
  return sum / Math.max(1, count)
}

function alignmentScore(reference: ImageData, moving: ImageData, dx: number, dy: number) {
  let score = 0
  let count = 0
  for (let y = 0; y < reference.height; y++) {
    const my = y - dy
    if (my < 0 || my >= moving.height) continue
    for (let x = 0; x < reference.width; x++) {
      const mx = x - dx
      if (mx < 0 || mx >= moving.width) continue
      const ri = pixelIndex(reference, x, y)
      const mi = pixelIndex(moving, mx, my)
      if (reference.data[ri + 3] === 0 && moving.data[mi + 3] === 0) continue
      const rd = localContrast(reference, x, y)
      const md = localContrast(moving, mx, my)
      const dr = reference.data[ri] - moving.data[mi]
      const dg = reference.data[ri + 1] - moving.data[mi + 1]
      const db = reference.data[ri + 2] - moving.data[mi + 2]
      score += dr * dr + dg * dg + db * db + Math.abs(rd - md) * 6
      count++
    }
  }
  if (!count) return Number.POSITIVE_INFINITY
  const overlapPenalty = (reference.width * reference.height - count) * 8
  return score / count + overlapPenalty
}

function estimateImageTranslationByCorrelation(reference: ImageData, moving: ImageData, options: AutoAlignOptions = {}): WorkflowPlacement {
  const radius = Math.max(0, Math.round(options.searchRadius ?? 12))
  let best: WorkflowPlacement = { dx: 0, dy: 0, score: alignmentScore(reference, moving, 0, 0) }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const score = alignmentScore(reference, moving, dx, dy)
      if (score < best.score) best = { dx, dy, score }
    }
  }
  return best
}

function descriptorMatches(referenceFeatures: ImageFeature[], movingFeatures: ImageFeature[], options: AutoAlignOptions) {
  const ratioTest = clamp(options.ratioTest ?? 0.995, 0.1, 1)
  const matches: FeatureMatch[] = []
  const usedMoving = new Set<ImageFeature>()

  for (const reference of referenceFeatures) {
    let best: { feature: ImageFeature; distance: number } | null = null
    let second = Number.POSITIVE_INFINITY
    for (const moving of movingFeatures) {
      if (usedMoving.has(moving)) continue
      const distance = descriptorDistance(reference.descriptor, moving.descriptor)
      if (!best || distance < best.distance) {
        second = best?.distance ?? Number.POSITIVE_INFINITY
        best = { feature: moving, distance }
      } else if (distance < second) {
        second = distance
      }
    }
    if (!best) continue
    if (Number.isFinite(second) && best.distance > second * ratioTest) continue
    usedMoving.add(best.feature)
    matches.push({
      reference,
      moving: best.feature,
      dx: reference.x - best.feature.x,
      dy: reference.y - best.feature.y,
      distance: best.distance,
    })
  }

  return matches
}

function placementFromMatches(matches: FeatureMatch[]) {
  if (!matches.length) return null
  const buckets = new Map<string, { dx: number; dy: number; matches: FeatureMatch[]; distance: number }>()
  for (const match of matches) {
    const dx = Math.round(match.dx)
    const dy = Math.round(match.dy)
    const key = `${dx},${dy}`
    const bucket = buckets.get(key) ?? { dx, dy, matches: [], distance: 0 }
    bucket.matches.push(match)
    bucket.distance += match.distance
    buckets.set(key, bucket)
  }
  let best: { dx: number; dy: number; matches: FeatureMatch[]; distance: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.matches.length > best.matches.length || (bucket.matches.length === best.matches.length && bucket.distance < best.distance)) {
      best = bucket
    }
  }
  if (!best) return null
  return {
    placement: { dx: best.dx, dy: best.dy, score: best.distance / Math.max(1, best.matches.length) },
    inliers: best.matches,
  }
}

function scoreTransform(matches: FeatureMatch[], transform: WorkflowTransform, threshold: number) {
  const inliers: FeatureMatch[] = []
  let coreInliers = 0
  let error = 0
  for (const match of matches) {
    const err = reprojectionError(transform, match)
    if (err <= threshold) {
      inliers.push(match)
      if (err <= threshold * 0.45) coreInliers++
      error += err
    }
  }
  return { inliers, coreInliers, score: error / Math.max(1, inliers.length) + (matches.length - inliers.length) * threshold }
}

function similarityTransformFromPair(a: FeatureMatch, b: FeatureMatch): WorkflowTransform | null {
  const mpX = b.moving.x - a.moving.x
  const mpY = b.moving.y - a.moving.y
  const rpX = b.reference.x - a.reference.x
  const rpY = b.reference.y - a.reference.y
  const movingLength = Math.hypot(mpX, mpY)
  const referenceLength = Math.hypot(rpX, rpY)
  if (movingLength < 1e-6 || referenceLength < 1e-6) return null
  const scale = referenceLength / movingLength
  const angle = Math.atan2(rpY, rpX) - Math.atan2(mpY, mpX)
  const cos = Math.cos(angle) * scale
  const sin = Math.sin(angle) * scale
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: a.reference.x - cos * a.moving.x + sin * a.moving.y,
    f: a.reference.y - sin * a.moving.x - cos * a.moving.y,
  }
}

function affineTransformFromTriple(a: FeatureMatch, b: FeatureMatch, c: FeatureMatch): WorkflowTransform | null {
  const x1 = a.moving.x, y1 = a.moving.y
  const x2 = b.moving.x, y2 = b.moving.y
  const x3 = c.moving.x, y3 = c.moving.y
  const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
  if (Math.abs(det) < 1e-6) return null
  const solve = (q1: number, q2: number, q3: number) => ({
    x: (q1 * (y2 - y3) + q2 * (y3 - y1) + q3 * (y1 - y2)) / det,
    y: (x1 * (q2 - q3) + x2 * (q3 - q1) + x3 * (q1 - q2)) / det,
    z: (x1 * (y3 * q2 - y2 * q3) + x2 * (y1 * q3 - y3 * q1) + x3 * (y2 * q1 - y1 * q2)) / det,
  })
  const sx = solve(a.reference.x, b.reference.x, c.reference.x)
  const sy = solve(a.reference.y, b.reference.y, c.reference.y)
  return { a: sx.x, b: sy.x, c: sx.y, d: sy.y, e: sx.z, f: sy.z }
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const n = values.length
  const a = matrix.map((row, i) => [...row, values[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]]
    const divisor = a[col][col]
    for (let j = col; j <= n; j++) a[col][j] /= divisor
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      if (Math.abs(factor) < 1e-12) continue
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j]
    }
  }
  return a.map((row) => row[n])
}

export function solveProjectiveTransformFromPointPairs(
  pairs: Array<{ source: { x: number; y: number }; target: { x: number; y: number } }>,
): WorkflowTransform | null {
  if (pairs.length < 4) return null
  const matrix: number[][] = []
  const values: number[] = []
  for (const pair of pairs.slice(0, 4)) {
    const x = pair.source.x
    const y = pair.source.y
    const u = pair.target.x
    const v = pair.target.y
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  }
  const solved = solveLinearSystem(matrix, values)
  if (!solved) return null
  return {
    a: solved[0],
    c: solved[1],
    e: solved[2],
    b: solved[3],
    d: solved[4],
    f: solved[5],
    g: solved[6],
    h: solved[7],
  }
}

function homographyTransformFromQuad(matches: FeatureMatch[]): WorkflowTransform | null {
  if (matches.length < 4) return null
  return solveProjectiveTransformFromPointPairs(matches.slice(0, 4).map((match) => ({
    source: { x: match.moving.x, y: match.moving.y },
    target: { x: match.reference.x, y: match.reference.y },
  })))
}

function refinedSimilarityTransform(matches: FeatureMatch[]): WorkflowTransform | null {
  if (matches.length < 2) return null
  let mx = 0, my = 0, rx = 0, ry = 0
  for (const match of matches) {
    mx += match.moving.x
    my += match.moving.y
    rx += match.reference.x
    ry += match.reference.y
  }
  mx /= matches.length
  my /= matches.length
  rx /= matches.length
  ry /= matches.length

  let ss = 0
  let sc = 0
  let denom = 0
  for (const match of matches) {
    const x = match.moving.x - mx
    const y = match.moving.y - my
    const u = match.reference.x - rx
    const v = match.reference.y - ry
    sc += x * u + y * v
    ss += x * v - y * u
    denom += x * x + y * y
  }
  if (denom < 1e-9) return null
  const a = sc / denom
  const b = ss / denom
  return {
    a,
    b,
    c: -b,
    d: a,
    e: rx - a * mx + b * my,
    f: ry - b * mx - a * my,
  }
}

function estimateTransformFromMatches(
  matches: FeatureMatch[],
  model: PanoramaAlignmentModel,
  options: AutoAlignOptions,
): { transform: WorkflowTransform; inliers: FeatureMatch[]; score: number; model: PanoramaAlignmentModel } | null {
  if (model === "translation" || matches.length < 2) return null
  const threshold = Math.max(0.5, options.ransacThreshold ?? 2.25)
  const iterations = Math.max(16, Math.round(options.ransacIterations ?? 96))
  let best: { transform: WorkflowTransform; inliers: FeatureMatch[]; coreInliers: number; score: number; model: PanoramaAlignmentModel } | null = null

  const consider = (transform: WorkflowTransform | null, candidateModel: PanoramaAlignmentModel) => {
    if (!transform) return
    const scaleEstimate = Math.hypot(transform.a, transform.b)
    if (candidateModel === "similarity" && (scaleEstimate < 0.5 || scaleEstimate > 3.25)) return
    let candidateTransform = transform
    let scored = scoreTransform(matches, candidateTransform, threshold)
    if (candidateModel === "similarity" && scored.inliers.length >= 2) {
      const refined = refinedSimilarityTransform(scored.inliers)
      if (refined) {
        const refinedScore = scoreTransform(matches, refined, threshold)
        const refinedScale = Math.hypot(refined.a, refined.b)
        if (
          refinedScale >= 0.5 &&
          refinedScale <= 3.25 &&
          refinedScore.coreInliers >= scored.coreInliers &&
          refinedScore.inliers.length >= scored.inliers.length &&
          refinedScore.score <= scored.score + threshold * 0.1
        ) {
          candidateTransform = refined
          scored = refinedScore
        }
      }
    }
    const minInliers = candidateModel === "homography" ? 4 : candidateModel === "affine" ? 3 : 2
    if (scored.inliers.length < minInliers) return
    const score = scored.score
    if (
      !best ||
      scored.coreInliers > best.coreInliers ||
      (scored.coreInliers === best.coreInliers && scored.inliers.length > best.inliers.length) ||
      (scored.coreInliers === best.coreInliers && scored.inliers.length === best.inliers.length && score < best.score)
    ) {
      best = { transform: candidateTransform, inliers: scored.inliers, coreInliers: scored.coreInliers, score, model: candidateModel }
    }
  }

  for (let i = 0; i < matches.length - 1; i++) {
    for (let j = i + 1; j < matches.length && j < i + iterations; j++) {
      consider(similarityTransformFromPair(matches[i], matches[j]), "similarity")
    }
  }

  if ((model === "affine" || model === "homography") && matches.length >= 3) {
    for (let seed = 0; seed < iterations; seed++) {
      const i = pseudoRandomIndex(seed * 7919 + matches.length, matches.length)
      const j = pseudoRandomIndex(seed * 104729 + matches.length * 3, matches.length)
      const k = pseudoRandomIndex(seed * 31337 + matches.length * 5, matches.length)
      if (i === j || i === k || j === k) continue
      consider(affineTransformFromTriple(matches[i], matches[j], matches[k]), "affine")
    }
  }

  if (model === "homography" && matches.length >= 4) {
    for (let seed = 0; seed < iterations * 2; seed++) {
      const picked: FeatureMatch[] = []
      for (let n = 0; n < 4; n++) {
        const index = pseudoRandomIndex(seed * (7919 + n * 3571) + matches.length * (n + 1), matches.length)
        if (picked.includes(matches[index])) continue
        picked.push(matches[index])
      }
      if (picked.length < 4) continue
      consider(homographyTransformFromQuad(picked), "homography")
    }
  }

  return best
}

function geometricMatchesForPlacement(
  referenceFeatures: ImageFeature[],
  movingFeatures: ImageFeature[],
  placement: WorkflowPlacement,
) {
  const out: FeatureMatch[] = []
  const used = new Set<ImageFeature>()
  for (const reference of referenceFeatures) {
    const expectedX = reference.x - placement.dx
    const expectedY = reference.y - placement.dy
    let best: { feature: ImageFeature; distanceSq: number } | null = null
    for (const moving of movingFeatures) {
      if (used.has(moving)) continue
      const distanceSq = (moving.x - expectedX) ** 2 + (moving.y - expectedY) ** 2
      if (distanceSq > 2.25) continue
      if (!best || distanceSq < best.distanceSq) best = { feature: moving, distanceSq }
    }
    if (!best) continue
    used.add(best.feature)
    out.push({
      reference,
      moving: best.feature,
      dx: reference.x - best.feature.x,
      dy: reference.y - best.feature.y,
      distance: descriptorDistance(reference.descriptor, best.feature.descriptor),
    })
  }
  return out
}

function uniqueMatches(matches: FeatureMatch[]) {
  const seen = new Set<string>()
  const out: FeatureMatch[] = []
  for (const match of matches) {
    const key = `${match.reference.x},${match.reference.y}:${match.moving.x},${match.moving.y}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(match)
  }
  return out
}

export function matchImageFeatures(reference: ImageData, moving: ImageData, options: AutoAlignOptions = {}): FeatureMatchResult {
  const referenceFeatures = detectImageFeatures(reference, options)
  const movingFeatures = detectImageFeatures(moving, options)
  const matches = descriptorMatches(referenceFeatures, movingFeatures, options)
  const fromMatches = placementFromMatches(matches)
  const fallback = estimateImageTranslationByCorrelation(reference, moving, options)
  const requestedModel = options.alignmentModel ?? "translation"
  const transformEstimate = estimateTransformFromMatches(matches, requestedModel, options)
  const placement =
    transformEstimate && transformEstimate.inliers.length >= 3
      ? placementFromTransform(transformEstimate.transform, transformEstimate.score, transformEstimate.model)
      : fromMatches && fromMatches.inliers.length >= 3
        ? { ...fromMatches.placement, model: "translation" as const, score: alignmentScore(reference, moving, fromMatches.placement.dx, fromMatches.placement.dy) }
        : { ...fallback, model: "translation" as const }
  const geometric = geometricMatchesForPlacement(referenceFeatures, movingFeatures, placement)
  const allMatches = uniqueMatches([...matches, ...geometric])
  const inliers =
    placement.transform && placement.model !== "translation"
      ? allMatches.filter((match) => reprojectionError(placement.transform!, match) <= (options.ransacThreshold ?? 2.25))
      : allMatches.filter((match) => Math.abs(match.dx - placement.dx) <= 1 && Math.abs(match.dy - placement.dy) <= 1)

  return {
    placement,
    matches: allMatches,
    inliers,
    fallbackUsed: placement.model === "translation" && (!fromMatches || fromMatches.inliers.length < 3),
    model: placement.model ?? "translation",
    transform: placement.transform,
  }
}

export function estimateImageTranslation(reference: ImageData, moving: ImageData, options: AutoAlignOptions = {}): WorkflowPlacement {
  return matchImageFeatures(reference, moving, options).placement
}

export function autoAlignImageStack(images: ImageData[], options: AutoAlignOptions = {}) {
  if (!images.length) return { placements: [] as WorkflowPlacement[], featureMatches: [] as FeatureMatchResult[] }
  const reference = images[0]
  const featureMatches: FeatureMatchResult[] = []
  const placements = images.map((image, index) => {
    if (index === 0) return { dx: 0, dy: 0, score: 0 }
    const match = matchImageFeatures(reference, image, options)
    featureMatches.push(match)
    return match.placement
  })
  return { placements, featureMatches }
}

function boundsForStack(images: ImageData[], placements: WorkflowPlacement[], expandToFit: boolean): BlendBounds {
  if (!images.length || !expandToFit) {
    const width = images[0]?.width ?? 1
    const height = images[0]?.height ?? 1
    return { minX: 0, minY: 0, width, height, offsetX: 0, offsetY: 0 }
  }
  let minX = 0
  let minY = 0
  let maxX = images[0].width
  let maxY = images[0].height
  for (let i = 0; i < images.length; i++) {
    const placement = placements[i] ?? { dx: 0, dy: 0, score: 0 }
    const transform = transformForPlacement(placement)
    const corners = [
      transformPoint(transform, 0, 0),
      transformPoint(transform, images[i].width, 0),
      transformPoint(transform, 0, images[i].height),
      transformPoint(transform, images[i].width, images[i].height),
    ]
    minX = Math.min(minX, ...corners.map((point) => point.x))
    minY = Math.min(minY, ...corners.map((point) => point.y))
    maxX = Math.max(maxX, ...corners.map((point) => point.x))
    maxY = Math.max(maxY, ...corners.map((point) => point.y))
  }
  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
    offsetX: -Math.floor(minX),
    offsetY: -Math.floor(minY),
  }
}

export function autoBlendImageStack(
  images: ImageData[],
  placements: WorkflowPlacement[] = autoAlignImageStack(images).placements,
  options: { expandToFit?: boolean; featherRadius?: number; blendMode?: "feather" | "multiband"; exposureCompensation?: boolean } = {},
) {
  const bounds = boundsForStack(images, placements, options.expandToFit ?? false)
  const width = bounds.width
  const height = bounds.height
  const sums = new Float64Array(width * height * 4)
  const weights = new Float64Array(width * height)
  const coverage = new Uint8Array(width * height)
  const blendMode = options.blendMode ?? "feather"
  const featherRadius = Math.max(1, (options.featherRadius ?? 2) * (blendMode === "multiband" ? 1.75 : 1))
  const gains = options.exposureCompensation !== false ? estimateExposureGains(images, placements, bounds) : images.map(() => 1)

  for (let s = 0; s < images.length; s++) {
    const image = images[s]
    const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
    const inverse = invertTransform(transformForPlacement(placement))
    if (!inverse) continue
    for (let y = 0; y < height; y++) {
      const docY = y + bounds.minY
      for (let x = 0; x < width; x++) {
        const docX = x + bounds.minX
        const sourcePoint = transformPoint(inverse, docX, docY)
        const sx = sourcePoint.x
        const sy = sourcePoint.y
        if (sx < 0 || sy < 0 || sx > image.width - 1 || sy > image.height - 1) continue
        const sample = sampleImageDataBilinear(image, sx, sy)
        const alpha = sample[3] / 255
        if (alpha <= 0) continue
        const edgeDistance = Math.min(sx, sy, image.width - 1 - sx, image.height - 1 - sy)
        const feather = clamp(edgeDistance / featherRadius, 0.35, 1)
        const centerDistance = Math.min(
          Math.abs(sx - (image.width - 1) / 2) / Math.max(1, image.width / 2),
          Math.abs(sy - (image.height - 1) / 2) / Math.max(1, image.height / 2),
        )
        const detailWeight = blendMode === "multiband" ? 1 + localContrast(image, Math.round(sx), Math.round(sy)) / 950 + (1 - centerDistance) * 0.08 : 1
        const weight = alpha * feather * detailWeight
        const p = y * width + x
        const oi = p * 4
        sums[oi] += clamp(sample[0] * gains[s], 0, 255) * weight
        sums[oi + 1] += clamp(sample[1] * gains[s], 0, 255) * weight
        sums[oi + 2] += clamp(sample[2] * gains[s], 0, 255) * weight
        sums[oi + 3] += sample[3] * weight
        weights[p] += weight
        coverage[p]++
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const oi = p * 4
    const weight = weights[p]
    if (weight <= 0) continue
    out[oi] = clamp8(sums[oi] / weight)
    out[oi + 1] = clamp8(sums[oi + 1] / weight)
    out[oi + 2] = clamp8(sums[oi + 2] / weight)
    out[oi + 3] = clamp8(sums[oi + 3] / weight)
  }

  return {
    image: makeImageData(width, height, out),
    coverage,
    bounds,
    blendDiagnostics: {
      mode: blendMode,
      exposureCompensated: options.exposureCompensation !== false,
      gains,
      featherRadius,
    },
  }
}

function estimateExposureGains(images: ImageData[], placements: WorkflowPlacement[], bounds: BlendBounds) {
  if (images.length <= 1) return images.map(() => 1)
  const reference = images[0]
  const gains = images.map(() => 1)
  for (let s = 1; s < images.length; s++) {
    const image = images[s]
    const inverse = invertTransform(transformForPlacement(placements[s] ?? { dx: 0, dy: 0, score: 0 }))
    if (!inverse) continue
    let referenceLuma = 0
    let movingLuma = 0
    let count = 0
    const step = Math.max(1, Math.floor(Math.max(bounds.width, bounds.height) / 160))
    for (let y = 0; y < bounds.height; y += step) {
      const docY = y + bounds.minY
      if (docY < 0 || docY >= reference.height) continue
      for (let x = 0; x < bounds.width; x += step) {
        const docX = x + bounds.minX
        if (docX < 0 || docX >= reference.width) continue
        const sourcePoint = transformPoint(inverse, docX, docY)
        const sx = Math.round(sourcePoint.x)
        const sy = Math.round(sourcePoint.y)
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
        const ri = pixelIndex(reference, docX, docY)
        const mi = pixelIndex(image, sx, sy)
        if (reference.data[ri + 3] <= 8 || image.data[mi + 3] <= 8) continue
        referenceLuma += lumaFromData(reference.data, ri)
        movingLuma += lumaFromData(image.data, mi)
        count++
      }
    }
    if (count > 3 && movingLuma > 1) gains[s] = clamp(referenceLuma / movingLuma, 0.55, 1.85)
  }
  return gains
}

function cameraModeledSourcePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  cameraModel?: PanoramaCameraModel,
) {
  if (!cameraModel?.lens) return { x, y }
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  let nx = (x - cx) / Math.max(1, cx)
  let ny = (y - cy) / Math.max(1, cy)
  const r2 = nx * nx + ny * ny
  const r4 = r2 * r2
  const r6 = r4 * r2
  const lens = cameraModel.lens
  const radial = 1 + (lens.k1 ?? 0) * r2 + (lens.k2 ?? 0) * r4 + (lens.k3 ?? 0) * r6
  const tx = 2 * (lens.p1 ?? 0) * nx * ny + (lens.p2 ?? 0) * (r2 + 2 * nx * nx)
  const ty = (lens.p1 ?? 0) * (r2 + 2 * ny * ny) + 2 * (lens.p2 ?? 0) * nx * ny
  nx = nx * radial + tx
  ny = ny * radial + ty
  return {
    x: cx + nx * Math.max(1, cx),
    y: cy + ny * Math.max(1, cy),
  }
}

function projectPanoramaImage(image: ImageData, projection: PanoramaProjection, focalLength?: number, cameraModel?: PanoramaCameraModel) {
  if (projection === "planar" && !cameraModel?.lens) return image
  const width = image.width
  const height = image.height
  const out = new Uint8ClampedArray(width * height * 4)
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const focal = Math.max(1, focalLength ?? cameraModel?.focalLengthPx ?? width * 0.9)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const theta = (x - cx) / focal
      const h = (y - cy) / focal
      const cosTheta = Math.cos(theta)
      const planarX = projection === "planar" ? x : focal * Math.tan(theta) + cx
      const sphericalScale = projection === "spherical" ? Math.sqrt(Math.max(0.0001, 1 - Math.min(0.95, h * h))) : 1
      const planarY = projection === "planar" ? y : h * focal / Math.max(0.15, cosTheta * sphericalScale) + cy
      const source = cameraModeledSourcePoint(planarX, planarY, width, height, cameraModel)
      const sample = source.x < 0 || source.y < 0 || source.x > width - 1 || source.y > height - 1
        ? [0, 0, 0, 0]
        : sampleImageDataBilinear(image, source.x, source.y)
      const i = (y * width + x) * 4
      out[i] = clamp8(sample[0])
      out[i + 1] = clamp8(sample[1])
      out[i + 2] = clamp8(sample[2])
      out[i + 3] = clamp8(sample[3])
    }
  }
  return makeImageData(width, height, out)
}

export function photomergeImageStack(images: ImageData[], options: AutoAlignOptions = {}) {
  const projection = options.projection ?? "planar"
  const projectedImages = projection === "planar" && !options.cameraModel?.lens
    ? images
    : images.map((image) => projectPanoramaImage(image, projection, options.projectionFocalLength, options.cameraModel))
  const aligned = autoAlignImageStack(projectedImages, options)
  const blended = autoBlendImageStack(projectedImages, aligned.placements, {
    expandToFit: true,
    featherRadius: 10,
    blendMode: options.blendMode,
    exposureCompensation: options.exposureCompensation,
  })
  const seamColumns: number[] = []
  for (let x = 0; x < blended.image.width; x++) {
    let overlap = 0
    for (let y = 0; y < blended.image.height; y++) {
      if (blended.coverage[y * blended.image.width + x] > 1) overlap++
    }
    if (overlap > 0) seamColumns.push(x)
  }
  return {
    ...blended,
    placements: aligned.placements,
    featureMatches: aligned.featureMatches,
    seamColumns,
    projection,
    transformDiagnostics: aligned.featureMatches.map((match) => ({
      model: match.model,
      inliers: match.inliers.length,
      matches: match.matches.length,
      fallbackUsed: match.fallbackUsed,
      transform: match.transform,
    })),
    cameraModel: options.cameraModel,
    blendDiagnostics: blended.blendDiagnostics,
  }
}

export type HdrDeghostMode = "off" | "low" | "medium" | "high"
export type HdrExposureWeighting = "balanced" | "shadow-priority" | "highlight-priority" | "manual"

export interface HdrToneMappingOptions {
  exposure?: number
  compression?: number
  gamma?: number
}

export interface HdrMergeOptions extends AutoAlignOptions {
  align?: boolean
  deghost?: HdrDeghostMode
  referenceIndex?: number
  exposureWeighting?: HdrExposureWeighting
  manualExposureWeights?: number[]
  ghostThreshold?: number
  toneMapping?: HdrToneMappingOptions
}

function exposureWeightForPixel(image: ImageData, p: number, exposureEv = 0, options: HdrMergeOptions = {}, sourceIndex = 0) {
  const i = p * 4
  const luma = lumaFromData(image.data, i) / 255
  const clipped = image.data[i] > 235 || image.data[i + 1] > 235 || image.data[i + 2] > 235
  const blocked = image.data[i] < 8 && image.data[i + 1] < 8 && image.data[i + 2] < 8
  const midtone = Math.max(0, 1 - Math.abs(luma - 0.5) * 2)
  let weight = (midtone * midtone + 0.02) * (clipped || blocked ? 0.15 : 1) * (image.data[i + 3] / 255)
  if (options.exposureWeighting === "shadow-priority") weight *= 2 ** (exposureEv * 0.45)
  else if (options.exposureWeighting === "highlight-priority") weight *= 2 ** (-exposureEv * 0.45)
  else if (options.exposureWeighting === "manual") weight *= Math.max(0, options.manualExposureWeights?.[sourceIndex] ?? 1)
  else if (options.manualExposureWeights?.length) weight *= Math.max(0, options.manualExposureWeights[sourceIndex] ?? 1)
  return Math.max(0.002, weight)
}

function toLinear(value: number) {
  return (value / 255) ** 2.2
}

function normalizeToneMapping(options?: HdrToneMappingOptions) {
  return {
    exposure: options?.exposure ?? 0,
    compression: clamp(options?.compression ?? 1, 0.05, 4),
    gamma: clamp(options?.gamma ?? 2.2, 0.2, 5),
  }
}

function toneMap(value: number, options: ReturnType<typeof normalizeToneMapping>) {
  const exposed = value * 2 ** options.exposure
  const mapped = exposed / (options.compression + exposed)
  return clamp8(mapped ** (1 / options.gamma) * 255)
}

function deghostThreshold(mode: HdrDeghostMode, explicit?: number) {
  if (explicit !== undefined) return clamp(explicit, 0, 1)
  if (mode === "high") return 0.18
  if (mode === "medium") return 0.28
  if (mode === "low") return 0.42
  return Number.POSITIVE_INFINITY
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function mergeHdrImageStack(
  images: ImageData[],
  exposures: Array<{ ev: number }> = images.map(() => ({ ev: 0 })),
  options: HdrMergeOptions = {},
) {
  const width = images[0]?.width ?? 1
  const height = images[0]?.height ?? 1
  const out = new Uint8ClampedArray(width * height * 4)
  const exposureWeights = images.map(() => new Float64Array(width * height))
  const radiance = new Float64Array(width * height * 3)
  const deghostMask = new Uint8Array(width * height)
  const ghostScores = new Float32Array(width * height)
  const sourceIndexByPixel = new Uint8Array(width * height)
  const aligned = options.align ? autoAlignImageStack(images, options) : null
  const placements = aligned?.placements ?? images.map((_, index) => ({ dx: index === 0 ? 0 : 0, dy: 0, score: 0 }))
  const toneMapping = normalizeToneMapping(options.toneMapping)
  const deghost = options.deghost ?? "off"
  const referenceIndex = clamp(Math.round(options.referenceIndex ?? 0), 0, Math.max(0, images.length - 1))
  const ghostThreshold = deghostThreshold(deghost, options.ghostThreshold)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      let wr = 0
      let wg = 0
      let wb = 0
      let wa = 0
      let total = 0
      const samples: Array<{ source: number; sp: number; si: number; r: number; g: number; b: number; luma: number; weight: number; exposureScale: number }> = []
      for (let s = 0; s < images.length; s++) {
        const image = images[s]
        const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
        const sx = x - placement.dx
        const sy = y - placement.dy
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
        const sp = sy * image.width + sx
        const si = sp * 4
        const exposureEv = exposures[s]?.ev ?? 0
        const weight = exposureWeightForPixel(image, sp, exposureEv, options, s)
        const exposureScale = 2 ** -(exposures[s]?.ev ?? 0)
        const r = toLinear(image.data[si]) * exposureScale
        const g = toLinear(image.data[si + 1]) * exposureScale
        const b = toLinear(image.data[si + 2]) * exposureScale
        samples.push({ source: s, sp, si, r, g, b, luma: (r + g + b) / 3, weight, exposureScale })
      }

      let selectedSource: number | null = null
      if (deghost !== "off" && samples.length >= 3) {
        const medianLuma = median(samples.map((sample) => sample.luma))
        let maxDelta = 0
        for (const sample of samples) maxDelta = Math.max(maxDelta, Math.abs(sample.luma - medianLuma))
        ghostScores[p] = maxDelta
        if (maxDelta > ghostThreshold) {
          deghostMask[p] = 255
          const referenceSample = samples.find((sample) => sample.source === referenceIndex)
          let best = referenceSample ?? samples[0]
          let bestScore = Number.POSITIVE_INFINITY
          for (const sample of samples) {
            const score = Math.abs(sample.luma - medianLuma) - sample.weight * 0.01 + (sample.source === referenceIndex ? -0.05 : 0)
            if (score < bestScore) {
              bestScore = score
              best = sample
            }
          }
          selectedSource = (referenceSample ?? best).source
        }
      }

      for (const sample of samples) {
        const deghostWeight = selectedSource === null || sample.source === selectedSource ? 1 : 0
        const weight = sample.weight * deghostWeight
        exposureWeights[sample.source][p] = weight
        if (weight <= 0) continue
        wr += sample.r * weight
        wg += sample.g * weight
        wb += sample.b * weight
        wa += images[sample.source].data[sample.si + 3] * weight
        total += weight
      }
      const oi = p * 4
      if (total <= 0) continue
      if (selectedSource !== null) {
        sourceIndexByPixel[p] = selectedSource
      } else {
        let best = samples[0]
        for (const sample of samples) if (sample.weight > best.weight) best = sample
        sourceIndexByPixel[p] = best.source
      }
      const ri = p * 3
      radiance[ri] = wr / total
      radiance[ri + 1] = wg / total
      radiance[ri + 2] = wb / total
      out[oi] = toneMap(radiance[ri], toneMapping)
      out[oi + 1] = toneMap(radiance[ri + 1], toneMapping)
      out[oi + 2] = toneMap(radiance[ri + 2], toneMapping)
      out[oi + 3] = clamp8(wa / total)
    }
  }

  return {
    image: makeImageData(width, height, out),
    exposureWeights,
    radiance,
    placements,
    featureMatches: aligned?.featureMatches ?? [],
    deghostMask,
    ghostScores,
    sourceIndexByPixel,
    toneMapping,
  }
}

export interface HdrSceneLinearFrame {
  image: ImageData | HighBitImage
  ev?: number
  sourceKind?: "raw" | "rendered"
}

export interface HdrSceneLinearMergeResult {
  highBitImage: HighBitImage
  preview: ImageData
  radiance: Float32Array
  placements: WorkflowPlacement[]
  featureMatches: FeatureMatchResult[]
  deghostMask: Uint8Array
  ghostScores: Float32Array
  sourceIndexByPixel: Uint8Array
  toneMapping: ReturnType<typeof normalizeToneMapping>
  rawStack: boolean
}

function isHighBitImage(image: ImageData | HighBitImage): image is HighBitImage {
  return "storage" in image && "channels" in image && image.channels === 4
}

function highBitMax(image: HighBitImage) {
  return image.storage === "uint16" ? 65535 : image.storage === "uint8" ? 255 : 1
}

function frameUnitAt(image: ImageData | HighBitImage, x: number, y: number, channel: 0 | 1 | 2 | 3) {
  const p = y * image.width + x
  if (isHighBitImage(image)) {
    const value = Number(image.data[p * 4 + channel])
    return image.storage === "float32" ? Math.max(0, value) : Math.max(0, value / highBitMax(image))
  }
  const value = image.data[p * 4 + channel]
  return channel === 3 ? value / 255 : toLinear(value)
}

function framePreviewImageData(frame: HdrSceneLinearFrame) {
  if (!isHighBitImage(frame.image)) return frame.image
  const out = new Uint8ClampedArray(frame.image.width * frame.image.height * 4)
  for (let p = 0; p < frame.image.width * frame.image.height; p++) {
    const i = p * 4
    out[i] = clamp8(clamp(Number(frame.image.data[i]) / Math.max(1, frame.image.storage === "float32" ? 1 : highBitMax(frame.image)), 0, 1) ** (1 / 2.2) * 255)
    out[i + 1] = clamp8(clamp(Number(frame.image.data[i + 1]) / Math.max(1, frame.image.storage === "float32" ? 1 : highBitMax(frame.image)), 0, 1) ** (1 / 2.2) * 255)
    out[i + 2] = clamp8(clamp(Number(frame.image.data[i + 2]) / Math.max(1, frame.image.storage === "float32" ? 1 : highBitMax(frame.image)), 0, 1) ** (1 / 2.2) * 255)
    out[i + 3] = clamp8(frameUnitAt(frame.image, p % frame.image.width, Math.floor(p / frame.image.width), 3) * 255)
  }
  return makeImageData(frame.image.width, frame.image.height, out)
}

function sceneWeight(luma: number, alpha: number, exposureEv: number, options: HdrMergeOptions, sourceIndex: number) {
  const midtone = Math.max(0, 1 - Math.abs(luma - 0.5) * 2)
  let weight = (midtone * midtone + 0.03) * alpha
  if (luma > 0.94 || luma < 0.01) weight *= 0.18
  if (options.exposureWeighting === "shadow-priority") weight *= 2 ** (exposureEv * 0.45)
  else if (options.exposureWeighting === "highlight-priority") weight *= 2 ** (-exposureEv * 0.45)
  else if (options.exposureWeighting === "manual") weight *= Math.max(0, options.manualExposureWeights?.[sourceIndex] ?? 1)
  else if (options.manualExposureWeights?.length) weight *= Math.max(0, options.manualExposureWeights[sourceIndex] ?? 1)
  return Math.max(0.002, weight)
}

export function mergeHdrSceneLinearImageStack(
  frames: HdrSceneLinearFrame[],
  options: HdrMergeOptions = {},
): HdrSceneLinearMergeResult {
  const width = frames[0]?.image.width ?? 1
  const height = frames[0]?.image.height ?? 1
  const data = new Float32Array(width * height * 4)
  const previewBytes = new Uint8ClampedArray(width * height * 4)
  const deghostMask = new Uint8Array(width * height)
  const ghostScores = new Float32Array(width * height)
  const sourceIndexByPixel = new Uint8Array(width * height)
  const previews = frames.map(framePreviewImageData)
  const aligned = options.align ? autoAlignImageStack(previews, options) : null
  const placements = aligned?.placements ?? frames.map((_, index) => ({ dx: index === 0 ? 0 : 0, dy: 0, score: 0 }))
  const toneMapping = normalizeToneMapping(options.toneMapping)
  const deghost = options.deghost ?? "off"
  const referenceIndex = clamp(Math.round(options.referenceIndex ?? 0), 0, Math.max(0, frames.length - 1))
  const ghostThreshold = deghostThreshold(deghost, options.ghostThreshold)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const samples: Array<{ source: number; r: number; g: number; b: number; a: number; luma: number; weight: number }> = []
      for (let s = 0; s < frames.length; s++) {
        const frame = frames[s]
        const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
        const sx = x - placement.dx
        const sy = y - placement.dy
        if (sx < 0 || sy < 0 || sx >= frame.image.width || sy >= frame.image.height) continue
        const exposureEv = frames[s].ev ?? 0
        const exposureScale = 2 ** -exposureEv
        const r = frameUnitAt(frame.image, sx, sy, 0) * exposureScale
        const g = frameUnitAt(frame.image, sx, sy, 1) * exposureScale
        const b = frameUnitAt(frame.image, sx, sy, 2) * exposureScale
        const a = frameUnitAt(frame.image, sx, sy, 3)
        const luma = (r + g + b) / 3
        const weight = sceneWeight(luma, a, exposureEv, options, s)
        samples.push({ source: s, r, g, b, a, luma, weight })
      }

      let selectedSource: number | null = null
      if (deghost !== "off" && samples.length >= 3) {
        const medianLuma = median(samples.map((sample) => sample.luma))
        let maxDelta = 0
        for (const sample of samples) maxDelta = Math.max(maxDelta, Math.abs(sample.luma - medianLuma))
        ghostScores[p] = maxDelta
        if (maxDelta > ghostThreshold) {
          deghostMask[p] = 255
          selectedSource = samples.find((sample) => sample.source === referenceIndex)?.source ?? samples[0]?.source ?? 0
        }
      }

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let total = 0
      for (const sample of samples) {
        const weight = selectedSource === null || sample.source === selectedSource ? sample.weight : 0
        if (weight <= 0) continue
        r += sample.r * weight
        g += sample.g * weight
        b += sample.b * weight
        a += sample.a * weight
        total += weight
      }
      if (total <= 0) continue
      if (selectedSource !== null) sourceIndexByPixel[p] = selectedSource
      else {
        let best = samples[0]
        for (const sample of samples) if (sample.weight > best.weight) best = sample
        sourceIndexByPixel[p] = best?.source ?? 0
      }
      const i = p * 4
      data[i] = r / total
      data[i + 1] = g / total
      data[i + 2] = b / total
      data[i + 3] = clamp(a / total, 0, 1)
      previewBytes[i] = toneMap(data[i], toneMapping)
      previewBytes[i + 1] = toneMap(data[i + 1], toneMapping)
      previewBytes[i + 2] = toneMap(data[i + 2], toneMapping)
      previewBytes[i + 3] = clamp8(data[i + 3] * 255)
    }
  }

  const highBitImage: HighBitImage = {
    width,
    height,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    storage: "float32",
    data,
    warnings: ["HDR merge produced a scene-linear 32-bit float source with an 8-bit tone-mapped preview."],
  }
  return {
    highBitImage,
    preview: makeImageData(width, height, previewBytes),
    radiance: data,
    placements,
    featureMatches: aligned?.featureMatches ?? [],
    deghostMask,
    ghostScores,
    sourceIndexByPixel,
    toneMapping,
    rawStack: frames.some((frame) => frame.sourceKind === "raw" || isHighBitImage(frame.image)),
  }
}

function sharpnessMap(image: ImageData) {
  const raw = new Float64Array(image.width * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      raw[y * image.width + x] = localContrast(image, x, y)
    }
  }
  const out = new Float64Array(raw.length)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx
          const sy = y + dy
          if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
          sum += raw[sy * image.width + sx]
          count++
        }
      }
      out[y * image.width + x] = sum / Math.max(1, count)
    }
  }
  return out
}

export function focusStackImageData(images: ImageData[]) {
  const width = images[0]?.width ?? 1
  const height = images[0]?.height ?? 1
  const out = new Uint8ClampedArray(width * height * 4)
  const sourceIndexByPixel = new Uint8Array(width * height)
  const confidence = new Float32Array(width * height)
  const sharpnessMaps = images.map(sharpnessMap)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      let best = 0
      let bestScore = -1
      let secondScore = -1
      for (let s = 0; s < images.length; s++) {
        const score = sharpnessMaps[s][p] ?? 0
        if (score > bestScore) {
          secondScore = bestScore
          best = s
          bestScore = score
        } else if (score > secondScore) {
          secondScore = score
        }
      }
      const si = pixelIndex(images[best], x, y)
      const oi = p * 4
      out[oi] = images[best].data[si]
      out[oi + 1] = images[best].data[si + 1]
      out[oi + 2] = images[best].data[si + 2]
      out[oi + 3] = images[best].data[si + 3]
      sourceIndexByPixel[p] = best
      confidence[p] = bestScore <= 0 ? 0 : clamp((bestScore - Math.max(0, secondScore)) / bestScore, 0, 1)
    }
  }

  return { image: makeImageData(width, height, out), sourceIndexByPixel, confidence, sharpnessMaps }
}

export function buildSelectAndMaskPreviewModel(options: SelectAndMaskPreviewOptions) {
  const view = SELECT_AND_MASK_VIEW_MODES.find((item) => item.id === options.viewMode) ?? SELECT_AND_MASK_VIEW_MODES[2]
  const outputTo = options.outputTo
  const overlayOpacity = clamp((options.opacity ?? 50) / 100, 0, 1)
  return {
    viewMode: view.id,
    background: view.background,
    opacity: options.opacity ?? 50,
    decontaminateColors: !!options.decontaminateColors,
    overlayOpacity,
    showsComposite: view.id === "on-layers" || view.id === "marching" || view.id === "onion" || view.id === "split",
    showsMaskOnly: view.id === "bw",
    showsAlphaMatte: view.id === "alpha-matte",
    showsEdgesOnly: view.id === "edge-only",
    showsBeforeAfterSplit: view.id === "split",
    edgeEmphasis: view.id === "edge-only" ? "selection-transition" : "none",
    description: view.id === "split"
      ? "Shows the unmasked composite on the left and the refined before/after result on the right."
      : view.id === "edge-only"
        ? "Shows only selection transition edges so missed hair, product corners, and halos stand out."
        : view.id === "alpha-matte"
          ? "Shows the refined alpha over transparency to judge semi-transparent edges."
          : view.label,
    output: {
      target: outputTo,
      createsDocument: outputTo === "new-document",
      createsLayer: outputTo === "new-layer" || outputTo === "new-layer-mask",
      createsMask: outputTo === "layer-mask" || outputTo === "new-layer-mask",
      createsChannel: outputTo === "alpha-channel",
      preservesSource: outputTo !== "selection" && outputTo !== "layer-mask",
      supportsDecontamination: !!options.decontaminateColors && outputTo !== "selection" && outputTo !== "alpha-channel",
    },
  }
}
