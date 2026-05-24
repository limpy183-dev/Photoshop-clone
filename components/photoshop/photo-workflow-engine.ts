export interface WorkflowPlacement {
  dx: number
  dy: number
  score: number
}

export interface AutoAlignOptions {
  searchRadius?: number
  maxFeatures?: number
  minFeatureDistance?: number
  descriptorRadius?: number
  ratioTest?: number
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
  return values.map((value) => (value - mean) / scale)
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
  const placement =
    fromMatches && fromMatches.inliers.length >= 3
      ? { ...fromMatches.placement, score: alignmentScore(reference, moving, fromMatches.placement.dx, fromMatches.placement.dy) }
      : fallback
  const geometric = geometricMatchesForPlacement(referenceFeatures, movingFeatures, placement)
  const allMatches = uniqueMatches([...matches, ...geometric])
  const inliers = allMatches.filter((match) => Math.abs(match.dx - placement.dx) <= 1 && Math.abs(match.dy - placement.dy) <= 1)

  return {
    placement,
    matches: allMatches,
    inliers,
    fallbackUsed: !fromMatches || fromMatches.inliers.length < 3,
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
    minX = Math.min(minX, placement.dx)
    minY = Math.min(minY, placement.dy)
    maxX = Math.max(maxX, placement.dx + images[i].width)
    maxY = Math.max(maxY, placement.dy + images[i].height)
  }
  return {
    minX,
    minY,
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
    offsetX: -minX,
    offsetY: -minY,
  }
}

export function autoBlendImageStack(
  images: ImageData[],
  placements: WorkflowPlacement[] = autoAlignImageStack(images).placements,
  options: { expandToFit?: boolean; featherRadius?: number } = {},
) {
  const bounds = boundsForStack(images, placements, options.expandToFit ?? false)
  const width = bounds.width
  const height = bounds.height
  const sums = new Float64Array(width * height * 4)
  const weights = new Float64Array(width * height)
  const coverage = new Uint8Array(width * height)
  const featherRadius = Math.max(1, options.featherRadius ?? 2)

  for (let s = 0; s < images.length; s++) {
    const image = images[s]
    const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
    for (let y = 0; y < height; y++) {
      const docY = y + bounds.minY
      const sy = docY - placement.dy
      if (sy < 0 || sy >= image.height) continue
      for (let x = 0; x < width; x++) {
        const docX = x + bounds.minX
        const sx = docX - placement.dx
        if (sx < 0 || sx >= image.width) continue
        const si = pixelIndex(image, sx, sy)
        const alpha = image.data[si + 3] / 255
        if (alpha <= 0) continue
        const edgeDistance = Math.min(sx, sy, image.width - 1 - sx, image.height - 1 - sy)
        const feather = clamp(edgeDistance / featherRadius, 0.35, 1)
        const weight = alpha * feather
        const p = y * width + x
        const oi = p * 4
        sums[oi] += image.data[si] * weight
        sums[oi + 1] += image.data[si + 1] * weight
        sums[oi + 2] += image.data[si + 2] * weight
        sums[oi + 3] += image.data[si + 3] * weight
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

  return { image: makeImageData(width, height, out), coverage, bounds }
}

export function photomergeImageStack(images: ImageData[], options: AutoAlignOptions = {}) {
  const aligned = autoAlignImageStack(images, options)
  const blended = autoBlendImageStack(images, aligned.placements, { expandToFit: true, featherRadius: 10 })
  const seamColumns: number[] = []
  for (let x = 0; x < blended.image.width; x++) {
    let overlap = 0
    for (let y = 0; y < blended.image.height; y++) {
      if (blended.coverage[y * blended.image.width + x] > 1) overlap++
    }
    if (overlap > 0) seamColumns.push(x)
  }
  return { ...blended, placements: aligned.placements, featureMatches: aligned.featureMatches, seamColumns }
}

export interface HdrMergeOptions extends AutoAlignOptions {
  align?: boolean
}

function exposureWeightForPixel(image: ImageData, p: number) {
  const i = p * 4
  const luma = lumaFromData(image.data, i) / 255
  const clipped = image.data[i] > 235 || image.data[i + 1] > 235 || image.data[i + 2] > 235
  const blocked = image.data[i] < 8 && image.data[i + 1] < 8 && image.data[i + 2] < 8
  const midtone = Math.max(0, 1 - Math.abs(luma - 0.5) * 2)
  return Math.max(0.002, (midtone * midtone + 0.02) * (clipped || blocked ? 0.15 : 1) * (image.data[i + 3] / 255))
}

function toLinear(value: number) {
  return (value / 255) ** 2.2
}

function toneMap(value: number) {
  const mapped = value / (1 + value)
  return clamp8(mapped ** (1 / 2.2) * 255)
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
  const aligned = options.align ? autoAlignImageStack(images, options) : null
  const placements = aligned?.placements ?? images.map((_, index) => ({ dx: index === 0 ? 0 : 0, dy: 0, score: 0 }))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      let wr = 0
      let wg = 0
      let wb = 0
      let wa = 0
      let total = 0
      for (let s = 0; s < images.length; s++) {
        const image = images[s]
        const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
        const sx = x - placement.dx
        const sy = y - placement.dy
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
        const sp = sy * image.width + sx
        const si = sp * 4
        const weight = exposureWeightForPixel(image, sp)
        const exposureScale = 2 ** -(exposures[s]?.ev ?? 0)
        exposureWeights[s][p] = weight
        wr += toLinear(image.data[si]) * exposureScale * weight
        wg += toLinear(image.data[si + 1]) * exposureScale * weight
        wb += toLinear(image.data[si + 2]) * exposureScale * weight
        wa += image.data[si + 3] * weight
        total += weight
      }
      const oi = p * 4
      if (total <= 0) continue
      const ri = p * 3
      radiance[ri] = wr / total
      radiance[ri + 1] = wg / total
      radiance[ri + 2] = wb / total
      out[oi] = toneMap(radiance[ri])
      out[oi + 1] = toneMap(radiance[ri + 1])
      out[oi + 2] = toneMap(radiance[ri + 2])
      out[oi + 3] = clamp8(wa / total)
    }
  }

  return {
    image: makeImageData(width, height, out),
    exposureWeights,
    radiance,
    placements,
    featureMatches: aligned?.featureMatches ?? [],
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

export interface PerspectiveCropResult {
  image: ImageData
  transform: {
    corners: [Point, Point, Point, Point]
    outputWidth: number
    outputHeight: number
  }
}

export interface Point {
  x: number
  y: number
}

function projectiveCoefficients(tl: Point, tr: Point, br: Point, bl: Point) {
  const dx1 = tr.x - br.x
  const dy1 = tr.y - br.y
  const dx2 = bl.x - br.x
  const dy2 = bl.y - br.y
  const dx3 = tl.x - tr.x + br.x - bl.x
  const dy3 = tl.y - tr.y + br.y - bl.y
  const det = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(det) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / det
  const h = Math.abs(det) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / det
  return {
    a: tr.x - tl.x + g * tr.x,
    b: bl.x - tl.x + h * bl.x,
    c: tl.x,
    d: tr.y - tl.y + g * tr.y,
    e: bl.y - tl.y + h * bl.y,
    f: tl.y,
    g,
    h,
  }
}

function sampleImageDataBilinear(source: ImageData, x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const sx0 = clamp(x0, 0, source.width - 1)
  const sy0 = clamp(y0, 0, source.height - 1)
  const sx1 = clamp(x0 + 1, 0, source.width - 1)
  const sy1 = clamp(y0 + 1, 0, source.height - 1)
  const i00 = pixelIndex(source, sx0, sy0)
  const i10 = pixelIndex(source, sx1, sy0)
  const i01 = pixelIndex(source, sx0, sy1)
  const i11 = pixelIndex(source, sx1, sy1)
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    out[c] =
      source.data[i00 + c] * (1 - tx) * (1 - ty) +
      source.data[i10 + c] * tx * (1 - ty) +
      source.data[i01 + c] * (1 - tx) * ty +
      source.data[i11 + c] * tx * ty
  }
  return out
}

export function perspectiveCropImageData(source: ImageData, corners: [Point, Point, Point, Point] | Point[]): PerspectiveCropResult {
  if (corners.length < 4) throw new Error("Perspective crop requires four corners")
  const ordered = corners.slice(0, 4) as [Point, Point, Point, Point]
  const [tl, tr, br, bl] = ordered
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y)
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y)
  const outputWidth = Math.max(1, Math.round(Math.max(topW, bottomW)))
  const outputHeight = Math.max(1, Math.round(Math.max(leftH, rightH)))
  const coeff = projectiveCoefficients(tl, tr, br, bl)
  const out = new Uint8ClampedArray(outputWidth * outputHeight * 4)

  for (let y = 0; y < outputHeight; y++) {
    const v = outputHeight === 1 ? 0 : y / (outputHeight - 1)
    for (let x = 0; x < outputWidth; x++) {
      const u = outputWidth === 1 ? 0 : x / (outputWidth - 1)
      const denom = coeff.g * u + coeff.h * v + 1
      const sx = (coeff.a * u + coeff.b * v + coeff.c) / denom
      const sy = (coeff.d * u + coeff.e * v + coeff.f) / denom
      const sample = sampleImageDataBilinear(source, sx, sy)
      const oi = (y * outputWidth + x) * 4
      out[oi] = clamp8(sample[0])
      out[oi + 1] = clamp8(sample[1])
      out[oi + 2] = clamp8(sample[2])
      out[oi + 3] = clamp8(sample[3])
    }
  }

  return {
    image: makeImageData(outputWidth, outputHeight, out),
    transform: {
      corners: ordered.map((point) => ({ x: point.x, y: point.y })) as [Point, Point, Point, Point],
      outputWidth,
      outputHeight,
    },
  }
}

export interface SeamCarveOptions {
  protectMask?: Uint8Array
  removeMask?: Uint8Array
}

export interface SeamCarveResult {
  image: ImageData
  removedVerticalSeams: Int32Array[]
  removedHorizontalSeams: Int32Array[]
}

function seamEnergy(image: ImageData, protectMask?: Uint8Array, removeMask?: Uint8Array) {
  const out = new Float64Array(image.width * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const p = y * image.width + x
      const gradient = Math.abs(lumaAt(image, x + 1, y) - lumaAt(image, x - 1, y)) + Math.abs(lumaAt(image, x, y + 1) - lumaAt(image, x, y - 1))
      const alpha = image.data[p * 4 + 3] / 255
      const protect = ((protectMask?.[p] ?? 0) / 255) * 1000000
      const remove = ((removeMask?.[p] ?? 0) / 255) * 1000000
      out[p] = gradient * (0.35 + alpha) + protect - remove
    }
  }
  return out
}

function removeVerticalSeamFromImageData(image: ImageData, protectMask?: Uint8Array, removeMask?: Uint8Array) {
  const width = image.width
  const height = image.height
  const energy = seamEnergy(image, protectMask, removeMask)
  const cost = new Float64Array(width * height)
  const back = new Int8Array(width * height)
  for (let x = 0; x < width; x++) cost[x] = energy[x]
  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bestX = x
      let best = cost[(y - 1) * width + x]
      if (x > 0 && cost[(y - 1) * width + x - 1] < best) {
        best = cost[(y - 1) * width + x - 1]
        bestX = x - 1
      }
      if (x < width - 1 && cost[(y - 1) * width + x + 1] < best) {
        best = cost[(y - 1) * width + x + 1]
        bestX = x + 1
      }
      cost[y * width + x] = energy[y * width + x] + best
      back[y * width + x] = bestX - x
    }
  }
  let seamX = 0
  let best = Number.POSITIVE_INFINITY
  for (let x = 0; x < width; x++) {
    const value = cost[(height - 1) * width + x]
    if (value < best) {
      best = value
      seamX = x
    }
  }
  const seam = new Int32Array(height)
  for (let y = height - 1; y >= 0; y--) {
    seam[y] = seamX
    seamX += back[y * width + seamX]
  }

  const outWidth = Math.max(1, width - 1)
  const out = new Uint8ClampedArray(outWidth * height * 4)
  const nextProtect = protectMask ? new Uint8Array(outWidth * height) : undefined
  const nextRemove = removeMask ? new Uint8Array(outWidth * height) : undefined
  for (let y = 0; y < height; y++) {
    let ox = 0
    for (let x = 0; x < width; x++) {
      if (x === seam[y]) continue
      const sp = y * width + x
      const op = y * outWidth + ox
      const si = sp * 4
      const oi = op * 4
      out[oi] = image.data[si]
      out[oi + 1] = image.data[si + 1]
      out[oi + 2] = image.data[si + 2]
      out[oi + 3] = image.data[si + 3]
      if (nextProtect && protectMask) nextProtect[op] = protectMask[sp]
      if (nextRemove && removeMask) nextRemove[op] = removeMask[sp]
      ox++
    }
  }

  return { image: makeImageData(outWidth, height, out), seam, protectMask: nextProtect, removeMask: nextRemove }
}

function transposeImage(image: ImageData) {
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4
      const oi = (x * image.height + y) * 4
      out[oi] = image.data[si]
      out[oi + 1] = image.data[si + 1]
      out[oi + 2] = image.data[si + 2]
      out[oi + 3] = image.data[si + 3]
    }
  }
  return makeImageData(image.height, image.width, out)
}

function transposeMask(mask: Uint8Array | undefined, width: number, height: number) {
  if (!mask) return undefined
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[x * height + y] = mask[y * width + x]
  }
  return out
}

function resizeImageData(source: ImageData, targetWidth: number, targetHeight: number) {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y++) {
    const sy = targetHeight === 1 ? 0 : (y / (targetHeight - 1)) * (source.height - 1)
    for (let x = 0; x < targetWidth; x++) {
      const sx = targetWidth === 1 ? 0 : (x / (targetWidth - 1)) * (source.width - 1)
      const sample = sampleImageDataBilinear(source, sx, sy)
      const oi = (y * targetWidth + x) * 4
      out[oi] = clamp8(sample[0])
      out[oi + 1] = clamp8(sample[1])
      out[oi + 2] = clamp8(sample[2])
      out[oi + 3] = clamp8(sample[3])
    }
  }
  return makeImageData(targetWidth, targetHeight, out)
}

export function seamCarveImageData(source: ImageData, targetWidth: number, targetHeight: number, options: SeamCarveOptions = {}): SeamCarveResult {
  const targetW = Math.max(1, Math.round(targetWidth))
  const targetH = Math.max(1, Math.round(targetHeight))
  let work = makeImageData(source.width, source.height, new Uint8ClampedArray(source.data))
  let protectMask = options.protectMask ? new Uint8Array(options.protectMask) : undefined
  let removeMask = options.removeMask ? new Uint8Array(options.removeMask) : undefined
  const removedVerticalSeams: Int32Array[] = []
  const removedHorizontalSeams: Int32Array[] = []

  while (work.width > targetW) {
    const result = removeVerticalSeamFromImageData(work, protectMask, removeMask)
    work = result.image
    protectMask = result.protectMask
    removeMask = result.removeMask
    removedVerticalSeams.push(result.seam)
  }

  if (work.height > targetH) {
    work = transposeImage(work)
    protectMask = transposeMask(protectMask, source.width - removedVerticalSeams.length, source.height)
    removeMask = transposeMask(removeMask, source.width - removedVerticalSeams.length, source.height)
    while (work.width > targetH) {
      const result = removeVerticalSeamFromImageData(work, protectMask, removeMask)
      work = result.image
      protectMask = result.protectMask
      removeMask = result.removeMask
      removedHorizontalSeams.push(result.seam)
    }
    work = transposeImage(work)
  }

  if (work.width !== targetW || work.height !== targetH) {
    work = resizeImageData(work, targetW, targetH)
  }

  return { image: work, removedVerticalSeams, removedHorizontalSeams }
}

export function buildSelectAndMaskPreviewModel(options: SelectAndMaskPreviewOptions) {
  const view = SELECT_AND_MASK_VIEW_MODES.find((item) => item.id === options.viewMode) ?? SELECT_AND_MASK_VIEW_MODES[2]
  const outputTo = options.outputTo
  const overlayOpacity = clamp((options.opacity ?? 50) / 100, 0, 1)
  return {
    viewMode: view.id,
    background: view.background,
    overlayOpacity,
    showsComposite: view.id === "on-layers" || view.id === "marching" || view.id === "onion",
    showsMaskOnly: view.id === "bw",
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
