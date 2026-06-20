import type { CustomShapeId, PathProps, Selection, ShapeProps, TextProps, WarpStyle } from "./types"
import { buildCanvasFont, buildTypographyRenderPlan } from "./typography-engine"
import { appendPathToCanvas, createDefaultShapeAppearance, drawSmoothPolygon, drawStar, shapeToEditablePath } from "./vector-path-operations"
import { makeCanvas } from "./canvas-utils"
import { hexToRgb } from "./color-utils"
import {
  buildOfflineObjectAwareSelectionMaskData,
  borderMaskData as borderMaskDataPure,
  contractMaskData as contractMaskDataPure,
  expandMaskData as expandMaskDataPure,
  extractMaskContourPaths,
  featherMaskData as featherMaskDataPure,
  selectionMaskToPathCandidates,
  smoothMaskData as smoothMaskDataPure,
  transformSelectionMaskData as transformSelectionMaskDataPure,
  type OfflineObjectAwareSelectionResult,
  type MaskContourOptions,
  type MaskContourPath,
} from "./selection-algorithms"

export { makeCanvas, hexToRgb }
export { floodFillMask, paintBucketFill } from "./tool-helpers/flood-fill"
export { liquifyWarp, perspectiveUnwarp } from "./tool-helpers/perspective-liquify"
export { magneticLassoSnap, magneticLassoTrace } from "./tool-helpers/magnetic-lasso"
export type { MagneticLassoSnapOptions } from "./tool-helpers/magnetic-lasso"

/* ---------------------------------------------------------------- */
/*  TEXT                                                              */
/* ---------------------------------------------------------------- */

export function rasterizeText(canvas: HTMLCanvasElement, t: TextProps) {
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Resolve effective size for super/subscript
  let effectiveSize = t.size
  let baselineOffset = t.baselineShift ?? 0
  if (t.superscript) { effectiveSize = t.size * 0.58; baselineOffset -= t.size * 0.33 }
  if (t.subscript) { effectiveSize = t.size * 0.58; baselineOffset += t.size * 0.15 }

  const renderText = { ...t, size: effectiveSize }
  const plan = buildTypographyRenderPlan(renderText)
  const style = plan.cssFont
  ctx.font = style
  ctx.fillStyle = t.color
  ctx.textBaseline = "top"
  ctx.imageSmoothingEnabled = plan.renderHints.imageSmoothingEnabled
  ctx.textRendering = plan.renderHints.textRendering
  ctx.fontFeatureSettings = plan.fontFeatureSettings
  ctx.fontVariationSettings = plan.fontVariationSettings
  ctx.fontVariantCaps = plan.fontVariantCaps
  ctx.fontVariantLigatures = plan.fontVariantLigatures
  ctx.letterSpacing = plan.letterSpacing

  const lineHeight = t.leading ?? effectiveSize * 1.2
  const trackingPx = (t.tracking ?? 0) / 1000 * effectiveSize
  const kerningPx = typeof t.kerning === "number" ? (t.kerning / 1000 * effectiveSize) : 0

  // Text justification alignment
  const justify = t.justify ?? t.align ?? "left"
  const baseAlign = justify.startsWith("justify") ? "left" : justify as CanvasTextAlign
  const isJustified = justify.startsWith("justify")

  // Apply content transforms
  let content = plan.content
  if (t.allCaps) content = content.toUpperCase()
  if (t.ligatures === false) {
    ctx.fontKerning = "none"
  } else {
    ctx.fontKerning = t.kerning === "optical" ? "normal" : "auto"
  }
  ctx.fontKerning = plan.fontKerning

  const hasShapeClip = !!t.textShape
  if (hasShapeClip && t.textShape) {
    ctx.save()
    appendShapePath(ctx, t.textShape)
    ctx.clip()
  }
  const restoreClip = () => {
    if (hasShapeClip) ctx.restore()
  }

  if (t.textPath && t.textPath.length >= 2) {
    renderTextOnPath(ctx, content, t.textPath, t, effectiveSize, trackingPx + kerningPx, baselineOffset)
    restoreClip()
    return
  }

  if (t.vertical) {
    renderVerticalText(ctx, content, t, effectiveSize, lineHeight, trackingPx + kerningPx, baselineOffset)
    restoreClip()
    return
  }

  // If a non-trivial warp is set, rasterize to offscreen then warp
  const warp = t.warp
  if (warp && warp.style !== "none" && (warp.bend !== 0 || warp.horizontal !== 0 || warp.vertical !== 0)) {
    // Render unwraped text to offscreen canvas first
    const lines = buildTextLines(ctx, content, t.boxWidth, trackingPx + kerningPx)
    const spaceBefore = t.spaceBefore ?? 0
    const spaceAfter = t.spaceAfter ?? 0
    const totalH = lineHeight * lines.length + spaceBefore + spaceAfter + 16
    const off = makeCanvas(canvas.width, totalH)
    const octx = off.getContext("2d")!
    octx.font = style
    octx.fillStyle = t.color
    octx.textBaseline = "top"
    octx.textAlign = baseAlign
    let cy = spaceBefore
    for (const line of lines) {
      renderLineAdvanced(octx, line, t.x + (t.indentLeft ?? 0), cy + baselineOffset, effectiveSize, trackingPx, kerningPx, t, isJustified, canvas.width)
      cy += lineHeight
    }
    drawWarped(ctx, off, t.x, t.y, warp, canvas.width, canvas.height, t.size)
    restoreClip()
    return
  }

  const lines = buildTextLines(ctx, content, t.boxWidth, trackingPx + kerningPx)
  renderTextExtrusionPreview(ctx, lines, t, effectiveSize, lineHeight, trackingPx, kerningPx, baselineOffset)
  let cy = t.y + textShapeVerticalOffset(t, lineHeight, lines.length) + (t.spaceBefore ?? 0)
  for (let li = 0; li < lines.length; li++) {
    const indent = li === 0 ? (t.indentFirst ?? 0) : 0
    const leftIndent = t.indentLeft ?? 0
    const xPos = t.x + leftIndent + indent
    renderLineAdvanced(ctx, lines[li], xPos, cy + baselineOffset, effectiveSize, trackingPx, kerningPx, t, isJustified, (t.boxWidth ?? canvas.width) - leftIndent - (t.indentRight ?? 0))
    cy += lineHeight + (t.spaceAfter ?? 0)
    if (t.boxHeight && cy > t.y + t.boxHeight) break
  }
  restoreClip()
}

function textShapeVerticalOffset(t: TextProps, lineHeight: number, lineCount: number) {
  if (!t.textShape || !t.boxHeight || !t.textShapeVerticalAlign || t.textShapeVerticalAlign === "top") return 0
  const contentHeight = lineHeight * Math.max(1, lineCount) + (t.spaceBefore ?? 0) + (t.spaceAfter ?? 0)
  const free = Math.max(0, t.boxHeight - contentHeight)
  return t.textShapeVerticalAlign === "middle" ? free / 2 : free
}

function appendShapePath(ctx: CanvasRenderingContext2D, s: ShapeProps) {
  ctx.beginPath()
  if (s.components?.length || s.computedPath) {
    appendPathToCanvas(ctx, shapeToEditablePath(s))
  } else if (s.type === "custom") {
    customShapePath(ctx, (s.customId ?? "star5") as CustomShapeId, s.x, s.y, s.w, s.h)
  } else if (s.type === "polygon") {
    drawSmoothPolygon(ctx, s)
  } else if (s.type === "star") {
    drawStar(ctx, s)
  } else {
    appendPathToCanvas(ctx, shapeToEditablePath(s))
  }
}

function hexToRgbaString(hex: string, alpha: number) {
  const c = hexToRgb(hex)
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
}

function renderTextExtrusionPreview(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  t: TextProps,
  size: number,
  lineHeight: number,
  trackingPx: number,
  kerningPx: number,
  baselineOffset: number,
) {
  const extrusion = t.extrusion
  if (!extrusion?.enabled || extrusion.depth <= 0) return
  const steps = Math.min(48, Math.max(2, Math.round(extrusion.depth / 2)))
  const angle = (extrusion.angle * Math.PI) / 180
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const color = extrusion.color ?? t.color
  const justify = t.justify ?? t.align ?? "left"
  const isJustified = justify.startsWith("justify")
  const maxWidth = t.boxWidth ?? ctx.canvas.width
  ctx.save()
  ctx.font = buildCanvasFont({ ...t, size })
  ctx.fillStyle = hexToRgbaString(color, 0.36)
  for (let step = steps; step >= 1; step--) {
    const offset = (step / steps) * extrusion.depth
    let cy = t.y + (t.spaceBefore ?? 0)
    for (let li = 0; li < lines.length; li++) {
      const indent = li === 0 ? (t.indentFirst ?? 0) : 0
      const leftIndent = t.indentLeft ?? 0
      renderLineAdvanced(
        ctx,
        lines[li],
        t.x + leftIndent + indent + dx * offset,
        cy + baselineOffset + dy * offset,
        size,
        trackingPx,
        kerningPx,
        t,
        isJustified,
        maxWidth - leftIndent - (t.indentRight ?? 0),
      )
      cy += lineHeight + (t.spaceAfter ?? 0)
      if (t.boxHeight && cy > t.y + t.boxHeight) break
    }
  }
  ctx.restore()
  ctx.fillStyle = t.color
  ctx.font = buildCanvasFont({ ...t, size })
}

function renderVerticalText(
  ctx: CanvasRenderingContext2D,
  content: string,
  t: TextProps,
  size: number,
  lineHeight: number,
  spacing: number,
  baselineOffset: number,
) {
  const columns = content.split("\n")
  const columnGap = Math.max(0, t.verticalColumnGap ?? lineHeight)
  const direction = t.verticalWritingMode === "lr" ? 1 : -1
  const punctuationTighten = t.mojikumi === "compact" ? -size * 0.08 : t.mojikumi === "loose" ? size * 0.08 : 0
  const orientation = t.textOrientation ?? (t.tateChuYoko ? "mixed" : "upright")
  const glyphScale = Math.max(0.1, Math.min(4, t.verticalGlyphScale ?? 1))
  const glyphSpacing = t.verticalGlyphSpacing ?? 0
  const proportional = t.verticalUseProportionalMetrics === true
  ctx.save()
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = t.color
  for (let col = 0; col < columns.length; col++) {
    const column = columns[col]
    const x = t.x + col * columnGap * direction
    const units = verticalTextUnits(column, orientation, t.tateChuYoko === true)
    const columnHeight = units.reduce((sum, unit) => sum + verticalUnitAdvance(ctx, unit, size, spacing + glyphSpacing, punctuationTighten, glyphScale, proportional), 0)
    let y = t.y + verticalFlowOffset(t, columnHeight)
    for (const unit of units) {
      const advance = verticalUnitAdvance(ctx, unit, size, spacing + glyphSpacing, punctuationTighten, glyphScale, proportional)
      if (verticalUnitIsSideways(unit, orientation)) {
        ctx.save()
        ctx.translate(x, y + size / 2 + baselineOffset)
        ctx.rotate(Math.PI / 2)
        ctx.scale(glyphScale, glyphScale)
        ctx.fillText(unit, 0, 0)
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(x, y + size / 2 + baselineOffset)
        ctx.scale(glyphScale, glyphScale)
        ctx.fillText(unit, 0, 0)
        ctx.restore()
      }
      y += advance
      if (t.boxHeight && y > t.y + t.boxHeight) break
    }
  }
  ctx.restore()
}

function verticalTextUnits(column: string, orientation: NonNullable<TextProps["textOrientation"]>, tateChuYoko: boolean) {
  if (orientation !== "mixed") return [...column]
  return tateChuYoko ? column.match(/[A-Za-z0-9]{1,4}|[^A-Za-z0-9]/g) ?? [] : [...column]
}

function verticalUnitIsSideways(unit: string, orientation: NonNullable<TextProps["textOrientation"]>) {
  if (orientation === "sideways") return true
  if (orientation === "upright") return false
  return /^[A-Za-z0-9]$/.test(unit)
}

function verticalUnitAdvance(
  ctx: CanvasRenderingContext2D,
  unit: string,
  size: number,
  spacing: number,
  punctuationTighten: number,
  glyphScale = 1,
  proportional = false,
) {
  const measured = typeof ctx.measureText === "function" ? ctx.measureText(unit).width : size
  const tighten = /^[A-Za-z0-9]$/.test(unit) ? 0 : punctuationTighten
  const base = proportional ? measured : Math.max(size, measured)
  return Math.max(size * 0.2, base * glyphScale) + spacing + 2 + tighten
}

function verticalFlowOffset(t: TextProps, contentHeight: number) {
  if (!t.boxHeight) return 0
  const align = t.verticalAlign ?? t.textShapeVerticalAlign ?? "top"
  if (align === "top") return 0
  const free = Math.max(0, t.boxHeight - contentHeight)
  return align === "middle" ? free / 2 : free
}

function renderTextOnPath(
  ctx: CanvasRenderingContext2D,
  content: string,
  points: { x: number; y: number }[],
  t: TextProps,
  size: number,
  spacing: number,
  baselineOffset: number,
) {
  const segments: { x1: number; y1: number; x2: number; y2: number; len: number; start: number }[] = []
  let total = 0
  const pts = t.textPathClosed && points.length >= 2
    ? [...points, points[0]]
    : points
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= 0) continue
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, start: total })
    total += len
  }
  if (!segments.length) return
  const textWidth = measureLineWidth(ctx, content, spacing)
  const align = t.textPathAlign ?? t.align
  const startOffset = t.textPathStartOffset ?? 0
  let cursor =
    align === "center" || align === "right" || align === "end"
      ? align === "center"
        ? Math.max(0, (total - textWidth) / 2)
        : Math.max(0, total - textWidth)
      : 0
  cursor += startOffset
  // For a closed path with negative cursor, wrap into [0, total).
  if (t.textPathClosed) {
    cursor = ((cursor % total) + total) % total
  }
  const flip = t.textPathFlip === true
  const baselinePathOffset = (t.textPathBaselineOffset ?? 0) - baselineOffset
  ctx.save()
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = t.color
  for (const ch of content) {
    if (ch === "\n") {
      cursor += size
      continue
    }
    const advance = ctx.measureText(ch).width + spacing
    let mid = cursor + advance / 2
    if (t.textPathClosed) mid = ((mid % total) + total) % total
    const seg = segmentAtLength(segments, mid)
    if (!seg) break
    const local = (mid - seg.start) / seg.len
    const x = seg.x1 + (seg.x2 - seg.x1) * local
    const y = seg.y1 + (seg.y2 - seg.y1) * local
    let angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1)
    if (flip) angle += Math.PI
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    // Lift glyph above the path (negative = above, positive = below)
    const lift = flip ? baselinePathOffset : -baselinePathOffset
    ctx.fillText(ch, 0, lift)
    if (t.underline) {
      const w = ctx.measureText(ch).width
      const u = size * 0.08
      ctx.fillRect(-w / 2, lift + size * 0.45, w, u)
    }
    if (t.strikethrough) {
      const w = ctx.measureText(ch).width
      const u = size * 0.07
      ctx.fillRect(-w / 2, lift - size * 0.05, w, u)
    }
    ctx.restore()
    cursor += advance
    if (!t.textPathClosed && cursor > total) break
  }
  ctx.restore()
}

function segmentAtLength(
  segments: { x1: number; y1: number; x2: number; y2: number; len: number; start: number }[],
  distance: number,
) {
  for (const segment of segments) {
    if (distance <= segment.start + segment.len) return segment
  }
  return segments[segments.length - 1]
}

function buildTextLines(ctx: CanvasRenderingContext2D, content: string, maxWidth: number | undefined, charSpacing: number) {
  const rawLines = content.split("\n")
  if (!maxWidth || maxWidth <= 0) return rawLines
  const lines: string[] = []
  for (const rawLine of rawLines) {
    const words = rawLine.split(/(\s+)/)
    let line = ""
    for (const word of words) {
      const next = line + word
      if (line && measureLineWidth(ctx, next.trimEnd(), charSpacing) > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = next
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function renderLineAdvanced(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  size: number,
  trackingPx: number,
  kerningPx: number,
  t: TextProps,
  isJustified: boolean,
  maxWidth: number,
) {
  if (t.smallCaps) {
    line = line.replace(/[a-z]/g, (c) => c.toUpperCase())
  }

  // If no tracking/kerning, use fast path
  const hasCharSpacing = trackingPx !== 0 || kerningPx !== 0

  if (!hasCharSpacing && !t.underline && !t.strikethrough && !isJustified) {
    ctx.textAlign = (t.justify?.startsWith("justify") ? "left" : t.justify ?? t.align ?? "left") as CanvasTextAlign
    ctx.fillText(line, x, y)
    return
  }

  // Calculate justified word spacing
  let wordSpacingExtra = 0
  if (isJustified && line.trim().length > 0) {
    const words = line.split(" ")
    if (words.length > 1) {
      const naturalWidth = measureLineWidth(ctx, line, trackingPx + kerningPx)
      const gap = maxWidth - naturalWidth
      wordSpacingExtra = gap / (words.length - 1)
    }
  }

  // Render character by character
  ctx.textAlign = "left"
  let cx = x
  const lineStartX = cx
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    let charSize = size
    if (t.smallCaps && ch === ch.toUpperCase() && ch !== ch.toLowerCase()) {
      // Already uppercased; if original was lowercase, render smaller
      charSize = size * 0.75
      ctx.font = buildCanvasFont({ ...t, size: charSize })
    }
    ctx.fillText(ch, cx, y)
    const charW = ctx.measureText(ch).width
    cx += charW + trackingPx + kerningPx
    if (ch === " ") cx += wordSpacingExtra
    if (charSize !== size) {
      ctx.font = buildCanvasFont({ ...t, size })
    }
  }
  const lineEndX = cx

  // Draw underline
  if (t.underline) {
    ctx.save()
    ctx.strokeStyle = t.color
    ctx.lineWidth = Math.max(1, size / 16)
    ctx.beginPath()
    ctx.moveTo(lineStartX, y + size * 1.05)
    ctx.lineTo(lineEndX - trackingPx - kerningPx, y + size * 1.05)
    ctx.stroke()
    ctx.restore()
  }

  // Draw strikethrough
  if (t.strikethrough) {
    ctx.save()
    ctx.strokeStyle = t.color
    ctx.lineWidth = Math.max(1, size / 16)
    ctx.beginPath()
    ctx.moveTo(lineStartX, y + size * 0.45)
    ctx.lineTo(lineEndX - trackingPx - kerningPx, y + size * 0.45)
    ctx.stroke()
    ctx.restore()
  }
}

function measureLineWidth(ctx: CanvasRenderingContext2D, line: string, charSpacing: number): number {
  let width = 0
  for (let i = 0; i < line.length; i++) {
    width += ctx.measureText(line[i]).width + (i < line.length - 1 ? charSpacing : 0)
  }
  return width
}

function drawWarped(
  destCtx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  ox: number,
  oy: number,
  warp: NonNullable<TextProps["warp"]>,
  destW: number,
  destH: number,
  baseSize: number,
) {
  const slices = 40
  const w = src.width
  const h = src.height
  for (let i = 0; i < slices; i++) {
    const t = i / slices
    const tn = (i + 1) / slices
    const sliceX = w * t
    const sliceW = w / slices
    const offsetA = warpOffset(warp.style, t, warp.bend, baseSize)
    const offsetB = warpOffset(warp.style, tn, warp.bend, baseSize)
    const horiz = warp.horizontal * baseSize * 0.5
    const vert = warp.vertical * baseSize * 0.5
    destCtx.save()
    destCtx.beginPath()
    destCtx.moveTo(sliceX + horiz * t, offsetA + vert * t + oy)
    destCtx.lineTo(sliceX + sliceW + horiz * tn, offsetB + vert * tn + oy)
    destCtx.lineTo(sliceX + sliceW + horiz * tn, offsetB + vert * tn + oy + h)
    destCtx.lineTo(sliceX + horiz * t, offsetA + vert * t + oy + h)
    destCtx.closePath()
    destCtx.clip()
    const skew = (offsetB - offsetA) / sliceW
    destCtx.transform(1, skew, 0, 1, 0, 0)
    destCtx.drawImage(src, sliceX, 0, sliceW, h, sliceX + horiz * t, offsetA + vert * t + oy - sliceX * skew, sliceW, h)
    destCtx.restore()
  }
  // Clip to destination size
  void destW
  void destH
}

function warpOffset(style: WarpStyle, t: number, bend: number, base: number): number {
  const k = bend
  const a = base * 0.6
  switch (style) {
    case "arc":
      return -Math.sin(Math.PI * t) * a * k
    case "arch":
      return -Math.cos((t - 0.5) * Math.PI) * a * k
    case "bulge":
      return -Math.sin(Math.PI * t) * a * k * 0.5 - (t - 0.5) * (t - 0.5) * a * k
    case "flag":
      return Math.sin(t * Math.PI * 4) * a * k * 0.4
    case "wave":
      return Math.sin(t * Math.PI * 6) * a * k * 0.5
    case "fish":
      return Math.sin(Math.PI * t) * a * k * 0.3 - Math.cos(Math.PI * t * 2) * a * k * 0.2
    case "rise":
      return -t * a * k
    case "squeeze":
      return Math.sin(Math.PI * t) * a * k * (t > 0.5 ? -1 : 1) * 0.4
    case "twist":
      return Math.sin(t * Math.PI) * a * k * Math.sign(t - 0.5) * 0.6
    default:
      return 0
  }
}

/* ---------------------------------------------------------------- */
/*  SHAPES                                                            */
/* ---------------------------------------------------------------- */

export function rasterizeShape(canvas: HTMLCanvasElement, s: ShapeProps) {
  const ctx = canvas.getContext("2d")!
  if ((s.booleanOperation ?? "new") === "new" || s.components?.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  if (s.components?.length) {
    drawShapeAppearance(ctx, s, s)
    return
  }

  const components = s.components?.length
    ? s.components
    : [{
        id: "component-single",
        operation: (s.booleanOperation && s.booleanOperation !== "new" ? s.booleanOperation : "unite") as "unite" | "subtract" | "intersect" | "exclude",
        shape: s,
      }]

  for (const component of components) {
    ctx.save()
    ctx.globalCompositeOperation = compositeForShapeOperation(component.operation)
    drawShapeAppearance(ctx, component.shape, s)
    ctx.restore()
  }
}

function compositeForShapeOperation(operation: "unite" | "subtract" | "intersect" | "exclude"): GlobalCompositeOperation {
  switch (operation) {
    case "subtract":
      return "destination-out"
    case "intersect":
      return "destination-in"
    case "exclude":
      return "xor"
    case "unite":
    default:
      return "source-over"
  }
}

function drawShapeAppearance(ctx: CanvasRenderingContext2D, geometry: ShapeProps, appearanceSource: ShapeProps) {
  // Apply rotation around the shape center if requested.
  const rotation = geometry.rotation ?? 0
  if (rotation) {
    const rcx = geometry.x + geometry.w / 2
    const rcy = geometry.y + geometry.h / 2
    ctx.translate(rcx, rcy)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.translate(-rcx, -rcy)
  }

  const appearance = createDefaultShapeAppearance(appearanceSource)
  for (const fill of appearance.fills) {
    if (!fill.enabled || fill.opacity <= 0) continue
    ctx.save()
    appendShapePath(ctx, geometry)
    ctx.globalAlpha *= clamp(fill.opacity, 0, 1)
    ctx.fillStyle = fill.color
    ctx.fill("evenodd")
    ctx.restore()
  }
  for (const stroke of appearance.strokes) {
    if (!stroke.enabled || stroke.opacity <= 0 || stroke.width <= 0) continue
    ctx.save()
    appendShapePath(ctx, geometry)
    ctx.globalAlpha *= clamp(stroke.opacity, 0, 1)
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.alignment === "inside" || stroke.alignment === "outside" ? stroke.width * 2 : stroke.width
    ctx.lineCap = stroke.lineCap ?? "butt"
    ctx.lineJoin = stroke.lineJoin ?? "miter"
    if (stroke.dash?.length) ctx.setLineDash(stroke.dash)
    if (stroke.alignment === "inside") {
      ctx.clip("evenodd")
      appendShapePath(ctx, geometry)
    }
    ctx.stroke()
    ctx.restore()
  }
}

/** Custom-shape geometry library. Each shape is normalized to (x, y, w, h). */
export function customShapePath(
  ctx: CanvasRenderingContext2D,
  id: CustomShapeId,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cx = x + w / 2
  const cy = y + h / 2
  switch (id) {
    case "star5":
    case "star6": {
      const points = id === "star5" ? 5 : 6
      const outer = Math.min(w, h) / 2
      const inner = outer * 0.45
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(a) * r * (w / Math.min(w, h))
        const py = cy + Math.sin(a) * r * (h / Math.min(w, h))
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case "heart": {
      const top = y + h * 0.25
      ctx.moveTo(cx, y + h)
      ctx.bezierCurveTo(x - w * 0.1, top + h * 0.4, x + w * 0.1, y, cx, top)
      ctx.bezierCurveTo(x + w * 0.9, y, x + w * 1.1, top + h * 0.4, cx, y + h)
      ctx.closePath()
      break
    }
    case "arrow-right": {
      ctx.moveTo(x, y + h * 0.33)
      ctx.lineTo(x + w * 0.66, y + h * 0.33)
      ctx.lineTo(x + w * 0.66, y)
      ctx.lineTo(x + w, cy)
      ctx.lineTo(x + w * 0.66, y + h)
      ctx.lineTo(x + w * 0.66, y + h * 0.66)
      ctx.lineTo(x, y + h * 0.66)
      ctx.closePath()
      break
    }
    case "arrow-left": {
      ctx.moveTo(x + w, y + h * 0.33)
      ctx.lineTo(x + w * 0.34, y + h * 0.33)
      ctx.lineTo(x + w * 0.34, y)
      ctx.lineTo(x, cy)
      ctx.lineTo(x + w * 0.34, y + h)
      ctx.lineTo(x + w * 0.34, y + h * 0.66)
      ctx.lineTo(x + w, y + h * 0.66)
      ctx.closePath()
      break
    }
    case "arrow-up": {
      ctx.moveTo(x + w * 0.33, y + h)
      ctx.lineTo(x + w * 0.33, y + h * 0.34)
      ctx.lineTo(x, y + h * 0.34)
      ctx.lineTo(cx, y)
      ctx.lineTo(x + w, y + h * 0.34)
      ctx.lineTo(x + w * 0.66, y + h * 0.34)
      ctx.lineTo(x + w * 0.66, y + h)
      ctx.closePath()
      break
    }
    case "arrow-down": {
      ctx.moveTo(x + w * 0.33, y)
      ctx.lineTo(x + w * 0.33, y + h * 0.66)
      ctx.lineTo(x, y + h * 0.66)
      ctx.lineTo(cx, y + h)
      ctx.lineTo(x + w, y + h * 0.66)
      ctx.lineTo(x + w * 0.66, y + h * 0.66)
      ctx.lineTo(x + w * 0.66, y)
      ctx.closePath()
      break
    }
    case "speech": {
      const r = Math.min(w, h) / 8
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h * 0.7 - r)
      ctx.quadraticCurveTo(x + w, y + h * 0.7, x + w - r, y + h * 0.7)
      ctx.lineTo(x + w * 0.3, y + h * 0.7)
      ctx.lineTo(x + w * 0.18, y + h)
      ctx.lineTo(x + w * 0.22, y + h * 0.7)
      ctx.lineTo(x + r, y + h * 0.7)
      ctx.quadraticCurveTo(x, y + h * 0.7, x, y + h * 0.7 - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      break
    }
    case "check": {
      ctx.moveTo(x, y + h * 0.55)
      ctx.lineTo(x + w * 0.18, y + h * 0.4)
      ctx.lineTo(x + w * 0.4, y + h * 0.7)
      ctx.lineTo(x + w * 0.85, y + h * 0.1)
      ctx.lineTo(x + w, y + h * 0.25)
      ctx.lineTo(x + w * 0.4, y + h * 0.95)
      ctx.closePath()
      break
    }
    case "cross": {
      ctx.moveTo(x + w * 0.05, y + h * 0.2)
      ctx.lineTo(x + w * 0.2, y + h * 0.05)
      ctx.lineTo(cx, cy - h * 0.15)
      ctx.lineTo(x + w * 0.8, y + h * 0.05)
      ctx.lineTo(x + w * 0.95, y + h * 0.2)
      ctx.lineTo(cx + w * 0.15, cy)
      ctx.lineTo(x + w * 0.95, y + h * 0.8)
      ctx.lineTo(x + w * 0.8, y + h * 0.95)
      ctx.lineTo(cx, cy + h * 0.15)
      ctx.lineTo(x + w * 0.2, y + h * 0.95)
      ctx.lineTo(x + w * 0.05, y + h * 0.8)
      ctx.lineTo(cx - w * 0.15, cy)
      ctx.closePath()
      break
    }
    case "lightning": {
      ctx.moveTo(x + w * 0.45, y)
      ctx.lineTo(x + w * 0.05, y + h * 0.55)
      ctx.lineTo(x + w * 0.4, y + h * 0.55)
      ctx.lineTo(x + w * 0.25, y + h)
      ctx.lineTo(x + w * 0.95, y + h * 0.45)
      ctx.lineTo(x + w * 0.55, y + h * 0.45)
      ctx.lineTo(x + w * 0.85, y)
      ctx.closePath()
      break
    }
    case "polygon-hex": {
      const sides = 6
      const r = Math.min(w, h) / 2
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(a) * r * (w / Math.min(w, h))
        const py = cy + Math.sin(a) * r * (h / Math.min(w, h))
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case "polygon-tri": {
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      break
    }
    case "diamond": {
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, cy)
      ctx.lineTo(cx, y + h)
      ctx.lineTo(x, cy)
      ctx.closePath()
      break
    }
  }
}

/* ---------------------------------------------------------------- */
/*  PEN PATHS                                                         */
/* ---------------------------------------------------------------- */

function tracePath(ctx: CanvasRenderingContext2D, path: PathProps) {
  if (path.points.length < 2) return false
  ctx.beginPath()
  appendPathToCanvas(ctx, path)
  return true
}

export function strokePath(
  ctx: CanvasRenderingContext2D,
  path: PathProps,
  color: string,
  width: number,
  fill: boolean,
  fillColor: string,
) {
  if (path.points.length < 2) return
  ctx.save()
  tracePath(ctx, path)
  if (fill) {
    ctx.fillStyle = fillColor
    ctx.fill("evenodd")
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
  ctx.restore()
}

/* ---------------------------------------------------------------- */
/*  CLONE / HEAL / BLUR / SMUDGE / DODGE / BURN                       */
/* ---------------------------------------------------------------- */

/** Stamp a circular brush sample from src to dest. */
export function cloneStamp(
  destCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  radius: number,
  hardness: number,
  alpha: number,
) {
  destCtx.save()
  destCtx.globalAlpha = alpha
  destCtx.beginPath()
  destCtx.arc(dx, dy, radius, 0, Math.PI * 2)
  destCtx.clip()
  // Soft edge via a radial gradient mask
  if (hardness < 100) {
    const off = document.createElement("canvas")
    off.width = radius * 2
    off.height = radius * 2
    const octx = off.getContext("2d")!
    octx.drawImage(
      srcCanvas,
      sx - radius,
      sy - radius,
      radius * 2,
      radius * 2,
      0,
      0,
      radius * 2,
      radius * 2,
    )
    const grad = octx.createRadialGradient(radius, radius, radius * (hardness / 100), radius, radius, radius)
    grad.addColorStop(0, "rgba(0,0,0,1)")
    grad.addColorStop(1, "rgba(0,0,0,0)")
    octx.globalCompositeOperation = "destination-in"
    octx.fillStyle = grad
    octx.fillRect(0, 0, radius * 2, radius * 2)
    destCtx.drawImage(off, dx - radius, dy - radius)
  } else {
    destCtx.drawImage(
      srcCanvas,
      sx - radius,
      sy - radius,
      radius * 2,
      radius * 2,
      dx - radius,
      dy - radius,
      radius * 2,
      radius * 2,
    )
  }
  destCtx.restore()
}

function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function imageIndex(x: number, y: number, width: number) {
  return (y * width + x) * 4
}

function buildFillAlpha(
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
  mask?: ImageData,
) {
  const alpha = new Uint8Array(width * height)
  if (mask) {
    const mw = Math.min(width, mask.width)
    const mh = Math.min(height, mask.height)
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        alpha[y * width + x] = mask.data[(y * mask.width + x) * 4 + 3]
      }
    }
    return alpha
  }

  const x0 = Math.max(0, Math.floor(bounds.x))
  const y0 = Math.max(0, Math.floor(bounds.y))
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.w))
  const y1 = Math.min(height, Math.ceil(bounds.y + bounds.h))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) alpha[y * width + x] = 255
  }
  return alpha
}

function alphaBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold = MASK_THRESHOLD,
) {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= threshold) continue
      any = true
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

function hasOutsideNeighbor(alpha: Uint8Array, width: number, height: number, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
      if (alpha[ny * width + nx] <= MASK_THRESHOLD) return true
    }
  }
  return false
}

function pseudoRandomIndex(seed: number, max: number) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return Math.abs(x) % max
}

function sampleImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const sx0 = Math.max(0, Math.min(width - 1, x0))
  const sy0 = Math.max(0, Math.min(height - 1, y0))
  const sx1 = Math.max(0, Math.min(width - 1, x0 + 1))
  const sy1 = Math.max(0, Math.min(height - 1, y0 + 1))
  const i00 = imageIndex(sx0, sy0, width)
  const i10 = imageIndex(sx1, sy0, width)
  const i01 = imageIndex(sx0, sy1, width)
  const i11 = imageIndex(sx1, sy1, width)
  const mix = (c: number) =>
    data[i00 + c] * (1 - tx) * (1 - ty) +
    data[i10 + c] * tx * (1 - ty) +
    data[i01 + c] * (1 - tx) * ty +
    data[i11 + c] * tx * ty
  return { r: mix(0), g: mix(1), b: mix(2), a: mix(3) }
}

export function transformedCloneStamp(
  destCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  sourceAnchor: { x: number; y: number },
  destAnchor: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
  hardness: number,
  alpha: number,
  scale = 100,
  rotation = 0,
  healing = false,
) {
  const r = Math.max(1, Math.floor(radius))
  const width = destCtx.canvas.width
  const height = destCtx.canvas.height
  const x0 = Math.max(0, Math.floor(dx - r))
  const y0 = Math.max(0, Math.floor(dy - r))
  const x1 = Math.min(width, Math.ceil(dx + r))
  const y1 = Math.min(height, Math.ceil(dy + r))
  const sw = x1 - x0
  const sh = y1 - y0
  if (sw <= 0 || sh <= 0) return

  const sctx = srcCanvas.getContext("2d")
  if (!sctx) return

  // Compute the axis-aligned bounding box of the dest rect after mapping
  // through the source transform, so we only load that sub-region of the
  // source canvas instead of the full image (~64MB on a 4K source).
  const scaleFactor = Math.max(0.05, scale / 100)
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const sampleFor = (docX: number, docY: number) => {
    const relX = (docX - destAnchor.x) / scaleFactor
    const relY = (docY - destAnchor.y) / scaleFactor
    return {
      x: sourceAnchor.x + relX * cos - relY * sin,
      y: sourceAnchor.y + relX * sin + relY * cos,
    }
  }
  const c00 = sampleFor(x0, y0)
  const c10 = sampleFor(x1, y0)
  const c01 = sampleFor(x0, y1)
  const c11 = sampleFor(x1, y1)
  // 1px padding to keep bilinear interpolation correct at the edges.
  const srcMinX = Math.max(0, Math.floor(Math.min(c00.x, c10.x, c01.x, c11.x)) - 1)
  const srcMinY = Math.max(0, Math.floor(Math.min(c00.y, c10.y, c01.y, c11.y)) - 1)
  const srcMaxX = Math.min(srcCanvas.width, Math.ceil(Math.max(c00.x, c10.x, c01.x, c11.x)) + 1)
  const srcMaxY = Math.min(srcCanvas.height, Math.ceil(Math.max(c00.y, c10.y, c01.y, c11.y)) + 1)
  const subW = srcMaxX - srcMinX
  const subH = srcMaxY - srcMinY
  if (subW <= 0 || subH <= 0) return
  const src = sctx.getImageData(srcMinX, srcMinY, subW, subH)
  const dest = destCtx.getImageData(x0, y0, sw, sh)
  const original = new Uint8ClampedArray(dest.data)
  const hard = Math.max(0, Math.min(1, hardness / 100))

  let dr = 0
  let dg = 0
  let db = 0
  let borderCount = 0
  if (healing) {
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const docX = x0 + px
        const docY = y0 + py
        const dist = Math.hypot(docX - dx, docY - dy)
        if (dist < r * 0.78 || dist > r) continue
        const sample = transformedCloneSample(src.data, subW, subH, srcMinX, srcMinY, sourceAnchor, destAnchor, docX, docY, scaleFactor, cos, sin)
        const i = (py * sw + px) * 4
        dr += original[i] - sample.r
        dg += original[i + 1] - sample.g
        db += original[i + 2] - sample.b
        borderCount++
      }
    }
    if (borderCount) {
      dr /= borderCount
      dg /= borderCount
      db /= borderCount
    }
  }

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const docX = x0 + px
      const docY = y0 + py
      const dist = Math.hypot(docX - dx, docY - dy)
      if (dist > r) continue
      const falloff =
        hard >= 1 || dist <= r * hard
          ? 1
          : Math.max(0, 1 - (dist - r * hard) / Math.max(1, r * (1 - hard)))
      const sample = transformedCloneSample(src.data, subW, subH, srcMinX, srcMinY, sourceAnchor, destAnchor, docX, docY, scaleFactor, cos, sin)
      const i = (py * sw + px) * 4
      const mix = Math.max(0, Math.min(1, alpha * falloff * (sample.a / 255)))
      dest.data[i] = clampByte(original[i] * (1 - mix) + (sample.r + dr) * mix)
      dest.data[i + 1] = clampByte(original[i + 1] * (1 - mix) + (sample.g + dg) * mix)
      dest.data[i + 2] = clampByte(original[i + 2] * (1 - mix) + (sample.b + db) * mix)
      dest.data[i + 3] = clampByte(original[i + 3] * (1 - mix) + sample.a * mix)
    }
  }
  destCtx.putImageData(dest, x0, y0)
}

function transformedCloneSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  originX: number,
  originY: number,
  sourceAnchor: { x: number; y: number },
  destAnchor: { x: number; y: number },
  docX: number,
  docY: number,
  scaleFactor: number,
  cos: number,
  sin: number,
) {
  const relX = (docX - destAnchor.x) / scaleFactor
  const relY = (docY - destAnchor.y) / scaleFactor
  const sx = sourceAnchor.x + relX * cos - relY * sin
  const sy = sourceAnchor.y + relX * sin + relY * cos
  return sampleImageData(data, width, height, sx - originX, sy - originY)
}

function averageAround(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  accept: (p: number) => boolean,
) {
  const r = Math.max(1, Math.round(radius))
  const x0 = Math.max(0, Math.floor(x - r))
  const y0 = Math.max(0, Math.floor(y - r))
  const x1 = Math.min(width - 1, Math.ceil(x + r))
  const y1 = Math.min(height - 1, Math.ceil(y + r))
  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0
  let count = 0
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (Math.hypot(xx - x, yy - y) > r) continue
      const p = yy * width + xx
      if (!accept(p)) continue
      const i = p * 4
      red += data[i]
      green += data[i + 1]
      blue += data[i + 2]
      alpha += data[i + 3]
      count++
    }
  }
  return count ? { r: red / count, g: green / count, b: blue / count, a: alpha / count, count } : null
}

function fallbackFillColor(
  data: Uint8ClampedArray,
  filled: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  for (const radius of [3, 7, 15, 31]) {
    const avg = averageAround(data, width, height, x, y, radius, (p) => filled[p] > 0)
    if (avg && avg.count > 0) return avg
  }
  return { r: 0, g: 0, b: 0, a: 0, count: 0 }
}

type ContentAwareFillOutputTarget = "current-layer" | "new-layer" | "duplicate-layer" | "selection-preview"
type ContentAwareAdaptation = {
  color: number
  rotation: "none" | "low" | "medium" | "high"
  scale: "none" | "low" | "medium" | "high"
  mirror: boolean
}
type ContentAwareFillOrder = "edge-first" | "center-first" | "randomized"
type ContentAwarePatchControls = {
  patchRadius: number
  searchRadius: number
  candidateBudget: number
  boundaryCandidateBudget: number
  refinementPasses: number
  seamRelaxPasses: number
  coherence: number
  fillOrder: ContentAwareFillOrder
}
type Rect = { x: number; y: number; w: number; h: number }

export interface ContentAwareFillPlanOptions {
  fillBounds: Rect
  mask?: ImageData
  sampling?: {
    mode?: "auto" | "custom" | "all-except-fill"
    regions?: Rect[]
    excludeRegions?: Rect[]
  }
  adaptation?: Partial<ContentAwareAdaptation>
  patch?: Partial<ContentAwarePatchControls>
  outputTarget?: ContentAwareFillOutputTarget
  preview?: boolean
}

export interface ContentAwareFillPlan {
  width: number
  height: number
  fillPixels: number
  samplePixels: number
  sampling: {
    mode: "auto" | "custom" | "all-except-fill"
    bounds: Rect | null
    regions: Rect[]
    excludeRegions: Rect[]
  }
  adaptation: ContentAwareAdaptation
  patch: ContentAwarePatchControls
  outputTarget: ContentAwareFillOutputTarget
  previewData?: {
    width: number
    height: number
    fillAlpha: Uint8Array
    sampleAlpha: Uint8Array
    confidenceAlpha: Uint8Array
    patchPriorityAlpha: Uint8Array
  }
}

function clippedRect(rect: Rect, width: number, height: number): Rect | null {
  const x0 = clamp(Math.floor(rect.x), 0, width)
  const y0 = clamp(Math.floor(rect.y), 0, height)
  const x1 = clamp(Math.ceil(rect.x + rect.w), 0, width)
  const y1 = clamp(Math.ceil(rect.y + rect.h), 0, height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function paintRectAlpha(alpha: Uint8Array, width: number, height: number, rect: Rect, value: number) {
  const clipped = clippedRect(rect, width, height)
  if (!clipped) return
  for (let y = clipped.y; y < clipped.y + clipped.h; y++) {
    for (let x = clipped.x; x < clipped.x + clipped.w; x++) alpha[y * width + x] = value
  }
}

function countAlpha(alpha: Uint8Array, threshold = MASK_THRESHOLD) {
  let count = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) count++
  return count
}

function normalizedFillOrder(value: unknown): ContentAwareFillOrder {
  return value === "center-first" || value === "randomized" ? value : "edge-first"
}

function normalizeContentAwarePatchControls(
  width: number,
  height: number,
  fillBounds: Rect,
  fillPixelCount: number,
  options?: Partial<ContentAwarePatchControls>,
): ContentAwarePatchControls {
  const defaultPatchRadius = fillPixelCount > 100000 ? 2 : fillPixelCount > 35000 ? 3 : 4
  const defaultSearchRadius = Math.max(36, Math.round(Math.max(fillBounds.w, fillBounds.h) * 1.35))
  const maxSearchRadius = Math.max(4, Math.ceil(Math.hypot(width, height)))
  return {
    patchRadius: clamp(Math.round(options?.patchRadius ?? defaultPatchRadius), 1, 10),
    searchRadius: clamp(Math.round(options?.searchRadius ?? defaultSearchRadius), 1, maxSearchRadius),
    candidateBudget: clamp(Math.round(options?.candidateBudget ?? (fillPixelCount > 80000 ? 32 : 56)), 1, 256),
    boundaryCandidateBudget: clamp(Math.round(options?.boundaryCandidateBudget ?? 18), 0, 128),
    refinementPasses: clamp(Math.round(options?.refinementPasses ?? (fillPixelCount > 60000 ? 1 : fillPixelCount > 12000 ? 2 : 3)), 0, 8),
    seamRelaxPasses: clamp(Math.round(options?.seamRelaxPasses ?? 2), 0, 8),
    coherence: clamp(options?.coherence ?? 1, 0, 4),
    fillOrder: normalizedFillOrder(options?.fillOrder),
  }
}

function buildPatchPriorityAlpha(
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  fillPixels: number[],
  distToOutside: Float64Array,
  fillOrder: ContentAwareFillOrder,
) {
  const out = new Uint8Array(width * height)
  let maxDist = 0
  for (const p of fillPixels) maxDist = Math.max(maxDist, distToOutside[p] || 0)
  for (const p of fillPixels) {
    if (fillAlpha[p] <= MASK_THRESHOLD) continue
    const normalized = maxDist <= 0 ? 1 : clamp(distToOutside[p] / maxDist, 0, 1)
    const priority =
      fillOrder === "center-first"
        ? normalized
        : fillOrder === "randomized"
          ? pseudoRandomIndex(p + width * 131 + height * 17, 256) / 255
          : 1 - normalized
    out[p] = clampByte(32 + priority * 223)
  }
  return out
}

function buildSamplingAlpha(width: number, height: number, fillAlpha: Uint8Array, fillBounds: Rect, options: ContentAwareFillPlanOptions["sampling"]) {
  const mode = options?.mode ?? "auto"
  const sampleAlpha = new Uint8Array(width * height)
  const regions = (options?.regions ?? []).map((rect) => clippedRect(rect, width, height)).filter(Boolean) as Rect[]
  const excludeRegions = (options?.excludeRegions ?? []).map((rect) => clippedRect(rect, width, height)).filter(Boolean) as Rect[]

  if (mode === "custom" && regions.length) {
    for (const region of regions) paintRectAlpha(sampleAlpha, width, height, region, 255)
  } else if (mode === "all-except-fill") {
    sampleAlpha.fill(255)
  } else {
    const pad = Math.max(4, Math.round(Math.max(fillBounds.w, fillBounds.h) * 1.5))
    const outer = { x: fillBounds.x - pad, y: fillBounds.y - pad, w: fillBounds.w + pad * 2, h: fillBounds.h + pad * 2 }
    paintRectAlpha(sampleAlpha, width, height, outer, 255)
  }

  for (let i = 0; i < sampleAlpha.length; i++) {
    if (fillAlpha[i] > MASK_THRESHOLD) sampleAlpha[i] = 0
  }
  for (const region of excludeRegions) paintRectAlpha(sampleAlpha, width, height, region, 0)
  return { mode, sampleAlpha, regions, excludeRegions }
}

export function buildContentAwareFillPlan(src: ImageData, options: ContentAwareFillPlanOptions): ContentAwareFillPlan {
  const width = src.width
  const height = src.height
  const fillAlpha = buildFillAlpha(width, height, options.fillBounds, options.mask)
  const fillBounds = alphaBounds(fillAlpha, width, height) ?? clippedRect(options.fillBounds, width, height) ?? { x: 0, y: 0, w: 0, h: 0 }
  const sampling = buildSamplingAlpha(width, height, fillAlpha, fillBounds, options.sampling)
  const fillPixels: number[] = []
  const outside = new Uint8Array(width * height)
  for (let p = 0; p < width * height; p++) {
    if (fillAlpha[p] > MASK_THRESHOLD) fillPixels.push(p)
    else outside[p] = 1
  }
  const distToOutside = distanceToFeature(outside, width, height)
  const patch = normalizeContentAwarePatchControls(width, height, fillBounds, fillPixels.length, options.patch)
  const confidenceAlpha = new Uint8Array(width * height)
  const samplePixels = countAlpha(sampling.sampleAlpha)
  if (samplePixels > 0) {
    for (let p = 0; p < confidenceAlpha.length; p++) {
      if (fillAlpha[p] <= MASK_THRESHOLD) continue
      const x = p % width
      const y = (p - x) / width
      const distToEdge = Math.min(
        Math.abs(x - fillBounds.x),
        Math.abs(y - fillBounds.y),
        Math.abs(fillBounds.x + fillBounds.w - 1 - x),
        Math.abs(fillBounds.y + fillBounds.h - 1 - y),
      )
      confidenceAlpha[p] = clampByte(210 - distToEdge * 24)
    }
  }
  const patchPriorityAlpha = buildPatchPriorityAlpha(fillAlpha, width, height, fillPixels, distToOutside, patch.fillOrder)

  return {
    width,
    height,
    fillPixels: countAlpha(fillAlpha),
    samplePixels,
    sampling: {
      mode: sampling.mode,
      bounds: alphaBounds(sampling.sampleAlpha, width, height),
      regions: sampling.regions,
      excludeRegions: sampling.excludeRegions,
    },
    adaptation: {
      color: clamp(options.adaptation?.color ?? 0.5, 0, 1),
      rotation: options.adaptation?.rotation ?? "none",
      scale: options.adaptation?.scale ?? "none",
      mirror: options.adaptation?.mirror ?? false,
    },
    patch,
    outputTarget: options.outputTarget ?? "current-layer",
    previewData: options.preview
      ? { width, height, fillAlpha, sampleAlpha: sampling.sampleAlpha, confidenceAlpha, patchPriorityAlpha }
      : undefined,
  }
}

function patchMatchScore(
  source: Uint8ClampedArray,
  work: Uint8ClampedArray,
  filled: Uint8Array,
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  radius: number,
  coherence: number,
) {
  if (sx < radius || sy < radius || sx >= width - radius || sy >= height - radius) return Number.POSITIVE_INFINITY
  if (fillAlpha[sy * width + sx] > MASK_THRESHOLD) return Number.POSITIVE_INFINITY

  let score = 0
  let samples = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const txx = tx + dx
      const tyy = ty + dy
      const sxx = sx + dx
      const syy = sy + dy
      if (txx < 0 || tyy < 0 || txx >= width || tyy >= height) continue
      if (sxx < 0 || syy < 0 || sxx >= width || syy >= height) {
        score += 200000
        continue
      }
      const tp = tyy * width + txx
      const sp = syy * width + sxx
      if (fillAlpha[sp] > MASK_THRESHOLD) {
        score += 8500
        continue
      }
      if (!filled[tp]) continue
      const ti = tp * 4
      const si = sp * 4
      const dr = work[ti] - source[si]
      const dg = work[ti + 1] - source[si + 1]
      const db = work[ti + 2] - source[si + 2]
      const da = work[ti + 3] - source[si + 3]
      const centerWeight = 1.3 - Math.hypot(dx, dy) / Math.max(1, radius * 2)
      score += (dr * dr + dg * dg + db * db + da * da * 0.35) * centerWeight
      samples++
    }
  }
  if (samples < Math.max(4, radius * 2)) return Number.POSITIVE_INFINITY
  return score / samples + Math.hypot(tx - sx, ty - sy) * 0.02 * coherence
}

function seamRelax(
  work: Uint8ClampedArray,
  fillAlpha: Uint8Array,
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
  passes: number,
) {
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < outside.length; i++) outside[i] = fillAlpha[i] > MASK_THRESHOLD ? 0 : 1
  const dist = distanceToFeature(outside, width, height)
  const x0 = Math.max(0, bounds.x - 2)
  const y0 = Math.max(0, bounds.y - 2)
  const x1 = Math.min(width, bounds.x + bounds.w + 2)
  const y1 = Math.min(height, bounds.y + bounds.h + 2)
  const maxDist = 16

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8ClampedArray(work)
    for (let y = y0 + 1; y < y1 - 1; y++) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        const p = y * width + x
        if (fillAlpha[p] <= MASK_THRESHOLD || dist[p] > maxDist) continue
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const ni = ((y + dy) * width + x + dx) * 4
            r += work[ni]
            g += work[ni + 1]
            b += work[ni + 2]
            a += work[ni + 3]
            count++
          }
        }
        const i = p * 4
        const edgeBlend = Math.max(0.18, 0.42 * (1 - Math.sqrt(dist[p]) / Math.sqrt(maxDist)))
        next[i] = clampByte(work[i] * (1 - edgeBlend) + (r / count) * edgeBlend)
        next[i + 1] = clampByte(work[i + 1] * (1 - edgeBlend) + (g / count) * edgeBlend)
        next[i + 2] = clampByte(work[i + 2] * (1 - edgeBlend) + (b / count) * edgeBlend)
        next[i + 3] = clampByte(work[i + 3] * (1 - edgeBlend) + (a / count) * edgeBlend)
      }
    }
    work.set(next)
  }
}

/** Patch-synthesis content-aware fill with masked fill order, exemplar search, and seam relaxation. */
export function contentAwareFill(
  canvas: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number },
  mask?: ImageData,
  options?: Omit<ContentAwareFillPlanOptions, "fillBounds" | "mask">,
) {
  const ctx = canvas.getContext("2d")!
  const width = canvas.width
  const height = canvas.height
  if (width <= 0 || height <= 0) return

  const fillAlpha = buildFillAlpha(width, height, bounds, mask)
  const fillBounds = alphaBounds(fillAlpha, width, height)
  if (!fillBounds) return

  const original = ctx.getImageData(0, 0, width, height)
  const sampling = buildSamplingAlpha(width, height, fillAlpha, fillBounds, options?.sampling)
  const source = new Uint8ClampedArray(original.data)
  const work = new Uint8ClampedArray(original.data)
  const filled = new Uint8Array(width * height)
  const outside = new Uint8Array(width * height)
  const fillPixels: number[] = []

  for (let p = 0; p < width * height; p++) {
    if (fillAlpha[p] > MASK_THRESHOLD) {
      fillPixels.push(p)
    } else {
      filled[p] = 1
      outside[p] = 1
    }
  }

  const distToOutside = distanceToFeature(outside, width, height)
  const patch = normalizeContentAwarePatchControls(width, height, fillBounds, fillPixels.length, options?.patch)
  fillPixels.sort((a, b) => {
    if (patch.fillOrder === "center-first") return distToOutside[b] - distToOutside[a]
    if (patch.fillOrder === "randomized") {
      return pseudoRandomIndex(a + 7919, 1 << 20) - pseudoRandomIndex(b + 7919, 1 << 20)
    }
    return distToOutside[a] - distToOutside[b]
  })

  const searchPad = patch.searchRadius
  const sx0 = Math.max(0, fillBounds.x - searchPad)
  const sy0 = Math.max(0, fillBounds.y - searchPad)
  const sx1 = Math.min(width, fillBounds.x + fillBounds.w + searchPad)
  const sy1 = Math.min(height, fillBounds.y + fillBounds.h + searchPad)
  const stride = Math.max(1, Math.floor(Math.max(sx1 - sx0, sy1 - sy0) / 220))
  const sourceCenters: number[] = []
  const boundaryCenters: number[] = []

  for (let y = sy0; y < sy1; y += stride) {
    for (let x = sx0; x < sx1; x += stride) {
      const p = y * width + x
      if (fillAlpha[p] > MASK_THRESHOLD) continue
      if (sampling.sampleAlpha[p] <= MASK_THRESHOLD) continue
      sourceCenters.push(p)
      if (hasOutsideNeighbor(fillAlpha, width, height, x, y)) boundaryCenters.push(p)
    }
  }

  if (!sourceCenters.length) return

  const patchRadius = patch.patchRadius
  const candidateBudget = patch.candidateBudget
  const boundaryBudget = Math.min(patch.boundaryCandidateBudget, boundaryCenters.length)

  // PatchMatch-style neighbour offset cache: for each filled pixel we
  // remember the source it picked, so neighbours can propagate that
  // offset as a candidate. This dramatically improves coherence over
  // pure random search.
  const matchSourceX = new Int32Array(width * height)
  const matchSourceY = new Int32Array(width * height)
  matchSourceX.fill(-1)
  matchSourceY.fill(-1)

  for (let n = 0; n < fillPixels.length; n++) {
    const p = fillPixels[n]
    const x = p % width
    const y = (p - x) / width
    let best = -1
    let bestScore = Number.POSITIVE_INFINITY

    for (let c = 0; c < boundaryBudget; c++) {
      const candidate = boundaryCenters[pseudoRandomIndex(p + c * 7919 + n, boundaryCenters.length)]
      const cx = candidate % width
      const cy = (candidate - cx) / width
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }

    for (let c = 0; c < candidateBudget; c++) {
      const candidate = sourceCenters[pseudoRandomIndex(p + c * 104729 + n * 17, sourceCenters.length)]
      const cx = candidate % width
      const cy = (candidate - cx) / width
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }

    // PatchMatch propagation: try the offsets used by already-filled
    // neighbours. If a neighbour at (-1,0) picked source (sx,sy), then
    // (sx+1,sy) is a strong candidate for the current pixel.
    for (const [ndx, ndy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
      const np = (y + ndy) * width + (x + ndx)
      if (np < 0 || np >= width * height) continue
      const nSx = matchSourceX[np]
      const nSy = matchSourceY[np]
      if (nSx < 0) continue
      const cx = nSx - ndx
      const cy = nSy - ndy
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
      if (score < bestScore) {
        bestScore = score
        best = cy * width + cx
      }
    }

    // PatchMatch random search around the current best (expanding
    // window halved each iteration).
    if (best >= 0) {
      const bx = best % width
      const by = (best - bx) / width
      let radius = Math.max(8, Math.floor(Math.min(width, height) / 4))
      for (let s = 0; s < 5 && radius > 1; s++) {
        const rx = pseudoRandomIndex(p + s * 31337 + n * 27, 1 << 16) / (1 << 15) - 1
        const ry = pseudoRandomIndex(p + s * 17329 + n * 41, 1 << 16) / (1 << 15) - 1
        const cx = Math.round(bx + rx * radius)
        const cy = Math.round(by + ry * radius)
        const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
        if (score < bestScore) {
          bestScore = score
          best = cy * width + cx
        }
        radius = Math.floor(radius / 2)
      }
    }

    const i = p * 4
    if (best >= 0 && Number.isFinite(bestScore)) {
      const bx = best % width
      const by = (best - bx) / width
      const bi = best * 4
      const targetAvg = averageAround(work, width, height, x, y, patchRadius + 2, (ap) => filled[ap] > 0)
      const sourceAvg = averageAround(source, width, height, bx, by, patchRadius + 2, (ap) => sampling.sampleAlpha[ap] > MASK_THRESHOLD)
      const colorAdaptation = clamp(options?.adaptation?.color ?? 0.48, 0, 1)
      const dr = targetAvg && sourceAvg ? (targetAvg.r - sourceAvg.r) * colorAdaptation : 0
      const dg = targetAvg && sourceAvg ? (targetAvg.g - sourceAvg.g) * colorAdaptation : 0
      const db = targetAvg && sourceAvg ? (targetAvg.b - sourceAvg.b) * colorAdaptation : 0
      work[i] = clampByte(source[bi] + dr)
      work[i + 1] = clampByte(source[bi + 1] + dg)
      work[i + 2] = clampByte(source[bi + 2] + db)
      work[i + 3] = source[bi + 3]
      matchSourceX[p] = bx
      matchSourceY[p] = by
    } else {
      const avg = fallbackFillColor(work, filled, width, height, x, y)
      work[i] = clampByte(avg.r)
      work[i + 1] = clampByte(avg.g)
      work[i + 2] = clampByte(avg.b)
      work[i + 3] = clampByte(avg.a || 255)
    }
    filled[p] = 1
  }

  // Iterative coarse-to-fine refinement: re-run the patch search with
  // the now-filled work buffer as the reference, which lets later
  // passes pull in coherent textures from neighbouring patches.
  const refinementPasses = patch.refinementPasses
  for (let pass = 0; pass < refinementPasses; pass++) {
    const reverseStride = 1 + (pass % 2)
    for (let n = 0; n < fillPixels.length; n += reverseStride) {
      const idx = pass % 2 === 0 ? n : fillPixels.length - 1 - n
      if (idx < 0 || idx >= fillPixels.length) continue
      const p = fillPixels[idx]
      const x = p % width
      const y = (p - x) / width
      let best = matchSourceY[p] >= 0 ? matchSourceY[p] * width + matchSourceX[p] : -1
      let bestScore = best >= 0
        ? patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, matchSourceX[p], matchSourceY[p], patchRadius, patch.coherence)
        : Number.POSITIVE_INFINITY

      for (const [ndx, ndy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
        const np = (y + ndy) * width + (x + ndx)
        if (np < 0 || np >= width * height) continue
        const nSx = matchSourceX[np]
        const nSy = matchSourceY[np]
        if (nSx < 0) continue
        const cx = nSx - ndx
        const cy = nSy - ndy
        const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
        if (score < bestScore) {
          bestScore = score
          best = cy * width + cx
        }
      }
      // Random search around best
      if (best >= 0) {
        const bx0 = best % width
        const by0 = (best - bx0) / width
        let radius = Math.max(4, Math.floor(Math.min(width, height) / 8))
        for (let s = 0; s < 3 && radius > 1; s++) {
          const rx = pseudoRandomIndex(p + s * 31337 + pass * 27, 1 << 16) / (1 << 15) - 1
          const ry = pseudoRandomIndex(p + s * 17329 + pass * 41, 1 << 16) / (1 << 15) - 1
          const cx = Math.round(bx0 + rx * radius)
          const cy = Math.round(by0 + ry * radius)
          const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius, patch.coherence)
          if (score < bestScore) {
            bestScore = score
            best = cy * width + cx
          }
          radius = Math.floor(radius / 2)
        }
      }

      if (best >= 0 && Number.isFinite(bestScore)) {
        const bx = best % width
        const by = (best - bx) / width
        const bi = best * 4
        const i = p * 4
        const targetAvg = averageAround(work, width, height, x, y, patchRadius + 2, (ap) => filled[ap] > 0)
        const sourceAvg = averageAround(source, width, height, bx, by, patchRadius + 2, (ap) => sampling.sampleAlpha[ap] > MASK_THRESHOLD)
        const colorAdaptation = clamp(options?.adaptation?.color ?? 0.48, 0, 1)
        const dr = targetAvg && sourceAvg ? (targetAvg.r - sourceAvg.r) * colorAdaptation : 0
        const dg = targetAvg && sourceAvg ? (targetAvg.g - sourceAvg.g) * colorAdaptation : 0
        const db = targetAvg && sourceAvg ? (targetAvg.b - sourceAvg.b) * colorAdaptation : 0
        // Cross-fade with previous pass so refinement doesn't overshoot.
        const blend = 0.55
        work[i] = clampByte(work[i] * (1 - blend) + (source[bi] + dr) * blend)
        work[i + 1] = clampByte(work[i + 1] * (1 - blend) + (source[bi + 1] + dg) * blend)
        work[i + 2] = clampByte(work[i + 2] * (1 - blend) + (source[bi + 2] + db) * blend)
        work[i + 3] = clampByte(work[i + 3] * (1 - blend) + source[bi + 3] * blend)
        matchSourceX[p] = bx
        matchSourceY[p] = by
      }
    }
  }

  seamRelax(work, fillAlpha, width, height, fillBounds, patch.seamRelaxPasses)
  ctx.putImageData(new ImageData(work, width, height), 0, 0)
}

/** Patch tool core: blend a selected target from a dragged source offset with feathered healing. */
export function patchSelectionFromSource(
  canvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  featherRadius = 8,
) {
  const ctx = canvas.getContext("2d")!
  const width = canvas.width
  const height = canvas.height
  const hardMask = selectionMask.getContext("2d")!.getImageData(0, 0, width, height)
  const softMaskCanvas = featherRadius > 0 ? featherMask(selectionMask, featherRadius) : selectionMask
  const softMask = softMaskCanvas.getContext("2d")!.getImageData(0, 0, width, height)
  const alpha = new Uint8Array(width * height)
  for (let p = 0; p < width * height; p++) alpha[p] = hardMask.data[p * 4 + 3]
  const bounds = alphaBounds(alpha, width, height)
  if (!bounds) return

  const original = ctx.getImageData(0, 0, width, height)
  const data = original.data
  const out = new Uint8ClampedArray(data)

  let targetR = 0
  let targetG = 0
  let targetB = 0
  let sourceR = 0
  let sourceG = 0
  let sourceB = 0
  let pairs = 0

  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const p = y * width + x
      if (alpha[p] <= MASK_THRESHOLD || !hasOutsideNeighbor(alpha, width, height, x, y)) continue
      const target = averageAround(data, width, height, x, y, 3, (ap) => alpha[ap] <= MASK_THRESHOLD)
      const sx = x + offsetX
      const sy = y + offsetY
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !target) continue
      const sourceSample = sampleImageData(data, width, height, sx, sy)
      targetR += target.r
      targetG += target.g
      targetB += target.b
      sourceR += sourceSample.r
      sourceG += sourceSample.g
      sourceB += sourceSample.b
      pairs++
    }
  }

  const dr = pairs ? (targetR / pairs - sourceR / pairs) * 0.62 : 0
  const dg = pairs ? (targetG / pairs - sourceG / pairs) * 0.62 : 0
  const db = pairs ? (targetB / pairs - sourceB / pairs) * 0.62 : 0
  const x0 = bounds.x
  const y0 = bounds.y
  const x1 = bounds.x + bounds.w
  const y1 = bounds.y + bounds.h

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x
      if (alpha[p] <= MASK_THRESHOLD) continue
      const sx = x + offsetX
      const sy = y + offsetY
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) continue
      const sample = sampleImageData(data, width, height, sx, sy)
      const i = p * 4
      const mix = Math.max(alpha[p], softMask.data[i + 3]) / 255
      out[i] = clampByte(data[i] * (1 - mix) + (sample.r + dr) * mix)
      out[i + 1] = clampByte(data[i + 1] * (1 - mix) + (sample.g + dg) * mix)
      out[i + 2] = clampByte(data[i + 2] * (1 - mix) + (sample.b + db) * mix)
      out[i + 3] = clampByte(data[i + 3] * (1 - mix) + sample.a * mix)
    }
  }

  seamRelax(out, alpha, width, height, bounds, 1)
  ctx.putImageData(new ImageData(out, width, height), 0, 0)
}

/** Apply a localised blur stamp at (x,y). Pixels outside the circular
 *  brush radius are restored to the original so the blur stays inside
 *  the visible round brush footprint. */
export function blurStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  const r = Math.max(2, Math.floor(radius))
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(w - sx, r * 2)
  const sh = Math.min(h - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const img = ctx.getImageData(sx, sy, sw, sh)
  const src = img.data
  const out = new Uint8ClampedArray(src)
  const cx = x - sx
  const cy = y - sy
  const r2 = r * r
  const feather = Math.max(1, r - 1)
  const feather2 = feather * feather
  const featherDelta = Math.max(1e-6, r - feather)
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ddx = px + 0.5 - cx
      const ddy = py + 0.5 - cy
      const d2 = ddx * ddx + ddy * ddy
      if (d2 > r2) continue
      if (px < 1 || py < 1 || px > sw - 2 || py > sh - 2) continue
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((py + dy) * sw + (px + dx)) * 4
          r0 += src[ni]
          g0 += src[ni + 1]
          b0 += src[ni + 2]
        }
      }
      const i = (py * sw + px) * 4
      const br = r0 / 9
      const bg = g0 / 9
      const bb = b0 / 9
      if (d2 > feather2) {
        const t = (Math.sqrt(d2) - feather) / featherDelta
        const k = 1 - Math.max(0, Math.min(1, t))
        out[i] = br * k + src[i] * (1 - k)
        out[i + 1] = bg * k + src[i + 1] * (1 - k)
        out[i + 2] = bb * k + src[i + 2] * (1 - k)
      } else {
        out[i] = br
        out[i + 1] = bg
        out[i + 2] = bb
      }
    }
  }
  const imgOut = new ImageData(out, sw, sh)
  ctx.putImageData(imgOut, sx, sy, 0, 0, sw, sh)
}

/** Sharpen stamp via 3x3 unsharp. Restricted to the circular brush
 *  radius so straight-edge artefacts don't show outside the brush. */
export function sharpenStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  const r = Math.max(2, Math.floor(radius))
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(w - sx, r * 2)
  const sh = Math.min(h - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const img = ctx.getImageData(sx, sy, sw, sh)
  const src = img.data
  const out = new Uint8ClampedArray(src)
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  const cx = x - sx
  const cy = y - sy
  const r2 = r * r
  for (let py = 1; py < sh - 1; py++) {
    for (let px = 1; px < sw - 1; px++) {
      const ddx = px + 0.5 - cx
      const ddy = py + 0.5 - cy
      if (ddx * ddx + ddy * ddy > r2) continue
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((py + dy) * sw + (px + dx)) * 4
          const kk = k[(dy + 1) * 3 + (dx + 1)]
          r0 += src[ni] * kk
          g0 += src[ni + 1] * kk
          b0 += src[ni + 2] * kk
        }
      }
      const i = (py * sw + px) * 4
      out[i] = Math.max(0, Math.min(255, r0))
      out[i + 1] = Math.max(0, Math.min(255, g0))
      out[i + 2] = Math.max(0, Math.min(255, b0))
    }
  }
  ctx.putImageData(new ImageData(out, sw, sh), sx, sy)
}

/** Smudge: drag colors along the brush path. Uses a small carry-canvas. */
export class SmudgeBuffer {
  carry: HTMLCanvasElement | null = null
  px = 0
  py = 0
  init(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    const r = Math.max(4, radius)
    this.carry = document.createElement("canvas")
    this.carry.width = r * 2
    this.carry.height = r * 2
    const cctx = this.carry.getContext("2d")!
    cctx.drawImage(
      ctx.canvas,
      Math.floor(x - r),
      Math.floor(y - r),
      r * 2,
      r * 2,
      0,
      0,
      r * 2,
      r * 2,
    )
    this.px = x
    this.py = y
  }
  step(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength = 0.5) {
    if (!this.carry) {
      this.init(ctx, x, y, radius)
      return
    }
    const r = Math.max(4, radius)
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.globalAlpha = strength
    ctx.drawImage(this.carry, x - r, y - r)
    ctx.restore()
    // refresh carry
    const cctx = this.carry.getContext("2d")!
    cctx.clearRect(0, 0, this.carry.width, this.carry.height)
    cctx.drawImage(
      ctx.canvas,
      Math.floor(x - r),
      Math.floor(y - r),
      r * 2,
      r * 2,
      0,
      0,
      r * 2,
      r * 2,
    )
    this.px = x
    this.py = y
  }
  reset() {
    this.carry = null
  }
}

/** Dodge / Burn brush stamp: lightens or darkens. */
export function dodgeBurnStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  mode: "dodge" | "burn",
  strength: number,
) {
  const r = Math.max(2, Math.floor(radius))
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(ctx.canvas.width - sx, r * 2)
  const sh = Math.min(ctx.canvas.height - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const img = ctx.getImageData(sx, sy, sw, sh)
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const dx = px - r
      const dy = py - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) continue
      const w = (1 - d / r) * strength
      const i = (py * sw + px) * 4
      if (mode === "dodge") {
        img.data[i] = Math.min(255, img.data[i] + (255 - img.data[i]) * w)
        img.data[i + 1] = Math.min(255, img.data[i + 1] + (255 - img.data[i + 1]) * w)
        img.data[i + 2] = Math.min(255, img.data[i + 2] + (255 - img.data[i + 2]) * w)
      } else {
        img.data[i] = Math.max(0, img.data[i] - img.data[i] * w)
        img.data[i + 1] = Math.max(0, img.data[i + 1] - img.data[i + 1] * w)
        img.data[i + 2] = Math.max(0, img.data[i + 2] - img.data[i + 2] * w)
      }
    }
  }
  ctx.putImageData(img, sx, sy)
}

/** Sponge brush stamp: desaturates opaque pixels inside the brush footprint. */
export function spongeStamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength: number) {
  const r = Math.max(2, Math.floor(radius))
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(ctx.canvas.width - sx, r * 2)
  const sh = Math.min(ctx.canvas.height - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const img = ctx.getImageData(sx, sy, sw, sh)
  const data = img.data
  const rSq = r * r
  // Iterate per-row, derive the analytic horizontal extent of the circle for
  // that scanline, then only touch pixels inside. Avoids wasted work on the
  // corner squares vs. a bounding-box loop and keeps the inner loop predictable.
  for (let py = 0; py < sh; py++) {
    const dy = py - r
    const dy2 = dy * dy
    if (dy2 > rSq) continue
    const halfW = Math.sqrt(rSq - dy2)
    const pxStart = Math.max(0, Math.floor(r - halfW))
    const pxEnd = Math.min(sw - 1, Math.ceil(r + halfW))
    const rowStart = py * sw * 4
    for (let px = pxStart; px <= pxEnd; px++) {
      const i = rowStart + px * 4
      if (data[i + 3] === 0) continue
      const rr = data[i]
      const gg = data[i + 1]
      const bb = data[i + 2]
      const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
      data[i] = rr + (lum - rr) * strength
      data[i + 1] = gg + (lum - gg) * strength
      data[i + 2] = bb + (lum - bb) * strength
    }
  }
  ctx.putImageData(img, sx, sy)
}

/** Healing brush: clone with luminance correction towards target area. */
export function healStamp(
  destCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  radius: number,
) {
  const r = Math.max(2, Math.floor(radius))
  const w = destCtx.canvas.width
  const h = destCtx.canvas.height
  const dxi = Math.max(0, Math.floor(dx - r))
  const dyi = Math.max(0, Math.floor(dy - r))
  const sxi = Math.max(0, Math.floor(sx - r))
  const syi = Math.max(0, Math.floor(sy - r))
  const sw = Math.min(w - dxi, r * 2)
  const sh = Math.min(h - dyi, r * 2)
  if (sw <= 0 || sh <= 0) return
  const dest = destCtx.getImageData(dxi, dyi, sw, sh)
  const sctx = srcCanvas.getContext("2d")
  if (!sctx) return
  const src = sctx.getImageData(
    Math.min(srcCanvas.width - sw, sxi),
    Math.min(srcCanvas.height - sh, syi),
    sw,
    sh,
  )
  // Compute average color difference around the patch border (texture vs target)
  let dr = 0
  let dg = 0
  let db = 0
  let n = 0
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      if (px === 0 || py === 0 || px === sw - 1 || py === sh - 1) {
        const i = (py * sw + px) * 4
        dr += dest.data[i] - src.data[i]
        dg += dest.data[i + 1] - src.data[i + 1]
        db += dest.data[i + 2] - src.data[i + 2]
        n++
      }
    }
  }
  if (n > 0) {
    dr /= n
    dg /= n
    db /= n
  }
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ddx = px - r
      const ddy = py - r
      const d = Math.sqrt(ddx * ddx + ddy * ddy)
      if (d > r) continue
      const t = 1 - d / r
      const i = (py * sw + px) * 4
      dest.data[i] = dest.data[i] * (1 - t) + (src.data[i] + dr) * t
      dest.data[i + 1] = dest.data[i + 1] * (1 - t) + (src.data[i + 1] + dg) * t
      dest.data[i + 2] = dest.data[i + 2] * (1 - t) + (src.data[i + 2] + db) * t
    }
  }
  destCtx.putImageData(dest, dxi, dyi)
}

/* ---------------------------------------------------------------- */
/*  POLYGON RASTERIZATION (lasso)                                     */
/* ---------------------------------------------------------------- */

export function polygonToMask(
  width: number,
  height: number,
  points: { x: number; y: number }[],
): HTMLCanvasElement {
  const c = makeCanvas(width, height)
  if (points.length < 3) return c
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  ctx.fill()
  return c
}

export function polygonBounds(points: { x: number; y: number }[]) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
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

/* ---------------------------------------------------------------- */
/*  COLOR RANGE MASK                                                  */
/* ---------------------------------------------------------------- */

const MASK_THRESHOLD = 8
const DIST_INF = 1e12

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function rgbDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function imagePixel(img: ImageData, x: number, y: number) {
  const cx = clamp(Math.floor(x), 0, img.width - 1)
  const cy = clamp(Math.floor(y), 0, img.height - 1)
  const i = (cy * img.width + cx) * 4
  return {
    r: img.data[i],
    g: img.data[i + 1],
    b: img.data[i + 2],
    a: img.data[i + 3],
  }
}

function localGradient(img: ImageData, x: number, y: number) {
  if (x <= 0 || y <= 0 || x >= img.width - 1 || y >= img.height - 1) return 0
  const lx1 = imagePixel(img, x - 1, y)
  const lx2 = imagePixel(img, x + 1, y)
  const ly1 = imagePixel(img, x, y - 1)
  const ly2 = imagePixel(img, x, y + 1)
  const gx = luma(lx2.r, lx2.g, lx2.b) - luma(lx1.r, lx1.g, lx1.b)
  const gy = luma(ly2.r, ly2.g, ly2.b) - luma(ly1.r, ly1.g, ly1.b)
  return Math.hypot(gx, gy)
}

export function maskBounds(mask: HTMLCanvasElement, threshold = MASK_THRESHOLD) {
  const ctx = mask.getContext("2d")
  if (!ctx) return null
  const w = mask.width
  const h = mask.height
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > threshold) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function selectionToMaskCanvas(
  width: number,
  height: number,
  selection: Selection,
): HTMLCanvasElement | null {
  if (selection.mask) {
    const copy = makeCanvas(width, height)
    copy.getContext("2d")!.drawImage(selection.mask, 0, 0)
    return copy
  }
  if (!selection.bounds) return null
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const b = selection.bounds
  ctx.fillStyle = "#fff"
  if (selection.shape === "ellipse") {
    ctx.beginPath()
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  return mask
}

export function selectionFromMask(
  mask: HTMLCanvasElement,
  shape: Selection["shape"] = "freehand",
  feather?: number,
): Selection {
  const bounds = maskBounds(mask)
  return bounds ? { bounds, shape, mask, feather } : { bounds: null, shape: "rect" }
}

function maskToBinary(mask: HTMLCanvasElement, threshold = MASK_THRESHOLD) {
  const ctx = mask.getContext("2d")!
  const img = ctx.getImageData(0, 0, mask.width, mask.height)
  const out = new Uint8Array(mask.width * mask.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3] > threshold ? 1 : 0
  return out
}

function binaryToMask(binary: Uint8Array, width: number, height: number) {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const out = ctx.createImageData(width, height)
  for (let i = 0; i < binary.length; i++) {
    const a = binary[i] ? 255 : 0
    out.data[i * 4] = 255
    out.data[i * 4 + 1] = 255
    out.data[i * 4 + 2] = 255
    out.data[i * 4 + 3] = a
  }
  ctx.putImageData(out, 0, 0)
  return mask
}

function imageDataToMask(img: ImageData) {
  const mask = makeCanvas(img.width, img.height)
  mask.getContext("2d")!.putImageData(img, 0, 0)
  return mask
}

function maskToAlphaData(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!
  const img = ctx.getImageData(0, 0, mask.width, mask.height)
  const out = new Uint8ClampedArray(mask.width * mask.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3]
  return out
}

function alphaDataToMask(alpha: Uint8ClampedArray, width: number, height: number) {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < alpha.length; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 255
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = alpha[i]
  }
  ctx.putImageData(img, 0, 0)
  return mask
}

function distanceTransform1d(f: Float64Array, n: number) {
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s =
      ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) /
      Math.max(1, 2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s =
        ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) /
        Math.max(1, 2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    d[q] = dx * dx + f[v[k]]
  }
  return d
}

function distanceToFeature(feature: Uint8Array, width: number, height: number) {
  let any = false
  for (let i = 0; i < feature.length; i++) {
    if (feature[i]) {
      any = true
      break
    }
  }
  const out = new Float64Array(width * height)
  if (!any) {
    out.fill(DIST_INF)
    return out
  }

  const tmp = new Float64Array(width * height)
  const f = new Float64Array(Math.max(width, height))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = feature[y * width + x] ? 0 : DIST_INF
    const row = distanceTransform1d(f.subarray(0, width), width)
    for (let x = 0; x < width; x++) tmp[y * width + x] = row[x]
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = tmp[y * width + x]
    const col = distanceTransform1d(f.subarray(0, height), height)
    for (let y = 0; y < height; y++) out[y * width + x] = col[y]
  }
  return out
}

export function expandSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    expandMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function contractSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    contractMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function borderSelectionMask(mask: HTMLCanvasElement, width: number): HTMLCanvasElement {
  return alphaDataToMask(
    borderMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, width, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function smoothSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    smoothMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function transformSelectionMask(
  mask: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
  rotationDeg: number,
  smoothing = true,
  extras?: { scaleX?: number; scaleY?: number; translateX?: number; translateY?: number },
): HTMLCanvasElement {
  return alphaDataToMask(
    transformSelectionMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, bounds, {
      scale,
      scaleX: extras?.scaleX,
      scaleY: extras?.scaleY,
      translateX: extras?.translateX,
      translateY: extras?.translateY,
      rotationDeg,
      smoothing,
    }),
    mask.width,
    mask.height,
  )
}

export function colorRangeMask(
  src: ImageData,
  target: { r: number; g: number; b: number },
  tolerance: number,
): ImageData {
  const out = new ImageData(src.width, src.height)
  const fuzziness = Math.max(0, tolerance)
  const falloff = Math.max(8, fuzziness * 0.35)
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    const dr = src.data[i] - target.r
    const dg = src.data[i + 1] - target.g
    const db = src.data[i + 2] - target.b
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    let alpha = 0
    if (d <= fuzziness) alpha = 255
    else if (d <= fuzziness + falloff) alpha = Math.round(255 * (1 - (d - fuzziness) / falloff))
    out.data[i] = 255
    out.data[i + 1] = 255
    out.data[i + 2] = 255
    out.data[i + 3] = alpha
  }
  return out
}

/* ---------------------------------------------------------------- */
/*  SELECTION FEATHER                                                 */
/* ---------------------------------------------------------------- */

export function featherMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    featherMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function extractMarchingAntsPaths(
  mask: HTMLCanvasElement,
  options: MaskContourOptions = {},
): MaskContourPath[] {
  return extractMaskContourPaths(maskToAlphaData(mask), mask.width, mask.height, {
    threshold: options.threshold ?? MASK_THRESHOLD,
    simplifyTolerance: options.simplifyTolerance ?? 0.35,
    minPoints: options.minPoints ?? 4,
  })
}

function contourPathToPath(contour: MaskContourPath): PathProps {
  const points = contour.points.map((point) => ({
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  }))
  if (contour.closed && points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first.x === last.x && first.y === last.y) points.pop()
  }
  return { points, closed: contour.closed }
}

export function selectionToPathCandidatesFromMask(mask: HTMLCanvasElement, tolerance = 1.25): PathProps[] {
  return selectionMaskToPathCandidates(maskToAlphaData(mask), mask.width, mask.height, {
    threshold: MASK_THRESHOLD,
    simplifyTolerance: tolerance,
    minPoints: 4,
  })
    .map(contourPathToPath)
    .filter((path) => path.points.length >= (path.closed ? 3 : 2))
}

export function selectionToPath(
  selection: Selection,
  width: number,
  height: number,
  tolerance = 1.25,
): PathProps | null {
  const mask = selectionToMaskCanvas(width, height, selection)
  if (!mask) return null
  return selectionToPathCandidatesFromMask(mask, tolerance)[0] ?? null
}

function cleanBinaryMask(binary: Uint8Array, width: number, height: number, closeRadius = 2, openRadius = 0) {
  let mask = binaryToMask(binary, width, height)
  if (closeRadius > 0) mask = contractSelectionMask(expandSelectionMask(mask, closeRadius), closeRadius)
  if (openRadius > 0) mask = expandSelectionMask(contractSelectionMask(mask, openRadius), openRadius)
  return maskToBinary(mask)
}

function keepScoredComponents(
  binary: Uint8Array,
  width: number,
  height: number,
  scoreComponent: (pixels: number[], touchesEdge: boolean) => number,
  minScoreRatio = 0.34,
  minPixels = 8,
) {
  const visited = new Uint8Array(width * height)
  const components: { pixels: number[]; score: number }[] = []
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || visited[i]) continue
    const stack = [i]
    const pixels: number[] = []
    let touchesEdge = false
    while (stack.length) {
      const p = stack.pop()!
      if (visited[p] || !binary[p]) continue
      visited[p] = 1
      pixels.push(p)
      const x = p % width
      const y = (p - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      if (x > 0) stack.push(p - 1)
      if (x < width - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - width)
      if (y < height - 1) stack.push(p + width)
    }
    if (pixels.length >= minPixels) components.push({ pixels, score: scoreComponent(pixels, touchesEdge) })
  }
  let best = 0
  for (const c of components) if (c.score > best) best = c.score
  const out = new Uint8Array(width * height)
  if (best <= 0) return out
  for (const c of components) {
    if (c.score >= best * minScoreRatio) {
      for (const p of c.pixels) out[p] = 1
    }
  }
  return out
}

/* ---------------------------------------------------------------- */
/*  SNAP HELPERS                                                      */
/* ---------------------------------------------------------------- */

export function snapValue(
  v: number,
  candidates: number[],
  threshold = 6,
): number {
  for (const c of candidates) {
    if (Math.abs(v - c) <= threshold) return c
  }
  return v
}

/* ---------------------------------------------------------------- */
/*  SUBJECT DETECTION (heuristic)                                     */
/* ---------------------------------------------------------------- */

export interface SelectionHeuristicMaskOptions {
  kind: "object" | "subject" | "sky"
  objectBounds?: Rect
  tolerance?: number
}

export interface SelectionHeuristicMaskResult {
  maskData: Uint8ClampedArray
  width: number
  height: number
  bounds: Rect | null
  score: number
  diagnostics: {
    method: "local-heuristic" | "offline-object-aware"
    nativeAiParity: false
    candidatePixels: number
    keptPixels: number
    rejectedPixels?: number
    sourcePrecision?: OfflineObjectAwareSelectionResult["diagnostics"]["sourcePrecision"]
  }
}

export function buildSelectionHeuristicMaskData(
  src: ImageData,
  options: SelectionHeuristicMaskOptions,
): SelectionHeuristicMaskResult {
  return buildOfflineObjectAwareSelectionMaskData(src, options) as SelectionHeuristicMaskResult
}

function offlineSelectionMaskFromCanvas(
  src: HTMLCanvasElement,
  options: Parameters<typeof buildOfflineObjectAwareSelectionMaskData>[1],
  featherRadius: number,
) {
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const result = buildOfflineObjectAwareSelectionMaskData(img, options)
  const mask = alphaDataToMask(result.maskData, result.width, result.height)
  return featherRadius > 0 ? featherMask(mask, featherRadius) : mask
}

export function selectSubjectMask(
  src: HTMLCanvasElement,
  tolerance = 48,
): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "subject", tolerance }, 0.85)
}

export function selectSkyMask(src: HTMLCanvasElement): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "sky" }, 1.1)
}

export function selectBackgroundMask(src: HTMLCanvasElement, tolerance = 48): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "background", tolerance }, 1)
}

export function focusAreaMask(src: HTMLCanvasElement, sensitivity = 0.42): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  const sharpness = new Float32Array(w * h)
  let sum = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const c = luma(img.data[i], img.data[i + 1], img.data[i + 2]) * 4
      const left = imagePixel(img, x - 1, y)
      const right = imagePixel(img, x + 1, y)
      const up = imagePixel(img, x, y - 1)
      const down = imagePixel(img, x, y + 1)
      const v =
        Math.abs(
          c -
            luma(left.r, left.g, left.b) -
            luma(right.r, right.g, right.b) -
            luma(up.r, up.g, up.b) -
            luma(down.r, down.g, down.b),
        ) + localGradient(img, x, y) * 0.85
      sharpness[p] = v
      sum += v
      count++
    }
  }
  if (!count) return makeCanvas(w, h)
  const mean = sum / count
  let variance = 0
  for (let i = 0; i < sharpness.length; i++) {
    if (sharpness[i] > 0) variance += (sharpness[i] - mean) * (sharpness[i] - mean)
  }
  const stdev = Math.sqrt(variance / count)
  const threshold = mean + stdev * sensitivity
  const candidate = new Uint8Array(w * h)
  for (let i = 0; i < sharpness.length; i++) {
    if (sharpness[i] >= threshold) candidate[i] = 1
  }
  const grow = Math.max(4, Math.round(Math.min(w, h) / 70))
  const cleaned = cleanBinaryMask(candidate, w, h, grow, 1)
  const kept = keepScoredComponents(
    cleaned,
    w,
    h,
    (pixels) => pixels.length,
    0.18,
    Math.max(12, Math.floor(w * h * 0.0007)),
  )
  return featherMask(binaryToMask(kept, w, h), 1.2)
}

export function objectSelectionMask(
  src: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  tolerance = 44,
): HTMLCanvasElement {
  return offlineSelectionMaskFromCanvas(src, { kind: "object", objectBounds: rect, tolerance }, 0.85)
}

export function refineEdgeBrushMask(
  src: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  points: { x: number; y: number }[],
  brushSize: number,
  mode: "expand" | "subtract" = "expand",
): HTMLCanvasElement {
  const w = selectionMask.width
  const h = selectionMask.height
  const srcCtx = src.getContext("2d")!
  const img = srcCtx.getImageData(0, 0, w, h)
  const maskCtx = selectionMask.getContext("2d")!
  const maskImg = maskCtx.getImageData(0, 0, w, h)
  const bin = new Uint8Array(w * h)
  const outside = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    bin[i] = maskImg.data[i * 4 + 3] > MASK_THRESHOLD ? 1 : 0
    outside[i] = bin[i] ? 0 : 1
  }
  const distToSelected = distanceToFeature(bin, w, h)
  const distToOutside = distanceToFeature(outside, w, h)
  const influence = new Float32Array(w * h)
  const radius = Math.max(2, brushSize / 2)
  for (const pt of points) {
    const x0 = clamp(Math.floor(pt.x - radius), 0, w - 1)
    const y0 = clamp(Math.floor(pt.y - radius), 0, h - 1)
    const x1 = clamp(Math.ceil(pt.x + radius), x0 + 1, w)
    const y1 = clamp(Math.ceil(pt.y + radius), y0 + 1, h)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - pt.x, y - pt.y)
        if (d > radius) continue
        const p = y * w + x
        influence[p] = Math.max(influence[p], 1 - d / radius)
      }
    }
  }

  let insideR = 0
  let insideG = 0
  let insideB = 0
  let insideWeight = 0
  let outsideR = 0
  let outsideG = 0
  let outsideB = 0
  let outsideWeight = 0
  const modelBand = Math.max(3, radius * 0.7)
  const modelBand2 = modelBand * modelBand
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inf = influence[p]
      if (inf <= 0) continue
      const nearModelEdge = distToSelected[p] <= modelBand2 || distToOutside[p] <= modelBand2
      if (!nearModelEdge) continue
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const weight = inf * (1 + Math.min(1, localGradient(img, x, y) / 96))
      if (bin[p]) {
        insideR += img.data[i] * weight
        insideG += img.data[i + 1] * weight
        insideB += img.data[i + 2] * weight
        insideWeight += weight
      } else {
        outsideR += img.data[i] * weight
        outsideG += img.data[i + 1] * weight
        outsideB += img.data[i + 2] * weight
        outsideWeight += weight
      }
    }
  }
  const colorModel =
    insideWeight > 0 && outsideWeight > 0
      ? {
          inside: { r: insideR / insideWeight, g: insideG / insideWeight, b: insideB / insideWeight },
          outside: { r: outsideR / outsideWeight, g: outsideG / outsideWeight, b: outsideB / outsideWeight },
        }
      : null

  const out = new ImageData(new Uint8ClampedArray(maskImg.data), w, h)
  const edgeBand = Math.max(3, radius * 0.55)
  const edgeBand2 = edgeBand * edgeBand
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inf = influence[p]
      if (inf <= 0) continue
      const i = p * 4
      const nearEdge = distToSelected[p] <= edgeBand2 || distToOutside[p] <= edgeBand2
      if (!nearEdge) continue
      const rgb = { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
      const insideDistance = colorModel ? rgbDistance(rgb, colorModel.inside) : 0
      const outsideDistance = colorModel ? rgbDistance(rgb, colorModel.outside) : 0
      const colorLooksInside = !!colorModel && insideDistance + 10 < outsideDistance
      const colorLooksOutside = !!colorModel && outsideDistance + 10 < insideDistance
      if (mode === "subtract") {
        const remove = colorLooksOutside || distToOutside[p] <= edgeBand2 || localGradient(img, x, y) < 18
        if (remove) out.data[i + 3] = Math.max(0, out.data[i + 3] - Math.round(255 * inf))
        continue
      }
      const sourceAlpha = img.data[i + 3]
      if (sourceAlpha <= MASK_THRESHOLD) continue
      const grad = localGradient(img, x, y)
      const add =
        colorLooksInside ||
        distToSelected[p] <= edgeBand2 * 0.85 ||
        grad > 18 ||
        (sourceAlpha > 80 && distToSelected[p] <= edgeBand2 * 1.2)
      if (add) {
        const feather = clamp(1 - Math.sqrt(distToSelected[p]) / Math.max(1, edgeBand * 1.2), 0.18, 1)
        const colorBoost = colorLooksInside ? 0.16 : 0
        const alpha = Math.round(255 * Math.max(inf * (0.75 + colorBoost), feather * (0.82 + colorBoost)))
        out.data[i] = 255
        out.data[i + 1] = 255
        out.data[i + 2] = 255
        out.data[i + 3] = Math.max(out.data[i + 3], alpha)
      }
    }
  }
  return featherMask(imageDataToMask(out), 0.55)
}

/* ---------------------------------------------------------------- */
/*  Vector path -> mask (used for vector layer masks)                  */
/* ---------------------------------------------------------------- */

export function pathToMask(
  width: number,
  height: number,
  path: PathProps,
): HTMLCanvasElement {
  const c = makeCanvas(width, height)
  if (!path.closed || path.points.length < 3) return c
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  if (tracePath(ctx, path)) ctx.fill("evenodd")
  return c
}

export function pathToSelectionMask(
  path: PathProps,
  width: number,
  height: number,
  options: { feather?: number; strokeWidth?: number } = {},
): HTMLCanvasElement {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.strokeStyle = "#fff"
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(1, options.strokeWidth ?? 2)
  if (tracePath(ctx, path)) {
    if (path.closed && path.points.length >= 3) ctx.fill("evenodd")
    else ctx.stroke()
  }
  return options.feather && options.feather > 0 ? featherMask(mask, options.feather) : mask
}
