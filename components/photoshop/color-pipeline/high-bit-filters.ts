import { clamp, clamp8, type HighBitImage, type PipelineBitDepth } from "../color-pipeline-conversions"

import { highBitBool, highBitParam, readHighBitUnit, writeHighBitUnit } from "./internal"
import { applyHighBitAdjustment, type HighBitAdjustment } from "./high-bit-image"

// ── High-Bit Typed Filter Application ───────────────────────────────

export interface HighBitFilterContext {
  bitDepth: PipelineBitDepth
  workingSpace: string
  preservePrecision: boolean
}

type HighBitFilterParams = Record<string, number | string | boolean>

const HIGH_BIT_ADJUSTMENT_FILTERS = new Set<HighBitAdjustment["type"]>([
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "invert",
  "channel-mixer",
  "grayscale",
  "desaturate",
  "posterize",
  "threshold",
])

const NATIVE_HIGH_BIT_FILTERS = new Set<string>([
  ...HIGH_BIT_ADJUSTMENT_FILTERS,
  "average",
  "average-blur",
  "blur",
  "blur-more",
  "box-blur",
  "gaussian-blur",
  "motion-blur",
  "sharpen",
  "sharpen-more",
  "unsharp-mask",
  "find-edges",
  "emboss",
  "equalize",
  "shadows-highlights",
  "gradient-map",
  "ntsc-colors",
  "high-pass",
  "offset",
  "maximum",
  "minimum",
  "pixelate",
  "mosaic",
  "noise",
  "add-noise",
  "hue-saturation",
  "vibrance",
  "photo-filter",
  "black-white",
  "sepia",
  "solarize",
  "color-balance",
])

export function isHighBitFilterNativelySupported(filterId: string): boolean {
  return NATIVE_HIGH_BIT_FILTERS.has(filterId)
}

function highBitFilterParams(params: Record<string, unknown>): HighBitFilterParams {
  const out: HighBitFilterParams = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value
    else if (typeof value === "string" || typeof value === "boolean") out[key] = value
  }
  return out
}

function normalizedHighBitAdjustmentParams(filterId: string, params: HighBitFilterParams): HighBitFilterParams {
  if (filterId !== "levels") return params
  return {
    ...params,
    inputBlack: params.inputBlack ?? params.blackInput ?? 0,
    inputWhite: params.inputWhite ?? params.whiteInput ?? 255,
    outputBlack: params.outputBlack ?? params.blackOutput ?? 0,
    outputWhite: params.outputWhite ?? params.whiteOutput ?? 255,
  }
}

function highBitDataCtor(storage: HighBitImage["storage"]) {
  return storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
}

function cloneHighBitFilterImage(source: HighBitImage, data?: HighBitImage["data"], warnings = source.warnings): HighBitImage {
  const Ctor = highBitDataCtor(source.storage)
  return {
    ...source,
    data: data ?? new Ctor(source.data) as HighBitImage["data"],
    warnings: [...warnings],
  }
}

function emptyHighBitFilterImage(source: HighBitImage): HighBitImage {
  const Ctor = highBitDataCtor(source.storage)
  return cloneHighBitFilterImage(source, new Ctor(source.data.length) as HighBitImage["data"])
}

function readFilterUnit(source: HighBitImage, index: number) {
  return readHighBitUnit(source.data, source.storage, index)
}

function writeFilterUnit(target: HighBitImage, index: number, value: number) {
  writeHighBitUnit(target.data, target.storage, index, value)
}

function highBitFloatsToSourceStorage(source: HighBitImage, floats: Float32Array): HighBitImage {
  const out = emptyHighBitFilterImage(source)
  for (let i = 0; i < floats.length; i++) writeFilterUnit(out, i, floats[i])
  return out
}

function perPixelHighBitFilter(
  source: HighBitImage,
  transform: (r: number, g: number, b: number, a: number, index: number) => [number, number, number, number],
): HighBitImage {
  const out = emptyHighBitFilterImage(source)
  for (let i = 0; i < source.data.length; i += 4) {
    const next = transform(
      readFilterUnit(source, i),
      readFilterUnit(source, i + 1),
      readFilterUnit(source, i + 2),
      readFilterUnit(source, i + 3),
      i,
    )
    writeFilterUnit(out, i, next[0])
    writeFilterUnit(out, i + 1, next[1])
    writeFilterUnit(out, i + 2, next[2])
    writeFilterUnit(out, i + 3, next[3])
  }
  return out
}

function boxBlurHighBitFilter(source: HighBitImage, radius: number): HighBitImage {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return cloneHighBitFilterImage(source)
  const tmp = new Float32Array(source.data.length)
  const out = new Float32Array(source.data.length)
  const span = r * 2 + 1
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sums = [0, 0, 0, 0]
      for (let ox = -r; ox <= r; ox++) {
        const sx = Math.max(0, Math.min(source.width - 1, x + ox))
        const i = (y * source.width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += readFilterUnit(source, i + c)
      }
      const o = (y * source.width + x) * 4
      for (let c = 0; c < 4; c++) tmp[o + c] = sums[c] / span
    }
  }
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sums = [0, 0, 0, 0]
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(source.height - 1, y + oy))
        const i = (sy * source.width + x) * 4
        for (let c = 0; c < 4; c++) sums[c] += tmp[i + c]
      }
      const o = (y * source.width + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = sums[c] / span
    }
  }
  return highBitFloatsToSourceStorage(source, out)
}

function gaussianBlurHighBitFilter(source: HighBitImage, radius: number): HighBitImage {
  const r = Math.max(1, Math.round(Math.max(0, radius) / 3))
  if (radius <= 0) return cloneHighBitFilterImage(source)
  return boxBlurHighBitFilter(boxBlurHighBitFilter(boxBlurHighBitFilter(source, r), r), r)
}

function averageBlurHighBitFilter(source: HighBitImage): HighBitImage {
  const sums = [0, 0, 0, 0]
  const pixels = Math.max(1, source.width * source.height)
  for (let i = 0; i < source.data.length; i += 4) {
    sums[0] += readFilterUnit(source, i)
    sums[1] += readFilterUnit(source, i + 1)
    sums[2] += readFilterUnit(source, i + 2)
    sums[3] += readFilterUnit(source, i + 3)
  }
  return perPixelHighBitFilter(source, () => [sums[0] / pixels, sums[1] / pixels, sums[2] / pixels, sums[3] / pixels])
}

function motionBlurHighBitFilter(source: HighBitImage, distance: number, angleDeg: number): HighBitImage {
  const steps = Math.max(1, Math.round(distance))
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sums = [0, 0, 0, 0]
      let count = 0
      for (let step = -steps; step <= steps; step++) {
        const sx = Math.round(x + dx * step)
        const sy = Math.round(y + dy * step)
        if (sx < 0 || sx >= source.width || sy < 0 || sy >= source.height) continue
        const i = (sy * source.width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += readFilterUnit(source, i + c)
        count++
      }
      const o = (y * source.width + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = sums[c] / Math.max(1, count)
    }
  }
  return highBitFloatsToSourceStorage(source, out)
}

function sharpenHighBitFilter(source: HighBitImage, amount: number): HighBitImage {
  const a = Math.max(0, amount) / 100
  if (a <= 0) return cloneHighBitFilterImage(source)
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const o = (y * source.width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(source.width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(source.height - 1, y + ky - 1))
            value += readFilterUnit(source, (sy * source.width + sx) * 4 + c) * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = readFilterUnit(source, o + 3)
    }
  }
  return highBitFloatsToSourceStorage(source, out)
}

function unsharpMaskHighBitFilter(source: HighBitImage, amount: number, radius: number): HighBitImage {
  const blurred = gaussianBlurHighBitFilter(source, radius)
  const k = amount / 100
  return perPixelHighBitFilter(source, (_r, _g, _b, a, i) => [
    readFilterUnit(source, i) + (readFilterUnit(source, i) - readFilterUnit(blurred, i)) * k,
    readFilterUnit(source, i + 1) + (readFilterUnit(source, i + 1) - readFilterUnit(blurred, i + 1)) * k,
    readFilterUnit(source, i + 2) + (readFilterUnit(source, i + 2) - readFilterUnit(blurred, i + 2)) * k,
    a,
  ])
}

function findEdgesHighBitFilter(source: HighBitImage): HighBitImage {
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      let sx = 0
      let sy = 0
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const px = Math.max(0, Math.min(source.width - 1, x + kx - 1))
          const py = Math.max(0, Math.min(source.height - 1, y + ky - 1))
          const i = (py * source.width + px) * 4
          const lum = 0.299 * readFilterUnit(source, i) + 0.587 * readFilterUnit(source, i + 1) + 0.114 * readFilterUnit(source, i + 2)
          const k = ky * 3 + kx
          sx += lum * gx[k]
          sy += lum * gy[k]
        }
      }
      const edge = clamp(Math.hypot(sx, sy))
      const o = (y * source.width + x) * 4
      out[o] = edge
      out[o + 1] = edge
      out[o + 2] = edge
      out[o + 3] = readFilterUnit(source, o + 3)
    }
  }
  return highBitFloatsToSourceStorage(source, out)
}

function embossHighBitFilter(source: HighBitImage, amount: number): HighBitImage {
  const scale = Math.max(0, amount) / 100
  const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2].map((value) => value * scale)
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const o = (y * source.width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0.5
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(source.width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(source.height - 1, y + ky - 1))
            value += readFilterUnit(source, (sy * source.width + sx) * 4 + c) * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = readFilterUnit(source, o + 3)
    }
  }
  return highBitFloatsToSourceStorage(source, out)
}

function highPassHighBitFilter(source: HighBitImage, radius: number): HighBitImage {
  const blurred = boxBlurHighBitFilter(source, radius)
  return perPixelHighBitFilter(source, (_r, _g, _b, a, i) => [
    readFilterUnit(source, i) - readFilterUnit(blurred, i) + 0.5,
    readFilterUnit(source, i + 1) - readFilterUnit(blurred, i + 1) + 0.5,
    readFilterUnit(source, i + 2) - readFilterUnit(blurred, i + 2) + 0.5,
    a,
  ])
}

function equalizeHighBitFilter(source: HighBitImage): HighBitImage {
  const bins = source.storage === "uint16" ? 65536 : source.storage === "float32" ? 4096 : 256
  const hist = [new Uint32Array(bins), new Uint32Array(bins), new Uint32Array(bins)]
  const binFor = (value: number) => Math.max(0, Math.min(bins - 1, Math.round(clamp(value) * (bins - 1))))
  for (let i = 0; i < source.data.length; i += 4) {
    hist[0][binFor(readFilterUnit(source, i))]++
    hist[1][binFor(readFilterUnit(source, i + 1))]++
    hist[2][binFor(readFilterUnit(source, i + 2))]++
  }
  const maps = hist.map((channel) => {
    const map = new Float32Array(bins)
    const total = Math.max(1, source.width * source.height)
    let cumulative = 0
    let first = 0
    while (first < bins - 1 && channel[first] === 0) first++
    const base = channel[first]
    const denom = Math.max(1, total - base)
    for (let i = 0; i < bins; i++) {
      cumulative += channel[i]
      map[i] = clamp((cumulative - base) / denom)
    }
    return map
  })
  return perPixelHighBitFilter(source, (r, g, b, a) => [maps[0][binFor(r)], maps[1][binFor(g)], maps[2][binFor(b)], a])
}

function shadowsHighlightsHighBitFilter(source: HighBitImage, params: HighBitFilterParams): HighBitImage {
  const shadows = clamp(highBitParam(params, "shadows", 0) / 100)
  const highlights = clamp(highBitParam(params, "highlights", 0) / 100)
  const tonalWidth = clamp(highBitParam(params, "tonalWidth", 50) / 100, 0.05, 1)
  const colorCorrection = highBitParam(params, "colorCorrection", 0) / 100
  return perPixelHighBitFilter(source, (r, g, b, a) => {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const shadowMask = clamp((tonalWidth - lum) / tonalWidth)
    const highlightMask = clamp((lum - (1 - tonalWidth)) / tonalWidth)
    let nr = r + (1 - r) * shadows * shadowMask
    let ng = g + (1 - g) * shadows * shadowMask
    let nb = b + (1 - b) * shadows * shadowMask
    nr *= 1 - highlights * highlightMask * 0.85
    ng *= 1 - highlights * highlightMask * 0.85
    nb *= 1 - highlights * highlightMask * 0.85
    if (colorCorrection !== 0) {
      const hsl = highBitRgbToHsl(nr, ng, nb)
      const rgb = highBitHslToRgb(hsl.h, clamp(hsl.s * (1 + colorCorrection * 0.35)), hsl.l)
      nr = rgb.r
      ng = rgb.g
      nb = rgb.b
    }
    return [nr, ng, nb, a]
  })
}

function parseHighBitCssColor(value: string | undefined) {
  const fallback = { r: 255, g: 255, b: 255 }
  if (!value || value === "transparent") return fallback
  const clean = value.trim()
  if (clean.startsWith("#")) {
    const hex = clean.slice(1)
    const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex.padEnd(6, "0").slice(0, 6)
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0,
    }
  }
  const rgba = /rgba?\(([^)]+)\)/i.exec(clean)
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => Number(part.trim()))
    return {
      r: clamp8(parts[0] ?? fallback.r),
      g: clamp8(parts[1] ?? fallback.g),
      b: clamp8(parts[2] ?? fallback.b),
    }
  }
  return fallback
}

function parseHighBitGradientStops(value: string) {
  const stops = value
    .split(";")
    .map((part) => {
      const [rawPosition, rawColor] = part.split(",")
      const position = clamp(Number(rawPosition))
      const color = parseHighBitCssColor(rawColor)
      return Number.isFinite(position) ? { position, color } : null
    })
    .filter((item): item is { position: number; color: { r: number; g: number; b: number } } => !!item)
    .sort((a, b) => a.position - b.position)
  if (!stops.length) stops.push({ position: 0, color: { r: 0, g: 0, b: 0 } }, { position: 1, color: { r: 255, g: 255, b: 255 } })
  if (stops[0].position > 0) stops.unshift({ position: 0, color: stops[0].color })
  if (stops[stops.length - 1].position < 1) stops.push({ position: 1, color: stops[stops.length - 1].color })
  return stops
}

function gradientMapHighBitFilter(source: HighBitImage, params: HighBitFilterParams): HighBitImage {
  const stops = parseHighBitGradientStops(String(params.gradient ?? "0,#000000;1,#ffffff"))
  const reverse = highBitBool(params, "reverse", false)
  return perPixelHighBitFilter(source, (r, g, b, a) => {
    const lum = reverse ? 1 - (0.299 * r + 0.587 * g + 0.114 * b) : 0.299 * r + 0.587 * g + 0.114 * b
    let lo = stops[0]
    let hi = stops[stops.length - 1]
    for (let i = 0; i < stops.length - 1; i++) {
      if (lum >= stops[i].position && lum <= stops[i + 1].position) {
        lo = stops[i]
        hi = stops[i + 1]
        break
      }
    }
    const t = clamp((lum - lo.position) / Math.max(0.000001, hi.position - lo.position))
    return [
      (lo.color.r * (1 - t) + hi.color.r * t) / 255,
      (lo.color.g * (1 - t) + hi.color.g * t) / 255,
      (lo.color.b * (1 - t) + hi.color.b * t) / 255,
      a,
    ]
  })
}

function highBitRgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r
    ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g
      ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6
  return { h, s, l }
}

function highBitHslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 1) + 1) % 1
  if (s === 0) return { r: l, g: l, b: l }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t0: number) => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return { r: hue2rgb(hue + 1 / 3), g: hue2rgb(hue), b: hue2rgb(hue - 1 / 3) }
}

function ntscColorsHighBitFilter(source: HighBitImage): HighBitImage {
  return perPixelHighBitFilter(source, (r, g, b, a) => {
    const hsl = highBitRgbToHsl(r, g, b)
    const rgb = highBitHslToRgb(hsl.h, Math.min(hsl.s, 0.82), clamp(hsl.l, 0.06, 0.94))
    return [rgb.r, rgb.g, rgb.b, a]
  })
}

function highBitColorFilter(source: HighBitImage, filterId: string, params: HighBitFilterParams): HighBitImage | null {
  if (filterId === "hue-saturation") {
    const hue = highBitParam(params, "hue", 0) / 360
    const saturation = highBitParam(params, "saturation", 0) / 100
    const lightness = highBitParam(params, "lightness", 0) / 100
    return perPixelHighBitFilter(source, (r, g, b, a) => {
      const hsl = highBitRgbToHsl(r, g, b)
      const rgb = highBitHslToRgb(hsl.h + hue, clamp(hsl.s * (1 + saturation)), clamp(hsl.l + lightness))
      return [rgb.r, rgb.g, rgb.b, a]
    })
  }
  if (filterId === "vibrance") {
    const vibrance = highBitParam(params, "vibrance", highBitParam(params, "amount", 0)) / 100
    const saturation = highBitParam(params, "saturation", 0) / 100
    return perPixelHighBitFilter(source, (r, g, b, a) => {
      const hsl = highBitRgbToHsl(r, g, b)
      const boost = saturation + vibrance * (1 - hsl.s)
      const rgb = highBitHslToRgb(hsl.h, clamp(hsl.s * (1 + boost)), hsl.l)
      return [rgb.r, rgb.g, rgb.b, a]
    })
  }
  if (filterId === "photo-filter") {
    const color = parseHighBitCssColor(String(params.color ?? "#ffb74d"))
    const density = highBitParam(params, "density", 25) / 100
    return perPixelHighBitFilter(source, (r, g, b, a) => [
      r * (1 - density) + (color.r / 255) * density,
      g * (1 - density) + (color.g / 255) * density,
      b * (1 - density) + (color.b / 255) * density,
      a,
    ])
  }
  if (filterId === "black-white") {
    return perPixelHighBitFilter(source, (r, g, b, a) => {
      const gray = clamp(r * 0.299 + g * 0.587 + b * 0.114)
      return [gray, gray, gray, a]
    })
  }
  if (filterId === "sepia") {
    return perPixelHighBitFilter(source, (r, g, b, a) => [
      r * 0.393 + g * 0.769 + b * 0.189,
      r * 0.349 + g * 0.686 + b * 0.168,
      r * 0.272 + g * 0.534 + b * 0.131,
      a,
    ])
  }
  if (filterId === "solarize") {
    return perPixelHighBitFilter(source, (r, g, b, a) => [
      r > 0.5 ? 1 - r : r,
      g > 0.5 ? 1 - g : g,
      b > 0.5 ? 1 - b : b,
      a,
    ])
  }
  if (filterId === "color-balance") {
    const cyanRed = highBitParam(params, "cyanRed", highBitParam(params, "red", 0)) / 255
    const magentaGreen = highBitParam(params, "magentaGreen", highBitParam(params, "green", 0)) / 255
    const yellowBlue = highBitParam(params, "yellowBlue", highBitParam(params, "blue", 0)) / 255
    return perPixelHighBitFilter(source, (r, g, b, a) => [r + cyanRed, g + magentaGreen, b + yellowBlue, a])
  }
  return null
}

function offsetHighBitFilter(source: HighBitImage, dx: number, dy: number, wrap: boolean): HighBitImage {
  const out = emptyHighBitFilterImage(source)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      let sx = x - dx
      let sy = y - dy
      if (wrap) {
        sx = ((sx % source.width) + source.width) % source.width
        sy = ((sy % source.height) + source.height) % source.height
      }
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue
      const src = (sy * source.width + sx) * 4
      const dst = (y * source.width + x) * 4
      for (let c = 0; c < 4; c++) writeFilterUnit(out, dst + c, readFilterUnit(source, src + c))
    }
  }
  return out
}

function morphologyHighBitFilter(source: HighBitImage, radius: number, maximum: boolean): HighBitImage {
  const out = emptyHighBitFilterImage(source)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const dst = (y * source.width + x) * 4
      for (let c = 0; c < 4; c++) {
        let value = maximum ? 0 : 1
        for (let oy = -radius; oy <= radius; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const sx = Math.max(0, Math.min(source.width - 1, x + ox))
            const sy = Math.max(0, Math.min(source.height - 1, y + oy))
            const sample = readFilterUnit(source, (sy * source.width + sx) * 4 + c)
            value = maximum ? Math.max(value, sample) : Math.min(value, sample)
          }
        }
        writeFilterUnit(out, dst + c, value)
      }
    }
  }
  return out
}

function pixelateHighBitFilter(source: HighBitImage, size: number): HighBitImage {
  const out = emptyHighBitFilterImage(source)
  for (let by = 0; by < source.height; by += size) {
    for (let bx = 0; bx < source.width; bx += size) {
      const sums = [0, 0, 0, 0]
      let count = 0
      for (let y = by; y < Math.min(source.height, by + size); y++) {
        for (let x = bx; x < Math.min(source.width, bx + size); x++) {
          const i = (y * source.width + x) * 4
          for (let c = 0; c < 4; c++) sums[c] += readFilterUnit(source, i + c)
          count++
        }
      }
      for (let y = by; y < Math.min(source.height, by + size); y++) {
        for (let x = bx; x < Math.min(source.width, bx + size); x++) {
          const i = (y * source.width + x) * 4
          for (let c = 0; c < 4; c++) writeFilterUnit(out, i + c, sums[c] / Math.max(1, count))
        }
      }
    }
  }
  return out
}

function highBitPseudoRandom(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Convert high-bit image to 8-bit ImageData for display.
 */
export function convertHighBitImageTo8Bit(image: HighBitImage): ImageData {
  const { width, height, data, bitDepth } = image
  const out = new ImageData(width, height)
  const channels = 4

  for (let i = 0; i < width * height * channels; i++) {
    if (bitDepth === 16) {
      out.data[i] = Math.round(Math.max(0, Math.min(1, (data[i] ?? 0) / 65535)) * 255)
    } else if (bitDepth === 32) {
      out.data[i] = Math.round(Math.max(0, Math.min(1, data[i] ?? 0)) * 255)
    } else {
      out.data[i] = data[i] ?? 0
    }
  }

  return out
}

/**
 * Promote 8-bit ImageData to high-bit representation.
 */
export function convert8BitToHighBit(
  imageData: ImageData,
  bitDepth: PipelineBitDepth,
  options: Pick<HighBitImage, "colorMode" | "profile"> & { warnings?: string[] } = { colorMode: "RGB" },
): HighBitImage {
  const { width, height, data } = imageData
  const channels = 4
  const totalSamples = width * height * channels
  const storage: HighBitImage["storage"] = bitDepth === 16 ? "uint16" : bitDepth === 32 ? "float32" : "uint8"
  const outData: HighBitImage["data"] =
    storage === "uint16" ? new Uint16Array(totalSamples) :
    storage === "float32" ? new Float32Array(totalSamples) :
    new Uint8ClampedArray(totalSamples)

  for (let i = 0; i < totalSamples; i++) {
    if (bitDepth === 16) {
      outData[i] = Math.round((data[i] / 255) * 65535)
    } else if (bitDepth === 32) {
      outData[i] = data[i] / 255
    } else {
      outData[i] = data[i]
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorMode: options.colorMode,
    profile: options.profile,
    storage,
    data: outData,
    channels,
    warnings: [...(options.warnings ?? [])],
  }
}

/**
 * Apply a simple filter to a high-bit image while maintaining precision.
 * For filters without a native high-bit implementation, falls back to 8-bit.
 */
export function applyFilterToHighBitImage(
  image: HighBitImage,
  filterId: string,
  params: Record<string, unknown>,
  context: HighBitFilterContext,
): HighBitImage {
  const p = highBitFilterParams(params)
  if (context.preservePrecision) {
    if (HIGH_BIT_ADJUSTMENT_FILTERS.has(filterId as HighBitAdjustment["type"])) {
      return applyHighBitAdjustment(image, {
        type: filterId as HighBitAdjustment["type"],
        params: normalizedHighBitAdjustmentParams(filterId, p),
      })
    }
    if (filterId === "average" || filterId === "average-blur") return averageBlurHighBitFilter(image)
    if (filterId === "blur") return boxBlurHighBitFilter(image, 1)
    if (filterId === "blur-more") return boxBlurHighBitFilter(image, 2)
    if (filterId === "box-blur") return boxBlurHighBitFilter(image, highBitParam(p, "radius", 1))
    if (filterId === "gaussian-blur") return gaussianBlurHighBitFilter(image, highBitParam(p, "radius", 4))
    if (filterId === "motion-blur") return motionBlurHighBitFilter(image, highBitParam(p, "distance", 10), highBitParam(p, "angle", 0))
    if (filterId === "sharpen" || filterId === "sharpen-more") return sharpenHighBitFilter(image, filterId === "sharpen-more" ? 90 : highBitParam(p, "amount", 50))
    if (filterId === "unsharp-mask") return unsharpMaskHighBitFilter(image, highBitParam(p, "amount", 100), highBitParam(p, "radius", 1))
    if (filterId === "find-edges") return findEdgesHighBitFilter(image)
    if (filterId === "emboss") return embossHighBitFilter(image, highBitParam(p, "amount", 50))
    if (filterId === "equalize") return equalizeHighBitFilter(image)
    if (filterId === "shadows-highlights") return shadowsHighlightsHighBitFilter(image, p)
    if (filterId === "gradient-map") return gradientMapHighBitFilter(image, p)
    if (filterId === "ntsc-colors") return ntscColorsHighBitFilter(image)
    if (filterId === "high-pass") return highPassHighBitFilter(image, highBitParam(p, "radius", 2))
    if (filterId === "offset") {
      return offsetHighBitFilter(
        image,
        Math.round(highBitParam(p, "horizontal", highBitParam(p, "x", 0))),
        Math.round(highBitParam(p, "vertical", highBitParam(p, "y", 0))),
        String(p.edgeMode ?? "wrap") !== "transparent",
      )
    }
    if (filterId === "maximum" || filterId === "minimum") {
      return morphologyHighBitFilter(image, Math.max(1, Math.round(highBitParam(p, "radius", 1))), filterId === "maximum")
    }
    if (filterId === "pixelate" || filterId === "mosaic") {
      return pixelateHighBitFilter(image, Math.max(1, Math.round(highBitParam(p, "cellSize", highBitParam(p, "size", 8)))))
    }
    if (filterId === "noise" || filterId === "add-noise") {
      const amount = highBitParam(p, "amount", 10) / 100
      const monochrome = highBitBool(p, "monochrome", highBitBool(p, "mono", false))
      return perPixelHighBitFilter(image, (r, g, b, a, i) => {
        const n = highBitPseudoRandom(i) * 2 - 1
        const nr = monochrome ? n : highBitPseudoRandom(i + 17) * 2 - 1
        const ng = monochrome ? n : highBitPseudoRandom(i + 31) * 2 - 1
        const nb = monochrome ? n : highBitPseudoRandom(i + 47) * 2 - 1
        return [r + nr * amount, g + ng * amount, b + nb * amount, a]
      })
    }
    const colorFiltered = highBitColorFilter(image, filterId, p)
    if (colorFiltered) return colorFiltered
  }

  const imageData8 = convertHighBitImageTo8Bit(image)
  return convert8BitToHighBit(imageData8, image.bitDepth, {
    colorMode: image.colorMode,
    profile: image.profile,
    warnings: [
      ...image.warnings,
      `Filter "${filterId}" used an 8-bit fallback because no direct high-bit implementation is registered.`,
    ],
  })
}
