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
        const nearest = nearestPaletteColor(r, g, b, table)
        out[i] = nearest.r
        out[i + 1] = nearest.g
        out[i + 2] = nearest.b
        out[i + 3] = indexed.transparency ? source.data[i + 3] : 255
        addError(x + 1, y, r - nearest.r, g - nearest.g, b - nearest.b, 7 / 16)
        addError(x - 1, y + 1, r - nearest.r, g - nearest.g, b - nearest.b, 3 / 16)
        addError(x, y + 1, r - nearest.r, g - nearest.g, b - nearest.b, 5 / 16)
        addError(x + 1, y + 1, r - nearest.r, g - nearest.g, b - nearest.b, 1 / 16)
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
      if (ditherMethod === "ordered") {
        const adjustment = ((BAYER_4[(y % 4) * 4 + (x % 4)] / 15) - 0.5) * 42
        r += adjustment
        g += adjustment
        b += adjustment
      } else if (ditherMethod === "noise") {
        const adjustment = (deterministicNoise(x, y) - 0.5) * 48
        r += adjustment
        g += adjustment
        b += adjustment
      }
      const nearest = nearestPaletteColor(clamp(r), clamp(g), clamp(b), table)
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

function convertDuotone(source: ImageData, duotone: Partial<DuotoneSettings> = {}) {
  const ink1 = parseColor(duotone.ink1, "#111111")
  const ink2 = parseColor(duotone.ink2, "#1f80ff")
  const opacity1 = clamp01((duotone.opacity1 ?? 100) / 100)
  const opacity2 = clamp01((duotone.opacity2 ?? 100) / 100)
  const balance = clamp01(duotone.balance ?? 1)
  const curve = Math.max(0.1, Math.min(5, duotone.curve ?? 1))
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    const coverage = 1 - luminance(source.data[i], source.data[i + 1], source.data[i + 2]) / 255
    let paper = { r: 255, g: 255, b: 255 }
    paper = applyInk(paper, ink1, coverage * opacity1)
    paper = applyInk(paper, ink2, Math.pow(coverage, curve) * opacity2 * balance)
    out[i] = clamp8(paper.r)
    out[i + 1] = clamp8(paper.g)
    out[i + 2] = clamp8(paper.b)
  }
  return new ImageData(out, source.width, source.height)
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
