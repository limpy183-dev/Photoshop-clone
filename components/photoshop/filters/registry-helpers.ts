/**
 * Pixel-level filter implementations. Each `apply(src, params)` returns a
 * NEW ImageData with the filter applied. Source is not mutated, so callers
 * can use the same ImageData for live previews across many parameter changes.
 */

import { hexToRgb as hexToRgbFilter } from "../color-utils"
import { parseFieldBlurPins, parsePathBlurPoints } from "../blur-gallery-controls"
import {
  boxBlur,
  brightnessContrast,
  convolve,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "./basic-algorithms"
import type { FilterDef } from "./contracts"
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
} from "./pixel-helpers"
import {
  parseCurvePoints,
  pseudoDither,
} from "./curve-helpers"
import {
  channelMixer,
  desaturate,
  equalize,
  exposure,
  grayscale,
  hdrToning,
  hueSaturation,
  invert,
  levels,
  parseReplaceColorSamples,
  photoFilter,
  posterize,
  replaceColor,
  selectiveColor,
  sepia,
  shadowsHighlights,
  threshold,
  type HueRange,
} from "./adjustment-algorithms"
import {
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
} from "./advanced-adjustment-algorithms"
import {
  adaptiveWideAngle,
  bilinearSample,
  distanceToSegment,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
} from "./distortion-algorithms"
import {
  fbmNoise,
  renderClouds,
  renderFibers,
  renderLensFlare,
  skyReplacement,
} from "./render-algorithms"

/* ====================== OTHER FILTERS ================================== */

export function filterHighPass(src: ImageData, radius: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8((src.data[i] - blurred.data[i]) + 128)
    out[i + 1] = clamp8((src.data[i + 1] - blurred.data[i + 1]) + 128)
    out[i + 2] = clamp8((src.data[i + 2] - blurred.data[i + 2]) + 128)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function filterOffset(src: ImageData, dx: number, dy: number, edgeMode: string, fillR = 255, fillG = 255, fillB = 255): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const dxi = Math.round(dx), dyi = Math.round(dy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x - dxi, sy = y - dyi
      const oi = (y * w + x) * 4
      if (edgeMode === "wrap") {
        sx = ((sx % w) + w) % w
        sy = ((sy % h) + h) % h
      } else if (edgeMode === "repeat") {
        sx = Math.max(0, Math.min(w - 1, sx))
        sy = Math.max(0, Math.min(h - 1, sy))
      } else if (edgeMode === "background") {
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
          out[oi] = fillR; out[oi + 1] = fillG; out[oi + 2] = fillB; out[oi + 3] = 255
          continue
        }
      } else {
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
          out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; out[oi + 3] = 0
          continue
        }
      }
      const si = (sy * w + sx) * 4
      out[oi] = src.data[si]; out[oi + 1] = src.data[si + 1]
      out[oi + 2] = src.data[si + 2]; out[oi + 3] = src.data[si + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function filterMaxMin(src: ImageData, radius: number, isMax: boolean): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const r = Math.max(1, Math.floor(radius))
  // Horizontal pass
  const tmp = new Uint8ClampedArray(out.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = isMax ? 0 : 255
      let br = 0, bg = 0, bb = 0, ba = 0
      for (let k = -r; k <= r; k++) {
        const sx = Math.max(0, Math.min(w - 1, x + k))
        const si = (y * w + sx) * 4
        const lum = out[si] * 0.3 + out[si + 1] * 0.6 + out[si + 2] * 0.1
        if (isMax ? lum > best : lum < best) {
          best = lum; br = out[si]; bg = out[si + 1]; bb = out[si + 2]; ba = out[si + 3]
        }
      }
      const oi = (y * w + x) * 4
      tmp[oi] = br; tmp[oi + 1] = bg; tmp[oi + 2] = bb; tmp[oi + 3] = ba
    }
  }
  // Vertical pass
  const tmp2 = new Uint8ClampedArray(tmp.length)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let best = isMax ? 0 : 255
      let br = 0, bg = 0, bb = 0, ba = 0
      for (let k = -r; k <= r; k++) {
        const sy = Math.max(0, Math.min(h - 1, y + k))
        const si = (sy * w + x) * 4
        const lum = tmp[si] * 0.3 + tmp[si + 1] * 0.6 + tmp[si + 2] * 0.1
        if (isMax ? lum > best : lum < best) {
          best = lum; br = tmp[si]; bg = tmp[si + 1]; bb = tmp[si + 2]; ba = tmp[si + 3]
        }
      }
      const oi = (y * w + x) * 4
      tmp2[oi] = br; tmp2[oi + 1] = bg; tmp2[oi + 2] = bb; tmp2[oi + 3] = ba
    }
  }
  return new ImageData(tmp2, w, h)
}

/* --------- SMART SHARPEN --------- */

export interface SmartSharpenExtras {
  remove?: "gaussian" | "lens" | "motion"
  motionAngle?: number
  moreAccurate?: boolean
  shadowTonalWidth?: number
  shadowRadius?: number
  highlightTonalWidth?: number
  highlightRadius?: number
}

export function smartSharpenBlurSource(src: ImageData, radius: number, extras: SmartSharpenExtras) {
  const r = Math.max(0.5, radius)
  const remove = extras.remove ?? "gaussian"
  if (remove === "motion") {
    return motionBlur(src, Math.max(1, r * (extras.moreAccurate ? 4 : 2)), extras.motionAngle ?? 0)
  }
  if (remove === "lens") {
    return lensBlur(src, Math.max(1, r), 6, 0, 0, 255, 0, true, { shape: "circle" })
  }
  return extras.moreAccurate ? gaussianBlur(gaussianBlur(src, r), Math.max(0.5, r * 0.35)) : gaussianBlur(src, r)
}

export function tonalFadeForSmartSharpen(
  lum: number,
  shadowFade: number,
  highlightFade: number,
  extras: SmartSharpenExtras,
) {
  let fade = 1
  const shadowAmount = Math.max(0, Math.min(100, shadowFade)) / 100
  const highlightAmount = Math.max(0, Math.min(100, highlightFade)) / 100

  if (shadowAmount > 0) {
    const tonalWidth = Math.max(1, Math.min(100, extras.shadowTonalWidth ?? 25)) / 100
    const tonalLimit = Math.max(1, 255 * tonalWidth)
    const radiusBoost = 1 + Math.max(0, Math.min(250, extras.shadowRadius ?? 0)) / 250
    const influence = Math.min(1, Math.max(0, 1 - lum / tonalLimit) * radiusBoost)
    fade *= 1 - shadowAmount * influence
  }

  if (highlightAmount > 0) {
    const tonalWidth = Math.max(1, Math.min(100, extras.highlightTonalWidth ?? 25)) / 100
    const tonalLimit = Math.max(1, 255 * tonalWidth)
    const radiusBoost = 1 + Math.max(0, Math.min(250, extras.highlightRadius ?? 0)) / 250
    const influence = Math.min(1, Math.max(0, 1 - (255 - lum) / tonalLimit) * radiusBoost)
    fade *= 1 - highlightAmount * influence
  }

  return Math.max(0, Math.min(1, fade))
}

export function smartSharpen(
  src: ImageData,
  amount: number,
  radius: number,
  threshold: number,
  shadowFade: number,
  highlightFade: number,
  extras: SmartSharpenExtras = {},
): ImageData {
  const blurred = smartSharpenBlurSource(src, radius, extras)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const k = amount / 100

  for (let i = 0; i < src.data.length; i += 4) {
    const lum = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]
    // Edge magnitude (difference from blur)
    const edgeMag = Math.abs(src.data[i] - blurred.data[i]) +
                    Math.abs(src.data[i + 1] - blurred.data[i + 1]) +
                    Math.abs(src.data[i + 2] - blurred.data[i + 2])

    // Threshold: only sharpen if edge magnitude exceeds threshold
    if (edgeMag / 3 < threshold) {
      out[i] = src.data[i]; out[i + 1] = src.data[i + 1]; out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      continue
    }

    const fade = tonalFadeForSmartSharpen(lum, shadowFade, highlightFade, extras)

    const effectiveK = k * fade
    for (let c = 0; c < 3; c++) {
      const diff = src.data[i + c] - blurred.data[i + c]
      out[i + c] = clamp8(src.data[i + c] + diff * effectiveK)
    }
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, w, h)
}

/* --------- LENS BLUR --------- */

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

export function oilPaint(src: ImageData, radius: number, levels: number, shine: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(8, Math.round(radius)))
  const buckets = Math.max(4, Math.min(32, Math.round(levels)))
  const gloss = Math.max(0, Math.min(100, shine)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const count = new Array<number>(buckets).fill(0)
      const rs = new Array<number>(buckets).fill(0)
      const gs = new Array<number>(buckets).fill(0)
      const bs = new Array<number>(buckets).fill(0)
      const as = new Array<number>(buckets).fill(0)
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(h - 1, y + oy))
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue
          const sx = Math.max(0, Math.min(w - 1, x + ox))
          const p = (sy * w + sx) * 4
          const b = Math.min(buckets - 1, Math.floor((luma(src.data[p], src.data[p + 1], src.data[p + 2]) / 256) * buckets))
          count[b]++
          rs[b] += src.data[p]; gs[b] += src.data[p + 1]; bs[b] += src.data[p + 2]; as[b] += src.data[p + 3]
        }
      }
      let best = 0
      for (let b = 1; b < buckets; b++) if (count[b] > count[best]) best = b
      const n = Math.max(1, count[best])
      const i = (y * w + x) * 4
      const below = (Math.min(h - 1, y + 1) * w + x) * 4
      const above = (Math.max(0, y - 1) * w + x) * 4
      const edge = Math.abs(luma(src.data[below], src.data[below + 1], src.data[below + 2]) - luma(src.data[above], src.data[above + 1], src.data[above + 2]))
      out[i] = clamp8(rs[best] / n + edge * gloss)
      out[i + 1] = clamp8(gs[best] / n + edge * gloss)
      out[i + 2] = clamp8(bs[best] / n + edge * gloss)
      out[i + 3] = as[best] / n
    }
  }
  return new ImageData(out, w, h)
}

export function glassDistort(src: ImageData, distortion: number, smoothness: number, texture: string, scale: number): ImageData {
  const w = src.width, h = src.height
  const source = smoothness > 0 ? gaussianBlur(src, Math.min(8, smoothness)) : src
  const out = new Uint8ClampedArray(src.data.length)
  const amp = Math.max(0, Math.min(100, distortion)) * 0.45
  const sc = Math.max(10, Math.min(400, scale)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w) / sc
      const ny = y / Math.max(1, h) / sc
      let n1: number
      let n2: number
      if (texture === "blocks") {
        n1 = Math.floor(nx * 16) % 2 ? 0.2 : 0.8
        n2 = Math.floor(ny * 16) % 2 ? 0.8 : 0.2
      } else if (texture === "frosted") {
        n1 = fbmNoise(nx * 10, ny * 10, 53, 3)
        n2 = fbmNoise(nx * 10 + 13, ny * 10 + 17, 97, 3)
      } else {
        n1 = fbmNoise(nx * 4, ny * 4, 17, 5)
        n2 = fbmNoise(nx * 4 + 9, ny * 4 + 11, 71, 5)
      }
      const sample = bilinearSample(source.data, w, h, x + (n1 - 0.5) * amp, y + (n2 - 0.5) * amp)
      const i = (y * w + x) * 4
      out[i] = sample[0]; out[i + 1] = sample[1]; out[i + 2] = sample[2]; out[i + 3] = sample[3]
    }
  }
  return new ImageData(out, w, h)
}

export function mixBlurredByWeight(src: ImageData, blurred: ImageData, weightForPixel: (x: number, y: number) => number) {
  const out = new Uint8ClampedArray(src.data)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const weight = clamp01(weightForPixel(x, y))
      if (weight <= 0) continue
      out[i] = clamp8(src.data[i] * (1 - weight) + blurred.data[i] * weight)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - weight) + blurred.data[i + 1] * weight)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - weight) + blurred.data[i + 2] * weight)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
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
export interface LensProfilePreset {
  k1: number
  k2: number
  k3: number
  p1: number
  p2: number
  vignette: number
  chromatic: number
  defringe: number
  description: string
}

export const LENS_DEFAULT_VIGNETTE_MIDPOINT = 68
export const LENS_MANUAL_DISTORTION_DIVISOR = 115
export const LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE = 0.55
export const LENS_CHROMATIC_SHIFT_SCALE = 1.5

export const LENS_PROFILE_PRESETS: Record<string, LensProfilePreset> = {
  custom:        { k1: 0,     k2: 0,    k3: 0,    p1: 0,    p2: 0,    vignette: 0,    chromatic: 0,    defringe: 0,    description: "Manual" },
  smartphone:    { k1: 0.16,  k2: 0.04, k3: 0,    p1: 0,    p2: 0,    vignette: 0.18, chromatic: 0.08, defringe: 0.16, description: "Generic phone wide" },
  "compact-wide": { k1: 0.22, k2: 0.06, k3: 0.01, p1: 0,    p2: 0,    vignette: 0.20, chromatic: 0.12, defringe: 0.16, description: "Compact camera wide" },
  "wide-angle":  { k1: 0.34,  k2: 0.10, k3: 0.02, p1: 0,    p2: 0,    vignette: 0.32, chromatic: 0.18, defringe: 0.20, description: "24mm wide" },
  fisheye:       { k1: 0.62,  k2: 0.30, k3: 0.10, p1: 0,    p2: 0,    vignette: 0.45, chromatic: 0.22, defringe: 0.24, description: "Fisheye 8-15mm" },
  "standard-50": { k1: 0.04,  k2: 0.01, k3: 0,    p1: 0,    p2: 0,    vignette: 0.08, chromatic: 0.04, defringe: 0.08, description: "Standard 50mm" },
  telephoto:     { k1: -0.10, k2: -0.02, k3: 0,   p1: 0,    p2: 0,    vignette: 0.10, chromatic: 0.05, defringe: 0.10, description: "85-200mm tele" },
  "macro-100":   { k1: -0.03, k2: -0.01, k3: 0,   p1: 0,    p2: 0,    vignette: 0.05, chromatic: 0.03, defringe: 0.12, description: "100mm macro flat-field" },
  "super-tele":  { k1: -0.22, k2: -0.06, k3: -0.01, p1: 0,  p2: 0,    vignette: 0.06, chromatic: 0.03, defringe: 0.08, description: "300mm+ super tele" },
  "drone-fpv":   { k1: 0.45,  k2: 0.18, k3: 0.05, p1: 0.01, p2: 0.01, vignette: 0.36, chromatic: 0.20, defringe: 0.22, description: "Drone/action cam" },
  "architecture-shift": { k1: 0.08, k2: 0.02, k3: 0, p1: -0.01, p2: 0.01, vignette: 0.14, chromatic: 0.06, defringe: 0.14, description: "Shift lens / architecture" },
}

export interface LensCorrectionExtras {
  perspectiveV?: number
  perspectiveH?: number
  vignetteMidpoint?: number
  fringeR?: number
  fringeG?: number
  fringeB?: number
  scalePct?: number
}

export function lensCorrection(
  src: ImageData,
  distortion: number,
  vignette: number,
  chromatic: number,
  k2Strength: number = 0,
  k3Strength: number = 0,
  tangentialX: number = 0,
  tangentialY: number = 0,
  profile: string = "custom",
  autoScale: boolean = false,
  edgeMode: string = "clamp",
  profileStrength: number = 100,
  defringe: number = 0,
  extras: LensCorrectionExtras = {},
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const maxR = Math.max(1, Math.hypot(cx, cy))
  const preset = LENS_PROFILE_PRESETS[profile] ?? LENS_PROFILE_PRESETS.custom
  const strength = Math.max(0, Math.min(150, profileStrength)) / 100
  const k1 = preset.k1 * strength + distortion / LENS_MANUAL_DISTORTION_DIVISOR
  const k2 = preset.k2 * strength + (k2Strength + distortion * LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE) / 420
  const k3 = preset.k3 * strength + k3Strength / 900
  const p1 = preset.p1 * strength + tangentialX / 1200
  const p2 = preset.p2 * strength + tangentialY / 1200
  const ca = (chromatic + preset.chromatic * 100 * strength) / 100
  const vig = (vignette + preset.vignette * 100 * strength) / 100
  const fringeClean = Math.max(0, Math.min(100, defringe + preset.defringe * 100 * strength)) / 100
  const fringeR = (extras.fringeR ?? 0) / 100
  const fringeG = (extras.fringeG ?? 0) / 100
  const fringeB = (extras.fringeB ?? 0) / 100
  const perspV = (extras.perspectiveV ?? 0) / 200
  const perspH = (extras.perspectiveH ?? 0) / 200
  const vigMid = Math.max(0, Math.min(100, extras.vignetteMidpoint ?? LENS_DEFAULT_VIGNETTE_MIDPOINT)) / 100
  const extraScale = Math.max(0.05, (extras.scalePct ?? 100) / 100)
  // Compute an auto-scale factor so the corrected image fills the frame
  // without exposing the resampled edge — sample the 4 image corners and
  // scale by the smallest displacement factor.
  let outScale = 1 / extraScale
  if (autoScale) {
    const corners: Array<[number, number]> = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    ]
    let minFactor = Infinity
    for (const [px, py] of corners) {
      const dx = px - cx, dy = py - cy
      const nx2 = dx / maxR, ny2 = dy / maxR
      const r2c = nx2 * nx2 + ny2 * ny2
      const f = 1 + k1 * r2c + k2 * r2c * r2c + k3 * r2c * r2c * r2c
      if (f > 0 && f < minFactor) minFactor = f
    }
    if (isFinite(minFactor) && minFactor > 0) outScale = minFactor / extraScale
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) * outScale, dy = (y - cy) * outScale
      const nx = dx / maxR, ny = dy / maxR
      const r2 = nx * nx + ny * ny
      const r4 = r2 * r2, r6 = r4 * r2
      const factor = 1 + k1 * r2 + k2 * r4 + k3 * r6
      // Brown-Conrady tangential distortion (off-axis lens tilt)
      const tx = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx)
      const ty = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny
      // Vertical / horizontal perspective: keystone correction
      const ny01 = (y / Math.max(1, h - 1)) - 0.5
      const nx01 = (x / Math.max(1, w - 1)) - 0.5
      const perspXScale = 1 + perspV * (2 * ny01)
      const perspYScale = 1 + perspH * (2 * nx01)
      const sx = cx + dx * factor * perspXScale + tx * maxR
      const sy = cy + dy * factor * perspYScale + ty * maxR
      const chromaShift = ca * (0.3 + r2) * LENS_CHROMATIC_SHIFT_SCALE
      const red = bilinearSample(src.data, w, h, sx + nx * (chromaShift + fringeR * 8), sy + ny * (chromaShift + fringeR * 8))
      const mid = bilinearSample(src.data, w, h, sx + nx * fringeG * 4, sy + ny * fringeG * 4)
      const blue = bilinearSample(src.data, w, h, sx - nx * (chromaShift + fringeB * 8), sy - ny * (chromaShift + fringeB * 8))
      const radial = Math.pow(clamp01(Math.sqrt(r2)), 1.7)
      const radialShaped = Math.pow(radial, 0.3 + (1 - vigMid) * 2.2)
      const shade = vig >= 0 ? clamp01(1 - vig * radialShaped * 0.85) : 1 + Math.abs(vig) * radialShaped * 0.55
      const i = (y * w + x) * 4
      const outOfBounds = sx < 0 || sx > w - 1 || sy < 0 || sy > h - 1
      if (outOfBounds && edgeMode === "transparent") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0
      } else if (outOfBounds && edgeMode === "black") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = mid[3]
      } else if (outOfBounds && edgeMode === "white") {
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = mid[3]
      } else {
        let rr = red[0]
        let gg = mid[1]
        let bb = blue[2]
        if (fringeClean > 0) {
          const rb = (rr + bb) / 2
          const clean = fringeClean * radial
          gg = gg * (1 - clean) + rb * clean
          rr = rr * (1 - clean * 0.3) + rb * clean * 0.3
          bb = bb * (1 - clean * 0.3) + rb * clean * 0.3
        }
        out[i] = clamp8(rr * shade)
        out[i + 1] = clamp8(gg * shade)
        out[i + 2] = clamp8(bb * shade)
        out[i + 3] = mid[3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export function colorHalftone(src: ImageData, radius: number, angle: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cell = Math.max(4, Math.min(64, Math.round(radius * 2)))
  const rad = angle * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = x * cos - y * sin
      const ry = x * sin + y * cos
      const cx = Math.floor(rx / cell) * cell + cell / 2
      const cy = Math.floor(ry / cell) * cell + cell / 2
      const dist = Math.hypot(rx - cx, ry - cy)
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const ink = 1 - src.data[i + c] / 255
        const dot = Math.sqrt(ink) * cell * 0.62
        out[i + c] = dist <= dot ? Math.min(src.data[i + c], 24) : 255
      }
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function mezzotint(src: ImageData, type: string, density: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const d = Math.max(0, Math.min(100, density)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum01 = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
      const pattern = type === "long-strokes"
        ? Math.sin((x + y * 0.35) * 0.25)
        : type === "short-strokes"
          ? Math.sin(x * 0.8) * Math.cos(y * 0.8)
          : fbmNoise(x / w * 40, y / h * 40, 31, 2) * 2 - 1
      const value = clamp01(lum01 + pattern * 0.35 * d) > 0.5 ? 255 : 0
      out[i] = value; out[i + 1] = value; out[i + 2] = value; out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export interface LightConfig {
  type?: "spot" | "point" | "directional" | "omni"
  x?: number
  y?: number
  z?: number
  intensity?: number
  color?: [number, number, number]
  radius?: number
  focus?: number
  angleX?: number
  angleY?: number
}

export interface MaterialConfig {
  gloss?: number
  shine?: number
  ambientColor?: [number, number, number]
  exposure?: number
}

export function defaultLightsForStyle(style: string, intensityPercent: number): LightConfig[] {
  const intensity = Math.max(0, intensityPercent) / 100
  if (style === "directional") {
    return [{ type: "directional", angleX: -0.5, angleY: -0.7, z: 0.7, intensity, color: [255, 240, 215] }]
  }
  if (style === "omni" || style === "point") {
    return [{ type: "point", x: 0.5, y: 0.5, z: 0.45, intensity, color: [255, 245, 230], radius: 0.7 }]
  }
  if (style === "three-point") {
    return [
      { type: "spot", x: 0.32, y: 0.3, z: 0.55, intensity, color: [255, 235, 200], radius: 0.55, focus: 0.45 },
      { type: "spot", x: 0.72, y: 0.4, z: 0.4, intensity: intensity * 0.55, color: [200, 220, 255], radius: 0.5, focus: 0.35 },
      { type: "point", x: 0.5, y: 0.85, z: 0.3, intensity: intensity * 0.35, color: [255, 215, 180], radius: 0.65 },
    ]
  }
  if (style === "rgb-trio") {
    return [
      { type: "spot", x: 0.25, y: 0.35, z: 0.5, intensity, color: [255, 60, 60], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.55, y: 0.3, z: 0.5, intensity, color: [60, 255, 80], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.75, y: 0.5, z: 0.5, intensity, color: [60, 80, 255], radius: 0.55, focus: 0.4 },
    ]
  }
  return [{ type: "spot", x: 0.45, y: 0.35, z: 0.6, intensity, color: [255, 240, 215], radius: 0.6, focus: 0.4 }]
}

export function parseLightsConfig(raw: unknown): LightConfig[] | null {
  if (!raw) return null
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(value)) return null
    return value.filter((entry) => entry && typeof entry === "object") as LightConfig[]
  } catch {
    return null
  }
}

export function usesDefaultLightingMaterial(material: MaterialConfig) {
  return (
    (material.gloss ?? 0.5) === 0.5 &&
    (material.shine ?? 0.6) === 0.6 &&
    (material.exposure ?? 0) === 0 &&
    material.ambientColor === undefined
  )
}

export function lightingEffectsDefault(src: ImageData, style: string, intensity: number, ambient: number, height: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const light = Math.max(0, intensity) / 100
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const lx = style === "directional" ? -0.5 : 0.35
  const ly = style === "directional" ? -0.7 : -0.45
  const lz = style === "omni" ? 0.95 : 0.7
  const len = Math.hypot(lx, ly, lz)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const xl = Math.max(0, x - 1)
      const xr = Math.min(w - 1, x + 1)
      const yu = Math.max(0, y - 1)
      const yd = Math.min(h - 1, y + 1)
      const right = (y * w + xr) * 4
      const left = (y * w + xl) * 4
      const down = (yd * w + x) * 4
      const up = (yu * w + x) * 4
      const lumX = luma(src.data[right], src.data[right + 1], src.data[right + 2]) - luma(src.data[left], src.data[left + 1], src.data[left + 2])
      const lumY = luma(src.data[down], src.data[down + 1], src.data[down + 2]) - luma(src.data[up], src.data[up + 1], src.data[up + 2])
      const nx = (-lumX / 255) * heightScale
      const ny = (-lumY / 255) * heightScale
      const nz = 1
      const nLen = Math.hypot(nx, ny, nz)
      let spot = 1
      if (style === "spot") {
        const dx = (x - w * 0.45) / w
        const dy = (y - h * 0.35) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2)
      } else if (style === "omni") {
        const dx = (x - w * 0.5) / w
        const dy = (y - h * 0.5) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 1.8)
      }
      const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nLen * len))
      const highlight = Math.pow(diffuse, 18) * light * (0.35 + heightScale)
      const falloff = style === "directional" ? 1 : spot
      const amount = amb + diffuse * light * falloff
      out[i] = clamp8(src.data[i] * amount + (12 + 70 * highlight) * falloff)
      out[i + 1] = clamp8(src.data[i + 1] * amount + (16 + 62 * highlight) * falloff)
      out[i + 2] = clamp8(src.data[i + 2] * amount + (24 + 48 * highlight) * falloff)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function lightingEffects(
  src: ImageData,
  style: string,
  intensity: number,
  ambient: number,
  height: number,
  lightsRaw?: unknown,
  materialRaw?: unknown,
  bumpSource?: ImageData | null,
  bumpChannel?: "luminance" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const customLights = parseLightsConfig(lightsRaw)
  const material: MaterialConfig = (() => {
    if (!materialRaw) return {}
    try {
      return typeof materialRaw === "string" ? JSON.parse(materialRaw) : (materialRaw as MaterialConfig)
    } catch {
      return {}
    }
  })()
  if (!customLights && !bumpSource && (bumpChannel ?? "luminance") === "luminance" && usesDefaultLightingMaterial(material)) {
    return lightingEffectsDefault(src, style, intensity, ambient, height)
  }
  const lights = customLights ?? defaultLightsForStyle(style, intensity)
  const gloss = Math.max(0, Math.min(1, material.gloss ?? 0.5))
  const shine = Math.max(0, Math.min(1, material.shine ?? 0.6))
  const exposure = Math.pow(2, Math.max(-2, Math.min(2, material.exposure ?? 0)))
  const ambColor = material.ambientColor ?? [255, 255, 255]
  const specExp = 4 + gloss * 96

  // Compute a per-pixel scalar height value from the source or the supplied
  // bump-source image (using the requested channel). The normals are derived
  // from finite differences over the height field.
  const bw = bumpSource?.width ?? w
  const bh = bumpSource?.height ?? h
  const bumpData = bumpSource?.data ?? src.data
  const channel = bumpChannel ?? "luminance"
  const sampleHeight = (px: number, py: number): number => {
    // Scale source-space coords into bump-source space.
    const sx = bumpSource ? Math.min(bw - 1, Math.max(0, Math.round((px / Math.max(1, w - 1)) * (bw - 1)))) : px
    const sy = bumpSource ? Math.min(bh - 1, Math.max(0, Math.round((py / Math.max(1, h - 1)) * (bh - 1)))) : py
    const i = (sy * bw + sx) * 4
    const r = bumpData[i], g = bumpData[i + 1], b = bumpData[i + 2], a = bumpData[i + 3]
    switch (channel) {
      case "red":   return r
      case "green": return g
      case "blue":  return b
      case "alpha": return a
      default:      return luma(r, g, b)
    }
  }

  const nxBuf = new Float32Array(w * h)
  const nyBuf = new Float32Array(w * h)
  const nzBuf = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x
      const xr = x < w - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y
      const yd = y < h - 1 ? y + 1 : y
      const lx = (sampleHeight(xr, y) - sampleHeight(xl, y)) / 255
      const ly = (sampleHeight(x, yd) - sampleHeight(x, yu)) / 255
      const vx = -lx * heightScale * 3
      const vy = -ly * heightScale * 3
      const vz = 1
      const n = Math.hypot(vx, vy, vz) || 1
      const idx = y * w + x
      nxBuf[idx] = vx / n
      nyBuf[idx] = vy / n
      nzBuf[idx] = vz / n
    }
  }

  const diag = Math.hypot(w, h)
  const prep = lights.map((light) => {
    const t = light.type ?? "spot"
    const lc = light.color ?? [255, 255, 255]
    const intensityN = Math.max(0, light.intensity ?? 0.8)
    if (t === "directional") {
      const dx = light.angleX ?? -0.4
      const dy = light.angleY ?? -0.5
      const dz = light.z ?? 0.75
      const n = Math.hypot(dx, dy, dz) || 1
      return { kind: "dir" as const, dx: dx / n, dy: dy / n, dz: dz / n, intensity: intensityN, color: lc }
    }
    return {
      kind: (t === "point" || t === "omni") ? ("point" as const) : ("spot" as const),
      cx: (light.x ?? 0.5) * w,
      cy: (light.y ?? 0.5) * h,
      cz: Math.max(0.05, light.z ?? 0.4) * diag,
      radius: Math.max(0.01, light.radius ?? 0.6) * diag,
      focus: Math.max(0.01, light.focus ?? 0.4),
      intensity: intensityN,
      color: lc,
    }
  })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const idx = y * w + x
      const nX = nxBuf[idx], nY = nyBuf[idx], nZ = nzBuf[idx]

      let rLight = ambColor[0] * amb
      let gLight = ambColor[1] * amb
      let bLight = ambColor[2] * amb

      for (const light of prep) {
        let lx = 0, ly = 0, lz = 0
        let attenuation = 1
        let cone = 1
        if (light.kind === "dir") {
          lx = light.dx; ly = light.dy; lz = light.dz
        } else {
          const dx = light.cx - x
          const dy = light.cy - y
          const dz = light.cz
          const len = Math.hypot(dx, dy, dz) || 1
          lx = dx / len; ly = dy / len; lz = dz / len
          const planar = Math.hypot(dx, dy)
          attenuation = Math.max(0, 1 - planar / light.radius)
          attenuation *= attenuation
          if (light.kind === "spot") {
            const coneAngle = Math.max(0, lz)
            cone = Math.pow(coneAngle, 1 + light.focus * 10)
          }
        }
        const dotN = Math.max(0, nX * lx + nY * ly + nZ * lz)
        const diffuse = dotN * attenuation * cone * light.intensity
        const hx = lx, hy = ly, hz = lz + 1
        const hLen = Math.hypot(hx, hy, hz) || 1
        const specDot = Math.max(0, (nX * hx + nY * hy + nZ * hz) / hLen)
        const specular = Math.pow(specDot, specExp) * shine * attenuation * cone * light.intensity

        rLight += light.color[0] * diffuse + 255 * specular
        gLight += light.color[1] * diffuse + 255 * specular
        bLight += light.color[2] * diffuse + 255 * specular
      }

      out[i] = clamp8((src.data[i] * rLight / 255) * exposure)
      out[i + 1] = clamp8((src.data[i + 1] * gLight / 255) * exposure)
      out[i + 2] = clamp8((src.data[i + 2] * bLight / 255) * exposure)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function parseKernelMatrix(value: unknown): number[] | null {
  if (typeof value !== "string" || !value.trim()) return null
  const numbers = value
    .trim()
    .split(/[\s,;]+/)
    .map(Number)
    .filter(Number.isFinite)
  const side = Math.sqrt(numbers.length)
  if (!Number.isInteger(side) || side < 3 || side > 7 || side % 2 === 0) return null
  return numbers
}

export function customConvolution(src: ImageData, preset: string, strength: number, bias: number, matrix = "", divisor = 0): ImageData {
  const kernels: Record<string, number[]> = {
    "sharpen-more": [0, -1, 0, -1, 5, -1, 0, -1, 0],
    "edge-enhance": [0, 0, 0, -1, 1, 0, 0, 0, 0],
    outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    "sobel-x": [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    "sobel-y": [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  }
  const kernel = parseKernelMatrix(matrix) ?? kernels[preset] ?? kernels["sharpen-more"]
  const kernelSum = kernel.reduce((sum, value) => sum + value, 0)
  const raw = convolve(src, kernel, divisor ? divisor : kernelSum > 0 ? kernelSum : 1)
  const mix = Math.max(0, Math.min(200, strength)) / 100
  const offset = Math.max(-255, Math.min(255, bias))
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + (raw.data[i] + offset) * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + (raw.data[i + 1] + offset) * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + (raw.data[i + 2] + offset) * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

/* --------- APPLY IMAGE / CALCULATIONS --------- */

export type ApplyChannel = "rgb" | "red" | "green" | "blue" | "luminance" | "alpha" | "gray"

export function selectChannelValue(data: Uint8ClampedArray, i: number, channel: ApplyChannel): [number, number, number] {
  switch (channel) {
    case "red":   return [data[i], data[i], data[i]]
    case "green": return [data[i + 1], data[i + 1], data[i + 1]]
    case "blue":  return [data[i + 2], data[i + 2], data[i + 2]]
    case "alpha": return [data[i + 3], data[i + 3], data[i + 3]]
    case "gray":
    case "luminance": {
      const v = luma(data[i], data[i + 1], data[i + 2])
      return [v, v, v]
    }
    default:
      return [data[i], data[i + 1], data[i + 2]]
  }
}

export function resampleImageData(src: ImageData, targetW: number, targetH: number): ImageData {
  if (src.width === targetW && src.height === targetH) return src
  const out = new ImageData(targetW, targetH)
  const sxScale = src.width / targetW
  const syScale = src.height / targetH
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * sxScale))
      const sy = Math.min(src.height - 1, Math.floor(y * syScale))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetW + x) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return out
}

export function pixelBlend(
  dr: number, dg: number, db: number,
  sr: number, sg: number, sb: number,
  mode: string,
): [number, number, number] {
  const b = [dr / 255, dg / 255, db / 255]
  const s = [sr / 255, sg / 255, sb / 255]
  const apply = (fn: (a: number, c: number) => number) =>
    [fn(b[0], s[0]), fn(b[1], s[1]), fn(b[2], s[2])] as [number, number, number]
  let out: [number, number, number]
  switch (mode) {
    case "multiply":     out = apply((a, c) => a * c); break
    case "screen":       out = apply((a, c) => 1 - (1 - a) * (1 - c)); break
    case "overlay":      out = apply((a, c) => a < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "soft-light":   out = apply((a, c) => c <= 0.5 ? a - (1 - 2 * c) * a * (1 - a) : a + (2 * c - 1) * ((a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a)); break
    case "hard-light":   out = apply((a, c) => c < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "darken":       out = apply((a, c) => Math.min(a, c)); break
    case "lighten":      out = apply((a, c) => Math.max(a, c)); break
    case "difference":   out = apply((a, c) => Math.abs(a - c)); break
    case "exclusion":    out = apply((a, c) => a + c - 2 * a * c); break
    case "color-burn":   out = apply((a, c) => c === 0 ? 0 : Math.max(0, 1 - (1 - a) / c)); break
    case "linear-burn":  out = apply((a, c) => Math.max(0, a + c - 1)); break
    case "color-dodge":  out = apply((a, c) => c >= 1 ? 1 : Math.min(1, a / (1 - c))); break
    case "linear-dodge": out = apply((a, c) => Math.min(1, a + c)); break
    case "vivid-light":  out = apply((a, c) => c <= 0.5 ? (c === 0 ? 0 : Math.max(0, 1 - (1 - a) / (2 * c))) : (2 * (c - 0.5) >= 1 ? 1 : Math.min(1, a / (1 - 2 * (c - 0.5))))); break
    case "linear-light": out = apply((a, c) => Math.max(0, Math.min(1, a + 2 * c - 1))); break
    case "pin-light":    out = apply((a, c) => c <= 0.5 ? Math.min(a, 2 * c) : Math.max(a, 2 * c - 1)); break
    case "hard-mix":     out = apply((a, c) => a + c >= 1 ? 1 : 0); break
    case "subtract":     out = apply((a, c) => Math.max(0, a - c)); break
    case "divide":       out = apply((a, c) => c === 0 ? 1 : Math.min(1, a / c)); break
    case "add":          out = apply((a, c) => Math.min(1, a + c)); break
    default:             out = [s[0], s[1], s[2]] // normal
  }
  return [clamp8(out[0] * 255), clamp8(out[1] * 255), clamp8(out[2] * 255)]
}

export function applyImageFilter(
  src: ImageData,
  source: ImageData | null,
  channel: ApplyChannel,
  blendMode: string,
  opacity: number,
  invert: boolean,
  preserveTransparency: boolean,
): ImageData {
  if (!source) return clone(src)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const sample = resampleImageData(source, w, h)
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [sr, sg, sb] = selectChannelValue(sample.data, i, channel)
      if (invert) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb }
      const dr = src.data[i], dg = src.data[i + 1], db = src.data[i + 2]
      const [br, bg, bb] = pixelBlend(dr, dg, db, sr, sg, sb, blendMode)
      out[i] = clamp8(dr * (1 - op) + br * op)
      out[i + 1] = clamp8(dg * (1 - op) + bg * op)
      out[i + 2] = clamp8(db * (1 - op) + bb * op)
      out[i + 3] = preserveTransparency ? src.data[i + 3] : Math.max(src.data[i + 3], sample.data[i + 3])
    }
  }
  return new ImageData(out, w, h)
}

export function calculationsFilter(
  src: ImageData,
  sourceA: ImageData | null,
  sourceB: ImageData | null,
  channelA: ApplyChannel,
  channelB: ApplyChannel,
  blendMode: string,
  opacity: number,
  invertA: boolean,
  invertB: boolean,
  resultChannel: "gray" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const a = sourceA ? resampleImageData(sourceA, w, h) : src
  const b = sourceB ? resampleImageData(sourceB, w, h) : src
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [ar, ag, ab] = selectChannelValue(a.data, i, channelA)
      let [br, bg, bb] = selectChannelValue(b.data, i, channelB)
      if (invertA) { ar = 255 - ar; ag = 255 - ag; ab = 255 - ab }
      if (invertB) { br = 255 - br; bg = 255 - bg; bb = 255 - bb }
      const [r, g, bl] = pixelBlend(ar, ag, ab, br, bg, bb, blendMode)
      const mixed = clamp8(luma(r, g, bl)) * op + clamp8(luma(ar, ag, ab)) * (1 - op)
      const v = clamp8(mixed)
      switch (resultChannel) {
        case "red":   out[i] = v; break
        case "green": out[i + 1] = v; break
        case "blue":  out[i + 2] = v; break
        case "alpha": out[i + 3] = v; break
        default:      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = src.data[i + 3] || 255
      }
    }
  }
  return new ImageData(out, w, h)
}

/* --------- REDUCE NOISE (Bilateral Filter) --------- */

export function reduceNoise(src: ImageData, strength: number, colorNoise: number, detail: number, sharpen: number): ImageData {
  const w = src.width, h = src.height
  const noiseStrength = Math.max(0, Math.min(10, strength))
  const colorK = Math.max(0, Math.min(100, colorNoise)) / 100
  if (noiseStrength <= 0 && colorK <= 0 && sharpen <= 0) return clone(src)

  const sigmaS = Math.max(0.5, noiseStrength * 1.35) // spatial sigma
  const sigmaR = Math.max(1, (105 - Math.max(0, Math.min(100, detail))) * (1.1 + noiseStrength * 0.32))
  const r = Math.min(Math.ceil(sigmaS * 2), 7)

  // Phase 1: Bilateral luminance denoise
  const out = new Uint8ClampedArray(src.data)
  if (noiseStrength > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = (y * w + x) * 4
        const cR = src.data[ci], cG = src.data[ci + 1], cB = src.data[ci + 2]
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.max(0, Math.min(w - 1, x + dx))
            const sy = Math.max(0, Math.min(h - 1, y + dy))
            const si = (sy * w + sx) * 4
            const nR = src.data[si], nG = src.data[si + 1], nB = src.data[si + 2]

            const spatialDist = (dx * dx + dy * dy) / (2 * sigmaS * sigmaS)
            const colorDist = ((cR - nR) ** 2 + (cG - nG) ** 2 + (cB - nB) ** 2) / (2 * sigmaR * sigmaR * 3)
            const weight = Math.exp(-spatialDist - colorDist)

            rSum += nR * weight; gSum += nG * weight; bSum += nB * weight
            wSum += weight
          }
        }
        out[ci] = wSum ? clamp8(rSum / wSum) : src.data[ci]
        out[ci + 1] = wSum ? clamp8(gSum / wSum) : src.data[ci + 1]
        out[ci + 2] = wSum ? clamp8(bSum / wSum) : src.data[ci + 2]
        out[ci + 3] = src.data[ci + 3]
      }
    }
  }

  // Phase 2: Color noise reduction (average chrominance in neighborhood)
  if (colorK > 0) {
    const cr = Math.min(3, Math.ceil(colorK * 3))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = (y * w + x) * 4
        let rAvg = 0, gAvg = 0, bAvg = 0, cnt = 0
        for (let dy = -cr; dy <= cr; dy++) {
          for (let dx = -cr; dx <= cr; dx++) {
            const sx = Math.max(0, Math.min(w - 1, x + dx))
            const sy = Math.max(0, Math.min(h - 1, y + dy))
            const si = (sy * w + sx) * 4
            rAvg += out[si]; gAvg += out[si + 1]; bAvg += out[si + 2]
            cnt++
          }
        }
        rAvg /= cnt; gAvg /= cnt; bAvg /= cnt
        out[ci] = clamp8(out[ci] * (1 - colorK) + rAvg * colorK)
        out[ci + 1] = clamp8(out[ci + 1] * (1 - colorK) + gAvg * colorK)
        out[ci + 2] = clamp8(out[ci + 2] * (1 - colorK) + bAvg * colorK)
      }
    }
  }

  // Phase 3: Sharpening pass to restore details
  if (sharpen > 0) {
    const sK = sharpen / 200
    const blurred = gaussianBlur(new ImageData(new Uint8ClampedArray(out), w, h), 0.5)
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        out[i + c] = clamp8(out[i + c] + (out[i + c] - blurred.data[i + c]) * sK)
      }
    }
  }

  return new ImageData(out, w, h)
}

/* --------- DUST & SCRATCHES (Adaptive Median) --------- */

export function dustAndScratches(src: ImageData, radius: number, threshold: number): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const r = Math.max(1, Math.min(16, Math.floor(radius)))
  const t = Math.max(0, Math.min(255, threshold))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4
      const origR = src.data[ci], origG = src.data[ci + 1], origB = src.data[ci + 2]
      const origLum = luma(origR, origG, origB)

      // Collect neighborhood pixels
      const rVals: number[] = [], gVals: number[] = [], bVals: number[] = [], lVals: number[] = []
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue
          const sx = Math.max(0, Math.min(w - 1, x + dx))
          const sy = Math.max(0, Math.min(h - 1, y + dy))
          const si = (sy * w + sx) * 4
          rVals.push(src.data[si]); gVals.push(src.data[si + 1]); bVals.push(src.data[si + 2])
          lVals.push(luma(src.data[si], src.data[si + 1], src.data[si + 2]))
        }
      }
      if (!rVals.length) continue

      // Sort to find median
      rVals.sort((a, b) => a - b)
      gVals.sort((a, b) => a - b)
      bVals.sort((a, b) => a - b)
      lVals.sort((a, b) => a - b)
      const mid = Math.floor(rVals.length / 2)
      const medR = rVals[mid], medG = gVals[mid], medB = bVals[mid]
      const medLum = lVals[mid]

      // Replace isolated dust/scratch impulses, but leave normal edge pixels intact.
      const impulse = Math.abs(origLum - medLum)
      if (impulse > t) {
        const mix = t <= 0 ? 1 : clamp01((impulse - t) / Math.max(1, 255 - t))
        out[ci] = clamp8(origR * (1 - mix) + medR * mix)
        out[ci + 1] = clamp8(origG * (1 - mix) + medG * mix)
        out[ci + 2] = clamp8(origB * (1 - mix) + medB * mix)
      }
    }
  }
  return new ImageData(out, w, h)
}

/* --------- GAP REPORT LEGACY FILTERS --------- */

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

export function despeckle(src: ImageData): ImageData {
  return smartBlur(src, 1.4, 42)
}

export function ntscColors(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const max = Math.max(out[i], out[i + 1], out[i + 2])
    const min = Math.min(out[i], out[i + 1], out[i + 2])
    const sat = max - min
    if (sat > 110 || max > 235 || min < 16) {
      const lum = luma(out[i], out[i + 1], out[i + 2])
      const scale = Math.min(1, 110 / Math.max(1, sat))
      out[i] = clamp8(lum + (out[i] - lum) * scale)
      out[i + 1] = clamp8(lum + (out[i + 1] - lum) * scale)
      out[i + 2] = clamp8(lum + (out[i + 2] - lum) * scale)
      out[i] = Math.min(235, Math.max(16, out[i]))
      out[i + 1] = Math.min(235, Math.max(16, out[i + 1]))
      out[i + 2] = Math.min(235, Math.max(16, out[i + 2]))
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function _deInterlace(src: ImageData, field: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const even = field !== "odd"
  for (let y = even ? 1 : 0; y < src.height; y += 2) {
    const above = Math.max(0, y - 1)
    const below = Math.min(src.height - 1, y + 1)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const a = (above * src.width + x) * 4
      const b = (below * src.width + x) * 4
      out[i] = (src.data[a] + src.data[b]) / 2
      out[i + 1] = (src.data[a + 1] + src.data[b + 1]) / 2
      out[i + 2] = (src.data[a + 2] + src.data[b + 2]) / 2
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function glowingEdges(src: ImageData, width: number, brightness: number, smooth: number): ImageData {
  const edge = gaussianBlur(findEdges(src), smooth)
  const out = new Uint8ClampedArray(src.data.length)
  const gain = brightness / 80
  for (let i = 0; i < out.length; i += 4) {
    const e = Math.pow(edge.data[i] / 255, Math.max(0.4, width / 5))
    out[i] = clamp8(20 + e * 50)
    out[i + 1] = clamp8(80 + e * 220 * gain)
    out[i + 2] = clamp8(120 + e * 255 * gain)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function wind(src: ImageData, strength: number, direction: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const right = direction !== "left"
  const steps = Math.max(1, Math.round(strength))
  for (let y = 0; y < src.height; y++) {
    let carry = [0, 0, 0, 0]
    const start = right ? 0 : src.width - 1
    const end = right ? src.width : -1
    const step = right ? 1 : -1
    for (let x = start; x !== end; x += step) {
      const i = (y * src.width + x) * 4
      const bright = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
      const mix = Math.min(0.92, bright * steps * 0.06)
      out[i] = clamp8(src.data[i] * (1 - mix) + carry[0] * mix)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + carry[1] * mix)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + carry[2] * mix)
      out[i + 3] = src.data[i + 3]
      carry = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function extrude(src: ImageData, depth: number, mode: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const dx = Math.round(depth * 0.6)
  const dy = Math.round(depth * 0.45)
  for (let y = src.height - 1; y >= 0; y--) {
    for (let x = src.width - 1; x >= 0; x--) {
      const si = (y * src.width + x) * 4
      if (src.data[si + 3] < 8) continue
      for (let d = 1; d <= depth; d++) {
        const tx = x + Math.round((dx * d) / depth)
        const ty = y + Math.round((dy * d) / depth)
        if (tx < 0 || ty < 0 || tx >= src.width || ty >= src.height) continue
        const ti = (ty * src.width + tx) * 4
        const shade = mode === "pyramid" ? 1 - d / (depth * 1.4) : 0.72
        out[ti] = clamp8(src.data[si] * shade)
        out[ti + 1] = clamp8(src.data[si + 1] * shade)
        out[ti + 2] = clamp8(src.data[si + 2] * shade)
        out[ti + 3] = Math.max(out[ti + 3], src.data[si + 3])
      }
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function renderFlame(src: ImageData, heightPct: number, turbulence: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const base = src.height - 1
  const maxH = Math.max(8, src.height * (heightPct / 100))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const rise = (base - y) / maxH
      const n = fbmNoise(x / 80, y / 80, 41, 5)
      const flame = Math.max(0, Math.min(1, rise + (n - 0.5) * (turbulence / 50)))
      if (flame <= 0) continue
      out[i] = clamp8(out[i] * (1 - flame) + 255 * flame)
      out[i + 1] = clamp8(out[i + 1] * (1 - flame) + (80 + flame * 150) * flame)
      out[i + 2] = clamp8(out[i + 2] * (1 - flame) + 20 * flame)
      out[i + 3] = Math.max(out[i + 3], flame * 220)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function pictureFrame(src: ImageData, size: number, color: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const c = parseHexColor(color)
  const inset = Math.max(1, Math.round(size))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const border = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
      if (border > inset) continue
      const i = (y * src.width + x) * 4
      const shade = border < inset * 0.45 ? 0.7 : 1.18
      out[i] = clamp8(c.r * shade)
      out[i + 1] = clamp8(c.g * shade)
      out[i + 2] = clamp8(c.b * shade)
      out[i + 3] = 255
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function renderTree(src: ImageData, branches: number, leaves: boolean): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const drawPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return
    const i = (Math.floor(y) * src.width + Math.floor(x)) * 4
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.max(out[i + 3], a)
  }
  const branch = (x: number, y: number, len: number, angle: number, depth: number) => {
    const x2 = x + Math.cos(angle) * len
    const y2 = y + Math.sin(angle) * len
    const steps = Math.max(1, Math.round(len))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      drawPixel(x + (x2 - x) * t, y + (y2 - y) * t, 92, 58, 33)
    }
    if (depth <= 0) {
      if (leaves) {
        for (let i = 0; i < 18; i++) drawPixel(x2 + (hashNoise(i, x2, 2) - 0.5) * 30, y2 + (hashNoise(i, y2, 3) - 0.5) * 18, 42, 132 + hashNoise(i, x2, 4) * 90, 58)
      }
      return
    }
    for (let i = 0; i < branches; i++) {
      const spread = (i - (branches - 1) / 2) * 0.34
      branch(x2, y2, len * (0.62 + hashNoise(depth, i, 5) * 0.12), angle - 0.45 + spread, depth - 1)
    }
  }
  branch(src.width / 2, src.height - 8, src.height * 0.22, -Math.PI / 2, 6)
  return new ImageData(out, src.width, src.height)
}

export function displace(
  src: ImageData,
  scaleX: number,
  scaleY: number,
  map: string,
  edgeMode: string,
  mapImage?: ImageData | null,
  tileMap: boolean = true,
): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  const mw = mapImage?.width ?? 0
  const mh = mapImage?.height ?? 0
  const hasImageMap = map === "image" && mapImage && mw > 0 && mh > 0
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const nx = src.width <= 1 ? 0 : x / (src.width - 1)
      const ny = src.height <= 1 ? 0 : y / (src.height - 1)
      let dx = 0
      let dy = 0
      if (hasImageMap && mapImage) {
        // Photoshop convention: red channel drives X displacement, green channel drives Y.
        // 128 = no shift; 0 = -scale; 255 = +scale.
        let mx: number, my: number
        if (tileMap) {
          mx = ((x % mw) + mw) % mw
          my = ((y % mh) + mh) % mh
        } else {
          mx = Math.min(mw - 1, Math.floor(nx * (mw - 1)))
          my = Math.min(mh - 1, Math.floor(ny * (mh - 1)))
        }
        const mi = (my * mw + mx) * 4
        dx = ((mapImage.data[mi] - 128) / 127) * scaleX
        dy = ((mapImage.data[mi + 1] - 128) / 127) * scaleY
      } else if (map === "horizontal-gradient") {
        dx = (nx - 0.5) * scaleX
        dy = (ny - 0.5) * scaleY
      } else if (map === "luminance") {
        const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255 - 0.5
        dx = lum * scaleX
        dy = lum * scaleY
      } else {
        dx = (fbmNoise(x / 90, y / 90, 13, 4) - 0.5) * scaleX
        dy = (fbmNoise(x / 90, y / 90, 29, 4) - 0.5) * scaleY
      }
      copySampleWithEdge(src, out, x, y, x + dx, y + dy, edgeMode)
    }
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

export function diffuseGlow(src: ImageData, grain: number, glow: number, clear: number): ImageData {
  const blurred = gaussianBlur(src, Math.max(1, glow / 8))
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const n = (hashNoise(i, grain, 21) - 0.5) * grain
    const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
    const mix = Math.max(0, (lum - clear / 100)) * (glow / 50)
    out[i] = clamp8(src.data[i] * (1 - mix) + blurred.data[i] * mix + n)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + blurred.data[i + 1] * mix + n)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + blurred.data[i + 2] * mix + n)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function oceanRipple(src: ImageData, size: number, magnitude: number): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  const freq = Math.max(4, size)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const wave = Math.sin(y / freq) + Math.sin((x + y) / (freq * 0.7))
      copySample(src, out, x, y, x + wave * magnitude, y + Math.cos(x / freq) * magnitude)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function galleryStylize(src: ImageData, style: string, intensity: number): ImageData {
  let work = clone(src)
  const amount = intensity / 100
  if (style.includes("edge") || style.includes("outline") || style.includes("pen") || style.includes("photocopy")) {
    work = findEdges(src)
  } else if (style.includes("blur") || style.includes("pastel") || style.includes("water") || style.includes("daub") || style.includes("sumi")) {
    work = gaussianBlur(src, 1 + amount * 5)
  } else if (style.includes("grain") || style.includes("reticulation") || style.includes("sponge") || style.includes("spatter")) {
    work = addProceduralGrain(src, amount * 70, style)
  } else if (style.includes("cutout") || style.includes("stamp") || style.includes("poster") || style.includes("palette")) {
    work = posterizeImage(src, Math.max(2, Math.round(8 - amount * 5)))
  } else if (style.includes("chrome") || style.includes("plastic") || style.includes("bas relief") || style.includes("plaster")) {
    work = embossLike(src, amount)
  } else {
    work = convolve(src, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1)
  }
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const paper = style.includes("paper") || style.includes("texture") || style.includes("craquelure") || style.includes("tiles") || style.includes("glass")
      ? (hashNoise(i, intensity, 31) - 0.5) * 42 * amount
      : 0
    out[i] = clamp8(src.data[i] * (1 - amount) + work.data[i] * amount + paper)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + work.data[i + 1] * amount + paper)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + work.data[i + 2] * amount + paper)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function addProceduralGrain(src: ImageData, amount: number, salt: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const seed = salt.length * 17
  for (let i = 0; i < out.length; i += 4) {
    const n = (hashNoise(i, seed, 3) - 0.5) * amount
    out[i] = clamp8(out[i] + n)
    out[i + 1] = clamp8(out[i + 1] + n)
    out[i + 2] = clamp8(out[i + 2] + n)
  }
  return new ImageData(out, src.width, src.height)
}

export function posterizeImage(src: ImageData, levels: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(out[i] / step) * step
    out[i + 1] = Math.round(out[i + 1] / step) * step
    out[i + 2] = Math.round(out[i + 2] / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

export function embossLike(src: ImageData, amount: number): ImageData {
  const edge = convolve(src, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const v = 128 + (luma(edge.data[i], edge.data[i + 1], edge.data[i + 2]) - 128) * (1 + amount * 2)
    out[i] = clamp8(src.data[i] * (1 - amount) + v * amount)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + v * amount)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + v * amount)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function blendImageData(src: ImageData, work: ImageData, amount: number): ImageData {
  const mix = clamp01(amount)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + work.data[i] * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + work.data[i + 1] * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + work.data[i + 2] * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function coloredPencilFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const hatch = ((x + y * 2) % 5 === 0 ? -28 : (hashNoise(x, y, 17) - 0.5) * 18) * amount
      const edgeDark = (255 - edges.data[i]) * 0.45 * amount
      const paper = 238 + hatch - edgeDark
      out[i] = clamp8(paper * 0.56 + src.data[i] * 0.44 * (lum / 255 + 0.45))
      out[i + 1] = clamp8(paper * 0.56 + src.data[i + 1] * 0.44 * (lum / 255 + 0.45))
      out[i + 2] = clamp8(paper * 0.56 + src.data[i + 2] * 0.44 * (lum / 255 + 0.45))
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function dryBrushFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const smoothed = surfaceBlur(src, 1 + amount * 3, 42 + amount * 72)
  const blocked = posterizeImage(smoothed, Math.max(4, Math.round(9 - amount * 4)))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const left = (y * src.width + Math.max(0, x - 1)) * 4
      const streak = (blocked.data[left] - blocked.data[i]) * 0.18 * amount
      out[i] = clamp8(blocked.data[i] + streak)
      out[i + 1] = clamp8(blocked.data[i + 1] + streak)
      out[i + 2] = clamp8(blocked.data[i + 2] + streak)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function watercolorFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const wash = surfaceBlur(src, 2 + amount * 4, 95)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const pigment = 0.82 + (hashNoise(i, intensity, 43) - 0.5) * 0.12 * amount
    const edgeDark = (255 - edges.data[i]) * 0.22 * amount
    out[i] = clamp8(wash.data[i] * pigment - edgeDark)
    out[i + 1] = clamp8(wash.data[i + 1] * pigment - edgeDark)
    out[i + 2] = clamp8(wash.data[i + 2] * (pigment + 0.03) - edgeDark)
    out[i + 3] = src.data[i + 3]
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function crosshatchFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let ink = 255 - lum
      if ((x + y) % 4 === 0) ink += 58 * amount
      if ((x - y + 16) % 5 === 0 && lum < 180) ink += 78 * amount
      if ((x + y * 3) % 7 === 0 && lum < 110) ink += 92 * amount
      const v = clamp8(255 - ink)
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function graphicPenFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const line = ((x * 2 + y) % 6) / 6
      const threshold = 218 - amount * 96 + line * 86
      const v = lum > threshold ? 245 : 18
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function craquelureFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const n1 = fbmNoise(x / 4, y / 4, 71, 3)
      const n2 = fbmNoise((x + 3) / 3, (y - 5) / 3, 109, 2)
      const crack = Math.abs(n1 - n2) < 0.085 + amount * 0.035 ? 1 : 0
      const relief = (n1 - 0.5) * 46 * amount
      const dark = crack * (95 + 75 * amount)
      out[i] = clamp8(src.data[i] + relief - dark)
      out[i + 1] = clamp8(src.data[i + 1] + relief - dark)
      out[i + 2] = clamp8(src.data[i + 2] + relief - dark)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function mosaicTilesFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const tile = Math.max(2, Math.round(5 - amount * 2))
  const grout = Math.max(28, Math.round(70 * amount))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const tx = Math.floor(x / tile) * tile
      const ty = Math.floor(y / tile) * tile
      let rs = 0, gs = 0, bs = 0, n = 0
      for (let yy = ty; yy < Math.min(src.height, ty + tile); yy++) {
        for (let xx = tx; xx < Math.min(src.width, tx + tile); xx++) {
          const p = (yy * src.width + xx) * 4
          rs += src.data[p]; gs += src.data[p + 1]; bs += src.data[p + 2]; n++
        }
      }
      const i = (y * src.width + x) * 4
      const seam = x % tile === 0 || y % tile === 0
      out[i] = seam ? grout : clamp8(rs / n)
      out[i + 1] = seam ? grout : clamp8(gs / n)
      out[i + 2] = seam ? grout : clamp8(bs / n)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function copySample(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number) {
  const ix = Math.max(0, Math.min(src.width - 1, Math.round(sx)))
  const iy = Math.max(0, Math.min(src.height - 1, Math.round(sy)))
  const s = (iy * src.width + ix) * 4
  const d = (y * src.width + x) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

export function copySampleWithEdge(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number, edgeMode: string) {
  let ix = Math.round(sx)
  let iy = Math.round(sy)
  const d = (y * src.width + x) * 4
  if (edgeMode === "wrap") {
    ix = ((ix % src.width) + src.width) % src.width
    iy = ((iy % src.height) + src.height) % src.height
  } else if (edgeMode === "transparent") {
    if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) {
      out[d] = 0
      out[d + 1] = 0
      out[d + 2] = 0
      out[d + 3] = 0
      return
    }
  } else {
    ix = Math.max(0, Math.min(src.width - 1, ix))
    iy = Math.max(0, Math.min(src.height - 1, iy))
  }
  const s = (iy * src.width + ix) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

export function parseHexColor(color: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "111827"
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

export function hashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

export function legacyGalleryDefs(items: { id: string; name: string; category: string; intensity?: number }[]) {
  return Object.fromEntries(items.map((item) => [
    item.id,
    {
      id: item.id,
      name: `${item.name} (approx.)`,
      category: item.category,
      params: [
        { type: "slider" as const, key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: item.intensity ?? 68, suffix: "%" },
      ],
      apply: (src: ImageData, p: Record<string, number | string | boolean>) => galleryStylize(src, item.id.replace(/-/g, " "), Number(p.intensity)),
    } satisfies FilterDef,
  ]))
}

export function promotedGalleryDef(
  id: string,
  name: string,
  category: string,
  apply: (src: ImageData, intensity: number) => ImageData,
  intensity = 68,
): FilterDef {
  return {
    id,
    name,
    category,
    params: [
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: intensity, suffix: "%" },
    ],
    apply: (src, p) => apply(src, Number(p.intensity)),
  }
}

export const PROMOTED_GALLERY_FILTERS: Record<string, FilterDef> = {
  "colored-pencil": promotedGalleryDef("colored-pencil", "Colored Pencil", "Artistic", coloredPencilFilter),
  "dry-brush": promotedGalleryDef("dry-brush", "Dry Brush", "Artistic", dryBrushFilter),
  watercolor: promotedGalleryDef("watercolor", "Watercolor", "Artistic", watercolorFilter),
  crosshatch: promotedGalleryDef("crosshatch", "Crosshatch", "Brush Strokes", crosshatchFilter),
  "graphic-pen": promotedGalleryDef("graphic-pen", "Graphic Pen", "Sketch", graphicPenFilter),
  craquelure: promotedGalleryDef("craquelure", "Craquelure", "Texture", craquelureFilter),
  "mosaic-tiles": promotedGalleryDef("mosaic-tiles", "Mosaic Tiles", "Texture", mosaicTilesFilter),
}

/* ----------- new stylize / pixelate / distort filters ----------- */

export function fragment(src: ImageData): ImageData {
  const w = src.width, h = src.height
  const out = new Float32Array(w * h * 4)
  const offsets: Array<[number, number]> = [
    [-4, 0], [4, 0], [0, -4], [0, 4],
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      let r = 0, g = 0, b = 0, a = 0
      for (const [dx, dy] of offsets) {
        const sx = Math.max(0, Math.min(w - 1, x + dx))
        const sy = Math.max(0, Math.min(h - 1, y + dy))
        const si = (sy * w + sx) * 4
        r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; a += src.data[si + 3]
      }
      out[di] = r / 4
      out[di + 1] = g / 4
      out[di + 2] = b / 4
      out[di + 3] = a / 4
    }
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i++) data[i] = clamp8(out[i])
  return new ImageData(data, w, h)
}

export function facet(src: ImageData, threshold = 22): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const used = new Uint8Array(w * h)
  const queue: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (used[idx]) continue
      const si = idx * 4
      const seedR = src.data[si], seedG = src.data[si + 1], seedB = src.data[si + 2]
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0
      const region: number[] = []
      queue.length = 0
      queue.push(idx)
      used[idx] = 1
      while (queue.length > 0) {
        const ci = queue.pop()!
        const cx = ci % w
        const cy = (ci - cx) / w
        const pi = ci * 4
        const r = src.data[pi], g = src.data[pi + 1], b = src.data[pi + 2], a = src.data[pi + 3]
        sumR += r; sumG += g; sumB += b; sumA += a; count++
        region.push(ci)
        if (count > 4096) continue
        const neighbors = [
          [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (used[ni]) continue
          const npi = ni * 4
          const dr = src.data[npi] - seedR
          const dg = src.data[npi + 1] - seedG
          const db = src.data[npi + 2] - seedB
          if (Math.sqrt(dr * dr + dg * dg + db * db) > threshold) continue
          used[ni] = 1
          queue.push(ni)
        }
      }
      const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count, avgA = sumA / count
      for (const ci of region) {
        const pi = ci * 4
        out[pi] = clamp8(avgR)
        out[pi + 1] = clamp8(avgG)
        out[pi + 2] = clamp8(avgB)
        out[pi + 3] = clamp8(avgA)
      }
    }
  }
  return new ImageData(out, w, h)
}

export function pointillize(src: ImageData, cellSize: number, background = "#ffffff"): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const bg = parseHexColor(background)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg.r
    out[i + 1] = bg.g
    out[i + 2] = bg.b
    out[i + 3] = 255
  }
  const size = Math.max(2, Math.min(96, Math.round(cellSize)))
  for (let cy = 0; cy < h; cy += size) {
    for (let cx = 0; cx < w; cx += size) {
      const r1 = hashNoise(cx, cy, 1)
      const r2 = hashNoise(cx + 3, cy + 7, 17)
      const r3 = hashNoise(cx + 11, cy + 5, 99)
      const jitterX = cx + r1 * size
      const jitterY = cy + r2 * size
      const radius = (0.45 + r3 * 0.4) * size * 0.5
      const sx = Math.max(0, Math.min(w - 1, Math.round(jitterX)))
      const sy = Math.max(0, Math.min(h - 1, Math.round(jitterY)))
      const si = (sy * w + sx) * 4
      const r = src.data[si], g = src.data[si + 1], b = src.data[si + 2]
      const x0 = Math.max(0, Math.floor(jitterX - radius))
      const x1 = Math.min(w - 1, Math.ceil(jitterX + radius))
      const y0 = Math.max(0, Math.floor(jitterY - radius))
      const y1 = Math.min(h - 1, Math.ceil(jitterY + radius))
      const r2sq = radius * radius
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - jitterX
          const dy = py - jitterY
          if (dx * dx + dy * dy > r2sq) continue
          const di = (py * w + px) * 4
          out[di] = r
          out[di + 1] = g
          out[di + 2] = b
          out[di + 3] = 255
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

export function shear(src: ImageData, amount: number, edgeMode: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const amp = (amount / 100) * w * 0.5
  for (let y = 0; y < h; y++) {
    const t = (y / Math.max(1, h - 1)) * Math.PI
    const shift = Math.sin(t) * amp
    for (let x = 0; x < w; x++) {
      let sx = x - shift
      let useTransparent = false
      if (sx < 0 || sx > w - 1) {
        if (edgeMode === "wrap") {
          sx = ((sx % w) + w) % w
        } else if (edgeMode === "transparent") {
          useTransparent = true
        } else {
          sx = Math.max(0, Math.min(w - 1, sx))
        }
      }
      const di = (y * w + x) * 4
      if (useTransparent) {
        out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0
        continue
      }
      const sample = bilinearSample(src.data, w, h, sx, y)
      out[di] = sample[0]
      out[di + 1] = sample[1]
      out[di + 2] = sample[2]
      out[di + 3] = sample[3]
    }
  }
  return new ImageData(out, w, h)
}

export function tilesFilter(src: ImageData, numberOfTiles: number, maxOffset: number, fill: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const fillColor = parseHexColor(fill === "background" ? "#ffffff" : fill === "foreground" ? "#111827" : fill)
  const tileCount = Math.max(2, Math.min(99, Math.round(numberOfTiles)))
  const tileW = Math.max(1, Math.floor(w / tileCount))
  const tileH = Math.max(1, Math.floor(h / tileCount))
  const maxShift = Math.max(0, Math.min(99, maxOffset)) / 100
  // Init with fill color (transparent edges)
  const transparent = fill === "transparent"
  for (let i = 0; i < out.length; i += 4) {
    if (transparent) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0 }
    else { out[i] = fillColor.r; out[i + 1] = fillColor.g; out[i + 2] = fillColor.b; out[i + 3] = 255 }
  }
  for (let ty = 0; ty * tileH < h; ty++) {
    for (let tx = 0; tx * tileW < w; tx++) {
      const noiseX = (hashNoise(tx, ty, 7) * 2 - 1) * tileW * maxShift
      const noiseY = (hashNoise(tx + 13, ty + 5, 19) * 2 - 1) * tileH * maxShift
      const offX = Math.round(noiseX)
      const offY = Math.round(noiseY)
      const srcX0 = tx * tileW
      const srcY0 = ty * tileH
      for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
          const sx = srcX0 + px
          const sy = srcY0 + py
          if (sx >= w || sy >= h) continue
          const dx = sx + offX
          const dy = sy + offY
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue
          const si = (sy * w + sx) * 4
          const di = (dy * w + dx) * 4
          out[di] = src.data[si]
          out[di + 1] = src.data[si + 1]
          out[di + 2] = src.data[si + 2]
          out[di + 3] = src.data[si + 3]
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

export function diffuse(src: ImageData, mode: string, amount: number): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const radius = Math.max(1, Math.min(8, Math.round(amount / 12)))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      const rx = Math.floor((hashNoise(x, y, 3) * 2 - 1) * radius)
      const ry = Math.floor((hashNoise(x + 7, y + 1, 11) * 2 - 1) * radius)
      const sx = Math.max(0, Math.min(w - 1, x + rx))
      const sy = Math.max(0, Math.min(h - 1, y + ry))
      const si = (sy * w + sx) * 4
      if (mode === "lighten") {
        out[di] = Math.max(src.data[di], src.data[si])
        out[di + 1] = Math.max(src.data[di + 1], src.data[si + 1])
        out[di + 2] = Math.max(src.data[di + 2], src.data[si + 2])
      } else if (mode === "darken") {
        out[di] = Math.min(src.data[di], src.data[si])
        out[di + 1] = Math.min(src.data[di + 1], src.data[si + 1])
        out[di + 2] = Math.min(src.data[di + 2], src.data[si + 2])
      } else if (mode === "anisotropic") {
        const cur = luma(src.data[di], src.data[di + 1], src.data[di + 2])
        const cand = luma(src.data[si], src.data[si + 1], src.data[si + 2])
        const w1 = Math.abs(cur - cand) < 30 ? 0.8 : 0.2
        out[di] = clamp8(src.data[di] * (1 - w1) + src.data[si] * w1)
        out[di + 1] = clamp8(src.data[di + 1] * (1 - w1) + src.data[si + 1] * w1)
        out[di + 2] = clamp8(src.data[di + 2] * (1 - w1) + src.data[si + 2] * w1)
      } else {
        out[di] = src.data[si]
        out[di + 1] = src.data[si + 1]
        out[di + 2] = src.data[si + 2]
      }
      out[di + 3] = src.data[di + 3]
    }
  }
  return new ImageData(out, w, h)
}

/** De-interlace with choice of replacement method. */
export function deInterlaceAdvanced(src: ImageData, field: string, method: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const odd = field === "odd"
  // Replace odd/even rows
  for (let y = odd ? 1 : 0; y < h; y += 2) {
    const above = Math.max(0, y - 1)
    const below = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      const ai = (above * w + x) * 4
      const bi = (below * w + x) * 4
      if (method === "duplication") {
        // Duplicate the nearest kept row above
        out[di] = src.data[ai]
        out[di + 1] = src.data[ai + 1]
        out[di + 2] = src.data[ai + 2]
        out[di + 3] = src.data[ai + 3]
      } else {
        // interpolation: average neighbour rows
        out[di] = (src.data[ai] + src.data[bi]) >> 1
        out[di + 1] = (src.data[ai + 1] + src.data[bi + 1]) >> 1
        out[di + 2] = (src.data[ai + 2] + src.data[bi + 2]) >> 1
        out[di + 3] = src.data[di + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export {
  hexToRgbFilter,
  parseFieldBlurPins,
  parsePathBlurPoints,
  boxBlur,
  brightnessContrast,
  convolve,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
  clamp01,
  clamp8,
  clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
  parseCurvePoints,
  pseudoDither,
  channelMixer,
  desaturate,
  equalize,
  exposure,
  grayscale,
  hdrToning,
  hueSaturation,
  invert,
  levels,
  parseReplaceColorSamples,
  photoFilter,
  posterize,
  replaceColor,
  selectiveColor,
  sepia,
  shadowsHighlights,
  threshold,
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
  adaptiveWideAngle,
  bilinearSample,
  distanceToSegment,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
  fbmNoise,
  renderClouds,
  renderFibers,
  renderLensFlare,
  skyReplacement,
}

export type {
  FilterDef,
  HueRange,
}
