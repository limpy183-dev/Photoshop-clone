import type {
  Layer,
  OpenTypeControls,
  StylisticSetKey,
  TextAntiAliasMode,
  TextProps,
  TypographyAxisDefinition,
  TypographyEmbeddedFont,
  TypographyNamedInstance,
} from "./types"

export interface FontCandidate {
  family: string
  averageGlyphWidth: number
  xHeight: number
  serif?: boolean
  monospace?: boolean
  variableAxes?: TypographyAxisDefinition[]
}

export interface FontGeometryMetrics {
  sampleWidth: number
  averageGlyphWidth: number
  xHeight: number
  ascent: number
  descent: number
  source: "canvas" | "heuristic" | "layer-box" | "font-data" | "image-recognition"
}

export interface FontPreviewSpec {
  family: string
  sample: string
  cssFont: string
  fontVariationSettings: string
  fontFeatureSettings: string
  geometry: FontGeometryMetrics
  previewStyle: Record<string, string | number | undefined>
  canvasDataUrl?: string
}

export interface FontSpecimen extends FontPreviewSpec {
  source: "system" | "web" | "candidate"
}

export interface FontSubstitutionComparison {
  original: FontPreviewSpec
  fallback: FontPreviewSpec
  specimens: FontSpecimen[]
  geometryDelta: {
    sampleWidth: number
    averageGlyphWidth: number
    xHeight: number
  }
}

export interface MatchFontResult {
  best: FontCandidate
  candidates: Array<FontCandidate & { score: number; reasons: string[]; geometry: FontGeometryMetrics }>
  target: {
    averageGlyphWidth: number
    xHeight: number
    serifLikely: boolean
    sampleWidth: number
    source: FontGeometryMetrics["source"]
  }
}

export interface MatchFontImageResult extends MatchFontResult {
  recognition: {
    source: "image-model"
    confidence: number
    glyphCount: number
    bounds: { x: number; y: number; w: number; h: number }
    density: number
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
  previewOnly?: boolean
  /** Additional GREP flags to apply when useRegex is true (case-sensitive flag is derived from caseSensitive). */
  regexFlags?: { multiline?: boolean; dotAll?: boolean }
  /** Only the first match across the document is replaced (Replace Next). */
  replaceNext?: boolean
  /** Skip matches whose absolute (layer-id + index) precedes this cursor. */
  startCursor?: { layerId: string; index: number }
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
  matchCountLabel: string
  highlights: FindReplaceHighlightGroup[]
  error?: string
}

export interface FindReplaceHighlightSegment {
  text: string
  highlight: boolean
  matchIndex?: number
}

export interface FindReplaceHighlightGroup {
  layerId: string
  layerName: string
  content: string
  matches: FindReplaceResult["matches"]
  segments: FindReplaceHighlightSegment[]
  matchCountLabel: string
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
  verticalAlign: "top" | "middle" | "bottom"
  letterSpacing: string
  verticalMetrics: {
    columnGap: number
    glyphSpacing: number
    glyphScale: number
    proportional: boolean
  }
  renderHints: {
    mode: TextAntiAliasMode
    imageSmoothingEnabled: boolean
    textRendering: "auto" | "optimizeSpeed" | "optimizeLegibility" | "geometricPrecision"
    contrast: number
    pixelSnap: boolean
  }
  shaping: TypographyShapingPlan
}

export interface OpenTypeFeatureToggle {
  key: keyof OpenTypeControls
  tag: string
  label: string
  defaultEnabled: boolean
}

export interface OpenTypeFeatureSupport {
  fontAvailable: boolean
  supportedTags: Set<string>
  browserSupportedTags: Set<string>
  source: "embedded-font" | "browser" | "fallback"
}

export interface VariableFontMetadata {
  axes: TypographyAxisDefinition[]
  namedInstances: TypographyNamedInstance[]
}

export interface VariableFontInspection extends VariableFontMetadata {
  family: string
  source: "embedded-font" | "font-access" | "font-face" | "fallback"
  error?: string
}

export interface VariableFontAxisControl {
  tag: string
  name: string
  min: number
  max: number
  defaultValue: number
  value: number
  source: "discovered" | "stored" | "default" | "custom"
}

export interface VariableFontAxisControlModel {
  family: string
  source: VariableFontInspection["source"] | "stored" | "default"
  axes: VariableFontAxisControl[]
  namedInstances: Array<TypographyNamedInstance & { label: string; summary: string }>
  status: string
  error?: string
}

export interface TypographyGlyphRunItem {
  char: string
  glyphId: number
  x: number
  y: number
  advance: number
}

export interface TypographyShapingPlan {
  engine: "embedded-opentype" | "browser-canvas"
  compatibility: "photoshop-compatible" | "browser-native"
  glyphRun: TypographyGlyphRunItem[]
  advanceWidth: number
  source: "font-bytes" | "browser"
  notes: string[]
}

export interface OpenTypeFontMetadata extends VariableFontMetadata {
  format: TypographyEmbeddedFont["format"]
  unitsPerEm?: number
  glyphCount?: number
  featureTags: string[]
  familyNames: string[]
}

export interface TextPathGlyphLayout {
  char: string
  x: number
  y: number
  angle: number
  advance: number
  baselineOffset: number
}

export interface TextPathHandleModel {
  points: Array<{ index: number; label: string; x: number; y: number }>
  closed: boolean
  align: NonNullable<TextProps["textPathAlign"]>
  totalLength: number
  startHandle: { distance: number; x: number; y: number }
  baselineHandle: { offset: number }
}

export const DEFAULT_VARIABLE_AXIS_DEFINITIONS: TypographyAxisDefinition[] = [
  { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
  { tag: "wdth", name: "Width", min: 50, max: 200, defaultValue: 100 },
  { tag: "slnt", name: "Slant", min: -15, max: 0, defaultValue: 0 },
  { tag: "opsz", name: "Optical Size", min: 8, max: 72, defaultValue: 14 },
]

export const OPEN_TYPE_FEATURE_TOGGLES: OpenTypeFeatureToggle[] = [
  { key: "ligatures", tag: "liga", label: "Ligatures", defaultEnabled: true },
  { key: "discretionaryLigatures", tag: "dlig", label: "Discretionary Ligatures", defaultEnabled: false },
  { key: "contextualAlternates", tag: "calt", label: "Contextual Alternates", defaultEnabled: true },
  { key: "stylisticAlternates", tag: "salt", label: "Stylistic Alternates", defaultEnabled: false },
  { key: "swash", tag: "swsh", label: "Swash", defaultEnabled: false },
  { key: "ordinals", tag: "ordn", label: "Ordinals", defaultEnabled: false },
  { key: "fractions", tag: "frac", label: "Fractions", defaultEnabled: false },
  { key: "superscript", tag: "sups", label: "Superscript", defaultEnabled: false },
  { key: "subscript", tag: "subs", label: "Subscript", defaultEnabled: false },
  { key: "slashedZero", tag: "zero", label: "Slashed Zero", defaultEnabled: false },
  { key: "smallCaps", tag: "smcp", label: "Small Caps", defaultEnabled: false },
  { key: "oldstyleFigures", tag: "onum", label: "Oldstyle Figures", defaultEnabled: false },
  { key: "tabularFigures", tag: "tnum", label: "Tabular Figures", defaultEnabled: false },
  { key: "proportionalFigures", tag: "pnum", label: "Proportional Figures", defaultEnabled: false },
  { key: "liningFigures", tag: "lnum", label: "Lining Figures", defaultEnabled: false },
  { key: "historicalForms", tag: "hist", label: "Historical Forms", defaultEnabled: false },
  { key: "titling", tag: "titl", label: "Titling Alternates", defaultEnabled: false },
]

const STYLISTIC_SET_KEYS: StylisticSetKey[] = [
  "ss01", "ss02", "ss03", "ss04", "ss05",
  "ss06", "ss07", "ss08", "ss09", "ss10",
  "ss11", "ss12", "ss13", "ss14", "ss15",
  "ss16", "ss17", "ss18", "ss19", "ss20",
]

export function listStylisticSetKeys(): readonly StylisticSetKey[] {
  return STYLISTIC_SET_KEYS
}

export const OPEN_TYPE_FEATURE_SAMPLES: Record<string, string> = {
  liga: "office affinity",
  clig: "office affinity",
  dlig: "st ct sp",
  calt: "contextual",
  salt: "alphabet",
  swsh: "Queen",
  ordn: "1st 2nd",
  frac: "1/2 3/4",
  sups: "x2 n3",
  subs: "H2O CO2",
  zero: "000 100",
  smcp: "Small Caps",
  onum: "0123456789",
  tnum: "1234567890",
}

export const WEB_SAFE_FONT_CANDIDATES: FontCandidate[] = [
  { family: "Arial", averageGlyphWidth: 0.52, xHeight: 0.52, serif: false },
  { family: "Helvetica", averageGlyphWidth: 0.51, xHeight: 0.52, serif: false },
  { family: "Inter", averageGlyphWidth: 0.54, xHeight: 0.55, serif: false, variableAxes: DEFAULT_VARIABLE_AXIS_DEFINITIONS },
  { family: "Geist", averageGlyphWidth: 0.53, xHeight: 0.56, serif: false, variableAxes: DEFAULT_VARIABLE_AXIS_DEFINITIONS },
  { family: "Georgia", averageGlyphWidth: 0.56, xHeight: 0.48, serif: true },
  { family: "Times New Roman", averageGlyphWidth: 0.5, xHeight: 0.45, serif: true },
  { family: "Courier New", averageGlyphWidth: 0.6, xHeight: 0.5, serif: false, monospace: true },
  { family: "Impact", averageGlyphWidth: 0.68, xHeight: 0.72, serif: false },
]

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function quoteFontFamily(font: string) {
  const safe = font.trim().replace(/"/g, "")
  return /\s|,/.test(safe) ? `"${safe}"` : safe
}

export function fontFamilyList(font: string) {
  return `${quoteFontFamily(font)}, Arial, sans-serif`
}

export function formatAxisValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

export function compareAxisOrder(a: string, b: string) {
  const ai = DEFAULT_VARIABLE_AXIS_DEFINITIONS.findIndex((axis) => axis.tag === a)
  const bi = DEFAULT_VARIABLE_AXIS_DEFINITIONS.findIndex((axis) => axis.tag === b)
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  return a.localeCompare(b)
}
