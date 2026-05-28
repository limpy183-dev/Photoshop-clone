/**
 * Color mode conversion engines: Duotone, Bitmap, and Indexed Color.
 *
 * Gaps #153 (Duotone), #154 (Indexed Color), #155 (Bitmap) from
 * comprehensive-implementation-gaps.txt.
 *
 * All algorithms are pure pixel-level implementations working on ImageData.
 */

// ---------------------------------------------------------------------------
//  Duotone Mode (#153)
// ---------------------------------------------------------------------------

export interface DuotoneCurve {
  /** Ink color as hex string e.g. "#003366" */
  ink: string
  /** Display name */
  name: string
  /** 256-entry transfer curve (0–1 output for each input level 0–255) */
  curve: number[]
}

export type DuotoneMode = "monotone" | "duotone" | "tritone" | "quadtone"

export interface DuotoneSettings {
  mode: DuotoneMode
  inks: DuotoneCurve[]
  overprint: boolean
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

/** Create a linear (identity) transfer curve for the given ink color. */
export function createLinearDuotoneCurve(color: string, name?: string): DuotoneCurve {
  const curve = new Array<number>(256)
  for (let i = 0; i < 256; i++) curve[i] = i / 255
  return { ink: color, name: name ?? color, curve }
}

/** Create an S-curve (shadows-biased) transfer curve. */
export function createSCurveDuotoneCurve(color: string, name?: string): DuotoneCurve {
  const curve = new Array<number>(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    curve[i] = t * t * (3 - 2 * t) // smoothstep
  }
  return { ink: color, name: name ?? color, curve }
}

export const DUOTONE_PRESETS: Array<{ id: string; label: string; settings: DuotoneSettings }> = [
  {
    id: "sepia-mono",
    label: "Sepia Monotone",
    settings: {
      mode: "monotone",
      inks: [createLinearDuotoneCurve("#704214", "Sepia")],
      overprint: false,
    },
  },
  {
    id: "blue-yellow",
    label: "Blue / Yellow Duotone",
    settings: {
      mode: "duotone",
      inks: [
        createLinearDuotoneCurve("#1a237e", "Blue"),
        createSCurveDuotoneCurve("#fdd835", "Yellow"),
      ],
      overprint: true,
    },
  },
  {
    id: "warm-grey",
    label: "Warm Grey Duotone",
    settings: {
      mode: "duotone",
      inks: [
        createLinearDuotoneCurve("#212121", "Black"),
        createSCurveDuotoneCurve("#bcaaa4", "Warm Grey"),
      ],
      overprint: true,
    },
  },
  {
    id: "cyan-magenta",
    label: "Cyan / Magenta Duotone",
    settings: {
      mode: "duotone",
      inks: [
        createLinearDuotoneCurve("#00acc1", "Cyan"),
        createSCurveDuotoneCurve("#d81b60", "Magenta"),
      ],
      overprint: true,
    },
  },
  {
    id: "green-gold",
    label: "Green / Gold Duotone",
    settings: {
      mode: "duotone",
      inks: [
        createLinearDuotoneCurve("#2e7d32", "Green"),
        createSCurveDuotoneCurve("#c6a700", "Gold"),
      ],
      overprint: true,
    },
  },
  {
    id: "cmy-tritone",
    label: "CMY Tritone",
    settings: {
      mode: "tritone",
      inks: [
        createLinearDuotoneCurve("#00bcd4", "Cyan"),
        createSCurveDuotoneCurve("#e91e63", "Magenta"),
        createSCurveDuotoneCurve("#ffeb3b", "Yellow"),
      ],
      overprint: true,
    },
  },
  {
    id: "cmyk-quad",
    label: "CMYK Quadtone",
    settings: {
      mode: "quadtone",
      inks: [
        createLinearDuotoneCurve("#00bcd4", "Cyan"),
        createSCurveDuotoneCurve("#e91e63", "Magenta"),
        createSCurveDuotoneCurve("#ffeb3b", "Yellow"),
        createLinearDuotoneCurve("#212121", "Black"),
      ],
      overprint: true,
    },
  },
  {
    id: "platinum",
    label: "Platinum Monotone",
    settings: {
      mode: "monotone",
      inks: [createLinearDuotoneCurve("#78909c", "Platinum")],
      overprint: false,
    },
  },
  {
    id: "cyanotype",
    label: "Cyanotype Monotone",
    settings: {
      mode: "monotone",
      inks: [createLinearDuotoneCurve("#0d47a1", "Cyanotype Blue")],
      overprint: false,
    },
  },
]

/**
 * Convert an image to duotone using the specified ink curves.
 * First converts to grayscale luminance, then applies each ink's transfer
 * curve and tints with the ink color, blending multiplicatively.
 */
export function convertToDuotone(imageData: ImageData, settings: DuotoneSettings): ImageData {
  const { width, height, data } = imageData
  const out = new ImageData(width, height)
  const od = out.data

  for (let i = 0; i < data.length; i += 4) {
    // Convert to grayscale using luminance
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    const alpha = data[i + 3]

    let r = 0, g = 0, b = 0
    for (const ink of settings.inks) {
      const intensity = ink.curve[gray] ?? gray / 255
      const [ir, ig, ib] = hexToRgb(ink.ink)
      if (settings.overprint) {
        // Multiply blend (overprint simulation)
        const tr = (ir / 255) * intensity
        const tg = (ig / 255) * intensity
        const tb = (ib / 255) * intensity
        r = 1 - (1 - r) * (1 - tr)
        g = 1 - (1 - g) * (1 - tg)
        b = 1 - (1 - b) * (1 - tb)
      } else {
        r += (ir / 255) * intensity
        g += (ig / 255) * intensity
        b += (ib / 255) * intensity
      }
    }

    od[i] = Math.min(255, Math.round(r * 255))
    od[i + 1] = Math.min(255, Math.round(g * 255))
    od[i + 2] = Math.min(255, Math.round(b * 255))
    od[i + 3] = alpha
  }

  return out
}

/** Simulate overprint preview for a duotone image. */
export function duotoneOverprintPreview(imageData: ImageData, settings: DuotoneSettings): ImageData {
  return convertToDuotone(imageData, { ...settings, overprint: true })
}

// ---------------------------------------------------------------------------
//  Bitmap Mode (#155)
// ---------------------------------------------------------------------------

export type BitmapMethod =
  | "50-percent-threshold"
  | "pattern-dither"
  | "diffusion-dither"
  | "halftone-screen"
  | "custom-pattern"

export type HalftoneShape = "round" | "diamond" | "ellipse" | "line" | "square" | "cross"

export interface BitmapSettings {
  method: BitmapMethod
  /** Threshold level 0–255 for 50-percent-threshold method */
  threshold?: number
  /** Halftone frequency (dots per inch) */
  frequency?: number
  /** Halftone screen angle in degrees */
  angle?: number
  /** Halftone dot shape */
  shape?: HalftoneShape
}

// Bayer 8x8 ordered dither matrix
const BAYER_8X8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
]

function halftoneSpot(x: number, y: number, angle: number, frequency: number, shape: HalftoneShape): number {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rx = x * cos + y * sin
  const ry = -x * sin + y * cos
  const cellSize = 72 / Math.max(1, frequency) // approximate cell size in pixels at 72dpi
  const cx = ((rx % cellSize) + cellSize) % cellSize
  const cy = ((ry % cellSize) + cellSize) % cellSize
  const nx = (cx / cellSize) * 2 - 1 // -1 to 1
  const ny = (cy / cellSize) * 2 - 1

  switch (shape) {
    case "round":
      return Math.sqrt(nx * nx + ny * ny)
    case "diamond":
      return Math.abs(nx) + Math.abs(ny)
    case "ellipse":
      return Math.sqrt(nx * nx * 0.6 + ny * ny * 1.4)
    case "line":
      return Math.abs(ny)
    case "square":
      return Math.max(Math.abs(nx), Math.abs(ny))
    case "cross":
      return Math.min(Math.abs(nx), Math.abs(ny))
    default:
      return Math.sqrt(nx * nx + ny * ny)
  }
}

/**
 * Convert an image to 1-bit bitmap using the specified method.
 * Output pixels are either black (0) or white (255).
 */
export function convertToBitmap(imageData: ImageData, settings: BitmapSettings): ImageData {
  const { width, height, data } = imageData
  const out = new ImageData(width, height)
  const od = out.data

  // Convert to grayscale first
  const gray = new Float32Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    gray[i >> 2] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  const threshold = settings.threshold ?? 128

  switch (settings.method) {
    case "50-percent-threshold": {
      for (let i = 0; i < gray.length; i++) {
        const v = gray[i] >= threshold ? 255 : 0
        const j = i * 4
        od[j] = od[j + 1] = od[j + 2] = v
        od[j + 3] = data[j + 3]
      }
      break
    }
    case "pattern-dither": {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x
          const bayerThreshold = (BAYER_8X8[y & 7][x & 7] / 64) * 255
          const v = gray[idx] > bayerThreshold ? 255 : 0
          const j = idx * 4
          od[j] = od[j + 1] = od[j + 2] = v
          od[j + 3] = data[j + 3]
        }
      }
      break
    }
    case "diffusion-dither": {
      // Floyd-Steinberg error diffusion
      const buf = new Float32Array(gray)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x
          const oldVal = buf[idx]
          const newVal = oldVal >= threshold ? 255 : 0
          const error = oldVal - newVal
          buf[idx] = newVal

          if (x + 1 < width) buf[idx + 1] += error * (7 / 16)
          if (y + 1 < height) {
            if (x > 0) buf[(y + 1) * width + x - 1] += error * (3 / 16)
            buf[(y + 1) * width + x] += error * (5 / 16)
            if (x + 1 < width) buf[(y + 1) * width + x + 1] += error * (1 / 16)
          }
        }
      }
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] >= threshold ? 255 : 0
        const j = i * 4
        od[j] = od[j + 1] = od[j + 2] = v
        od[j + 3] = data[j + 3]
      }
      break
    }
    case "halftone-screen": {
      const freq = settings.frequency ?? 45
      const angle = settings.angle ?? 45
      const shape = settings.shape ?? "round"
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x
          const spotVal = halftoneSpot(x, y, angle, freq, shape)
          const normalizedGray = gray[idx] / 255
          const v = normalizedGray > spotVal ? 255 : 0
          const j = idx * 4
          od[j] = od[j + 1] = od[j + 2] = v
          od[j + 3] = data[j + 3]
        }
      }
      break
    }
    case "custom-pattern":
      // Falls back to pattern dither
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x
          const bayerThreshold = (BAYER_8X8[y & 7][x & 7] / 64) * 255
          const v = gray[idx] > bayerThreshold ? 255 : 0
          const j = idx * 4
          od[j] = od[j + 1] = od[j + 2] = v
          od[j + 3] = data[j + 3]
        }
      }
      break
  }

  return out
}

// ---------------------------------------------------------------------------
//  Indexed Color Mode (#154)
// ---------------------------------------------------------------------------

export type IndexedPaletteType =
  | "exact"
  | "system-mac"
  | "system-windows"
  | "web"
  | "uniform"
  | "perceptual"
  | "selective"
  | "adaptive"
  | "custom"

export type IndexedDitherMethod = "none" | "diffusion" | "pattern" | "noise"

export interface IndexedColorSettings {
  palette: IndexedPaletteType
  colors: number
  forcedColors?: string[]
  transparency?: boolean
  matte?: string
  dither?: IndexedDitherMethod
  ditherAmount?: number
}

export interface IndexedColorTable {
  entries: string[]
  name?: string
}

/** 216-color web-safe palette */
export const WEB_SAFE_PALETTE: string[] = (() => {
  const p: string[] = []
  const levels = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff]
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        p.push(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`)
      }
    }
  }
  return p
})()

/** Approximate Macintosh system palette (256 entries) */
export const SYSTEM_MAC_PALETTE: string[] = (() => {
  const p: string[] = []
  // Mac system palette: 6x6x6 color cube + 10 shades of red/green/blue/gray
  const levels = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff]
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        p.push(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`)
      }
    }
  }
  // Fill remaining with grays
  while (p.length < 256) {
    const g = Math.round((p.length - 216) * (255 / 40))
    p.push(`#${g.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}`)
  }
  return p.slice(0, 256)
})()

/** Approximate Windows system palette (256 entries) */
export const SYSTEM_WINDOWS_PALETTE: string[] = (() => {
  const p: string[] = []
  // Windows system: 16 standard VGA colors + 216 web safe + 24 grays
  const vga = [
    "#000000", "#800000", "#008000", "#808000",
    "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00",
    "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ]
  p.push(...vga)
  // 216 web-safe
  const levels = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff]
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
        if (!p.includes(hex)) p.push(hex)
      }
    }
  }
  while (p.length < 256) {
    const g = Math.round(((p.length - 232) / 24) * 255)
    p.push(`#${Math.max(0, Math.min(255, g)).toString(16).padStart(2, "0")}`.repeat(3).replace(/#/g, "").substring(0, 6))
  }
  return p.slice(0, 256)
})()

/**
 * Median-cut color quantization.
 * Builds an adaptive palette from the image's actual colors.
 */
export function buildAdaptivePalette(imageData: ImageData, maxColors: number): string[] {
  const { data } = imageData
  const pixels: Array<[number, number, number]> = []
  // Sample pixels (skip transparent)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  if (!pixels.length) return ["#000000"]

  type Box = { pixels: Array<[number, number, number]> }
  const boxes: Box[] = [{ pixels }]

  while (boxes.length < maxColors) {
    // Find the box with the largest range
    let maxRange = -1
    let splitIdx = 0
    let splitChannel = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.pixels.length < 2) continue
      for (let ch = 0; ch < 3; ch++) {
        let min = 255, max = 0
        for (const px of box.pixels) {
          if (px[ch] < min) min = px[ch]
          if (px[ch] > max) max = px[ch]
        }
        const range = max - min
        if (range > maxRange) {
          maxRange = range
          splitIdx = i
          splitChannel = ch
        }
      }
    }
    if (maxRange <= 0) break

    const box = boxes[splitIdx]
    box.pixels.sort((a, b) => a[splitChannel] - b[splitChannel])
    const mid = box.pixels.length >> 1
    boxes.splice(splitIdx, 1,
      { pixels: box.pixels.slice(0, mid) },
      { pixels: box.pixels.slice(mid) },
    )
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0
    for (const px of box.pixels) {
      r += px[0]; g += px[1]; b += px[2]
    }
    const n = box.pixels.length || 1
    r = Math.round(r / n)
    g = Math.round(g / n)
    b = Math.round(b / n)
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
  })
}

function findClosestPaletteIndex(r: number, g: number, b: number, palette: Array<[number, number, number]>): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0]
    const dg = g - palette[i][1]
    const db = b - palette[i][2]
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  return bestIdx
}

function resolvePalette(settings: IndexedColorSettings, imageData: ImageData): string[] {
  const maxColors = Math.max(2, Math.min(256, settings.colors))
  switch (settings.palette) {
    case "web":
      return WEB_SAFE_PALETTE.slice(0, maxColors)
    case "system-mac":
      return SYSTEM_MAC_PALETTE.slice(0, maxColors)
    case "system-windows":
      return SYSTEM_WINDOWS_PALETTE.slice(0, maxColors)
    case "uniform": {
      const levels = Math.max(2, Math.ceil(Math.cbrt(maxColors)))
      const pal: string[] = []
      for (let r = 0; r < levels && pal.length < maxColors; r++) {
        for (let g = 0; g < levels && pal.length < maxColors; g++) {
          for (let b = 0; b < levels && pal.length < maxColors; b++) {
            const rv = Math.round((r / (levels - 1)) * 255)
            const gv = Math.round((g / (levels - 1)) * 255)
            const bv = Math.round((b / (levels - 1)) * 255)
            pal.push(`#${rv.toString(16).padStart(2, "0")}${gv.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`)
          }
        }
      }
      return pal
    }
    case "exact":
    case "adaptive":
    case "perceptual":
    case "selective":
      return buildAdaptivePalette(imageData, maxColors)
    case "custom":
      return settings.forcedColors?.slice(0, maxColors) ?? buildAdaptivePalette(imageData, maxColors)
    default:
      return buildAdaptivePalette(imageData, maxColors)
  }
}

/**
 * Convert an image to indexed color mode.
 * Returns both the remapped ImageData and the color table used.
 */
export function convertToIndexedColor(
  imageData: ImageData,
  settings: IndexedColorSettings,
): { imageData: ImageData; colorTable: IndexedColorTable } {
  const { width, height, data } = imageData
  const paletteHex = resolvePalette(settings, imageData)
  const palette: Array<[number, number, number]> = paletteHex.map((h) => hexToRgb(h))

  const out = new ImageData(width, height)
  const od = out.data
  const dither = settings.dither ?? "none"
  const ditherAmount = settings.ditherAmount ?? 1

  if (dither === "diffusion") {
    // Floyd-Steinberg dither
    const errR = new Float32Array(width * height)
    const errG = new Float32Array(width * height)
    const errB = new Float32Array(width * height)
    // Initialize
    for (let i = 0; i < data.length; i += 4) {
      const idx = i >> 2
      errR[idx] = data[i]
      errG[idx] = data[i + 1]
      errB[idx] = data[i + 2]
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const r = Math.max(0, Math.min(255, Math.round(errR[idx])))
        const g = Math.max(0, Math.min(255, Math.round(errG[idx])))
        const b = Math.max(0, Math.min(255, Math.round(errB[idx])))
        const ci = findClosestPaletteIndex(r, g, b, palette)
        const [pr, pg, pb] = palette[ci]
        const j = idx * 4
        od[j] = pr; od[j + 1] = pg; od[j + 2] = pb
        od[j + 3] = settings.transparency ? data[j + 3] : 255

        const eR = (r - pr) * ditherAmount
        const eG = (g - pg) * ditherAmount
        const eB = (b - pb) * ditherAmount
        if (x + 1 < width) {
          errR[idx + 1] += eR * (7 / 16)
          errG[idx + 1] += eG * (7 / 16)
          errB[idx + 1] += eB * (7 / 16)
        }
        if (y + 1 < height) {
          if (x > 0) {
            errR[(y + 1) * width + x - 1] += eR * (3 / 16)
            errG[(y + 1) * width + x - 1] += eG * (3 / 16)
            errB[(y + 1) * width + x - 1] += eB * (3 / 16)
          }
          errR[(y + 1) * width + x] += eR * (5 / 16)
          errG[(y + 1) * width + x] += eG * (5 / 16)
          errB[(y + 1) * width + x] += eB * (5 / 16)
          if (x + 1 < width) {
            errR[(y + 1) * width + x + 1] += eR * (1 / 16)
            errG[(y + 1) * width + x + 1] += eG * (1 / 16)
            errB[(y + 1) * width + x + 1] += eB * (1 / 16)
          }
        }
      }
    }
  } else if (dither === "pattern") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const j = idx * 4
        const bayerVal = ((BAYER_8X8[y & 7][x & 7] / 64) - 0.5) * 64 * ditherAmount
        const r = Math.max(0, Math.min(255, Math.round(data[j] + bayerVal)))
        const g = Math.max(0, Math.min(255, Math.round(data[j + 1] + bayerVal)))
        const b = Math.max(0, Math.min(255, Math.round(data[j + 2] + bayerVal)))
        const ci = findClosestPaletteIndex(r, g, b, palette)
        od[j] = palette[ci][0]
        od[j + 1] = palette[ci][1]
        od[j + 2] = palette[ci][2]
        od[j + 3] = settings.transparency ? data[j + 3] : 255
      }
    }
  } else if (dither === "noise") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const j = idx * 4
        const noise = (Math.random() - 0.5) * 64 * ditherAmount
        const r = Math.max(0, Math.min(255, Math.round(data[j] + noise)))
        const g = Math.max(0, Math.min(255, Math.round(data[j + 1] + noise)))
        const b = Math.max(0, Math.min(255, Math.round(data[j + 2] + noise)))
        const ci = findClosestPaletteIndex(r, g, b, palette)
        od[j] = palette[ci][0]
        od[j + 1] = palette[ci][1]
        od[j + 2] = palette[ci][2]
        od[j + 3] = settings.transparency ? data[j + 3] : 255
      }
    }
  } else {
    // No dither — direct mapping
    for (let i = 0; i < data.length; i += 4) {
      const ci = findClosestPaletteIndex(data[i], data[i + 1], data[i + 2], palette)
      od[i] = palette[ci][0]
      od[i + 1] = palette[ci][1]
      od[i + 2] = palette[ci][2]
      od[i + 3] = settings.transparency ? data[i + 3] : 255
    }
  }

  return {
    imageData: out,
    colorTable: { entries: paletteHex, name: settings.palette },
  }
}

// ---------------------------------------------------------------------------
//  Multichannel Mode (#156)
// ---------------------------------------------------------------------------

export interface MultichannelDocument {
  width: number
  height: number
  channels: Array<{
    name: string
    color: string
    data: Uint8Array
  }>
}

/**
 * Convert an RGB ImageData to multichannel mode (separate channel documents).
 */
export function convertToMultichannel(imageData: ImageData): MultichannelDocument {
  const { width, height, data } = imageData
  const rCh = new Uint8Array(width * height)
  const gCh = new Uint8Array(width * height)
  const bCh = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    const idx = i >> 2
    rCh[idx] = data[i]
    gCh[idx] = data[i + 1]
    bCh[idx] = data[i + 2]
  }
  return {
    width,
    height,
    channels: [
      { name: "Cyan", color: "#00bcd4", data: rCh },
      { name: "Magenta", color: "#e91e63", data: gCh },
      { name: "Yellow", color: "#ffeb3b", data: bCh },
    ],
  }
}
