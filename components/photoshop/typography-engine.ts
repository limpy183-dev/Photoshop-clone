import type {
  Layer,
  OpenTypeControls,
  PathPoint,
  PathProps,
  PsDocument,
  ShapeProps,
  TextAntiAliasMode,
  TextProps,
  TypographyEmbeddedFont,
  ThreeDMaterial,
  ThreeDObject,
  ThreeDScene,
  TypographyAxisDefinition,
  TypographyNamedInstance,
  Vec3,
} from "./types"
import { shapeToEditablePath } from "./vector-path-operations"

import {
  clamp,
  compareAxisOrder,
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  escapeRegExp,
  fontFamilyList,
  formatAxisValue,
  OPEN_TYPE_FEATURE_SAMPLES,
  OPEN_TYPE_FEATURE_TOGGLES,
  quoteFontFamily,
  WEB_SAFE_FONT_CANDIDATES,
  type FindReplaceHighlightGroup,
  type FindReplaceHighlightSegment,
  type FindReplaceOptions,
  type FindReplaceResult,
  type FontCandidate,
  type FontDiagnostics,
  type FontGeometryMetrics,
  type FontSpecimen,
  type FontSubstitutionComparison,
  type FontSubstitutionResult,
  type MatchFontImageResult,
  type MatchFontResult,
  type OpenTypeFeatureSupport,
  type OpenTypeFontMetadata,
  type TextPathGlyphLayout,
  type TextPathHandleModel,
  type TypographyGlyphRunItem,
  type TypographyRenderPlan,
  type TypographyShapingPlan,
  type VariableFontAxisControl,
  type VariableFontAxisControlModel,
  type VariableFontInspection,
  type VariableFontMetadata,
} from "./typography-engine-types"

export {
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  listStylisticSetKeys,
} from "./typography-engine-types"

export type {
  FindReplaceHighlightGroup,
  FindReplaceHighlightSegment,
  FindReplaceOptions,
  FindReplaceResult,
  FontCandidate,
  FontDiagnostics,
  FontGeometryMetrics,
  FontPreviewSpec,
  FontSpecimen,
  FontSubstitutionComparison,
  FontSubstitutionResult,
  MatchFontImageResult,
  MatchFontResult,
  OpenTypeFeatureSupport,
  OpenTypeFeatureToggle,
  OpenTypeFontMetadata,
  TextPathGlyphLayout,
  TextPathHandleModel,
  TypographyGlyphRunItem,
  TypographyRenderPlan,
  TypographyShapingPlan,
  VariableFontAxisControl,
  VariableFontAxisControlModel,
  VariableFontInspection,
  VariableFontMetadata,
} from "./typography-engine-types"

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bufferBytes(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }
  return new Uint8Array(buffer)
}

function base64FromBytes(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

function bytesFromBase64(value: string) {
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"))
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return new Uint8Array()
  }
}

function fontFormatFromName(fileName: string, mimeType = ""): TypographyEmbeddedFont["format"] {
  const lower = `${fileName} ${mimeType}`.toLowerCase()
  if (lower.includes("woff2")) return "woff2"
  if (lower.includes("woff")) return "woff"
  if (lower.includes(".otf") || lower.includes("opentype")) return "otf"
  if (lower.includes(".ttf") || lower.includes("truetype") || lower.includes("font/ttf")) return "ttf"
  return "unknown"
}

function fontHash(bytes: Uint8Array) {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function createEmbeddedFontFromBuffer(
  family: string,
  fileName: string,
  buffer: ArrayBuffer | ArrayBufferView,
  mimeType = "font/ttf",
): TypographyEmbeddedFont {
  const bytes = bufferBytes(buffer)
  return {
    family,
    fileName,
    mimeType,
    dataBase64: base64FromBytes(bytes),
    byteLength: bytes.byteLength,
    format: fontFormatFromName(fileName, mimeType),
    hash: fontHash(bytes),
  }
}

export function embeddedFontToArrayBuffer(font: TypographyEmbeddedFont): ArrayBuffer {
  return exactArrayBuffer(bytesFromBase64(font.dataBase64))
}

export function isTypographyEmbeddedFont(value: unknown): value is TypographyEmbeddedFont {
  const font = value as Partial<TypographyEmbeddedFont> | undefined
  return !!font &&
    typeof font.family === "string" &&
    typeof font.fileName === "string" &&
    typeof font.dataBase64 === "string" &&
    typeof font.byteLength === "number"
}

export function findEmbeddedFontForFamily(
  assets: PsDocument["assetLibrary"] | undefined,
  family: string,
): TypographyEmbeddedFont | undefined {
  const lower = family.trim().toLowerCase()
  for (const asset of assets ?? []) {
    if (asset.kind !== "font") continue
    const payload = asset.payload
    if (!isTypographyEmbeddedFont(payload)) continue
    if (payload.family.toLowerCase() === lower || asset.name.toLowerCase() === lower) return payload
  }
  return undefined
}

export function collectEmbeddedTypographyFonts(doc: PsDocument): TypographyEmbeddedFont[] {
  const usedFamilies = new Set(doc.layers.map((layer) => layer.text?.font).filter((font): font is string => !!font).map((font) => font.toLowerCase()))
  const byHash = new Map<string, TypographyEmbeddedFont>()
  for (const layer of doc.layers) {
    if (layer.text?.embeddedFont && usedFamilies.has(layer.text.font.toLowerCase())) {
      byHash.set(layer.text.embeddedFont.hash, layer.text.embeddedFont)
    }
  }
  for (const asset of doc.assetLibrary ?? []) {
    if (asset.kind !== "font" || !isTypographyEmbeddedFont(asset.payload)) continue
    if (!usedFamilies.has(asset.payload.family.toLowerCase()) && !usedFamilies.has(asset.name.toLowerCase())) continue
    byHash.set(asset.payload.hash, asset.payload)
  }
  return [...byHash.values()].sort((a, b) => a.family.localeCompare(b.family) || a.fileName.localeCompare(b.fileName))
}

function visibleGlyphCount(sample: string) {
  return Math.max(1, [...sample.replace(/\s/g, "")].length)
}

function fontCandidateForFamily(font: string) {
  const lower = font.toLowerCase()
  return WEB_SAFE_FONT_CANDIDATES.find((candidate) => lower.includes(candidate.family.toLowerCase()))
}

function estimateFontGeometry(text: TextProps, sample = text.content): FontGeometryMetrics {
  const candidate = fontCandidateForFamily(text.font)
  const serifLikely = /\bserif\b|georgia|times|garamond|baskerville/i.test(text.font)
  const averageGlyphWidth =
    candidate?.averageGlyphWidth ??
    (serifLikely ? 0.52 : /\bmono|courier|code\b/i.test(text.font) ? 0.6 : 0.54)
  const xHeight = candidate?.xHeight ?? (serifLikely ? 0.47 : 0.54)
  const size = Math.max(1, text.size)
  return {
    sampleWidth: averageGlyphWidth * visibleGlyphCount(sample) * size,
    averageGlyphWidth,
    xHeight,
    ascent: size * 0.78,
    descent: size * 0.22,
    source: "heuristic",
  }
}

function finiteMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function measureFontGeometry(text: TextProps, sample = text.content): FontGeometryMetrics {
  const fallback = estimateFontGeometry(text, sample)
  if (typeof document === "undefined") return fallback
  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx || typeof ctx.measureText !== "function") return fallback
    const sampleText = sample || "Ag 123"
    const plan = buildTypographyRenderPlan({ ...text, content: sampleText })
    ctx.font = plan.cssFont
    ctx.fontFeatureSettings = plan.fontFeatureSettings
    ctx.fontVariationSettings = plan.fontVariationSettings
    ctx.fontVariantCaps = plan.fontVariantCaps
    ctx.fontVariantLigatures = plan.fontVariantLigatures
    ctx.fontKerning = plan.fontKerning
    const metrics = ctx.measureText(sampleText)
    if (!finiteMetric(metrics.width) || metrics.width <= 0) return fallback
    const xMetrics = ctx.measureText("x")
    const ascent = finiteMetric(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0
      ? metrics.actualBoundingBoxAscent
      : fallback.ascent
    const descent = finiteMetric(metrics.actualBoundingBoxDescent) && metrics.actualBoundingBoxDescent >= 0
      ? metrics.actualBoundingBoxDescent
      : fallback.descent
    const xHeight = finiteMetric(xMetrics.actualBoundingBoxAscent) && xMetrics.actualBoundingBoxAscent > 0
      ? clamp(xMetrics.actualBoundingBoxAscent / Math.max(1, text.size), 0.2, 1.2)
      : fallback.xHeight
    return {
      sampleWidth: metrics.width,
      averageGlyphWidth: clamp(metrics.width / visibleGlyphCount(sampleText) / Math.max(1, text.size), 0.15, 2),
      xHeight,
      ascent,
      descent,
      source: "canvas",
    }
  } catch {
    return fallback
  }
}

function metricFromCandidate(candidate: FontCandidate, sample: string, size: number): FontGeometryMetrics {
  return {
    sampleWidth: candidate.averageGlyphWidth * visibleGlyphCount(sample) * Math.max(1, size),
    averageGlyphWidth: candidate.averageGlyphWidth,
    xHeight: candidate.xHeight,
    ascent: Math.max(1, size) * 0.78,
    descent: Math.max(1, size) * 0.22,
    source: "heuristic",
  }
}

function renderFontPreviewDataUrl(text: TextProps, width = 360, height = 82) {
  if (typeof document === "undefined") return undefined
  try {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx || typeof ctx.fillText !== "function" || typeof canvas.toDataURL !== "function") return undefined
    const plan = buildTypographyRenderPlan(text)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#15171c"
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = text.color
    ctx.font = plan.cssFont
    ctx.textBaseline = "middle"
    ctx.fontFeatureSettings = plan.fontFeatureSettings
    ctx.fontVariationSettings = plan.fontVariationSettings
    ctx.fontVariantCaps = plan.fontVariantCaps
    ctx.fontVariantLigatures = plan.fontVariantLigatures
    ctx.letterSpacing = plan.letterSpacing
    ctx.fillText(plan.content, 16, height / 2)
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  }
}

function textOpenTypeControls(text: TextProps): OpenTypeControls {
  return {
    ligatures: text.ligatures,
    discretionaryLigatures: text.discretionaryLigatures,
    contextualAlternates: text.contextualAlternates,
    stylisticAlternates: text.stylisticAlternates,
    swash: text.swash,
    ordinals: text.ordinals,
    fractions: text.fractions,
    superscript: text.superscript,
    subscript: text.subscript,
    slashedZero: text.slashedZero,
    smallCaps: text.smallCaps,
    oldstyleFigures: text.oldstyleFigures,
    tabularFigures: text.tabularFigures,
    ...text.openType,
  }
}

function antiAliasRenderHints(mode: TextAntiAliasMode): TypographyRenderPlan["renderHints"] {
  switch (mode) {
    case "none":
      return {
        mode,
        imageSmoothingEnabled: false,
        textRendering: "geometricPrecision",
        contrast: 1.16,
        pixelSnap: true,
      }
    case "sharp":
      return {
        mode,
        imageSmoothingEnabled: true,
        textRendering: "geometricPrecision",
        contrast: 1.2,
        pixelSnap: true,
      }
    case "crisp":
      return {
        mode,
        imageSmoothingEnabled: true,
        textRendering: "optimizeSpeed",
        contrast: 1.1,
        pixelSnap: true,
      }
    case "strong":
      return {
        mode,
        imageSmoothingEnabled: true,
        textRendering: "optimizeLegibility",
        contrast: 1.32,
        pixelSnap: false,
      }
    case "smooth":
    default:
      return {
        mode: "smooth",
        imageSmoothingEnabled: true,
        textRendering: "optimizeLegibility",
        contrast: 1,
        pixelSnap: false,
      }
  }
}

function axisDefinitionsFor(values: Record<string, number> | undefined, definitions?: TypographyAxisDefinition[]) {
  if (definitions?.length) return definitions
  const tags = Object.keys(values ?? {})
  if (!tags.length) return []
  const known = DEFAULT_VARIABLE_AXIS_DEFINITIONS.filter((axis) => tags.includes(axis.tag))
  const custom = tags
    .filter((tag) => !known.some((axis) => axis.tag === tag))
    .map((tag) => ({ tag, name: tag.toUpperCase(), min: -1000, max: 1000, defaultValue: values?.[tag] ?? 0 }))
  return [...known, ...custom]
}

export function normalizeVariableAxes(
  values: Record<string, number> | undefined,
  definitions: TypographyAxisDefinition[] = DEFAULT_VARIABLE_AXIS_DEFINITIONS,
) {
  const normalized: Record<string, number> = {}
  const seen = new Set<string>()
  const includeUnknownAxes = arguments.length < 2
  for (const axis of definitions) {
    if (!axis.tag.trim()) continue
    const requested = Number(values?.[axis.tag])
    normalized[axis.tag] = clamp(Number.isFinite(requested) ? requested : axis.defaultValue, axis.min, axis.max)
    seen.add(axis.tag)
  }
  if (includeUnknownAxes) {
    for (const [tag, value] of Object.entries(values ?? {})) {
      if (seen.has(tag) || !Number.isFinite(value)) continue
      normalized[tag] = value
    }
  }
  return normalized
}

export function serializeVariableAxes(values: Record<string, number> | undefined, definitions?: TypographyAxisDefinition[]) {
  const normalized = normalizeVariableAxes(values, axisDefinitionsFor(values, definitions))
  return Object.keys(normalized)
    .sort(compareAxisOrder)
    .map((tag) => `"${tag}" ${formatAxisValue(normalized[tag])}`)
    .join(", ")
}

export function buildOpenTypeFeatureSettings(controls: OpenTypeControls = {}) {
  const ligatures = controls.ligatures !== false
  const features: Array<[string, boolean]> = [
    ["liga", ligatures],
    ["clig", ligatures],
    ["dlig", !!controls.discretionaryLigatures],
    ["calt", controls.contextualAlternates !== false],
    ["salt", !!controls.stylisticAlternates],
    ["swsh", !!controls.swash],
    ["ordn", !!controls.ordinals],
    ["frac", !!controls.fractions],
    ["sups", !!controls.superscript],
    ["subs", !!controls.subscript],
    ["zero", !!controls.slashedZero],
    ["smcp", !!controls.smallCaps],
    ["onum", !!controls.oldstyleFigures],
    ["tnum", !!controls.tabularFigures],
  ]
  return features.map(([tag, enabled]) => `"${tag}" ${enabled ? 1 : 0}`).join(", ")
}

export function listOpenTypeFeatureToggles(options: { supportedTags?: Set<string> | string[] } = {}) {
  const supported = Array.isArray(options.supportedTags)
    ? new Set(options.supportedTags)
    : options.supportedTags
  if (!supported) return OPEN_TYPE_FEATURE_TOGGLES.map((toggle) => ({ ...toggle }))
  return OPEN_TYPE_FEATURE_TOGGLES
    .filter((toggle) => supported.has(toggle.tag))
    .map((toggle) => ({ ...toggle }))
}

function cssSupportsOpenTypeTag(tag: string) {
  const css = (globalThis as typeof globalThis & { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS
  if (!css?.supports) return true
  try {
    return css.supports("font-feature-settings", `"${tag}" 1`)
  } catch {
    return true
  }
}

function browserFontCheck(font: string) {
  if (typeof document === "undefined" || !("fonts" in document)) return true
  try {
    return document.fonts.check(`16px ${fontFamilyList(font)}`)
  } catch {
    return true
  }
}

function canvasFeatureDiffers(font: string, tag: string) {
  if (typeof document === "undefined") return undefined
  try {
    const sample = OPEN_TYPE_FEATURE_SAMPLES[tag] ?? "Hamburgefonts 123"
    const canvas = document.createElement("canvas")
    canvas.width = 240
    canvas.height = 48
    const ctx = canvas.getContext("2d")
    if (!ctx || typeof ctx.fillText !== "function" || typeof ctx.getImageData !== "function") return undefined
    const draw = (feature: string) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#ffffff"
      ctx.font = `28px ${fontFamilyList(font)}`
      ctx.fontFeatureSettings = feature
      ctx.fillText(sample, 6, 34)
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const off = draw("normal")
    const on = draw(`"${tag}" 1`)
    for (let i = 0; i < off.length; i += 4) {
      if (off[i + 3] !== on[i + 3] || off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) return true
    }
    return false
  } catch {
    return undefined
  }
}

export function detectOpenTypeFeatureSupport(
  font: string,
  options: { embeddedFont?: TypographyEmbeddedFont; fontData?: ArrayBuffer } = {},
): OpenTypeFeatureSupport {
  const browserSupportedTags = new Set(OPEN_TYPE_FEATURE_TOGGLES.filter((toggle) => cssSupportsOpenTypeTag(toggle.tag)).map((toggle) => toggle.tag))
  const fontData = options.fontData ?? (options.embeddedFont ? embeddedFontToArrayBuffer(options.embeddedFont) : undefined)
  if (fontData) {
    const metadata = parseOpenTypeFontMetadata(fontData)
    if (metadata.featureTags.length) {
      return {
        fontAvailable: true,
        supportedTags: new Set(metadata.featureTags),
        browserSupportedTags,
        source: "embedded-font",
      }
    }
  }
  const fontAvailable = browserFontCheck(font)
  const supportedTags = new Set<string>()
  for (const tag of browserSupportedTags) {
    const differs = fontAvailable ? canvasFeatureDiffers(font, tag) : undefined
    if (differs !== false) supportedTags.add(tag)
  }
  return { fontAvailable, supportedTags, browserSupportedTags, source: fontAvailable ? "browser" : "fallback" }
}

export function buildCanvasFont(text: TextProps) {
  const axes = normalizeVariableAxes(text.variableAxes, axisDefinitionsFor(text.variableAxes, text.variableAxisDefinitions))
  const axisWeight = axes.wght
  const weight = Number.isFinite(axisWeight)
    ? Math.round(axisWeight)
    : text.weight === "bold"
      ? 700
      : 400
  return `${text.italic ? "italic " : ""}${weight} ${Math.max(1, text.size)}px ${quoteFontFamily(text.font)}`
}

export function buildTypographyRenderPlan(text: TextProps): TypographyRenderPlan {
  const controls = textOpenTypeControls(text)
  const mode: TextAntiAliasMode = text.antiAlias === false ? "none" : text.antiAliasMode ?? "smooth"
  const axes = normalizeVariableAxes(text.variableAxes, axisDefinitionsFor(text.variableAxes, text.variableAxisDefinitions))
  const trackingPx = ((text.tracking ?? 0) / 1000) * text.size
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  const lineHeight = text.leading ?? text.size * 1.2

  return {
    cssFont: buildCanvasFont(text),
    content,
    fontFeatureSettings: buildOpenTypeFeatureSettings(controls),
    fontVariationSettings: Object.keys(axes).length ? serializeVariableAxes(axes, axisDefinitionsFor(axes, text.variableAxisDefinitions)) : "",
    fontKerning: text.kerning === "optical" ? "normal" : text.kerning === "metrics" || text.kerning === undefined ? "auto" : "none",
    fontVariantCaps: controls.smallCaps ? "small-caps" : "normal",
    fontVariantLigatures: controls.ligatures === false ? "none" : "normal",
    writingMode: text.vertical ? (text.verticalWritingMode === "lr" ? "vertical-lr" : "vertical-rl") : "horizontal-tb",
    textOrientation: text.vertical ? text.textOrientation ?? (text.tateChuYoko ? "mixed" : "upright") : "mixed",
    verticalAlign: text.verticalAlign ?? text.textShapeVerticalAlign ?? "top",
    letterSpacing: `${formatAxisValue(trackingPx)}px`,
    verticalMetrics: {
      columnGap: Math.max(0, text.verticalColumnGap ?? lineHeight),
      glyphSpacing: text.verticalGlyphSpacing ?? 0,
      glyphScale: clamp(text.verticalGlyphScale ?? 1, 0.1, 4),
      proportional: text.verticalUseProportionalMetrics === true,
    },
    renderHints: antiAliasRenderHints(mode),
    shaping: shapeTextWithEmbeddedFont(text) ?? fallbackShapingPlan(text),
  }
}

export function buildFontPreview(
  font: string,
  sample = "Hamburgefonts 123",
  options: {
    size?: number
    weight?: TextProps["weight"]
    italic?: boolean
    color?: string
    variableAxes?: Record<string, number>
    variableAxisDefinitions?: TypographyAxisDefinition[]
  } = {},
) {
  const text: TextProps = {
    content: sample,
    font,
    size: options.size ?? 28,
    weight: options.weight ?? "normal",
    italic: options.italic ?? false,
    color: options.color ?? "#ffffff",
    align: "left",
    x: 0,
    y: 0,
    variableAxes: options.variableAxes,
    variableAxisDefinitions: options.variableAxisDefinitions,
  }
  const plan = buildTypographyRenderPlan(text)
  return {
    family: font,
    sample,
    cssFont: plan.cssFont,
    fontVariationSettings: plan.fontVariationSettings,
    fontFeatureSettings: plan.fontFeatureSettings,
    geometry: measureFontGeometry(text, sample),
    canvasDataUrl: renderFontPreviewDataUrl(text),
    previewStyle: {
      fontFamily: fontFamilyList(font),
      fontSize: `${text.size}px`,
      fontVariationSettings: plan.fontVariationSettings,
      fontFeatureSettings: plan.fontFeatureSettings,
      color: text.color,
    },
  }
}

function uniqueFonts(fonts: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const font of fonts) {
    const name = font.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    result.push(name)
  }
  return result
}

export function buildFontSpecimens(
  options: {
    sample?: string
    size?: number
    color?: string
    systemFonts?: readonly string[]
    webFonts?: readonly FontCandidate[]
    candidateFonts?: readonly FontCandidate[]
  } = {},
): FontSpecimen[] {
  const sample = options.sample ?? "The quick brown fox 12345"
  const systemFonts = uniqueFonts(options.systemFonts ?? ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana"])
  const webFonts = options.webFonts ?? WEB_SAFE_FONT_CANDIDATES.filter((font) => font.variableAxes?.length)
  const candidateFonts = options.candidateFonts ?? []
  const specimens: FontSpecimen[] = []

  for (const family of systemFonts) {
    specimens.push({ ...buildFontPreview(family, sample, { size: options.size ?? 20, color: options.color }), source: "system" })
  }
  for (const candidate of webFonts) {
    specimens.push({
      ...buildFontPreview(candidate.family, sample, {
        size: options.size ?? 20,
        color: options.color,
        variableAxes: candidate.variableAxes?.length
          ? Object.fromEntries(candidate.variableAxes.map((axis) => [axis.tag, axis.defaultValue]))
          : undefined,
        variableAxisDefinitions: candidate.variableAxes,
      }),
      source: "web",
    })
  }
  for (const candidate of candidateFonts) {
    specimens.push({
      ...buildFontPreview(candidate.family, sample, {
        size: options.size ?? 20,
        color: options.color,
        variableAxisDefinitions: candidate.variableAxes,
      }),
      source: "candidate",
    })
  }

  return specimens
}

export function buildFontSubstitutionComparison(
  originalFont: string,
  fallbackFont: string,
  sample = "The quick brown fox 12345",
  options: {
    size?: number
    color?: string
    systemFonts?: readonly string[]
    webFonts?: readonly FontCandidate[]
    candidateFonts?: readonly FontCandidate[]
  } = {},
): FontSubstitutionComparison {
  const original = buildFontPreview(originalFont, sample, { size: options.size ?? 24, color: options.color })
  const fallback = buildFontPreview(fallbackFont, sample, { size: options.size ?? 24, color: options.color })
  return {
    original,
    fallback,
    specimens: buildFontSpecimens({ ...options, sample, size: options.size ?? 18 }),
    geometryDelta: {
      sampleWidth: fallback.geometry.sampleWidth - original.geometry.sampleWidth,
      averageGlyphWidth: fallback.geometry.averageGlyphWidth - original.geometry.averageGlyphWidth,
      xHeight: fallback.geometry.xHeight - original.geometry.xHeight,
    },
  }
}

function readTag(data: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > data.length) return ""
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
}

function fixed16(view: DataView, offset: number) {
  return view.getInt32(offset, false) / 65536
}

function decodeNameString(bytes: Uint8Array, platformId: number, offset: number, length: number) {
  if (offset < 0 || length <= 0 || offset + length > bytes.length) return ""
  const slice = bytes.subarray(offset, offset + length)
  if (platformId === 0 || platformId === 3) {
    let value = ""
    for (let i = 0; i + 1 < slice.length; i += 2) {
      const code = (slice[i] << 8) | slice[i + 1]
      if (code) value += String.fromCharCode(code)
    }
    return value.trim()
  }
  return Array.from(slice, (code) => String.fromCharCode(code)).join("").trim()
}

function parseNameTable(data: Uint8Array, view: DataView, offset: number, length: number) {
  const names = new Map<number, string>()
  const tableEnd = offset + length
  if (offset < 0 || tableEnd > data.length || length < 6) return names
  const count = view.getUint16(offset + 2, false)
  const stringOffset = view.getUint16(offset + 4, false)
  const recordsEnd = offset + 6 + count * 12
  if (recordsEnd > tableEnd) return names
  const scores = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const record = offset + 6 + i * 12
    const platformId = view.getUint16(record, false)
    const languageId = view.getUint16(record + 4, false)
    const nameId = view.getUint16(record + 6, false)
    const stringLength = view.getUint16(record + 8, false)
    const localOffset = view.getUint16(record + 10, false)
    const absoluteOffset = offset + stringOffset + localOffset
    const value = decodeNameString(data, platformId, absoluteOffset, stringLength)
    if (!value) continue
    const score = platformId === 3 && languageId === 0x0409 ? 0 : platformId === 3 ? 1 : 2
    if (!names.has(nameId) || score < (scores.get(nameId) ?? 99)) {
      names.set(nameId, value)
      scores.set(nameId, score)
    }
  }
  return names
}

function sfntTables(buffer: ArrayBuffer) {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const tables = new Map<string, { offset: number; length: number }>()
  if (data.length < 12) return { data, view, tables }
  const tableCount = view.getUint16(4, false)
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    if (record + 16 > data.length) break
    const tag = readTag(data, record)
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    if (offset >= 0 && length >= 0 && offset + length <= data.length) tables.set(tag, { offset, length })
  }
  return { data, view, tables }
}

function detectSfntFormat(buffer: ArrayBuffer): TypographyEmbeddedFont["format"] {
  const data = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  const tag = data.length === 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ""
  if (tag === "wOFF") return "woff"
  if (tag === "wOF2") return "woff2"
  if (tag === "OTTO") return "otf"
  if (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0) return "ttf"
  return "unknown"
}

function parseLayoutFeatureTags(data: Uint8Array, view: DataView, table: { offset: number; length: number } | undefined) {
  const tags: string[] = []
  if (!table || table.length < 10) return tags
  const tableEnd = table.offset + table.length
  const featureListOffset = view.getUint16(table.offset + 6, false)
  const featureList = table.offset + featureListOffset
  if (featureList < table.offset || featureList + 2 > tableEnd) return tags
  const count = view.getUint16(featureList, false)
  const recordsEnd = featureList + 2 + count * 6
  if (recordsEnd > tableEnd) return tags
  for (let i = 0; i < count; i++) {
    const record = featureList + 2 + i * 6
    const tag = readTag(data, record)
    if (/^[A-Za-z0-9 ]{4}$/.test(tag) && tag.trim()) tags.push(tag)
  }
  return tags
}

export function parseOpenTypeFontMetadata(buffer: ArrayBuffer): OpenTypeFontMetadata {
  const { data, view, tables } = sfntTables(buffer)
  const variable = parseVariableFontMetadata(buffer)
  const head = tables.get("head")
  const maxp = tables.get("maxp")
  const name = tables.get("name")
  const names = name ? parseNameTable(data, view, name.offset, name.length) : new Map<number, string>()
  const featureTags = [...new Set([
    ...parseLayoutFeatureTags(data, view, tables.get("GSUB")),
    ...parseLayoutFeatureTags(data, view, tables.get("GPOS")),
  ])].sort()
  return {
    ...variable,
    format: detectSfntFormat(buffer),
    unitsPerEm: head && head.length >= 20 ? view.getUint16(head.offset + 18, false) : undefined,
    glyphCount: maxp && maxp.length >= 6 ? view.getUint16(maxp.offset + 4, false) : undefined,
    featureTags,
    familyNames: [names.get(1), names.get(4), names.get(6)].filter((value): value is string => !!value),
  }
}

interface ParsedGlyphPoint {
  x: number
  y: number
  onCurve: boolean
}

interface ParsedOpenTypeFont {
  unitsPerEm: number
  ascent: number
  descent: number
  glyphCount: number
  indexToLocFormat: number
  numLongMetrics: number
  tables: Map<string, { offset: number; length: number }>
  data: Uint8Array
  view: DataView
  cmap: Map<number, number>
  hMetrics: Array<{ advanceWidth: number; leftSideBearing: number }>
}

function parseCmapFormat4(data: Uint8Array, view: DataView, offset: number, length: number) {
  const map = new Map<number, number>()
  const end = offset + length
  if (offset + 16 > data.length || end > data.length) return map
  const segCount = view.getUint16(offset + 6, false) / 2
  if (!Number.isFinite(segCount) || segCount <= 0) return map
  const endCode = offset + 14
  const startCode = endCode + segCount * 2 + 2
  const idDelta = startCode + segCount * 2
  const idRangeOffset = idDelta + segCount * 2
  if (idRangeOffset + segCount * 2 > end) return map
  for (let i = 0; i < segCount; i++) {
    const start = view.getUint16(startCode + i * 2, false)
    const stop = view.getUint16(endCode + i * 2, false)
    if (start === 0xffff && stop === 0xffff) continue
    if (stop < start || stop - start > 4096) continue
    const delta = view.getInt16(idDelta + i * 2, false)
    const rangeOffsetPosition = idRangeOffset + i * 2
    const rangeOffset = view.getUint16(rangeOffsetPosition, false)
    for (let code = start; code <= stop; code++) {
      let glyphId = 0
      if (rangeOffset === 0) {
        glyphId = (code + delta) & 0xffff
      } else {
        const glyphOffset = rangeOffsetPosition + rangeOffset + (code - start) * 2
        if (glyphOffset + 2 > end) continue
        glyphId = view.getUint16(glyphOffset, false)
        if (glyphId) glyphId = (glyphId + delta) & 0xffff
      }
      if (glyphId) map.set(code, glyphId)
    }
  }
  return map
}

function parseFontCmap(data: Uint8Array, view: DataView, table: { offset: number; length: number } | undefined) {
  const empty = new Map<number, number>()
  if (!table || table.length < 4) return empty
  const tableEnd = table.offset + table.length
  const count = view.getUint16(table.offset + 2, false)
  let fallback: Map<number, number> | null = null
  for (let i = 0; i < count; i++) {
    const record = table.offset + 4 + i * 8
    if (record + 8 > tableEnd) break
    const platform = view.getUint16(record, false)
    const encoding = view.getUint16(record + 2, false)
    const subOffset = table.offset + view.getUint32(record + 4, false)
    if (subOffset + 2 > tableEnd) continue
    const format = view.getUint16(subOffset, false)
    const length = format === 4 ? view.getUint16(subOffset + 2, false) : 0
    if (format !== 4 || subOffset + length > tableEnd) continue
    const parsed = parseCmapFormat4(data, view, subOffset, length)
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) return parsed
    fallback = fallback ?? parsed
  }
  return fallback ?? empty
}

function parseOpenTypeFont(buffer: ArrayBuffer): ParsedOpenTypeFont | null {
  const { data, view, tables } = sfntTables(buffer)
  const head = tables.get("head")
  const hhea = tables.get("hhea")
  const hmtx = tables.get("hmtx")
  const maxp = tables.get("maxp")
  const cmap = tables.get("cmap")
  if (!head || !hhea || !hmtx || !maxp || !cmap) return null
  if (head.length < 54 || hhea.length < 36 || maxp.length < 6) return null
  const glyphCount = view.getUint16(maxp.offset + 4, false)
  const numLongMetrics = view.getUint16(hhea.offset + 34, false)
  const hMetrics: ParsedOpenTypeFont["hMetrics"] = []
  for (let i = 0; i < Math.max(1, numLongMetrics); i++) {
    const offset = hmtx.offset + i * 4
    if (offset + 4 > hmtx.offset + hmtx.length) break
    hMetrics.push({
      advanceWidth: view.getUint16(offset, false),
      leftSideBearing: view.getInt16(offset + 2, false),
    })
  }
  return {
    unitsPerEm: Math.max(1, view.getUint16(head.offset + 18, false)),
    ascent: view.getInt16(hhea.offset + 4, false),
    descent: view.getInt16(hhea.offset + 6, false),
    glyphCount,
    indexToLocFormat: view.getInt16(head.offset + 50, false),
    numLongMetrics,
    tables,
    data,
    view,
    cmap: parseFontCmap(data, view, cmap),
    hMetrics,
  }
}

function glyphMetric(font: ParsedOpenTypeFont, glyphId: number) {
  if (font.hMetrics[glyphId]) return font.hMetrics[glyphId]
  return font.hMetrics[font.hMetrics.length - 1] ?? { advanceWidth: font.unitsPerEm * 0.6, leftSideBearing: 0 }
}

function glyphOffset(font: ParsedOpenTypeFont, glyphId: number) {
  const loca = font.tables.get("loca")
  const glyf = font.tables.get("glyf")
  if (!loca || !glyf || glyphId < 0 || glyphId > font.glyphCount) return null
  if (font.indexToLocFormat === 0) {
    const position = loca.offset + glyphId * 2
    if (position + 4 > loca.offset + loca.length) return null
    return {
      start: glyf.offset + font.view.getUint16(position, false) * 2,
      end: glyf.offset + font.view.getUint16(position + 2, false) * 2,
    }
  }
  const position = loca.offset + glyphId * 4
  if (position + 8 > loca.offset + loca.length) return null
  return {
    start: glyf.offset + font.view.getUint32(position, false),
    end: glyf.offset + font.view.getUint32(position + 4, false),
  }
}

function parseSimpleGlyph(font: ParsedOpenTypeFont, glyphId: number): ParsedGlyphPoint[][] {
  const location = glyphOffset(font, glyphId)
  if (!location || location.end <= location.start || location.end > font.data.length) return []
  const view = font.view
  const start = location.start
  const contourCount = view.getInt16(start, false)
  if (contourCount <= 0) return []
  const endPts: number[] = []
  for (let i = 0; i < contourCount; i++) endPts.push(view.getUint16(start + 10 + i * 2, false))
  const pointCount = (endPts[endPts.length - 1] ?? -1) + 1
  if (pointCount <= 0) return []
  let offset = start + 10 + contourCount * 2
  const instructionLength = view.getUint16(offset, false)
  offset += 2 + instructionLength
  const flags: number[] = []
  while (flags.length < pointCount && offset < location.end) {
    const flag = font.data[offset++]
    flags.push(flag)
    if (flag & 0x08) {
      const repeat = font.data[offset++] ?? 0
      for (let i = 0; i < repeat; i++) flags.push(flag)
    }
  }
  const xs: number[] = []
  let x = 0
  for (let i = 0; i < pointCount; i++) {
    const flag = flags[i] ?? 0
    if (flag & 0x02) {
      const dx = font.data[offset++] ?? 0
      x += flag & 0x10 ? dx : -dx
    } else if (!(flag & 0x10)) {
      x += view.getInt16(offset, false)
      offset += 2
    }
    xs.push(x)
  }
  const ys: number[] = []
  let y = 0
  for (let i = 0; i < pointCount; i++) {
    const flag = flags[i] ?? 0
    if (flag & 0x04) {
      const dy = font.data[offset++] ?? 0
      y += flag & 0x20 ? dy : -dy
    } else if (!(flag & 0x20)) {
      y += view.getInt16(offset, false)
      offset += 2
    }
    ys.push(y)
  }
  const contours: ParsedGlyphPoint[][] = []
  let cursor = 0
  for (const endPoint of endPts) {
    const contour: ParsedGlyphPoint[] = []
    for (let i = cursor; i <= endPoint; i++) {
      contour.push({ x: xs[i], y: ys[i], onCurve: !!(flags[i] & 0x01) })
    }
    if (contour.length) contours.push(contour)
    cursor = endPoint + 1
  }
  return contours
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

function convertGlyphContourToPath(
  contour: ParsedGlyphPoint[],
  transform: (point: { x: number; y: number }) => { x: number; y: number },
): PathProps | null {
  if (!contour.length) return null
  const expanded: ParsedGlyphPoint[] = []
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i]
    const next = contour[(i + 1) % contour.length]
    expanded.push(current)
    if (!current.onCurve && !next.onCurve) {
      expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, onCurve: true })
    }
  }
  const firstOn = expanded.findIndex((point) => point.onCurve)
  if (firstOn < 0) return null
  const points = [...expanded.slice(firstOn), ...expanded.slice(0, firstOn)]
  const first = transform(points[0])
  const pathPoints: PathPoint[] = [{ x: first.x, y: first.y }]
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point.onCurve) {
      const target = transform(point)
      if (!samePoint(target, pathPoints[pathPoints.length - 1])) pathPoints.push({ x: target.x, y: target.y })
      continue
    }
    const next = points[(i + 1) % points.length]
    const endSource = next.onCurve ? next : { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, onCurve: true }
    const startPoint = pathPoints[pathPoints.length - 1]
    const control = transform(point)
    const end = transform(endSource)
    startPoint.cp2 = {
      x: startPoint.x + (control.x - startPoint.x) * 2 / 3,
      y: startPoint.y + (control.y - startPoint.y) * 2 / 3,
    }
    const cubicEnd = {
      x: end.x,
      y: end.y,
      cp1: {
        x: end.x + (control.x - end.x) * 2 / 3,
        y: end.y + (control.y - end.y) * 2 / 3,
      },
    }
    if (samePoint(cubicEnd, pathPoints[0])) {
      pathPoints[0].cp1 = cubicEnd.cp1
    } else {
      pathPoints.push(cubicEnd)
    }
    if (next.onCurve) i += 1
  }
  if (pathPoints.length > 1 && samePoint(pathPoints[0], pathPoints[pathPoints.length - 1])) pathPoints.pop()
  return { points: pathPoints, closed: true, source: "font-outline" }
}

function embeddedFontForText(text: TextProps): ParsedOpenTypeFont | null {
  if (!text.embeddedFont) return null
  const bytes = embeddedFontToArrayBuffer(text.embeddedFont)
  return parseOpenTypeFont(bytes)
}

function shapeTextWithEmbeddedFont(text: TextProps): TypographyShapingPlan | null {
  const font = embeddedFontForText(text)
  if (!font) return null
  const scale = Math.max(1, text.size) / font.unitsPerEm
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  const trackingPx = ((text.tracking ?? 0) / 1000) * text.size
  const glyphRun: TypographyGlyphRunItem[] = []
  let cursor = 0
  for (const char of content) {
    if (char === "\n") continue
    const glyphId = font.cmap.get(char.codePointAt(0) ?? 0) ?? 0
    const advance = glyphMetric(font, glyphId).advanceWidth * scale + trackingPx
    glyphRun.push({ char, glyphId, x: cursor, y: 0, advance })
    cursor += advance
  }
  return {
    engine: "embedded-opentype",
    compatibility: "photoshop-compatible",
    glyphRun,
    advanceWidth: cursor,
    source: "font-bytes",
    notes: [
      "Shaping uses embedded OpenType cmap/hmtx/glyf data for deterministic browser-local metrics.",
      "Photoshop private CoolType hinting is not available, so raster antialiasing still follows the browser canvas.",
    ],
  }
}

function fallbackShapingPlan(text: TextProps): TypographyShapingPlan {
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  let cursor = 0
  const glyphRun: TypographyGlyphRunItem[] = []
  for (const char of content) {
    if (char === "\n") continue
    const advance = glyphAdvance(text, char)
    glyphRun.push({ char, glyphId: 0, x: cursor, y: 0, advance })
    cursor += advance
  }
  return {
    engine: "browser-canvas",
    compatibility: "browser-native",
    glyphRun,
    advanceWidth: cursor,
    source: "browser",
    notes: ["No embedded font bytes are attached; shaping uses browser canvas metrics and app fallback advances."],
  }
}

export function parseVariableFontMetadata(buffer: ArrayBuffer): VariableFontMetadata {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (data.length < 12) return { axes: [], namedInstances: [] }
  const tableCount = view.getUint16(4, false)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    if (record + 16 > data.length) break
    const tag = readTag(data, record)
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    if (offset + length <= data.length) tables.set(tag, { offset, length })
  }

  const fvar = tables.get("fvar")
  if (!fvar || fvar.length < 16) return { axes: [], namedInstances: [] }
  const name = tables.get("name")
  const names = name ? parseNameTable(data, view, name.offset, name.length) : new Map<number, string>()
  const axisOffset = fvar.offset + view.getUint16(fvar.offset + 4, false)
  const axisCount = view.getUint16(fvar.offset + 8, false)
  const axisSize = view.getUint16(fvar.offset + 10, false)
  const instanceCount = view.getUint16(fvar.offset + 12, false)
  const instanceSize = view.getUint16(fvar.offset + 14, false)
  if (axisSize < 20 || axisOffset + axisCount * axisSize > fvar.offset + fvar.length) {
    return { axes: [], namedInstances: [] }
  }

  const axes: TypographyAxisDefinition[] = []
  for (let i = 0; i < axisCount; i++) {
    const record = axisOffset + i * axisSize
    const tag = readTag(data, record)
    if (!tag.trim()) continue
    const nameId = view.getUint16(record + 18, false)
    axes.push({
      tag,
      name: names.get(nameId) ?? tag.toUpperCase(),
      min: fixed16(view, record + 4),
      defaultValue: fixed16(view, record + 8),
      max: fixed16(view, record + 12),
    })
  }

  const namedInstances: TypographyNamedInstance[] = []
  const instanceOffset = axisOffset + axisCount * axisSize
  for (let i = 0; i < instanceCount; i++) {
    const record = instanceOffset + i * instanceSize
    if (record + 4 + axes.length * 4 > fvar.offset + fvar.length) break
    const nameId = view.getUint16(record, false)
    const coordinates: Record<string, number> = {}
    axes.forEach((axis, axisIndex) => {
      coordinates[axis.tag] = fixed16(view, record + 4 + axisIndex * 4)
    })
    namedInstances.push({ name: names.get(nameId) ?? `Instance ${i + 1}`, coordinates })
  }

  return { axes, namedInstances }
}

interface LocalFontAccessData {
  family: string
  fullName?: string
  postscriptName?: string
  style?: string
  blob?: () => Promise<Blob>
}

type QueryLocalFonts = (options?: { postscriptNames?: string[] }) => Promise<LocalFontAccessData[]>

export async function inspectVariableFont(
  fontFamily: string,
  options: { allowLocalFontAccess?: boolean; embeddedFont?: TypographyEmbeddedFont; fontData?: ArrayBuffer } = {},
): Promise<VariableFontInspection> {
  const fallback = WEB_SAFE_FONT_CANDIDATES.find((candidate) => candidate.family.toLowerCase() === fontFamily.toLowerCase())
  const fallbackAxes = fallback?.variableAxes ?? []
  const fontData = options.fontData ?? (options.embeddedFont ? embeddedFontToArrayBuffer(options.embeddedFont) : undefined)
  if (fontData) {
    const metadata = parseOpenTypeFontMetadata(fontData)
    return {
      family: fontFamily,
      source: "embedded-font",
      axes: metadata.axes,
      namedInstances: metadata.namedInstances,
    }
  }
  if (options.allowLocalFontAccess) {
    const root = globalThis as typeof globalThis & { queryLocalFonts?: QueryLocalFonts }
    try {
      const localFonts = root.queryLocalFonts ? await root.queryLocalFonts() : []
      const match = localFonts.find((font) =>
        [font.family, font.fullName, font.postscriptName]
          .filter(Boolean)
          .some((name) => String(name).toLowerCase() === fontFamily.toLowerCase()),
      )
      if (match?.blob) {
        const blob = await match.blob()
        const metadata = parseVariableFontMetadata(await blob.arrayBuffer())
        if (metadata.axes.length || metadata.namedInstances.length) {
          return { family: fontFamily, source: "font-access", ...metadata }
        }
      }
    } catch (error) {
      return {
        family: fontFamily,
        source: "fallback",
        axes: fallbackAxes,
        namedInstances: [],
        error: error instanceof Error ? error.message : "Unable to inspect local font",
      }
    }
  }

  return {
    family: fontFamily,
    source: fallbackAxes.length ? "font-face" : "fallback",
    axes: fallbackAxes,
    namedInstances: [],
  }
}

export function applyVariableFontNamedInstance(
  text: TextProps,
  instance: TypographyNamedInstance,
  axisDefinitions = text.variableAxisDefinitions,
): TextProps {
  return {
    ...text,
    variableAxes: normalizeVariableAxes(instance.coordinates, axisDefinitionsFor(instance.coordinates, axisDefinitions)),
    variableAxisDefinitions: axisDefinitions,
    variableNamedInstance: instance.name,
  }
}

function mergeAxisDefinitions(
  activeValues: Record<string, number> | undefined,
  definitions: readonly TypographyAxisDefinition[],
  customSource: VariableFontAxisControl["source"],
) {
  const controls: VariableFontAxisControl[] = definitions
    .filter((axis) => axis.tag.trim())
    .map((axis) => ({
      ...axis,
      value: clamp(Number(activeValues?.[axis.tag] ?? axis.defaultValue), axis.min, axis.max),
      source: customSource,
    }))
  const known = new Set(controls.map((axis) => axis.tag))
  for (const [tag, rawValue] of Object.entries(activeValues ?? {})) {
    if (known.has(tag) || !Number.isFinite(rawValue)) continue
    controls.push({
      tag,
      name: tag.toUpperCase(),
      min: Math.min(-1000, rawValue),
      max: Math.max(1000, rawValue),
      defaultValue: rawValue,
      value: rawValue,
      source: "custom",
    })
  }
  return controls.sort((a, b) => compareAxisOrder(a.tag, b.tag))
}

export function buildVariableFontAxisControlModel(
  text: TextProps,
  inspection?: VariableFontInspection | null,
): VariableFontAxisControlModel {
  const discovered = inspection?.axes ?? []
  const stored = text.variableAxisDefinitions ?? []
  const definitions = discovered.length ? discovered : stored.length ? stored : DEFAULT_VARIABLE_AXIS_DEFINITIONS
  const source: VariableFontAxisControlModel["source"] = discovered.length
    ? inspection?.source ?? "font-face"
    : stored.length
      ? "stored"
      : "default"
  const axisSource: VariableFontAxisControl["source"] = discovered.length
    ? "discovered"
    : stored.length
      ? "stored"
      : "default"
  const axes = mergeAxisDefinitions(text.variableAxes, definitions, axisSource)
  const namedInstances = (inspection?.namedInstances ?? []).map((instance) => ({
    ...instance,
    label: instance.name,
    summary: Object.entries(instance.coordinates)
      .sort(([a], [b]) => compareAxisOrder(a, b))
      .map(([tag, value]) => `${tag} ${formatAxisValue(value)}`)
      .join(", "),
  }))
  const discoveredCount = discovered.length
  const customCount = axes.filter((axis) => axis.source === "custom").length
  const sourceLabel =
    source === "embedded-font"
      ? "embedded font file"
      : source === "font-access"
      ? "local font file"
      : source === "font-face"
        ? "font metadata"
        : source === "stored"
          ? "stored layer metadata"
          : "default axis presets"
  const status = `${discoveredCount || axes.length} ${discoveredCount ? "discovered" : "available"} axes from ${sourceLabel}${customCount ? `, ${customCount} custom active axis${customCount === 1 ? "" : "es"}` : ""}`
  return {
    family: inspection?.family ?? text.font,
    source,
    axes,
    namedInstances,
    status,
    error: inspection?.error,
  }
}

function browserFontAvailable(font: string) {
  if (typeof document === "undefined" || !("fonts" in document)) return true
  try {
    return document.fonts.check(`16px ${quoteFontFamily(font)}`)
  } catch {
    return true
  }
}

export function diagnoseDocumentFonts(
  layers: readonly Layer[],
  options: { availableFonts?: Set<string>; fallbackFont?: string } = {},
): FontDiagnostics {
  const layersByFont: Record<string, string[]> = {}
  const diagnostics: FontDiagnostics["diagnostics"] = []
  const availableFonts: string[] = []
  const missingFonts: string[] = []
  const substitutions: Record<string, string> = {}
  const fallbackFont = options.fallbackFont ?? "Arial"

  for (const layer of layers) {
    if (!layer.text?.font) continue
    const font = layer.text.font
    layersByFont[font] = [...(layersByFont[font] ?? []), layer.id]
    const available = options.availableFonts ? options.availableFonts.has(font) : browserFontAvailable(font)
    if (available) {
      if (!availableFonts.includes(font)) availableFonts.push(font)
      diagnostics.push({ layerId: layer.id, layerName: layer.name, font, status: "available" })
    } else {
      if (!missingFonts.includes(font)) missingFonts.push(font)
      substitutions[font] = fallbackFont
      diagnostics.push({ layerId: layer.id, layerName: layer.name, font, status: "missing", substitute: fallbackFont })
    }
  }

  return { missingFonts, availableFonts, layersByFont, substitutions, diagnostics }
}

export function resolveFontSubstitutions(
  layers: readonly Layer[],
  options: {
    availableFonts?: Set<string>
    substitutions?: Record<string, string>
    fallbackFont?: string
  } = {},
): FontSubstitutionResult {
  const fallbackFont = options.fallbackFont ?? "Arial"
  const report = diagnoseDocumentFonts(layers, { availableFonts: options.availableFonts, fallbackFont })
  const substitutions = { ...report.substitutions, ...(options.substitutions ?? {}) }
  const changedLayerIds: string[] = []
  const nextLayers = layers.map((layer) => {
    if (!layer.text?.font) return layer
    const originalFont = layer.text.font
    const available = options.availableFonts ? options.availableFonts.has(originalFont) : browserFontAvailable(originalFont)
    if (available) return layer
    const substitute = substitutions[originalFont] ?? fallbackFont
    changedLayerIds.push(layer.id)
    return {
      ...layer,
      text: {
        ...layer.text,
        font: substitute,
        missingFontOriginal: originalFont,
        fontSubstitution: substitute,
      },
    }
  })
  return {
    layers: nextLayers,
    changedLayerIds,
    report: {
      ...report,
      substitutions,
      diagnostics: report.diagnostics.map((diagnostic) =>
        diagnostic.status === "missing"
          ? { ...diagnostic, substitute: substitutions[diagnostic.font] ?? fallbackFont }
          : diagnostic,
      ),
    },
  }
}

function inferTargetMetrics(text: TextProps) {
  const visibleChars = [...text.content.replace(/\s/g, "")].length || 1
  const targetWidth = text.boxWidth && text.boxWidth > 0
    ? text.boxWidth
    : visibleChars * text.size * (text.weight === "bold" ? 0.58 : 0.52)
  const averageGlyphWidth = clamp(targetWidth / visibleChars / Math.max(1, text.size), 0.25, 1.5)
  const xHeight = text.font.toLowerCase().includes("serif") ? 0.47 : 0.54
  const serifLikely = /\bserif\b|georgia|times|garamond|baskerville/i.test(text.font)
  return {
    averageGlyphWidth,
    xHeight,
    serifLikely,
    sampleWidth: targetWidth,
    source: text.boxWidth && text.boxWidth > 0 ? "layer-box" as const : "heuristic" as const,
  }
}

export function matchFontForLayer(text: TextProps, candidates: readonly FontCandidate[] = WEB_SAFE_FONT_CANDIDATES): MatchFontResult {
  const measuredTarget = measureFontGeometry(text, text.content || "Ag 123")
  const inferred = inferTargetMetrics(text)
  const target = {
    ...inferred,
    averageGlyphWidth: inferred.source === "layer-box" ? inferred.averageGlyphWidth : measuredTarget.averageGlyphWidth,
    xHeight: measuredTarget.source === "canvas" ? measuredTarget.xHeight : inferred.xHeight,
    sampleWidth: inferred.source === "layer-box" ? inferred.sampleWidth : measuredTarget.sampleWidth,
    source: inferred.source === "layer-box" ? "layer-box" as const : measuredTarget.source,
  }
  const ranked = candidates
    .map((candidate) => {
      const candidateText: TextProps = {
        ...text,
        font: candidate.family,
        variableAxisDefinitions: candidate.variableAxes,
        variableAxes: candidate.variableAxes?.length
          ? Object.fromEntries(candidate.variableAxes.map((axis) => [axis.tag, axis.defaultValue]))
          : undefined,
      }
      const measured = measureFontGeometry(candidateText, text.content || "Ag 123")
      const hasBuiltInCandidate = WEB_SAFE_FONT_CANDIDATES.some((font) => font.family.toLowerCase() === candidate.family.toLowerCase())
      const geometry = measured.source === "canvas" && hasBuiltInCandidate
        ? measured
        : metricFromCandidate(candidate, text.content || "Ag 123", text.size)
      const widthDiff = Math.abs(geometry.averageGlyphWidth - target.averageGlyphWidth)
      const xHeightDiff = Math.abs(geometry.xHeight - target.xHeight)
      const serifPenalty = candidate.serif === target.serifLikely ? 0 : 0.08
      const monospacePenalty = candidate.monospace && !/code|mono|number|table/i.test(text.content) ? 0.04 : 0
      const score = clamp(1 - widthDiff * 1.25 - xHeightDiff * 0.7 - serifPenalty - monospacePenalty, 0, 1)
      const reasons = [
        `width ${geometry.averageGlyphWidth.toFixed(2)} vs ${target.averageGlyphWidth.toFixed(2)}`,
        `x-height ${geometry.xHeight.toFixed(2)} vs ${target.xHeight.toFixed(2)}`,
      ]
      reasons.push(geometry.source === "canvas" ? "browser geometry" : "stored geometry")
      if (candidate.serif === target.serifLikely) reasons.push("style match")
      if (candidate.variableAxes?.length) reasons.push("variable font")
      return { ...candidate, score, reasons, geometry }
    })
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))

  return { best: ranked[0] ?? WEB_SAFE_FONT_CANDIDATES[0], candidates: ranked, target }
}

function imagePixelInk(data: Uint8ClampedArray, index: number) {
  const alpha = data[index + 3] / 255
  if (alpha <= 0.05) return 0
  const luminance = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255
  return alpha * (1 - luminance)
}

function estimateGlyphCountFromInkColumns(image: ImageData, bounds: { x: number; y: number; w: number; h: number }, fallbackText?: string) {
  const expected = fallbackText ? [...fallbackText.replace(/\s/g, "")].length : 0
  if (expected > 0) return expected
  let runs = 0
  let inRun = false
  for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
    let columnInk = 0
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      columnInk += imagePixelInk(image.data, (y * image.width + x) * 4)
    }
    const active = columnInk > bounds.h * 0.04
    if (active && !inRun) runs += 1
    inRun = active
  }
  return Math.max(1, runs)
}

function recognizeFontImage(image: ImageData, options: { expectedText?: string; fontSize?: number } = {}) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  let ink = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const amount = imagePixelInk(image.data, (y * image.width + x) * 4)
      if (amount <= 0.08) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      ink += amount
    }
  }
  if (maxX < minX || maxY < minY) {
    return {
      bounds: { x: 0, y: 0, w: 1, h: 1 },
      glyphCount: 1,
      density: 0,
      serifLikely: false,
      fontSize: Math.max(1, options.fontSize ?? (image.height || 1)),
      confidence: 0,
    }
  }
  const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  const glyphCount = estimateGlyphCountFromInkColumns(image, bounds, options.expectedText)
  const density = ink / Math.max(1, bounds.w * bounds.h)
  let edgeInk = 0
  let centerInk = 0
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const amount = imagePixelInk(image.data, (y * image.width + x) * 4)
      const local = (x - bounds.x) / Math.max(1, bounds.w - 1)
      if (local < 0.12 || local > 0.88) edgeInk += amount
      if (local > 0.42 && local < 0.58) centerInk += amount
    }
  }
  const serifLikely = edgeInk > centerInk * 1.35 && density < 0.55
  return {
    bounds,
    glyphCount,
    density,
    serifLikely,
    fontSize: Math.max(1, options.fontSize ?? bounds.h),
    confidence: clamp(0.35 + density * 0.8 + Math.min(0.25, bounds.w / Math.max(1, image.width) * 0.25), 0, 0.98),
  }
}

export function matchFontFromImageData(
  image: ImageData,
  options: {
    expectedText?: string
    fontSize?: number
    candidates?: readonly FontCandidate[]
  } = {},
): MatchFontImageResult {
  const recognition = recognizeFontImage(image, options)
  const sample = options.expectedText ?? "Image text"
  const target = {
    averageGlyphWidth: clamp(recognition.bounds.w / Math.max(1, recognition.glyphCount) / recognition.fontSize, 0.15, 2),
    xHeight: clamp(recognition.bounds.h / recognition.fontSize, 0.2, 1.4),
    serifLikely: recognition.serifLikely,
    sampleWidth: recognition.bounds.w,
    source: "image-recognition" as const,
  }
  const candidates = options.candidates ?? WEB_SAFE_FONT_CANDIDATES
  const ranked = candidates
    .map((candidate) => {
      const geometry = metricFromCandidate(candidate, sample, recognition.fontSize)
      const widthDiff = Math.abs(candidate.averageGlyphWidth - target.averageGlyphWidth)
      const xHeightDiff = Math.abs(candidate.xHeight - target.xHeight)
      const serifPenalty = candidate.serif === target.serifLikely ? 0 : 0.08
      const monospacePenalty = candidate.monospace && recognition.glyphCount > 1 ? 0.03 : 0
      const densityPenalty = recognition.density > 0.62 && candidate.serif ? 0.06 : 0
      const score = clamp(1 - widthDiff * 1.35 - xHeightDiff * 0.75 - serifPenalty - monospacePenalty - densityPenalty, 0, 1)
      return {
        ...candidate,
        score,
        geometry: { ...geometry, source: "image-recognition" as const },
        reasons: [
          `width ${candidate.averageGlyphWidth.toFixed(2)} vs ${target.averageGlyphWidth.toFixed(2)}`,
          `x-height ${candidate.xHeight.toFixed(2)} vs ${target.xHeight.toFixed(2)}`,
          "image model",
        ],
      }
    })
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))
  return {
    best: ranked[0] ?? WEB_SAFE_FONT_CANDIDATES[0],
    candidates: ranked,
    target,
    recognition: {
      source: "image-model",
      confidence: recognition.confidence * (ranked[0]?.score ?? 0),
      glyphCount: recognition.glyphCount,
      bounds: recognition.bounds,
      density: recognition.density,
      serifLikely: recognition.serifLikely,
    },
  }
}

export function buildFindReplaceHighlights(
  layers: readonly Layer[],
  matches: FindReplaceResult["matches"],
): FindReplaceHighlightGroup[] {
  const byLayer = new Map<string, FindReplaceResult["matches"]>()
  for (const match of matches) {
    const current = byLayer.get(match.layerId) ?? []
    current.push(match)
    byLayer.set(match.layerId, current)
  }

  const groups: FindReplaceHighlightGroup[] = []
  for (const layer of layers) {
    if (!layer.text) continue
    const layerMatches = (byLayer.get(layer.id) ?? []).slice().sort((a, b) => a.index - b.index || b.length - a.length)
    if (!layerMatches.length) continue
    const segments: FindReplaceHighlightSegment[] = []
    let cursor = 0
    layerMatches.forEach((match, matchIndex) => {
      const start = Math.max(cursor, Math.min(layer.text!.content.length, match.index))
      const end = Math.max(start, Math.min(layer.text!.content.length, match.index + match.length))
      if (start > cursor) {
        segments.push({ text: layer.text!.content.slice(cursor, start), highlight: false })
      }
      if (end > start) {
        segments.push({ text: layer.text!.content.slice(start, end), highlight: true, matchIndex })
      }
      cursor = end
    })
    if (cursor < layer.text.content.length) {
      segments.push({ text: layer.text.content.slice(cursor), highlight: false })
    }
    const matchWord = layerMatches.length === 1 ? "match" : "matches"
    groups.push({
      layerId: layer.id,
      layerName: layer.name,
      content: layer.text.content,
      matches: layerMatches,
      segments,
      matchCountLabel: `${layerMatches.length} ${matchWord}`,
    })
  }
  return groups
}

export function findReplaceTextLayers(layers: readonly Layer[], options: FindReplaceOptions): FindReplaceResult {
  const empty = (error?: string): FindReplaceResult => ({
    layers: [...layers],
    matches: [],
    changedLayerIds: [],
    replacements: 0,
    matchCountLabel: "0 matches",
    highlights: [],
    error,
  })
  if (!options.find) {
    return empty()
  }

  let flags = options.caseSensitive ? "g" : "gi"
  if (options.useRegex && options.regexFlags) {
    if (options.regexFlags.multiline && !flags.includes("m")) flags += "m"
    if (options.regexFlags.dotAll && !flags.includes("s")) flags += "s"
  }
  const source = options.useRegex ? options.find : escapeRegExp(options.find)
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid regular expression"
    return empty(message.startsWith("Invalid regular expression") ? message : `Invalid regular expression: ${message}`)
  }
  const matches: FindReplaceResult["matches"] = []
  const changedLayerIds: string[] = []
  let replacements = 0

  // For Replace Next, track whether we've consumed our one allowed replacement.
  let nextReplacementConsumed = false

  const cursor = options.startCursor
  const passesCursor = (layerId: string, index: number) => {
    if (!cursor) return true
    if (layerId !== cursor.layerId) {
      // Cursor lives in a different layer — accept any match in this layer.
      return true
    }
    return index >= cursor.index
  }

  const nextLayers = layers.map((layer) => {
    if (!layer.text) return layer
    const original = layer.text.content
    const layerMatches = [...original.matchAll(regex)]
    if (!layerMatches.length) return layer
    for (const match of layerMatches) {
      matches.push({
        layerId: layer.id,
        layerName: layer.name,
        index: match.index ?? 0,
        length: match[0].length,
        text: match[0],
      })
    }
    if (options.previewOnly) return layer
    if (options.replaceNext) {
      // Replace only the first eligible match (respecting cursor).
      if (nextReplacementConsumed) return layer
      const target = layerMatches.find((match) => passesCursor(layer.id, match.index ?? 0))
      if (!target) return layer
      const start = target.index ?? 0
      const end = start + target[0].length
      const replaced = options.useRegex
        ? target[0].replace(regex, options.replace)
        : options.replace
      const content = `${original.slice(0, start)}${replaced}${original.slice(end)}`
      if (content === original) return layer
      replacements += 1
      nextReplacementConsumed = true
      changedLayerIds.push(layer.id)
      return { ...layer, text: { ...layer.text, content } }
    }
    replacements += layerMatches.length
    const content = options.useRegex
      ? original.replace(regex, options.replace)
      : original.replace(regex, () => options.replace)
    if (content === original) return layer
    changedLayerIds.push(layer.id)
    return { ...layer, text: { ...layer.text, content } }
  })

  const layerCount = new Set(matches.map((match) => match.layerId)).size
  const matchWord = matches.length === 1 ? "match" : "matches"
  const layerWord = layerCount === 1 ? "layer" : "layers"
  const matchCountLabel = matches.length ? `${matches.length} ${matchWord} in ${layerCount} ${layerWord}` : "0 matches"
  return { layers: nextLayers, matches, changedLayerIds, replacements, matchCountLabel, highlights: buildFindReplaceHighlights(layers, matches) }
}

export function applyTextInsideShape(
  text: TextProps,
  shape: ShapeProps,
  options: {
    inset?: number
    insets?: Partial<{ top: number; right: number; bottom: number; left: number }>
    verticalAlign?: "top" | "middle" | "bottom"
  } = {},
): TextProps {
  const inset = Math.max(0, options.inset ?? text.textShapeInset ?? 0)
  const previousInsets = text.textShapeInsets
  const insets = {
    top: Math.max(0, options.insets?.top ?? previousInsets?.top ?? inset),
    right: Math.max(0, options.insets?.right ?? previousInsets?.right ?? inset),
    bottom: Math.max(0, options.insets?.bottom ?? previousInsets?.bottom ?? inset),
    left: Math.max(0, options.insets?.left ?? previousInsets?.left ?? inset),
  }
  return {
    ...text,
    x: shape.x + insets.left,
    y: shape.y + insets.top,
    boxWidth: Math.max(1, shape.w - insets.left - insets.right),
    boxHeight: Math.max(1, shape.h - insets.top - insets.bottom),
    textShape: { ...shape, stroke: shape.stroke ? { ...shape.stroke } : null },
    textShapeInset: inset,
    textShapeInsets: insets,
    textShapeVerticalAlign: options.verticalAlign ?? text.textShapeVerticalAlign ?? "top",
  }
}

export function layoutTextOnPath(text: TextProps): TextPathGlyphLayout[] {
  const points = text.textPath ?? []
  if (points.length < 2) return []
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number; len: number; start: number }> = []
  const pts = text.textPathClosed ? [...points, points[0]] : points
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= 0) continue
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, start: total })
    total += len
  }
  if (!segments.length || total <= 0) return []

  const content = text.allCaps ? text.content.toUpperCase() : text.content
  const advances = [...content].map((char) => (char === "\n" ? text.size : glyphAdvance(text, char)))
  const textWidth = advances.reduce((sum, advance) => sum + advance, 0)
  const align = text.textPathAlign ?? "start"
  let cursor = align === "center" ? Math.max(0, (total - textWidth) / 2) : align === "end" ? Math.max(0, total - textWidth) : 0
  cursor += text.textPathStartOffset ?? 0
  if (text.textPathClosed) cursor = ((cursor % total) + total) % total
  const baselineOffset = text.textPathBaselineOffset ?? 0
  const flip = text.textPathFlip === true
  const glyphs: TextPathGlyphLayout[] = []

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const advance = advances[i]
    if (char === "\n") {
      cursor += advance
      continue
    }
    let mid = cursor + advance / 2
    if (text.textPathClosed) mid = ((mid % total) + total) % total
    const segment = segmentAtPathDistance(segments, mid)
    if (!segment) break
    const local = (mid - segment.start) / segment.len
    const x = segment.x1 + (segment.x2 - segment.x1) * local
    const y = segment.y1 + (segment.y2 - segment.y1) * local
    let angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1)
    if (flip) angle += Math.PI
    glyphs.push({ char, x, y, angle, advance, baselineOffset })
    cursor += advance
    if (!text.textPathClosed && cursor > total) break
  }

  return glyphs
}

function textPathLength(points: Array<{ x: number; y: number }>, closed = false) {
  const pts = closed && points.length > 1 ? [...points, points[0]] : points
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  }
  return total
}

function pointAtTextPathDistance(points: Array<{ x: number; y: number }>, distance: number, closed = false) {
  if (!points.length) return { x: 0, y: 0 }
  const pts = closed && points.length > 1 ? [...points, points[0]] : points
  const total = textPathLength(points, closed)
  let target = closed && total > 0 ? ((distance % total) + total) % total : clamp(distance, 0, total)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= 0) continue
    if (target <= len) {
      const t = target / len
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    target -= len
  }
  return pts[pts.length - 1]
}

export function buildTextPathHandleModel(text: TextProps): TextPathHandleModel {
  const points = (text.textPath ?? []).map((point, index) => ({
    index,
    label: `P${index + 1}`,
    x: point.x,
    y: point.y,
  }))
  const totalLength = textPathLength(text.textPath ?? [], text.textPathClosed)
  const startDistance = text.textPathStartOffset ?? 0
  const start = pointAtTextPathDistance(text.textPath ?? [], startDistance, text.textPathClosed)
  return {
    points,
    closed: text.textPathClosed === true,
    align: text.textPathAlign ?? "start",
    totalLength,
    startHandle: { distance: startDistance, x: start.x, y: start.y },
    baselineHandle: { offset: text.textPathBaselineOffset ?? 0 },
  }
}

export function updateTextPathPoint(text: TextProps, index: number, point: { x: number; y: number }): TextProps {
  const points = text.textPath?.slice() ?? []
  if (index < 0 || index >= points.length) return text
  points[index] = { x: point.x, y: point.y }
  return { ...text, textPath: points }
}

export function insertTextPathPoint(text: TextProps, index: number, point: { x: number; y: number }): TextProps {
  const points = text.textPath?.slice() ?? []
  const insertAt = clamp(Math.round(index), 0, points.length)
  points.splice(insertAt, 0, { x: point.x, y: point.y })
  return { ...text, textPath: points }
}

export function deleteTextPathPoint(text: TextProps, index: number): TextProps {
  const points = text.textPath?.slice() ?? []
  if (points.length <= 2 || index < 0 || index >= points.length) return text
  points.splice(index, 1)
  return { ...text, textPath: points }
}

export function reverseTextPath(text: TextProps): TextProps {
  const points = text.textPath?.slice().reverse() ?? []
  return { ...text, textPath: points }
}

function segmentAtPathDistance(
  segments: Array<{ x1: number; y1: number; x2: number; y2: number; len: number; start: number }>,
  distance: number,
) {
  return segments.find((segment) => distance >= segment.start && distance <= segment.start + segment.len) ?? segments[segments.length - 1]
}

function glyphAdvance(text: TextProps, char: string) {
  if (char === " ") return text.size * 0.35
  const wide = /[MW@#%]/.test(char)
  const narrow = /[ilI1.,:;'!|]/.test(char)
  const base = wide ? 0.78 : narrow ? 0.32 : 0.58
  return text.size * base + ((text.tracking ?? 0) / 1000) * text.size
}

function pushGlyphOutline(points: PathPoint[], x: number, y: number, w: number, h: number, bevel: number) {
  const r = Math.min(bevel, w / 3, h / 3)
  points.push(
    { x: x + r, y, cp1: { x, y }, cp2: { x, y: y + r } },
    { x: x + w - r, y },
    { x: x + w, y: y + r, cp1: { x: x + w, y }, cp2: { x: x + w, y: y + r } },
    { x: x + w, y: y + h - r },
    { x: x + w - r, y: y + h, cp1: { x: x + w, y: y + h }, cp2: { x: x + w - r, y: y + h } },
    { x: x + r, y: y + h },
    { x, y: y + h - r, cp1: { x, y: y + h }, cp2: { x, y: y + h - r } },
    { x, y: y + r },
  )
}

function convertTextToFontOutlinePath(text: TextProps): PathProps | null {
  const font = embeddedFontForText(text)
  if (!font) return null
  const points: PathPoint[] = []
  const subpaths: PathProps[] = []
  const scale = Math.max(1, text.size) / font.unitsPerEm
  const trackingPx = ((text.tracking ?? 0) / 1000) * text.size
  const lineHeight = text.leading ?? text.size * 1.2
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  let cursorX = 0
  let lineY = 0

  if (text.textShape) {
    const shapePath = shapeToEditablePath(text.textShape)
    shapePath.source = "shape"
    points.push(...shapePath.points)
    subpaths.push(shapePath)
  }

  for (const char of content) {
    if (char === "\n") {
      cursorX = 0
      lineY += lineHeight
      continue
    }
    const glyphId = font.cmap.get(char.codePointAt(0) ?? 0) ?? 0
    const metric = glyphMetric(font, glyphId)
    if (char.trim() && glyphId > 0) {
      const contours = parseSimpleGlyph(font, glyphId)
      for (const contour of contours) {
        const path = convertGlyphContourToPath(contour, (point) => ({
          x: text.x + cursorX + point.x * scale,
          y: text.y + lineY + (font.ascent - point.y) * scale + (text.baselineShift ?? 0),
        }))
        if (!path) continue
        points.push(...path.points)
        subpaths.push(path)
      }
    }
    cursorX += metric.advanceWidth * scale + trackingPx
  }

  return subpaths.some((path) => path.source === "font-outline")
    ? { points, closed: true, source: "font-outline", subpaths }
    : null
}

export function convertTextToEditablePath(text: TextProps): PathProps {
  const exactFontPath = convertTextToFontOutlinePath(text)
  if (exactFontPath) return exactFontPath

  const points: PathPoint[] = []
  const subpaths: PathProps[] = []
  if (text.textShape) {
    const shapePath = shapeToEditablePath(text.textShape)
    shapePath.source = "shape"
    points.push(...shapePath.points)
    subpaths.push(shapePath)
  }
  const lineHeight = text.leading ?? text.size * 1.2
  let x = text.x
  let y = text.y
  const startX = text.x

  for (const char of text.allCaps ? text.content.toUpperCase() : text.content) {
    if (char === "\n") {
      x = startX
      y += lineHeight
      continue
    }
    const advance = glyphAdvance(text, char)
    if (char.trim()) {
      const glyphPoints: PathPoint[] = []
      pushGlyphOutline(glyphPoints, x, y, Math.max(2, advance * 0.86), text.size, Math.max(1, text.size * 0.08))
      points.push(...glyphPoints)
      subpaths.push({ points: glyphPoints, closed: true, source: "approximated-glyph" })
    }
    x += advance
  }

  if (!points.length) {
    const glyphPoints: PathPoint[] = []
    pushGlyphOutline(glyphPoints, text.x, text.y, Math.max(4, text.size * 0.4), Math.max(4, text.size), 1)
    points.push(...glyphPoints)
    subpaths.push({ points: glyphPoints, closed: true, source: "approximated-glyph" })
  }

  return { points, closed: true, source: "approximated-glyph", subpaths }
}

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function material(color: string): ThreeDMaterial {
  return {
    id: "text-material",
    name: "Text Extrusion",
    color,
    metallic: 0,
    roughness: 0.38,
    opacity: 1,
  }
}

function prismObject(id: string, name: string, x: number, y: number, w: number, h: number, depth: number, materialId: string, angle: number): ThreeDObject {
  const x0 = x
  const x1 = x + w
  const y0 = y
  const y1 = y + h
  const z0 = 0
  const z1 = depth
  const vertices = [
    vec(x0, y0, z0),
    vec(x1, y0, z0),
    vec(x1, y1, z0),
    vec(x0, y1, z0),
    vec(x0, y0, z1),
    vec(x1, y0, z1),
    vec(x1, y1, z1),
    vec(x0, y1, z1),
  ]
  return {
    id,
    name,
    vertices,
    faces: [
      { indices: [0, 1, 2, 3], materialId },
      { indices: [4, 7, 6, 5], materialId },
      { indices: [0, 4, 5, 1], materialId },
      { indices: [1, 5, 6, 2], materialId },
      { indices: [2, 6, 7, 3], materialId },
      { indices: [3, 7, 4, 0], materialId },
    ],
    materialId,
    position: vec(0, 0, 0),
    rotation: vec(18, -28, angle * 0.08),
    scale: vec(1, 1, 1),
    visible: true,
  }
}

export function createTextExtrusionScene(text: TextProps): ThreeDScene {
  const extrusion = text.extrusion ?? { enabled: true, depth: 24, bevel: 2, angle: 35, color: text.color }
  const mat = material(extrusion.color ?? text.color)
  const objects: ThreeDObject[] = []
  const glyphs = [...(text.allCaps ? text.content.toUpperCase() : text.content)].filter((char) => char.trim() && char !== "\n")
  const unitsPerPx = 1 / Math.max(1, text.size)
  const depth = Math.max(0.05, extrusion.depth * unitsPerPx)
  let cursor = 0
  const totalWidth = glyphs.reduce((sum, char) => sum + glyphAdvance(text, char) * unitsPerPx, 0)

  for (let i = 0; i < glyphs.length; i++) {
    const char = glyphs[i]
    const advance = glyphAdvance(text, char) * unitsPerPx
    const w = Math.max(0.08, advance * 0.82)
    const h = 1
    const x = cursor - totalWidth / 2
    const y = -0.5
    objects.push(prismObject(`text-glyph-${i}`, `Glyph ${char}`, x, y, w, h, depth, mat.id, extrusion.angle))
    cursor += advance
  }

  if (!objects.length) {
    objects.push(prismObject("text-glyph-0", "Glyph", -0.25, -0.5, 0.5, 1, depth, mat.id, extrusion.angle))
  }

  return {
    objects,
    materials: [mat],
    lights: [
      { id: "text-light-ambient", name: "Ambient", kind: "ambient", color: "#ffffff", intensity: 0.35 },
      { id: "text-light-key", name: "Key", kind: "directional", color: "#ffffff", intensity: 0.95, direction: vec(-0.35, -0.7, -0.5) },
    ],
    camera: { position: vec(0, 0.15, 5), target: vec(0, 0, 0), fov: 42, focalLength: 50 },
    renderMode: "solid-wire",
    background: "transparent",
    selectedObjectId: objects[0].id,
  }
}
