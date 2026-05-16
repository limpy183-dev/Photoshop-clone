import type { CustomShapeId, Layer, PathProps, Selection, ShapeProps, TextProps, WarpStyle } from "./types"
import { assertCanvasSize } from "./canvas-limits"
import { buildCanvasFont, buildTypographyRenderPlan } from "./typography-engine"

export function makeCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const size = assertCanvasSize(w, h)
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, size.width, size.height)
  }
  return c
}

export function hexToRgb(hex: string) {
  const h = hex.replace("#", "")
  const v = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  )
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

/* ---------------------------------------------------------------- */
/*  FLOOD FILL                                                        */
/* ---------------------------------------------------------------- */

function colorMatch(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
  tolerance: number,
) {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  const da = data[i + 3] - a
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tolerance
}

/** Flood-fill from (sx,sy) on `src` ImageData. Returns a new mask ImageData
 *  where filled pixels are alpha=255 and others alpha=0. */
export function floodFillMask(
  src: ImageData,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): ImageData {
  const w = src.width
  const h = src.height
  const out = new ImageData(w, h)
  const data = src.data
  const x = Math.max(0, Math.min(w - 1, Math.floor(sx)))
  const y = Math.max(0, Math.min(h - 1, Math.floor(sy)))
  const startIdx = (y * w + x) * 4
  const tr = data[startIdx]
  const tg = data[startIdx + 1]
  const tb = data[startIdx + 2]
  const ta = data[startIdx + 3]

  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) {
      if (colorMatch(data, i, tr, tg, tb, ta, tolerance)) {
        out.data[i + 3] = 255
      }
    }
    return out
  }

  // Scanline flood fill
  const visited = new Uint8Array(w * h)
  const stack: number[] = [x, y]
  while (stack.length) {
    const py = stack.pop()!
    let px = stack.pop()!
    if (py < 0 || py >= h) continue
    // walk left
    let lx = px
    while (lx >= 0) {
      const i = (py * w + lx) * 4
      if (visited[py * w + lx] || !colorMatch(data, i, tr, tg, tb, ta, tolerance)) break
      lx--
    }
    lx++
    // walk right
    let rx = px
    while (rx < w) {
      const i = (py * w + rx) * 4
      if (visited[py * w + rx] || !colorMatch(data, i, tr, tg, tb, ta, tolerance)) break
      rx++
    }
    rx--
    for (let i = lx; i <= rx; i++) {
      visited[py * w + i] = 1
      out.data[(py * w + i) * 4 + 3] = 255
    }
    // push spans above & below
    for (let nx = lx; nx <= rx; nx++) {
      if (py > 0 && !visited[(py - 1) * w + nx]) {
        const ni = ((py - 1) * w + nx) * 4
        if (colorMatch(data, ni, tr, tg, tb, ta, tolerance)) {
          stack.push(nx, py - 1)
        }
      }
      if (py < h - 1 && !visited[(py + 1) * w + nx]) {
        const ni = ((py + 1) * w + nx) * 4
        if (colorMatch(data, ni, tr, tg, tb, ta, tolerance)) {
          stack.push(nx, py + 1)
        }
      }
    }
  }
  return out
}

/** Flood-fill colored region on a layer canvas. */
export function paintBucketFill(
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  hex: string,
  tolerance: number,
  contiguous: boolean,
  withinSelection?: HTMLCanvasElement | null,
) {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const mask = floodFillMask(src, sx, sy, tolerance, contiguous)
  const fillColor = hexToRgb(hex)
  let selData: Uint8ClampedArray | null = null
  if (withinSelection) {
    const sctx = withinSelection.getContext("2d")!
    selData = sctx.getImageData(0, 0, canvas.width, canvas.height).data
  }
  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i + 3] === 0) continue
    if (selData && selData[i + 3] === 0) continue
    src.data[i] = fillColor.r
    src.data[i + 1] = fillColor.g
    src.data[i + 2] = fillColor.b
    src.data[i + 3] = 255
  }
  ctx.putImageData(src, 0, 0)
}

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
  let cy = t.y + (t.spaceBefore ?? 0)
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

function appendShapePath(ctx: CanvasRenderingContext2D, s: ShapeProps) {
  ctx.beginPath()
  if (s.type === "rect") {
    if (s.radius && s.radius > 0) {
      const r = Math.min(s.radius, s.w / 2, s.h / 2)
      ctx.moveTo(s.x + r, s.y)
      ctx.arcTo(s.x + s.w, s.y, s.x + s.w, s.y + s.h, r)
      ctx.arcTo(s.x + s.w, s.y + s.h, s.x, s.y + s.h, r)
      ctx.arcTo(s.x, s.y + s.h, s.x, s.y, r)
      ctx.arcTo(s.x, s.y, s.x + s.w, s.y, r)
      ctx.closePath()
    } else {
      ctx.rect(s.x, s.y, s.w, s.h)
    }
  } else if (s.type === "ellipse") {
    ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
  } else if (s.type === "polygon") {
    const sides = Math.max(3, s.sides ?? 6)
    const cx = s.x + s.w / 2
    const cy = s.y + s.h / 2
    const rx = s.w / 2
    const ry = s.h / 2
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * rx
      const y = cy + Math.sin(a) * ry
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else {
    customShapePath(ctx, (s.customId ?? "star5") as CustomShapeId, s.x, s.y, s.w, s.h)
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
  const columnGap = lineHeight
  ctx.save()
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = t.color
  for (let col = 0; col < columns.length; col++) {
    const column = columns[col]
    const x = t.x + col * columnGap
    let y = t.y
    for (const ch of column) {
      if (/[A-Za-z0-9]/.test(ch)) {
        ctx.save()
        ctx.translate(x, y + size / 2 + baselineOffset)
        ctx.rotate(Math.PI / 2)
        ctx.fillText(ch, 0, 0)
        ctx.restore()
      } else {
        ctx.fillText(ch, x, y + size / 2 + baselineOffset)
      }
      y += Math.max(size, ctx.measureText(ch).width) + spacing + 2
      if (t.boxHeight && y > t.y + t.boxHeight) break
    }
  }
  ctx.restore()
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
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= 0) continue
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, start: total })
    total += len
  }
  if (!segments.length) return
  const textWidth = measureLineWidth(ctx, content, spacing)
  let cursor =
    t.align === "center"
      ? Math.max(0, (total - textWidth) / 2)
      : t.align === "right"
        ? Math.max(0, total - textWidth)
        : 0
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
    const mid = cursor + advance / 2
    const seg = segmentAtLength(segments, mid)
    if (!seg) break
    const local = (mid - seg.start) / seg.len
    const x = seg.x1 + (seg.x2 - seg.x1) * local
    const y = seg.y1 + (seg.y2 - seg.y1) * local
    const angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillText(ch, 0, -baselineOffset)
    ctx.restore()
    cursor += advance
    if (cursor > total) break
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

  // Boolean operation: map ShapeProps booleanOperation to Canvas composite ops
  const boolOp = s.booleanOperation ?? "new"
  if (boolOp === "new") {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  // Set composite operation based on boolean mode
  ctx.save()
  switch (boolOp) {
    case "unite":
      ctx.globalCompositeOperation = "source-over"
      break
    case "subtract":
      ctx.globalCompositeOperation = "destination-out"
      break
    case "intersect":
      ctx.globalCompositeOperation = "destination-in"
      break
    case "exclude":
      ctx.globalCompositeOperation = "xor"
      break
    default:
      ctx.globalCompositeOperation = "source-over"
  }

  ctx.beginPath()
  if (s.type === "rect") {
    if (s.radius && s.radius > 0) {
      const r = Math.min(s.radius, s.w / 2, s.h / 2)
      ctx.moveTo(s.x + r, s.y)
      ctx.arcTo(s.x + s.w, s.y, s.x + s.w, s.y + s.h, r)
      ctx.arcTo(s.x + s.w, s.y + s.h, s.x, s.y + s.h, r)
      ctx.arcTo(s.x, s.y + s.h, s.x, s.y, r)
      ctx.arcTo(s.x, s.y, s.x + s.w, s.y, r)
      ctx.closePath()
    } else {
      ctx.rect(s.x, s.y, s.w, s.h)
    }
  } else if (s.type === "ellipse") {
    ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
  } else if (s.type === "polygon") {
    const sides = Math.max(3, s.sides ?? 6)
    const cx = s.x + s.w / 2
    const cy = s.y + s.h / 2
    const rx = s.w / 2
    const ry = s.h / 2
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * rx
      const y = cy + Math.sin(a) * ry
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else {
    customShapePath(ctx, (s.customId ?? "star5") as CustomShapeId, s.x, s.y, s.w, s.h)
  }
  ctx.fillStyle = s.fill
  ctx.fill()
  if (s.stroke && s.stroke.width > 0) {
    ctx.strokeStyle = s.stroke.color
    ctx.lineWidth = s.stroke.width
    ctx.stroke()
  }
  ctx.restore()
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
  ctx.beginPath()
  const p0 = path.points[0]
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1]
    const cur = path.points[i]
    const cp1 = prev.cp1 ?? prev
    const cp2 = cur.cp2 ?? cur
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, cur.x, cur.y)
  }
  if (path.closed) {
    const last = path.points[path.points.length - 1]
    const first = path.points[0]
    const cp1 = last.cp1 ?? last
    const cp2 = first.cp2 ?? first
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.x, first.y)
  }
  if (fill) {
    ctx.fillStyle = fillColor
    ctx.fill()
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
  const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
  const dest = destCtx.getImageData(x0, y0, sw, sh)
  const original = new Uint8ClampedArray(dest.data)
  const scaleFactor = Math.max(0.05, scale / 100)
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
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
        const sample = transformedCloneSample(src.data, src.width, src.height, sourceAnchor, destAnchor, docX, docY, scaleFactor, cos, sin)
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
      const sample = transformedCloneSample(src.data, src.width, src.height, sourceAnchor, destAnchor, docX, docY, scaleFactor, cos, sin)
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
  return sampleImageData(data, width, height, sx, sy)
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
  outputTarget: ContentAwareFillOutputTarget
  previewData?: {
    width: number
    height: number
    fillAlpha: Uint8Array
    sampleAlpha: Uint8Array
    confidenceAlpha: Uint8Array
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
    outputTarget: options.outputTarget ?? "current-layer",
    previewData: options.preview
      ? { width, height, fillAlpha, sampleAlpha: sampling.sampleAlpha, confidenceAlpha }
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
  return score / samples + Math.hypot(tx - sx, ty - sy) * 0.02
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
  fillPixels.sort((a, b) => distToOutside[a] - distToOutside[b])

  const searchPad = Math.max(36, Math.round(Math.max(fillBounds.w, fillBounds.h) * 1.35))
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

  const patchRadius = fillPixels.length > 100000 ? 2 : fillPixels.length > 35000 ? 3 : 4
  const candidateBudget = fillPixels.length > 80000 ? 32 : 56
  const boundaryBudget = Math.min(18, boundaryCenters.length)

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
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }

    for (let c = 0; c < candidateBudget; c++) {
      const candidate = sourceCenters[pseudoRandomIndex(p + c * 104729 + n * 17, sourceCenters.length)]
      const cx = candidate % width
      const cy = (candidate - cx) / width
      const score = patchMatchScore(source, work, filled, fillAlpha, width, height, x, y, cx, cy, patchRadius)
      if (score < bestScore) {
        bestScore = score
        best = candidate
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
    } else {
      const avg = fallbackFillColor(work, filled, width, height, x, y)
      work[i] = clampByte(avg.r)
      work[i + 1] = clampByte(avg.g)
      work[i + 2] = clampByte(avg.b)
      work[i + 3] = clampByte(avg.a || 255)
    }
    filled[p] = 1
  }

  seamRelax(work, fillAlpha, width, height, fillBounds, 2)
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

/** Apply a localised blur stamp at (x,y). */
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
  // simple 3x3 box blur
  const out = new Uint8ClampedArray(img.data)
  for (let py = 1; py < sh - 1; py++) {
    for (let px = 1; px < sw - 1; px++) {
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((py + dy) * sw + (px + dx)) * 4
          r0 += img.data[i]
          g0 += img.data[i + 1]
          b0 += img.data[i + 2]
        }
      }
      const i = (py * sw + px) * 4
      out[i] = r0 / 9
      out[i + 1] = g0 / 9
      out[i + 2] = b0 / 9
    }
  }
  // Apply only within circle
  const imgOut = new ImageData(out, sw, sh)
  ctx.putImageData(imgOut, sx, sy, 0, 0, sw, sh)
}

/** Sharpen stamp via 3x3 unsharp. */
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
  const out = new Uint8ClampedArray(img.data)
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  for (let py = 1; py < sh - 1; py++) {
    for (let px = 1; px < sw - 1; px++) {
      let r0 = 0
      let g0 = 0
      let b0 = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((py + dy) * sw + (px + dx)) * 4
          const kk = k[(dy + 1) * 3 + (dx + 1)]
          r0 += img.data[i] * kk
          g0 += img.data[i + 1] * kk
          b0 += img.data[i + 2] * kk
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

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (max + min) / 2
  if (max === min) return [0, 0, lum * 100]
  const d = max - min
  const sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue = 0
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else hue = ((r - g) / d + 4) / 6
  return [hue * 360, sat * 100, lum * 100]
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
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return selectionToMaskCanvas(mask.width, mask.height, { bounds: { x: 0, y: 0, w: mask.width, h: mask.height }, shape: "rect", mask }) ?? mask
  const w = mask.width
  const h = mask.height
  const bin = maskToBinary(mask)
  const dist = distanceToFeature(bin, w, h)
  const rr = r * r
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = dist[i] <= rr ? 1 : 0
  return binaryToMask(out, w, h)
}

export function contractSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return selectionToMaskCanvas(mask.width, mask.height, { bounds: { x: 0, y: 0, w: mask.width, h: mask.height }, shape: "rect", mask }) ?? mask
  const w = mask.width
  const h = mask.height
  const bin = maskToBinary(mask)
  const outside = new Uint8Array(w * h)
  for (let i = 0; i < bin.length; i++) outside[i] = bin[i] ? 0 : 1
  const dist = distanceToFeature(outside, w, h)
  const rr = r * r
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = bin[i] && dist[i] > rr ? 1 : 0
  return binaryToMask(out, w, h)
}

export function borderSelectionMask(mask: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const expanded = expandSelectionMask(mask, width)
  const contracted = contractSelectionMask(mask, width)
  const out = makeCanvas(mask.width, mask.height)
  const ctx = out.getContext("2d")!
  ctx.drawImage(expanded, 0, 0)
  ctx.globalCompositeOperation = "destination-out"
  ctx.drawImage(contracted, 0, 0)
  ctx.globalCompositeOperation = "source-over"
  return out
}

export function smoothSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const r = Math.max(1, Math.round(radius))
  const opened = expandSelectionMask(contractSelectionMask(mask, Math.max(1, Math.floor(r / 2))), Math.max(1, Math.floor(r / 2)))
  const closed = contractSelectionMask(expandSelectionMask(opened, r), r)
  return featherMask(closed, 0.65)
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
  if (radius <= 0) return mask
  const w = mask.width
  const h = mask.height
  const out = makeCanvas(w, h)
  const ctx = out.getContext("2d")!
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(mask, 0, 0)
  return out
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

function edgeAverage(img: ImageData, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
  const samples: { r: number; g: number; b: number }[] = []
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 80))
  for (let x = x0; x < x1; x += step) {
    samples.push(imagePixel(img, x, y0))
    samples.push(imagePixel(img, x, y1 - 1))
  }
  for (let y = y0; y < y1; y += step) {
    samples.push(imagePixel(img, x0, y))
    samples.push(imagePixel(img, x1 - 1, y))
  }
  if (!samples.length) return { r: 0, g: 0, b: 0, spread: 0 }
  const avg = {
    r: samples.reduce((a, c) => a + c.r, 0) / samples.length,
    g: samples.reduce((a, c) => a + c.g, 0) / samples.length,
    b: samples.reduce((a, c) => a + c.b, 0) / samples.length,
  }
  const distances = samples.map((s) => rgbDistance(s, avg))
  const mean = distances.reduce((a, d) => a + d, 0) / distances.length
  const variance = distances.reduce((a, d) => a + (d - mean) * (d - mean), 0) / distances.length
  return { ...avg, spread: mean + Math.sqrt(variance) }
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
/*  LIQUIFY (forward warp)                                            */
/* ---------------------------------------------------------------- */

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
    method: "local-heuristic"
    nativeAiParity: false
    candidatePixels: number
    keptPixels: number
  }
}

function maskResultFromBinary(binary: Uint8Array, width: number, height: number, candidatePixels: number): SelectionHeuristicMaskResult {
  const maskData = Uint8ClampedArray.from(binary, (value) => (value ? 255 : 0))
  const bounds = alphaBounds(binary, width, height, 0)
  const keptPixels = countAlpha(binary, 0)
  return {
    maskData,
    width,
    height,
    bounds,
    score: keptPixels / Math.max(1, candidatePixels),
    diagnostics: {
      method: "local-heuristic",
      nativeAiParity: false,
      candidatePixels,
      keptPixels,
    },
  }
}

export function buildSelectionHeuristicMaskData(
  src: ImageData,
  options: SelectionHeuristicMaskOptions,
): SelectionHeuristicMaskResult {
  const w = src.width
  const h = src.height
  const candidate = new Uint8Array(w * h)
  const tolerance = Math.max(8, options.tolerance ?? 44)

  if (options.kind === "sky") {
    for (let y = 0; y < h; y++) {
      const yNorm = y / Math.max(1, h - 1)
      if (yNorm > 0.62) continue
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (src.data[i + 3] <= MASK_THRESHOLD) continue
        const r = src.data[i]
        const g = src.data[i + 1]
        const b = src.data[i + 2]
        const [hue, sat, lum] = rgbToHsl(r, g, b)
        const blueSky = hue >= 178 && hue <= 252 && sat > 18 && lum > 30 && b > r + 18 && b > g + 12
        const paleSky = yNorm < 0.45 && lum > 62 && sat < 34 && localGradient(src, x, y) < 28
        if (blueSky || paleSky) candidate[y * w + x] = 1
      }
    }
    return maskResultFromBinary(candidate, w, h, countAlpha(candidate, 0))
  }

  const rect = options.kind === "object" && options.objectBounds
    ? clippedRect(options.objectBounds, w, h) ?? { x: 0, y: 0, w, h }
    : { x: 0, y: 0, w, h }
  const bg = options.kind === "object"
    ? edgeAverage(src, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h)
    : edgeAverage(src)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const threshold = Math.max(tolerance, bg.spread * 0.85 + 22)

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const p = y * w + x
      const i = p * 4
      if (src.data[i + 3] <= MASK_THRESHOLD) continue
      const r = src.data[i]
      const g = src.data[i + 1]
      const b = src.data[i + 2]
      const [hue, sat, lum] = rgbToHsl(r, g, b)
      const likelySky = y < h * 0.45 && hue >= 178 && hue <= 252 && sat > 18 && lum > 30 && b > r + 14
      const likelyGreenBackground = hue >= 82 && hue <= 156 && sat > 18 && g > r + 24 && g > b + 8
      if (likelySky || likelyGreenBackground) continue
      const d = rgbDistance({ r, g, b }, bg)
      const centerDistance = Math.hypot((x - cx) / Math.max(1, rect.w * 0.55), (y - cy) / Math.max(1, rect.h * 0.55))
      const centerPrior = clamp(1 - centerDistance, 0, 1)
      const edge = localGradient(src, x, y)
      if (d > threshold * (0.98 - centerPrior * 0.28) || (edge > 34 && centerPrior > 0.08 && d > threshold * 0.4)) {
        candidate[p] = 1
      }
    }
  }

  const kept = keepScoredComponents(
    candidate,
    w,
    h,
    (pixels, touchesEdge) => {
      let sx = 0
      let sy = 0
      for (const p of pixels) {
        sx += p % w
        sy += Math.floor(p / w)
      }
      const px = sx / pixels.length
      const py = sy / pixels.length
      const centerDistance = Math.hypot((px - cx) / Math.max(1, rect.w * 0.55), (py - cy) / Math.max(1, rect.h * 0.55))
      return pixels.length * (1.35 - clamp(centerDistance, 0, 1)) * (touchesEdge ? 0.35 : 1)
    },
    0.3,
    Math.max(1, Math.floor(rect.w * rect.h * 0.005)),
  )
  return maskResultFromBinary(kept, w, h, countAlpha(candidate, 0))
}

export function selectSubjectMask(
  src: HTMLCanvasElement,
  tolerance = 48,
): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)

  const bg = edgeAverage(img)
  const threshold = Math.max(tolerance, bg.spread * 0.9 + 26)
  const candidate = new Uint8Array(w * h)
  const cx = w / 2
  const cy = h / 2
  let candidateCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      const a = img.data[i + 3]
      if (a <= MASK_THRESHOLD) continue
      const rgb = { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
      const dist = rgbDistance(rgb, bg)
      const centerDistance = Math.hypot((x - cx) / Math.max(1, w * 0.55), (y - cy) / Math.max(1, h * 0.55))
      const centerPrior = clamp(1 - centerDistance, 0, 1)
      const edge = localGradient(img, x, y)
      const keep =
        dist > threshold * (0.92 - centerPrior * 0.24) ||
        (edge > 34 && centerPrior > 0.12 && dist > threshold * 0.42)
      if (keep) {
        candidate[p] = 1
        candidateCount++
      }
    }
  }

  if (candidateCount < Math.max(12, w * h * 0.001)) {
    for (let i = 0; i < w * h; i++) {
      if (img.data[i * 4 + 3] > MASK_THRESHOLD) candidate[i] = 1
    }
  }

  const cleaned = cleanBinaryMask(candidate, w, h, Math.max(2, Math.round(Math.min(w, h) / 180)), 1)
  const kept = keepScoredComponents(
    cleaned,
    w,
    h,
    (pixels, touchesEdge) => {
      let sx = 0
      let sy = 0
      for (const p of pixels) {
        sx += p % w
        sy += (p - (p % w)) / w
      }
      const px = sx / pixels.length
      const py = sy / pixels.length
      const centerDistance = Math.hypot((px - cx) / Math.max(1, w * 0.55), (py - cy) / Math.max(1, h * 0.55))
      const centerScore = 1.35 - clamp(centerDistance, 0, 1)
      return pixels.length * centerScore * (touchesEdge ? 0.45 : 1)
    },
    0.32,
    Math.max(8, Math.floor(w * h * 0.0004)),
  )
  return featherMask(binaryToMask(kept, w, h), 0.85)
}

export function selectSkyMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  const candidate = new Uint8Array(w * h)

  for (let y = 0; y < h; y++) {
    const yNorm = y / Math.max(1, h - 1)
    if (yNorm > 0.82) continue
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const r = img.data[i]
      const g = img.data[i + 1]
      const b = img.data[i + 2]
      const [hue, sat, lum] = rgbToHsl(r, g, b)
      const grad = localGradient(img, x, y)
      const blueSky = hue >= 175 && hue <= 258 && sat > 10 && lum > 24 && b > r + 8 && b >= g * 0.78
      const paleCloud = yNorm < 0.68 && lum > 58 && sat < 36 && grad < 34
      const sunsetSky = yNorm < 0.54 && lum > 42 && sat > 16 && grad < 26
      if (blueSky || paleCloud || sunsetSky) candidate[p] = 1
    }
  }

  const connected = new Uint8Array(w * h)
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) {
    if (candidate[x]) stack.push(x)
    const lowerTop = Math.min(h - 1, Math.floor(h * 0.08))
    const p = lowerTop * w + x
    if (candidate[p]) stack.push(p)
  }
  for (let y = 0; y < Math.floor(h * 0.55); y++) {
    if (candidate[y * w]) stack.push(y * w)
    if (candidate[y * w + w - 1]) stack.push(y * w + w - 1)
  }
  while (stack.length) {
    const p = stack.pop()!
    if (visited[p] || !candidate[p]) continue
    visited[p] = 1
    connected[p] = 1
    const x = p % w
    const y = (p - x) / w
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }

  let count = 0
  for (let i = 0; i < connected.length; i++) if (connected[i]) count++
  if (count < w * h * 0.01) {
    const topBg = edgeAverage(img, 0, 0, w, Math.max(2, Math.floor(h * 0.12)))
    for (let y = 0; y < h * 0.6; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        const i = p * 4
        if (img.data[i + 3] <= MASK_THRESHOLD) continue
        const d = rgbDistance({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }, topBg)
        if (d < Math.max(34, topBg.spread * 1.35)) connected[p] = 1
      }
    }
  }

  const cleaned = cleanBinaryMask(connected, w, h, Math.max(2, Math.round(Math.min(w, h) / 140)), 0)
  return featherMask(binaryToMask(cleaned, w, h), 1.1)
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
  const w = src.width
  const h = src.height
  const x0 = clamp(Math.floor(Math.min(rect.x, rect.x + rect.w)), 0, w - 1)
  const y0 = clamp(Math.floor(Math.min(rect.y, rect.y + rect.h)), 0, h - 1)
  const x1 = clamp(Math.ceil(Math.max(rect.x, rect.x + rect.w)), x0 + 1, w)
  const y1 = clamp(Math.ceil(Math.max(rect.y, rect.y + rect.h)), y0 + 1, h)
  const ctx = src.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  const bg = edgeAverage(img, x0, y0, x1, y1)
  const threshold = Math.max(tolerance, bg.spread * 0.9 + 24)
  const candidate = new Uint8Array(w * h)
  const cx = x0 + (x1 - x0) / 2
  const cy = y0 + (y1 - y0) / 2
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x
      const i = p * 4
      if (img.data[i + 3] <= MASK_THRESHOLD) continue
      const d = rgbDistance({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }, bg)
      const centerDistance = Math.hypot((x - cx) / Math.max(1, (x1 - x0) * 0.55), (y - cy) / Math.max(1, (y1 - y0) * 0.55))
      const centerPrior = clamp(1 - centerDistance, 0, 1)
      const edge = localGradient(img, x, y)
      if (d > threshold * (0.95 - centerPrior * 0.25) || (edge > 34 && d > threshold * 0.35)) {
        candidate[p] = 1
      }
    }
  }
  const cleaned = cleanBinaryMask(candidate, w, h, Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) / 80)), 1)
  const kept = keepScoredComponents(
    cleaned,
    w,
    h,
    (pixels, touchesEdge) => {
      let sx = 0
      let sy = 0
      for (const p of pixels) {
        sx += p % w
        sy += (p - (p % w)) / w
      }
      const px = sx / pixels.length
      const py = sy / pixels.length
      const centerDistance = Math.hypot((px - cx) / Math.max(1, (x1 - x0) * 0.55), (py - cy) / Math.max(1, (y1 - y0) * 0.55))
      return pixels.length * (1.4 - clamp(centerDistance, 0, 1)) * (touchesEdge ? 0.72 : 1)
    },
    0.28,
    Math.max(8, Math.floor((x1 - x0) * (y1 - y0) * 0.001)),
  )
  let selected = 0
  for (let i = 0; i < kept.length; i++) selected += kept[i]
  if (selected < Math.max(10, (x1 - x0) * (y1 - y0) * 0.002)) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) kept[y * w + x] = 1
    }
  }
  return featherMask(binaryToMask(kept, w, h), 0.85)
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
      if (mode === "subtract") {
        const remove = distToOutside[p] <= edgeBand2 || localGradient(img, x, y) < 18
        if (remove) out.data[i + 3] = Math.max(0, out.data[i + 3] - Math.round(255 * inf))
        continue
      }
      const sourceAlpha = img.data[i + 3]
      if (sourceAlpha <= MASK_THRESHOLD) continue
      const grad = localGradient(img, x, y)
      const add =
        distToSelected[p] <= edgeBand2 * 0.85 ||
        grad > 18 ||
        (sourceAlpha > 80 && distToSelected[p] <= edgeBand2 * 1.2)
      if (add) {
        const feather = clamp(1 - Math.sqrt(distToSelected[p]) / Math.max(1, edgeBand * 1.2), 0.18, 1)
        const alpha = Math.round(255 * Math.max(inf * 0.75, feather * 0.82))
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
/*  PERSPECTIVE CROP (4-corner unwarp)                                */
/* ---------------------------------------------------------------- */

/**
 * Unwarp a quadrilateral region of `src` into a (w x h) rectangle.
 * Uses simple bilinear interpolation across the 4 corners (a-b across the top,
 * d-c across the bottom).
 */
export function perspectiveUnwarp(
  src: HTMLCanvasElement,
  corners: { x: number; y: number }[],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const out = makeCanvas(Math.max(1, Math.round(outW)), Math.max(1, Math.round(outH)))
  const octx = out.getContext("2d")!
  const sctx = src.getContext("2d")!
  const sImg = sctx.getImageData(0, 0, src.width, src.height)
  const oImg = octx.createImageData(out.width, out.height)
  const [a, b, c, d] = corners // tl, tr, br, bl
  for (let y = 0; y < out.height; y++) {
    const ty = y / Math.max(1, out.height - 1)
    const lx = a.x + (d.x - a.x) * ty
    const ly = a.y + (d.y - a.y) * ty
    const rx = b.x + (c.x - b.x) * ty
    const ry = b.y + (c.y - b.y) * ty
    for (let x = 0; x < out.width; x++) {
      const tx = x / Math.max(1, out.width - 1)
      const sx = Math.round(lx + (rx - lx) * tx)
      const sy = Math.round(ly + (ry - ly) * tx)
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
      const si = (sy * src.width + sx) * 4
      const di = (y * out.width + x) * 4
      oImg.data[di] = sImg.data[si]
      oImg.data[di + 1] = sImg.data[si + 1]
      oImg.data[di + 2] = sImg.data[si + 2]
      oImg.data[di + 3] = sImg.data[si + 3]
    }
  }
  octx.putImageData(oImg, 0, 0)
  return out
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
  if (path.points.length < 3) return c
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  const p0 = path.points[0]
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1]
    const cur = path.points[i]
    const cp1 = prev.cp1 ?? prev
    const cp2 = cur.cp2 ?? cur
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, cur.x, cur.y)
  }
  if (path.closed) {
    const last = path.points[path.points.length - 1]
    const first = path.points[0]
    const cp1 = last.cp1 ?? last
    const cp2 = first.cp2 ?? first
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.x, first.y)
    ctx.closePath()
  }
  ctx.fill()
  return c
}

export function liquifyWarp(
  canvas: HTMLCanvasElement,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  radius: number,
) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext("2d")!
  const sx = Math.max(0, Math.floor(Math.min(fx, tx) - radius))
  const sy = Math.max(0, Math.floor(Math.min(fy, ty) - radius))
  const ex = Math.min(w, Math.ceil(Math.max(fx, tx) + radius))
  const ey = Math.min(h, Math.ceil(Math.max(fy, ty) + radius))
  const ww = ex - sx
  const hh = ey - sy
  if (ww <= 0 || hh <= 0) return
  const src = ctx.getImageData(sx, sy, ww, hh)
  const out = new Uint8ClampedArray(src.data)
  const dx = tx - fx
  const dy = ty - fy
  for (let py = 0; py < hh; py++) {
    for (let px = 0; px < ww; px++) {
      const ax = px + sx
      const ay = py + sy
      const distance = Math.hypot(ax - tx, ay - ty)
      if (distance >= radius) continue
      const t = 1 - distance / radius
      const sxp = Math.round(ax - dx * t)
      const syp = Math.round(ay - dy * t)
      if (sxp < 0 || sxp >= w || syp < 0 || syp >= h) continue
      const sIdx = (syp * w + sxp) * 4
      const dIdx = (py * ww + px) * 4
      // We need to read from the full canvas, not just the slice
      // Quick approach: draw at end via transformed canvas
      const fullIdx = ((syp - sy) * ww + (sxp - sx)) * 4
      if (fullIdx >= 0 && fullIdx < src.data.length) {
        out[dIdx] = src.data[fullIdx]
        out[dIdx + 1] = src.data[fullIdx + 1]
        out[dIdx + 2] = src.data[fullIdx + 2]
        out[dIdx + 3] = src.data[fullIdx + 3]
      }
    }
  }
  ctx.putImageData(new ImageData(out, ww, hh), sx, sy)
}

/* =========================================================================
   Magnetic Lasso — Sobel edge-detection snapping
   ========================================================================= */

/**
 * Given cursor position and a canvas, compute the Sobel gradient magnitude
 * in a search region and return the position snapped to the highest-gradient pixel.
 *
 * @param canvas - The source layer canvas to compute gradients from
 * @param cx - Cursor X in canvas space
 * @param cy - Cursor Y in canvas space
 * @param searchWidth - Half-size of the square search region (default 10px)
 * @returns The snapped {x, y} position
 */
export function magneticLassoSnap(
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  searchWidth: number = 10,
): { x: number; y: number } {
  const ctx = canvas.getContext("2d")
  if (!ctx) return { x: Math.round(cx), y: Math.round(cy) }

  const w = canvas.width
  const h = canvas.height

  // Clamp the search region
  const x0 = Math.max(1, Math.floor(cx - searchWidth))
  const y0 = Math.max(1, Math.floor(cy - searchWidth))
  const x1 = Math.min(w - 2, Math.floor(cx + searchWidth))
  const y1 = Math.min(h - 2, Math.floor(cy + searchWidth))

  if (x0 >= x1 || y0 >= y1) return { x: Math.round(cx), y: Math.round(cy) }

  // Read the search region plus 1px border for the Sobel kernel
  const rw = x1 - x0 + 3
  const rh = y1 - y0 + 3
  const img = ctx.getImageData(x0 - 1, y0 - 1, rw, rh)
  const data = img.data

  // Convert to grayscale luminance
  const gray = new Float32Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const j = i * 4
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  }

  // Sobel operator
  let maxGrad = 0
  let bestX = Math.round(cx)
  let bestY = Math.round(cy)

  for (let ry = 1; ry < rh - 1; ry++) {
    for (let rx = 1; rx < rw - 1; rx++) {
      const tl = gray[(ry - 1) * rw + (rx - 1)]
      const t = gray[(ry - 1) * rw + rx]
      const tr = gray[(ry - 1) * rw + (rx + 1)]
      const l = gray[ry * rw + (rx - 1)]
      const r = gray[ry * rw + (rx + 1)]
      const bl = gray[(ry + 1) * rw + (rx - 1)]
      const b = gray[(ry + 1) * rw + rx]
      const br = gray[(ry + 1) * rw + (rx + 1)]

      const gx = -tl + tr - 2 * l + 2 * r - bl + br
      const gy = -tl - 2 * t - tr + bl + 2 * b + br
      const grad = Math.sqrt(gx * gx + gy * gy)

      if (grad > maxGrad) {
        maxGrad = grad
        bestX = x0 + rx - 1
        bestY = y0 + ry - 1
      }
    }
  }

  // only snap if gradient is meaningful (not flat area)
  if (maxGrad < 8) return { x: Math.round(cx), y: Math.round(cy) }
  return { x: bestX, y: bestY }
}
