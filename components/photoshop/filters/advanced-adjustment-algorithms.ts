/**
 * Advanced color and tonal adjustment algorithms.
 */

import { hexToRgb as hexToRgbFilter } from "../color-utils"
import {
  HUE_RANGES,
  hueRangeMask,
  type HueRange,
} from "./adjustment-algorithms"
import {
  monotoneCurveLut,
  parseCurvePoints,
  pseudoDither,
} from "./curve-helpers"
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  hslToRgb,
  luma,
  parseNumber,
  rgbToHsl,
} from "./pixel-helpers"

interface CubeLut {
  size: number
  values: Array<[number, number, number]>
}

function parseCubeLut(value: unknown): CubeLut | null {
  if (typeof value !== "string" || !value.trim()) return null
  let size = 0
  const values: Array<[number, number, number]> = []
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || /^TITLE\b/i.test(line)) continue
    const sizeMatch = line.match(/^LUT_3D_SIZE\s+(\d+)/i)
    if (sizeMatch) {
      size = Math.max(2, Math.min(64, Number(sizeMatch[1]) || 0))
      continue
    }
    if (/^(DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) continue
    const parts = line.split(/\s+/).map(Number)
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      values.push([
        clamp01(parts[0]) * 255,
        clamp01(parts[1]) * 255,
        clamp01(parts[2]) * 255,
      ])
    }
  }
  if (!size || values.length < size * size * size) return null
  return { size, values }
}

function sampleCubeLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size
  const rf = clamp01(r / 255) * (n - 1)
  const gf = clamp01(g / 255) * (n - 1)
  const bf = clamp01(b / 255) * (n - 1)
  const r0 = Math.floor(rf), g0 = Math.floor(gf), b0 = Math.floor(bf)
  const r1 = Math.min(n - 1, r0 + 1), g1 = Math.min(n - 1, g0 + 1), b1 = Math.min(n - 1, b0 + 1)
  const tr = rf - r0, tg = gf - g0, tb = bf - b0
  const at = (ri: number, gi: number, bi: number) => lut.values[bi * n * n + gi * n + ri] ?? [r, g, b]
  const out: [number, number, number] = [0, 0, 0]
  for (const [ri, rw] of [[r0, 1 - tr], [r1, tr]] as const) {
    for (const [gi, gw] of [[g0, 1 - tg], [g1, tg]] as const) {
      for (const [bi, bw] of [[b0, 1 - tb], [b1, tb]] as const) {
        const c = at(ri, gi, bi)
        const w = rw * gw * bw
        out[0] += c[0] * w
        out[1] += c[1] * w
        out[2] += c[2] * w
      }
    }
  }
  return out
}

function applyLookupPreset(r: number, g: number, b: number, preset: string): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  if (preset === "warm") return [clamp8(r * 1.08 + 8), clamp8(g * 1.02 + 3), clamp8(b * 0.92)]
  if (preset === "cool") return [clamp8(r * 0.92), clamp8(g * 1.02 + 2), clamp8(b * 1.1 + 8)]
  if (preset === "bleach") {
    const gray = luma(r, g, b)
    return [clamp8(gray * 0.35 + r * 0.88 + 12), clamp8(gray * 0.35 + g * 0.88 + 12), clamp8(gray * 0.35 + b * 0.88 + 12)]
  }
  if (preset === "cross-process") return [clamp8(Math.pow(rn, 0.82) * 255), clamp8(Math.pow(gn, 1.06) * 255 + 8), clamp8(Math.pow(bn, 1.22) * 255)]
  const contrast = 1.15
  return [
    clamp8((rn - 0.5) * 255 * contrast + 128),
    clamp8((gn - 0.5) * 255 * contrast + 128),
    clamp8((bn - 0.5) * 255 * contrast + 128),
  ]
}

export function colorLookup(src: ImageData, lutStrength: number, lutData = "", preset = "filmic"): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const amount = Math.max(-100, Math.min(100, lutStrength)) / 100
  const lut = parseCubeLut(lutData)

  for (let i = 0; i < out.length; i += 4) {
    const mapped = lut
      ? sampleCubeLut(lut, out[i], out[i + 1], out[i + 2])
      : applyLookupPreset(out[i], out[i + 1], out[i + 2], preset)
    out[i] = clamp8(out[i] + (mapped[0] - out[i]) * amount)
    out[i + 1] = clamp8(out[i + 1] + (mapped[1] - out[i + 1]) * amount)
    out[i + 2] = clamp8(out[i + 2] + (mapped[2] - out[i + 2]) * amount)
  }

  return new ImageData(out, src.width, src.height)
}

function _gradientMap(src: ImageData): ImageData {
  // Simplified gradient map - maps luminance to a gradient from black to white
  // In a full implementation, this would use a gradient defined by two colors
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]

    // Calculate luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b

    // Map luminance to gradient (black to white for simplicity)
    // In a real implementation, this would interpolate between two colors
    const mapped = luminance

    out[i] = mapped
    out[i + 1] = mapped
    out[i + 2] = mapped
  }

  return new ImageData(out, src.width, src.height)
}

export function blackWhiteAdvanced(
  src: ImageData,
  reds: number,
  yellows: number,
  greens: number,
  cyans: number,
  blues: number,
  magentas: number,
  tint = false,
  tintHue = 38,
  tintSaturation = 18,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const shifts = { reds, yellows, greens, cyans, blues, magentas }
  for (let i = 0; i < out.length; i += 4) {
    const base = luma(out[i], out[i + 1], out[i + 2])
    const { h, s } = rgbToHsl(out[i], out[i + 1], out[i + 2])
    let adjustment = 0
    for (const key of Object.keys(HUE_RANGES) as Exclude<HueRange, "master">[]) {
      adjustment += hueRangeMask(h, s, key) * (shifts[key] / 100) * 85
    }
    const gray = clamp8(base + adjustment)
    if (tint) {
      const tinted = hslToRgb(((tintHue % 360) + 360) / 360, clamp01(tintSaturation / 100), gray / 255)
      out[i] = tinted.r
      out[i + 1] = tinted.g
      out[i + 2] = tinted.b
    } else {
      out[i] = gray
      out[i + 1] = gray
      out[i + 2] = gray
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function curvesAdvanced(
  src: ImageData,
  params: Record<string, number | string | boolean>,
): ImageData {
  const points = parseCurvePoints(params.points, [
    [0, parseNumber(params.shadow, 0)],
    [128, parseNumber(params.midtone, 128)],
    [255, parseNumber(params.highlight, 255)],
  ])
  const lut = monotoneCurveLut(points)
  const channel = String(params.channel ?? "rgb")
  const channels = channel === "red" ? [0] : channel === "green" ? [1] : channel === "blue" ? [2] : [0, 1, 2]
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    for (const k of channels) out[i + k] = lut[out[i + k]]
  }
  return new ImageData(out, src.width, src.height)
}

export function colorBalanceAdvanced(
  src: ImageData,
  cyanRed: number,
  magentaGreen: number,
  yellowBlue: number,
  tone: "shadows" | "midtones" | "highlights" = "midtones",
  preserveLuminosity = true,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const cr = cyanRed * 0.9
  const mg = magentaGreen * 0.9
  const yb = yellowBlue * 0.9
  for (let i = 0; i < out.length; i += 4) {
    const beforeLum = luma(out[i], out[i + 1], out[i + 2])
    const L = beforeLum / 255
    const shadows = clamp01((0.62 - L) / 0.62)
    const highlights = clamp01((L - 0.38) / 0.62)
    const midtones = clamp01(1 - Math.abs(L - 0.5) / 0.5)
    const weight =
      tone === "shadows" ? shadows * shadows :
      tone === "highlights" ? highlights * highlights :
      midtones * midtones
    let r = out[i] + cr * weight
    let g = out[i + 1] + mg * weight
    let b = out[i + 2] + yb * weight
    if (preserveLuminosity) {
      const afterLum = Math.max(1, luma(r, g, b))
      const ratio = beforeLum / afterLum
      r = beforeLum + (r * ratio - beforeLum) * 0.92
      g = beforeLum + (g * ratio - beforeLum) * 0.92
      b = beforeLum + (b * ratio - beforeLum) * 0.92
    }
    out[i] = clamp8(r)
    out[i + 1] = clamp8(g)
    out[i + 2] = clamp8(b)
  }
  return new ImageData(out, src.width, src.height)
}

export function vibranceAdvanced(src: ImageData, vibranceAmount: number, saturationAmount: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const hsl = rgbToHsl(out[i], out[i + 1], out[i + 2])
    const skinHue = hsl.h >= 18 / 360 && hsl.h <= 55 / 360
    const skinTone = skinHue && hsl.s > 0.12 && hsl.s < 0.78 && hsl.l > 0.18 && hsl.l < 0.86
    const lowSatBoost = 1 - hsl.s
    const skinProtect = skinTone ? 0.45 : 1
    const v = vibranceAmount / 100
    let s = hsl.s
    s = v >= 0
      ? s + (1 - s) * v * lowSatBoost * skinProtect
      : s * (1 + v * (1.35 - hsl.s))
    const sat = saturationAmount / 100
    s = sat >= 0 ? s + (1 - s) * sat : s * (1 + sat)
    const rgb = hslToRgb(hsl.h, clamp01(s), hsl.l)
    out[i] = rgb.r
    out[i + 1] = rgb.g
    out[i + 2] = rgb.b
  }
  return new ImageData(out, src.width, src.height)
}

interface GradientStopValue {
  offset: number
  color: string
}

function parseGradientStops(value: unknown): GradientStopValue[] {
  const fallback = [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ]
  if (typeof value !== "string" || !value.trim()) return fallback
  const stops = value
    .split(";")
    .map((entry) => {
      const [offset, color] = entry.split(",")
      const n = Number(offset)
      return Number.isFinite(n) && /^#[0-9a-f]{6}$/i.test(color ?? "")
        ? { offset: clamp01(n), color }
        : null
    })
    .filter((s): s is GradientStopValue => !!s)
    .sort((a, b) => a.offset - b.offset)
  if (!stops.length) return fallback
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 })
  if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 })
  return stops
}

function sampleGradient(stops: GradientStopValue[], t: number, interpolation = "rgb") {
  const first = stops[0]
  if (t <= first.offset) return hexToRgbFilter(first.color)
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t <= b.offset) {
      const span = Math.max(0.0001, b.offset - a.offset)
      const k = (t - a.offset) / span
      const ca = hexToRgbFilter(a.color)
      const cb = hexToRgbFilter(b.color)
      if (interpolation === "hsl") {
        const ha = rgbToHsl(ca.r, ca.g, ca.b)
        const hb = rgbToHsl(cb.r, cb.g, cb.b)
        let dh = hb.h - ha.h
        if (dh > 0.5) dh -= 1
        if (dh < -0.5) dh += 1
        const c = hslToRgb((ha.h + dh * k + 1) % 1, ha.s + (hb.s - ha.s) * k, ha.l + (hb.l - ha.l) * k)
        return { r: c.r, g: c.g, b: c.b }
      }
      return {
        r: ca.r + (cb.r - ca.r) * k,
        g: ca.g + (cb.g - ca.g) * k,
        b: ca.b + (cb.b - ca.b) * k,
      }
    }
  }
  return hexToRgbFilter(stops[stops.length - 1].color)
}


export function gradientMapAdvanced(src: ImageData, gradient: string, reverse = false, dither = false, interpolation = "rgb"): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const stops = parseGradientStops(gradient)
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    let t = luma(out[i], out[i + 1], out[i + 2]) / 255
    if (dither) t = clamp01(t + (pseudoDither(p) - 0.5) / 255)
    if (reverse) t = 1 - t
    const c = sampleGradient(stops, t, interpolation)
    out[i] = c.r
    out[i + 1] = c.g
    out[i + 2] = c.b
  }
  return new ImageData(out, src.width, src.height)
}

interface LabStats {
  mean: [number, number, number]
  std: [number, number, number]
}

export function matchColorAdvanced(
  src: ImageData,
  source: ImageData | null | undefined,
  luminance: number,
  colorIntensity: number,
  fade: number,
  neutralize: boolean,
) {
  if (!source) return clone(src)
  const srcStats = labStats(src)
  const refStats = labStats(source)
  const out = new Uint8ClampedArray(src.data)
  const lumAmount = luminance / 100
  const colorAmount = colorIntensity / 100
  const fadeAmount = fade / 100
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const original = [out[i], out[i + 1], out[i + 2]] as [number, number, number]
    let lab = rgbToLab(original[0], original[1], original[2])
    lab = [
      refStats.mean[0] + ((lab[0] - srcStats.mean[0]) * refStats.std[0]) / Math.max(0.0001, srcStats.std[0]),
      refStats.mean[1] + ((lab[1] - srcStats.mean[1]) * refStats.std[1]) / Math.max(0.0001, srcStats.std[1]),
      refStats.mean[2] + ((lab[2] - srcStats.mean[2]) * refStats.std[2]) / Math.max(0.0001, srcStats.std[2]),
    ]
    lab[0] = srcStats.mean[0] + (lab[0] - srcStats.mean[0]) * lumAmount
    lab[1] = srcStats.mean[1] + (lab[1] - srcStats.mean[1]) * colorAmount
    lab[2] = srcStats.mean[2] + (lab[2] - srcStats.mean[2]) * colorAmount
    if (neutralize) {
      lab[1] *= 0.86
      lab[2] *= 0.86
    }
    const matched = labToRgb(lab[0], lab[1], lab[2])
    out[i] = clamp8(original[0] * fadeAmount + matched[0] * (1 - fadeAmount))
    out[i + 1] = clamp8(original[1] * fadeAmount + matched[1] * (1 - fadeAmount))
    out[i + 2] = clamp8(original[2] * fadeAmount + matched[2] * (1 - fadeAmount))
  }
  return new ImageData(out, src.width, src.height)
}

function labStats(img: ImageData): LabStats {
  let count = 0
  const sum: [number, number, number] = [0, 0, 0]
  const sumSq: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const lab = rgbToLab(img.data[i], img.data[i + 1], img.data[i + 2])
    for (let k = 0; k < 3; k++) {
      sum[k] += lab[k]
      sumSq[k] += lab[k] * lab[k]
    }
    count++
  }
  if (!count) return { mean: [0, 0, 0], std: [1, 1, 1] }
  const mean = sum.map((v) => v / count) as [number, number, number]
  const std = sumSq.map((v, k) => Math.sqrt(Math.max(0.0001, v / count - mean[k] * mean[k]))) as [number, number, number]
  return { mean, std }
}

function srgbToLinear(v: number) {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return clamp8(c * 255)
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  let x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  let y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb)
  let z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const f = (v: number) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  x = f(x)
  y = f(y)
  z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  let y = (L + 16) / 116
  let x = a / 500 + y
  let z = y - b / 200
  const f = (v: number) => {
    const v3 = v * v * v
    return v3 > 0.008856 ? v3 : (v - 16 / 116) / 7.787
  }
  x = f(x) * 0.95047
  y = f(y)
  z = f(z) * 1.08883
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)]
}
