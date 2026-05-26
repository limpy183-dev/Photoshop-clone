export {
  applyIccTransformToImageData,
  buildGamutWarningMaskImageData,
  checkRgbOutOfGamut,
  convertImageDataForExport,
  describeIccProfile,
  iccProfileDeviceKind,
  normalizeIccProfileName,
  parseIccProfile,
  softProofImageData,
  softProofRgbColor,
  supportedIccProfileNames,
  transformRgbColor,
  type GamutWarningResult,
  type IccProfileName,
  type ParsedIccProfile,
  type IccTransformOptions,
  type IccTransformResult,
} from "./icc-transform"

export type PipelineColorMode = "RGB" | "CMYK" | "Lab" | "Grayscale" | "Bitmap" | "Duotone" | "Indexed" | "Multichannel"
export type PipelineBitDepth = 8 | 16 | 32

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface CmykColor {
  c: number
  m: number
  y: number
  k: number
}

export interface LabColor {
  l: number
  a: number
  b: number
}

export interface GrayscaleColor {
  gray: number
}

export interface CmykConversionOptions {
  blackGeneration?: "none" | "light" | "medium" | "heavy"
  totalInkLimit?: number
}

export interface HighBitImage {
  width: number
  height: number
  channels: 4
  bitDepth: PipelineBitDepth
  colorMode: PipelineColorMode
  profile?: string
  storage: "uint8" | "uint16" | "float32"
  data: Uint8ClampedArray | Uint16Array | Float32Array
  warnings: string[]
}

export interface HighBitImageOptions {
  bitDepth?: PipelineBitDepth
  colorMode?: PipelineColorMode
  profile?: string
}

export interface ColorPipelineDescription {
  storage: HighBitImage["storage"]
  supportsHighBitMath: boolean
  supportsIccTransforms: boolean
  colorMode: PipelineColorMode
  bitDepth: PipelineBitDepth
  warnings: string[]
}

export type ColorHonestySeverity = "info" | "warn" | "fail"

export interface DocumentColorHonestyItem {
  label: string
  severity: ColorHonestySeverity
  detail: string
}

export interface DocumentColorHonestyReport {
  badge: string
  items: DocumentColorHonestyItem[]
  warnings: string[]
  hasWarnings: boolean
  usesBrowser8BitCanvas: boolean
}

export interface DocumentColorHonestyInput {
  colorMode?: string
  bitDepth?: number
  channels?: unknown[]
  modeSettings?: {
    mode?: string
    multichannel?: unknown
    duotone?: unknown
    indexed?: unknown
    bitmap?: unknown
  }
  colorManagement?: {
    assignedProfile?: string
    workingSpace?: string
    proofProfile?: string
    proofColors?: boolean
    gamutWarning?: boolean
    preserveNumbers?: boolean
  }
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export type RgbConvertibleMode = "RGB" | "CMYK" | "Lab" | "Grayscale"
export type RgbConvertedColor = RgbColor | CmykColor | LabColor | GrayscaleColor

export interface HighBitAdjustment {
  type:
    | "brightness-contrast"
    | "levels"
    | "curves"
    | "exposure"
    | "invert"
    | "channel-mixer"
    | "grayscale"
    | "desaturate"
    | "posterize"
    | "threshold"
  params?: Record<string, number | string | boolean>
}

export interface HighBitToneMapOptions {
  exposure?: number
  gamma?: number
}

export interface HistogramChannels {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminosity: Uint32Array
}

export interface HistogramStats {
  mean: number
  std: number
  median: number
  pixels: number
  minValue: number
  maxValue: number
}

export interface HistogramResult {
  bins: number
  bitDepth: PipelineBitDepth
  source: "canvas" | "uint8" | "uint16" | "float32"
  channels: HistogramChannels
  stats: HistogramStats
}

export interface HighBitHistogramOptions {
  floatBins?: number
  floatMin?: number
  floatMax?: number
}

export interface HighBitPixelReadout {
  r: number
  g: number
  b: number
  a: number
  normalized: {
    r: number
    g: number
    b: number
    a: number
  }
}

export interface HighBitPreviewComparison {
  source: HighBitPixelReadout
  preview: {
    r: number
    g: number
    b: number
    a: number
  }
  previewEquivalent: {
    r: number
    g: number
    b: number
    a: number
  }
  delta: {
    r: number
    g: number
    b: number
    a: number
  }
}

export interface FloatPixelBuffer {
  width: number
  height: number
  channels: 4
  bitDepth: 32
  colorMode: PipelineColorMode
  profile?: string
  storage: "float32"
  data: Float32Array
  warnings: string[]
}

export type FloatFilterKind = "brightness-contrast" | "levels" | "curves" | "exposure" | "box-blur" | "sharpen"

function srgbToLinear(value: number) {
  const v = clamp(value / 255)
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number) {
  const v = clamp(value)
  return clamp8((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255)
}

function labPivot(value: number) {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116
}

function labPivotInverse(value: number) {
  const cubed = value ** 3
  return cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787
}

export function rgbToGrayscale(rgb: RgbColor): GrayscaleColor {
  return { gray: clamp8(0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) }
}

export function grayscaleToRgb(gray: GrayscaleColor | number): RgbColor {
  const value = clamp8(typeof gray === "number" ? gray : gray.gray)
  return { r: value, g: value, b: value }
}

export function convertRgbToColorMode(
  rgb: RgbColor,
  mode: RgbConvertibleMode,
  options: CmykConversionOptions = {},
): RgbConvertedColor {
  if (mode === "CMYK") return rgbToCmyk(rgb, options)
  if (mode === "Lab") return rgbToLab(rgb)
  if (mode === "Grayscale") return rgbToGrayscale(rgb)
  return { r: clamp8(rgb.r), g: clamp8(rgb.g), b: clamp8(rgb.b) }
}

export function convertColorToRgb(color: RgbConvertedColor, mode: RgbConvertibleMode): RgbColor {
  if (mode === "CMYK") return cmykToRgb(color as CmykColor)
  if (mode === "Lab") return labToRgb(color as LabColor)
  if (mode === "Grayscale") return grayscaleToRgb(color as GrayscaleColor)
  const rgb = color as RgbColor
  return { r: clamp8(rgb.r), g: clamp8(rgb.g), b: clamp8(rgb.b) }
}

export function createHighBitImageFromImageData(source: ImageData, options: HighBitImageOptions = {}): HighBitImage {
  const bitDepth = options.bitDepth ?? 8
  const colorMode = options.colorMode ?? "RGB"
  const warnings = [
    "High-bit data is stored in a local typed-array pipeline; browser canvas display remains 8-bit RGBA.",
  ]

  if (bitDepth === 16) {
    const data = new Uint16Array(source.data.length)
    for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] * 257
    return {
      width: source.width,
      height: source.height,
      channels: 4,
      bitDepth,
      colorMode,
      profile: options.profile,
      storage: "uint16",
      data,
      warnings,
    }
  }

  if (bitDepth === 32) {
    const data = new Float32Array(source.data.length)
    for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] / 255
    return {
      width: source.width,
      height: source.height,
      channels: 4,
      bitDepth,
      colorMode,
      profile: options.profile,
      storage: "float32",
      data,
      warnings,
    }
  }

  return {
    width: source.width,
    height: source.height,
    channels: 4,
    bitDepth,
    colorMode,
    profile: options.profile,
    storage: "uint8",
    data: new Uint8ClampedArray(source.data),
    warnings,
  }
}

export function toneMapHighBitImageToImageData(source: HighBitImage, options: HighBitToneMapOptions = {}): ImageData {
  const out = new Uint8ClampedArray(source.width * source.height * 4)
  const exposureFactor = 2 ** (Number.isFinite(options.exposure) ? options.exposure ?? 0 : 0)
  const gamma = Math.max(0.01, Number.isFinite(options.gamma) ? options.gamma ?? 1 : 1)
  const mapRgb = (value: number) => clamp8(Math.pow(clamp(value * exposureFactor), 1 / gamma) * 255)
  if (source.storage === "uint16") {
    const data = source.data as Uint16Array
    for (let i = 0; i < out.length; i += 4) {
      out[i] = mapRgb(data[i] / 65535)
      out[i + 1] = mapRgb(data[i + 1] / 65535)
      out[i + 2] = mapRgb(data[i + 2] / 65535)
      out[i + 3] = clamp8((data[i + 3] / 65535) * 255)
    }
  } else if (source.storage === "float32") {
    const data = source.data as Float32Array
    for (let i = 0; i < out.length; i += 4) {
      out[i] = mapRgb(data[i])
      out[i + 1] = mapRgb(data[i + 1])
      out[i + 2] = mapRgb(data[i + 2])
      out[i + 3] = clamp8(clamp(data[i + 3]) * 255)
    }
  } else {
    const data = source.data as Uint8ClampedArray
    if ((options.exposure ?? 0) === 0 && (options.gamma ?? 1) === 1) {
      out.set(data)
    } else {
      for (let i = 0; i < out.length; i += 4) {
        out[i] = mapRgb(data[i] / 255)
        out[i + 1] = mapRgb(data[i + 1] / 255)
        out[i + 2] = mapRgb(data[i + 2] / 255)
        out[i + 3] = data[i + 3]
      }
    }
  }
  return new ImageData(out, source.width, source.height)
}

function cloneHighBitWithData(source: HighBitImage, data: HighBitImage["data"]): HighBitImage {
  return {
    ...source,
    data,
    warnings: [...source.warnings],
  }
}

function highBitMax(storage: HighBitImage["storage"]) {
  return storage === "uint16" ? 65535 : storage === "uint8" ? 255 : 1
}

function readHighBitUnit(data: HighBitImage["data"], storage: HighBitImage["storage"], index: number) {
  return Number(data[index]) / highBitMax(storage)
}

function writeHighBitUnit(data: HighBitImage["data"], storage: HighBitImage["storage"], index: number, value: number) {
  const v = clamp(value)
  if (storage === "uint16") data[index] = Math.round(v * 65535)
  else if (storage === "uint8") data[index] = clamp8(v * 255)
  else data[index] = v
}

function highBitParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function highBitBool(params: Record<string, number | string | boolean>, key: string, fallback = false) {
  const value = params[key]
  return typeof value === "boolean" ? value : fallback
}

function highBitChannelMixer(
  r: number,
  g: number,
  b: number,
  params: Record<string, number | string | boolean>,
) {
  if (highBitBool(params, "monochrome")) {
    const gray =
      r * (highBitParam(params, "grayR", 40) / 100) +
      g * (highBitParam(params, "grayG", 40) / 100) +
      b * (highBitParam(params, "grayB", 20) / 100) +
      highBitParam(params, "constantGray", 0) / 100
    return { r: gray, g: gray, b: gray }
  }
  return {
    r:
      r * (highBitParam(params, "rR", 100) / 100) +
      g * (highBitParam(params, "rG", 0) / 100) +
      b * (highBitParam(params, "rB", 0) / 100) +
      highBitParam(params, "constantR", 0) / 100,
    g:
      r * (highBitParam(params, "gR", 0) / 100) +
      g * (highBitParam(params, "gG", 100) / 100) +
      b * (highBitParam(params, "gB", 0) / 100) +
      highBitParam(params, "constantG", 0) / 100,
    b:
      r * (highBitParam(params, "bR", 0) / 100) +
      g * (highBitParam(params, "bG", 0) / 100) +
      b * (highBitParam(params, "bB", 100) / 100) +
      highBitParam(params, "constantB", 0) / 100,
  }
}

function highBitCurvePoints(params: Record<string, number | string | boolean>) {
  if (typeof params.points === "string") {
    const points = params.points
      .split(";")
      .map((pair) => {
        const [x, y] = pair.split(",").map((n) => Number(n))
        return Number.isFinite(x) && Number.isFinite(y)
          ? [clamp(x / 255), clamp(y / 255)] as [number, number]
          : null
      })
      .filter((point): point is [number, number] => !!point)
      .sort((a, b) => a[0] - b[0])
    if (!points.some((point) => point[0] === 0)) points.unshift([0, 0])
    if (!points.some((point) => point[0] === 1)) points.push([1, 1])
    if (points.length >= 2) return points
  }

  if ("shadows" in params || "midtones" in params || "highlights" in params) {
    const shadows = highBitParam(params, "shadows", 0)
    const midtones = highBitParam(params, "midtones", 0)
    const highlights = highBitParam(params, "highlights", 0)
    return [
      [0, 0],
      [64 / 255, clamp8(64 + shadows) / 255],
      [128 / 255, clamp8(128 + midtones) / 255],
      [192 / 255, clamp8(192 + highlights) / 255],
      [1, 1],
    ] as [number, number][]
  }

  const shadow = clamp(highBitParam(params, "shadow", 0) / 255)
  const midtone = clamp(highBitParam(params, "midtone", 128) / 255)
  const highlight = clamp(highBitParam(params, "highlight", 255) / 255)
  return [[0, shadow], [128 / 255, midtone], [1, highlight]] as [number, number][]
}

function highBitCurveValue(value: number, points: [number, number][]) {
  const pts = points
    .map(([x, y]) => [clamp(x), clamp(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((point, index, list) => index === 0 || point[0] !== list[index - 1][0])
  const n = pts.length
  if (n < 2) return value
  const d = new Array(Math.max(0, n - 1)).fill(0)
  const m = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / Math.max(0.000001, pts[i + 1][0] - pts[i][0])
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
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
  const x = clamp(value)
  let segment = 0
  while (segment < n - 2 && x > pts[segment + 1][0]) segment++
  const x0 = pts[segment][0]
  const y0 = pts[segment][1]
  const x1 = pts[segment + 1][0]
  const y1 = pts[segment + 1][1]
  const span = Math.max(0.000001, x1 - x0)
  const t = clamp((x - x0) / span)
  const t2 = t * t
  const t3 = t2 * t
  return clamp(
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * span * m[segment] +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * span * m[segment + 1],
  )
}

export function applyHighBitAdjustment(source: HighBitImage, adjustment: HighBitAdjustment): HighBitImage {
  const storage = source.storage
  const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
  const out = new Ctor(source.data.length) as HighBitImage["data"]
  const params = adjustment.params ?? {}
  const curvePoints = adjustment.type === "curves" ? highBitCurvePoints(params) : null
  const curveChannel = String(params.channel ?? "rgb")
  for (let i = 0; i < source.data.length; i += 4) {
    let r = readHighBitUnit(source.data, storage, i)
    let g = readHighBitUnit(source.data, storage, i + 1)
    let b = readHighBitUnit(source.data, storage, i + 2)

    if (adjustment.type === "brightness-contrast") {
      const brightness = highBitParam(params, "brightness", 0) / 150
      const contrast = highBitParam(params, "contrast", 0) / 100
      const pivot = 0.5 + brightness * 0.12
      const adjust = (v: number) => {
        let next = brightness >= 0 ? v + (1 - v) * brightness : v * (1 + brightness)
        if (contrast !== 0) {
          const slope = contrast >= 0 ? 1 + contrast * 2.2 : 1 + contrast * 0.85
          next = (next - pivot) * slope + pivot
        }
        return next
      }
      r = adjust(r)
      g = adjust(g)
      b = adjust(b)
    } else if (adjustment.type === "levels") {
      const inputBlack = clamp(highBitParam(params, "inputBlack", 0) / 255)
      const inputWhite = clamp(highBitParam(params, "inputWhite", 255) / 255)
      const outputBlack = clamp(highBitParam(params, "outputBlack", 0) / 255)
      const outputWhite = clamp(highBitParam(params, "outputWhite", 255) / 255)
      const gamma = Math.max(0.01, highBitParam(params, "gamma", 1))
      const range = Math.max(0.000001, inputWhite - inputBlack)
      const apply = (v: number) => {
        const normalized = clamp((v - inputBlack) / range)
        return Math.pow(normalized, 1 / gamma) * (outputWhite - outputBlack) + outputBlack
      }
      const channel = String(params.channel ?? "rgb")
      if (channel === "red" || channel === "rgb") r = apply(r)
      if (channel === "green" || channel === "rgb") g = apply(g)
      if (channel === "blue" || channel === "rgb") b = apply(b)
    } else if (adjustment.type === "curves" && curvePoints) {
      if (curveChannel === "red" || curveChannel === "rgb") r = highBitCurveValue(r, curvePoints)
      if (curveChannel === "green" || curveChannel === "rgb") g = highBitCurveValue(g, curvePoints)
      if (curveChannel === "blue" || curveChannel === "rgb") b = highBitCurveValue(b, curvePoints)
    } else if (adjustment.type === "exposure") {
      const factor = 2 ** highBitParam(params, "ev", 0)
      r *= factor
      g *= factor
      b *= factor
    } else if (adjustment.type === "invert") {
      r = 1 - r
      g = 1 - g
      b = 1 - b
    } else if (adjustment.type === "channel-mixer") {
      const mixed = highBitChannelMixer(r, g, b, params)
      r = mixed.r
      g = mixed.g
      b = mixed.b
    } else if (adjustment.type === "grayscale" || adjustment.type === "desaturate") {
      r = g = b = 0.299 * r + 0.587 * g + 0.114 * b
    } else if (adjustment.type === "posterize") {
      const levels = Math.max(2, Math.round(highBitParam(params, "levels", 4)))
      const posterize = (v: number) => Math.round(v * (levels - 1)) / (levels - 1)
      r = posterize(r)
      g = posterize(g)
      b = posterize(b)
    } else if (adjustment.type === "threshold") {
      const threshold = clamp(highBitParam(params, "level", 128) / 255)
      const value = 0.299 * r + 0.587 * g + 0.114 * b >= threshold ? 1 : 0
      r = g = b = value
    }

    writeHighBitUnit(out, storage, i, r)
    writeHighBitUnit(out, storage, i + 1, g)
    writeHighBitUnit(out, storage, i + 2, b)
    out[i + 3] = source.data[i + 3]
  }
  return cloneHighBitWithData(source, out)
}

function emptyHistogramChannels(bins: number): HistogramChannels {
  return {
    red: new Uint32Array(bins),
    green: new Uint32Array(bins),
    blue: new Uint32Array(bins),
    luminosity: new Uint32Array(bins),
  }
}

function summarizeHistogram(hist: Uint32Array, bins: number, pixels: number, valueAtBin: (bin: number) => number): HistogramStats {
  if (!pixels) return { mean: 0, std: 0, median: 0, pixels: 0, minValue: 0, maxValue: 0 }
  let sum = 0
  let sumSq = 0
  let running = 0
  let median: number | null = null
  let minValue = 0
  let maxValue = 0
  let saw = false
  for (let bin = 0; bin < bins; bin++) {
    const count = hist[bin]
    if (!count) continue
    const value = valueAtBin(bin)
    if (!saw) {
      minValue = value
      saw = true
    }
    maxValue = value
    sum += value * count
    sumSq += value * value * count
    running += count
    if (median === null && running >= pixels / 2) median = value
  }
  const mean = sum / pixels
  return {
    mean,
    std: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
    median: median ?? 0,
    pixels,
    minValue,
    maxValue,
  }
}

export function computeCanvasHistogram(source: ImageData): HistogramResult {
  const bins = 256
  const channels = emptyHistogramChannels(bins)
  let pixels = 0
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    const r = source.data[i]
    const g = source.data[i + 1]
    const b = source.data[i + 2]
    const lum = clamp8(0.299 * r + 0.587 * g + 0.114 * b)
    channels.red[r]++
    channels.green[g]++
    channels.blue[b]++
    channels.luminosity[lum]++
    pixels++
  }
  return {
    bins,
    bitDepth: 8,
    source: "canvas",
    channels,
    stats: summarizeHistogram(channels.luminosity, bins, pixels, (bin) => bin),
  }
}

export function computeHighBitHistogram(source: HighBitImage, options: HighBitHistogramOptions = {}): HistogramResult {
  const bins = source.storage === "uint16"
    ? 65536
    : source.storage === "float32"
      ? Math.max(16, Math.min(65536, Math.round(options.floatBins ?? 4096)))
      : 256
  const channels = emptyHistogramChannels(bins)
  let pixels = 0
  const data = source.data
  const floatMin = source.storage === "float32" ? options.floatMin ?? 0 : 0
  let floatMax = source.storage === "float32" ? options.floatMax : undefined
  if (source.storage === "float32" && !Number.isFinite(floatMax)) {
    floatMax = 1
    for (let i = 0; i < data.length; i += 4) {
      floatMax = Math.max(floatMax!, Number(data[i]), Number(data[i + 1]), Number(data[i + 2]))
    }
  }
  const safeFloatMax = Math.max(floatMin + 0.000001, floatMax ?? 1)
  const unitToBin = (value: number) => {
    if (source.storage === "uint16") return Math.max(0, Math.min(65535, Math.round(value)))
    if (source.storage === "uint8") return Math.max(0, Math.min(255, Math.round(value)))
    return Math.max(0, Math.min(bins - 1, Math.round(((value - floatMin) / (safeFloatMax - floatMin)) * (bins - 1))))
  }
  const binToValue = (bin: number) => {
    if (source.storage === "float32") return floatMin + (bin / Math.max(1, bins - 1)) * (safeFloatMax - floatMin)
    return bin
  }
  for (let i = 0; i < data.length; i += 4) {
    const alpha = Number(data[i + 3])
    if (alpha <= 0) continue
    const r = Number(data[i])
    const g = Number(data[i + 1])
    const b = Number(data[i + 2])
    const lumValue = 0.299 * r + 0.587 * g + 0.114 * b
    channels.red[unitToBin(r)]++
    channels.green[unitToBin(g)]++
    channels.blue[unitToBin(b)]++
    channels.luminosity[unitToBin(source.storage === "float32" ? lumValue : Math.round(lumValue))]++
    pixels++
  }
  const stats = summarizeHistogram(channels.luminosity, bins, pixels, binToValue)
  if (source.storage === "float32") {
    stats.minValue = floatMin
    stats.maxValue = safeFloatMax
  }
  return {
    bins,
    bitDepth: source.bitDepth,
    source: source.storage,
    channels,
    stats,
  }
}

export function readHighBitPixel(source: HighBitImage, x: number, y: number): HighBitPixelReadout | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= source.width || py >= source.height) return null
  const i = (py * source.width + px) * 4
  const max = highBitMax(source.storage)
  const r = Number(source.data[i])
  const g = Number(source.data[i + 1])
  const b = Number(source.data[i + 2])
  const a = Number(source.data[i + 3])
  return {
    r,
    g,
    b,
    a,
    normalized: {
      r: max ? r / max : 0,
      g: max ? g / max : 0,
      b: max ? b / max : 0,
      a: max ? a / max : 0,
    },
  }
}

export function compareHighBitPixelToPreview(
  source: HighBitImage,
  preview: ImageData,
  x: number,
  y: number,
): HighBitPreviewComparison | null {
  const high = readHighBitPixel(source, x, y)
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (!high || px < 0 || py < 0 || px >= preview.width || py >= preview.height) return null
  const i = (py * preview.width + px) * 4
  const max = highBitMax(source.storage)
  const previewPixel = {
    r: preview.data[i],
    g: preview.data[i + 1],
    b: preview.data[i + 2],
    a: preview.data[i + 3],
  }
  const previewEquivalent = {
    r: source.storage === "float32" ? previewPixel.r / 255 : Math.round((previewPixel.r / 255) * max),
    g: source.storage === "float32" ? previewPixel.g / 255 : Math.round((previewPixel.g / 255) * max),
    b: source.storage === "float32" ? previewPixel.b / 255 : Math.round((previewPixel.b / 255) * max),
    a: source.storage === "float32" ? previewPixel.a / 255 : Math.round((previewPixel.a / 255) * max),
  }
  return {
    source: high,
    preview: previewPixel,
    previewEquivalent,
    delta: {
      r: high.r - previewEquivalent.r,
      g: high.g - previewEquivalent.g,
      b: high.b - previewEquivalent.b,
      a: high.a - previewEquivalent.a,
    },
  }
}

export function createFloatBufferFromImageData(source: ImageData, options: HighBitImageOptions = {}): FloatPixelBuffer {
  const data = new Float32Array(source.data.length)
  for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] / 255
  return {
    width: source.width,
    height: source.height,
    channels: 4,
    bitDepth: 32,
    colorMode: options.colorMode ?? "RGB",
    profile: options.profile,
    storage: "float32",
    data,
    warnings: [
      "Float filter buffers are local processing surfaces; browser canvas display remains tone-mapped 8-bit RGBA.",
    ],
  }
}

export function toneMapFloatBufferToImageData(source: FloatPixelBuffer): ImageData {
  return toneMapHighBitImageToImageData(source)
}

function cloneFloatBuffer(source: FloatPixelBuffer, data = new Float32Array(source.data)): FloatPixelBuffer {
  return {
    ...source,
    data,
    warnings: [...source.warnings],
  }
}

function floatParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function applyFloatBoxBlur(source: FloatPixelBuffer, radius: number): FloatPixelBuffer {
  const r = Math.max(0, Math.floor(radius))
  if (r <= 0) return cloneFloatBuffer(source)
  const { width, height } = source
  const tmp = new Float32Array(source.data.length)
  const out = new Float32Array(source.data.length)
  const span = 2 * r + 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      for (let ox = -r; ox <= r; ox++) {
        const sx = Math.max(0, Math.min(width - 1, x + ox))
        const i = (y * width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += source.data[i + c]
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
  return cloneFloatBuffer(source, out)
}

function applyFloatSharpen(source: FloatPixelBuffer, amount: number): FloatPixelBuffer {
  const { width, height } = source
  const a = amount / 100
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(height - 1, y + ky - 1))
            value += source.data[(sy * width + sx) * 4 + c] * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = source.data[o + 3]
    }
  }
  return cloneFloatBuffer(source, out)
}

export function applyFloatBufferFilter(
  source: FloatPixelBuffer,
  filter: FloatFilterKind,
  params: Record<string, number | string | boolean> = {},
): FloatPixelBuffer {
  if (filter === "box-blur") return applyFloatBoxBlur(source, floatParam(params, "radius", 1))
  if (filter === "sharpen") return applyFloatSharpen(source, floatParam(params, "amount", 50))
  if (filter === "brightness-contrast" || filter === "levels" || filter === "curves" || filter === "exposure") {
    return applyHighBitAdjustment(source, { type: filter, params }) as FloatPixelBuffer
  }
  const factor = 2 ** floatParam(params, "ev", 0)
  const out = new Float32Array(source.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] *= factor
    out[i + 1] *= factor
    out[i + 2] *= factor
  }
  return cloneFloatBuffer(source, out)
}

export function rgbToCmyk(rgb: RgbColor, options: CmykConversionOptions = {}): CmykColor {
  const r = clamp(rgb.r / 255)
  const g = clamp(rgb.g / 255)
  const b = clamp(rgb.b / 255)
  const c0 = 1 - r
  const m0 = 1 - g
  const y0 = 1 - b
  const maxBlack = Math.min(c0, m0, y0)
  const blackFactor = options.blackGeneration === "none"
    ? 0
    : options.blackGeneration === "light"
      ? 0.55
      : options.blackGeneration === "heavy"
        ? 1
        : 0.92
  const k = maxBlack * blackFactor
  let c = maxBlack >= 1 ? 0 : (c0 - k) / Math.max(0.0001, 1 - k)
  let m = maxBlack >= 1 ? 0 : (m0 - k) / Math.max(0.0001, 1 - k)
  let y = maxBlack >= 1 ? 0 : (y0 - k) / Math.max(0.0001, 1 - k)

  const limit = clamp((options.totalInkLimit ?? 320) / 100, 1, 4)
  const total = c + m + y + k
  if (total > limit) {
    const scale = (limit - k) / Math.max(0.0001, c + m + y)
    c *= scale
    m *= scale
    y *= scale
  }

  return { c: clamp(c), m: clamp(m), y: clamp(y), k: clamp(k) }
}

export function cmykToRgb(cmyk: CmykColor): RgbColor {
  const c = clamp(cmyk.c)
  const m = clamp(cmyk.m)
  const y = clamp(cmyk.y)
  const k = clamp(cmyk.k)
  return {
    r: clamp8(255 * (1 - c) * (1 - k)),
    g: clamp8(255 * (1 - m) * (1 - k)),
    b: clamp8(255 * (1 - y) * (1 - k)),
  }
}

export function rgbToLab(rgb: RgbColor): LabColor {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883

  const fx = labPivot(x)
  const fy = labPivot(y)
  const fz = labPivot(z)

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

export function labToRgb(lab: LabColor): RgbColor {
  const fy = (lab.l + 16) / 116
  const fx = lab.a / 500 + fy
  const fz = fy - lab.b / 200

  const x = 0.95047 * labPivotInverse(fx)
  const y = labPivotInverse(fy)
  const z = 1.08883 * labPivotInverse(fz)

  const r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const g = x * -0.969266 + y * 1.8760108 + z * 0.041556
  const b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252

  return {
    r: linearToSrgb(r),
    g: linearToSrgb(g),
    b: linearToSrgb(b),
  }
}

export function describeColorPipeline(options: HighBitImageOptions = {}): ColorPipelineDescription {
  const bitDepth = options.bitDepth ?? 8
  const colorMode = options.colorMode ?? "RGB"
  const storage: HighBitImage["storage"] = bitDepth === 32 ? "float32" : bitDepth === 16 ? "uint16" : "uint8"
  const warnings = [
    "A browser-local ICC transform engine is available for supported RGB, grayscale, and CMYK proof profiles.",
    "High-bit typed arrays back compatible filters, adjustment compositing, paint synchronization, pixel readout, and precision TIFF/PNM export; browser display remains an 8-bit RGBA preview.",
  ]
  if (options.profile && options.profile !== "sRGB IEC61966-2.1") {
    warnings.push(`${options.profile} is converted through the local ICC profile connection space for previews and exports where the profile is supported.`)
  }
  return {
    storage,
    supportsHighBitMath: bitDepth > 8,
    supportsIccTransforms: true,
    colorMode,
    bitDepth,
    warnings,
  }
}

function normalizeBitDepth(value: unknown): PipelineBitDepth {
  return value === 16 || value === 32 ? value : 8
}

function normalizeMode(value: unknown): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : "RGB"
  const lower = text.toLowerCase()
  if (lower === "rgb") return "RGB"
  if (lower === "cmyk") return "CMYK"
  if (lower === "lab") return "Lab"
  if (lower === "grayscale" || lower === "gray") return "Grayscale"
  if (lower === "bitmap") return "Bitmap"
  if (lower === "duotone") return "Duotone"
  if (lower === "indexed") return "Indexed"
  if (lower === "multichannel" || lower === "multi-channel") return "Multichannel"
  return text
}

function colorHonestyBadge(mode: string, bitDepth: PipelineBitDepth, profile: string | undefined, hasWarnings: boolean) {
  if (mode !== "RGB" && bitDepth > 8) return `${mode}/${bitDepth}-bit typed edit path, 8-bit preview`
  if (bitDepth > 8) return `${bitDepth}-bit typed edit path, 8-bit preview`
  if (mode !== "RGB") return `${mode} metadata, 8-bit RGBA canvas`
  if (profile && profile !== "sRGB IEC61966-2.1" && hasWarnings) return "ICC metadata, sRGB canvas preview"
  return "RGB/8-bit canvas"
}

export function describeDocumentColorHonesty(doc: DocumentColorHonestyInput): DocumentColorHonestyReport {
  const mode = normalizeMode(doc.colorMode ?? doc.modeSettings?.mode)
  const bitDepth = normalizeBitDepth(doc.bitDepth)
  const profile = doc.colorManagement?.assignedProfile
  const items: DocumentColorHonestyItem[] = []
  const add = (label: string, severity: ColorHonestySeverity, detail: string) => {
    items.push({ label, severity, detail })
  }

  const nonRgb = mode !== "RGB"
  const highBit = bitDepth > 8
  const profileNeedsTransform = !!profile && profile !== "sRGB IEC61966-2.1"
  const proofingEnabled = !!doc.colorManagement?.proofColors || !!doc.colorManagement?.gamutWarning
  const hasExtraChannels = (doc.channels?.length ?? 0) > 0

  add(
    "Browser canvas path",
    nonRgb || highBit ? "warn" : "info",
    nonRgb || highBit
      ? `The editable document tracks ${mode}/${bitDepth}-bit intent; high-bit-aware edits use typed arrays, while browser display and fallback operations use 8-bit RGBA preview pixels.`
      : "Painting, display, and most filters operate on browser 8-bit RGBA canvas pixels.",
  )

  if (highBit) {
    add(
      "High-bit editing",
      "warn",
      `${bitDepth}-bit typed-array sources are used for compatible filters, adjustment layers, brush/paint synchronization, source-vs-preview readout, and TIFF/PNM precision export; unsupported operations can still fall back to the tone-mapped canvas preview.`,
    )
  }

  if (mode === "CMYK") {
    add(
      "CMYK separations",
      "warn",
      "Typed CMYK process plates and total-ink analysis are available for preflight and preview; the browser canvas remains a tone-mapped RGB display surface.",
    )
  } else if (mode === "Lab") {
    add(
      "Lab color",
      "warn",
      "Typed Lab L/a/b plates are available for color analysis and conversion; browser display is still rendered through an RGB preview.",
    )
  } else if (mode === "Multichannel" || doc.modeSettings?.multichannel || hasExtraChannels) {
    add(
      "Spot/multichannel channels",
      "warn",
      "Spot, alpha, and multichannel data can be modeled as typed separation plates with overprint preview; browser raster formats still flatten them for final display/export unless a plate-capable export is used.",
    )
  } else if (mode === "Duotone" || doc.modeSettings?.duotone) {
    add(
      "Duotone inks",
      "warn",
      "Duotone ink metadata is tracked for intent; browser rendering uses an RGB preview approximation.",
    )
  } else if (mode === "Indexed" || doc.modeSettings?.indexed) {
    add(
      "Indexed palette",
      "warn",
      "Indexed color settings are modeled for export intent; canvas edits occur in RGBA and can expand colors outside the palette.",
    )
  } else if (mode === "Bitmap" || doc.modeSettings?.bitmap) {
    add(
      "Bitmap mode",
      "warn",
      "Bitmap threshold/halftone metadata is tracked, but editable pixels are still RGBA until a dedicated 1-bit pipeline is added.",
    )
  } else if (mode === "Grayscale") {
    add(
      "Grayscale mode",
      "warn",
      "Grayscale intent is tracked, while painting and filters use RGB channels with grayscale preview behavior.",
    )
  }

  add(
    "ICC transforms",
    profileNeedsTransform || proofingEnabled ? "info" : "info",
    profileNeedsTransform || proofingEnabled
      ? `${profile ?? "Document profile"} and proof/gamut settings run through the browser-local ICC transform engine for preview and raster export conversion.`
      : "sRGB canvas display is used unless a document records a different profile or proofing setup.",
  )

  add(
    "Destructive 8-bit operations",
    nonRgb || highBit || profileNeedsTransform ? "warn" : "info",
    "Operations without a high-bit typed-array implementation can permanently bake the current 8-bit RGBA preview approximation into pixels.",
  )

  const hasWarnings = items.some((item) => item.severity !== "info")
  const badge = colorHonestyBadge(mode, bitDepth, profile, hasWarnings)
  return {
    badge,
    items,
    warnings: items.filter((item) => item.severity !== "info").map((item) => item.detail),
    hasWarnings,
    usesBrowser8BitCanvas: true,
  }
}

/* ===================================================================
 * Phase 4 — High-Bit Color Pipeline (Gap Report Item 15)
 *
 * CLUT/device-link ICC tag parsing, per-channel proof toggles,
 * gamut/plate view generation, high-bit filter helpers, and
 * Assign/Convert Profile consistency.
 * =================================================================== */

// ── CLUT / Device-Link ICC Tag Parsing ──────────────────────────────

export interface IccClutTag {
  inputChannels: number
  outputChannels: number
  gridPoints: number[]
  tableData: Float32Array
  precisionBits: 8 | 16
}

export interface IccDeviceLinkProfile {
  sourceColorSpace: string
  destColorSpace: string
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  clutData: IccClutTag | null
  description: string
}

export interface IccClutCoverageDiagnostic {
  aToB0: boolean
  aToB1: boolean
  aToB2: boolean
  bToA0: boolean
  bToA1: boolean
  bToA2: boolean
  gamutTag: boolean
  coveragePercent: number
  missingTags: string[]
}

function readU32BE(data: Uint8Array, off: number): number {
  return ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0
}

function readU16BE(data: Uint8Array, off: number): number {
  return (data[off] << 8) | data[off + 1]
}

function tagSignature(data: Uint8Array, off: number): string {
  return String.fromCharCode(data[off], data[off + 1], data[off + 2], data[off + 3])
}

/**
 * Parse a multi-dimensional CLUT tag from raw ICC profile data.
 */
export function parseIccClutTag(data: Uint8Array, offset: number, size: number): IccClutTag | null {
  if (size < 20 || offset + size > data.length) return null
  const sig = tagSignature(data, offset)
  if (sig !== "mft1" && sig !== "mft2" && sig !== "mAB " && sig !== "mBA ") return null

  const inputChannels = data[offset + 8] ?? 3
  const outputChannels = data[offset + 9] ?? 3
  const gridPoints: number[] = []
  const precisionBits: 8 | 16 = sig === "mft2" ? 16 : 8

  // Read grid dimensions (up to 16 input channels)
  for (let i = 0; i < inputChannels; i++) {
    const gp = data[offset + 10 + i] ?? 2
    gridPoints.push(gp)
  }

  // Calculate table size
  let tableSize = outputChannels
  for (const gp of gridPoints) tableSize *= gp
  const bytesPerEntry = precisionBits === 16 ? 2 : 1
  const tableOffset = offset + 32 // approximate header skip
  const tableBytes = Math.min(tableSize * bytesPerEntry, size - 32)

  const tableData = new Float32Array(Math.floor(tableBytes / bytesPerEntry))
  for (let i = 0; i < tableData.length; i++) {
    if (precisionBits === 16) {
      tableData[i] = readU16BE(data, tableOffset + i * 2) / 65535
    } else {
      tableData[i] = data[tableOffset + i] / 255
    }
  }

  return { inputChannels, outputChannels, gridPoints, tableData, precisionBits }
}

/**
 * Parse a device-link ICC profile (profile class = 'link').
 */
export function parseIccDeviceLinkProfile(data: Uint8Array): IccDeviceLinkProfile | null {
  if (data.length < 128) return null
  const profileSize = readU32BE(data, 0)
  if (profileSize < 128 || profileSize > data.length) return null

  const profileClass = tagSignature(data, 12)
  if (profileClass !== "link") return null

  const sourceColorSpace = tagSignature(data, 16).trim()
  const destColorSpace = tagSignature(data, 20).trim()
  const intentByte = readU32BE(data, 64) & 0x3
  const intents = ["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"] as const
  const renderingIntent = intents[intentByte] ?? "perceptual"

  // Look for AToB0 tag
  const tagCount = readU32BE(data, 128)
  let clutData: IccClutTag | null = null

  for (let i = 0; i < Math.min(tagCount, 100); i++) {
    const tagOff = 132 + i * 12
    if (tagOff + 12 > data.length) break
    const sig = tagSignature(data, tagOff)
    const offset = readU32BE(data, tagOff + 4)
    const size = readU32BE(data, tagOff + 8)
    if (sig === "A2B0" || sig === "A2B1") {
      clutData = parseIccClutTag(data, offset, size)
      if (clutData) break
    }
  }

  return { sourceColorSpace, destColorSpace, renderingIntent, clutData, description: `Device-link: ${sourceColorSpace} → ${destColorSpace}` }
}

/**
 * Diagnose which CLUT tags are present in an ICC profile.
 */
export function diagnoseIccClutCoverage(profileData: Uint8Array): IccClutCoverageDiagnostic {
  const result: IccClutCoverageDiagnostic = {
    aToB0: false, aToB1: false, aToB2: false,
    bToA0: false, bToA1: false, bToA2: false,
    gamutTag: false, coveragePercent: 0, missingTags: [],
  }

  if (profileData.length < 132) {
    result.missingTags = ["A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2", "gamt"]
    return result
  }

  const tagCount = readU32BE(profileData, 128)
  const foundTags = new Set<string>()
  for (let i = 0; i < Math.min(tagCount, 200); i++) {
    const tagOff = 132 + i * 12
    if (tagOff + 12 > profileData.length) break
    foundTags.add(tagSignature(profileData, tagOff))
  }

  const checks: Array<[keyof IccClutCoverageDiagnostic, string]> = [
    ["aToB0", "A2B0"], ["aToB1", "A2B1"], ["aToB2", "A2B2"],
    ["bToA0", "B2A0"], ["bToA1", "B2A1"], ["bToA2", "B2A2"],
    ["gamutTag", "gamt"],
  ]
  let found = 0
  for (const [key, sig] of checks) {
    if (foundTags.has(sig)) {
      ;(result as unknown as Record<string, boolean>)[key] = true
      found++
    } else {
      result.missingTags.push(sig)
    }
  }
  result.coveragePercent = Math.round((found / checks.length) * 100)
  return result
}

// ── Per-Channel Proof Toggles ───────────────────────────────────────

export interface PerChannelProofOptions {
  cyan: boolean
  magenta: boolean
  yellow: boolean
  black: boolean
  simulatePaperWhite: boolean
  simulateInkBlack: boolean
}

/**
 * Soft proof with per-channel CMYK toggles. Channels set to false are
 * zeroed in the CMYK separation before converting back to RGB.
 */
export function softProofWithChannelToggles(
  imageData: ImageData,
  _proofProfile: string,
  options: PerChannelProofOptions,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255

    // Simple RGB-to-CMYK
    const k = options.black ? 1 - Math.max(r, g, b) : 0
    let c = options.cyan ? (1 - r - k) / (1 - k || 1) : 0
    let m = options.magenta ? (1 - g - k) / (1 - k || 1) : 0
    let y = options.yellow ? (1 - b - k) / (1 - k || 1) : 0

    c = Math.max(0, Math.min(1, c))
    m = Math.max(0, Math.min(1, m))
    y = Math.max(0, Math.min(1, y))

    // CMYK back to RGB
    d[i] = Math.round((1 - c) * (1 - k) * 255)
    d[i + 1] = Math.round((1 - m) * (1 - k) * 255)
    d[i + 2] = Math.round((1 - y) * (1 - k) * 255)

    // Paper/ink simulation
    if (options.simulatePaperWhite) {
      d[i] = Math.min(d[i], 245)
      d[i + 1] = Math.min(d[i + 1], 240)
      d[i + 2] = Math.min(d[i + 2], 235)
    }
    if (options.simulateInkBlack && k > 0.9) {
      d[i] = Math.max(d[i], 15)
      d[i + 1] = Math.max(d[i + 1], 15)
      d[i + 2] = Math.max(d[i + 2], 15)
    }
  }

  return out
}

/**
 * Generate a single-plate grayscale view for one CMYK channel.
 */
export function generatePlateView(
  imageData: ImageData,
  channel: "cyan" | "magenta" | "yellow" | "black",
  _proofProfile?: string,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const k = 1 - Math.max(r, g, b)
    let value = 0

    if (channel === "cyan") value = k < 1 ? (1 - r - k) / (1 - k) : 0
    else if (channel === "magenta") value = k < 1 ? (1 - g - k) / (1 - k) : 0
    else if (channel === "yellow") value = k < 1 ? (1 - b - k) / (1 - k) : 0
    else value = k

    const gray = Math.round((1 - Math.max(0, Math.min(1, value))) * 255)
    d[i] = gray
    d[i + 1] = gray
    d[i + 2] = gray
    d[i + 3] = 255
  }

  return out
}

// ── Gamut/Plate View Helpers ────────────────────────────────────────

export interface GamutViewOptions {
  warningColor: string
  opacity: number
  mode: "overlay" | "solid" | "border"
}

/**
 * Render a gamut warning overlay on the image data. Out-of-gamut pixels
 * are highlighted using the selected visualization mode.
 */
export function renderGamutWarningOverlay(
  imageData: ImageData,
  _targetProfile: string,
  options: GamutViewOptions,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data
  const w = imageData.width

  // Parse warning color
  const wc = options.warningColor.replace("#", "")
  const wr = parseInt(wc.substring(0, 2), 16) || 128
  const wg = parseInt(wc.substring(2, 4), 16) || 128
  const wb = parseInt(wc.substring(4, 6), 16) || 128
  const alpha = options.opacity

  // Simple sRGB gamut boundary check (colors near 0/255 in any channel are likely in-gamut)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]

    // Approximate: very saturated colors outside sRGB gamut boundary
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0
    const isOutOfGamut = saturation > 0.95 && maxC > 240

    if (isOutOfGamut) {
      if (options.mode === "solid") {
        d[i] = wr
        d[i + 1] = wg
        d[i + 2] = wb
      } else if (options.mode === "overlay") {
        d[i] = Math.round(d[i] * (1 - alpha) + wr * alpha)
        d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + wg * alpha)
        d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + wb * alpha)
      } else if (options.mode === "border") {
        // Only mark border pixels of out-of-gamut regions
        const px = (i / 4) % w
        const py = Math.floor(i / 4 / w)
        const isEdge = px === 0 || py === 0 || px === w - 1 || py === imageData.height - 1
        if (isEdge) {
          d[i] = wr; d[i + 1] = wg; d[i + 2] = wb
        }
      }
    }
  }

  return out
}

/**
 * Calculate ink coverage percentages per CMYK channel plus total ink.
 */
export function generateInkCoverageReport(
  imageData: ImageData,
  _proofProfile?: string,
): { cyan: number; magenta: number; yellow: number; black: number; totalInk: number; maxTotalInk: number } {
  const d = imageData.data
  let totalC = 0, totalM = 0, totalY = 0, totalK = 0
  let maxTotalInk = 0
  let pixels = 0

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const k = 1 - Math.max(r, g, b)
    const c = k < 1 ? (1 - r - k) / (1 - k) : 0
    const m = k < 1 ? (1 - g - k) / (1 - k) : 0
    const y = k < 1 ? (1 - b - k) / (1 - k) : 0

    totalC += c
    totalM += m
    totalY += y
    totalK += k
    const pixelTotalInk = (c + m + y + k) * 100
    if (pixelTotalInk > maxTotalInk) maxTotalInk = pixelTotalInk
    pixels++
  }

  const factor = pixels > 0 ? 100 / pixels : 0
  return {
    cyan: totalC * factor,
    magenta: totalM * factor,
    yellow: totalY * factor,
    black: totalK * factor,
    totalInk: (totalC + totalM + totalY + totalK) * factor,
    maxTotalInk: Math.round(maxTotalInk * 10) / 10,
  }
}

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

// ── Assign / Convert Profile Consistency ────────────────────────────

export interface ProfileAssignment {
  profileName: string
  intent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  blackPointCompensation: boolean
}

export interface ProfileAssignmentPlan {
  currentProfile: string
  newProfile: string
  action: "assign" | "convert"
  gamutMappingNote: string
  expectedShift: "none" | "minor" | "moderate" | "significant"
  warnings: string[]
}

/**
 * Plan a profile assignment (no pixel changes, just tag).
 */
export function planProfileAssignment(
  currentProfile: string,
  newProfile: string,
): ProfileAssignmentPlan {
  const warnings: string[] = []
  const current = (currentProfile || "sRGB").toLowerCase()
  const target = (newProfile || "sRGB").toLowerCase()

  let expectedShift: ProfileAssignmentPlan["expectedShift"] = "none"
  let gamutMappingNote = "No pixel data will be modified. Only the profile tag changes."

  if (current === target) {
    gamutMappingNote = "Same profile — no visible change."
  } else if (current.includes("srgb") && target.includes("adobe")) {
    expectedShift = "moderate"
    gamutMappingNote = "Colors will appear less saturated as the same numbers are reinterpreted in a wider gamut."
    warnings.push("Assigning a wider gamut profile without converting will desaturate the visual appearance.")
  } else if (current.includes("adobe") && target.includes("srgb")) {
    expectedShift = "moderate"
    gamutMappingNote = "Colors will appear more saturated as the same numbers are reinterpreted in a narrower gamut."
    warnings.push("Assigning a narrower profile without converting may clip some previously in-gamut colors visually.")
  } else if (current.includes("prophoto") || target.includes("prophoto")) {
    expectedShift = "significant"
    gamutMappingNote = "ProPhoto RGB has a very different gamut. Significant visual shift expected."
    warnings.push("ProPhoto assignment without conversion causes large visual shifts.")
  } else {
    expectedShift = "minor"
    gamutMappingNote = "Profile reassignment changes how pixel values are interpreted for display."
  }

  return { currentProfile, newProfile, action: "assign", gamutMappingNote, expectedShift, warnings }
}

/**
 * Plan a profile conversion (pixels are transformed).
 */
export function planProfileConversion(
  currentProfile: string,
  targetProfile: string,
  intent: string = "relative-colorimetric",
): ProfileAssignmentPlan {
  const warnings: string[] = []
  const current = (currentProfile || "sRGB").toLowerCase()
  const target = (targetProfile || "sRGB").toLowerCase()

  let expectedShift: ProfileAssignmentPlan["expectedShift"] = "none"
  let gamutMappingNote = `Pixel data will be transformed from ${currentProfile || "sRGB"} to ${targetProfile || "sRGB"} using ${intent} intent.`

  if (current === target) {
    gamutMappingNote = "Same profile — no conversion needed."
  } else if (current.includes("srgb") && (target.includes("cmyk") || target.includes("fogra"))) {
    expectedShift = "significant"
    gamutMappingNote = "RGB to CMYK conversion. Some bright saturated colors will be clipped."
    warnings.push("RGB to CMYK conversion is lossy. Out-of-gamut colors will be mapped to the nearest in-gamut color.")
  } else if (target.includes("srgb") && current.includes("adobe")) {
    expectedShift = "minor"
    gamutMappingNote = "Adobe RGB to sRGB — some saturated greens and cyans may be clipped."
  } else {
    expectedShift = "minor"
    gamutMappingNote = "Standard profile conversion with gamut mapping."
  }

  return { currentProfile, newProfile: targetProfile, action: "convert", gamutMappingNote, expectedShift, warnings }
}

/**
 * Validate whether a profile is compatible with the document's color mode and bit depth.
 */
export function validateProfileForDocument(
  profileName: string,
  colorMode: PipelineColorMode,
  bitDepth: PipelineBitDepth,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []
  const name = (profileName || "").toLowerCase()

  // Check color mode compatibility
  if (colorMode === "CMYK" && (name.includes("srgb") || name.includes("adobe rgb") || name.includes("prophoto"))) {
    warnings.push(`Profile "${profileName}" is an RGB profile but the document is in CMYK mode.`)
    return { valid: false, warnings }
  }
  if (colorMode === "RGB" && (name.includes("cmyk") || name.includes("fogra") || name.includes("swop"))) {
    warnings.push(`Profile "${profileName}" is a CMYK profile but the document is in RGB mode.`)
    return { valid: false, warnings }
  }
  if (colorMode === "Grayscale" && !name.includes("gray") && !name.includes("grey") && name !== "dot gain 20%" && name !== "dot gain 25%") {
    warnings.push(`Profile "${profileName}" may not be a Grayscale profile.`)
  }

  // Bit depth warnings
  if (bitDepth === 32 && name.includes("cmyk")) {
    warnings.push("32-bit float with CMYK profiles may produce unexpected results in some preview paths.")
  }

  return { valid: warnings.length === 0 || !warnings.some((w) => w.includes("is a")), warnings }
}
