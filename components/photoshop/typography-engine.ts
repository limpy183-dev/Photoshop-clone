import type {
  Layer,
  OpenTypeControls,
  PathPoint,
  PathProps,
  ShapeProps,
  TextAntiAliasMode,
  TextProps,
  ThreeDMaterial,
  ThreeDObject,
  ThreeDScene,
  TypographyAxisDefinition,
  Vec3,
} from "./types"
import { shapeToEditablePath } from "./vector-path-operations"

export interface FontCandidate {
  family: string
  averageGlyphWidth: number
  xHeight: number
  serif?: boolean
  monospace?: boolean
  variableAxes?: TypographyAxisDefinition[]
}

export interface MatchFontResult {
  best: FontCandidate
  candidates: Array<FontCandidate & { score: number; reasons: string[] }>
  target: {
    averageGlyphWidth: number
    xHeight: number
    serifLikely: boolean
  }
}

export interface FontDiagnostics {
  missingFonts: string[]
  availableFonts: string[]
  layersByFont: Record<string, string[]>
  substitutions: Record<string, string>
  diagnostics: Array<{
    layerId: string
    layerName: string
    font: string
    status: "available" | "missing" | "substituted"
    substitute?: string
  }>
}

export interface FontSubstitutionResult {
  layers: Layer[]
  changedLayerIds: string[]
  report: FontDiagnostics
}

export interface FindReplaceOptions {
  find: string
  replace: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
}

export interface FindReplaceResult {
  layers: Layer[]
  matches: Array<{
    layerId: string
    layerName: string
    index: number
    length: number
    text: string
  }>
  changedLayerIds: string[]
  replacements: number
}

export interface TypographyRenderPlan {
  cssFont: string
  content: string
  fontFeatureSettings: string
  fontVariationSettings: string
  fontKerning: "auto" | "normal" | "none"
  fontVariantCaps: "normal" | "small-caps"
  fontVariantLigatures: "normal" | "none"
  writingMode: "horizontal-tb" | "vertical-rl" | "vertical-lr"
  textOrientation: "mixed" | "upright" | "sideways"
  letterSpacing: string
  renderHints: {
    mode: TextAntiAliasMode
    imageSmoothingEnabled: boolean
    textRendering: "auto" | "optimizeSpeed" | "optimizeLegibility" | "geometricPrecision"
    contrast: number
    pixelSnap: boolean
  }
}

export interface OpenTypeFeatureToggle {
  key: keyof OpenTypeControls
  tag: string
  label: string
  defaultEnabled: boolean
}

export interface TextPathGlyphLayout {
  char: string
  x: number
  y: number
  angle: number
  advance: number
  baselineOffset: number
}

export const DEFAULT_VARIABLE_AXIS_DEFINITIONS: TypographyAxisDefinition[] = [
  { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
  { tag: "wdth", name: "Width", min: 50, max: 200, defaultValue: 100 },
  { tag: "slnt", name: "Slant", min: -15, max: 0, defaultValue: 0 },
  { tag: "opsz", name: "Optical Size", min: 8, max: 72, defaultValue: 14 },
]

const OPEN_TYPE_FEATURE_TOGGLES: OpenTypeFeatureToggle[] = [
  { key: "ligatures", tag: "liga", label: "Ligatures", defaultEnabled: true },
  { key: "discretionaryLigatures", tag: "dlig", label: "Discretionary Ligatures", defaultEnabled: false },
  { key: "contextualAlternates", tag: "calt", label: "Contextual Alternates", defaultEnabled: true },
  { key: "stylisticAlternates", tag: "salt", label: "Stylistic Alternates", defaultEnabled: false },
  { key: "swash", tag: "swsh", label: "Swash", defaultEnabled: false },
  { key: "ordinals", tag: "ordn", label: "Ordinals", defaultEnabled: false },
  { key: "fractions", tag: "frac", label: "Fractions", defaultEnabled: false },
  { key: "smallCaps", tag: "smcp", label: "Small Caps", defaultEnabled: false },
  { key: "oldstyleFigures", tag: "onum", label: "Oldstyle Figures", defaultEnabled: false },
  { key: "tabularFigures", tag: "tnum", label: "Tabular Figures", defaultEnabled: false },
]

const WEB_SAFE_FONT_CANDIDATES: FontCandidate[] = [
  { family: "Arial", averageGlyphWidth: 0.52, xHeight: 0.52, serif: false },
  { family: "Helvetica", averageGlyphWidth: 0.51, xHeight: 0.52, serif: false },
  { family: "Inter", averageGlyphWidth: 0.54, xHeight: 0.55, serif: false, variableAxes: DEFAULT_VARIABLE_AXIS_DEFINITIONS },
  { family: "Geist", averageGlyphWidth: 0.53, xHeight: 0.56, serif: false, variableAxes: DEFAULT_VARIABLE_AXIS_DEFINITIONS },
  { family: "Georgia", averageGlyphWidth: 0.56, xHeight: 0.48, serif: true },
  { family: "Times New Roman", averageGlyphWidth: 0.5, xHeight: 0.45, serif: true },
  { family: "Courier New", averageGlyphWidth: 0.6, xHeight: 0.5, serif: false, monospace: true },
  { family: "Impact", averageGlyphWidth: 0.68, xHeight: 0.72, serif: false },
]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function quoteFontFamily(font: string) {
  const safe = font.trim().replace(/"/g, "")
  return /\s|,/.test(safe) ? `"${safe}"` : safe
}

function formatAxisValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function compareAxisOrder(a: string, b: string) {
  const ai = DEFAULT_VARIABLE_AXIS_DEFINITIONS.findIndex((axis) => axis.tag === a)
  const bi = DEFAULT_VARIABLE_AXIS_DEFINITIONS.findIndex((axis) => axis.tag === b)
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  return a.localeCompare(b)
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

  return {
    cssFont: buildCanvasFont(text),
    content,
    fontFeatureSettings: buildOpenTypeFeatureSettings(controls),
    fontVariationSettings: Object.keys(axes).length ? serializeVariableAxes(axes, axisDefinitionsFor(axes, text.variableAxisDefinitions)) : "",
    fontKerning: text.kerning === "optical" ? "normal" : text.kerning === "metrics" || text.kerning === undefined ? "auto" : "none",
    fontVariantCaps: controls.smallCaps ? "small-caps" : "normal",
    fontVariantLigatures: controls.ligatures === false ? "none" : "normal",
    writingMode: text.vertical ? (text.verticalWritingMode === "lr" ? "vertical-lr" : "vertical-rl") : "horizontal-tb",
    textOrientation: text.vertical ? (text.tateChuYoko ? "mixed" : "upright") : "mixed",
    letterSpacing: `${formatAxisValue(trackingPx)}px`,
    renderHints: antiAliasRenderHints(mode),
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
    previewStyle: {
      fontFamily: quoteFontFamily(font),
      fontSize: `${text.size}px`,
      fontVariationSettings: plan.fontVariationSettings,
      fontFeatureSettings: plan.fontFeatureSettings,
      color: text.color,
    },
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
  return { averageGlyphWidth, xHeight, serifLikely }
}

export function matchFontForLayer(text: TextProps, candidates: readonly FontCandidate[] = WEB_SAFE_FONT_CANDIDATES): MatchFontResult {
  const target = inferTargetMetrics(text)
  const ranked = candidates
    .map((candidate) => {
      const widthDiff = Math.abs(candidate.averageGlyphWidth - target.averageGlyphWidth)
      const xHeightDiff = Math.abs(candidate.xHeight - target.xHeight)
      const serifPenalty = candidate.serif === target.serifLikely ? 0 : 0.08
      const monospacePenalty = candidate.monospace && !/code|mono|number|table/i.test(text.content) ? 0.04 : 0
      const score = clamp(1 - widthDiff * 1.25 - xHeightDiff * 0.7 - serifPenalty - monospacePenalty, 0, 1)
      const reasons = [
        `width ${candidate.averageGlyphWidth.toFixed(2)} vs ${target.averageGlyphWidth.toFixed(2)}`,
        `x-height ${candidate.xHeight.toFixed(2)} vs ${target.xHeight.toFixed(2)}`,
      ]
      if (candidate.serif === target.serifLikely) reasons.push("style match")
      if (candidate.variableAxes?.length) reasons.push("variable font")
      return { ...candidate, score, reasons }
    })
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))

  return { best: ranked[0] ?? WEB_SAFE_FONT_CANDIDATES[0], candidates: ranked, target }
}

export function findReplaceTextLayers(layers: readonly Layer[], options: FindReplaceOptions): FindReplaceResult {
  if (!options.find) {
    return { layers: [...layers], matches: [], changedLayerIds: [], replacements: 0 }
  }

  const flags = options.caseSensitive ? "g" : "gi"
  const source = options.useRegex ? options.find : escapeRegExp(options.find)
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source
  const regex = new RegExp(pattern, flags)
  const matches: FindReplaceResult["matches"] = []
  const changedLayerIds: string[] = []
  let replacements = 0

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
    const content = original.replace(regex, () => {
      replacements += 1
      return options.replace
    })
    if (content === original) return layer
    changedLayerIds.push(layer.id)
    return { ...layer, text: { ...layer.text, content } }
  })

  return { layers: nextLayers, matches, changedLayerIds, replacements }
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

export function convertTextToEditablePath(text: TextProps): PathProps {
  const points: PathPoint[] = []
  const subpaths: PathProps[] = []
  if (text.textShape) {
    const shapePath = shapeToEditablePath(text.textShape)
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
      subpaths.push({ points: glyphPoints, closed: true })
    }
    x += advance
  }

  if (!points.length) {
    const glyphPoints: PathPoint[] = []
    pushGlyphOutline(glyphPoints, text.x, text.y, Math.max(4, text.size * 0.4), Math.max(4, text.size), 1)
    points.push(...glyphPoints)
    subpaths.push({ points: glyphPoints, closed: true })
  }

  return { points, closed: true, subpaths }
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
