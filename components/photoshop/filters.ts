/**
 * Pixel-level filter implementations. Each `apply(src, params)` returns a
 * NEW ImageData with the filter applied. Source is not mutated, so callers
 * can use the same ImageData for live previews across many parameter changes.
 */

import type { BlendMode } from "./types"

export type FilterParam =
  | { type: "slider"; key: string; label: string; min: number; max: number; step?: number; default: number; suffix?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; default: string }
  | { type: "checkbox"; key: string; label: string; default: boolean }

export interface FilterDef {
  id: string
  name: string
  category: string
  params: FilterParam[]
  apply: (src: ImageData, params: Record<string, number | string | boolean>, context?: FilterContext) => ImageData
}

export interface FilterContext {
  matchColorSource?: ImageData | null
}

/* --------------------------- helpers ----------------------------------- */

function clone(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export interface FilterCompositeOptions {
  opacity?: number
  blendMode?: BlendMode
  maskData?: Uint8ClampedArray | null
  maskWidth?: number
  maskHeight?: number
  maskEnabled?: boolean
}

function blendFilterChannel(src: number, dest: number, mode: BlendMode) {
  switch (mode) {
    case "multiply":
      return (src * dest) / 255
    case "screen":
      return 255 - ((255 - src) * (255 - dest)) / 255
    case "overlay":
      return dest < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "hard-light":
      return src < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "soft-light": {
      const s = src / 255
      const d = dest / 255
      const value = s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (Math.sqrt(d) - d)
      return value * 255
    }
    case "darken":
      return Math.min(src, dest)
    case "lighten":
      return Math.max(src, dest)
    case "difference":
      return Math.abs(dest - src)
    default:
      return src
  }
}

function filterMaskAlpha(options: FilterCompositeOptions, x: number, y: number, width: number, height: number) {
  if (options.maskEnabled === false || !options.maskData || !options.maskWidth || !options.maskHeight) return 1
  const mx = Math.max(0, Math.min(options.maskWidth - 1, Math.floor((x / width) * options.maskWidth)))
  const my = Math.max(0, Math.min(options.maskHeight - 1, Math.floor((y / height) * options.maskHeight)))
  const pixelCount = options.maskWidth * options.maskHeight
  if (options.maskData.length >= pixelCount * 4) {
    const i = (my * options.maskWidth + mx) * 4
    const luminance = (options.maskData[i] + options.maskData[i + 1] + options.maskData[i + 2]) / 765
    return luminance * (options.maskData[i + 3] / 255)
  }
  return options.maskData[my * options.maskWidth + mx] / 255
}

export function compositeFilterImageData(
  before: ImageData,
  after: ImageData,
  options: FilterCompositeOptions = {},
): ImageData {
  const width = Math.min(before.width, after.width)
  const height = Math.min(before.height, after.height)
  const out = new Uint8ClampedArray(before.data)
  const opacity = clamp01(options.opacity ?? 1)
  const blendMode = options.blendMode ?? "normal"

  if (opacity <= 0) return new ImageData(out, before.width, before.height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * before.width + x) * 4
      const si = (y * after.width + x) * 4
      const maskAlpha = filterMaskAlpha(options, x, y, width, height)
      const srcAlpha = (after.data[si + 3] / 255) * opacity * maskAlpha
      if (srcAlpha <= 0) continue

      const destAlpha = before.data[i + 3] / 255
      const outAlpha = srcAlpha + destAlpha * (1 - srcAlpha)
      if (outAlpha <= 0) {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
        continue
      }

      for (let c = 0; c < 3; c++) {
        const src = after.data[si + c]
        const dest = before.data[i + c]
        const blended = blendFilterChannel(src, dest, blendMode)
        out[i + c] = clamp8(Math.round((blended * srcAlpha + dest * destAlpha * (1 - srcAlpha)) / outAlpha))
      }
      out[i + 3] = clamp8(Math.round(outAlpha * 255))
    }
  }

  return new ImageData(out, before.width, before.height)
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function parseBool(v: number | string | boolean | undefined, fallback = false) {
  return typeof v === "boolean" ? v : fallback
}

function parseNumber(v: number | string | boolean | undefined, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return { h, s, l }
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number) {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return { r: r * 255, g: g * 255, b: b * 255 }
}

/* --------------------------- BLUR -------------------------------------- */

/** Stack box blur — fast, separable, good Gaussian approximation. */
function boxBlur(src: ImageData, radius: number): ImageData {
  if (radius <= 0) return clone(src)
  const r = Math.floor(radius)
  const w = src.width
  const h = src.height
  const a = new Uint8ClampedArray(src.data)
  const b = new Uint8ClampedArray(a.length)

  // horizontal
  for (let y = 0; y < h; y++) {
    let rs = 0
    let gs = 0
    let bs = 0
    let as_ = 0
    for (let i = -r; i <= r; i++) {
      const x = Math.max(0, Math.min(w - 1, i))
      const p = (y * w + x) * 4
      rs += a[p]
      gs += a[p + 1]
      bs += a[p + 2]
      as_ += a[p + 3]
    }
    const span = 2 * r + 1
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      b[p] = rs / span
      b[p + 1] = gs / span
      b[p + 2] = bs / span
      b[p + 3] = as_ / span
      const xOut = Math.max(0, Math.min(w - 1, x - r))
      const xIn = Math.max(0, Math.min(w - 1, x + r + 1))
      const pOut = (y * w + xOut) * 4
      const pIn = (y * w + xIn) * 4
      rs += a[pIn] - a[pOut]
      gs += a[pIn + 1] - a[pOut + 1]
      bs += a[pIn + 2] - a[pOut + 2]
      as_ += a[pIn + 3] - a[pOut + 3]
    }
  }

  // vertical
  for (let x = 0; x < w; x++) {
    let rs = 0
    let gs = 0
    let bs = 0
    let as_ = 0
    for (let i = -r; i <= r; i++) {
      const y = Math.max(0, Math.min(h - 1, i))
      const p = (y * w + x) * 4
      rs += b[p]
      gs += b[p + 1]
      bs += b[p + 2]
      as_ += b[p + 3]
    }
    const span = 2 * r + 1
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4
      a[p] = rs / span
      a[p + 1] = gs / span
      a[p + 2] = bs / span
      a[p + 3] = as_ / span
      const yOut = Math.max(0, Math.min(h - 1, y - r))
      const yIn = Math.max(0, Math.min(h - 1, y + r + 1))
      const pOut = (yOut * w + x) * 4
      const pIn = (yIn * w + x) * 4
      rs += b[pIn] - b[pOut]
      gs += b[pIn + 1] - b[pOut + 1]
      bs += b[pIn + 2] - b[pOut + 2]
      as_ += b[pIn + 3] - b[pOut + 3]
    }
  }

  return new ImageData(a, w, h)
}

function gaussianBlur(src: ImageData, radius: number): ImageData {
  if (radius <= 0) return clone(src)
  // 3 passes of box blur ≈ Gaussian
  const r = Math.max(1, Math.round(radius / 3))
  let out = boxBlur(src, r)
  out = boxBlur(out, r)
  out = boxBlur(out, r)
  return out
}

function motionBlur(src: ImageData, distance: number, angleDeg: number): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const steps = Math.max(1, Math.round(distance))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let i = -steps; i <= steps; i++) {
        const sx = Math.round(x + dx * i)
        const sy = Math.round(y + dy * i)
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
        const p = (sy * w + sx) * 4
        r += src.data[p]
        g += src.data[p + 1]
        b += src.data[p + 2]
        a += src.data[p + 3]
        n++
      }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return new ImageData(out, w, h)
}

/* --------------------------- SHARPEN ----------------------------------- */

function convolve(src: ImageData, kernel: number[], divisor = 1): ImageData {
  const side = Math.round(Math.sqrt(kernel.length))
  const half = Math.floor(side / 2)
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let cy = 0; cy < side; cy++) {
        for (let cx = 0; cx < side; cx++) {
          const sy = Math.max(0, Math.min(h - 1, y + cy - half))
          const sx = Math.max(0, Math.min(w - 1, x + cx - half))
          const p = (sy * w + sx) * 4
          const k = kernel[cy * side + cx]
          r += src.data[p] * k
          g += src.data[p + 1] * k
          b += src.data[p + 2] * k
        }
      }
      const o = (y * w + x) * 4
      out[o] = clamp8(r / divisor)
      out[o + 1] = clamp8(g / divisor)
      out[o + 2] = clamp8(b / divisor)
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

function sharpen(src: ImageData, amount: number): ImageData {
  // amount 0..200 (%)
  const a = amount / 100
  const k = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  return convolve(src, k)
}

function unsharpMask(src: ImageData, amount: number, radius: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const k = amount / 100
  for (let i = 0; i < src.data.length; i += 4) {
    out[i] = clamp8(src.data[i] + (src.data[i] - blurred.data[i]) * k)
    out[i + 1] = clamp8(src.data[i + 1] + (src.data[i + 1] - blurred.data[i + 1]) * k)
    out[i + 2] = clamp8(src.data[i + 2] + (src.data[i + 2] - blurred.data[i + 2]) * k)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, w, h)
}

/* --------------------------- STYLIZE ----------------------------------- */

function findEdges(src: ImageData): ImageData {
  // Sobel
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0
      let sy = 0
      for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const py = Math.max(0, Math.min(h - 1, y + cy - 1))
          const px = Math.max(0, Math.min(w - 1, x + cx - 1))
          const p = (py * w + px) * 4
          const lum = 0.299 * src.data[p] + 0.587 * src.data[p + 1] + 0.114 * src.data[p + 2]
          sx += lum * gx[cy * 3 + cx]
          sy += lum * gy[cy * 3 + cx]
        }
      }
      const m = clamp8(Math.hypot(sx, sy))
      const o = (y * w + x) * 4
      out[o] = m
      out[o + 1] = m
      out[o + 2] = m
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

function emboss(src: ImageData, amount: number): ImageData {
  const k = [-2, -1, 0, -1, 1, 1, 0, 1, 2].map((v) => v * (amount / 100))
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 128
      let g = 128
      let b = 128
      for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const sy = Math.max(0, Math.min(h - 1, y + cy - 1))
          const sx = Math.max(0, Math.min(w - 1, x + cx - 1))
          const p = (sy * w + sx) * 4
          const kv = k[cy * 3 + cx]
          r += src.data[p] * kv
          g += src.data[p + 1] * kv
          b += src.data[p + 2] * kv
        }
      }
      const o = (y * w + x) * 4
      out[o] = clamp8(r)
      out[o + 1] = clamp8(g)
      out[o + 2] = clamp8(b)
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

function solarize(src: ImageData, threshold: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i] > threshold ? 255 - out[i] : out[i]
    out[i + 1] = out[i + 1] > threshold ? 255 - out[i + 1] : out[i + 1]
    out[i + 2] = out[i + 2] > threshold ? 255 - out[i + 2] : out[i + 2]
  }
  return new ImageData(out, src.width, src.height)
}

function pixelate(src: ImageData, cellSize: number): ImageData {
  const w = src.width
  const h = src.height
  const cs = Math.max(1, Math.floor(cellSize))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y += cs) {
    for (let x = 0; x < w; x += cs) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let cy = 0; cy < cs && y + cy < h; cy++) {
        for (let cx = 0; cx < cs && x + cx < w; cx++) {
          const p = ((y + cy) * w + (x + cx)) * 4
          r += src.data[p]
          g += src.data[p + 1]
          b += src.data[p + 2]
          a += src.data[p + 3]
          n++
        }
      }
      r /= n
      g /= n
      b /= n
      a /= n
      for (let cy = 0; cy < cs && y + cy < h; cy++) {
        for (let cx = 0; cx < cs && x + cx < w; cx++) {
          const p = ((y + cy) * w + (x + cx)) * 4
          out[p] = r
          out[p + 1] = g
          out[p + 2] = b
          out[p + 3] = a
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

function noise(src: ImageData, amount: number, mono: boolean, gaussian = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const randFn = gaussian
    ? () => { // Box-Muller transform for gaussian distribution
        let u = 0, v = 0
        while (u === 0) u = Math.random()
        while (v === 0) v = Math.random()
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.33
      }
    : () => Math.random() - 0.5

  for (let i = 0; i < out.length; i += 4) {
    if (mono) {
      const n = randFn() * 2 * amount
      out[i] = clamp8(out[i] + n)
      out[i + 1] = clamp8(out[i + 1] + n)
      out[i + 2] = clamp8(out[i + 2] + n)
    } else {
      out[i] = clamp8(out[i] + randFn() * 2 * amount)
      out[i + 1] = clamp8(out[i + 1] + randFn() * 2 * amount)
      out[i + 2] = clamp8(out[i + 2] + randFn() * 2 * amount)
    }
  }
  return new ImageData(out, src.width, src.height)
}

/* --------------------------- COLOR / ADJUSTMENTS ----------------------- */

function brightnessContrast(src: ImageData, brightness: number, contrast: number, useLegacy = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  if (useLegacy) {
    const c = (contrast + 100) / 100
    for (let i = 0; i < out.length; i += 4) {
      out[i] = clamp8((out[i] - 128) * c + 128 + brightness)
      out[i + 1] = clamp8((out[i + 1] - 128) * c + 128 + brightness)
      out[i + 2] = clamp8((out[i + 2] - 128) * c + 128 + brightness)
    }
    return new ImageData(out, src.width, src.height)
  }

  const b = brightness / 150
  const c = contrast / 100
  const pivot = 0.5 + b * 0.12
  for (let i = 0; i < out.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = out[i + k] / 255
      v = b >= 0 ? v + (1 - v) * b : v * (1 + b)
      if (c !== 0) {
        const slope = c >= 0 ? 1 + c * 2.2 : 1 + c * 0.85
        v = (v - pivot) * slope + pivot
      }
      out[i + k] = clamp8(v * 255)
    }
  }
  return new ImageData(out, src.width, src.height)
}

type HueRange = "master" | "reds" | "yellows" | "greens" | "cyans" | "blues" | "magentas"

const HUE_RANGES: Record<Exclude<HueRange, "master">, { center: number; inner: number; outer: number }> = {
  reds: { center: 0, inner: 18 / 360, outer: 42 / 360 },
  yellows: { center: 60 / 360, inner: 22 / 360, outer: 48 / 360 },
  greens: { center: 120 / 360, inner: 26 / 360, outer: 56 / 360 },
  cyans: { center: 180 / 360, inner: 24 / 360, outer: 54 / 360 },
  blues: { center: 240 / 360, inner: 26 / 360, outer: 58 / 360 },
  magentas: { center: 300 / 360, inner: 24 / 360, outer: 54 / 360 },
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b)
  return d > 0.5 ? 1 - d : d
}

function hueRangeMask(h: number, s: number, range: HueRange) {
  if (range === "master") return 1
  if (s < 0.015) return 0
  const r = HUE_RANGES[range]
  const d = hueDistance(h, r.center)
  if (d <= r.inner) return 1
  if (d >= r.outer) return 0
  return 1 - (d - r.inner) / Math.max(0.0001, r.outer - r.inner)
}

function hueSaturation(
  src: ImageData,
  hueShift: number,
  satShift: number,
  lightShift: number,
  range: HueRange = "master",
  colorize = false,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  // Hue is normalised to [0, 1). Without the second `% 360` a hueShift of 0
  // produces 360/360 = 1.0 which lies outside the valid range and
  // mis-renders red as the very next adjacent hue when colorize is on.
  const targetHue = (((hueShift % 360) + 360) % 360) / 360
  for (let i = 0; i < out.length; i += 4) {
    const before = rgbToHsl(out[i], out[i + 1], out[i + 2])
    const mask = colorize ? 1 : hueRangeMask(before.h, before.s, range)
    if (mask <= 0) continue
    let nh = colorize ? targetHue : before.h + hueShift / 360
    nh = nh - Math.floor(nh)
    const satDelta = satShift / 100
    const lightDelta = lightShift / 100
    const ns = colorize
      ? clamp01((satShift + 100) / 200)
      : satDelta >= 0
        ? before.s + (1 - before.s) * satDelta
        : before.s * (1 + satDelta)
    const nl = lightDelta >= 0
      ? before.l + (1 - before.l) * lightDelta
      : before.l * (1 + lightDelta)
    const adjusted = hslToRgb(nh, clamp01(ns), clamp01(nl))
    out[i] = clamp8(out[i] + (adjusted.r - out[i]) * mask)
    out[i + 1] = clamp8(out[i + 1] + (adjusted.g - out[i + 1]) * mask)
    out[i + 2] = clamp8(out[i + 2] + (adjusted.b - out[i + 2]) * mask)
  }
  return new ImageData(out, src.width, src.height)
}

function levels(
  src: ImageData,
  inputBlack: number,
  inputWhite: number,
  gamma: number,
  outputBlack: number,
  outputWhite: number,
  channel = "rgb",
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const range = Math.max(1, inputWhite - inputBlack)
  const g = 1 / Math.max(0.01, gamma)
  const channels = channel === "red" ? [0] : channel === "green" ? [1] : channel === "blue" ? [2] : [0, 1, 2]
  for (let i = 0; i < out.length; i += 4) {
    for (const k of channels) {
      let v = (out[i + k] - inputBlack) / range
      v = clamp01(v)
      v = Math.pow(v, g)
      v = v * (outputWhite - outputBlack) + outputBlack
      out[i + k] = clamp8(v)
    }
  }
  return new ImageData(out, src.width, src.height)
}

function invert(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]
    out[i + 1] = 255 - out[i + 1]
    out[i + 2] = 255 - out[i + 2]
  }
  return new ImageData(out, src.width, src.height)
}

function grayscale(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const v = clamp8(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2])
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
  }
  return new ImageData(out, src.width, src.height)
}

function _blackWhite(src: ImageData, reds: number, yellows: number, greens: number, cyans: number, blues: number, magentas: number): ImageData {
  // Black & White adjustment with channel mixing controls
  // Parameters are in range -100 to 100, representing percentage shift from default mix
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255
    const g = out[i + 1] / 255
    const b = out[i + 2] / 255

    // Convert to HSL to work with hue
    const { h, l } = rgbToHsl(r, g, b)

    // Start with base luminance
    let lightness = l

    // Apply adjustments based on hue ranges
    // Normalize hue to 0-1 range
    const hue = h

    // Red range (0-30° and 330-360°)
    if (hue < 0.083 || hue > 0.917) {
      lightness += (reds / 100) * 0.3 // Scale factor for subtle adjustment
    }
    // Yellow range (30-90°)
    else if (hue >= 0.083 && hue < 0.25) {
      lightness += (yellows / 100) * 0.3
    }
    // Green range (90-150°)
    else if (hue >= 0.25 && hue < 0.417) {
      lightness += (greens / 100) * 0.3
    }
    // Cyan range (150-210°)
    else if (hue >= 0.417 && hue < 0.583) {
      lightness += (cyans / 100) * 0.3
    }
    // Blue range (210-270°)
    else if (hue >= 0.583 && hue < 0.75) {
      lightness += (blues / 100) * 0.3
    }
    // Magenta range (270-330°)
    else if (hue >= 0.75 && hue < 0.917) {
      lightness += (magentas / 100) * 0.3
    }

    // Clamp lightness to valid range
    lightness = Math.max(0, Math.min(1, lightness))

    // Convert back to RGB with zero saturation (true grayscale)
    const { r: nr, g: ng, b: nb } = hslToRgb(hue, 0, lightness)

    out[i] = nr * 255
    out[i + 1] = ng * 255
    out[i + 2] = nb * 255
  }

  return new ImageData(out, src.width, src.height)
}

function sepia(src: ImageData, amount: number): ImageData {
  const a = amount / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const tr = 0.393 * r + 0.769 * g + 0.189 * b
    const tg = 0.349 * r + 0.686 * g + 0.168 * b
    const tb = 0.272 * r + 0.534 * g + 0.131 * b
    out[i] = clamp8(r + (tr - r) * a)
    out[i + 1] = clamp8(g + (tg - g) * a)
    out[i + 2] = clamp8(b + (tb - b) * a)
  }
  return new ImageData(out, src.width, src.height)
}

function threshold(src: ImageData, level: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const lum = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    const v = lum >= level ? 255 : 0
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
  }
  return new ImageData(out, src.width, src.height)
}

function posterize(src: ImageData, levels: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(out[i] / step) * step
    out[i + 1] = Math.round(out[i + 1] / step) * step
    out[i + 2] = Math.round(out[i + 2] / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

function _curves(
  src: ImageData,
  shadow: number,
  midtone: number,
  highlight: number,
): ImageData {
  // Build a 256-entry LUT from 3 control points: (0,shadow), (128,midtone), (255,highlight)
  const lut = new Uint8ClampedArray(256)
  // Quadratic Bezier-ish blend through 3 points
  const cs = clamp8(shadow)
  const cm = clamp8(midtone)
  const ch = clamp8(highlight)
  for (let i = 0; i < 256; i++) {
    let v: number
    if (i <= 128) {
      const t = i / 128
      // Bezier between (0, cs) and (128, cm)
      v = (1 - t) * (1 - t) * cs + 2 * (1 - t) * t * ((cs + cm) / 2 + (cm - cs) * 0.1) + t * t * cm
    } else {
      const t = (i - 128) / 127
      v = (1 - t) * (1 - t) * cm + 2 * (1 - t) * t * ((cm + ch) / 2 + (ch - cm) * 0.1) + t * t * ch
    }
    lut[i] = clamp8(v)
  }
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = lut[out[i]]
    out[i + 1] = lut[out[i + 1]]
    out[i + 2] = lut[out[i + 2]]
  }
  return new ImageData(out, src.width, src.height)
}

function _colorBalance(
  src: ImageData,
  cyanRed: number,
  magentaGreen: number,
  yellowBlue: number,
): ImageData {
  // values in -100..100; positive shifts toward Red/Green/Blue, negative the opposite
  const cr = cyanRed / 100
  const mg = magentaGreen / 100
  const yb = yellowBlue / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] + cr * 60)
    out[i + 1] = clamp8(out[i + 1] + mg * 60)
    out[i + 2] = clamp8(out[i + 2] + yb * 60)
  }
  return new ImageData(out, src.width, src.height)
}

function photoFilter(src: ImageData, color: string, density: number): ImageData {
  // tint the image toward `color`, density 0..100
  let r = 240
  let g = 130
  let b = 60
  if (color === "blue") {
    r = 60
    g = 100
    b = 200
  } else if (color === "green") {
    r = 90
    g = 200
    b = 110
  } else if (color === "magenta") {
    r = 220
    g = 80
    b = 200
  } else if (color === "cyan") {
    r = 80
    g = 200
    b = 220
  } else if (color === "yellow") {
    r = 245
    g = 230
    b = 100
  }
  const a = density / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] * (1 - a) + r * a)
    out[i + 1] = clamp8(out[i + 1] * (1 - a) + g * a)
    out[i + 2] = clamp8(out[i + 2] * (1 - a) + b * a)
  }
  return new ImageData(out, src.width, src.height)
}

function channelMixer(
  src: ImageData,
  rR: number,
  rG: number,
  rB: number,
  gR: number,
  gG: number,
  gB: number,
  bR: number,
  bG: number,
  bB: number,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = src.data[i]
    const g = src.data[i + 1]
    const b = src.data[i + 2]
    out[i] = clamp8((r * rR + g * rG + b * rB) / 100)
    out[i + 1] = clamp8((r * gR + g * gG + b * gB) / 100)
    out[i + 2] = clamp8((r * bR + g * bG + b * bB) / 100)
  }
  return new ImageData(out, src.width, src.height)
}

function _vibrance(src: ImageData, amount: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const a = amount / 100
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const max = Math.max(r, g, b)
    const avg = (r + g + b) / 3
    const amt = (((Math.abs(max - avg) * 2) / 255) * a) | 0
    if (r !== max) out[i] = clamp8(r + ((max - r) * amt) / 100)
    if (g !== max) out[i + 1] = clamp8(g + ((max - g) * amt) / 100)
    if (b !== max) out[i + 2] = clamp8(b + ((max - b) * amt) / 100)
  }
  return new ImageData(out, src.width, src.height)
}

function exposure(src: ImageData, ev: number): ImageData {
  const factor = Math.pow(2, ev)
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] * factor)
    out[i + 1] = clamp8(out[i + 1] * factor)
    out[i + 2] = clamp8(out[i + 2] * factor)
  }
  return new ImageData(out, src.width, src.height)
}

function desaturate(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const luma = (max + min) / 2
    out[i] = luma
    out[i + 1] = luma
    out[i + 2] = luma
  }
  return new ImageData(out, src.width, src.height)
}

function equalize(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const histogram = new Array(256).fill(0)

  // Build histogram
  for (let i = 0; i < out.length; i += 4) {
    histogram[out[i]]++
    histogram[out[i + 1]]++
    histogram[out[i + 2]]++
  }

  // Calculate CDF (Cumulative Distribution Function)
  const cdf = new Array(256).fill(0)
  let sum = 0
  const totalPixels = (src.width * src.height * 3) // RGB channels

  for (let i = 0; i < 256; i++) {
    sum += histogram[i]
    cdf[i] = Math.round((sum / totalPixels) * 255)
  }

  // Apply equalization
  for (let i = 0; i < out.length; i += 4) {
    out[i] = cdf[out[i]]
    out[i + 1] = cdf[out[i + 1]]
    out[i + 2] = cdf[out[i + 2]]
  }

  return new ImageData(out, src.width, src.height)
}

function replaceColor(src: ImageData, hue: number, tolerance: number, lightness: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const hRange = tolerance / 2

  for (let i = 0; i < out.length; i += 4) {
    const { h, s, l } = rgbToHsl(out[i], out[i + 1], out[i + 2])
    let nh = h

    // Check if hue is within tolerance range (accounting for wrap-around)
    let hueDiff = Math.abs(h - hue)
    if (hueDiff > 0.5) hueDiff = 1 - hueDiff

    if (hueDiff <= hRange) {
      // Shift hue
      nh = hue + ((h - hue) * 0.5) // Blend towards target hue
      nh = nh - Math.floor(nh) // Normalize to 0-1

      // Adjust lightness
      const nl = l + lightness / 100

      const { r, g, b } = hslToRgb(nh, s, nl)
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
    }
  }

  return new ImageData(out, src.width, src.height)
}

function _matchColor(src: ImageData): ImageData {
  // Simple implementation: normalize visible pixels to luminance.
  const out = new Uint8ClampedArray(src.data)
  let count = 0

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] > 0) { // Non-transparent pixels
      count++
    }
  }

  if (count === 0) return new ImageData(out, src.width, src.height)

  // Convert to grayscale based on luminance
  for (let i = 0; i < out.length; i += 4) {
    const gray = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    out[i] = gray
    out[i + 1] = gray
    out[i + 2] = gray
  }

  return new ImageData(out, src.width, src.height)
}

function selectiveColor(src: ImageData, cyans: number, magentas: number, yellows: number, whites: number, neutrals: number, blacks: number): ImageData {
  // Simplified implementation - adjust color ranges
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255
    const g = out[i + 1] / 255
    const b = out[i + 2] / 255
    const { h, s, l } = rgbToHsl(r, g, b)

    let adjustments = 0

    // Simple selective color adjustments based on hue ranges
    if (h >= 0.4 && h <= 0.6) { // Cyans/blues
      adjustments += cyans
    } else if (h >= 0.9 || h <= 0.1) { // Reds/magentas
      adjustments += magentas
    } else if (h >= 0.1 && h <= 0.4) { // Yellows/greens
      adjustments += yellows
    } else if (l > 0.8) { // Whites
      adjustments += whites
    } else if (l < 0.2) { // Blacks
      adjustments += blacks
    } else if (s < 0.2) { // Neutrals
      adjustments += neutrals
    }

    // Apply adjustment to lightness
    const nl = Math.max(0, Math.min(1, l + adjustments / 100))
    const { r: nr, g: ng, b: nb } = hslToRgb(h, s, nl)

    out[i] = nr * 255
    out[i + 1] = ng * 255
    out[i + 2] = nb * 255
  }

  return new ImageData(out, src.width, src.height)
}

function shadowsHighlights(src: ImageData, shadows: number, highlights: number, midpoint: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const mid = midpoint / 100

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255
    const g = out[i + 1] / 255
    const b = out[i + 2] / 255
    const { h, s, l } = rgbToHsl(r, g, b)

    let adjustment = 0

    // Shadows adjustment (darker tones)
    if (l < mid) {
      const factor = (mid - l) / mid
      adjustment = shadows * factor / 100
    }
    // Highlights adjustment (lighter tones)
    else if (l > mid) {
      const factor = (l - mid) / (1 - mid)
      adjustment = highlights * factor / 100
    }

    // Apply adjustment to lightness
    const nl = Math.max(0, Math.min(1, l + adjustment))
    const { r: nr, g: ng, b: nb } = hslToRgb(h, s, nl)

    out[i] = nr * 255
    out[i + 1] = ng * 255
    out[i + 2] = nb * 255
  }

  return new ImageData(out, src.width, src.height)
}

function hdrTonning(src: ImageData, radius: number, strength: number): ImageData {
  // Simplified HDR toning using local contrast enhancement
  const out = new Uint8ClampedArray(src.data)
  // Create a blurred version for local average
  const blurred = gaussianBlur(src, radius)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]

    const br = blurred.data[i]
    const bg = blurred.data[i + 1]
    const bb = blurred.data[i + 2]

    // Calculate local contrast
    const contrastR = ((r - br) * strength) / 100
    const contrastG = ((g - bg) * strength) / 100
    const contrastB = ((b - bb) * strength) / 100

    // Apply local contrast
    out[i] = clamp8(r + contrastR)
    out[i + 1] = clamp8(g + contrastG)
    out[i + 2] = clamp8(b + contrastB)
  }

  return new ImageData(out, src.width, src.height)
}

function colorLookup(src: ImageData, lutStrength: number): ImageData {
  // Simplified color lookup using a 3D LUT approximation
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255
    const g = out[i + 1] / 255
    const b = out[i + 2] / 255

    // Simple 3D LUT: enhance contrast and slightly shift colors
    const contrast = 1 + (lutStrength / 100)
    const nr = Math.pow(r, contrast) * 255
    const ng = Math.pow(g, contrast) * 255
    const nb = Math.pow(b, contrast) * 255

    out[i] = clamp8(nr)
    out[i + 1] = clamp8(ng)
    out[i + 2] = clamp8(nb)
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

function blackWhiteAdvanced(
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

function parseCurvePoints(value: unknown, fallback: [number, number][] = [[0, 0], [255, 255]]) {
  if (typeof value !== "string") return fallback
  const points = value
    .split(";")
    .map((pair) => {
      const [x, y] = pair.split(",").map((n) => Number(n))
      return Number.isFinite(x) && Number.isFinite(y) ? [clamp8(x), clamp8(y)] as [number, number] : null
    })
    .filter((p): p is [number, number] => !!p)
    .sort((a, b) => a[0] - b[0])
  if (!points.some((p) => p[0] === 0)) points.unshift([0, 0])
  if (!points.some((p) => p[0] === 255)) points.push([255, 255])
  return points.length >= 2 ? points : fallback
}

function monotoneCurveLut(points: [number, number][]) {
  const pts = points
    .map(([x, y]) => [clamp8(x), clamp8(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0])
  const n = pts.length
  const d = new Array(Math.max(0, n - 1)).fill(0)
  const m = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / Math.max(1, pts[i + 1][0] - pts[i][0])
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }

  const lut = new Uint8ClampedArray(256)
  for (let x = 0; x < 256; x++) {
    let j = 0
    while (j < n - 2 && x > pts[j + 1][0]) j++
    const x0 = pts[j][0]
    const y0 = pts[j][1]
    const x1 = pts[j + 1][0]
    const y1 = pts[j + 1][1]
    const span = Math.max(1, x1 - x0)
    const t = clamp01((x - x0) / span)
    const t2 = t * t
    const t3 = t2 * t
    lut[x] = clamp8(
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * span * m[j] +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * span * m[j + 1],
    )
  }
  return lut
}

function curvesAdvanced(
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

function colorBalanceAdvanced(
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

function vibranceAdvanced(src: ImageData, vibranceAmount: number, saturationAmount: number): ImageData {
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

function sampleGradient(stops: GradientStopValue[], t: number) {
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
      return {
        r: ca.r + (cb.r - ca.r) * k,
        g: ca.g + (cb.g - ca.g) * k,
        b: ca.b + (cb.b - ca.b) * k,
      }
    }
  }
  return hexToRgbFilter(stops[stops.length - 1].color)
}

function hexToRgbFilter(hex: string) {
  const raw = hex.replace("#", "")
  const v = Number.parseInt(raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw, 16)
  return {
    r: (v >> 16) & 255,
    g: (v >> 8) & 255,
    b: v & 255,
  }
}

function gradientMapAdvanced(src: ImageData, gradient: string, reverse = false, dither = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const stops = parseGradientStops(gradient)
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    let t = luma(out[i], out[i + 1], out[i + 2]) / 255
    if (dither) t = clamp01(t + (pseudoDither(p) - 0.5) / 255)
    if (reverse) t = 1 - t
    const c = sampleGradient(stops, t)
    out[i] = c.r
    out[i + 1] = c.g
    out[i + 2] = c.b
  }
  return new ImageData(out, src.width, src.height)
}

function pseudoDither(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

interface LabStats {
  mean: [number, number, number]
  std: [number, number, number]
}

function matchColorAdvanced(
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

/* ====================== BILINEAR INTERPOLATION ========================= */

function bilinearSample(data: Uint8ClampedArray, w: number, h: number, fx: number, fy: number): [number, number, number, number] {
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = x0 + 1, y1 = y0 + 1
  const dx = fx - x0, dy = fy - y0
  const sx0 = Math.max(0, Math.min(w - 1, x0)), sx1 = Math.max(0, Math.min(w - 1, x1))
  const sy0 = Math.max(0, Math.min(h - 1, y0)), sy1 = Math.max(0, Math.min(h - 1, y1))
  const p00 = (sy0 * w + sx0) * 4, p10 = (sy0 * w + sx1) * 4
  const p01 = (sy1 * w + sx0) * 4, p11 = (sy1 * w + sx1) * 4
  const w00 = (1 - dx) * (1 - dy), w10 = dx * (1 - dy), w01 = (1 - dx) * dy, w11 = dx * dy
  return [
    data[p00] * w00 + data[p10] * w10 + data[p01] * w01 + data[p11] * w11,
    data[p00 + 1] * w00 + data[p10 + 1] * w10 + data[p01 + 1] * w01 + data[p11 + 1] * w11,
    data[p00 + 2] * w00 + data[p10 + 2] * w10 + data[p01 + 2] * w01 + data[p11 + 2] * w11,
    data[p00 + 3] * w00 + data[p10 + 3] * w10 + data[p01 + 3] * w01 + data[p11 + 3] * w11,
  ]
}

/* ====================== DISTORT FILTERS ================================ */

function distortTwirl(src: ImageData, angleDeg: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.min(cx, cy)
  const angleRad = (angleDeg * Math.PI) / 180
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      if (dist < maxR) {
        const t = 1 - dist / maxR
        const twist = angleRad * t * t
        const cosT = Math.cos(twist), sinT = Math.sin(twist)
        const sx = cx + cosT * dx - sinT * dy
        const sy = cy + sinT * dx + cosT * dy
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortPinch(src: ImageData, amount: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.min(cx, cy)
  const str = amount / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      if (dist < maxR && dist > 0) {
        const t = dist / maxR
        const scale = Math.pow(t, str > 0 ? 1 + str * 2 : 1 / (1 - str * 2))
        const sx = cx + dx * (scale / t)
        const sy = cy + dy * (scale / t)
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortSpherize(src: ImageData, amount: number, mode: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, rw = w / 2, rh = h / 2
  const str = amount / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rw, ny = (y - cy) / rh
      const d2 = nx * nx + ny * ny
      const i = (y * w + x) * 4
      if (d2 < 1) {
        const d = Math.sqrt(d2)
        const refract = d > 0 ? (1 - Math.sqrt(1 - d2)) / d * str + (1 - str) : 1
        let sx: number, sy: number
        if (mode === "horizontal") {
          sx = cx + nx * refract * rw; sy = y
        } else if (mode === "vertical") {
          sx = x; sy = cy + ny * refract * rh
        } else {
          sx = cx + nx * refract * rw; sy = cy + ny * refract * rh
        }
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortWave(src: ImageData, wavelength: number, amplitude: number, type: string, scale: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const s = scale / 100
  const waveFunc = (t: number): number => {
    if (type === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(t * Math.PI * 2))
    if (type === "square") return Math.sin(t * Math.PI * 2) >= 0 ? 1 : -1
    return Math.sin(t * Math.PI * 2)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + waveFunc(y / wavelength) * amplitude * s
      const sy = y + waveFunc(x / wavelength) * amplitude * s
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortRipple(src: ImageData, amount: number, size: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const freq = size === "small" ? 0.4 : size === "large" ? 0.05 : 0.15
  const amp = amount / 100 * (size === "small" ? 5 : size === "large" ? 40 : 15)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + Math.sin(y * freq * Math.PI) * amp
      const sy = y + Math.sin(x * freq * Math.PI) * amp
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortZigZag(src: ImageData, amount: number, ridges: number, style: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)
      const t = dist / maxR
      const i = (y * w + x) * 4
      let displacement = 0
      if (style === "pond") {
        displacement = Math.sin(t * ridges * Math.PI * 2) * amount * t
      } else if (style === "from-center") {
        displacement = Math.sin(t * ridges * Math.PI * 2) * amount
      } else {
        displacement = Math.sin(angle * ridges) * amount * t
      }
      const sx = x + Math.cos(angle) * displacement
      const sy = y + Math.sin(angle) * displacement
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

function distortPolar(src: ImageData, mode: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.max(cx, cy)
  if (mode === "rect-to-polar") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const angle = (x / w) * Math.PI * 2
        const radius = (1 - y / h) * maxR
        const sx = cx + Math.cos(angle) * radius
        const sy = cy - Math.sin(angle) * radius
        const i = (y * w + x) * 4
        if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
          const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
        }
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(-dy, dx)
        const sx = ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * w
        const sy = (1 - dist / maxR) * h
        const i = (y * w + x) * 4
        if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
          const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

function adaptiveWideAngle(src: ImageData, correction: number, fisheye: number, rotateDeg: number, scalePct: number): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.hypot(cx, cy)
  const strength = (fisheye - correction) / 100
  const rot = (-rotateDeg * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const scale = Math.max(0.1, scalePct / 100)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / scale
      const ny = (y - cy) / scale
      const rx = cos * nx - sin * ny
      const ry = sin * nx + cos * ny
      const r = Math.hypot(rx, ry) / maxR
      const barrel = 1 + strength * r * r * 0.85
      const sx = cx + rx * barrel
      const sy = cy + ry * barrel
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [rr, gg, bb, aa] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = rr
        out[i + 1] = gg
        out[i + 2] = bb
        out[i + 3] = aa
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
      }
    }
  }
  return new ImageData(out, w, h)
}

function vanishingPoint(src: ImageData, horizonPct: number, leftVanishing: number, rightVanishing: number, depth: number, showGrid: boolean): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const horizon = clamp01(horizonPct / 100)
  const left = leftVanishing / 100
  const right = rightVanishing / 100
  const depthAmount = depth / 100
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    const distanceFromHorizon = v - horizon
    const perspective = 1 + distanceFromHorizon * depthAmount * 1.8
    const rowShift = (left * (1 - v) - right * v) * w * 0.18
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2 - rowShift) / Math.max(0.18, perspective) + w / 2
      const sy = (v - horizon) / Math.max(0.18, perspective) * h + horizon * h
      const i = (y * w + x) * 4
      if (u >= 0 && u < w - 1 && sy >= 0 && sy < h - 1) {
        const [rr, gg, bb, aa] = bilinearSample(src.data, w, h, u, sy)
        out[i] = rr
        out[i + 1] = gg
        out[i + 2] = bb
        out[i + 3] = aa
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
      }
      if (showGrid && ((Math.round(u) % 64 === 0) || (Math.round(sy) % 64 === 0))) {
        out[i] = clamp8(out[i] * 0.55 + 38)
        out[i + 1] = clamp8(out[i + 1] * 0.55 + 160)
        out[i + 2] = clamp8(out[i + 2] * 0.55 + 255)
        out[i + 3] = Math.max(out[i + 3], 190)
      }
    }
  }
  return new ImageData(out, w, h)
}

function skyReplacement(src: ImageData, horizonPct: number, tolerance: number, blend: number, warmth: number, seed: number): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data)
  const horizon = Math.round((horizonPct / 100) * h)
  const tol = tolerance / 100
  const mix = blend / 100
  const warm = warmth / 100
  const top = { r: 52 + warm * 42, g: 130 + warm * 18, b: 230 - warm * 30 }
  const mid = { r: 150 + warm * 52, g: 198 + warm * 22, b: 245 - warm * 18 }
  const low = { r: 245 + warm * 10, g: 208 + warm * 24, b: 166 - warm * 30 }
  for (let y = 0; y < Math.min(h, horizon); y++) {
    const ty = y / Math.max(1, horizon)
    const base = ty < 0.62
      ? {
          r: top.r + (mid.r - top.r) * (ty / 0.62),
          g: top.g + (mid.g - top.g) * (ty / 0.62),
          b: top.b + (mid.b - top.b) * (ty / 0.62),
        }
      : {
          r: mid.r + (low.r - mid.r) * ((ty - 0.62) / 0.38),
          g: mid.g + (low.g - mid.g) * ((ty - 0.62) / 0.38),
          b: mid.b + (low.b - mid.b) * ((ty - 0.62) / 0.38),
        }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (out[i + 3] === 0) continue
      const hsl = rgbToHsl(out[i], out[i + 1], out[i + 2])
      const blueHue = hsl.h > 0.50 && hsl.h < 0.72
      const brightNeutral = hsl.l > 0.62 && hsl.s < 0.28
      const upperBias = 1 - ty * 0.42
      const mask = clamp01(((blueHue ? hsl.s : 0) + (brightNeutral ? 0.38 : 0) + tol - 0.22) * upperBias)
      if (mask <= 0) continue
      const cloud = fbmNoise(x / w * 4.2, y / h * 3.4, seed, 5)
      const cloudLift = Math.max(0, cloud - 0.55) * 80
      const localMix = mask * mix
      out[i] = clamp8(out[i] * (1 - localMix) + (base.r + cloudLift) * localMix)
      out[i + 1] = clamp8(out[i + 1] * (1 - localMix) + (base.g + cloudLift) * localMix)
      out[i + 2] = clamp8(out[i + 2] * (1 - localMix) + (base.b + cloudLift) * localMix)
    }
  }
  return new ImageData(out, w, h)
}

/* ====================== RENDER FILTERS ================================= */

// Perlin-style noise helpers
function perlinFade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function perlinLerp(a: number, b: number, t: number) { return a + t * (b - a) }

function perlinNoise2D(x: number, y: number, seed: number): number {
  // Hash-based gradient noise
  const hash = (ix: number, iy: number) => {
    let h = ix * 374761393 + iy * 668265263 + seed * 1274126177
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return h
  }
  const grad = (h: number, dx: number, dy: number) => {
    const g = h & 3
    return (g === 0 ? dx + dy : g === 1 ? -dx + dy : g === 2 ? dx - dy : -dx - dy)
  }
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const u = perlinFade(fx), v = perlinFade(fy)
  const n00 = grad(hash(ix, iy), fx, fy)
  const n10 = grad(hash(ix + 1, iy), fx - 1, fy)
  const n01 = grad(hash(ix, iy + 1), fx, fy - 1)
  const n11 = grad(hash(ix + 1, iy + 1), fx - 1, fy - 1)
  return perlinLerp(perlinLerp(n00, n10, u), perlinLerp(n01, n11, u), v)
}

function fbmNoise(x: number, y: number, seed: number, octaves: number = 6): number {
  let value = 0, amp = 0.5, freq = 1
  for (let i = 0; i < octaves; i++) {
    value += amp * perlinNoise2D(x * freq, y * freq, seed + i * 37)
    amp *= 0.5
    freq *= 2
  }
  return value * 0.5 + 0.5 // normalize to [0,1]
}

function renderClouds(src: ImageData, scale: number, seed: number, difference: boolean): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const sc = Math.max(1, scale) / 50
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbmNoise(x / w / sc, y / h / sc, seed)
      const v = clamp8(n * 255)
      const i = (y * w + x) * 4
      if (difference) {
        out[i] = Math.abs(out[i] - v)
        out[i + 1] = Math.abs(out[i + 1] - v)
        out[i + 2] = Math.abs(out[i + 2] - v)
      } else {
        out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255
      }
    }
  }
  return new ImageData(out, w, h)
}

function renderFibers(src: ImageData, variance: number, strength: number, seed: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const sc = variance / 16
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Fibers: heavily directional noise (mostly vertical variation)
      const n1 = fbmNoise(x / w * sc * 0.3, y / h * sc * 4, seed)
      const n2 = fbmNoise(x / w * sc * 0.5 + 10, y / h * sc * 6 + 10, seed + 99)
      const v = clamp8(((n1 * 0.6 + n2 * 0.4) * strength / 4) * 255)
      const i = (y * w + x) * 4
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255
    }
  }
  return new ImageData(out, w, h)
}

function renderLensFlare(src: ImageData, brightness: number, cxPct: number, cyPct: number, _lens: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const fx = (cxPct / 100) * w, fy = (cyPct / 100) * h
  const br = brightness / 100
  const maxR = Math.max(w, h) * 0.6
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - fx, dy = y - fy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      // Main glow
      const glow = Math.max(0, 1 - dist / maxR)
      const mainFlare = Math.pow(glow, 3) * 255 * br
      // Bright core
      const core = Math.pow(Math.max(0, 1 - dist / (maxR * 0.05)), 2) * 255 * br * 2
      // Rays (8-point star)
      const angle = Math.atan2(dy, dx)
      const ray = Math.pow(Math.abs(Math.cos(angle * 4)), 32) * Math.max(0, 1 - dist / (maxR * 0.4)) * 120 * br
      // Chromatic ring
      const ring = Math.exp(-Math.pow((dist - maxR * 0.3) / (maxR * 0.03), 2)) * 80 * br
      // Secondary flare (opposite side)
      const dx2 = x - (w - fx), dy2 = y - (h - fy)
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
      const sec = Math.pow(Math.max(0, 1 - dist2 / (maxR * 0.15)), 3) * 60 * br

      out[i] = clamp8(out[i] + mainFlare + core + ray + ring * 0.3 + sec * 0.7)
      out[i + 1] = clamp8(out[i + 1] + mainFlare + core + ray + ring * 0.8 + sec * 0.5)
      out[i + 2] = clamp8(out[i + 2] + mainFlare + core + ray * 0.7 + ring + sec * 1.2)
    }
  }
  return new ImageData(out, w, h)
}

/* ====================== OTHER FILTERS ================================== */

function filterHighPass(src: ImageData, radius: number): ImageData {
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

function filterOffset(src: ImageData, dx: number, dy: number, edgeMode: string): ImageData {
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

function filterMaxMin(src: ImageData, radius: number, isMax: boolean): ImageData {
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

function smartSharpen(src: ImageData, amount: number, radius: number, threshold: number, shadowFade: number, highlightFade: number): ImageData {
  const blurred = gaussianBlur(src, Math.max(0.5, radius))
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const k = amount / 100
  const shadowK = 1 - shadowFade / 100
  const highlightK = 1 - highlightFade / 100

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

    // Fade factor based on luminosity (shadow/highlight protection)
    let fade = 1
    if (lum < 64) fade *= shadowK + (1 - shadowK) * (lum / 64)
    else if (lum > 192) fade *= highlightK + (1 - highlightK) * ((255 - lum) / 63)

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

function lensBlur(src: ImageData, radius: number, bladeCount: number, rotation: number, specBright: number, specThreshold: number, noiseAmt: number, noiseMono: boolean): ImageData {
  if (radius < 1) return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const w = src.width, h = src.height
  const r = Math.max(1, Math.min(40, Math.round(radius)))
  const blades = Math.max(3, Math.min(8, Math.round(bladeCount)))

  // Build hexagonal/polygon kernel
  const kernel: number[][] = []
  let kernelTotal = 0
  const rotRad = rotation * Math.PI / 180
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky)
      if (dist > r) continue
      // Check if point is inside polygon
      const angle = Math.atan2(ky, kx) - rotRad
      const segment = (2 * Math.PI) / blades
      const localAngle = ((angle % segment) + segment) % segment
      const polyRadius = r / Math.cos(Math.PI / blades - localAngle)
      if (dist <= Math.abs(polyRadius)) {
        kernel.push([kx, ky, 1])
        kernelTotal++
      }
    }
  }
  if (kernelTotal === 0) return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)

  const out = new Uint8ClampedArray(src.data.length)
  const specK = specBright / 100

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, wSum = 0
      for (const [kx, ky] of kernel) {
        const sx = Math.max(0, Math.min(w - 1, x + kx))
        const sy = Math.max(0, Math.min(h - 1, y + ky))
        const si = (sy * w + sx) * 4
        // Weight brighter pixels more for specular highlights
        let weight = 1
        if (specK > 0) {
          const lum = Math.max(src.data[si], src.data[si + 1], src.data[si + 2])
          if (lum > specThreshold) weight = 1 + (lum - specThreshold) / 255 * specK * 4
        }
        rSum += src.data[si] * weight
        gSum += src.data[si + 1] * weight
        bSum += src.data[si + 2] * weight
        aSum += src.data[si + 3] * weight
        wSum += weight
      }
      const idx = (y * w + x) * 4
      out[idx] = clamp8(rSum / wSum)
      out[idx + 1] = clamp8(gSum / wSum)
      out[idx + 2] = clamp8(bSum / wSum)
      out[idx + 3] = clamp8(aSum / wSum)
    }
  }

  // Add noise if requested
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

function surfaceBlur(src: ImageData, radius: number, threshold: number): ImageData {
  if (radius <= 0 || threshold <= 0) return clone(src)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(18, Math.round(radius)))
  const t = Math.max(0, Math.min(255, threshold))
  const sigmaS = Math.max(0.75, r * 0.65)
  const sigmaR = Math.max(1, t * 0.55)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const baseLum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let rs = 0, gs = 0, bs = 0, as = 0, weightSum = 0
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(h - 1, y + oy))
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue
          const sx = Math.max(0, Math.min(w - 1, x + ox))
          const p = (sy * w + sx) * 4
          const diff = Math.abs(luma(src.data[p], src.data[p + 1], src.data[p + 2]) - baseLum)
          if (diff <= t) {
            const spatial = Math.exp(-(ox * ox + oy * oy) / (2 * sigmaS * sigmaS))
            const range = Math.exp(-(diff * diff) / (2 * sigmaR * sigmaR))
            const weight = spatial * range
            rs += src.data[p] * weight; gs += src.data[p + 1] * weight; bs += src.data[p + 2] * weight; as += src.data[p + 3] * weight
            weightSum += weight
          }
        }
      }
      out[i] = weightSum ? rs / weightSum : src.data[i]
      out[i + 1] = weightSum ? gs / weightSum : src.data[i + 1]
      out[i + 2] = weightSum ? bs / weightSum : src.data[i + 2]
      out[i + 3] = weightSum ? as / weightSum : src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

function radialBlur(src: ImageData, amount: number, method: string, quality: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2
  const strength = Math.max(0, Math.min(100, amount)) / 100
  const steps = quality === "best" ? 28 : quality === "good" ? 16 : 8
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0
      const dx = x - cx, dy = y - cy
      for (let s = 0; s < steps; s++) {
        const t = (s / Math.max(1, steps - 1) - 0.5) * strength
        let sx = x, sy = y
        if (method === "zoom") {
          sx = cx + dx * (1 + t * 0.9)
          sy = cy + dy * (1 + t * 0.9)
        } else {
          const angle = t * Math.PI * 0.45
          const cos = Math.cos(angle), sin = Math.sin(angle)
          sx = cx + dx * cos - dy * sin
          sy = cy + dx * sin + dy * cos
        }
        const sample = bilinearSample(src.data, w, h, sx, sy)
        rs += sample[0]; gs += sample[1]; bs += sample[2]; as += sample[3]
      }
      const i = (y * w + x) * 4
      out[i] = rs / steps; out[i + 1] = gs / steps; out[i + 2] = bs / steps; out[i + 3] = as / steps
    }
  }
  return new ImageData(out, w, h)
}

function oilPaint(src: ImageData, radius: number, levels: number, shine: number): ImageData {
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

function glassDistort(src: ImageData, distortion: number, smoothness: number, texture: string, scale: number): ImageData {
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

function mixBlurredByWeight(src: ImageData, blurred: ImageData, weightForPixel: (x: number, y: number) => number) {
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

function fieldBlur(src: ImageData, blur: number, centerX: number, centerY: number, falloff: number) {
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

function irisBlur(src: ImageData, blur: number, centerX: number, centerY: number, radius: number, feather: number) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const rx = Math.max(1, src.width * (radius / 100) * 0.5)
  const ry = Math.max(1, src.height * (radius / 100) * 0.5)
  const featherWidth = Math.max(0.01, feather / 100)
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry)
    return (d - 1) / featherWidth
  })
}

function tiltShiftBlur(src: ImageData, blur: number, angle: number, radius: number, feather: number) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const radians = (angle * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const cx = (src.width - 1) / 2
  const cy = (src.height - 1) / 2
  const clearBand = Math.max(1, Math.min(src.width, src.height) * (radius / 100) * 0.5)
  const featherBand = Math.max(1, Math.min(src.width, src.height) * (feather / 100))
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.abs((x - cx) * nx + (y - cy) * ny)
    return (d - clearBand) / featherBand
  })
}

function pathBlur(src: ImageData, distance: number, angle: number, taper: number) {
  const blurred = motionBlur(src, Math.max(1, distance), angle)
  const taperAmount = clamp01(taper / 100)
  if (taperAmount <= 0) return blurred
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const edge = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
    return 1 - clamp01(edge / (Math.min(src.width, src.height) * 0.5) * taperAmount)
  })
}

function spinBlur(src: ImageData, amount: number, centerX: number, centerY: number) {
  const shifted = radialBlur(src, Math.max(1, amount), "spin", "best")
  if (centerX === 50 && centerY === 50) return shifted
  const field = fieldBlur(src, Math.max(1, amount / 4), centerX, centerY, 40)
  return mixBlurredByWeight(field, shifted, () => 0.65)
}

function lensCorrection(src: ImageData, distortion: number, vignette: number, chromatic: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const maxR = Math.max(1, Math.hypot(cx, cy))
  const k1 = distortion / 160
  const k2 = distortion / 420
  const ca = chromatic / 100
  const vig = vignette / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const nx = dx / maxR, ny = dy / maxR
      const r2 = nx * nx + ny * ny
      const factor = 1 + k1 * r2 + k2 * r2 * r2
      const sx = cx + dx * factor
      const sy = cy + dy * factor
      const chromaShift = ca * (0.3 + r2) * 1.35
      const red = bilinearSample(src.data, w, h, sx + nx * chromaShift, sy + ny * chromaShift)
      const mid = bilinearSample(src.data, w, h, sx, sy)
      const blue = bilinearSample(src.data, w, h, sx - nx * chromaShift, sy - ny * chromaShift)
      const radial = Math.pow(clamp01(Math.sqrt(r2)), 1.7)
      const shade = vig >= 0 ? clamp01(1 - vig * radial * 0.85) : 1 + Math.abs(vig) * radial * 0.55
      const i = (y * w + x) * 4
      out[i] = clamp8(red[0] * shade)
      out[i + 1] = clamp8(mid[1] * shade)
      out[i + 2] = clamp8(blue[2] * shade)
      out[i + 3] = mid[3]
    }
  }
  return new ImageData(out, w, h)
}

function colorHalftone(src: ImageData, radius: number, angle: number): ImageData {
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

function mezzotint(src: ImageData, type: string, density: number): ImageData {
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

function lightingEffects(src: ImageData, style: string, intensity: number, ambient: number, height: number): ImageData {
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
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1)
      const right = (y * w + xr) * 4
      const left = (y * w + xl) * 4
      const down = (yd * w + x) * 4
      const up = (yu * w + x) * 4
      const lumX = luma(src.data[right], src.data[right + 1], src.data[right + 2]) - luma(src.data[left], src.data[left + 1], src.data[left + 2])
      const lumY = luma(src.data[down], src.data[down + 1], src.data[down + 2]) - luma(src.data[up], src.data[up + 1], src.data[up + 2])
      const nx = -lumX / 255 * heightScale
      const ny = -lumY / 255 * heightScale
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

function customConvolution(src: ImageData, preset: string, strength: number, bias: number): ImageData {
  const kernels: Record<string, number[]> = {
    "sharpen-more": [0, -1, 0, -1, 5, -1, 0, -1, 0],
    "edge-enhance": [0, 0, 0, -1, 1, 0, 0, 0, 0],
    outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    "sobel-x": [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    "sobel-y": [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  }
  const raw = convolve(src, kernels[preset] ?? kernels["sharpen-more"], 1)
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

/* --------- REDUCE NOISE (Bilateral Filter) --------- */

function reduceNoise(src: ImageData, strength: number, colorNoise: number, detail: number, sharpen: number): ImageData {
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

function dustAndScratches(src: ImageData, radius: number, threshold: number): ImageData {
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

function averageBlur(src: ImageData): ImageData {
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

function smartBlur(src: ImageData, radius: number, threshold: number): ImageData {
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

function despeckle(src: ImageData): ImageData {
  return smartBlur(src, 1.4, 42)
}

function ntscColors(src: ImageData): ImageData {
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

function deInterlace(src: ImageData, field: string): ImageData {
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

function glowingEdges(src: ImageData, width: number, brightness: number, smooth: number): ImageData {
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

function wind(src: ImageData, strength: number, direction: string): ImageData {
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

function extrude(src: ImageData, depth: number, mode: string): ImageData {
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

function renderFlame(src: ImageData, heightPct: number, turbulence: number): ImageData {
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

function pictureFrame(src: ImageData, size: number, color: string): ImageData {
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

function renderTree(src: ImageData, branches: number, leaves: boolean): ImageData {
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

function displace(src: ImageData, scale: number, mode: string): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const n1 = fbmNoise(x / 90, y / 90, 13, 4) - 0.5
      const n2 = fbmNoise(x / 90, y / 90, 29, 4) - 0.5
      const sx = mode === "vertical" ? x : x + n1 * scale
      const sy = mode === "horizontal" ? y : y + n2 * scale
      copySample(src, out, x, y, sx, sy)
    }
  }
  return new ImageData(out, src.width, src.height)
}

function shapeBlur(src: ImageData, radius: number, shape: string): ImageData {
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

function diffuseGlow(src: ImageData, grain: number, glow: number, clear: number): ImageData {
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

function oceanRipple(src: ImageData, size: number, magnitude: number): ImageData {
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

function galleryStylize(src: ImageData, style: string, intensity: number): ImageData {
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

function addProceduralGrain(src: ImageData, amount: number, salt: string): ImageData {
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

function posterizeImage(src: ImageData, levels: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(out[i] / step) * step
    out[i + 1] = Math.round(out[i + 1] / step) * step
    out[i + 2] = Math.round(out[i + 2] / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

function embossLike(src: ImageData, amount: number): ImageData {
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

function blendImageData(src: ImageData, work: ImageData, amount: number): ImageData {
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

function coloredPencilFilter(src: ImageData, intensity: number): ImageData {
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

function dryBrushFilter(src: ImageData, intensity: number): ImageData {
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

function watercolorFilter(src: ImageData, intensity: number): ImageData {
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

function crosshatchFilter(src: ImageData, intensity: number): ImageData {
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

function graphicPenFilter(src: ImageData, intensity: number): ImageData {
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

function craquelureFilter(src: ImageData, intensity: number): ImageData {
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

function mosaicTilesFilter(src: ImageData, intensity: number): ImageData {
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

function copySample(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number) {
  const ix = Math.max(0, Math.min(src.width - 1, Math.round(sx)))
  const iy = Math.max(0, Math.min(src.height - 1, Math.round(sy)))
  const s = (iy * src.width + ix) * 4
  const d = (y * src.width + x) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

function parseHexColor(color: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "111827"
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function hashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

function legacyGalleryDefs(items: { id: string; name: string; category: string; intensity?: number }[]) {
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

function promotedGalleryDef(
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

const PROMOTED_GALLERY_FILTERS: Record<string, FilterDef> = {
  "colored-pencil": promotedGalleryDef("colored-pencil", "Colored Pencil", "Artistic", coloredPencilFilter),
  "dry-brush": promotedGalleryDef("dry-brush", "Dry Brush", "Artistic", dryBrushFilter),
  watercolor: promotedGalleryDef("watercolor", "Watercolor", "Artistic", watercolorFilter),
  crosshatch: promotedGalleryDef("crosshatch", "Crosshatch", "Brush Strokes", crosshatchFilter),
  "graphic-pen": promotedGalleryDef("graphic-pen", "Graphic Pen", "Sketch", graphicPenFilter),
  craquelure: promotedGalleryDef("craquelure", "Craquelure", "Texture", craquelureFilter),
  "mosaic-tiles": promotedGalleryDef("mosaic-tiles", "Mosaic Tiles", "Texture", mosaicTilesFilter),
}

const LEGACY_GAP_FILTERS: Record<string, FilterDef> = {
  ...legacyGalleryDefs([
    { id: "colored-pencil", name: "Colored Pencil", category: "Artistic" },
    { id: "cutout", name: "Cutout", category: "Artistic" },
    { id: "dry-brush", name: "Dry Brush", category: "Artistic" },
    { id: "film-grain", name: "Film Grain", category: "Artistic" },
    { id: "fresco", name: "Fresco", category: "Artistic" },
    { id: "neon-glow", name: "Neon Glow", category: "Artistic" },
    { id: "paint-daubs", name: "Paint Daubs", category: "Artistic" },
    { id: "palette-knife", name: "Palette Knife", category: "Artistic" },
    { id: "plastic-wrap", name: "Plastic Wrap", category: "Artistic" },
    { id: "poster-edges", name: "Poster Edges", category: "Artistic" },
    { id: "rough-pastels", name: "Rough Pastels", category: "Artistic" },
    { id: "smudge-stick", name: "Smudge Stick", category: "Artistic" },
    { id: "sponge-filter", name: "Sponge", category: "Artistic" },
    { id: "underpainting", name: "Underpainting", category: "Artistic" },
    { id: "watercolor", name: "Watercolor", category: "Artistic" },
    { id: "accented-edges", name: "Accented Edges", category: "Brush Strokes" },
    { id: "angled-strokes", name: "Angled Strokes", category: "Brush Strokes" },
    { id: "crosshatch", name: "Crosshatch", category: "Brush Strokes" },
    { id: "dark-strokes", name: "Dark Strokes", category: "Brush Strokes" },
    { id: "ink-outlines", name: "Ink Outlines", category: "Brush Strokes" },
    { id: "spatter", name: "Spatter", category: "Brush Strokes" },
    { id: "sprayed-strokes", name: "Sprayed Strokes", category: "Brush Strokes" },
    { id: "sumi-e", name: "Sumi-e", category: "Brush Strokes" },
    { id: "bas-relief", name: "Bas Relief", category: "Sketch" },
    { id: "chalk-charcoal", name: "Chalk & Charcoal", category: "Sketch" },
    { id: "charcoal", name: "Charcoal", category: "Sketch" },
    { id: "chrome", name: "Chrome", category: "Sketch" },
    { id: "conte-crayon", name: "Conte Crayon", category: "Sketch" },
    { id: "graphic-pen", name: "Graphic Pen", category: "Sketch" },
    { id: "halftone-pattern", name: "Halftone Pattern", category: "Sketch" },
    { id: "note-paper", name: "Note Paper", category: "Sketch" },
    { id: "photocopy", name: "Photocopy", category: "Sketch" },
    { id: "plaster", name: "Plaster", category: "Sketch" },
    { id: "reticulation", name: "Reticulation", category: "Sketch" },
    { id: "stamp-filter", name: "Stamp", category: "Sketch" },
    { id: "torn-edges", name: "Torn Edges", category: "Sketch" },
    { id: "water-paper", name: "Water Paper", category: "Sketch" },
    { id: "craquelure", name: "Craquelure", category: "Texture" },
    { id: "grain", name: "Grain", category: "Texture" },
    { id: "mosaic-tiles", name: "Mosaic Tiles", category: "Texture" },
    { id: "patchwork", name: "Patchwork", category: "Texture" },
    { id: "stained-glass", name: "Stained Glass", category: "Texture" },
    { id: "texturizer", name: "Texturizer", category: "Texture" },
  ]),
  ...PROMOTED_GALLERY_FILTERS,
  "average-blur": { id: "average-blur", name: "Average", category: "Blur", params: [], apply: (src) => averageBlur(src) },
  "blur-more": { id: "blur-more", name: "Blur More", category: "Blur", params: [], apply: (src) => boxBlur(src, 3) },
  "smart-blur": {
    id: "smart-blur",
    name: "Smart Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 32, step: 0.1, default: 4, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 38 },
    ],
    apply: (src, p) => smartBlur(src, Number(p.radius), Number(p.threshold)),
  },
  "shape-blur": {
    id: "shape-blur",
    name: "Shape Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 40, step: 1, default: 8, suffix: "px" },
      { type: "select", key: "shape", label: "Shape", options: [
        { value: "circle", label: "Circle" },
        { value: "diamond", label: "Diamond" },
        { value: "line", label: "Line" },
      ], default: "circle" },
    ],
    apply: (src, p) => shapeBlur(src, Number(p.radius), String(p.shape)),
  },
  despeckle: { id: "despeckle", name: "Despeckle", category: "Noise", params: [], apply: (src) => despeckle(src) },
  "ntsc-colors": { id: "ntsc-colors", name: "NTSC Colors", category: "Video", params: [], apply: (src) => ntscColors(src) },
  "de-interlace": {
    id: "de-interlace",
    name: "De-Interlace",
    category: "Video",
    params: [
      { type: "select", key: "field", label: "Field", options: [
        { value: "even", label: "Even" },
        { value: "odd", label: "Odd" },
      ], default: "even" },
    ],
    apply: (src, p) => deInterlace(src, String(p.field)),
  },
  "glowing-edges": {
    id: "glowing-edges",
    name: "Glowing Edges",
    category: "Stylize",
    params: [
      { type: "slider", key: "width", label: "Edge Width", min: 1, max: 14, step: 1, default: 4 },
      { type: "slider", key: "brightness", label: "Brightness", min: 0, max: 100, step: 1, default: 55 },
      { type: "slider", key: "smooth", label: "Smoothness", min: 0, max: 10, step: 1, default: 2 },
    ],
    apply: (src, p) => glowingEdges(src, Number(p.width), Number(p.brightness), Number(p.smooth)),
  },
  wind: {
    id: "wind",
    name: "Wind",
    category: "Stylize",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: 1, max: 30, step: 1, default: 12 },
      { type: "select", key: "direction", label: "Direction", options: [
        { value: "right", label: "From Left" },
        { value: "left", label: "From Right" },
      ], default: "right" },
    ],
    apply: (src, p) => wind(src, Number(p.strength), String(p.direction)),
  },
  extrude: {
    id: "extrude",
    name: "Extrude",
    category: "Stylize",
    params: [
      { type: "slider", key: "depth", label: "Depth", min: 1, max: 80, step: 1, default: 18, suffix: "px" },
      { type: "select", key: "mode", label: "Type", options: [
        { value: "blocks", label: "Blocks" },
        { value: "pyramid", label: "Pyramids" },
      ], default: "blocks" },
    ],
    apply: (src, p) => extrude(src, Number(p.depth), String(p.mode)),
  },
  flame: {
    id: "flame",
    name: "Flame",
    category: "Render",
    params: [
      { type: "slider", key: "height", label: "Height", min: 10, max: 100, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "turbulence", label: "Turbulence", min: 0, max: 100, step: 1, default: 55, suffix: "%" },
    ],
    apply: (src, p) => renderFlame(src, Number(p.height), Number(p.turbulence)),
  },
  "picture-frame": {
    id: "picture-frame",
    name: "Picture Frame",
    category: "Render",
    params: [
      { type: "slider", key: "size", label: "Frame Size", min: 1, max: 120, step: 1, default: 28, suffix: "px" },
      { type: "select", key: "color", label: "Color", options: [
        { value: "#111827", label: "Graphite" },
        { value: "#8b5cf6", label: "Violet" },
        { value: "#f8fafc", label: "White" },
        { value: "#92400e", label: "Walnut" },
      ], default: "#111827" },
    ],
    apply: (src, p) => pictureFrame(src, Number(p.size), String(p.color)),
  },
  tree: {
    id: "tree",
    name: "Tree",
    category: "Render",
    params: [
      { type: "slider", key: "branches", label: "Branches", min: 2, max: 5, step: 1, default: 3 },
      { type: "checkbox", key: "leaves", label: "Leaves", default: true },
    ],
    apply: (src, p) => renderTree(src, Number(p.branches), Boolean(p.leaves)),
  },
  displace: {
    id: "displace",
    name: "Displace",
    category: "Distort",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 0, max: 100, step: 1, default: 24 },
      { type: "select", key: "mode", label: "Direction", options: [
        { value: "both", label: "Horizontal and Vertical" },
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ], default: "both" },
    ],
    apply: (src, p) => displace(src, Number(p.scale), String(p.mode)),
  },
  "diffuse-glow": {
    id: "diffuse-glow",
    name: "Diffuse Glow",
    category: "Distort",
    params: [
      { type: "slider", key: "grain", label: "Graininess", min: 0, max: 100, step: 1, default: 35 },
      { type: "slider", key: "glow", label: "Glow Amount", min: 0, max: 100, step: 1, default: 45 },
      { type: "slider", key: "clear", label: "Clear Amount", min: 0, max: 100, step: 1, default: 35 },
    ],
    apply: (src, p) => diffuseGlow(src, Number(p.grain), Number(p.glow), Number(p.clear)),
  },
  "ocean-ripple": {
    id: "ocean-ripple",
    name: "Ocean Ripple",
    category: "Distort",
    params: [
      { type: "slider", key: "size", label: "Ripple Size", min: 4, max: 80, step: 1, default: 18 },
      { type: "slider", key: "magnitude", label: "Magnitude", min: 0, max: 50, step: 1, default: 12 },
    ],
    apply: (src, p) => oceanRipple(src, Number(p.size), Number(p.magnitude)),
  },
}

/* --------------------------- DEFINITIONS ------------------------------- */

export const FILTERS: Record<string, FilterDef> = {
  "gaussian-blur": {
    id: "gaussian-blur",
    name: "Gaussian Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 0.1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => gaussianBlur(src, Number(p.radius)),
  },
  "box-blur": {
    id: "box-blur",
    name: "Box Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => boxBlur(src, Number(p.radius)),
  },
  "motion-blur": {
    id: "motion-blur",
    name: "Motion Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "°" },
      { type: "slider", key: "distance", label: "Distance", min: 1, max: 100, step: 1, default: 12, suffix: "px" },
    ],
    apply: (src, p) => motionBlur(src, Number(p.distance), Number(p.angle)),
  },
  "field-blur": {
    id: "field-blur",
    name: "Field Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 12, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "falloff", label: "Falloff", min: 0, max: 100, step: 1, default: 45, suffix: "%" },
    ],
    apply: (src, p) => fieldBlur(src, Number(p.blur), Number(p.centerX), Number(p.centerY), Number(p.falloff)),
  },
  "iris-blur": {
    id: "iris-blur",
    name: "Iris Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 14, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "radius", label: "Iris Radius", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => irisBlur(src, Number(p.blur), Number(p.centerX), Number(p.centerY), Number(p.radius), Number(p.feather)),
  },
  "tilt-shift": {
    id: "tilt-shift",
    name: "Tilt-Shift",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 16, suffix: "px" },
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "radius", label: "Sharp Band", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => tiltShiftBlur(src, Number(p.blur), Number(p.angle), Number(p.radius), Number(p.feather)),
  },
  "path-blur": {
    id: "path-blur",
    name: "Path Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "distance", label: "Speed", min: 1, max: 160, step: 1, default: 24, suffix: "px" },
      { type: "slider", key: "angle", label: "Direction", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "taper", label: "Taper", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
    ],
    apply: (src, p) => pathBlur(src, Number(p.distance), Number(p.angle), Number(p.taper)),
  },
  "spin-blur": {
    id: "spin-blur",
    name: "Spin Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "amount", label: "Angle", min: 1, max: 100, step: 1, default: 28 },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => spinBlur(src, Number(p.amount), Number(p.centerX), Number(p.centerY)),
  },
  sharpen: {
    id: "sharpen",
    name: "Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 200, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => sharpen(src, Number(p.amount)),
  },
  "find-edges": {
    id: "find-edges",
    name: "Find Edges",
    category: "Stylize",
    params: [],
    apply: (src) => findEdges(src),
  },
  emboss: {
    id: "emboss",
    name: "Emboss",
    category: "Stylize",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => emboss(src, Number(p.amount)),
  },
  solarize: {
    id: "solarize",
    name: "Solarize",
    category: "Stylize",
    params: [
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 128 },
    ],
    apply: (src, p) => solarize(src, Number(p.threshold)),
  },
  pixelate: {
    id: "pixelate",
    name: "Pixelate (Mosaic)",
    category: "Stylize",
    params: [
      { type: "slider", key: "size", label: "Cell size", min: 2, max: 64, step: 1, default: 8, suffix: "px" },
    ],
    apply: (src, p) => pixelate(src, Number(p.size)),
  },
  noise: {
    id: "noise",
    name: "Add Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 25 },
      { type: "select", key: "distribution", label: "Distribution", options: [
        { value: "uniform", label: "Uniform" },
        { value: "gaussian", label: "Gaussian" },
      ], default: "uniform" },
      { type: "checkbox", key: "mono", label: "Monochromatic", default: false },
    ],
    apply: (src, p) => noise(src, Number(p.amount), Boolean(p.mono), String(p.distribution) === "gaussian"),
  },

  /* Adjustments */
  "brightness-contrast": {
    id: "brightness-contrast",
    name: "Brightness/Contrast",
    category: "Adjustments",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: -150, max: 150, step: 1, default: 0 },
      { type: "slider", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "useLegacy", label: "Use Legacy", default: false },
    ],
    apply: (src, p) => brightnessContrast(src, Number(p.brightness), Number(p.contrast), parseBool(p.useLegacy)),
  },
  "hue-saturation": {
    id: "hue-saturation",
    name: "Hue/Saturation",
    category: "Adjustments",
    params: [
      { type: "select", key: "range", label: "Range", options: [
        { value: "master", label: "Master" },
        { value: "reds", label: "Reds" },
        { value: "yellows", label: "Yellows" },
        { value: "greens", label: "Greens" },
        { value: "cyans", label: "Cyans" },
        { value: "blues", label: "Blues" },
        { value: "magentas", label: "Magentas" },
      ], default: "master" },
      { type: "slider", key: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0, suffix: "°" },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "lightness", label: "Lightness", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "colorize", label: "Colorize", default: false },
    ],
    apply: (src, p) =>
      hueSaturation(
        src,
        Number(p.hue),
        Number(p.saturation),
        Number(p.lightness),
        String(p.range ?? "master") as HueRange,
        parseBool(p.colorize),
      ),
  },
  levels: {
    id: "levels",
    name: "Levels",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "inputBlack", label: "Input Black", min: 0, max: 254, step: 1, default: 0 },
      { type: "slider", key: "inputWhite", label: "Input White", min: 1, max: 255, step: 1, default: 255 },
      { type: "slider", key: "gamma", label: "Gamma", min: 0.1, max: 9.99, step: 0.01, default: 1 },
      { type: "slider", key: "outputBlack", label: "Output Black", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "outputWhite", label: "Output White", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) =>
      levels(
        src,
        Number(p.inputBlack),
        Number(p.inputWhite),
        Number(p.gamma),
        Number(p.outputBlack),
        Number(p.outputWhite),
        String(p.channel ?? "rgb"),
      ),
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "Adjustments",
    params: [
      { type: "slider", key: "level", label: "Threshold Level", min: 0, max: 255, step: 1, default: 128 },
    ],
    apply: (src, p) => threshold(src, Number(p.level)),
  },
  posterize: {
    id: "posterize",
    name: "Posterize",
    category: "Adjustments",
    params: [
      { type: "slider", key: "levels", label: "Levels", min: 2, max: 32, step: 1, default: 4 },
    ],
    apply: (src, p) => posterize(src, Number(p.levels)),
  },
  vibrance: {
    id: "vibrance",
    name: "Vibrance",
    category: "Adjustments",
    params: [
      { type: "slider", key: "amount", label: "Vibrance", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => vibranceAdvanced(src, Number(p.amount), Number(p.saturation ?? 0)),
  },
  invert: {
    id: "invert",
    name: "Invert",
    category: "Adjustments",
    params: [],
    apply: (src) => invert(src),
  },
  grayscale: {
    id: "grayscale",
    name: "Black & White",
    category: "Adjustments",
    params: [],
    apply: (src) => grayscale(src),
  },
  "black-white": {
    id: "black-white",
    name: "Black & White...",
    category: "Adjustments",
    params: [
      { type: "slider", key: "reds", label: "Reds", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellows", label: "Yellows", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "greens", label: "Greens", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "cyans", label: "Cyans", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blues", label: "Blues", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentas", label: "Magentas", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "tint", label: "Tint", default: false },
      { type: "slider", key: "tintHue", label: "Tint Hue", min: 0, max: 360, step: 1, default: 38, suffix: "°" },
      { type: "slider", key: "tintSaturation", label: "Tint Saturation", min: 0, max: 100, step: 1, default: 18 },
    ],
    apply: (src, p) => blackWhiteAdvanced(
      src,
      Number(p.reds),
      Number(p.yellows),
      Number(p.greens),
      Number(p.cyans),
      Number(p.blues),
      Number(p.magentas),
      parseBool(p.tint),
      Number(p.tintHue ?? 38),
      Number(p.tintSaturation ?? 18),
    ),
  },
  sepia: {
    id: "sepia",
    name: "Sepia",
    category: "Color",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 80, suffix: "%" },
    ],
    apply: (src, p) => sepia(src, Number(p.amount)),
  },
  curves: {
    id: "curves",
    name: "Curves",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "shadow", label: "Shadow", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "midtone", label: "Midtone", min: 0, max: 255, step: 1, default: 128 },
      { type: "slider", key: "highlight", label: "Highlight", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) => curvesAdvanced(src, p),
  },
  "color-balance": {
    id: "color-balance",
    name: "Color Balance",
    category: "Adjustments",
    params: [
      { type: "select", key: "tone", label: "Tone", options: [
        { value: "shadows", label: "Shadows" },
        { value: "midtones", label: "Midtones" },
        { value: "highlights", label: "Highlights" },
      ], default: "midtones" },
      { type: "slider", key: "cyanRed", label: "Cyan / Red", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentaGreen", label: "Magenta / Green", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellowBlue", label: "Yellow / Blue", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "preserveLuminosity", label: "Preserve Luminosity", default: true },
    ],
    apply: (src, p) =>
      colorBalanceAdvanced(
        src,
        Number(p.cyanRed),
        Number(p.magentaGreen),
        Number(p.yellowBlue),
        String(p.tone ?? "midtones") as "shadows" | "midtones" | "highlights",
        parseBool(p.preserveLuminosity, true),
      ),
  },
  "photo-filter": {
    id: "photo-filter",
    name: "Photo Filter",
    category: "Adjustments",
    params: [
      {
        type: "select",
        key: "color",
        label: "Color",
        options: [
          { value: "warm", label: "Warming" },
          { value: "blue", label: "Cooling" },
          { value: "green", label: "Green" },
          { value: "magenta", label: "Magenta" },
          { value: "cyan", label: "Cyan" },
          { value: "yellow", label: "Yellow" },
        ],
        default: "warm",
      },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => photoFilter(src, String(p.color), Number(p.density)),
  },
  "channel-mixer": {
    id: "channel-mixer",
    name: "Channel Mixer",
    category: "Adjustments",
    params: [
      { type: "slider", key: "rR", label: "Red ← Red", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "rG", label: "Red ← Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "rB", label: "Red ← Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gR", label: "Green ← Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gG", label: "Green ← Green", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "gB", label: "Green ← Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bR", label: "Blue ← Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bG", label: "Blue ← Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bB", label: "Blue ← Blue", min: -200, max: 200, step: 1, default: 100 },
    ],
    apply: (src, p) =>
      channelMixer(
        src,
        Number(p.rR),
        Number(p.rG),
        Number(p.rB),
        Number(p.gR),
        Number(p.gG),
        Number(p.gB),
        Number(p.bR),
        Number(p.bG),
        Number(p.bB),
      ),
  },
  "unsharp-mask": {
    id: "unsharp-mask",
    name: "Unsharp Mask",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 100, step: 0.1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => unsharpMask(src, Number(p.amount), Number(p.radius)),
  },
  "exposure": {
    id: "exposure",
    name: "Exposure",
    category: "Adjustments",
    params: [
      { type: "slider", key: "ev", label: "EV", min: -5, max: 5, step: 0.1, default: 0 },
    ],
    apply: (src, p) => exposure(src, Number(p.ev)),
  },
  "desaturate": {
    id: "desaturate",
    name: "Desaturate",
    category: "Adjustments",
    params: [],
    apply: (src) => desaturate(src),
  },
  "equalize": {
    id: "equalize",
    name: "Equalize",
    category: "Adjustments",
    params: [],
    apply: (src) => equalize(src),
  },
  "replace-color": {
    id: "replace-color",
    name: "Replace Color",
    category: "Adjustments",
    params: [
      { type: "slider", key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 0, suffix: "°" },
      { type: "slider", key: "tolerance", label: "Tolerance", min: 0, max: 100, step: 1, default: 30 },
      { type: "slider", key: "lightness", label: "Lightness", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => replaceColor(src, Number(p.hue), Number(p.tolerance), Number(p.lightness)),
  },
  "match-color": {
    id: "match-color",
    name: "Match Color (average match)",
    category: "Adjustments",
    params: [
      { type: "slider", key: "luminance", label: "Luminance", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "colorIntensity", label: "Color Intensity", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "fade", label: "Fade", min: 0, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "neutralize", label: "Neutralize", default: false },
    ],
    apply: (src, p, context) =>
      matchColorAdvanced(
        src,
        context?.matchColorSource,
        Number(p.luminance ?? 100),
        Number(p.colorIntensity ?? 100),
        Number(p.fade ?? 0),
        parseBool(p.neutralize),
      ),
  },
  "selective-color": {
    id: "selective-color",
    name: "Selective Color",
    category: "Adjustments",
    params: [
      { type: "slider", key: "cyans", label: "Cyans", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentas", label: "Magentas", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellows", label: "Yellows", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "whites", label: "Whites", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "neutrals", label: "Neutrals", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blacks", label: "Blacks", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => selectiveColor(
      src,
      Number(p.cyans),
      Number(p.magentas),
      Number(p.yellows),
      Number(p.whites),
      Number(p.neutrals),
      Number(p.blacks)
    ),
  },
  "shadows-highlights": {
    id: "shadows-highlights",
    name: "Shadows/Highlights",
    category: "Adjustments",
    params: [
      { type: "slider", key: "shadows", label: "Shadows", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "highlights", label: "Highlights", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "midpoint", label: "Midpoint", min: 0, max: 100, step: 1, default: 50 },
    ],
    apply: (src, p) => shadowsHighlights(src, Number(p.shadows), Number(p.highlights), Number(p.midpoint)),
  },
  "hdr-toning": {
    id: "hdr-toning",
    name: "HDR Toning (local contrast)",
    category: "Adjustments",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 50, step: 1, default: 5 },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 100, step: 1, default: 50 },
    ],
    apply: (src, p) => hdrTonning(src, Number(p.radius), Number(p.strength)),
  },
  "color-lookup": {
    id: "color-lookup",
    name: "Color Lookup (LUT approximation)",
    category: "Adjustments",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => colorLookup(src, Number(p.strength)),
  },
  "gradient-map": {
    id: "gradient-map",
    name: "Gradient Map",
    category: "Adjustments",
    params: [
      { type: "checkbox", key: "reverse", label: "Reverse", default: false },
      { type: "checkbox", key: "dither", label: "Dither", default: true },
    ],
    apply: (src, p) =>
      gradientMapAdvanced(
        src,
        String(p.gradient ?? "0,#000000;1,#ffffff"),
        parseBool(p.reverse),
        parseBool(p.dither, true),
      ),
  },
  "sky-replacement": {
    id: "sky-replacement",
    name: "Sky Replacement",
    category: "Adjustments",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "tolerance", label: "Sky Detection", min: 0, max: 100, step: 1, default: 54, suffix: "%" },
      { type: "slider", key: "blend", label: "Blend", min: 0, max: 100, step: 1, default: 82, suffix: "%" },
      { type: "slider", key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, default: 12 },
      { type: "slider", key: "seed", label: "Cloud Seed", min: 0, max: 999, step: 1, default: 4 },
    ],
    apply: (src, p) => skyReplacement(src, Number(p.horizon), Number(p.tolerance), Number(p.blend), Number(p.warmth), Number(p.seed)),
  },

  /* ======================== DISTORT FILTERS ======================== */

  "adaptive-wide-angle": {
    id: "adaptive-wide-angle",
    name: "Adaptive Wide Angle",
    category: "Distort",
    params: [
      { type: "slider", key: "correction", label: "Correction", min: -100, max: 100, step: 1, default: 42 },
      { type: "slider", key: "fisheye", label: "Fisheye", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "rotate", label: "Rotate", min: -45, max: 45, step: 0.5, default: 0, suffix: "deg" },
      { type: "slider", key: "scale", label: "Scale", min: 60, max: 160, step: 1, default: 108, suffix: "%" },
    ],
    apply: (src, p) => adaptiveWideAngle(src, Number(p.correction), Number(p.fisheye), Number(p.rotate), Number(p.scale)),
  },
  "vanishing-point": {
    id: "vanishing-point",
    name: "Vanishing Point",
    category: "Distort",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "left", label: "Left Plane", min: -100, max: 100, step: 1, default: -32 },
      { type: "slider", key: "right", label: "Right Plane", min: -100, max: 100, step: 1, default: 26 },
      { type: "slider", key: "depth", label: "Depth", min: -100, max: 100, step: 1, default: 45 },
      { type: "checkbox", key: "grid", label: "Show Plane Grid", default: true },
    ],
    apply: (src, p) => vanishingPoint(src, Number(p.horizon), Number(p.left), Number(p.right), Number(p.depth), parseBool(p.grid, true)),
  },
  "twirl": {
    id: "twirl",
    name: "Twirl",
    category: "Distort",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -999, max: 999, step: 1, default: 50, suffix: "°" },
    ],
    apply: (src, p) => distortTwirl(src, Number(p.angle)),
  },
  "pinch": {
    id: "pinch",
    name: "Pinch",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => distortPinch(src, Number(p.amount)),
  },
  "spherize": {
    id: "spherize",
    name: "Spherize",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "normal", label: "Normal" },
        { value: "horizontal", label: "Horizontal Only" },
        { value: "vertical", label: "Vertical Only" },
      ], default: "normal" },
    ],
    apply: (src, p) => distortSpherize(src, Number(p.amount), String(p.mode)),
  },
  "wave": {
    id: "wave",
    name: "Wave",
    category: "Distort",
    params: [
      { type: "slider", key: "wavelength", label: "Wavelength", min: 1, max: 999, step: 1, default: 120 },
      { type: "slider", key: "amplitude", label: "Amplitude", min: 1, max: 999, step: 1, default: 35 },
      { type: "select", key: "type", label: "Type", options: [
        { value: "sine", label: "Sine" },
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square" },
      ], default: "sine" },
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 100, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => distortWave(src, Number(p.wavelength), Number(p.amplitude), String(p.type), Number(p.scale)),
  },
  "ripple": {
    id: "ripple",
    name: "Ripple",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -999, max: 999, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "size", label: "Size", options: [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
      ], default: "medium" },
    ],
    apply: (src, p) => distortRipple(src, Number(p.amount), String(p.size)),
  },
  "zigzag": {
    id: "zigzag",
    name: "ZigZag",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 20 },
      { type: "slider", key: "ridges", label: "Ridges", min: 1, max: 20, step: 1, default: 5 },
      { type: "select", key: "style", label: "Style", options: [
        { value: "pond", label: "Pond Ripples" },
        { value: "from-center", label: "Out From Center" },
        { value: "around-center", label: "Around Center" },
      ], default: "pond" },
    ],
    apply: (src, p) => distortZigZag(src, Number(p.amount), Number(p.ridges), String(p.style)),
  },
  "polar-coordinates": {
    id: "polar-coordinates",
    name: "Polar Coordinates",
    category: "Distort",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "rect-to-polar", label: "Rectangular to Polar" },
        { value: "polar-to-rect", label: "Polar to Rectangular" },
      ], default: "rect-to-polar" },
    ],
    apply: (src, p) => distortPolar(src, String(p.mode)),
  },

  /* ======================== RENDER FILTERS ======================== */

  "clouds": {
    id: "clouds",
    name: "Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), false),
  },
  "difference-clouds": {
    id: "difference-clouds",
    name: "Difference Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), true),
  },
  "fibers": {
    id: "fibers",
    name: "Fibers",
    category: "Render",
    params: [
      { type: "slider", key: "variance", label: "Variance", min: 1, max: 64, step: 1, default: 16 },
      { type: "slider", key: "strength", label: "Strength", min: 1, max: 64, step: 1, default: 4 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderFibers(src, Number(p.variance), Number(p.strength), Number(p.seed)),
  },
  "lens-flare": {
    id: "lens-flare",
    name: "Lens Flare",
    category: "Render",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: 10, max: 300, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "cx", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "cy", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "select", key: "lens", label: "Lens Type", options: [
        { value: "50-300", label: "50-300mm Zoom" },
        { value: "35", label: "35mm Prime" },
        { value: "105", label: "105mm Prime" },
        { value: "movie", label: "Movie Prime" },
      ], default: "50-300" },
    ],
    apply: (src, p) => renderLensFlare(src, Number(p.brightness), Number(p.cx), Number(p.cy), String(p.lens)),
  },

  /* ======================== OTHER FILTERS ======================== */

  "high-pass": {
    id: "high-pass",
    name: "High Pass",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 250, step: 0.1, default: 10, suffix: "px" },
    ],
    apply: (src, p) => filterHighPass(src, Number(p.radius)),
  },
  "offset": {
    id: "offset",
    name: "Offset",
    category: "Other",
    params: [
      { type: "slider", key: "horizontal", label: "Horizontal", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "slider", key: "vertical", label: "Vertical", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "select", key: "wrap", label: "Undefined Areas", options: [
        { value: "wrap", label: "Wrap Around" },
        { value: "repeat", label: "Repeat Edge Pixels" },
        { value: "transparent", label: "Set to Transparent" },
      ], default: "wrap" },
    ],
    apply: (src, p) => filterOffset(src, Number(p.horizontal), Number(p.vertical), String(p.wrap)),
  },
  "maximum": {
    id: "maximum",
    name: "Maximum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), true),
  },
  "minimum": {
    id: "minimum",
    name: "Minimum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), false),
  },

  /* ---------- ADVANCED FILTERS ---------- */

  "smart-sharpen": {
    id: "smart-sharpen",
    name: "Smart Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 64, step: 0.1, default: 1.0, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
      { type: "select", key: "remove", label: "Remove", options: [
        { value: "gaussian", label: "Gaussian Blur" },
        { value: "lens", label: "Lens Blur" },
        { value: "motion", label: "Motion Blur" },
      ], default: "gaussian" },
      { type: "slider", key: "shadowAmount", label: "Shadow Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "highlightAmount", label: "Highlight Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
    ],
    apply: (src, p) => smartSharpen(src, Number(p.amount), Number(p.radius), Number(p.threshold), Number(p.shadowAmount), Number(p.highlightAmount)),
  },

  "lens-blur": {
    id: "lens-blur",
    name: "Lens Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 1, default: 10, suffix: "px" },
      { type: "slider", key: "bladeCount", label: "Blade Curvature", min: 3, max: 8, step: 1, default: 6 },
      { type: "slider", key: "rotation", label: "Rotation", min: 0, max: 360, step: 1, default: 0, suffix: "°" },
      { type: "slider", key: "brightness", label: "Specular Brightness", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "threshold", label: "Specular Threshold", min: 0, max: 255, step: 1, default: 255 },
      { type: "slider", key: "noiseAmount", label: "Noise Amount", min: 0, max: 25, step: 1, default: 0 },
      { type: "checkbox", key: "noiseMono", label: "Monochromatic Noise", default: true },
    ],
    apply: (src, p) => lensBlur(src, Number(p.radius), Number(p.bladeCount), Number(p.rotation), Number(p.brightness), Number(p.threshold), Number(p.noiseAmount), Boolean(p.noiseMono)),
  },

  "surface-blur": {
    id: "surface-blur",
    name: "Surface Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 18, step: 1, default: 5, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 24 },
    ],
    apply: (src, p) => surfaceBlur(src, Number(p.radius), Number(p.threshold)),
  },

  "radial-blur": {
    id: "radial-blur",
    name: "Radial Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 100, step: 1, default: 25 },
      { type: "select", key: "method", label: "Method", options: [
        { value: "spin", label: "Spin" },
        { value: "zoom", label: "Zoom" },
      ], default: "spin" },
      { type: "select", key: "quality", label: "Quality", options: [
        { value: "draft", label: "Draft" },
        { value: "good", label: "Good" },
        { value: "best", label: "Best" },
      ], default: "good" },
    ],
    apply: (src, p) => radialBlur(src, Number(p.amount), String(p.method), String(p.quality)),
  },

  "oil-paint": {
    id: "oil-paint",
    name: "Oil Paint",
    category: "Stylize",
    params: [
      { type: "slider", key: "radius", label: "Stylization Radius", min: 1, max: 8, step: 1, default: 4, suffix: "px" },
      { type: "slider", key: "levels", label: "Cleanliness", min: 4, max: 32, step: 1, default: 16 },
      { type: "slider", key: "shine", label: "Lighting Shine", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
    ],
    apply: (src, p) => oilPaint(src, Number(p.radius), Number(p.levels), Number(p.shine)),
  },

  "glass": {
    id: "glass",
    name: "Glass",
    category: "Distort",
    params: [
      { type: "slider", key: "distortion", label: "Distortion", min: 0, max: 100, step: 1, default: 24 },
      { type: "slider", key: "smoothness", label: "Smoothness", min: 0, max: 8, step: 1, default: 2 },
      { type: "select", key: "texture", label: "Texture", options: [
        { value: "canvas", label: "Canvas" },
        { value: "frosted", label: "Frosted" },
        { value: "blocks", label: "Blocks" },
      ], default: "canvas" },
      { type: "slider", key: "scale", label: "Scale", min: 10, max: 400, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => glassDistort(src, Number(p.distortion), Number(p.smoothness), String(p.texture), Number(p.scale)),
  },

  "lens-correction": {
    id: "lens-correction",
    name: "Lens Correction",
    category: "Distort",
    params: [
      { type: "slider", key: "distortion", label: "Geometric Distortion", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vignette", label: "Vignette", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "chromatic", label: "Chromatic Aberration", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => lensCorrection(src, Number(p.distortion), Number(p.vignette), Number(p.chromatic)),
  },

  "color-halftone": {
    id: "color-halftone",
    name: "Color Halftone",
    category: "Pixelate",
    params: [
      { type: "slider", key: "radius", label: "Max Radius", min: 2, max: 32, step: 1, default: 8, suffix: "px" },
      { type: "slider", key: "angle", label: "Screen Angle", min: 0, max: 180, step: 1, default: 45, suffix: "deg" },
    ],
    apply: (src, p) => colorHalftone(src, Number(p.radius), Number(p.angle)),
  },

  "mezzotint": {
    id: "mezzotint",
    name: "Mezzotint",
    category: "Pixelate",
    params: [
      { type: "select", key: "type", label: "Type", options: [
        { value: "fine-dots", label: "Fine Dots" },
        { value: "short-strokes", label: "Short Strokes" },
        { value: "long-strokes", label: "Long Strokes" },
      ], default: "fine-dots" },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 70, suffix: "%" },
    ],
    apply: (src, p) => mezzotint(src, String(p.type), Number(p.density)),
  },

  "lighting-effects": {
    id: "lighting-effects",
    name: "Lighting Effects",
    category: "Render",
    params: [
      { type: "select", key: "style", label: "Light Type", options: [
        { value: "spot", label: "Spot" },
        { value: "omni", label: "Omni" },
        { value: "directional", label: "Directional" },
      ], default: "spot" },
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 250, step: 1, default: 120, suffix: "%" },
      { type: "slider", key: "ambient", label: "Ambience", min: 0, max: 150, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "height", label: "Texture Height", min: 0, max: 100, step: 1, default: 35, suffix: "%" },
    ],
    apply: (src, p) => lightingEffects(src, String(p.style), Number(p.intensity), Number(p.ambient), Number(p.height)),
  },

  "custom-convolution": {
    id: "custom-convolution",
    name: "Custom Convolution",
    category: "Other",
    params: [
      { type: "select", key: "preset", label: "Kernel", options: [
        { value: "sharpen-more", label: "Sharpen More" },
        { value: "edge-enhance", label: "Edge Enhance" },
        { value: "outline", label: "Outline" },
        { value: "laplacian", label: "Laplacian" },
        { value: "sobel-x", label: "Sobel X" },
        { value: "sobel-y", label: "Sobel Y" },
      ], default: "sharpen-more" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "bias", label: "Bias", min: -255, max: 255, step: 1, default: 0 },
    ],
    apply: (src, p) => customConvolution(src, String(p.preset), Number(p.strength), Number(p.bias)),
  },

  "reduce-noise": {
    id: "reduce-noise",
    name: "Reduce Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 10, step: 1, default: 6 },
      { type: "slider", key: "colorNoise", label: "Reduce Color Noise", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
      { type: "slider", key: "detail", label: "Preserve Details", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "sharpen", label: "Sharpen Details", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => reduceNoise(src, Number(p.strength), Number(p.colorNoise), Number(p.detail), Number(p.sharpen)),
  },

  "dust-scratches": {
    id: "dust-scratches",
    name: "Dust & Scratches",
    category: "Noise",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 16, step: 1, default: 1, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
    ],
    apply: (src, p) => dustAndScratches(src, Number(p.radius), Number(p.threshold)),
  },

  ...LEGACY_GAP_FILTERS,
}

export function getFilter(id: string): FilterDef | null {
  return FILTERS[id] ?? null
}
