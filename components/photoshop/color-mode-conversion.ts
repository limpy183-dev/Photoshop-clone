import type { DocumentModeSettings } from "./types"
import { hexToRgb } from "./color-utils"

type IndexedSettings = NonNullable<DocumentModeSettings["indexed"]>
type BitmapSettings = NonNullable<DocumentModeSettings["bitmap"]>
type DuotoneSettings = NonNullable<DocumentModeSettings["duotone"]>

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value))
}

function clamp8(value: number) {
  return clamp(Math.round(value))
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp8(value).toString(16).padStart(2, "0")).join("")}`
}

function parseColor(value: string | undefined, fallback = "#000000") {
  try {
    return hexToRgb(value ?? fallback)
  } catch {
    return hexToRgb(fallback)
  }
}

function uniqueColors(colors: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const color of colors) {
    const parsed = parseColor(color)
    const hex = rgbToHex(parsed.r, parsed.g, parsed.b)
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
  }
  return out
}

function grayscalePalette(colors: number) {
  const count = Math.max(2, Math.min(256, Math.round(colors)))
  return Array.from({ length: count }, (_, index) => {
    const v = Math.round((index / Math.max(1, count - 1)) * 255)
    return rgbToHex(v, v, v)
  })
}

function webPalette(colors: number) {
  const values = [0, 51, 102, 153, 204, 255]
  const out: string[] = []
  for (const r of values) {
    for (const g of values) {
      for (const b of values) {
        out.push(rgbToHex(r, g, b))
        if (out.length >= colors) return out
      }
    }
  }
  return out
}

function uniformPalette(colors: number) {
  const count = Math.max(2, Math.min(256, Math.round(colors)))
  const steps = Math.max(2, Math.ceil(Math.cbrt(count)))
  const out: string[] = []
  for (let r = 0; r < steps; r++) {
    for (let g = 0; g < steps; g++) {
      for (let b = 0; b < steps; b++) {
        out.push(rgbToHex(
          (r / Math.max(1, steps - 1)) * 255,
          (g / Math.max(1, steps - 1)) * 255,
          (b / Math.max(1, steps - 1)) * 255,
        ))
        if (out.length >= count) return out
      }
    }
  }
  return out
}

function adaptivePalette(source: ImageData, colors: number) {
  const counts = new Map<string, number>()
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    const key = rgbToHex(source.data[i], source.data[i + 1], source.data[i + 2])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex)
  return ranked.slice(0, Math.max(2, Math.min(256, Math.round(colors))))
}

function exactPalette(source: ImageData) {
  const set = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    const hex = rgbToHex(source.data[i], source.data[i + 1], source.data[i + 2])
    if (set.has(hex)) continue
    set.add(hex)
    out.push(hex)
    if (out.length >= 256) break
  }
  return out
}

function systemPalette() {
  // Classic 16-color Windows-style system palette.
  return [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ]
}

function medianCutPalette(source: ImageData, colors: number) {
  const target = Math.max(2, Math.min(256, Math.round(colors)))
  const pixels: number[][] = []
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    pixels.push([source.data[i], source.data[i + 1], source.data[i + 2]])
  }
  if (!pixels.length) return grayscalePalette(target)
  let buckets: number[][][] = [pixels]
  while (buckets.length < target) {
    let bestIdx = -1
    let bestRange = -1
    let bestAxis = 0
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b]
      if (bucket.length <= 1) continue
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0
      for (const px of bucket) {
        if (px[0] < rMin) rMin = px[0]
        if (px[0] > rMax) rMax = px[0]
        if (px[1] < gMin) gMin = px[1]
        if (px[1] > gMax) gMax = px[1]
        if (px[2] < bMin) bMin = px[2]
        if (px[2] > bMax) bMax = px[2]
      }
      const ranges = [rMax - rMin, gMax - gMin, bMax - bMin]
      const axis = ranges.indexOf(Math.max(...ranges))
      const range = ranges[axis]
      if (range > bestRange) { bestRange = range; bestIdx = b; bestAxis = axis }
    }
    if (bestIdx < 0) break
    const bucket = buckets[bestIdx]
    bucket.sort((a, b) => a[bestAxis] - b[bestAxis])
    const half = Math.floor(bucket.length / 2)
    const left = bucket.slice(0, half)
    const right = bucket.slice(half)
    if (!left.length || !right.length) break
    buckets = buckets.slice(0, bestIdx).concat([left, right], buckets.slice(bestIdx + 1))
  }
  return buckets.map((bucket) => {
    let r = 0, g = 0, b = 0
    for (const px of bucket) { r += px[0]; g += px[1]; b += px[2] }
    return rgbToHex(r / bucket.length, g / bucket.length, b / bucket.length)
  })
}

function selectivePalette(source: ImageData, colors: number) {
  // Selective biases toward "important" Web/primary colors first, then fills with median-cut from remaining pixels.
  const target = Math.max(2, Math.min(256, Math.round(colors)))
  const forced = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"]
  const remaining = Math.max(0, target - forced.length)
  return uniqueColors([...forced, ...medianCutPalette(source, remaining || target)]).slice(0, target)
}

function forcedColors(kind: IndexedSettings["forced"]) {
  if (kind === "black-white") return ["#000000", "#ffffff"]
  if (kind === "primaries") return ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00"]
  if (kind === "web") return webPalette(216)
  return []
}

export function buildIndexedColorTable(
  source: ImageData,
  options: Partial<IndexedSettings> = {},
): string[] {
  const colors = Math.max(2, Math.min(256, Math.round(options.colors ?? 256)))
  const forced = forcedColors(options.forced)
  const paletteKind = options.palette ?? (options.colorTable?.length ? "custom" : "adaptive")
  const base =
    paletteKind === "custom" && options.colorTable?.length
      ? options.colorTable
      : paletteKind === "grayscale"
        ? grayscalePalette(colors)
        : paletteKind === "web"
          ? webPalette(colors)
          : paletteKind === "uniform"
            ? uniformPalette(colors)
            : paletteKind === "system"
              ? systemPalette()
              : paletteKind === "exact"
                ? exactPalette(source)
                : paletteKind === "perceptual"
                  ? medianCutPalette(source, colors)
                  : paletteKind === "selective"
                    ? selectivePalette(source, colors)
                    : adaptivePalette(source, colors)
  const table = uniqueColors([...forced, ...base]).slice(0, colors)
  if (table.length >= colors) return table
  return uniqueColors([...table, ...uniformPalette(colors)]).slice(0, colors)
}

function nearestPaletteColor(r: number, g: number, b: number, table: string[]) {
  let best = parseColor(table[0], "#000000")
  let bestDistance = Number.POSITIVE_INFINITY
  for (const color of table) {
    const candidate = parseColor(color)
    const dr = r - candidate.r
    const dg = g - candidate.g
    const db = b - candidate.b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function deterministicNoise(x: number, y: number) {
  const n = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233) * 43758.5453
  return n - Math.floor(n)
}

function convertIndexed(source: ImageData, indexed: Partial<IndexedSettings> = {}) {
  const table = buildIndexedColorTable(source, indexed)
  const ditherMethod = indexed.dither ? (indexed.ditherMethod ?? "ordered") : "none"
  const out = new Uint8ClampedArray(source.data)
  const matte = parseColor(indexed.matte, "#ffffff")
  const preserveExact = indexed.preserveExact === true
  const ditherStrength = clamp01((indexed.ditherAmount ?? 75) / 100)
  const exactSet = preserveExact
    ? new Set(table.map((color) => {
        const c = parseColor(color)
        return `${c.r},${c.g},${c.b}`
      }))
    : null

  if (ditherMethod === "diffusion") {
    const work = new Float32Array(source.data.length)
    for (let i = 0; i < source.data.length; i++) work[i] = source.data[i]
    const addError = (x: number, y: number, er: number, eg: number, eb: number, factor: number) => {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return
      const i = (y * source.width + x) * 4
      work[i] += er * factor
      work[i + 1] += eg * factor
      work[i + 2] += eb * factor
    }
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const i = (y * source.width + x) * 4
        if (source.data[i + 3] === 0 && indexed.transparency) continue
        const alpha = source.data[i + 3] / 255
        const r = alpha < 1 ? work[i] * alpha + matte.r * (1 - alpha) : work[i]
        const g = alpha < 1 ? work[i + 1] * alpha + matte.g * (1 - alpha) : work[i + 1]
        const b = alpha < 1 ? work[i + 2] * alpha + matte.b * (1 - alpha) : work[i + 2]
        const origKey = `${source.data[i]},${source.data[i + 1]},${source.data[i + 2]}`
        const isExact = exactSet ? exactSet.has(origKey) : false
        const nearest = nearestPaletteColor(r, g, b, table)
        out[i] = isExact ? source.data[i] : nearest.r
        out[i + 1] = isExact ? source.data[i + 1] : nearest.g
        out[i + 2] = isExact ? source.data[i + 2] : nearest.b
        out[i + 3] = indexed.transparency ? source.data[i + 3] : 255
        if (!isExact) {
          const er = (r - nearest.r) * ditherStrength
          const eg = (g - nearest.g) * ditherStrength
          const eb = (b - nearest.b) * ditherStrength
          addError(x + 1, y, er, eg, eb, 7 / 16)
          addError(x - 1, y + 1, er, eg, eb, 3 / 16)
          addError(x, y + 1, er, eg, eb, 5 / 16)
          addError(x + 1, y + 1, er, eg, eb, 1 / 16)
        }
      }
    }
    return new ImageData(out, source.width, source.height)
  }

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4
      if (source.data[i + 3] === 0 && indexed.transparency) continue
      const alpha = source.data[i + 3] / 255
      let r = alpha < 1 ? source.data[i] * alpha + matte.r * (1 - alpha) : source.data[i]
      let g = alpha < 1 ? source.data[i + 1] * alpha + matte.g * (1 - alpha) : source.data[i + 1]
      let b = alpha < 1 ? source.data[i + 2] * alpha + matte.b * (1 - alpha) : source.data[i + 2]
      const origKey = `${source.data[i]},${source.data[i + 1]},${source.data[i + 2]}`
      const isExact = exactSet ? exactSet.has(origKey) : false
      if (!isExact) {
        if (ditherMethod === "ordered") {
          const adjustment = ((BAYER_4[(y % 4) * 4 + (x % 4)] / 15) - 0.5) * 42 * ditherStrength
          r += adjustment
          g += adjustment
          b += adjustment
        } else if (ditherMethod === "noise") {
          const adjustment = (deterministicNoise(x, y) - 0.5) * 48 * ditherStrength
          r += adjustment
          g += adjustment
          b += adjustment
        }
      }
      const nearest = isExact
        ? { r: source.data[i], g: source.data[i + 1], b: source.data[i + 2] }
        : nearestPaletteColor(clamp(r), clamp(g), clamp(b), table)
      out[i] = nearest.r
      out[i + 1] = nearest.g
      out[i + 2] = nearest.b
      out[i + 3] = indexed.transparency ? source.data[i + 3] : 255
    }
  }
  return new ImageData(out, source.width, source.height)
}

function applyInk(base: { r: number; g: number; b: number }, ink: { r: number; g: number; b: number }, coverage: number) {
  const c = clamp01(coverage)
  return {
    r: base.r * (1 - c) + ink.r * c,
    g: base.g * (1 - c) + ink.g * c,
    b: base.b * (1 - c) + ink.b * c,
  }
}

/** Sample a 13-point curve at input coverage 0..1, returning 0..1. */
export function sampleDuotoneCurve(curve: number[] | undefined, t: number): number {
  if (!curve || curve.length < 2) return t
  const last = curve.length - 1
  const x = clamp01(t) * last
  const a = Math.floor(x)
  const b = Math.min(last, a + 1)
  const frac = x - a
  return clamp01((curve[a] * (1 - frac) + curve[b] * frac) / 255)
}

export function defaultDuotoneCurve(): number[] {
  return Array.from({ length: 13 }, (_, i) => Math.round((i / 12) * 255))
}

function convertDuotone(source: ImageData, duotone: Partial<DuotoneSettings> = {}) {
  const inkCount: 1 | 2 | 3 | 4 = (duotone.inkCount ?? 2)
  const inks = [
    parseColor(duotone.ink1, "#111111"),
    parseColor(duotone.ink2, "#1f80ff"),
    parseColor(duotone.ink3, "#d9534f"),
    parseColor(duotone.ink4, "#f0ad4e"),
  ]
  const opacities = [
    clamp01((duotone.opacity1 ?? 100) / 100),
    clamp01((duotone.opacity2 ?? 100) / 100),
    clamp01((duotone.opacity3 ?? 100) / 100),
    clamp01((duotone.opacity4 ?? 100) / 100),
  ]
  const balance = clamp01(duotone.balance ?? 1)
  const legacyCurve = Math.max(0.1, Math.min(5, duotone.curve ?? 1))
  const perInkCurves = [
    duotone.curves?.ink1,
    duotone.curves?.ink2,
    duotone.curves?.ink3,
    duotone.curves?.ink4,
  ]
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    const coverage = 1 - luminance(source.data[i], source.data[i + 1], source.data[i + 2]) / 255
    let paper = { r: 255, g: 255, b: 255 }
    for (let k = 0; k < inkCount; k++) {
      const curveCoverage = perInkCurves[k]
        ? sampleDuotoneCurve(perInkCurves[k], coverage)
        : k === 1
          ? Math.pow(coverage, legacyCurve) * balance
          : coverage
      paper = applyInk(paper, inks[k], curveCoverage * opacities[k])
    }
    out[i] = clamp8(paper.r)
    out[i + 1] = clamp8(paper.g)
    out[i + 2] = clamp8(paper.b)
  }
  return new ImageData(out, source.width, source.height)
}

/**
 * Built-in duotone/tritone/quadtone presets. Curve points are 13-step lookups
 * mapping the linear coverage 0..1 to ink coverage 0..1 (stored 0..255).
 */
export const DUOTONE_PRESETS: Record<string, NonNullable<DocumentModeSettings["duotone"]>> = {
  "warm-gray-pms-black": {
    inkCount: 2,
    ink1: "#1a1a1a",
    ink1Name: "Black",
    ink2: "#8a6d3b",
    ink2Name: "PMS 873 Gold",
    curve: 1.2,
    opacity1: 100,
    opacity2: 70,
    balance: 0.85,
  },
  "cool-gray-duo": {
    inkCount: 2,
    ink1: "#222831",
    ink1Name: "Black",
    ink2: "#0aa3d8",
    ink2Name: "Cool Blue",
    curve: 1.05,
    opacity1: 100,
    opacity2: 65,
    balance: 0.8,
  },
  "sepia-quad": {
    inkCount: 4,
    ink1: "#3a2a1e",
    ink1Name: "Black",
    ink2: "#a87149",
    ink2Name: "Brown",
    ink3: "#e4c590",
    ink3Name: "Cream",
    ink4: "#1f4f8a",
    ink4Name: "Cool Shadows",
    curve: 1,
    opacity1: 100,
    opacity2: 80,
    opacity3: 60,
    opacity4: 35,
    balance: 1,
  },
  "rich-tritone": {
    inkCount: 3,
    ink1: "#0e0e0e",
    ink1Name: "Black",
    ink2: "#9e2a2b",
    ink2Name: "Warm Red",
    ink3: "#003049",
    ink3Name: "Deep Blue",
    curve: 1.1,
    opacity1: 100,
    opacity2: 55,
    opacity3: 60,
    balance: 1,
  },
  "monochrome-black": {
    inkCount: 1,
    ink1: "#000000",
    ink2: "#000000",
    ink1Name: "Black",
    curve: 1,
    opacity1: 100,
    opacity2: 0,
  },
}

function bitmapValue(lum: number, x: number, y: number, bitmap: Partial<BitmapSettings>) {
  const threshold = bitmap.threshold ?? 128
  const method = bitmap.method ?? "threshold"
  if (method === "pattern-dither") {
    const bayer = BAYER_4[(y % 4) * 4 + (x % 4)]
    return lum >= threshold + ((bayer / 15) - 0.5) * 96 ? 255 : 0
  }
  if (method === "halftone") {
    const frequency = Math.max(1, bitmap.frequency ?? 10)
    const angle = ((bitmap.angle ?? 45) * Math.PI) / 180
    const u = x * Math.cos(angle) + y * Math.sin(angle)
    const v = -x * Math.sin(angle) + y * Math.cos(angle)
    const shape = bitmap.shape ?? "round"
    const pattern =
      shape === "line"
        ? Math.sin(u / frequency)
        : shape === "diamond"
          ? 1 - Math.min(1, (Math.abs((u % frequency) - frequency / 2) + Math.abs((v % frequency) - frequency / 2)) / frequency)
          : shape === "ellipse"
            ? Math.sin(u / frequency) * 0.7 + Math.cos(v / (frequency * 1.4)) * 0.3
            : (Math.sin(u / frequency) + Math.sin(v / frequency)) / 2
    return lum >= threshold + pattern * 64 ? 255 : 0
  }
  return clamp8(lum) >= threshold ? 255 : 0
}

function convertBitmap(source: ImageData, bitmap: Partial<BitmapSettings> = {}) {
  const out = new Uint8ClampedArray(source.data)
  if (bitmap.method === "diffusion-dither") {
    const gray = new Float32Array(source.width * source.height)
    for (let p = 0; p < gray.length; p++) {
      const i = p * 4
      gray[p] = luminance(source.data[i], source.data[i + 1], source.data[i + 2])
    }
    const threshold = bitmap.threshold ?? 128
    const add = (x: number, y: number, error: number, factor: number) => {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return
      gray[y * source.width + x] += error * factor
    }
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const p = y * source.width + x
        const value = clamp8(gray[p]) >= threshold ? 255 : 0
        const error = gray[p] - value
        const i = p * 4
        out[i] = out[i + 1] = out[i + 2] = value
        add(x + 1, y, error, 7 / 16)
        add(x - 1, y + 1, error, 3 / 16)
        add(x, y + 1, error, 5 / 16)
        add(x + 1, y + 1, error, 1 / 16)
      }
    }
    return new ImageData(out, source.width, source.height)
  }
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4
      const value = bitmapValue(luminance(source.data[i], source.data[i + 1], source.data[i + 2]), x, y, bitmap)
      out[i] = out[i + 1] = out[i + 2] = value
    }
  }
  return new ImageData(out, source.width, source.height)
}

function convertGrayscale(source: ImageData) {
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    const value = clamp8(luminance(out[i], out[i + 1], out[i + 2]))
    out[i] = out[i + 1] = out[i + 2] = value
  }
  return new ImageData(out, source.width, source.height)
}

export function convertImageDataToDocumentMode(source: ImageData, settings: DocumentModeSettings): ImageData {
  if (settings.mode === "Duotone") return convertDuotone(source, settings.duotone)
  if (settings.mode === "Indexed") return convertIndexed(source, settings.indexed)
  if (settings.mode === "Bitmap") return convertBitmap(source, settings.bitmap)
  if (settings.mode === "Grayscale") return convertGrayscale(source)
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
}
