import {
  parseFieldBlurPins,
  parsePathBlurPoints,
} from "../blur-gallery-controls"
import {
  boxBlur,
  findEdges,
  gaussianBlur,
  motionBlur,
} from "./basic-algorithms"
import {
  pseudoDither,
} from "./curve-helpers"
import {
  bilinearSample,
  distanceToSegment,
} from "./distortion-algorithms"
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  luma,
} from "./pixel-helpers"
import {
  hashNoise,
  mixBlurredByWeight,
} from "./helpers-shared"

export interface LensBlurExtras {
  depthSource?: ImageData | null
  depthChannel?: "luminance" | "red" | "green" | "blue" | "alpha"
  depthFocus?: number   // 0..255 — pixel depth values matching this stay sharp
  depthBlurScale?: number // 0..100 — how strongly off-focus depths get blurred
  depthInvert?: boolean
  shape?: "hexagon" | "pentagon" | "octagon" | "circle" | "triangle" | "square"
}

export function extractDepthValue(depth: ImageData, x: number, y: number, channel: string, invert: boolean): number {
  const sx = (x / Math.max(1, x)) // satisfy lint when called with single coords
  void sx
  const dw = depth.width, dh = depth.height
  // For now nearest-neighbor index since callers pass integer coords matched to src size already.
  const ix = Math.max(0, Math.min(dw - 1, Math.round(x)))
  const iy = Math.max(0, Math.min(dh - 1, Math.round(y)))
  const idx = (iy * dw + ix) * 4
  const r = depth.data[idx], g = depth.data[idx + 1], b = depth.data[idx + 2], a = depth.data[idx + 3]
  let v: number
  switch (channel) {
    case "red":   v = r; break
    case "green": v = g; break
    case "blue":  v = b; break
    case "alpha": v = a; break
    default:      v = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return invert ? 255 - v : v
}

export function buildIrisOffsets(r: number, blades: number, rotation: number, shape: string): number[] {
  const offsets: number[] = []
  const rotRad = rotation * Math.PI / 180
  const halfSeg = Math.PI / blades
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky)
      if (dist > r) continue
      if (shape === "circle") {
        offsets.push(kx, ky)
        continue
      }
      if (shape === "square") {
        if (Math.abs(kx) <= r && Math.abs(ky) <= r) offsets.push(kx, ky)
        continue
      }
      // Polygon shape — number of sides derived from the requested shape, with
      // bladeCount acting as a secondary modifier (e.g., hexagon = 6 sides).
      let sides = blades
      if (shape === "triangle") sides = 3
      else if (shape === "pentagon") sides = 5
      else if (shape === "hexagon") sides = 6
      else if (shape === "octagon") sides = 8
      const angle = Math.atan2(ky, kx) - rotRad
      const segment = 2 * Math.PI / sides
      const localAngle = ((angle % segment) + segment) % segment - segment / 2
      const polyRadius = r * Math.cos(segment / 2) / Math.max(0.001, Math.cos(localAngle))
      if (dist <= polyRadius) offsets.push(kx, ky)
      void halfSeg
    }
  }
  return offsets
}

export function lensBlurDefault(
  src: ImageData,
  radius: number,
  bladeCount: number,
  rotation: number,
  specBright: number,
  specThreshold: number,
  noiseAmt: number,
  noiseMono: boolean,
): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(40, Math.round(radius)))
  const blades = Math.max(3, Math.min(8, Math.round(bladeCount)))
  const rot = (rotation * Math.PI) / 180
  const kernel: Array<[number, number]> = []
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky)
      if (dist > r) continue
      const angle = Math.atan2(ky, kx) - rot
      const segment = (2 * Math.PI) / blades
      const local = ((angle % segment) + segment) % segment
      const polyRadius = r / Math.max(0.2, Math.cos(Math.PI / blades - local))
      if (dist <= Math.abs(polyRadius)) kernel.push([kx, ky])
    }
  }
  const specK = Math.max(0, specBright) / 100
  const specT = Math.max(0, Math.min(255, specThreshold))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, ws = 0
      for (const [kx, ky] of kernel) {
        const sx = x + kx < 0 ? 0 : x + kx >= w ? w - 1 : x + kx
        const sy = y + ky < 0 ? 0 : y + ky >= h ? h - 1 : y + ky
        const p = (sy * w + sx) * 4
        let weight = 1
        const lum = Math.max(src.data[p], src.data[p + 1], src.data[p + 2])
        if (specK > 0 && lum > specT) weight = 1 + ((lum - specT) / 255) * specK * 4
        rs += src.data[p] * weight
        gs += src.data[p + 1] * weight
        bs += src.data[p + 2] * weight
        as_ += src.data[p + 3] * weight
        ws += weight
      }
      const i = (y * w + x) * 4
      out[i] = rs / ws
      out[i + 1] = gs / ws
      out[i + 2] = bs / ws
      out[i + 3] = as_ / ws
    }
  }
  if (noiseAmt > 0) {
    const amp = noiseAmt * 2.55
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (noiseMono) {
          const n = (hashNoise(x, y, 211) - 0.5) * amp
          out[i] = clamp8(out[i] + n)
          out[i + 1] = clamp8(out[i + 1] + n)
          out[i + 2] = clamp8(out[i + 2] + n)
        } else {
          out[i] = clamp8(out[i] + (hashNoise(x, y, 211) - 0.5) * amp)
          out[i + 1] = clamp8(out[i + 1] + (hashNoise(x, y, 307) - 0.5) * amp)
          out[i + 2] = clamp8(out[i + 2] + (hashNoise(x, y, 401) - 0.5) * amp)
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

export function lensBlur(src: ImageData, radius: number, bladeCount: number, rotation: number, specBright: number, specThreshold: number, noiseAmt: number, noiseMono: boolean, extras: LensBlurExtras = {}): ImageData {
  if (radius < 1 && !(extras.depthSource && (extras.depthBlurScale ?? 0) > 0)) return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const w = src.width, h = src.height
  const baseR = Math.max(1, Math.min(40, Math.round(Math.max(1, radius))))
  const blades = Math.max(3, Math.min(8, Math.round(bladeCount)))
  const shape = extras.shape ?? "hexagon"

  const depthSrc = extras.depthSource ?? null
  const depthChannel = extras.depthChannel ?? "luminance"
  const depthFocus = Math.max(0, Math.min(255, extras.depthFocus ?? 128))
  const depthScale = Math.max(0, Math.min(100, extras.depthBlurScale ?? 0)) / 100
  const depthInvert = Boolean(extras.depthInvert)

  if (!depthSrc && depthScale <= 0 && shape === "hexagon") {
    return lensBlurDefault(src, baseR, blades, rotation, specBright, specThreshold, noiseAmt, noiseMono)
  }

  // Precompute per-pixel radius when a depth map is supplied. The pixel's
  // distance from the focus value scales the blur radius — pixels at the focus
  // value stay sharp, pixels at max distance receive the full configured radius.
  let depthRadius: Uint8Array | null = null
  let maxR = baseR
  if (depthSrc && depthScale > 0) {
    depthRadius = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Sample depth map. If depth dims differ, scale linearly.
        const dx = depthSrc.width === w ? x : Math.round((x / Math.max(1, w - 1)) * (depthSrc.width - 1))
        const dy = depthSrc.height === h ? y : Math.round((y / Math.max(1, h - 1)) * (depthSrc.height - 1))
        const v = extractDepthValue(depthSrc, dx, dy, depthChannel, depthInvert)
        const dist = Math.abs(v - depthFocus) / 255
        const pr = Math.max(0, Math.min(baseR, Math.round(baseR * dist * depthScale * 2)))
        depthRadius[y * w + x] = pr
        if (pr > maxR) maxR = pr
      }
    }
  }

  // Build a stack of iris kernels for each radius we may need. Without depth,
  // we only need a single kernel at baseR. With depth, we lazily build a
  // dictionary keyed by radius and reuse it across pixels.
  const kernelCache = new Map<number, number[]>()
  const baseOffsets = buildIrisOffsets(baseR, blades, rotation, shape)
  kernelCache.set(baseR, baseOffsets)
  if (!baseOffsets.length) return new ImageData(new Uint8ClampedArray(src.data), w, h)

  // Pre-convert source to linear-light squared values for gamma-correct averaging.
  const linR = new Float32Array(w * h)
  const linG = new Float32Array(w * h)
  const linB = new Float32Array(w * h)
  const specMap = new Float32Array(w * h) // extra multiplier for bright specs
  const specK = Math.max(0, specBright) / 100
  const specT = Math.max(0, Math.min(255, specThreshold))
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      const rr = src.data[i] / 255, gg = src.data[i + 1] / 255, bb = src.data[i + 2] / 255
      linR[py * w + px] = rr * rr
      linG[py * w + px] = gg * gg
      linB[py * w + px] = bb * bb
      const lum = Math.max(src.data[i], src.data[i + 1], src.data[i + 2])
      let m = 1
      if (specK > 0 && lum > specT) {
        // Boost is proportional to how far above threshold the pixel is.
        m = 1 + ((lum - specT) / Math.max(1, 255 - specT)) * specK * 6
      }
      specMap[py * w + px] = m
    }
  }

  function getKernel(rr: number): number[] {
    const cached = kernelCache.get(rr)
    if (cached) return cached
    const built = buildIrisOffsets(rr, blades, rotation, shape)
    kernelCache.set(rr, built)
    return built
  }

  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const localR = depthRadius ? depthRadius[y * w + x] : baseR
      if (localR < 1) {
        // No blur for this pixel — copy source directly.
        const idx = (y * w + x) * 4
        out[idx]     = src.data[idx]
        out[idx + 1] = src.data[idx + 1]
        out[idx + 2] = src.data[idx + 2]
        out[idx + 3] = src.data[idx + 3]
        continue
      }
      const offsets = getKernel(localR)
      const kCount = offsets.length / 2
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, wSum = 0
      for (let k = 0; k < kCount; k++) {
        const ox = offsets[k * 2], oy = offsets[k * 2 + 1]
        const sx = x + ox < 0 ? 0 : x + ox >= w ? w - 1 : x + ox
        const sy = y + oy < 0 ? 0 : y + oy >= h ? h - 1 : y + oy
        const sIdx = sy * w + sx
        const weight = specMap[sIdx]
        rSum += linR[sIdx] * weight
        gSum += linG[sIdx] * weight
        bSum += linB[sIdx] * weight
        aSum += src.data[sIdx * 4 + 3] * weight
        wSum += weight
      }
      const idx = (y * w + x) * 4
      // sqrt back to gamma-encoded display space
      out[idx] = clamp8(Math.sqrt(rSum / wSum) * 255)
      out[idx + 1] = clamp8(Math.sqrt(gSum / wSum) * 255)
      out[idx + 2] = clamp8(Math.sqrt(bSum / wSum) * 255)
      out[idx + 3] = clamp8(aSum / wSum)
    }
  }
  void maxR

  if (noiseAmt > 0) {
    const amp = noiseAmt * 2.55
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (noiseMono) {
          const n = (hashNoise(x, y, 211) - 0.5) * amp
          out[i] = clamp8(out[i] + n)
          out[i + 1] = clamp8(out[i + 1] + n)
          out[i + 2] = clamp8(out[i + 2] + n)
        } else {
          out[i] = clamp8(out[i] + (hashNoise(x, y, 211) - 0.5) * amp)
          out[i + 1] = clamp8(out[i + 1] + (hashNoise(x, y, 307) - 0.5) * amp)
          out[i + 2] = clamp8(out[i + 2] + (hashNoise(x, y, 401) - 0.5) * amp)
        }
      }
    }
  }

  return new ImageData(out, w, h)
}

export function surfaceBlur(src: ImageData, radius: number, threshold: number): ImageData {
  if (radius <= 0 || threshold <= 0) return clone(src)
  const w = src.width, h = src.height
  const r = Math.max(1, Math.min(18, Math.round(radius)))
  const t = Math.max(0, Math.min(255, threshold))

  const sigmaS = Math.max(0.75, r * 0.645)
  const sigmaR = Math.max(1, t * 0.55375)
  const twoSigmaS2 = 2 * sigmaS * sigmaS
  const twoSigmaR2 = 2 * sigmaR * sigmaR
  const r2 = r * r
  const spatial = new Float32Array((2 * r + 1) * (2 * r + 1))
  const offsets: number[] = []
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const d2 = ox * ox + oy * oy
      if (d2 > r2) continue
      spatial[(oy + r) * (2 * r + 1) + (ox + r)] = Math.exp(-d2 / twoSigmaS2)
      offsets.push(ox, oy)
    }
  }

  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const baseLum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let rs = 0, gs = 0, bs = 0, as_ = 0, wSum = 0
      for (let k = 0; k < offsets.length; k += 2) {
        const ox = offsets[k], oy = offsets[k + 1]
        const sx = x + ox < 0 ? 0 : x + ox >= w ? w - 1 : x + ox
        const sy = y + oy < 0 ? 0 : y + oy >= h ? h - 1 : y + oy
        const p = (sy * w + sx) * 4
        const diff = Math.abs(luma(src.data[p], src.data[p + 1], src.data[p + 2]) - baseLum)
        if (diff >= t) continue
        const sp = spatial[(oy + r) * (2 * r + 1) + (ox + r)]
        const range = Math.exp(-(diff * diff) / twoSigmaR2)
        const weight = sp * range
        rs += src.data[p] * weight
        gs += src.data[p + 1] * weight
        bs += src.data[p + 2] * weight
        as_ += src.data[p + 3] * weight
        wSum += weight
      }
      if (wSum > 0) {
        out[i] = rs / wSum
        out[i + 1] = gs / wSum
        out[i + 2] = bs / wSum
        out[i + 3] = as_ / wSum
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]; out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export function radialBlur(src: ImageData, amount: number, method: string, quality: string, centerX = 50, centerY = 50): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = clamp01(centerX / 100) * (w - 1)
  const cy = clamp01(centerY / 100) * (h - 1)
  const strength = Math.max(0, Math.min(100, amount)) / 100
  if (strength <= 0) return new ImageData(new Uint8ClampedArray(src.data), w, h)
  const steps = quality === "best" ? 48 : quality === "good" ? 24 : 12
  // Scale spin angle with image diagonal so far pixels travel a constant arc length,
  // which is what Photoshop's spin blur does (constant pixel velocity).
  const diag = Math.hypot(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.hypot(dx, dy)
      let rs = 0, gs = 0, bs = 0, as_ = 0, wSum = 0
      for (let s = 0; s < steps; s++) {
        // Tent weight peaks at the center sample for natural smooth falloff.
        const stepWeight = 1 - Math.abs((s / Math.max(1, steps - 1)) - 0.5) * 2
        const jitter = quality === "best" ? (pseudoDither(y * w + x + s * 17) - 0.5) / steps : 0
        const t = (s / Math.max(1, steps - 1) - 0.5 + jitter) * strength
        let sx = x, sy = y
        if (method === "zoom") {
          const scale = 1 + t * 1.3
          sx = cx + dx * scale
          sy = cy + dy * scale
        } else {
          // spin — angular sweep proportional to (amount / dist) so arc length is
          // bounded by the diagonal-scaled spin radius
          const arc = t * (diag * 0.5) / Math.max(8, dist)
          const cos = Math.cos(arc), sin = Math.sin(arc)
          sx = cx + dx * cos - dy * sin
          sy = cy + dx * sin + dy * cos
        }
        const sample = bilinearSample(src.data, w, h, sx, sy)
        rs += sample[0] * stepWeight
        gs += sample[1] * stepWeight
        bs += sample[2] * stepWeight
        as_ += sample[3] * stepWeight
        wSum += stepWeight
      }
      const i = (y * w + x) * 4
      out[i] = rs / wSum; out[i + 1] = gs / wSum; out[i + 2] = bs / wSum; out[i + 3] = as_ / wSum
    }
  }
  return new ImageData(out, w, h)
}

export function fieldBlur(src: ImageData, blur: number, centerX: number, centerY: number, falloff: number, pinsSpec = "") {
  const pins = parseFieldBlurPins(pinsSpec)
  if (pins.length > 0) {
    const maxBlur = Math.max(0, blur, ...pins.map((pin) => pin.blur))
    if (maxBlur <= 0) return clone(src)
    const blurred = boxBlur(src, Math.max(1, maxBlur))
    return mixBlurredByWeight(src, blurred, (x, y) => {
      const px = (x / Math.max(1, src.width - 1)) * 100
      const py = (y / Math.max(1, src.height - 1)) * 100
      let weightedBlur = 0
      let totalWeight = 0
      for (const pin of pins) {
        const dx = ((px - pin.x) / 100) * src.width
        const dy = ((py - pin.y) / 100) * src.height
        const d2 = dx * dx + dy * dy
        if (d2 < 0.25) return pin.blur / maxBlur
        const weight = 1 / Math.max(1, d2)
        weightedBlur += pin.blur * weight
        totalWeight += weight
      }
      return totalWeight > 0 ? weightedBlur / totalWeight / maxBlur : 0
    })
  }

  const blurred = boxBlur(src, Math.max(1, blur))
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const maxDistance = Math.hypot(Math.max(cx, src.width - cx), Math.max(cy, src.height - cy)) || 1
  const keepRadius = maxDistance * clamp01((100 - falloff) / 140)
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.max(0, Math.hypot(x - cx, y - cy) - keepRadius)
    return d / Math.max(1, maxDistance - keepRadius)
  })
}

export function irisBlur(
  src: ImageData,
  blur: number,
  centerX: number,
  centerY: number,
  radius: number,
  feather: number,
  ellipseWidth = radius,
  ellipseHeight = radius,
  rotation = 0,
) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const rx = Math.max(1, src.width * (ellipseWidth / 100) * 0.5)
  const ry = Math.max(1, src.height * (ellipseHeight / 100) * 0.5)
  const radians = -rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const featherWidth = Math.max(0.01, feather / 100)
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const localX = dx * cos - dy * sin
    const localY = dx * sin + dy * cos
    const d = Math.hypot(localX / rx, localY / ry)
    return (d - 1) / featherWidth
  })
}

export function tiltShiftBlur(src: ImageData, blur: number, angle: number, radius: number, feather: number, centerX = 50, centerY = 50) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const radians = (angle * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const clearBand = Math.max(1, Math.min(src.width, src.height) * (radius / 100) * 0.5)
  const featherBand = Math.max(1, Math.min(src.width, src.height) * (feather / 100))
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.abs((x - cx) * nx + (y - cy) * ny)
    return (d - clearBand) / featherBand
  })
}

export function pathBlur(src: ImageData, distance: number, angle: number, taper: number, pathSpec = "") {
  const hasPath = pathSpec.trim().length > 0
  const points = hasPath ? parsePathBlurPoints(pathSpec) : []
  const pathAngle = hasPath && points.length >= 2 ? angleFromPathPoints(points, src.width, src.height) : angle
  const blurred = motionBlur(src, Math.max(1, distance), Number.isFinite(pathAngle) ? pathAngle : angle)
  const taperAmount = clamp01(taper / 100)
  if (hasPath && points.length >= 2) {
    const canvasPoints = points.map((point) => ({
      x: (point.x / 100) * Math.max(1, src.width - 1),
      y: (point.y / 100) * Math.max(1, src.height - 1),
    }))
    const influenceBand = Math.max(8, Math.min(src.width, src.height) * 0.18)
    return mixBlurredByWeight(src, blurred, (x, y) => {
      const nearest = distanceToPolyline({ x, y }, canvasPoints)
      const pathWeight = 1 - clamp01(nearest / influenceBand)
      if (taperAmount <= 0) return pathWeight
      const edge = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
      const edgeWeight = 1 - clamp01(edge / Math.max(1, Math.min(src.width, src.height) * 0.5) * taperAmount)
      return Math.max(pathWeight, edgeWeight * 0.35)
    })
  }
  if (taperAmount <= 0) return blurred
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const edge = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
    return 1 - clamp01(edge / (Math.min(src.width, src.height) * 0.5) * taperAmount)
  })
}

export function spinBlur(src: ImageData, amount: number, centerX: number, centerY: number, radius = 100) {
  const shifted = radialBlur(src, Math.max(1, amount), "spin", "best", centerX, centerY)
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const radiusPx = Math.max(1, Math.min(src.width, src.height) * clamp01(radius / 100) * 0.5)
  const featherPx = Math.max(2, radiusPx * 0.2)
  return mixBlurredByWeight(src, shifted, (x, y) => 1 - clamp01((Math.hypot(x - cx, y - cy) - radiusPx) / featherPx))
}

export function angleFromPathPoints(points: { x: number; y: number }[], width: number, height: number) {
  const first = points[0]
  const last = points[points.length - 1]
  const dx = ((last.x - first.x) / 100) * width
  const dy = ((last.y - first.y) / 100) * height
  return Math.atan2(dy, dx) * 180 / Math.PI
}

export function distanceToPolyline(point: { x: number; y: number }, points: { x: number; y: number }[]) {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(point, points[i], points[i + 1]))
  }
  return best
}

/* ------------------------- lens profile presets -------------------------- */
export function averageBlur(src: ImageData): ImageData {
  let r = 0, g = 0, b = 0, a = 0, count = 0
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = src.data[i + 3] / 255
    if (alpha <= 0) continue
    r += src.data[i] * alpha
    g += src.data[i + 1] * alpha
    b += src.data[i + 2] * alpha
    a += src.data[i + 3]
    count += alpha
  }
  const out = new Uint8ClampedArray(src.data.length)
  const rr = count ? r / count : 0
  const gg = count ? g / count : 0
  const bb = count ? b / count : 0
  const aa = src.data.length ? a / (src.data.length / 4) : 255
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rr
    out[i + 1] = gg
    out[i + 2] = bb
    out[i + 3] = aa
  }
  return new ImageData(out, src.width, src.height)
}

export function smartBlur(src: ImageData, radius: number, threshold: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const keep = edges.data[i] > threshold
    out[i] = keep ? src.data[i] : blurred.data[i]
    out[i + 1] = keep ? src.data[i + 1] : blurred.data[i + 1]
    out[i + 2] = keep ? src.data[i + 2] : blurred.data[i + 2]
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function shapeBlur(src: ImageData, radius: number, shape: string): ImageData {
  if (radius <= 0) return clone(src)
  const out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const inside = shape === "diamond" ? Math.abs(dx) + Math.abs(dy) <= r : shape === "line" ? Math.abs(dy) <= 1 : dx * dx + dy * dy <= r * r
          if (!inside) continue
          const sx = Math.max(0, Math.min(src.width - 1, x + dx))
          const sy = Math.max(0, Math.min(src.height - 1, y + dy))
          const i = (sy * src.width + sx) * 4
          rs += src.data[i]; gs += src.data[i + 1]; bs += src.data[i + 2]; as_ += src.data[i + 3]; n++
        }
      }
      const o = (y * src.width + x) * 4
      out[o] = rs / n; out[o + 1] = gs / n; out[o + 2] = bs / n; out[o + 3] = as_ / n
    }
  }
  return new ImageData(out, src.width, src.height)
}

