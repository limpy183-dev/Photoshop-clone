import type { TextProps, TypographyAxisDefinition } from "../types"
import {
  clamp,
  fontFamilyList,
  WEB_SAFE_FONT_CANDIDATES,
  type FontCandidate,
  type FontGeometryMetrics,
  type FontSpecimen,
  type FontSubstitutionComparison,
} from "../typography-engine-types"
import { buildTypographyRenderPlan } from "./render-plan"

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

export function measureFontGeometry(text: TextProps, sample = text.content): FontGeometryMetrics {
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

export function metricFromCandidate(candidate: FontCandidate, sample: string, size: number): FontGeometryMetrics {
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
