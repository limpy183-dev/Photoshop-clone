// Shared color-pipeline types, clamp utilities, color-space conversions,
// pipeline description, and document color-honesty reporting.

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

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export type RgbConvertibleMode = "RGB" | "CMYK" | "Lab" | "Grayscale"
export type RgbConvertedColor = RgbColor | CmykColor | LabColor | GrayscaleColor

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
