import type { Layer, PathPoint, PathProps, ShapeProps } from "./types"
import { hexToRgb } from "./color-utils"
import { autoAlignImageStack, seamCarveImageData } from "./photo-workflow-engine"
import {
  contractMaskData as contractMaskDataPure,
  distanceToFeature,
  expandMaskData as expandMaskDataPure,
  featherMaskData as featherMaskDataPure,
  smoothMaskData as smoothMaskDataPure,
} from "./selection-algorithms"

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export interface IccProfileInfo {
  size: number
  preferredCmm: string
  version: string
  deviceClass: string
  colorSpace: string
  pcs: string
  createdAt: string
  signature: string
  platform: string
  renderingIntent: number
}

export interface ColorStop {
  offset: number
  color: string
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp8 = (value: number) => clamp(Math.round(value), 0, 255)
const alphaThreshold = 16

function rgbaDistance(data: Uint8ClampedArray, a: number, b: number) {
  const dr = data[a] - data[b]
  const dg = data[a + 1] - data[b + 1]
  const db = data[a + 2] - data[b + 2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function rgbDistanceToSeed(data: Uint8ClampedArray, i: number, seed: { r: number; g: number; b: number }) {
  const dr = data[i] - seed.r
  const dg = data[i + 1] - seed.g
  const db = data[i + 2] - seed.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function maskDataBounds(maskData: Uint8ClampedArray, width: number, height: number, threshold = 0): Bounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maskData[y * width + x] <= threshold) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export interface EdgeAwareQuickSelectionOptions {
  seed?: Point
  tolerance?: number
  minAlpha?: number
  maxPixels?: number
  adaptive?: boolean
  includeDiagonals?: boolean
  edgeSensitivity?: number
  sampleSize?: "point" | "3x3" | "5x5"
  contiguous?: boolean
}

function sampledSeedColor(src: ImageData, x: number, y: number, radius: number, minAlpha: number) {
  const samples: Array<{ r: number; g: number; b: number }> = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = clamp(x + dx, 0, src.width - 1)
      const sy = clamp(y + dy, 0, src.height - 1)
      const i = (sy * src.width + sx) * 4
      if (src.data[i + 3] <= minAlpha) continue
      samples.push({ r: src.data[i], g: src.data[i + 1], b: src.data[i + 2] })
    }
  }
  if (!samples.length) return { r: 0, g: 0, b: 0, spread: 0 }
  const seed = {
    r: samples.reduce((sum, value) => sum + value.r, 0) / samples.length,
    g: samples.reduce((sum, value) => sum + value.g, 0) / samples.length,
    b: samples.reduce((sum, value) => sum + value.b, 0) / samples.length,
  }
  const distances = samples.map((value) => Math.hypot(value.r - seed.r, value.g - seed.g, value.b - seed.b))
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length
  return { ...seed, spread: mean + Math.sqrt(variance) }
}

function localColorGradient(data: Uint8ClampedArray, width: number, height: number, p: number) {
  const x = p % width
  const y = (p - x) / width
  const i = p * 4
  let gradient = 0
  const neighbors = [
    x > 0 ? p - 1 : -1,
    x < width - 1 ? p + 1 : -1,
    y > 0 ? p - width : -1,
    y < height - 1 ? p + width : -1,
  ]
  for (const next of neighbors) {
    if (next < 0) continue
    gradient = Math.max(gradient, rgbaDistance(data, i, next * 4))
  }
  return gradient
}

function sampleSizeRadius(size: EdgeAwareQuickSelectionOptions["sampleSize"]) {
  if (size === "5x5") return 2
  if (size === "3x3") return 1
  return 0
}

export function buildEdgeAwareQuickSelectionMaskData(
  src: ImageData,
  options: EdgeAwareQuickSelectionOptions = {},
) {
  const width = src.width
  const height = src.height
  const maskData = new Uint8ClampedArray(width * height)
  if (width <= 0 || height <= 0) return { maskData, width, height, bounds: null as Bounds | null }

  const tolerance = Math.max(1, options.tolerance ?? 48)
  const minAlpha = Math.max(0, Math.min(255, options.minAlpha ?? alphaThreshold))
  const startX = clamp(Math.round(options.seed?.x ?? width / 2), 0, width - 1)
  const startY = clamp(Math.round(options.seed?.y ?? height / 2), 0, height - 1)
  let start = startY * width + startX

  if (src.data[start * 4 + 3] <= minAlpha) {
    start = -1
    let bestAlpha = minAlpha
    for (let i = 0; i < width * height; i++) {
      const alpha = src.data[i * 4 + 3]
      if (alpha > bestAlpha) {
        bestAlpha = alpha
        start = i
      }
    }
    if (start < 0) return { maskData, width, height, bounds: null as Bounds | null }
  }

  const seedX = start % width
  const seedY = (start - seedX) / width
  const sampleRadius = sampleSizeRadius(options.sampleSize)
  const seed = options.adaptive || sampleRadius > 0
    ? sampledSeedColor(src, seedX, seedY, sampleRadius, minAlpha)
    : { r: src.data[start * 4], g: src.data[start * 4 + 1], b: src.data[start * 4 + 2], spread: 0 }
  const visited = new Uint8Array(width * height)
  const adaptiveTolerance = tolerance + seed.spread * 0.65
  const edgeLimit = Math.max(42, adaptiveTolerance * (options.edgeSensitivity ?? 1.75))
  const maxPixels = Math.max(1, options.maxPixels ?? width * height)
  const includeDiagonals = options.includeDiagonals ?? options.adaptive ?? false
  let accepted = 0

  if (options.contiguous === false) {
    for (let p = 0; p < width * height && accepted < maxPixels; p++) {
      const pi = p * 4
      if (src.data[pi + 3] <= minAlpha) continue
      if (rgbDistanceToSeed(src.data, pi, seed) > adaptiveTolerance) continue
      if (localColorGradient(src.data, width, height, p) > edgeLimit * 1.25 && rgbDistanceToSeed(src.data, pi, seed) > adaptiveTolerance * 0.72) continue
      maskData[p] = 255
      accepted++
    }
    return { maskData, width, height, bounds: maskDataBounds(maskData, width, height) }
  }

  const queue = [start]
  visited[start] = 1
  for (let head = 0; head < queue.length && accepted < maxPixels; head++) {
    const p = queue[head]
    const pi = p * 4
    if (src.data[pi + 3] <= minAlpha || rgbDistanceToSeed(src.data, pi, seed) > adaptiveTolerance) continue

    maskData[p] = 255
    accepted++

    const x = p % width
    const y = (p - x) / width
    const neighbors = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ]
    if (includeDiagonals) {
      neighbors.push(
        x > 0 && y > 0 ? p - width - 1 : -1,
        x < width - 1 && y > 0 ? p - width + 1 : -1,
        x > 0 && y < height - 1 ? p + width - 1 : -1,
        x < width - 1 && y < height - 1 ? p + width + 1 : -1,
      )
    }
    for (const next of neighbors) {
      if (next < 0 || visited[next]) continue
      const ni = next * 4
      visited[next] = 1
      if (src.data[ni + 3] <= minAlpha) continue
      if (rgbaDistance(src.data, pi, ni) > edgeLimit) continue
      if (localColorGradient(src.data, width, height, next) > edgeLimit * 1.25 && rgbDistanceToSeed(src.data, ni, seed) > adaptiveTolerance * 0.72) continue
      if (rgbDistanceToSeed(src.data, ni, seed) > adaptiveTolerance) continue
      queue.push(next)
    }
  }

  return { maskData, width, height, bounds: maskDataBounds(maskData, width, height) }
}

export interface SelectionMaskRefinementOptions {
  smoothRadius?: number
  featherRadius?: number
  contrast?: number
  shiftEdge?: number
  smartRadius?: boolean
  edgeRadius?: number
  sourceImage?: ImageData
}

function majoritySmoothMask(maskData: Uint8ClampedArray, width: number, height: number, radius: number) {
  const out = new Uint8ClampedArray(maskData.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let selected = 0
      let total = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          total++
          if (maskData[ny * width + nx] > 127) selected++
        }
      }
      out[y * width + x] = selected >= Math.ceil(total * 0.5) ? 255 : 0
    }
  }
  return out
}

function shiftMaskEdge(maskData: Uint8ClampedArray, width: number, height: number, amount: number) {
  const pixels = Math.round(Math.abs(amount))
  if (!pixels) return new Uint8ClampedArray(maskData)
  const expand = amount > 0
  const out = new Uint8ClampedArray(maskData.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = false
      for (let dy = -pixels; dy <= pixels && !hit; dy++) {
        for (let dx = -pixels; dx <= pixels && !hit; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            if (!expand) hit = true
            continue
          }
          const selected = maskData[ny * width + nx] > 127
          if (expand ? selected : !selected) hit = true
        }
      }
      out[y * width + x] = expand ? (hit ? 255 : 0) : (hit ? 0 : maskData[y * width + x])
    }
  }
  return out
}

function featherMaskData(maskData: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(maskData)
  const r = Math.max(1, Math.round(radius))
  let src = Float32Array.from(maskData, (value) => value / 255)
  const tmp = new Float32Array(maskData.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let count = 0
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          sum += src[y * width + nx]
          count++
        }
        tmp[y * width + x] = sum / Math.max(1, count)
      }
    }
    const next = new Float32Array(maskData.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let count = 0
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          sum += tmp[ny * width + x]
          count++
        }
        next[y * width + x] = sum / Math.max(1, count)
      }
    }
    src = next
  }
  return Uint8ClampedArray.from(src, (value) => clamp8(value * 255))
}

function applyMaskContrast(maskData: Uint8ClampedArray, contrast: number) {
  if (contrast <= 0) return new Uint8ClampedArray(maskData)
  const factor = 1 + contrast / 50
  return Uint8ClampedArray.from(maskData, (value) => {
    const a = value / 255
    return clamp8((clamp((a - 0.5) * factor + 0.5, 0, 1)) * 255)
  })
}

function colorDistanceToAverage(data: Uint8ClampedArray, i: number, avg: { r: number; g: number; b: number }) {
  const dr = data[i] - avg.r
  const dg = data[i + 1] - avg.g
  const db = data[i + 2] - avg.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function localMaskColorModels(
  source: ImageData,
  maskData: Uint8ClampedArray,
  x: number,
  y: number,
  radius: number,
) {
  let inR = 0
  let inG = 0
  let inB = 0
  let inW = 0
  let outR = 0
  let outG = 0
  let outB = 0
  let outW = 0
  const w = source.width
  const h = source.height
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const p = ny * w + nx
      const i = p * 4
      if (source.data[i + 3] <= alphaThreshold) continue
      const weight = 1 / (1 + Math.hypot(dx, dy))
      if (maskData[p] > 127) {
        inR += source.data[i] * weight
        inG += source.data[i + 1] * weight
        inB += source.data[i + 2] * weight
        inW += weight
      } else {
        outR += source.data[i] * weight
        outG += source.data[i + 1] * weight
        outB += source.data[i + 2] * weight
        outW += weight
      }
    }
  }
  if (inW <= 0 || outW <= 0) return null
  return {
    inside: { r: inR / inW, g: inG / inW, b: inB / inW },
    outside: { r: outR / outW, g: outG / outW, b: outB / outW },
  }
}

function edgeAwareRefineMaskData(
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
  source: ImageData,
  radius: number,
  smartRadius: boolean,
) {
  if (source.width !== width || source.height !== height || radius <= 0) return new Uint8ClampedArray(maskData)
  const selected = new Uint8Array(width * height)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < selected.length; i++) {
    selected[i] = maskData[i] > 127 ? 1 : 0
    outside[i] = selected[i] ? 0 : 1
  }
  const distToSelected = distanceToFeature(selected, width, height)
  const distToOutside = distanceToFeature(outside, width, height)
  const edgeRadius = Math.max(1, Math.min(48, Math.round(radius)))
  const edgeRadiusSq = edgeRadius * edgeRadius
  const sampleRadius = Math.max(2, Math.min(8, Math.round(edgeRadius / 3) + 1))
  const out = new Uint8ClampedArray(maskData)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const edgeDistanceSq = Math.min(distToSelected[p], distToOutside[p])
      if (edgeDistanceSq > edgeRadiusSq) continue
      const i = p * 4
      if (source.data[i + 3] <= alphaThreshold) {
        out[p] = 0
        continue
      }
      const models = localMaskColorModels(source, maskData, x, y, sampleRadius)
      if (!models) continue
      const dInside = colorDistanceToAverage(source.data, i, models.inside)
      const dOutside = colorDistanceToAverage(source.data, i, models.outside)
      const gradient = localColorGradient(source.data, width, height, p)
      const edgeStrength = smartRadius ? clamp(gradient / 96, 0.2, 1) : 0.45
      const edgeWeight = clamp(1 - Math.sqrt(edgeDistanceSq) / Math.max(1, edgeRadius + 1), 0.15, 1)
      const margin = 4 + edgeStrength * 10
      const confidence = clamp(Math.abs(dOutside - dInside) / (dInside + dOutside + 1), 0, 1)
      if (dInside + margin < dOutside) {
        const alpha = clamp8(160 + 95 * confidence * edgeWeight * edgeStrength)
        out[p] = Math.max(out[p], alpha)
      } else if (dOutside + margin < dInside) {
        const remove = clamp(confidence * edgeWeight * (0.55 + edgeStrength * 0.45), 0, 1)
        out[p] = clamp8(out[p] * (1 - remove))
      }
    }
  }
  return out
}

export function refineSelectionMaskData(
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
  options: SelectionMaskRefinementOptions = {},
) {
  let next = new Uint8ClampedArray(maskData)
  const smoothRadius = Math.max(0, Math.round(options.smoothRadius ?? 0))
  if (smoothRadius > 0) next = smoothMaskDataPure(next, width, height, smoothRadius, alphaThreshold)

  const shiftEdge = options.shiftEdge ?? 0
  if (shiftEdge !== 0) {
    const edgeScale = Math.max(1, options.edgeRadius ?? 1)
    const shiftPixels = Math.round(Math.abs(shiftEdge) <= edgeScale ? shiftEdge : (shiftEdge / 100) * edgeScale)
    if (shiftPixels > 0) next = expandMaskDataPure(next, width, height, shiftPixels, alphaThreshold)
    if (shiftPixels < 0) next = contractMaskDataPure(next, width, height, Math.abs(shiftPixels), alphaThreshold)
  }

  if (options.sourceImage && (options.smartRadius || (options.edgeRadius ?? 0) > 0)) {
    next = edgeAwareRefineMaskData(next, width, height, options.sourceImage, options.edgeRadius ?? 1, !!options.smartRadius)
  }
  const hardBounds = maskDataBounds(next, width, height, 0)

  const featherRadius = Math.max(0, Math.round(options.featherRadius ?? 0))
  if (featherRadius > 0) next = featherMaskDataPure(next, width, height, featherRadius, alphaThreshold)

  next = applyMaskContrast(next, Math.max(0, options.contrast ?? 0))
  if (hardBounds) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < hardBounds.x || y < hardBounds.y || x >= hardBounds.x + hardBounds.w || y >= hardBounds.y + hardBounds.h) {
          next[y * width + x] = 0
        }
      }
    }
  }
  return { maskData: next, width, height, bounds: hardBounds }
}

export interface DecontaminateMaskOptions {
  amount?: number
  radius?: number
}

export function decontaminateImageDataWithMask(
  source: ImageData,
  maskData: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  options: DecontaminateMaskOptions = {},
) {
  const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  const amount = clamp(options.amount ?? 0.75, 0, 1)
  const radius = Math.max(1, Math.round(options.radius ?? 3))
  const sampleMask = (x: number, y: number) => {
    const sx = clamp(Math.round((x / Math.max(1, source.width - 1)) * Math.max(0, maskWidth - 1)), 0, maskWidth - 1)
    const sy = clamp(Math.round((y / Math.max(1, source.height - 1)) * Math.max(0, maskHeight - 1)), 0, maskHeight - 1)
    return maskData[sy * maskWidth + sx] ?? 0
  }

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const alpha = sampleMask(x, y)
      if (alpha <= 0 || alpha >= 255) continue
      let sr = 0
      let sg = 0
      let sb = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= source.width || ny >= source.height) continue
          if (sampleMask(nx, ny) < 245) continue
          const ni = (ny * source.width + nx) * 4
          sr += source.data[ni]
          sg += source.data[ni + 1]
          sb += source.data[ni + 2]
          count++
        }
      }
      if (!count) continue
      const i = (y * source.width + x) * 4
      const edgeWeight = amount * (1 - alpha / 255)
      out.data[i] = clamp8(source.data[i] * (1 - edgeWeight) + (sr / count) * edgeWeight)
      out.data[i + 1] = clamp8(source.data[i + 1] * (1 - edgeWeight) + (sg / count) * edgeWeight)
      out.data[i + 2] = clamp8(source.data[i + 2] * (1 - edgeWeight) + (sb / count) * edgeWeight)
    }
  }
  return out
}

export function edgeAwareQuickSelectionMask(src: HTMLCanvasElement, options: EdgeAwareQuickSelectionOptions = {}) {
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const result = buildEdgeAwareQuickSelectionMaskData(img, options)
  const mask = document.createElement("canvas")
  mask.width = src.width
  mask.height = src.height
  const out = mask.getContext("2d")!.createImageData(src.width, src.height)
  for (let i = 0; i < result.maskData.length; i++) {
    const di = i * 4
    out.data[di] = 255
    out.data[di + 1] = 255
    out.data[di + 2] = 255
    out.data[di + 3] = result.maskData[i]
  }
  mask.getContext("2d")!.putImageData(out, 0, 0)
  return mask
}

export function pathToPolyline(path: PathProps, curveSteps = 10): Point[] {
  const points: Point[] = []
  if (!path.points.length) return points
  const first = path.points[0]
  points.push({ x: first.x, y: first.y })
  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1]
    const curr = path.points[i]
    if (prev.cp2 || curr.cp1) {
      const c1 = prev.cp2 ?? prev
      const c2 = curr.cp1 ?? curr
      for (let step = 1; step <= curveSteps; step++) {
        const t = step / curveSteps
        points.push(cubic(prev, c1, c2, curr, t))
      }
    } else {
      points.push({ x: curr.x, y: curr.y })
    }
  }
  if (path.closed && points.length > 2) points.push({ ...points[0] })
  return points
}

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: mt ** 3 * a.x + 3 * mt ** 2 * t * b.x + 3 * mt * t ** 2 * c.x + t ** 3 * d.x,
    y: mt ** 3 * a.y + 3 * mt ** 2 * t * b.y + 3 * mt * t ** 2 * c.y + t ** 3 * d.y,
  }
}

export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((p) => ({ ...p }))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  simplifyRange(points, tolerance * tolerance, 0, points.length - 1, keep)
  return points.filter((_, index) => keep[index]).map((p) => ({ ...p }))
}

function simplifyRange(points: Point[], toleranceSq: number, start: number, end: number, keep: Uint8Array) {
  let best = -1
  let bestDistance = 0
  for (let i = start + 1; i < end; i++) {
    const distance = pointLineDistanceSq(points[i], points[start], points[end])
    if (distance > bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  if (best >= 0 && bestDistance > toleranceSq) {
    keep[best] = 1
    simplifyRange(points, toleranceSq, start, best, keep)
    simplifyRange(points, toleranceSq, best, end, keep)
  }
}

function pointLineDistanceSq(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1)
  const x = a.x + dx * t
  const y = a.y + dy * t
  return (p.x - x) ** 2 + (p.y - y) ** 2
}

export function offsetPolyline(points: Point[], amount: number, closed: boolean): Point[] {
  if (points.length < 2 || amount === 0) return points.map((p) => ({ ...p }))
  const count = closed ? points.length - (samePoint(points[0], points[points.length - 1]) ? 1 : 0) : points.length
  const base = points.slice(0, count)
  const out: Point[] = []
  for (let i = 0; i < base.length; i++) {
    const prev = base[closed ? (i - 1 + base.length) % base.length : Math.max(0, i - 1)]
    const curr = base[i]
    const next = base[closed ? (i + 1) % base.length : Math.min(base.length - 1, i + 1)]
    const n1 = segmentNormal(prev, curr)
    const n2 = segmentNormal(curr, next)
    const nx = n1.x + n2.x
    const ny = n1.y + n2.y
    const len = Math.hypot(nx, ny) || 1
    out.push({ x: curr.x + (nx / len) * amount, y: curr.y + (ny / len) * amount })
  }
  if (closed && out.length) out.push({ ...out[0] })
  return out
}

function samePoint(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}

function segmentNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: -dy / len, y: dx / len }
}

export function outlinePolyline(points: Point[], width: number, closed: boolean): Point[] {
  const half = Math.max(1, width / 2)
  const outer = offsetPolyline(points, half, closed)
  const inner = offsetPolyline(points, -half, closed).reverse()
  return [...outer, ...inner, outer[0]].filter(Boolean)
}

export function polylineToPath(points: Point[], closed = true): PathProps {
  return {
    points: points.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
    closed,
  }
}

export function shapeToMask(shape: ShapeProps, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.save()
  const rotation = shape.rotation ?? 0
  if (rotation) {
    const rcx = shape.x + shape.w / 2
    const rcy = shape.y + shape.h / 2
    ctx.translate(rcx, rcy)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.translate(-rcx, -rcy)
  }
  ctx.beginPath()
  if (shape.type === "ellipse") {
    ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.abs(shape.w) / 2, Math.abs(shape.h) / 2, 0, 0, Math.PI * 2)
  } else if (shape.type === "polygon" || shape.type === "star") {
    const isStar = shape.type === "star"
    const count = Math.max(3, (isStar ? (shape.starPoints ?? shape.sides ?? 5) : (shape.sides ?? 5)))
    const cx = shape.x + shape.w / 2
    const cy = shape.y + shape.h / 2
    const rx = Math.abs(shape.w) / 2
    const ry = Math.abs(shape.h) / 2
    const inner = Math.min(0.95, Math.max(0.05, shape.innerRadiusRatio ?? 0.45))
    const totalPts = isStar ? count * 2 : count
    for (let i = 0; i < totalPts; i++) {
      const ratio = isStar ? (i % 2 === 0 ? 1 : inner) : 1
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / totalPts
      const x = cx + Math.cos(a) * rx * ratio
      const y = cy + Math.sin(a) * ry * ratio
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else {
    const fallback = Math.max(0, shape.radius ?? 0)
    const cr = shape.cornerRadii ?? [fallback, fallback, fallback, fallback]
    roundedRectPathPerCorner(ctx, shape.x, shape.y, shape.w, shape.h, cr)
  }
  ctx.fill()
  ctx.restore()
  return canvas
}

function roundedRectPathPerCorner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
) {
  const halfW = Math.abs(w) / 2
  const halfH = Math.abs(h) / 2
  const tl = Math.min(Math.max(0, radii[0]), halfW, halfH)
  const tr = Math.min(Math.max(0, radii[1]), halfW, halfH)
  const br = Math.min(Math.max(0, radii[2]), halfW, halfH)
  const bl = Math.min(Math.max(0, radii[3]), halfW, halfH)
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    ctx.rect(x, y, w, h)
    return
  }
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr > 0) ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  if (br > 0) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  if (bl > 0) ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  if (tl > 0) ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

export function booleanMasks(a: HTMLCanvasElement, b: HTMLCanvasElement, operation: "unite" | "subtract" | "intersect" | "exclude") {
  const out = document.createElement("canvas")
  out.width = a.width
  out.height = a.height
  const ctx = out.getContext("2d")!
  ctx.drawImage(a, 0, 0)
  ctx.globalCompositeOperation =
    operation === "subtract" ? "destination-out" :
    operation === "intersect" ? "source-in" :
    operation === "exclude" ? "xor" :
    "source-over"
  ctx.drawImage(b, 0, 0)
  ctx.globalCompositeOperation = "source-over"
  return out
}

export function layerContentBounds(layer: Layer): Bounds | null {
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  let minX = layer.canvas.width
  let minY = layer.canvas.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function translateLayerCanvas(layer: Layer, dx: number, dy: number) {
  const tmp = document.createElement("canvas")
  tmp.width = layer.canvas.width
  tmp.height = layer.canvas.height
  tmp.getContext("2d")!.drawImage(layer.canvas, dx, dy)
  const ctx = layer.canvas.getContext("2d")!
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  ctx.drawImage(tmp, 0, 0)
  if (layer.shape) layer.shape = { ...layer.shape, x: layer.shape.x + dx, y: layer.shape.y + dy }
  if (layer.text) layer.text = { ...layer.text, x: layer.text.x + dx, y: layer.text.y + dy }
  if (layer.path) layer.path = { ...layer.path, points: layer.path.points.map((p) => translatePathPoint(p, dx, dy)) }
}

function translatePathPoint(point: PathPoint, dx: number, dy: number): PathPoint {
  return {
    ...point,
    x: point.x + dx,
    y: point.y + dy,
    cp1: point.cp1 ? { x: point.cp1.x + dx, y: point.cp1.y + dy } : undefined,
    cp2: point.cp2 ? { x: point.cp2.x + dx, y: point.cp2.y + dy } : undefined,
  }
}

export function autoAlignLayers(layers: Layer[], docWidth: number, docHeight: number, mode: "features" | "centers" | "edges" | "canvas-center") {
  if (mode === "features" && layers.length >= 2) {
    const images = layers.map((layer) => layer.canvas.getContext("2d")!.getImageData(0, 0, layer.canvas.width, layer.canvas.height))
    const radius = Math.max(8, Math.min(96, Math.round(Math.max(docWidth, docHeight) * 0.08)))
    const aligned = autoAlignImageStack(images, { searchRadius: radius, maxFeatures: 120 })
    for (let i = 1; i < layers.length; i++) {
      const placement = aligned.placements[i]
      if (!placement) continue
      translateLayerCanvas(layers[i], Math.round(placement.dx), Math.round(placement.dy))
    }
    return
  }

  const target =
    mode === "canvas-center"
      ? { cx: docWidth / 2, cy: docHeight / 2, left: 0, top: 0 }
      : (() => {
          const bounds = layers.map(layerContentBounds).filter(Boolean) as Bounds[]
          if (!bounds.length) return { cx: docWidth / 2, cy: docHeight / 2, left: 0, top: 0 }
          return {
            cx: bounds.reduce((sum, b) => sum + b.x + b.w / 2, 0) / bounds.length,
            cy: bounds.reduce((sum, b) => sum + b.y + b.h / 2, 0) / bounds.length,
            left: Math.min(...bounds.map((b) => b.x)),
            top: Math.min(...bounds.map((b) => b.y)),
          }
        })()
  for (const layer of layers) {
    const bounds = layerContentBounds(layer)
    if (!bounds) continue
    const dx = Math.round(mode === "edges" ? target.left - bounds.x : target.cx - (bounds.x + bounds.w / 2))
    const dy = Math.round(mode === "edges" ? target.top - bounds.y : target.cy - (bounds.y + bounds.h / 2))
    translateLayerCanvas(layer, dx, dy)
  }
}

export function featherLayerAlpha(layer: Layer, radius: number) {
  const ctx = layer.canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  const source = new Uint8ClampedArray(img.data)
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (source[i + 3] === 0) continue
      let minEdge = r
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = x + dx
          const sy = y + dy
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) {
            minEdge = Math.min(minEdge, Math.hypot(dx, dy))
            continue
          }
          if (source[(sy * img.width + sx) * 4 + 3] === 0) minEdge = Math.min(minEdge, Math.hypot(dx, dy))
        }
      }
      const k = clamp(minEdge / r, 0, 1)
      img.data[i + 3] = clamp8(source[i + 3] * (0.2 + k * 0.8))
    }
  }
  ctx.putImageData(img, 0, 0)
}

export interface ContentAwareScalePlan {
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
  widthSeams: number
  heightSeams: number
  widthFallbackPixels: number
  heightFallbackPixels: number
  quality: "full-seam" | "partial-seam-fallback" | "resample-only"
  message: string
}

function seamBudgetForAxis(axisSize: number, crossAxisSize: number, delta: number) {
  if (delta <= 0) return 0
  const dynamicBudget = Math.max(96, Math.floor(axisSize * 0.35), Math.floor(crossAxisSize * 0.9))
  return Math.min(delta, Math.min(384, dynamicBudget))
}

export function analyzeContentAwareScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ContentAwareScalePlan {
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round(targetHeight))
  const widthDelta = Math.max(0, Math.round(sourceWidth) - width)
  const heightDelta = Math.max(0, Math.round(sourceHeight) - height)
  const widthSeams = seamBudgetForAxis(sourceWidth, sourceHeight, widthDelta)
  const heightSeams = seamBudgetForAxis(sourceHeight, sourceWidth, heightDelta)
  const widthFallbackPixels = Math.max(0, widthDelta - widthSeams)
  const heightFallbackPixels = Math.max(0, heightDelta - heightSeams)
  const quality =
    widthDelta === 0 && heightDelta === 0
      ? "resample-only"
      : widthFallbackPixels > 0 || heightFallbackPixels > 0
        ? "partial-seam-fallback"
        : "full-seam"
  const message =
    quality === "partial-seam-fallback"
      ? `Removed ${widthSeams + heightSeams} low-energy seam(s); remaining ${widthFallbackPixels + heightFallbackPixels}px resized with smoothing.`
      : quality === "full-seam"
        ? `Removed ${widthSeams + heightSeams} low-energy seam(s) without resize fallback.`
        : "No seam removal needed; resized only if target grows."

  return {
    sourceWidth,
    sourceHeight,
    targetWidth: width,
    targetHeight: height,
    widthSeams,
    heightSeams,
    widthFallbackPixels,
    heightFallbackPixels,
    quality,
    message,
  }
}

export function contentAwareScaleCanvas(
  canvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  options?: {
    protectMask?: HTMLCanvasElement | ImageData | null
    removeMask?: HTMLCanvasElement | ImageData | null
  },
) {
  const plan = analyzeContentAwareScale(canvas.width, canvas.height, targetWidth, targetHeight)
  const width = plan.targetWidth
  const height = plan.targetHeight
  const source = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)

  const protectMask = options?.protectMask
    ? maskToUint8(options.protectMask, canvas.width, canvas.height)
    : undefined
  const removeMask = options?.removeMask
    ? maskToUint8(options.removeMask, canvas.width, canvas.height)
    : undefined

  const carved = seamCarveImageData(source, width, height, { protectMask, removeMask })
  const work = document.createElement("canvas")
  work.width = carved.image.width
  work.height = carved.image.height
  work.getContext("2d")!.putImageData(carved.image, 0, 0)
  return work
}

function maskToUint8(
  input: HTMLCanvasElement | ImageData,
  width: number,
  height: number,
): Uint8Array {
  const data: ImageData = input instanceof HTMLCanvasElement
    ? input.getContext("2d")!.getImageData(0, 0, input.width, input.height)
    : input
  const out = new Uint8Array(width * height)
  const srcW = data.width
  const srcH = data.height
  const sx = srcW / width
  const sy = srcH / height
  for (let y = 0; y < height; y++) {
    const yy = Math.min(srcH - 1, Math.floor(y * sy))
    for (let x = 0; x < width; x++) {
      const xx = Math.min(srcW - 1, Math.floor(x * sx))
      // Use alpha channel as the mask strength; fall back to luminance if
      // alpha is fully opaque so users can supply a B/W canvas mask.
      const i = (yy * srcW + xx) * 4
      const a = data.data[i + 3]
      if (a < 250) {
        out[y * width + x] = a
      } else {
        const lum = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]
        out[y * width + x] = lum > 16 ? Math.round(lum) : 0
      }
    }
  }
  return out
}

function copyCanvas(canvas: HTMLCanvasElement) {
  const out = document.createElement("canvas")
  out.width = canvas.width
  out.height = canvas.height
  out.getContext("2d")!.drawImage(canvas, 0, 0)
  return out
}

export function replaceColor(canvas: HTMLCanvasElement, target: string, replacement: string, tolerance: number, preserveLuminosity: boolean) {
  const targetRgb = hexToRgb(target)
  const replacementRgb = hexToRgb(replacement)
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const targetHsv = rgbToHsv(targetRgb.r, targetRgb.g, targetRgb.b)
  const replHsv = rgbToHsv(replacementRgb.r, replacementRgb.g, replacementRgb.b)
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const hsv = rgbToHsv(img.data[i], img.data[i + 1], img.data[i + 2])
    const hueDistance = Math.min(Math.abs(hsv.h - targetHsv.h), 360 - Math.abs(hsv.h - targetHsv.h))
    const colorDistance = hueDistance / 180 + Math.abs(hsv.s - targetHsv.s) + Math.abs(hsv.v - targetHsv.v) * 0.5
    if (colorDistance > tolerance / 100) continue
    const next = hsvToRgb(replHsv.h, replHsv.s, preserveLuminosity ? hsv.v : replHsv.v)
    img.data[i] = next.r
    img.data[i + 1] = next.g
    img.data[i + 2] = next.b
  }
  ctx.putImageData(img, 0, 0)
}

export function shiftChannels(canvas: HTMLCanvasElement, offsets: { r: Point; g: Point; b: Point }) {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const out = ctx.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      out.data[i] = sampleChannel(src, x - offsets.r.x, y - offsets.r.y, 0)
      out.data[i + 1] = sampleChannel(src, x - offsets.g.x, y - offsets.g.y, 1)
      out.data[i + 2] = sampleChannel(src, x - offsets.b.x, y - offsets.b.y, 2)
      out.data[i + 3] = src.data[i + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
}

function sampleChannel(img: ImageData, x: number, y: number, channel: number) {
  const sx = Math.round(((x % img.width) + img.width) % img.width)
  const sy = Math.round(((y % img.height) + img.height) % img.height)
  return img.data[(sy * img.width + sx) * 4 + channel]
}

export function channelMixer(canvas: HTMLCanvasElement, matrix: number[][], constant = 0) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    img.data[i] = clamp8(r * matrix[0][0] + g * matrix[0][1] + b * matrix[0][2] + constant)
    img.data[i + 1] = clamp8(r * matrix[1][0] + g * matrix[1][1] + b * matrix[1][2] + constant)
    img.data[i + 2] = clamp8(r * matrix[2][0] + g * matrix[2][1] + b * matrix[2][2] + constant)
  }
  ctx.putImageData(img, 0, 0)
}

export function gradientMap(canvas: HTMLCanvasElement, stops: ColorStop[]) {
  const normalized = stops.slice().sort((a, b) => a.offset - b.offset)
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) / 255
    const rgb = sampleStops(normalized, lum)
    img.data[i] = rgb.r
    img.data[i + 1] = rgb.g
    img.data[i + 2] = rgb.b
  }
  ctx.putImageData(img, 0, 0)
}

function sampleStops(stops: ColorStop[], t: number) {
  const first = stops[0] ?? { offset: 0, color: "#000000" }
  const last = stops[stops.length - 1] ?? { offset: 1, color: "#ffffff" }
  if (t <= first.offset) return hexToRgb(first.color)
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t <= b.offset) {
      const k = (t - a.offset) / Math.max(0.0001, b.offset - a.offset)
      const ca = hexToRgb(a.color)
      const cb = hexToRgb(b.color)
      return {
        r: clamp8(ca.r + (cb.r - ca.r) * k),
        g: clamp8(ca.g + (cb.g - ca.g) * k),
        b: clamp8(ca.b + (cb.b - ca.b) * k),
      }
    }
  }
  return hexToRgb(last.color)
}

export function transformSelectionMask(mask: HTMLCanvasElement, bounds: Bounds, scale: number, rotationDeg: number) {
  const out = document.createElement("canvas")
  out.width = mask.width
  out.height = mask.height
  const ctx = out.getContext("2d")!
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  ctx.translate(cx, cy)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)
  ctx.drawImage(mask, 0, 0)
  return out
}

export function connectedComponents(canvas: HTMLCanvasElement, threshold = 24, minArea = 24) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const visited = new Uint8Array(canvas.width * canvas.height)
  const components: { x: number; y: number; area: number; bounds: Bounds }[] = []
  const queue: number[] = []
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const start = y * canvas.width + x
      if (visited[start] || img.data[start * 4 + 3] <= threshold) continue
      visited[start] = 1
      queue.length = 0
      queue.push(start)
      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      let area = 0
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head]
        const px = p % canvas.width
        const py = (p - px) / canvas.width
        area++
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue
          const np = ny * canvas.width + nx
          if (visited[np] || img.data[np * 4 + 3] <= threshold) continue
          visited[np] = 1
          queue.push(np)
        }
      }
      if (area >= minArea) {
        components.push({
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          area,
          bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        })
      }
    }
  }
  return components.sort((a, b) => b.area - a.area)
}

export function motionBlur(canvas: HTMLCanvasElement, dx: number, dy: number, samples: number) {
  const copy = copyCanvas(canvas)
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const count = Math.max(2, Math.round(samples))
  ctx.globalAlpha = 1 / count
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0 : i / (count - 1) - 0.5
    ctx.drawImage(copy, dx * k, dy * k)
  }
  ctx.globalAlpha = 1
}

export function softProof(canvas: HTMLCanvasElement, profile: "cmyk" | "lab" | "srgb", gamutWarning = false) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const outOfGamut = chroma > 190 && max > 235
    if (gamutWarning && outOfGamut) {
      img.data[i] = 128
      img.data[i + 1] = 128
      img.data[i + 2] = 128
      continue
    }
    if (profile === "cmyk") {
      img.data[i] = clamp8(r * 0.92 + 8)
      img.data[i + 1] = clamp8(g * 0.9 + 6)
      img.data[i + 2] = clamp8(b * 0.86 + 4)
    } else if (profile === "lab") {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      img.data[i] = clamp8(lum + (r - lum) * 0.86)
      img.data[i + 1] = clamp8(lum + (g - lum) * 0.9)
      img.data[i + 2] = clamp8(lum + (b - lum) * 0.88)
    }
  }
  ctx.putImageData(img, 0, 0)
}

export function drawProceduralTexture(canvas: HTMLCanvasElement, mode: "noise" | "brick" | "cross-weave" | "clouds") {
  const ctx = canvas.getContext("2d")!
  const img = ctx.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      const n = pseudoNoise(x, y)
      if (mode === "brick") {
        const mortar = x % 96 < 3 || y % 42 < 3 || ((Math.floor(y / 42) % 2 ? x + 48 : x) % 96) < 3
        img.data[i] = mortar ? 210 : 140 + n * 45
        img.data[i + 1] = mortar ? 205 : 60 + n * 28
        img.data[i + 2] = mortar ? 195 : 42 + n * 18
      } else if (mode === "cross-weave") {
        const line = ((x + y) % 18 < 3) || ((x - y + 10000) % 18 < 3)
        img.data[i] = line ? 46 : 198 + n * 24
        img.data[i + 1] = line ? 62 : 204 + n * 18
        img.data[i + 2] = line ? 78 : 212 + n * 12
      } else if (mode === "clouds") {
        const v = 128 + 58 * Math.sin(x * 0.013 + n * 3) + 48 * Math.sin(y * 0.017 + n * 2)
        img.data[i] = clamp8(v * 0.82)
        img.data[i + 1] = clamp8(v * 0.92)
        img.data[i + 2] = clamp8(v * 1.08)
      } else {
        const v = clamp8(n * 255)
        img.data[i] = v
        img.data[i + 1] = v
        img.data[i + 2] = v
      }
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function pseudoNoise(x: number, y: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export function parseIccProfile(buffer: ArrayBuffer): IccProfileInfo {
  const view = new DataView(buffer)
  const text = (offset: number, length: number) => {
    let out = ""
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i) || 32)
    return out.trim()
  }
  const major = view.getUint8(8)
  const minor = view.getUint8(9) >> 4
  const createdAt = `${view.getUint16(24)}-${String(view.getUint16(26)).padStart(2, "0")}-${String(view.getUint16(28)).padStart(2, "0")} ${String(view.getUint16(30)).padStart(2, "0")}:${String(view.getUint16(32)).padStart(2, "0")}:${String(view.getUint16(34)).padStart(2, "0")}`
  return {
    size: view.getUint32(0),
    preferredCmm: text(4, 4),
    version: `${major}.${minor}`,
    deviceClass: text(12, 4),
    colorSpace: text(16, 4),
    pcs: text(20, 4),
    createdAt,
    signature: text(36, 4),
    platform: text(40, 4),
    renderingIntent: view.getUint32(64),
  }
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: clamp8((r + m) * 255), g: clamp8((g + m) * 255), b: clamp8((b + m) * 255) }
}
