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
    | "exposure"
    | "invert"
    | "channel-mixer"
    | "grayscale"
    | "desaturate"
    | "posterize"
    | "threshold"
  params?: Record<string, number | string | boolean>
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

export type FloatFilterKind = "exposure" | "box-blur" | "sharpen"

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

export function toneMapHighBitImageToImageData(source: HighBitImage): ImageData {
  const out = new Uint8ClampedArray(source.width * source.height * 4)
  if (source.storage === "uint16") {
    const data = source.data as Uint16Array
    for (let i = 0; i < out.length; i++) out[i] = clamp8(data[i] / 257)
  } else if (source.storage === "float32") {
    const data = source.data as Float32Array
    for (let i = 0; i < out.length; i++) out[i] = clamp8(data[i] * 255)
  } else {
    out.set(source.data as Uint8ClampedArray)
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

export function applyHighBitAdjustment(source: HighBitImage, adjustment: HighBitAdjustment): HighBitImage {
  const storage = source.storage
  const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
  const out = new Ctor(source.data.length) as HighBitImage["data"]
  const params = adjustment.params ?? {}
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
    "Local RGB, CMYK, and Lab math is available for previews and algorithms, but this is not a full ICC transform engine.",
    "Canvas painting, browser display, and browser raster export still resolve through 8-bit RGBA surfaces.",
  ]
  if (options.profile && options.profile !== "sRGB IEC61966-2.1") {
    warnings.push(`${options.profile} is tracked as intent/profile metadata unless a dedicated ICC/WASM engine is added.`)
  }
  return {
    storage,
    supportsHighBitMath: bitDepth > 8,
    supportsIccTransforms: false,
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
  if (mode !== "RGB" && bitDepth > 8) return `${mode}/${bitDepth}-bit metadata, 8-bit RGBA canvas`
  if (bitDepth > 8) return `${bitDepth}-bit metadata, 8-bit RGBA canvas`
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
      ? `The editable document tracks ${mode}/${bitDepth}-bit intent, but browser painting, display, and many filters operate on 8-bit RGBA canvas pixels.`
      : "Painting, display, and most filters operate on browser 8-bit RGBA canvas pixels.",
  )

  if (highBit) {
    add(
      "High-bit editing",
      "warn",
      `${bitDepth}-bit document state is modeled for import/export intent and typed-array helpers; destructive canvas edits are tone-mapped to 8-bit RGBA surfaces.`,
    )
  }

  if (mode === "CMYK") {
    add(
      "CMYK separations",
      "warn",
      "CMYK values and print intent are tracked as document metadata and local conversion helpers, not as live native separated ink channels in the browser canvas.",
    )
  } else if (mode === "Lab") {
    add(
      "Lab color",
      "warn",
      "Lab conversions are available for algorithms, but the displayed and painted document surface remains RGB canvas data.",
    )
  } else if (mode === "Multichannel" || doc.modeSettings?.multichannel || hasExtraChannels) {
    add(
      "Spot/multichannel channels",
      "warn",
      "Spot, alpha, and multichannel data can be tracked as saved channels, but browser raster export and canvas painting cannot preserve native spot plates.",
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
    profileNeedsTransform || proofingEnabled ? "warn" : "info",
    profileNeedsTransform || proofingEnabled
      ? `${profile ?? "Document profile"} and proof/gamut settings are recorded, but this app does not run a native ICC engine in the browser canvas path.`
      : "sRGB-like canvas display is used unless a document records a different profile or proofing setup.",
  )

  add(
    "Destructive 8-bit operations",
    nonRgb || highBit || profileNeedsTransform ? "warn" : "info",
    "Brush strokes, raster filters, layer compositing previews, and browser exports can permanently bake the current 8-bit RGBA approximation into pixels.",
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
