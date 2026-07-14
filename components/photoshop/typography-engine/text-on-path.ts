import type { ShapeProps, TextProps } from "../types"
import {
  clamp,
  type TextPathGlyphLayout,
  type TextPathHandleModel,
} from "../typography-engine-types"
import { glyphAdvance } from "./glyph-advance"

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
