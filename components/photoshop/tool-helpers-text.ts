import type { TextProps, WarpStyle } from "./types"
import { buildCanvasFont, buildTypographyRenderPlan } from "./typography-engine"
import { makeCanvas } from "./canvas-utils"
import { hexToRgb } from "./color-utils"
import { appendShapePath } from "./tool-helpers-shape"

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
