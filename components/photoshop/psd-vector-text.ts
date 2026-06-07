"use client"

/**
 * PSD vector + text round-trip helpers (Stream 3).
 *
 * Marker-name encodings used as fallback when ag-psd cannot natively model a feature.
 * The marker is embedded in the PSD layer name and ignored on display.
 *
 *   __pstext:<base64(JSON)>__       — extra TextProps fields ag-psd's TextStyle/ParagraphStyle
 *                                     interfaces don't model directly (variable axes, antiAliasMode,
 *                                     character styles, superscript/subscript, allCaps/smallCaps,
 *                                     warp horizontal/vertical, textShape, OpenType controls).
 *   __psshape:<base64(JSON)>__      — full ShapeProps serialization (especially type === "custom"
 *                                     where no native PSD representation exists).
 *   __pspath:<name>:<base64>__      — document path entry. Used by appPathsToPsdResources to round-trip
 *                                     named paths since ag-psd doesn't expose a `paths` image resource.
 *
 * All marker tags use double underscores and `:` separators so the regex below can extract
 * them out of any user-named layer.
 */

import type {
  BezierKnot,
  BezierPath,
  Color,
  Justification as PsdJustification,
  Layer as PsdLayer,
  LayerTextData,
  LayerVectorMask,
  Orientation as _PsdOrientation,
  ParagraphStyle as PsdParagraphStyle,
  Psd,
  TextStyle as PsdTextStyle,
  Warp as PsdWarp,
  WarpStyle as PsdWarpStyle,
} from "ag-psd"

import type {
  Layer,
  OpenTypeControls,
  PathPoint,
  PathProps,
  ShapeProps,
  TextAntiAliasMode,
  TextProps,
  TypographyAxisDefinition,
  WarpStyle,
} from "./types"
import { shapeToEditablePath } from "./vector-path-operations"

/* ============================================================================
 * Capability declaration (consumed by the compatibility report)
 * ========================================================================== */

export const VECTOR_TEXT_CAPABILITY = {
  editableText: "round-trip",
  verticalText: "round-trip",
  textWarp: "round-trip",
  openType: "round-trip",
  variableFonts: "round-trip",
  characterStyles: "round-trip",
  paragraphStyles: "round-trip",
  vectorMasks: "round-trip",
  shapeLayers: {
    rect: "round-trip",
    roundedRect: "round-trip",
    ellipse: "round-trip",
    polygon: "round-trip",
    custom: "approximated",
  },
  documentPaths: "round-trip",
} as const

/* ============================================================================
 * Color helpers (kept local — Stream 3 must not import from document-io.ts)
 * ========================================================================== */

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = (hex ?? "").replace("#", "").trim()
  const value =
    clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean.padEnd(6, "0").slice(0, 6)
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  }
}

function colorToHex(color: Color | undefined, fallback = "#000000"): string {
  if (!color || typeof color !== "object") return fallback
  const anyColor = color as Record<string, unknown>
  if ("r" in anyColor && "g" in anyColor && "b" in anyColor) {
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
    return `#${toHex(Number(anyColor.r) || 0)}${toHex(Number(anyColor.g) || 0)}${toHex(Number(anyColor.b) || 0)}`
  }
  if ("k" in anyColor) {
    // grayscale
    const k = Math.max(0, Math.min(255, Math.round(Number(anyColor.k) || 0)))
    return `#${k.toString(16).padStart(2, "0").repeat(3)}`
  }
  return fallback
}

/* ============================================================================
 * Marker-name encode / decode
 * ========================================================================== */

const TEXT_MARKER_RE = /__pstext:([A-Za-z0-9+/=]+)__/
const SHAPE_MARKER_RE = /__psshape:([A-Za-z0-9+/=]+)__/
const PATH_MARKER_RE = /__pspath:([^:]+):([A-Za-z0-9+/=]+)__/g

function encodeBase64(value: unknown): string {
  const json = JSON.stringify(value)
  if (typeof Buffer !== "undefined") return Buffer.from(json, "utf8").toString("base64")
  if (typeof btoa !== "undefined") {
    const bytes = new TextEncoder().encode(json)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }
  return ""
}

function decodeBase64(b64: string): unknown {
  try {
    let json: string
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(b64, "base64").toString("utf8")
    } else if (typeof atob !== "undefined") {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      json = new TextDecoder("utf-8").decode(bytes)
    } else {
      return null
    }
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function encodeTextMarker(extra: Record<string, unknown>): string {
  return `__pstext:${encodeBase64(extra)}__`
}

export function decodeTextMarker(name: string): Record<string, unknown> | null {
  const match = name.match(TEXT_MARKER_RE)
  if (!match) return null
  const decoded = decodeBase64(match[1])
  return decoded && typeof decoded === "object" ? (decoded as Record<string, unknown>) : null
}

export function encodeShapeMarker(shape: ShapeProps): string {
  return `__psshape:${encodeBase64(shape)}__`
}

export function decodeShapeMarker(name: string): ShapeProps | null {
  const match = name.match(SHAPE_MARKER_RE)
  if (!match) return null
  const decoded = decodeBase64(match[1])
  return decoded && typeof decoded === "object" && (decoded as ShapeProps).type ? (decoded as ShapeProps) : null
}

export function stripMarkers(name: string): string {
  return name
    .replace(TEXT_MARKER_RE, "")
    .replace(SHAPE_MARKER_RE, "")
    .replace(PATH_MARKER_RE, "")
    .replace(/\s+/g, " ")
    .trim()
}

/* ============================================================================
 * Justification + orientation + antialias + warp style maps
 * ========================================================================== */

const APP_JUSTIFY_TO_PSD: Record<NonNullable<TextProps["justify"]>, PsdJustification> = {
  "left": "left",
  "center": "center",
  "right": "right",
  "justify-left": "justify-left",
  "justify-center": "justify-center",
  "justify-right": "justify-right",
  "justify-all": "justify-all",
}

function appAlignToPsdJustification(align: TextProps["align"], justify?: TextProps["justify"]): PsdJustification {
  if (justify && APP_JUSTIFY_TO_PSD[justify]) return APP_JUSTIFY_TO_PSD[justify]
  if (align === "center") return "center"
  if (align === "right") return "right"
  return "left"
}

function psdJustificationToApp(value: PsdJustification | undefined): {
  align: TextProps["align"]
  justify: NonNullable<TextProps["justify"]>
} {
  switch (value) {
    case "right":
      return { align: "right", justify: "right" }
    case "center":
      return { align: "center", justify: "center" }
    case "justify-left":
      return { align: "left", justify: "justify-left" }
    case "justify-center":
      return { align: "center", justify: "justify-center" }
    case "justify-right":
      return { align: "right", justify: "justify-right" }
    case "justify-all":
      return { align: "left", justify: "justify-all" }
    default:
      return { align: "left", justify: "left" }
  }
}

const ANTI_ALIAS_TO_PSD: Record<TextAntiAliasMode, "none" | "sharp" | "crisp" | "strong" | "smooth"> = {
  "none": "none",
  "sharp": "sharp",
  "crisp": "crisp",
  "strong": "strong",
  "smooth": "smooth",
}

function psdAntiAliasToApp(value: LayerTextData["antiAlias"]): TextAntiAliasMode {
  if (value === "none" || value === "sharp" || value === "crisp" || value === "strong" || value === "smooth") {
    return value
  }
  return "smooth"
}

const APP_WARP_TO_PSD: Record<WarpStyle, PsdWarpStyle> = {
  none: "none",
  arc: "arc",
  arch: "arch",
  bulge: "bulge",
  flag: "flag",
  wave: "wave",
  fish: "fish",
  rise: "rise",
  squeeze: "squeeze",
  twist: "twist",
}

const PSD_WARP_TO_APP: Partial<Record<PsdWarpStyle, WarpStyle>> = {
  none: "none",
  arc: "arc",
  arcLower: "arc",
  arcUpper: "arc",
  arch: "arch",
  bulge: "bulge",
  shellLower: "arch",
  shellUpper: "arch",
  flag: "flag",
  wave: "wave",
  fish: "fish",
  rise: "rise",
  fisheye: "bulge",
  inflate: "bulge",
  squeeze: "squeeze",
  twist: "twist",
  cylinder: "arc",
  custom: "arc",
}

/* ============================================================================
 * Text round-trip
 * ========================================================================== */

const _EM_TO_TRACKING = 1000 // PSD stores tracking in 1/1000 em

function buildTextStyle(text: TextProps): PsdTextStyle {
  const style: PsdTextStyle = {
    font: { name: text.font || "Arial", script: 0, type: 0, synthetic: 0 },
    fontSize: text.size,
    fauxBold: text.weight === "bold",
    fauxItalic: !!text.italic,
    autoLeading: text.leading == null,
    fillColor: parseHexColor(text.color),
    fillFlag: true,
  }
  if (typeof text.leading === "number") style.leading = text.leading
  if (typeof text.tracking === "number") style.tracking = text.tracking
  if (typeof text.baselineShift === "number") style.baselineShift = text.baselineShift
  if (text.underline) style.underline = true
  if (text.strikethrough) style.strikethrough = true
  if (typeof text.kerning === "number") {
    style.kerning = text.kerning
    style.autoKerning = false
  } else if (text.kerning === "metrics") {
    style.autoKerning = true
  } else if (text.kerning === "optical") {
    style.autoKerning = false
    style.kerning = 0
  }
  if (text.ligatures != null) style.ligatures = text.ligatures
  if (text.discretionaryLigatures != null) style.dLigatures = text.discretionaryLigatures
  if (text.allCaps) style.fontCaps = 2
  else if (text.smallCaps) style.fontCaps = 1
  if (text.superscript) style.fontBaseline = 1
  else if (text.subscript) style.fontBaseline = 2
  return style
}

function buildParagraphStyle(text: TextProps): PsdParagraphStyle {
  const style: PsdParagraphStyle = {
    justification: appAlignToPsdJustification(text.align, text.justify),
  }
  if (typeof text.indentFirst === "number") style.firstLineIndent = text.indentFirst
  if (typeof text.indentLeft === "number") style.startIndent = text.indentLeft
  if (typeof text.indentRight === "number") style.endIndent = text.indentRight
  if (typeof text.spaceBefore === "number") style.spaceBefore = text.spaceBefore
  if (typeof text.spaceAfter === "number") style.spaceAfter = text.spaceAfter
  if (text.hyphenation != null) style.autoHyphenate = text.hyphenation
  return style
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return undefined
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  return undefined
}

function deserializeWarpHorizontalVertical(psdWarp: PsdWarp | undefined): { horizontal: number; vertical: number } {
  if (!psdWarp) return { horizontal: 0, vertical: 0 }
  // ag-psd's Warp has `perspective` (horizontal) + `perspectiveOther` (vertical) on classic warps.
  return {
    horizontal: Number(psdWarp.perspective) || 0,
    vertical: Number(psdWarp.perspectiveOther) || 0,
  }
}

function _styleRunsFromCharacterStyles(text: TextProps): PsdTextStyle[] | undefined {
  if (!text.characterStyles || text.characterStyles.length === 0) return undefined
  // PSD style runs cover *every* character so we project ours over the full string.
  const totalLen = text.content.length
  if (!totalLen) return undefined
  const runs: { length: number; style: PsdTextStyle }[] = []
  let cursor = 0
  const sorted = [...text.characterStyles].sort((a, b) => a.start - b.start)
  for (const span of sorted) {
    const start = Math.max(0, Math.min(totalLen, Math.floor(span.start)))
    const end = Math.max(start, Math.min(totalLen, Math.floor(span.end)))
    if (start > cursor) {
      runs.push({ length: start - cursor, style: buildTextStyle(text) })
      cursor = start
    }
    const overrides = span.style ?? {}
    const merged: TextProps = {
      ...text,
      font: overrides.font ?? text.font,
      size: overrides.size ?? text.size,
      weight: overrides.weight ?? text.weight,
      italic: overrides.italic ?? text.italic,
      color: overrides.color ?? text.color,
      tracking: overrides.tracking ?? text.tracking,
    }
    runs.push({ length: Math.max(1, end - start), style: buildTextStyle(merged) })
    cursor = end
  }
  if (cursor < totalLen) runs.push({ length: totalLen - cursor, style: buildTextStyle(text) })
  return runs.flatMap((r) => Array(0).fill(0).concat([r.style])).length ? runs.map((r) => r.style) : undefined
}

/**
 * Build the full PSD text payload from a TextProps.
 * Returns a partial PsdLayer (so callers can merge with base fields).
 */
export function appTextToPsd(text: TextProps, layerLeft: number, layerTop: number): Partial<PsdLayer> {
  const styleRunsArr: { length: number; style: PsdTextStyle }[] = []
  if (text.characterStyles && text.characterStyles.length > 0 && text.content.length > 0) {
    const totalLen = text.content.length
    let cursor = 0
    const sorted = [...text.characterStyles].sort((a, b) => a.start - b.start)
    for (const span of sorted) {
      const start = Math.max(0, Math.min(totalLen, Math.floor(span.start)))
      const end = Math.max(start, Math.min(totalLen, Math.floor(span.end)))
      if (start > cursor) {
        styleRunsArr.push({ length: start - cursor, style: buildTextStyle(text) })
        cursor = start
      }
      const o = span.style ?? {}
      const mergedText: TextProps = {
        ...text,
        font: o.font ?? text.font,
        size: o.size ?? text.size,
        weight: o.weight ?? text.weight,
        italic: o.italic ?? text.italic,
        color: o.color ?? text.color,
        tracking: o.tracking ?? text.tracking,
      }
      styleRunsArr.push({ length: Math.max(1, end - start), style: buildTextStyle(mergedText) })
      cursor = end
    }
    if (cursor < totalLen) styleRunsArr.push({ length: totalLen - cursor, style: buildTextStyle(text) })
  }

  const baseStyle = buildTextStyle(text)
  const paragraphStyle = buildParagraphStyle(text)

  const widthEstimate = (text.boxWidth ?? Math.max(text.size * Math.max(1, text.content.length) * 0.6, text.size * 4)) || 100
  const heightEstimate = (text.boxHeight ?? text.size * 1.4) || text.size * 1.4
  const left = text.x ?? layerLeft
  const top = text.y ?? layerTop
  const right = left + widthEstimate
  const bottom = top + heightEstimate

  const psdText: LayerTextData = {
    text: text.content ?? "",
    transform: [1, 0, 0, 1, left, top],
    antiAlias: ANTI_ALIAS_TO_PSD[text.antiAliasMode ?? "smooth"] ?? "smooth",
    orientation: text.vertical ? "vertical" : "horizontal",
    left,
    top,
    right,
    bottom,
    style: baseStyle,
    paragraphStyle,
    paragraphStyleRuns: [{ length: Math.max(1, (text.content || "").length), style: paragraphStyle }],
    shapeType: text.boxWidth != null ? "box" : "point",
  }
  if (styleRunsArr.length > 0) {
    psdText.styleRuns = styleRunsArr
  }

  if (text.warp && text.warp.style !== "none") {
    const warp: PsdWarp = {
      style: APP_WARP_TO_PSD[text.warp.style] ?? "none",
      value: Number(text.warp.bend) || 0,
      perspective: Number(text.warp.horizontal) || 0,
      perspectiveOther: Number(text.warp.vertical) || 0,
      rotate: text.vertical ? "vertical" : "horizontal",
    }
    psdText.warp = warp
  } else {
    psdText.warp = { style: "none", value: 0, perspective: 0, perspectiveOther: 0, rotate: "horizontal" }
  }

  // Encode features ag-psd's typed surface doesn't natively model.
  const markerPayload: Record<string, unknown> = {}
  if (text.antiAliasMode && text.antiAliasMode !== "smooth") markerPayload.antiAliasMode = text.antiAliasMode
  if (text.variableAxes) markerPayload.variableAxes = text.variableAxes
  if (text.variableAxisDefinitions) markerPayload.variableAxisDefinitions = text.variableAxisDefinitions
  if (text.variableNamedInstance) markerPayload.variableNamedInstance = text.variableNamedInstance
  if (text.embeddedFont) markerPayload.embeddedFont = text.embeddedFont
  if (text.characterStyles && text.characterStyles.length > 0) markerPayload.characterStyles = text.characterStyles
  if (text.openType) markerPayload.openType = text.openType
  if (text.contextualAlternates != null) markerPayload.contextualAlternates = text.contextualAlternates
  if (text.stylisticAlternates != null) markerPayload.stylisticAlternates = text.stylisticAlternates
  if (text.swash != null) markerPayload.swash = text.swash
  if (text.ordinals != null) markerPayload.ordinals = text.ordinals
  if (text.fractions != null) markerPayload.fractions = text.fractions
  if (text.slashedZero != null) markerPayload.slashedZero = text.slashedZero
  if (text.oldstyleFigures != null) markerPayload.oldstyleFigures = text.oldstyleFigures
  if (text.tabularFigures != null) markerPayload.tabularFigures = text.tabularFigures
  if (text.superscript) markerPayload.superscript = true
  if (text.subscript) markerPayload.subscript = true
  if (text.allCaps) markerPayload.allCaps = true
  if (text.smallCaps) markerPayload.smallCaps = true
  if (text.kerning === "metrics" || text.kerning === "optical") markerPayload.kerningMode = text.kerning
  if (text.textShape) markerPayload.textShape = text.textShape
  if (typeof text.textShapeInset === "number") markerPayload.textShapeInset = text.textShapeInset
  if (text.textShapeInsets) markerPayload.textShapeInsets = text.textShapeInsets
  if (text.textShapeVerticalAlign) markerPayload.textShapeVerticalAlign = text.textShapeVerticalAlign
  if (text.verticalWritingMode) markerPayload.verticalWritingMode = text.verticalWritingMode
  if (text.tateChuYoko != null) markerPayload.tateChuYoko = text.tateChuYoko
  if (text.textOrientation) markerPayload.textOrientation = text.textOrientation
  if (text.verticalAlign) markerPayload.verticalAlign = text.verticalAlign
  if (text.mojikumi) markerPayload.mojikumi = text.mojikumi
  if (text.missingFontOriginal) markerPayload.missingFontOriginal = text.missingFontOriginal
  if (text.fontSubstitution) markerPayload.fontSubstitution = text.fontSubstitution
  if (text.extrusion) markerPayload.extrusion = text.extrusion
  if (text.textPath) markerPayload.textPath = text.textPath
  if (typeof text.boxWidth === "number") markerPayload.boxWidth = text.boxWidth
  if (typeof text.boxHeight === "number") markerPayload.boxHeight = text.boxHeight
  if (text.antiAlias === false) markerPayload.antiAlias = false
  if (text.warp) markerPayload.warp = text.warp

  const partial: Partial<PsdLayer> = {
    text: psdText,
    left,
    top,
    right,
    bottom,
  }
  if (Object.keys(markerPayload).length > 0) {
    partial.name = encodeTextMarker(markerPayload)
  }
  return partial
}

/**
 * Reverse of appTextToPsd — extract every TextProps field we can recover.
 * Pass `layerName` separately if you want to recover marker-encoded extras.
 */
export function psdTextToApp(
  psdText: NonNullable<PsdLayer["text"]>,
  fallbackX: number,
  fallbackY: number,
  layerName?: string,
): TextProps {
  const style = psdText.style ?? {}
  const para = psdText.paragraphStyle ?? psdText.paragraphStyleRuns?.[0]?.style ?? {}
  const justification = psdJustificationToApp(para.justification)

  const text: TextProps = {
    content: psdText.text ?? "",
    font: style.font?.name ?? "Arial",
    size: typeof style.fontSize === "number" ? style.fontSize : 24,
    weight: style.fauxBold ? "bold" : "normal",
    italic: !!style.fauxItalic,
    color: colorToHex(style.fillColor, "#000000"),
    align: justification.align,
    justify: justification.justify,
    x: typeof psdText.left === "number" ? psdText.left : fallbackX,
    y: typeof psdText.top === "number" ? psdText.top : fallbackY,
  }

  if (typeof style.tracking === "number") text.tracking = style.tracking
  if (!style.autoLeading && typeof style.leading === "number") text.leading = style.leading
  if (style.autoKerning) {
    text.kerning = "metrics"
  } else if (typeof style.kerning === "number") {
    text.kerning = style.kerning
  }
  if (typeof style.baselineShift === "number") text.baselineShift = style.baselineShift
  if (style.underline) text.underline = true
  if (style.strikethrough) text.strikethrough = true
  if (style.fontCaps === 2) text.allCaps = true
  else if (style.fontCaps === 1) text.smallCaps = true
  if (style.fontBaseline === 1) text.superscript = true
  else if (style.fontBaseline === 2) text.subscript = true
  if (style.ligatures != null) text.ligatures = style.ligatures
  if (style.dLigatures != null) text.discretionaryLigatures = style.dLigatures

  if (typeof para.firstLineIndent === "number") text.indentFirst = para.firstLineIndent
  if (typeof para.startIndent === "number") text.indentLeft = para.startIndent
  if (typeof para.endIndent === "number") text.indentRight = para.endIndent
  if (typeof para.spaceBefore === "number") text.spaceBefore = para.spaceBefore
  if (typeof para.spaceAfter === "number") text.spaceAfter = para.spaceAfter
  if (para.autoHyphenate != null) text.hyphenation = para.autoHyphenate

  text.antiAliasMode = psdAntiAliasToApp(psdText.antiAlias)
  if (psdText.orientation === "vertical") text.vertical = true

  // Reconstruct character style runs if PSD provided per-character runs.
  if (psdText.styleRuns && psdText.styleRuns.length > 1) {
    const characterStyles: NonNullable<TextProps["characterStyles"]> = []
    let cursor = 0
    for (const run of psdText.styleRuns) {
      const runLength = Math.max(0, Math.floor(run.length))
      const runStyle = run.style ?? {}
      const baseFont = style.font?.name ?? text.font
      const runFont = runStyle.font?.name ?? baseFont
      const sizeDiffers = runStyle.fontSize != null && runStyle.fontSize !== style.fontSize
      const weightDiffers = (runStyle.fauxBold ?? false) !== !!style.fauxBold
      const italicDiffers = (runStyle.fauxItalic ?? false) !== !!style.fauxItalic
      const trackingDiffers = runStyle.tracking != null && runStyle.tracking !== style.tracking
      const fontDiffers = runFont !== baseFont
      const colorDiffers =
        runStyle.fillColor && colorToHex(runStyle.fillColor) !== colorToHex(style.fillColor, "#000000")
      if (sizeDiffers || weightDiffers || italicDiffers || trackingDiffers || fontDiffers || colorDiffers) {
        characterStyles.push({
          start: cursor,
          end: cursor + runLength,
          style: {
            ...(fontDiffers ? { font: runFont } : {}),
            ...(sizeDiffers ? { size: runStyle.fontSize as number } : {}),
            ...(weightDiffers ? { weight: runStyle.fauxBold ? ("bold" as const) : ("normal" as const) } : {}),
            ...(italicDiffers ? { italic: !!runStyle.fauxItalic } : {}),
            ...(colorDiffers ? { color: colorToHex(runStyle.fillColor, text.color) } : {}),
            ...(trackingDiffers ? { tracking: runStyle.tracking as number } : {}),
          },
        })
      }
      cursor += runLength
    }
    if (characterStyles.length > 0) text.characterStyles = characterStyles
  }

  if (psdText.warp && psdText.warp.style && psdText.warp.style !== "none") {
    const mapped = PSD_WARP_TO_APP[psdText.warp.style] ?? "arc"
    const hv = deserializeWarpHorizontalVertical(psdText.warp)
    text.warp = {
      style: mapped,
      bend: Number(psdText.warp.value) || 0,
      horizontal: hv.horizontal,
      vertical: hv.vertical,
    }
  }

  // Box vs point text bounds
  if (psdText.shapeType === "box" || (psdText.boxBounds && psdText.boxBounds.length === 4)) {
    if (psdText.boxBounds && psdText.boxBounds.length === 4) {
      text.boxWidth = Math.abs(psdText.boxBounds[2] - psdText.boxBounds[0])
      text.boxHeight = Math.abs(psdText.boxBounds[3] - psdText.boxBounds[1])
    } else if (
      typeof psdText.left === "number" &&
      typeof psdText.right === "number" &&
      typeof psdText.top === "number" &&
      typeof psdText.bottom === "number"
    ) {
      text.boxWidth = psdText.right - psdText.left
      text.boxHeight = psdText.bottom - psdText.top
    }
  }

  // Restore marker-name extras
  if (layerName) {
    const extras = decodeTextMarker(layerName)
    if (extras) {
      if (typeof extras.antiAliasMode === "string") {
        text.antiAliasMode = extras.antiAliasMode as TextAntiAliasMode
      }
      if (extras.variableAxes && typeof extras.variableAxes === "object") {
        text.variableAxes = extras.variableAxes as Record<string, number>
      }
      if (Array.isArray(extras.variableAxisDefinitions)) {
        text.variableAxisDefinitions = extras.variableAxisDefinitions as TypographyAxisDefinition[]
      }
      if (Array.isArray(extras.characterStyles)) {
        text.characterStyles = extras.characterStyles as TextProps["characterStyles"]
      }
      if (extras.openType && typeof extras.openType === "object") {
        text.openType = extras.openType as OpenTypeControls
      }
      const flagFields: Array<keyof TextProps> = [
        "contextualAlternates",
        "stylisticAlternates",
        "swash",
        "ordinals",
        "fractions",
        "slashedZero",
        "oldstyleFigures",
        "tabularFigures",
        "superscript",
        "subscript",
        "allCaps",
        "smallCaps",
      ]
      for (const k of flagFields) {
        const v = readBoolean(extras[k])
        if (v != null) (text as unknown as Record<string, unknown>)[k] = v
      }
      if (extras.kerningMode === "metrics" || extras.kerningMode === "optical") {
        text.kerning = extras.kerningMode
      }
      if (extras.textShape && typeof extras.textShape === "object") {
        text.textShape = extras.textShape as ShapeProps
      }
      const inset = readNumber(extras.textShapeInset)
      if (inset != null) text.textShapeInset = inset
      if (extras.textShapeInsets && typeof extras.textShapeInsets === "object") {
        text.textShapeInsets = extras.textShapeInsets as TextProps["textShapeInsets"]
      }
      if (extras.textShapeVerticalAlign === "top" || extras.textShapeVerticalAlign === "middle" || extras.textShapeVerticalAlign === "bottom") {
        text.textShapeVerticalAlign = extras.textShapeVerticalAlign
      }
      if (extras.verticalWritingMode === "rl" || extras.verticalWritingMode === "lr") text.verticalWritingMode = extras.verticalWritingMode
      if (typeof extras.tateChuYoko === "boolean") text.tateChuYoko = extras.tateChuYoko
      if (extras.textOrientation === "mixed" || extras.textOrientation === "upright" || extras.textOrientation === "sideways") {
        text.textOrientation = extras.textOrientation
      }
      if (extras.verticalAlign === "top" || extras.verticalAlign === "middle" || extras.verticalAlign === "bottom") {
        text.verticalAlign = extras.verticalAlign
      }
      if (typeof extras.variableNamedInstance === "string") text.variableNamedInstance = extras.variableNamedInstance
      if (extras.embeddedFont && typeof extras.embeddedFont === "object") {
        text.embeddedFont = extras.embeddedFont as TextProps["embeddedFont"]
      }
      if (extras.mojikumi === "default" || extras.mojikumi === "loose" || extras.mojikumi === "compact" || extras.mojikumi === "none") {
        text.mojikumi = extras.mojikumi
      }
      if (typeof extras.missingFontOriginal === "string") text.missingFontOriginal = extras.missingFontOriginal
      if (typeof extras.fontSubstitution === "string") text.fontSubstitution = extras.fontSubstitution
      if (extras.extrusion && typeof extras.extrusion === "object") {
        text.extrusion = extras.extrusion as TextProps["extrusion"]
      }
      if (Array.isArray(extras.textPath)) {
        text.textPath = extras.textPath as TextProps["textPath"]
      }
      const bw = readNumber(extras.boxWidth)
      if (bw != null) text.boxWidth = bw
      const bh = readNumber(extras.boxHeight)
      if (bh != null) text.boxHeight = bh
      if (extras.antiAlias === false) text.antiAlias = false
      if (extras.warp && typeof extras.warp === "object") {
        text.warp = extras.warp as TextProps["warp"]
      }
    }
  }

  return text
}

/* ============================================================================
 * Path / vector mask helpers
 * ========================================================================== */

function pathPointsToBezierKnots(points: PathPoint[], closed: boolean): BezierKnot[] {
  if (points.length === 0) return []
  const knots: BezierKnot[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prevP = points[(i - 1 + points.length) % points.length]
    const nextP = points[(i + 1) % points.length]
    const preceding = p.cp1 ?? (closed || i > 0 ? { x: p.x + (prevP.x - p.x) / 3, y: p.y + (prevP.y - p.y) / 3 } : { x: p.x, y: p.y })
    const leaving = p.cp2 ?? (closed || i < points.length - 1 ? { x: p.x + (nextP.x - p.x) / 3, y: p.y + (nextP.y - p.y) / 3 } : { x: p.x, y: p.y })
    knots.push({
      linked: !!(p.cp1 && p.cp2),
      points: [preceding.x, preceding.y, p.x, p.y, leaving.x, leaving.y],
    })
  }
  return knots
}

function bezierKnotsToPathPoints(knots: BezierKnot[]): PathPoint[] {
  return knots.map((k) => {
    const [px, py, ax, ay, lx, ly] = k.points
    const cp1 = { x: px, y: py }
    const cp2 = { x: lx, y: ly }
    const anchorX = ax
    const anchorY = ay
    // Drop control points if they coincide with the anchor (linear segment).
    const epsilon = 1e-4
    const cp1Same = Math.abs(cp1.x - anchorX) < epsilon && Math.abs(cp1.y - anchorY) < epsilon
    const cp2Same = Math.abs(cp2.x - anchorX) < epsilon && Math.abs(cp2.y - anchorY) < epsilon
    return {
      x: anchorX,
      y: anchorY,
      ...(cp1Same ? {} : { cp1 }),
      ...(cp2Same ? {} : { cp2 }),
    }
  })
}

export function appVectorMaskToPsd(vectorMask: PathProps): LayerVectorMask {
  const knots = pathPointsToBezierKnots(vectorMask.points, vectorMask.closed)
  return {
    invert: false,
    notLink: false,
    disable: false,
    fillStartsWithAllPixels: false,
    paths: [
      {
        open: !vectorMask.closed,
        knots,
        fillRule: "even-odd",
      },
    ],
  }
}

export function psdVectorMaskToApp(psdVectorMask: LayerVectorMask): PathProps {
  const subPath: BezierPath | undefined = psdVectorMask.paths?.[0]
  if (!subPath || !subPath.knots || subPath.knots.length === 0) {
    return { points: [], closed: false }
  }
  return {
    points: bezierKnotsToPathPoints(subPath.knots),
    closed: !subPath.open,
  }
}

/* ============================================================================
 * Shape layer helpers
 * ========================================================================== */

const KAPPA = 0.5522847498

function rectPath(x: number, y: number, w: number, h: number, radius = 0): PathProps {
  if (radius <= 0) {
    return {
      closed: true,
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    }
  }
  const r = Math.min(radius, w / 2, h / 2)
  const k = r * KAPPA
  // 8 anchors: 4 corners x 2 anchors each (start + end of each rounded corner)
  return {
    closed: true,
    points: [
      // top-left to top-right
      { x: x + r, y, cp1: { x: x + r - k, y } },
      { x: x + w - r, y, cp2: { x: x + w - r + k, y } },
      { x: x + w, y: y + r, cp1: { x: x + w, y: y + r - k } },
      { x: x + w, y: y + h - r, cp2: { x: x + w, y: y + h - r + k } },
      { x: x + w - r, y: y + h, cp1: { x: x + w - r + k, y: y + h } },
      { x: x + r, y: y + h, cp2: { x: x + r - k, y: y + h } },
      { x, y: y + h - r, cp1: { x, y: y + h - r + k } },
      { x, y: y + r, cp2: { x, y: y + r - k } },
    ],
  }
}

export function appShapeToPsd(
  shape: ShapeProps,
  _w: number,
  _h: number,
): {
  vectorMask: LayerVectorMask
  vectorFill?: { type: "color"; color: { r: number; g: number; b: number } }
  vectorStroke?: NonNullable<PsdLayer["vectorStroke"]>
  markerName?: string
} {
  const useMarker = Boolean(
    shape.type === "custom" ||
    shape.type === "star" ||
    shape.cornerRadii ||
    shape.rotation ||
    shape.vertexRoundness ||
    shape.innerRadiusRatio ||
    shape.components?.length ||
    shape.appearance,
  )
  const path: PathProps = shape.type === "custom"
    ? rectPath(shape.x, shape.y, shape.w, shape.h, 0)
    : shapeToEditablePath(shape)
  const vectorMask = appVectorMaskToPsd(path)
  const vectorFill = shape.fill ? { type: "color" as const, color: parseHexColor(shape.fill) } : undefined
  const vectorStroke: NonNullable<PsdLayer["vectorStroke"]> | undefined = shape.stroke
    ? {
        strokeEnabled: true,
        fillEnabled: !!shape.fill,
        lineWidth: { units: "Pixels", value: shape.stroke.width },
        lineCapType: "butt",
        lineJoinType: "miter",
        lineAlignment: "center",
        content: { type: "color", color: parseHexColor(shape.stroke.color) },
      }
    : undefined
  return {
    vectorMask,
    vectorFill,
    vectorStroke,
    markerName: useMarker ? encodeShapeMarker(shape) : undefined,
  }
}

function bboxFromPoints(points: PathPoint[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function detectShapeKind(path: PathProps): "rect" | "ellipse" | "polygon" | null {
  const pts = path.points
  if (pts.length < 3) return null
  const hasCurvature = pts.some((p) => {
    if (!p.cp1 && !p.cp2) return false
    const epsilon = 1e-3
    const cp1Same = !p.cp1 || (Math.abs(p.cp1.x - p.x) < epsilon && Math.abs(p.cp1.y - p.y) < epsilon)
    const cp2Same = !p.cp2 || (Math.abs(p.cp2.x - p.x) < epsilon && Math.abs(p.cp2.y - p.y) < epsilon)
    return !(cp1Same && cp2Same)
  })
  if (!hasCurvature) {
    // 4 anchors with right angles → rect; otherwise polygon (N-gon).
    if (pts.length === 4) {
      // Check axis-aligned rectangle
      const bbox = bboxFromPoints(pts)
      const corners = [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.w, y: bbox.y },
        { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
        { x: bbox.x, y: bbox.y + bbox.h },
      ]
      const matches = corners.every((c) => pts.some((p) => Math.abs(p.x - c.x) < 0.5 && Math.abs(p.y - c.y) < 0.5))
      if (matches) return "rect"
    }
    return "polygon"
  }
  // Curvature present. 4 anchors with curvature → ellipse. 8 anchors with curvature → rounded rect (still "rect").
  if (pts.length === 4) return "ellipse"
  if (pts.length === 8) return "rect"
  return null
}

export function psdShapeToApp(psdLayer: PsdLayer): ShapeProps | null {
  // Try marker-name decode first.
  if (psdLayer.name) {
    const fromMarker = decodeShapeMarker(psdLayer.name)
    if (fromMarker) return fromMarker
  }
  const vmask = psdLayer.vectorMask
  if (!vmask) return null
  const path = psdVectorMaskToApp(vmask)
  if (path.points.length === 0) return null
  const kind = detectShapeKind(path)
  if (!kind) return null
  const bbox = bboxFromPoints(path.points)
  const fill = psdLayer.vectorFill
  const fillHex = fill && fill.type === "color" ? colorToHex(fill.color, "#000000") : "#000000"
  const stroke = psdLayer.vectorStroke
  const strokeColor =
    stroke?.content && stroke.content.type === "color" ? colorToHex(stroke.content.color, "#000000") : undefined
  const shape: ShapeProps = {
    type: kind,
    x: bbox.x,
    y: bbox.y,
    w: bbox.w,
    h: bbox.h,
    fill: fillHex,
    stroke:
      stroke && strokeColor
        ? { color: strokeColor, width: Number(stroke.lineWidth?.value) || 1 }
        : null,
  }
  if (kind === "rect" && path.points.length === 8) {
    // Estimate corner radius from first knot
    const p = path.points[0]
    if (p.cp1) shape.radius = Math.abs(p.x - p.cp1.x) / KAPPA
  }
  if (kind === "polygon") shape.sides = path.points.length
  return shape
}

/* ============================================================================
 * Document path image resources
 * ========================================================================== */

type DocPathEntry = { id: number; name: string; path: PathProps }

const PATH_RESOURCE_BASE_ID = 0x07d0 // 2000
const PATH_RESOURCE_MAX_ID = 0x0bb6 // 2998 (Photoshop reserves 2000–2998 for saved paths)

/**
 * Gather paths from every layer that has `layer.path` set and serialize them via
 * marker-name encoding on the document name. ag-psd does not directly expose the
 * 0x07D0+ path image resources, so we mark them via additionalInfo `name` markers.
 *
 * Returns a synthetic image-resources fragment that callers can merge into Psd.imageResources.
 * If callers can't merge (because the field is read-only), the same data is also returned
 * as a marker string usable on the doc name.
 */
export function appPathsToPsdResources(layers: Layer[]):
  | { entries: DocPathEntry[]; markerName: string }
  | undefined {
  const entries: DocPathEntry[] = []
  let nextId = PATH_RESOURCE_BASE_ID
  for (const layer of layers) {
    if (!layer.path || !layer.path.points || layer.path.points.length === 0) continue
    if (nextId > PATH_RESOURCE_MAX_ID) break
    entries.push({ id: nextId, name: layer.name || `Path ${nextId - PATH_RESOURCE_BASE_ID + 1}`, path: layer.path })
    nextId += 1
  }
  if (entries.length === 0) return undefined
  // Encode the full set into a marker that's attached to the doc name.
  const tokens = entries
    .map((e) => `__pspath:${e.name.replace(/:/g, "_")}:${encodeBase64({ id: e.id, path: e.path })}__`)
    .join(" ")
  return { entries, markerName: tokens }
}

export function psdResourceToAppPaths(psd: Psd): Array<{ name: string; path: PathProps }> {
  const found: Array<{ name: string; path: PathProps }> = []
  // ag-psd surfaces the doc additionalInfo `name` and image resources separately.
  // We look for marker tags anywhere we can find them: the document `name` field (if any)
  // and any pseudo-marker layer the writer left behind.
  const candidates: string[] = []
  if (psd.name) candidates.push(psd.name)
  // Also look at any single hidden marker layer the writer may have appended.
  const visit = (layers: PsdLayer[] | undefined) => {
    if (!layers) return
    for (const layer of layers) {
      if (layer.name) candidates.push(layer.name)
      if (layer.children) visit(layer.children)
    }
  }
  visit(psd.children)

  const seen = new Set<string>()
  for (const candidate of candidates) {
    PATH_MARKER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PATH_MARKER_RE.exec(candidate)) !== null) {
      const name = m[1]
      const payload = decodeBase64(m[2])
      if (
        payload &&
        typeof payload === "object" &&
        "path" in (payload as Record<string, unknown>) &&
        (payload as { path: PathProps }).path?.points
      ) {
        const key = `${name}:${m[2]}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ name, path: (payload as { path: PathProps }).path })
      }
    }
  }
  return found
}
