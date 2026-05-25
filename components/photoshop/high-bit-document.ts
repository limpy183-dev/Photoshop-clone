import {
  applyHighBitAdjustment,
  createHighBitImageFromImageData,
  toneMapHighBitImageToImageData,
  type HighBitAdjustment,
  type HighBitImage,
  type HighBitToneMapOptions,
  type PipelineBitDepth,
  type PipelineColorMode,
} from "./color-pipeline"
import { resolveColorReplacementPixel, type BrushRgba } from "./brush-engine"
import { getFilter, type FilterContext } from "./filters"
import type { SelectionImageSource } from "./selection-algorithms"
import type { BlendMode, Layer, PsDocument } from "./types"

type HighBitArray = Uint8ClampedArray | Uint16Array | Float32Array
type HighBitSideBand = {
  r: HighBitArray
  g: HighBitArray
  b: HighBitArray
  a: HighBitArray
}

export type HighBitLayer = Layer & {
  __highBitImageData?: HighBitImage
  __highBitDepthData?: HighBitSideBand
}

export type HighBitDocument = PsDocument & {
  __highBitImageData?: HighBitImage
}

export interface HighBitImagePayload {
  width: number
  height: number
  channels: 4
  bitDepth: PipelineBitDepth
  colorMode: PipelineColorMode
  profile?: string
  storage: HighBitImage["storage"]
  encoding: "base64"
  data: string
  warnings?: string[]
}

export interface HighBitPaintDabOptions {
  x: number
  y: number
  radius: number
  color: { r: number; g: number; b: number; a?: number }
  opacity?: number
  hardness?: number
  mode?: "source-over" | "destination-out" | "color-replace"
  replacementMode?: "color" | "hue" | "saturation" | "luminosity"
  sampleColor?: { r: number; g: number; b: number; a?: number }
  tolerance?: number
  dirtyRect?: { x: number; y: number; w: number; h: number }
}

export interface HighBitEditingSurfaceLayer {
  id: string
  name?: string
  visible?: boolean
  opacity?: number
  fillOpacity?: number
  blendMode?: BlendMode
  image: HighBitImage
  mask?: HTMLCanvasElement | null
  clipMask?: HTMLCanvasElement | null
}

export interface HighBitEditingSurface {
  width: number
  height: number
  bitDepth: PipelineBitDepth
  colorMode: PipelineColorMode
  profile?: string
  background?: string
  layers: HighBitEditingSurfaceLayer[]
  warnings: string[]
}

export interface CreateHighBitEditingSurfaceInput {
  width: number
  height: number
  bitDepth: PipelineBitDepth
  colorMode: PipelineColorMode
  profile?: string
  background?: string
  layers?: HighBitEditingSurfaceLayer[]
}

const DIRECT_ADJUSTMENTS = new Set<HighBitAdjustment["type"]>([
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

const BLUR_FILTERS = new Set([
  "blur",
  "blur-more",
  "average",
  "average-blur",
  "box-blur",
  "gaussian-blur",
  "motion-blur",
  "smart-blur",
  "surface-blur",
  "shape-blur",
  "lens-blur",
  "field-blur",
  "iris-blur",
  "tilt-shift",
])

const SHARPEN_FILTERS = new Set(["sharpen", "sharpen-more", "unsharp-mask", "smart-sharpen"])

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function clamp8(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function highBitMax(storage: HighBitImage["storage"]) {
  return storage === "uint16" ? 65535 : storage === "uint8" ? 255 : 1
}

export function highBitImageToSelectionSource(image: HighBitImage): SelectionImageSource {
  return {
    width: image.width,
    height: image.height,
    channels: image.channels,
    maxValue: highBitMax(image.storage),
    data: image.data,
  }
}

function readUnit(image: HighBitImage, index: number) {
  return Number(image.data[index]) / highBitMax(image.storage)
}

function writeUnit(image: HighBitImage, index: number, value: number) {
  const v = clamp(value)
  if (image.storage === "uint16") (image.data as Uint16Array)[index] = Math.round(v * 65535)
  else if (image.storage === "uint8") (image.data as Uint8ClampedArray)[index] = clamp8(v * 255)
  else (image.data as Float32Array)[index] = v
}

function cloneHighBitImage(source: HighBitImage, data?: HighBitImage["data"], warnings = source.warnings): HighBitImage {
  const Ctor = source.storage === "uint16" ? Uint16Array : source.storage === "float32" ? Float32Array : Uint8ClampedArray
  return {
    ...source,
    data: data ?? new Ctor(source.data) as HighBitImage["data"],
    warnings: [...warnings],
  }
}

function emptyHighBitImage(width: number, height: number, bitDepth: PipelineBitDepth, colorMode: PipelineColorMode, profile?: string): HighBitImage {
  const storage = bitDepth === 16 ? "uint16" : bitDepth === 32 ? "float32" : "uint8"
  const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
  return {
    width,
    height,
    channels: 4,
    bitDepth,
    colorMode,
    profile,
    storage,
    data: new Ctor(width * height * 4) as HighBitImage["data"],
    warnings: ["High-bit document composite is stored in a typed array and tone-mapped into the canvas preview."],
  }
}

function highBitFromCssColor(width: number, height: number, doc: PsDocument, css: string, transparent = false) {
  const image = emptyHighBitImage(width, height, doc.bitDepth, doc.colorMode, doc.colorManagement?.assignedProfile)
  const color = parseCssColor(css)
  for (let i = 0; i < image.data.length; i += 4) {
    writeUnit(image, i, transparent ? 0 : color.r / 255)
    writeUnit(image, i + 1, transparent ? 0 : color.g / 255)
    writeUnit(image, i + 2, transparent ? 0 : color.b / 255)
    writeUnit(image, i + 3, transparent ? 0 : 1)
  }
  return image
}

function parseCssColor(value: string | undefined) {
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

function canvasImageData(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
}

export function getLayerHighBitImage(layer: Layer, doc: PsDocument): HighBitImage | null {
  const highLayer = layer as HighBitLayer
  if (highLayer.__highBitImageData) return highLayer.__highBitImageData
  if (highLayer.__highBitDepthData) {
    const side = highLayer.__highBitDepthData
    const storage = side.r instanceof Uint16Array ? "uint16" : side.r instanceof Float32Array ? "float32" : "uint8"
    const bitDepth = storage === "uint16" ? 16 : storage === "float32" ? 32 : 8
    const width = layer.canvas?.width || doc.width
    const height = layer.canvas?.height || doc.height
    const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
    const data = new Ctor(width * height * 4) as HighBitImage["data"]
    const total = Math.min(width * height, side.r.length, side.g.length, side.b.length, side.a.length)
    for (let p = 0; p < total; p++) {
      const i = p * 4
      data[i] = side.r[p]
      data[i + 1] = side.g[p]
      data[i + 2] = side.b[p]
      data[i + 3] = side.a[p]
    }
    highLayer.__highBitImageData = {
      width,
      height,
      channels: 4,
      bitDepth,
      colorMode: doc.colorMode,
      profile: doc.colorManagement?.assignedProfile,
      storage,
      data,
      warnings: ["Layer source high-bit channel data is used as editable typed-array pixels."],
    }
    return highLayer.__highBitImageData
  }
  return null
}

export function ensureLayerHighBitImage(layer: Layer, doc: PsDocument): HighBitImage | null {
  const existing = getLayerHighBitImage(layer, doc)
  if (existing) return existing
  if (doc.bitDepth <= 8 || !layer.canvas || typeof layer.canvas.getContext !== "function") return null
  const image = createHighBitImageFromImageData(canvasImageData(layer.canvas), {
    bitDepth: doc.bitDepth,
    colorMode: doc.colorMode,
    profile: doc.colorManagement?.assignedProfile,
  })
  ;(layer as HighBitLayer).__highBitImageData = image
  return image
}

function imageDataFromHighBitChannels(channels: HighBitSideBand, width: number, height: number, doc: PsDocument): HighBitImage {
  const storage = channels.r instanceof Uint16Array ? "uint16" : channels.r instanceof Float32Array ? "float32" : "uint8"
  const bitDepth = storage === "uint16" ? 16 : storage === "float32" ? 32 : 8
  const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
  const data = new Ctor(width * height * 4) as HighBitImage["data"]
  const total = Math.min(width * height, channels.r.length, channels.g.length, channels.b.length, channels.a.length)
  for (let p = 0; p < total; p++) {
    const i = p * 4
    data[i] = channels.r[p]
    data[i + 1] = channels.g[p]
    data[i + 2] = channels.b[p]
    data[i + 3] = channels.a[p]
  }
  return {
    width,
    height,
    channels: 4,
    bitDepth,
    colorMode: doc.colorMode,
    profile: doc.colorManagement?.assignedProfile,
    storage,
    data,
    warnings: ["Layer source high-bit channels were interleaved into editable RGBA typed-array pixels."],
  }
}

function numberParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function boolParam(params: Record<string, number | string | boolean>, key: string, fallback = false) {
  return typeof params[key] === "boolean" ? params[key] as boolean : fallback
}

function bilinearSampleHighBit(source: HighBitImage, x: number, y: number): [number, number, number, number] {
  const { width, height } = source
  const ix = Math.max(0, Math.min(width - 1, x))
  const iy = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(ix)
  const y0 = Math.floor(iy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = ix - x0
  const fy = iy - y0
  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const a = readUnit(source, i00 + c)
    const b = readUnit(source, i10 + c)
    const c0 = readUnit(source, i01 + c)
    const d = readUnit(source, i11 + c)
    out[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c0 * (1 - fx) * fy + d * fx * fy
  }
  return out
}

function gaussianBlurHighBit(source: HighBitImage, radius: number): HighBitImage {
  if (radius <= 0) return cloneHighBitImage(source)
  // 3 passes of box blur approximating Gaussian — matches filters.ts gaussianBlur
  const r = Math.max(1, Math.round(radius / 3))
  let out = boxBlur(source, r)
  out = boxBlur(out, r)
  out = boxBlur(out, r)
  return out
}

function unsharpMaskHighBit(source: HighBitImage, amount: number, radius: number): HighBitImage {
  const blurred = gaussianBlurHighBit(source, radius)
  const out = new Float32Array(source.data.length)
  const k = amount / 100
  for (let i = 0; i < source.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = readUnit(source, i + c)
      const blur = readUnit(blurred, i + c)
      out[i + c] = v + (v - blur) * k
    }
    out[i + 3] = readUnit(source, i + 3)
  }
  return floatToSourceStorage(source, out)
}

function smartSharpenHighBit(
  source: HighBitImage,
  amount: number,
  radius: number,
  threshold: number,
  shadowFade: number,
  highlightFade: number,
  remove: string,
): HighBitImage {
  let blurred: HighBitImage
  if (remove === "motion") {
    blurred = motionBlur(source, Math.max(0.5, radius), 0)
  } else {
    blurred = gaussianBlurHighBit(source, Math.max(0.5, radius))
  }
  const out = new Float32Array(source.data.length)
  const k = amount / 100
  const shadowK = 1 - shadowFade / 100
  const highlightK = 1 - highlightFade / 100
  const thresholdUnit = threshold / 255
  for (let i = 0; i < source.data.length; i += 4) {
    const r = readUnit(source, i)
    const g = readUnit(source, i + 1)
    const b = readUnit(source, i + 2)
    const br = readUnit(blurred, i)
    const bg = readUnit(blurred, i + 1)
    const bb = readUnit(blurred, i + 2)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const edgeMag = (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)) / 3
    if (edgeMag < thresholdUnit) {
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = readUnit(source, i + 3)
      continue
    }
    let fade = 1
    if (lum < 64 / 255) fade *= shadowK + (1 - shadowK) * (lum / (64 / 255))
    else if (lum > 192 / 255) fade *= highlightK + (1 - highlightK) * ((1 - lum) / (63 / 255))
    const effectiveK = k * fade
    out[i] = r + (r - br) * effectiveK
    out[i + 1] = g + (g - bg) * effectiveK
    out[i + 2] = b + (b - bb) * effectiveK
    out[i + 3] = readUnit(source, i + 3)
  }
  return floatToSourceStorage(source, out)
}

function pseudoDitherHighBit(seed: number): number {
  const x = Math.sin(seed * 78.233 + 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function radialBlurHighBit(
  source: HighBitImage,
  amount: number,
  method: string,
  quality: string,
  centerX: number,
  centerY: number,
): HighBitImage {
  const { width, height } = source
  const cx = clamp(centerX / 100) * (width - 1)
  const cy = clamp(centerY / 100) * (height - 1)
  const strength = Math.max(0, Math.min(100, amount)) / 100
  if (strength <= 0) return cloneHighBitImage(source)
  const steps = quality === "best" ? 48 : quality === "good" ? 24 : 12
  const diag = Math.hypot(width, height)
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)
      const accum = [0, 0, 0, 0]
      let wSum = 0
      for (let s = 0; s < steps; s++) {
        const stepWeight = 1 - Math.abs((s / Math.max(1, steps - 1)) - 0.5) * 2
        const jitter = quality === "best" ? (pseudoDitherHighBit(y * width + x + s * 17) - 0.5) / steps : 0
        const t = (s / Math.max(1, steps - 1) - 0.5 + jitter) * strength
        let sx = x
        let sy = y
        if (method === "zoom") {
          const scale = 1 + t * 1.3
          sx = cx + dx * scale
          sy = cy + dy * scale
        } else {
          const arc = t * (diag * 0.5) / Math.max(8, dist)
          const cos = Math.cos(arc)
          const sin = Math.sin(arc)
          sx = cx + dx * cos - dy * sin
          sy = cy + dx * sin + dy * cos
        }
        const sample = bilinearSampleHighBit(source, sx, sy)
        accum[0] += sample[0] * stepWeight
        accum[1] += sample[1] * stepWeight
        accum[2] += sample[2] * stepWeight
        accum[3] += sample[3] * stepWeight
        wSum += stepWeight
      }
      const o = (y * width + x) * 4
      const inv = wSum > 0 ? 1 / wSum : 0
      out[o] = accum[0] * inv
      out[o + 1] = accum[1] * inv
      out[o + 2] = accum[2] * inv
      out[o + 3] = accum[3] * inv
    }
  }
  return floatToSourceStorage(source, out)
}

function boxBlur(source: HighBitImage, radius: number): HighBitImage {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return cloneHighBitImage(source)
  const tmp = new Float32Array(source.data.length)
  const out = new Float32Array(source.data.length)
  const { width, height } = source
  const span = r * 2 + 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      for (let ox = -r; ox <= r; ox++) {
        const sx = Math.max(0, Math.min(width - 1, x + ox))
        const i = (y * width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += readUnit(source, i + c)
      }
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) tmp[o + c] = sums[c] / span
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy))
        const i = (sy * width + x) * 4
        for (let c = 0; c < 4; c++) sums[c] += tmp[i + c]
      }
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = sums[c] / span
    }
  }
  return floatToSourceStorage(source, out)
}

function averageBlur(source: HighBitImage): HighBitImage {
  const sums = [0, 0, 0, 0]
  const pixels = Math.max(1, source.width * source.height)
  for (let i = 0; i < source.data.length; i += 4) {
    sums[0] += readUnit(source, i)
    sums[1] += readUnit(source, i + 1)
    sums[2] += readUnit(source, i + 2)
    sums[3] += readUnit(source, i + 3)
  }
  const out = new Float32Array(source.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = sums[0] / pixels
    out[i + 1] = sums[1] / pixels
    out[i + 2] = sums[2] / pixels
    out[i + 3] = sums[3] / pixels
  }
  return floatToSourceStorage(source, out)
}

function motionBlur(source: HighBitImage, distance: number, angleDeg: number): HighBitImage {
  const steps = Math.max(1, Math.round(distance))
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const out = new Float32Array(source.data.length)
  const { width, height } = source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      let count = 0
      for (let step = -steps; step <= steps; step++) {
        const sx = Math.round(x + dx * step)
        const sy = Math.round(y + dy * step)
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
        const i = (sy * width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += readUnit(source, i + c)
        count++
      }
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = sums[c] / Math.max(1, count)
    }
  }
  return floatToSourceStorage(source, out)
}

function sharpen(source: HighBitImage, amount: number): HighBitImage {
  const a = Math.max(0, amount) / 100
  if (a <= 0) return cloneHighBitImage(source)
  const out = new Float32Array(source.data.length)
  const { width, height } = source
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(height - 1, y + ky - 1))
            value += readUnit(source, (sy * width + sx) * 4 + c) * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = readUnit(source, o + 3)
    }
  }
  return floatToSourceStorage(source, out)
}

function findEdges(source: HighBitImage): HighBitImage {
  const out = new Float32Array(source.data.length)
  const { width, height } = source
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = 0
      let sy = 0
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const px = Math.max(0, Math.min(width - 1, x + kx - 1))
          const py = Math.max(0, Math.min(height - 1, y + ky - 1))
          const i = (py * width + px) * 4
          const lum = 0.299 * readUnit(source, i) + 0.587 * readUnit(source, i + 1) + 0.114 * readUnit(source, i + 2)
          const k = ky * 3 + kx
          sx += lum * gx[k]
          sy += lum * gy[k]
        }
      }
      const edge = clamp(Math.hypot(sx, sy))
      const o = (y * width + x) * 4
      out[o] = edge
      out[o + 1] = edge
      out[o + 2] = edge
      out[o + 3] = readUnit(source, o + 3)
    }
  }
  return floatToSourceStorage(source, out)
}

function emboss(source: HighBitImage, amount: number): HighBitImage {
  const scale = Math.max(0, amount) / 100
  const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2].map((value) => value * scale)
  const out = new Float32Array(source.data.length)
  const { width, height } = source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0.5
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(height - 1, y + ky - 1))
            value += readUnit(source, (sy * width + sx) * 4 + c) * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = readUnit(source, o + 3)
    }
  }
  return floatToSourceStorage(source, out)
}

function highPass(source: HighBitImage, radius: number): HighBitImage {
  const blurred = boxBlur(source, radius)
  const out = new Float32Array(source.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = readUnit(source, i) - readUnit(blurred, i) + 0.5
    out[i + 1] = readUnit(source, i + 1) - readUnit(blurred, i + 1) + 0.5
    out[i + 2] = readUnit(source, i + 2) - readUnit(blurred, i + 2) + 0.5
    out[i + 3] = readUnit(source, i + 3)
  }
  return floatToSourceStorage(source, out)
}

function floatToSourceStorage(source: HighBitImage, floats: Float32Array): HighBitImage {
  const Ctor = source.storage === "uint16" ? Uint16Array : source.storage === "float32" ? Float32Array : Uint8ClampedArray
  const data = new Ctor(floats.length) as HighBitImage["data"]
  const out = cloneHighBitImage(source, data)
  for (let i = 0; i < floats.length; i++) writeUnit(out, i, floats[i])
  return out
}

function rgbToHsl(r: number, g: number, b: number) {
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

function hslToRgb(h: number, s: number, l: number) {
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

function perPixelFilter(source: HighBitImage, transform: (r: number, g: number, b: number, a: number, i: number) => [number, number, number, number]) {
  const Ctor = source.storage === "uint16" ? Uint16Array : source.storage === "float32" ? Float32Array : Uint8ClampedArray
  const data = new Ctor(source.data.length) as HighBitImage["data"]
  const out = cloneHighBitImage(source, data)
  for (let i = 0; i < source.data.length; i += 4) {
    const next = transform(readUnit(source, i), readUnit(source, i + 1), readUnit(source, i + 2), readUnit(source, i + 3), i)
    writeUnit(out, i, next[0])
    writeUnit(out, i + 1, next[1])
    writeUnit(out, i + 2, next[2])
    writeUnit(out, i + 3, next[3])
  }
  return out
}

function equalize(source: HighBitImage): HighBitImage {
  const bins = source.storage === "uint16" ? 65536 : source.storage === "float32" ? 4096 : 256
  const hist = [new Uint32Array(bins), new Uint32Array(bins), new Uint32Array(bins)]
  const binFor = (value: number) => Math.max(0, Math.min(bins - 1, Math.round(clamp(value) * (bins - 1))))
  for (let i = 0; i < source.data.length; i += 4) {
    hist[0][binFor(readUnit(source, i))]++
    hist[1][binFor(readUnit(source, i + 1))]++
    hist[2][binFor(readUnit(source, i + 2))]++
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
  return perPixelFilter(source, (r, g, b, a) => [maps[0][binFor(r)], maps[1][binFor(g)], maps[2][binFor(b)], a])
}

function shadowsHighlights(source: HighBitImage, params: Record<string, number | string | boolean>): HighBitImage {
  const shadows = clamp(numberParam(params, "shadows", 0) / 100)
  const highlights = clamp(numberParam(params, "highlights", 0) / 100)
  const tonalWidth = clamp(numberParam(params, "tonalWidth", 50) / 100, 0.05, 1)
  const colorCorrection = numberParam(params, "colorCorrection", 0) / 100
  return perPixelFilter(source, (r, g, b, a) => {
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
      const hsl = rgbToHsl(nr, ng, nb)
      const rgb = hslToRgb(hsl.h, clamp(hsl.s * (1 + colorCorrection * 0.35)), hsl.l)
      nr = rgb.r
      ng = rgb.g
      nb = rgb.b
    }
    return [nr, ng, nb, a]
  })
}

function parseGradientStops(value: string) {
  const stops = value
    .split(";")
    .map((part) => {
      const [rawPosition, rawColor] = part.split(",")
      const position = clamp(Number(rawPosition))
      const color = parseCssColor(rawColor)
      return Number.isFinite(position) ? { position, color } : null
    })
    .filter((item): item is { position: number; color: { r: number; g: number; b: number } } => !!item)
    .sort((a, b) => a.position - b.position)
  if (!stops.length) {
    stops.push({ position: 0, color: { r: 0, g: 0, b: 0 } }, { position: 1, color: { r: 255, g: 255, b: 255 } })
  }
  if (stops[0].position > 0) stops.unshift({ position: 0, color: stops[0].color })
  if (stops[stops.length - 1].position < 1) stops.push({ position: 1, color: stops[stops.length - 1].color })
  return stops
}

function gradientMap(source: HighBitImage, params: Record<string, number | string | boolean>): HighBitImage {
  const stops = parseGradientStops(String(params.gradient ?? "0,#000000;1,#ffffff"))
  const reverse = boolParam(params, "reverse", false)
  return perPixelFilter(source, (r, g, b, a) => {
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

function ntscColors(source: HighBitImage): HighBitImage {
  return perPixelFilter(source, (r, g, b, a) => {
    const hsl = rgbToHsl(r, g, b)
    const rgb = hslToRgb(hsl.h, Math.min(hsl.s, 0.82), clamp(hsl.l, 0.06, 0.94))
    return [rgb.r, rgb.g, rgb.b, a]
  })
}

function applyHighBitColorFilter(source: HighBitImage, filterId: string, params: Record<string, number | string | boolean>) {
  if (filterId === "hue-saturation") {
    const hue = numberParam(params, "hue", 0) / 360
    const saturation = numberParam(params, "saturation", 0) / 100
    const lightness = numberParam(params, "lightness", 0) / 100
    return perPixelFilter(source, (r, g, b, a) => {
      const hsl = rgbToHsl(r, g, b)
      const rgb = hslToRgb(hsl.h + hue, clamp(hsl.s * (1 + saturation)), clamp(hsl.l + lightness))
      return [rgb.r, rgb.g, rgb.b, a]
    })
  }
  if (filterId === "vibrance") {
    const vibrance = numberParam(params, "vibrance", 0) / 100
    const saturation = numberParam(params, "saturation", 0) / 100
    return perPixelFilter(source, (r, g, b, a) => {
      const hsl = rgbToHsl(r, g, b)
      const boost = saturation + vibrance * (1 - hsl.s)
      const rgb = hslToRgb(hsl.h, clamp(hsl.s * (1 + boost)), hsl.l)
      return [rgb.r, rgb.g, rgb.b, a]
    })
  }
  if (filterId === "photo-filter") {
    const color = parseCssColor(String(params.color ?? "#ffb74d"))
    const density = numberParam(params, "density", 25) / 100
    return perPixelFilter(source, (r, g, b, a) => [
      r * (1 - density) + (color.r / 255) * density,
      g * (1 - density) + (color.g / 255) * density,
      b * (1 - density) + (color.b / 255) * density,
      a,
    ])
  }
  if (filterId === "black-white") {
    return perPixelFilter(source, (r, g, b, a) => {
      const gray = clamp(r * 0.299 + g * 0.587 + b * 0.114)
      return [gray, gray, gray, a]
    })
  }
  if (filterId === "sepia") {
    return perPixelFilter(source, (r, g, b, a) => [
      r * 0.393 + g * 0.769 + b * 0.189,
      r * 0.349 + g * 0.686 + b * 0.168,
      r * 0.272 + g * 0.534 + b * 0.131,
      a,
    ])
  }
  if (filterId === "solarize") {
    return perPixelFilter(source, (r, g, b, a) => [
      r > 0.5 ? 1 - r : r,
      g > 0.5 ? 1 - g : g,
      b > 0.5 ? 1 - b : b,
      a,
    ])
  }
  if (filterId === "color-balance") {
    const cyanRed = numberParam(params, "cyanRed", numberParam(params, "red", 0)) / 255
    const magentaGreen = numberParam(params, "magentaGreen", numberParam(params, "green", 0)) / 255
    const yellowBlue = numberParam(params, "yellowBlue", numberParam(params, "blue", 0)) / 255
    return perPixelFilter(source, (r, g, b, a) => [r + cyanRed, g + magentaGreen, b + yellowBlue, a])
  }
  return null
}

export function applyHighBitFilter(
  source: HighBitImage,
  filterId: string,
  params: Record<string, number | string | boolean> = {},
  context: FilterContext = {},
): HighBitImage {
  if (DIRECT_ADJUSTMENTS.has(filterId as HighBitAdjustment["type"])) {
    return applyHighBitAdjustment(source, { type: filterId as HighBitAdjustment["type"], params })
  }
  if (filterId === "average" || filterId === "average-blur") return averageBlur(source)
  if (filterId === "motion-blur") {
    return motionBlur(source, numberParam(params, "distance", 10), numberParam(params, "angle", 0))
  }
  if (filterId === "gaussian-blur") {
    return gaussianBlurHighBit(source, numberParam(params, "radius", 4))
  }
  if (filterId === "radial-blur") {
    return radialBlurHighBit(
      source,
      numberParam(params, "amount", 25),
      String(params.method ?? "spin"),
      String(params.quality ?? "good"),
      numberParam(params, "centerX", 50),
      numberParam(params, "centerY", 50),
    )
  }
  if (BLUR_FILTERS.has(filterId)) {
    const radius = filterId === "blur" ? 1 : filterId === "blur-more" ? 2 : numberParam(params, "radius", numberParam(params, "blur", 2))
    return boxBlur(source, radius)
  }
  if (filterId === "unsharp-mask") {
    return unsharpMaskHighBit(source, numberParam(params, "amount", 100), numberParam(params, "radius", 1))
  }
  if (filterId === "smart-sharpen") {
    return smartSharpenHighBit(
      source,
      numberParam(params, "amount", 100),
      numberParam(params, "radius", 1),
      numberParam(params, "threshold", 0),
      numberParam(params, "shadowAmount", 0),
      numberParam(params, "highlightAmount", 0),
      String(params.remove ?? "gaussian"),
    )
  }
  if (SHARPEN_FILTERS.has(filterId)) {
    return sharpen(source, filterId === "sharpen-more" ? 90 : numberParam(params, "amount", 50))
  }
  if (filterId === "find-edges") return findEdges(source)
  if (filterId === "emboss") return emboss(source, numberParam(params, "amount", 50))
  if (filterId === "equalize") return equalize(source)
  if (filterId === "shadows-highlights") return shadowsHighlights(source, params)
  if (filterId === "gradient-map") return gradientMap(source, params)
  if (filterId === "ntsc-colors") return ntscColors(source)
  if (filterId === "high-pass") return highPass(source, numberParam(params, "radius", 2))
  if (filterId === "offset") {
    const dx = Math.round(numberParam(params, "horizontal", numberParam(params, "x", 0)))
    const dy = Math.round(numberParam(params, "vertical", numberParam(params, "y", 0)))
    const wrap = String(params.edgeMode ?? "wrap") !== "transparent"
    return offsetImage(source, dx, dy, wrap)
  }
  if (filterId === "maximum" || filterId === "minimum") {
    return morphology(source, Math.max(1, Math.round(numberParam(params, "radius", 1))), filterId === "maximum")
  }
  if (filterId === "pixelate" || filterId === "mosaic") {
    return pixelate(source, Math.max(1, Math.round(numberParam(params, "cellSize", numberParam(params, "size", 8)))))
  }
  if (filterId === "noise" || filterId === "add-noise") {
    const amount = numberParam(params, "amount", 10) / 100
    const monochrome = boolParam(params, "monochrome", false)
    return perPixelFilter(source, (r, g, b, a, i) => {
      const n = pseudoRandom(i) * 2 - 1
      const nr = monochrome ? n : pseudoRandom(i + 17) * 2 - 1
      const ng = monochrome ? n : pseudoRandom(i + 31) * 2 - 1
      const nb = monochrome ? n : pseudoRandom(i + 47) * 2 - 1
      return [r + nr * amount, g + ng * amount, b + nb * amount, a]
    })
  }
  const colorFiltered = applyHighBitColorFilter(source, filterId, params)
  if (colorFiltered) return colorFiltered

  const filter = getFilter(filterId)
  if (!filter) return cloneHighBitImage(source, undefined, [...source.warnings, `Unknown high-bit filter "${filterId}" skipped.`])
  const preview = toneMapHighBitImageToImageData(source)
  const result = filter.apply(preview, params, context)
  const fallback = createHighBitImageFromImageData(result, {
    bitDepth: source.bitDepth,
    colorMode: source.colorMode,
    profile: source.profile,
  })
  fallback.warnings = [...source.warnings, `Filter "${filterId}" used an 8-bit fallback because no direct high-bit implementation is registered.`]
  return fallback
}

function pseudoRandom(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function offsetImage(source: HighBitImage, dx: number, dy: number, wrap: boolean) {
  const out = emptyHighBitImage(source.width, source.height, source.bitDepth, source.colorMode, source.profile)
  const { width, height } = source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = x - dx
      let sy = y - dy
      if (wrap) {
        sx = ((sx % width) + width) % width
        sy = ((sy % height) + height) % height
      }
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
      const src = (sy * width + sx) * 4
      const dst = (y * width + x) * 4
      for (let c = 0; c < 4; c++) writeUnit(out, dst + c, readUnit(source, src + c))
    }
  }
  return out
}

function morphology(source: HighBitImage, radius: number, maximum: boolean) {
  const out = emptyHighBitImage(source.width, source.height, source.bitDepth, source.colorMode, source.profile)
  const { width, height } = source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let value = maximum ? 0 : 1
        for (let oy = -radius; oy <= radius; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const sx = Math.max(0, Math.min(width - 1, x + ox))
            const sy = Math.max(0, Math.min(height - 1, y + oy))
            const sample = readUnit(source, (sy * width + sx) * 4 + c)
            value = maximum ? Math.max(value, sample) : Math.min(value, sample)
          }
        }
        writeUnit(out, dst + c, value)
      }
    }
  }
  return out
}

function pixelate(source: HighBitImage, size: number) {
  const out = emptyHighBitImage(source.width, source.height, source.bitDepth, source.colorMode, source.profile)
  const { width, height } = source
  for (let by = 0; by < height; by += size) {
    for (let bx = 0; bx < width; bx += size) {
      const sums = [0, 0, 0, 0]
      let count = 0
      for (let y = by; y < Math.min(height, by + size); y++) {
        for (let x = bx; x < Math.min(width, bx + size); x++) {
          const i = (y * width + x) * 4
          for (let c = 0; c < 4; c++) sums[c] += readUnit(source, i + c)
          count++
        }
      }
      for (let y = by; y < Math.min(height, by + size); y++) {
        for (let x = bx; x < Math.min(width, bx + size); x++) {
          const i = (y * width + x) * 4
          for (let c = 0; c < 4; c++) writeUnit(out, i + c, sums[c] / Math.max(1, count))
        }
      }
    }
  }
  return out
}

export function syncLayerCanvasFromHighBit(layer: Layer, options: HighBitToneMapOptions = {}) {
  const image = (layer as HighBitLayer).__highBitImageData
  if (!image || !layer.canvas || typeof layer.canvas.getContext !== "function") return false
  layer.canvas.width = image.width
  layer.canvas.height = image.height
  layer.canvas.getContext("2d")!.putImageData(toneMapHighBitImageToImageData(image, options), 0, 0)
  return true
}

export function applyHighBitFilterToLayer(
  layer: Layer,
  doc: PsDocument,
  filterId: string,
  params: Record<string, number | string | boolean> = {},
  context: FilterContext = {},
) {
  const source = ensureLayerHighBitImage(layer, doc)
  if (!source) return false
  ;(layer as HighBitLayer).__highBitImageData = applyHighBitFilter(source, filterId, params, context)
  syncLayerCanvasFromHighBit(layer)
  return true
}

export function previewHighBitFilterForLayer(
  layer: Layer,
  doc: PsDocument,
  filterId: string,
  params: Record<string, number | string | boolean> = {},
  context: FilterContext = {},
) {
  const source = getLayerHighBitImage(layer, doc)
  if (!source) return null
  return toneMapHighBitImageToImageData(applyHighBitFilter(source, filterId, params, context))
}

export function syncHighBitLayerFromCanvasDelta(
  source: HighBitImage,
  before: ImageData,
  after: ImageData,
  dirty?: { x: number; y: number; w: number; h: number },
) {
  const out = cloneHighBitImage(source)
  const x0 = Math.max(0, Math.floor(dirty?.x ?? 0))
  const y0 = Math.max(0, Math.floor(dirty?.y ?? 0))
  const x1 = Math.min(source.width, Math.ceil((dirty?.x ?? 0) + (dirty?.w ?? source.width)))
  const y1 = Math.min(source.height, Math.ceil((dirty?.y ?? 0) + (dirty?.h ?? source.height)))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * source.width + x) * 4
      if (
        before.data[i] === after.data[i] &&
        before.data[i + 1] === after.data[i + 1] &&
        before.data[i + 2] === after.data[i + 2] &&
        before.data[i + 3] === after.data[i + 3]
      ) {
        continue
      }
      writeUnit(out, i, after.data[i] / 255)
      writeUnit(out, i + 1, after.data[i + 1] / 255)
      writeUnit(out, i + 2, after.data[i + 2] / 255)
      writeUnit(out, i + 3, after.data[i + 3] / 255)
    }
  }
  return out
}

export function syncHighBitLayerFromCanvasChange(
  layer: Layer,
  doc: PsDocument,
  beforeCanvas: HTMLCanvasElement | null | undefined,
  afterCanvas: HTMLCanvasElement | null | undefined,
  dirty?: { x: number; y: number; w: number; h: number },
) {
  const source = ensureLayerHighBitImage(layer, doc)
  if (!source || !beforeCanvas || !afterCanvas) return false
  const before = beforeCanvas.getContext("2d")!.getImageData(0, 0, beforeCanvas.width, beforeCanvas.height)
  const after = afterCanvas.getContext("2d")!.getImageData(0, 0, afterCanvas.width, afterCanvas.height)
  ;(layer as HighBitLayer).__highBitImageData = syncHighBitLayerFromCanvasDelta(source, before, after, dirty)
  return true
}

export function applyHighBitPaintDab(source: HighBitImage, options: HighBitPaintDabOptions): HighBitImage {
  const out = cloneHighBitImage(source)
  const radius = Math.max(0.01, options.radius)
  const opacity = clamp(options.opacity ?? 1)
  const hardness = clamp(options.hardness ?? 1)
  const color = {
    r: clamp(options.color.r / 255),
    g: clamp(options.color.g / 255),
    b: clamp(options.color.b / 255),
    a: clamp((options.color.a ?? 255) / 255),
  }
  const dirty = options.dirtyRect
  const x0 = Math.max(0, Math.floor(options.x - radius), dirty ? Math.floor(dirty.x) : 0)
  const y0 = Math.max(0, Math.floor(options.y - radius), dirty ? Math.floor(dirty.y) : 0)
  const x1 = Math.min(
    source.width - 1,
    Math.ceil(options.x + radius),
    dirty ? Math.ceil(dirty.x + dirty.w) - 1 : source.width - 1,
  )
  const y1 = Math.min(
    source.height - 1,
    Math.ceil(options.y + radius),
    dirty ? Math.ceil(dirty.y + dirty.h) - 1 : source.height - 1,
  )
  const sampleColor = options.sampleColor
    ? { ...options.sampleColor, a: options.sampleColor.a ?? 255 }
    : { r: options.color.r, g: options.color.g, b: options.color.b, a: options.color.a ?? 255 }
  const replacementColor = { r: options.color.r, g: options.color.g, b: options.color.b, a: options.color.a ?? 255 }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distance = Math.hypot(x - options.x, y - options.y)
      if (distance > radius) continue
      const feather = hardness >= 1 || distance <= radius * hardness
        ? 1
        : 1 - (distance - radius * hardness) / Math.max(0.0001, radius * (1 - hardness))
      const amount = clamp(opacity * feather)
      const i = (y * source.width + x) * 4
      if (options.mode === "destination-out") {
        writeUnit(out, i + 3, readUnit(out, i + 3) * (1 - amount))
        continue
      }
      if (options.mode === "color-replace") {
        const current: Required<BrushRgba> = {
          r: clamp8(readUnit(out, i) * 255),
          g: clamp8(readUnit(out, i + 1) * 255),
          b: clamp8(readUnit(out, i + 2) * 255),
          a: clamp(readUnit(out, i + 3)),
        }
        const replaced = resolveColorReplacementPixel({
          source: current,
          sample: { r: sampleColor.r, g: sampleColor.g, b: sampleColor.b, a: (sampleColor.a ?? 255) / 255 },
          replacement: { r: replacementColor.r, g: replacementColor.g, b: replacementColor.b, a: (replacementColor.a ?? 255) / 255 },
          tolerance: options.tolerance ?? 32,
          mode: options.replacementMode ?? "color",
          opacity: amount,
        })
        if (replaced.changed) {
          writeUnit(out, i, replaced.pixel.r / 255)
          writeUnit(out, i + 1, replaced.pixel.g / 255)
          writeUnit(out, i + 2, replaced.pixel.b / 255)
        }
        continue
      }
      const srcAlpha = color.a * amount
      const dstAlpha = readUnit(out, i + 3)
      const nextAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
      if (nextAlpha <= 0) {
        for (let c = 0; c < 4; c++) writeUnit(out, i + c, 0)
        continue
      }
      writeUnit(out, i, (color.r * srcAlpha + readUnit(out, i) * dstAlpha * (1 - srcAlpha)) / nextAlpha)
      writeUnit(out, i + 1, (color.g * srcAlpha + readUnit(out, i + 1) * dstAlpha * (1 - srcAlpha)) / nextAlpha)
      writeUnit(out, i + 2, (color.b * srcAlpha + readUnit(out, i + 2) * dstAlpha * (1 - srcAlpha)) / nextAlpha)
      writeUnit(out, i + 3, nextAlpha)
    }
  }
  return out
}

function cloneSurfaceLayer(layer: HighBitEditingSurfaceLayer): HighBitEditingSurfaceLayer {
  return {
    ...layer,
    visible: layer.visible !== false,
    opacity: clamp(layer.opacity ?? 1),
    fillOpacity: clamp(layer.fillOpacity ?? 1),
    blendMode: layer.blendMode ?? "normal",
    image: cloneHighBitImage(layer.image),
  }
}

export function createHighBitEditingSurface(input: CreateHighBitEditingSurfaceInput): HighBitEditingSurface {
  return {
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    bitDepth: input.bitDepth,
    colorMode: input.colorMode,
    profile: input.profile,
    background: input.background,
    layers: (input.layers ?? []).map(cloneSurfaceLayer),
    warnings: [
      "High-bit editing surface stores source samples in typed arrays; display is a derived tone-mapped preview.",
    ],
  }
}

function updateSurfaceLayer(
  surface: HighBitEditingSurface,
  layerId: string,
  update: (layer: HighBitEditingSurfaceLayer) => HighBitEditingSurfaceLayer,
): HighBitEditingSurface {
  return {
    ...surface,
    layers: surface.layers.map((layer) => layer.id === layerId ? update(cloneSurfaceLayer(layer)) : cloneSurfaceLayer(layer)),
    warnings: [...surface.warnings],
  }
}

export function paintHighBitEditingSurface(
  surface: HighBitEditingSurface,
  layerId: string,
  options: HighBitPaintDabOptions,
): HighBitEditingSurface {
  return updateSurfaceLayer(surface, layerId, (layer) => ({
    ...layer,
    image: applyHighBitPaintDab(layer.image, options),
  }))
}

export function applyHighBitSurfaceAdjustment(
  surface: HighBitEditingSurface,
  layerId: string,
  adjustment: HighBitAdjustment,
): HighBitEditingSurface {
  return updateSurfaceLayer(surface, layerId, (layer) => ({
    ...layer,
    image: applyHighBitAdjustment(layer.image, adjustment),
  }))
}

function surfaceBackgroundImage(surface: HighBitEditingSurface, transparent: boolean, matte?: string) {
  const image = emptyHighBitImage(surface.width, surface.height, surface.bitDepth, surface.colorMode, surface.profile)
  if (transparent) return image
  const color = parseCssColor(matte ?? surface.background ?? "#ffffff")
  for (let i = 0; i < image.data.length; i += 4) {
    writeUnit(image, i, color.r / 255)
    writeUnit(image, i + 1, color.g / 255)
    writeUnit(image, i + 2, color.b / 255)
    writeUnit(image, i + 3, 1)
  }
  return image
}

export function compositeHighBitEditingSurface(
  surface: HighBitEditingSurface,
  options: { transparent?: boolean; matte?: string; toneMap?: HighBitToneMapOptions } = {},
): { image: HighBitImage; toneMapped: ImageData; usedHighBit: true; warnings: string[] } {
  let current = surfaceBackgroundImage(surface, options.transparent ?? false, options.matte)
  const warnings = [...surface.warnings]
  for (const layer of surface.layers) {
    if (layer.visible === false || layer.opacity === 0) continue
    if (layer.image.width !== surface.width || layer.image.height !== surface.height) {
      warnings.push(`Layer "${layer.id}" skipped because its high-bit surface dimensions do not match the document.`)
      continue
    }
    current = compositeHighBit(current, layer.image, {
      opacity: layer.opacity ?? 1,
      fillOpacity: layer.fillOpacity ?? 1,
      blendMode: layer.blendMode ?? "normal",
      mask: layer.mask,
      clipMask: layer.clipMask,
    })
  }
  current.warnings = [...current.warnings, ...warnings]
  return {
    image: current,
    toneMapped: toneMapHighBitImageToImageData(current, options.toneMap),
    usedHighBit: true,
    warnings,
  }
}

function maskAmount(mask: HTMLCanvasElement | null | undefined, x: number, y: number, width: number, height: number) {
  if (!mask || typeof mask.getContext !== "function") return 1
  const mx = Math.max(0, Math.min(mask.width - 1, Math.floor((x / width) * mask.width)))
  const my = Math.max(0, Math.min(mask.height - 1, Math.floor((y / height) * mask.height)))
  const px = mask.getContext("2d")!.getImageData(mx, my, 1, 1).data
  return ((px[0] + px[1] + px[2]) / 765) * (px[3] / 255)
}

function blendChannel(src: number, dst: number, mode: BlendMode) {
  switch (mode) {
    case "multiply": return src * dst
    case "screen": return 1 - (1 - src) * (1 - dst)
    case "overlay": return dst < 0.5 ? 2 * src * dst : 1 - 2 * (1 - src) * (1 - dst)
    case "darken": return Math.min(src, dst)
    case "lighten": return Math.max(src, dst)
    case "difference": return Math.abs(dst - src)
    default: return src
  }
}

function compositeHighBit(base: HighBitImage, layer: HighBitImage, options: {
  opacity?: number
  fillOpacity?: number
  blendMode?: BlendMode
  mask?: HTMLCanvasElement | null
  clipMask?: HTMLCanvasElement | null
}) {
  const out = cloneHighBitImage(base)
  const opacity = clamp(options.opacity ?? 1) * clamp(options.fillOpacity ?? 1)
  const mode = options.blendMode ?? "normal"
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const i = (y * base.width + x) * 4
      const coverage = opacity * maskAmount(options.mask, x, y, base.width, base.height) * maskAmount(options.clipMask, x, y, base.width, base.height)
      if (coverage <= 0) continue
      const srcAlpha = readUnit(layer, i + 3) * coverage
      const dstAlpha = readUnit(base, i + 3)
      const nextAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
      if (nextAlpha <= 0) {
        for (let c = 0; c < 4; c++) writeUnit(out, i + c, 0)
        continue
      }
      for (let c = 0; c < 3; c++) {
        const src = readUnit(layer, i + c)
        const dst = readUnit(base, i + c)
        const blended = blendChannel(src, dst, mode)
        writeUnit(out, i + c, (blended * srcAlpha + dst * dstAlpha * (1 - srcAlpha)) / nextAlpha)
      }
      writeUnit(out, i + 3, nextAlpha)
    }
  }
  return out
}

function mixAdjusted(base: HighBitImage, adjusted: HighBitImage, layer: Layer, clipMask?: HTMLCanvasElement | null) {
  const out = cloneHighBitImage(base)
  const opacity = clamp(layer.opacity)
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const i = (y * base.width + x) * 4
      const amount = opacity *
        (layer.maskEnabled === false ? 1 : maskAmount(layer.mask, x, y, base.width, base.height)) *
        maskAmount(clipMask, x, y, base.width, base.height)
      if (amount <= 0) continue
      for (let c = 0; c < 4; c++) {
        writeUnit(out, i + c, readUnit(base, i + c) * (1 - amount) + readUnit(adjusted, i + c) * amount)
      }
    }
  }
  return out
}

export function renderDocumentHighBitComposite(
  doc: PsDocument,
  options: { transparent?: boolean; matte?: string; toneMap?: HighBitToneMapOptions } = {},
): { image: HighBitImage; toneMapped: ImageData; usedHighBit: boolean } | null {
  if (doc.bitDepth <= 8 && !(doc as HighBitDocument).__highBitImageData) return null
  let current = options.transparent
    ? emptyHighBitImage(doc.width, doc.height, doc.bitDepth, doc.colorMode, doc.colorManagement?.assignedProfile)
    : highBitFromCssColor(doc.width, doc.height, doc, options.matte ?? doc.background ?? "#ffffff", doc.background === "transparent")
  let usedHighBit = false

  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group") continue
    let clipMask: HTMLCanvasElement | null = null
    if (layer.clipped) {
      const idx = doc.layers.indexOf(layer)
      for (let j = idx - 1; j >= 0; j--) {
        if (!doc.layers[j].clipped) {
          clipMask = doc.layers[j].canvas
          break
        }
      }
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      if (layer.opacity <= 0) continue
      const adjusted = applyHighBitFilter(current, layer.adjustment.type, layer.adjustment.params)
      current = mixAdjusted(current, adjusted, layer, clipMask)
      usedHighBit = true
      continue
    }
    if (!layer.canvas || typeof layer.canvas.getContext !== "function") continue
    const source = getLayerHighBitImage(layer, doc) ?? createHighBitImageFromImageData(canvasImageData(layer.canvas), {
      bitDepth: doc.bitDepth,
      colorMode: doc.colorMode,
      profile: doc.colorManagement?.assignedProfile,
    })
    usedHighBit = usedHighBit || !!getLayerHighBitImage(layer, doc)
    const filtered = applySmartFiltersToHighBit(source, layer.smartFilters)
    current = compositeHighBit(current, filtered, {
      opacity: layer.opacity,
      fillOpacity: layer.style ? 1 : layer.fillOpacity ?? 1,
      blendMode: layer.blendMode,
      mask: layer.maskEnabled === false ? null : layer.mask,
      clipMask,
    })
  }

  return {
    image: current,
    toneMapped: toneMapHighBitImageToImageData(current, options.toneMap),
    usedHighBit,
  }
}

function applySmartFiltersToHighBit(source: HighBitImage, smartFilters: Layer["smartFilters"]) {
  let current = source
  for (const smartFilter of smartFilters?.filter((filter) => filter.enabled) ?? []) {
    const before = current
    const after = applyHighBitFilter(before, smartFilter.filterId, smartFilter.params)
    if ((smartFilter.opacity ?? 1) >= 1 && (smartFilter.blendMode ?? "normal") === "normal" && !smartFilter.mask) {
      current = after
    } else {
      current = compositeHighBit(before, after, {
        opacity: smartFilter.opacity ?? 1,
        blendMode: smartFilter.blendMode ?? "normal",
        mask: smartFilter.maskEnabled === false ? null : smartFilter.mask,
      })
    }
  }
  return current
}

export function renderDocumentHighBitPreviewCanvas(doc: PsDocument, options: { transparent?: boolean; matte?: string; toneMap?: HighBitToneMapOptions } = {}) {
  const rendered = renderDocumentHighBitComposite(doc, options)
  if (!rendered) return null
  const canvas = document.createElement("canvas")
  canvas.width = rendered.toneMapped.width
  canvas.height = rendered.toneMapped.height
  canvas.getContext("2d")!.putImageData(rendered.toneMapped, 0, 0)
  return { canvas, ...rendered }
}

export function getHighBitExportImage(doc: PsDocument, options: { transparent?: boolean; matte?: string } = {}) {
  return renderDocumentHighBitComposite(doc, options)?.image ?? null
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function highBitBytes(image: HighBitImage) {
  return new Uint8Array(image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength))
}

export function serializeHighBitImagePayload(image: HighBitImage | null | undefined): HighBitImagePayload | undefined {
  if (!image) return undefined
  return {
    width: image.width,
    height: image.height,
    channels: 4,
    bitDepth: image.bitDepth,
    colorMode: image.colorMode,
    profile: image.profile,
    storage: image.storage,
    encoding: "base64",
    data: bytesToBase64(highBitBytes(image)),
    warnings: image.warnings,
  }
}

export function deserializeHighBitImagePayload(payload: unknown): HighBitImage | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const item = payload as Record<string, unknown>
  const width = Math.max(1, Math.round(Number(item.width) || 1))
  const height = Math.max(1, Math.round(Number(item.height) || 1))
  const bitDepth: PipelineBitDepth = item.bitDepth === 16 ? 16 : item.bitDepth === 32 ? 32 : 8
  const storage: HighBitImage["storage"] = item.storage === "uint16" ? "uint16" : item.storage === "float32" ? "float32" : "uint8"
  if (item.encoding !== "base64" || typeof item.data !== "string") return undefined
  const bytes = base64ToBytes(item.data)
  const bytesPerSample = storage === "float32" ? 4 : storage === "uint16" ? 2 : 1
  const expectedBytes = width * height * 4 * bytesPerSample
  if (bytes.byteLength < expectedBytes) return undefined
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const data = storage === "uint16"
    ? new Uint16Array(buffer)
    : storage === "float32"
      ? new Float32Array(buffer)
      : new Uint8ClampedArray(buffer)
  return {
    width,
    height,
    channels: 4,
    bitDepth,
    colorMode: typeof item.colorMode === "string" ? item.colorMode as PipelineColorMode : "RGB",
    profile: typeof item.profile === "string" ? item.profile : undefined,
    storage,
    data: data.slice(0, width * height * 4) as HighBitImage["data"],
    warnings: Array.isArray(item.warnings) ? item.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 16) : [],
  }
}

export function highBitImageFromSideBand(layer: Layer, doc: PsDocument) {
  const sideBand = (layer as HighBitLayer).__highBitDepthData
  if (!sideBand) return null
  return imageDataFromHighBitChannels(sideBand, layer.canvas.width || doc.width, layer.canvas.height || doc.height, doc)
}
