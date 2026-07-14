import type { TextAntiAliasMode, TextProps } from "../types"
import {
  clamp,
  formatAxisValue,
  quoteFontFamily,
  type TypographyGlyphRunItem,
  type TypographyRenderPlan,
  type TypographyShapingPlan,
} from "../typography-engine-types"
import { embeddedFontForText, glyphMetric } from "./font-parser"
import { glyphAdvance } from "./glyph-advance"
import { textOpenTypeControls, buildOpenTypeFeatureSettings } from "./opentype-features"
import { axisDefinitionsFor, normalizeVariableAxes, serializeVariableAxes } from "./variable-axes"

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
