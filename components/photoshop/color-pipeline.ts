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
