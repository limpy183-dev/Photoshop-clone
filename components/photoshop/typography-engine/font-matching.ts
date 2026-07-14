import type { Layer, TextProps } from "../types"
import {
  clamp,
  quoteFontFamily,
  WEB_SAFE_FONT_CANDIDATES,
  type FontCandidate,
  type FontDiagnostics,
  type FontSubstitutionResult,
  type MatchFontImageResult,
  type MatchFontResult,
} from "../typography-engine-types"
import { measureFontGeometry, metricFromCandidate } from "./font-previews"

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
