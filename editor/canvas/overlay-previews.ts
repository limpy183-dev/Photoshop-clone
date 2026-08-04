/**
 * Overlay-canvas previews: the transient shapes drawn on top of the composite
 * while a tool drag is in flight (marquee band, gradient ramp, path skeleton,
 * transform handles…). Every function here clears and repaints the overlay in
 * document space — the caller owns the overlay canvas and the tool state, this
 * module only knows how to draw.
 */
import { buildRetouchingFeedbackModel } from "@/editor/retouch-feedback"
import { hexToRgba } from "@/editor/color/utils"
import { magneticLassoTrace } from "@/editor/tool/helpers"
import type { SelectionImageSource } from "@/editor/selection-algorithms"
import { shapeHandles } from "@/editor/canvas/shape-helpers"
import {
  transformCorners,
  transformHandles,
  type TransformDragState,
} from "@/editor/canvas/transform-geometry"
import {
  applySelectionMaskToCanvas,
  clipToSelection,
} from "@/editor/canvas/selection-helpers"
import {
  addGradientStops,
  applyDitherToCanvas,
  getGradientStops,
  makeCurvaturePath,
  sampleGradient,
} from "@/editor/canvas/view-helpers"
import {
  appendPathToCanvas,
  getRoundedRectCornerRadiusHandles,
  type PathAnchorRef,
} from "@/editor/vector-path-operations"
import type {
  BrushSettings,
  CloneSourceSettings,
  GradientSettings,
  GradientStop,
  Layer,
  PathPoint,
  PathProps,
  PsDocument,
  SelectionOptions,
  ToolId,
} from "@/editor/types"

interface Point {
  x: number
  y: number
}

/** Below this drag distance (document px) the type tool places point text. */
export const TEXT_BOX_DRAG_THRESHOLD = 8

const GRADIENT_LUT_SIZE = 256

/**
 * `GRADIENT_LUT_SIZE` evenly spaced samples of a gradient, as packed RGBA words
 * ready to store straight into an ImageData's Uint32 view. Built through a byte
 * array so the word order matches the platform's, whatever its endianness.
 */
function gradientLut(gradient: GradientSettings, stops: GradientStop[]): Uint32Array {
  const bytes = new Uint8Array(GRADIENT_LUT_SIZE * 4)
  for (let i = 0; i < GRADIENT_LUT_SIZE; i++) {
    const color = sampleGradient(gradient, stops, i / (GRADIENT_LUT_SIZE - 1))
    bytes[i * 4] = color.r
    bytes[i * 4 + 1] = color.g
    bytes[i * 4 + 2] = color.b
    bytes[i * 4 + 3] = color.a
  }
  return new Uint32Array(bytes.buffer)
}

export function drawGradientPreview(
  overlay: HTMLCanvasElement,
  document: PsDocument,
  gradient: GradientSettings,
  foreground: string,
  background: string,
  start: Point,
  end: Point,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const stops = getGradientStops(gradient, foreground, background)
  ctx.save()
  // Preview at the configured opacity so the drag shows what will land, not a
  // full-strength ramp that changes on release.
  ctx.globalAlpha = gradient.opacity ?? 1
  if (document.selection.bounds) {
    clipToSelection(ctx, document)
  }
  let g: CanvasGradient
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dist = Math.hypot(dx, dy) || 1
  if (gradient.type === "linear") {
    g = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
    addGradientStops(g, stops)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, overlay.width, overlay.height)
  } else if (gradient.type === "radial") {
    g = ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, dist)
    addGradientStops(g, stops)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, overlay.width, overlay.height)
  } else if (gradient.type === "reflected") {
    g = ctx.createLinearGradient(start.x - dx, start.y - dy, end.x, end.y)
    for (const s of stops) {
      g.addColorStop(s.offset * 0.5, hexToRgba(s.color, s.opacity))
      g.addColorStop(1 - s.offset * 0.5, hexToRgba(s.color, s.opacity))
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, overlay.width, overlay.height)
  } else if (gradient.type === "angular") {
    const cx = start.x
    const cy = start.y
    const baseAngle = Math.atan2(dy, dx)
    const steps = gradient.cycle ? 180 : 96
    for (let i = 0; i < steps; i++) {
      const a0 = baseAngle + (i / steps) * Math.PI * 2
      const a1 = baseAngle + ((i + 1.25) / steps) * Math.PI * 2
      const c = sampleGradient(gradient, stops, i / steps)
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, overlay.width + overlay.height, a0, a1)
      ctx.closePath()
      ctx.fill()
    }
  } else {
    // Diamond: no CanvasGradient models the |u|+|v| metric, so it is drawn per
    // pixel. sampleGradient re-parses both neighbouring stop colours from hex on
    // every call, which made a full-document drag cost millions of string
    // parses per pointer-move — bake it into a LUT once and index that instead.
    // The inner loop then only does integer arithmetic and one 32-bit store.
    const width = overlay.width
    const height = overlay.height
    const img = ctx.createImageData(width, height)
    const pixels = new Uint32Array(img.data.buffer)
    const lut = gradientLut(gradient, stops)
    const last = GRADIENT_LUT_SIZE - 1
    const cycle = !!gradient.cycle
    const angle = Math.atan2(dy, dx)
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    const scale = 1 / Math.max(1, dist)
    for (let py = 0; py < height; py++) {
      const ry = py - start.y
      // ux and uy are affine in px, so step them along the row instead of
      // recomputing the rotation for every pixel.
      let ux = -start.x * cos - ry * sin
      let uy = -start.x * sin + ry * cos
      let index = py * width
      for (let px = 0; px < width; px++, index++, ux += cos, uy += sin) {
        let t = ((ux < 0 ? -ux : ux) + (uy < 0 ? -uy : uy)) * scale
        if (cycle) t -= Math.floor(t)
        else if (t > 1) t = 1
        pixels[index] = lut[(t * last + 0.5) | 0]
      }
    }
    ctx.putImageData(img, 0, 0)
  }
  ctx.restore()
  applySelectionMaskToCanvas(overlay, document)
  applyDitherToCanvas(overlay, gradient.dither)
}

export function drawMarqueePreview(
  overlay: HTMLCanvasElement,
  document: PsDocument,
  tool: ToolId,
  start: Point,
  end: Point,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.save()
  ctx.strokeStyle = "#fff"
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  if (tool === "marquee-ellipse") {
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (tool === "crop") {
    ctx.fillStyle = "rgba(0,0,0,0.5)"
    ctx.fillRect(0, 0, overlay.width, y)
    ctx.fillRect(0, y + h, overlay.width, overlay.height - (y + h))
    ctx.fillRect(0, y, x, h)
    ctx.fillRect(x + w, y, overlay.width - (x + w), h)
    ctx.strokeStyle = "#fff"
    ctx.setLineDash([])
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    // rule of thirds
    ctx.beginPath()
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y)
      ctx.lineTo(x + (w * i) / 3, y + h)
      ctx.moveTo(x, y + (h * i) / 3)
      ctx.lineTo(x + w, y + (h * i) / 3)
    }
    ctx.stroke()
  } else if (tool === "marquee-row") {
    // Single row marquee: a 1px high line across the whole document.
    ctx.strokeRect(0.5, Math.round(start.y) + 0.5, document.width - 1, 1)
  } else if (tool === "marquee-col") {
    // Single column marquee: a 1px wide line across the whole document.
    ctx.strokeRect(Math.round(start.x) + 0.5, 0.5, 1, document.height - 1)
  } else {
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  }
  ctx.restore()
}

/**
 * Dashed placement box for the type tool. A bare click shows a caret-height
 * box at the insertion point; dragging shows the paragraph box being defined.
 */
export function drawTextBoxPreview(
  overlay: HTMLCanvasElement,
  textSize: number,
  zoom: number,
  start: Point,
  end: Point,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  ctx.save()
  ctx.lineWidth = Math.max(1, 1 / Math.max(0.1, zoom))
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = "rgba(34,211,238,0.95)"
  if (w < TEXT_BOX_DRAG_THRESHOLD && h < TEXT_BOX_DRAG_THRESHOLD) {
    ctx.strokeRect(start.x + 0.5, start.y + 0.5, Math.max(2, textSize * 0.6), textSize * 1.2)
  } else {
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  }
  ctx.restore()
}

export function drawRulerPreview(overlay: HTMLCanvasElement, start: Point, end: Point) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
  ctx.save()
  ctx.strokeStyle = "#06b6d4"
  ctx.fillStyle = "#06b6d4"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(start.x, start.y, 4, 0, Math.PI * 2)
  ctx.arc(end.x, end.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = "11px sans-serif"
  ctx.fillText(`${length.toFixed(1)} px, ${angle.toFixed(1)} deg`, end.x + 8, end.y - 8)
  ctx.restore()
}

export function drawBrushPreview(
  overlay: HTMLCanvasElement,
  tool: ToolId,
  brush: BrushSettings,
  cloneSource: CloneSourceSettings,
  center: Point,
  radius: number,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const feedback = buildRetouchingFeedbackModel({ tool, brush, cloneSource, cursor: center })
  ctx.save()
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(center.x, center.y, Math.max(2, radius), 0, Math.PI * 2)
  ctx.stroke()
  if (feedback.brushEdge.hardnessRadius > 1 && feedback.brushEdge.hardnessRadius < feedback.brushEdge.radius) {
    ctx.setLineDash([])
    ctx.strokeStyle = "rgba(255,255,255,0.45)"
    ctx.beginPath()
    ctx.arc(center.x, center.y, feedback.brushEdge.hardnessRadius, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (feedback.brushEdge.scatterRadius > feedback.brushEdge.radius) {
    ctx.setLineDash([2, 6])
    ctx.strokeStyle = "rgba(56,189,248,0.7)"
    ctx.beginPath()
    ctx.arc(center.x, center.y, feedback.brushEdge.scatterRadius, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (feedback.previewGhost.visible && feedback.previewGhost.sourcePoint) {
    const source = feedback.previewGhost.sourcePoint
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = `rgba(56,189,248,${feedback.previewGhost.opacity})`
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(center.x, center.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = "rgba(56,189,248,0.95)"
    ctx.fillStyle = "rgba(56,189,248,0.16)"
    ctx.beginPath()
    ctx.arc(source.x, source.y, Math.max(3, feedback.brushEdge.radius * 0.35), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

export interface MagneticLassoPreview {
  selectionOptions: SelectionOptions
  /**
   * Resolved lazily: picking the trace source can promote a high-bit layer to
   * an 8-bit surface, which is wasted work for a single-anchor preview.
   */
  resolveTraceSource: () => HTMLCanvasElement | SelectionImageSource | null
}

/**
 * The magnetic lasso draws two polylines: the raw anchors the user clicked and
 * the edge-snapped trace between them, plus the search-radius indicator.
 */
export function drawMagneticLassoPreview(
  ctx: CanvasRenderingContext2D,
  { selectionOptions, resolveTraceSource }: MagneticLassoPreview,
  points: Point[],
  hover?: Point,
) {
  const anchors = hover ? [...points, hover] : points
  let previewPoints = anchors
  const traceSource = anchors.length > 1 ? resolveTraceSource() : null
  if (traceSource) {
    const traced = magneticLassoTrace(traceSource, anchors, {
      searchWidth: Math.max(4, Math.min(64, selectionOptions.magneticWidth ?? 12)),
      contrastThreshold: Math.max(0.01, Math.min(512, selectionOptions.magneticContrast ?? selectionOptions.tolerance ?? 24)),
      hysteresisRatio: Math.max(0.1, Math.min(0.95, (selectionOptions.magneticHysteresis ?? 45) / 100)),
      smoothing: Math.max(0, Math.min(1, (selectionOptions.magneticSmoothing ?? 35) / 100)),
    })
    if (traced.points.length > 1) previewPoints = traced.points
  }

  ctx.save()
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = "rgba(255,255,255,0.68)"
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < anchors.length; i++) ctx.lineTo(anchors[i].x, anchors[i].y)
  ctx.stroke()

  ctx.setLineDash([])
  ctx.strokeStyle = "#22d3ee"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(previewPoints[0].x, previewPoints[0].y)
  for (let i = 1; i < previewPoints.length; i++) ctx.lineTo(previewPoints[i].x, previewPoints[i].y)
  ctx.stroke()

  const indicator = hover ?? points[points.length - 1]
  const width = Math.max(4, Math.min(64, selectionOptions.magneticWidth ?? 12))
  ctx.strokeStyle = "rgba(34,211,238,0.9)"
  ctx.fillStyle = "rgba(34,211,238,0.12)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(indicator.x, indicator.y, width, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = "#ffffff"
  for (const p of points) {
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
  }
  ctx.fillStyle = "#22d3ee"
  ctx.beginPath()
  ctx.arc(indicator.x, indicator.y, 2.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawLassoPreview(
  overlay: HTMLCanvasElement,
  points: Point[],
  hover: Point | undefined,
  magnetic: MagneticLassoPreview | null,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  if (points.length < 1) return
  if (magnetic) {
    drawMagneticLassoPreview(ctx, magnetic, points, hover)
    return
  }
  ctx.save()
  ctx.strokeStyle = "#fff"
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  if (hover) ctx.lineTo(hover.x, hover.y)
  ctx.stroke()
  // dots on points
  ctx.setLineDash([])
  ctx.fillStyle = "#fff"
  for (const p of points) {
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
  }
  ctx.restore()
}

export function drawPatchPreview(
  overlay: HTMLCanvasElement,
  patch: { mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } },
  offset?: Point,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.save()
  ctx.strokeStyle = "#06b6d4"
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.drawImage(patch.mask, 0, 0)
  ctx.globalCompositeOperation = "source-in"
  ctx.fillStyle = "rgba(6,182,212,0.22)"
  ctx.fillRect(0, 0, overlay.width, overlay.height)
  ctx.globalCompositeOperation = "source-over"
  ctx.strokeRect(patch.bounds.x + 0.5, patch.bounds.y + 0.5, patch.bounds.w, patch.bounds.h)
  if (offset) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = "#fff"
    ctx.strokeRect(
      patch.bounds.x + offset.x + 0.5,
      patch.bounds.y + offset.y + 0.5,
      patch.bounds.w,
      patch.bounds.h,
    )
    ctx.setLineDash([])
    ctx.strokeStyle = "#06b6d4"
    ctx.beginPath()
    ctx.moveTo(patch.bounds.x + patch.bounds.w / 2, patch.bounds.y + patch.bounds.h / 2)
    ctx.lineTo(
      patch.bounds.x + patch.bounds.w / 2 + offset.x,
      patch.bounds.y + patch.bounds.h / 2 + offset.y,
    )
    ctx.stroke()
  }
  ctx.restore()
}

export function drawPathPreview(
  overlay: HTMLCanvasElement,
  draft: { points: PathPoint[]; closed: boolean; curvature?: boolean },
  /** Cursor position, drawn as a rubber band from the last anchor. */
  hover?: { x: number; y: number } | null,
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const points = draft.curvature ? makeCurvaturePath(draft.points, draft.closed) : draft.points
  if (points.length < 1) return
  ctx.save()
  // Rubber band to the cursor so the next segment is visible before clicking.
  if (hover && !draft.closed) {
    const last = points[points.length - 1]
    ctx.save()
    ctx.strokeStyle = "rgba(6, 182, 212, 0.55)"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    const c1 = last.cp2 ?? last
    ctx.bezierCurveTo(c1.x, c1.y, hover.x, hover.y, hover.x, hover.y)
    ctx.stroke()
    ctx.restore()
  }
  ctx.strokeStyle = "#06b6d4"
  ctx.lineWidth = 1.5
  // Handle order must match appendPathToCanvas — the segment prev→cur is
  // controlled by prev's *outgoing* handle (cp2) and cur's *incoming* one
  // (cp1). Reading them the other way round drew a mirrored curve, so the
  // committed path never matched the shape the preview promised.
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const c1 = prev.cp2 ?? prev
    const c2 = cur.cp1 ?? cur
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, cur.x, cur.y)
  }
  if (draft.closed && points.length > 2) {
    const last = points[points.length - 1]
    const first = points[0]
    const c1 = last.cp2 ?? last
    const c2 = first.cp1 ?? first
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.x, first.y)
  }
  ctx.stroke()
  ctx.fillStyle = "#06b6d4"
  for (const p of points) {
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6)
    if (p.cp1) {
      ctx.beginPath()
      ctx.arc(p.cp1.x, p.cp1.y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.cp1.x, p.cp1.y)
      ctx.stroke()
    }
    if (p.cp2) {
      ctx.beginPath()
      ctx.arc(p.cp2.x, p.cp2.y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.cp2.x, p.cp2.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function drawTransformHandles(overlay: HTMLCanvasElement, transform: TransformDragState) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.save()
  ctx.strokeStyle = "#06b6d4"
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.5
  // bounding rect using transformed corners
  const corners = transformCorners(transform)
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = "#fff"
  for (const h of transformHandles(transform)) {
    ctx.fillRect(h.x - 4, h.y - 4, 8, 8)
    ctx.strokeRect(h.x - 4, h.y - 4, 8, 8)
  }
  ctx.restore()
}

export function drawPerspectiveCropPreview(overlay: HTMLCanvasElement, pts: Point[]) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)

  // Darken outside area
  ctx.fillStyle = "rgba(0,0,0,0.5)"
  ctx.fillRect(0, 0, overlay.width, overlay.height)

  // Cut out the quad region
  if (pts.length >= 3) {
    ctx.save()
    ctx.globalCompositeOperation = "destination-out"
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Draw quad outline
  ctx.strokeStyle = "#00ccff"
  ctx.setLineDash([])
  ctx.lineWidth = 1.5
  if (pts.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    if (pts.length >= 4) ctx.closePath()
    ctx.stroke()
  }

  // Draw corner dots with numbers
  for (let i = 0; i < pts.length; i++) {
    ctx.fillStyle = i < 4 ? "#00ccff" : "#ff0000"
    ctx.beginPath()
    ctx.arc(pts[i].x, pts[i].y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#000"
    ctx.font = "bold 9px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(`${i + 1}`, pts[i].x, pts[i].y)
  }

  // Instruction text
  ctx.fillStyle = "#fff"
  ctx.font = "12px sans-serif"
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  ctx.fillText(`Click corner ${pts.length + 1} of 4`, 10, 10)
}

export function drawSliceSelectionPreview(
  overlay: HTMLCanvasElement,
  slice: { x: number; y: number; w: number; h: number; name: string },
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.save()
  ctx.strokeStyle = "#fb923c"
  ctx.lineWidth = 2
  ctx.setLineDash([5, 3])
  ctx.strokeRect(slice.x, slice.y, slice.w, slice.h)
  ctx.setLineDash([])
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)"
  ctx.fillRect(slice.x, Math.max(0, slice.y - 20), Math.max(64, slice.name.length * 7 + 12), 18)
  ctx.fillStyle = "#fed7aa"
  ctx.font = "11px system-ui"
  ctx.fillText(slice.name, slice.x + 6, Math.max(12, slice.y - 7))
  ctx.restore()
}

/**
 * Selection chrome for a vector layer: transform box, rounded-rect radius
 * grips, and — when the path is directly editable — anchors and control
 * handles with the current direct-selection highlighted.
 */
export function drawPathSelectionPreview(
  overlay: HTMLCanvasElement,
  layer: Layer,
  options: {
    bounds: { x: number; y: number; w: number; h: number } | null
    editablePath: PathProps | null
    selectedAnchors: PathAnchorRef[]
  },
) {
  const ctx = overlay.getContext("2d")!
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  const bounds = options.bounds
  if (bounds) {
    ctx.save()
    ctx.strokeStyle = "#38bdf8"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
    ctx.setLineDash([])
    for (const handle of shapeHandles(bounds)) {
      ctx.fillStyle = handle.id === "center" ? "#0f172a" : "#ffffff"
      ctx.strokeStyle = "#38bdf8"
      ctx.fillRect(handle.x - 3, handle.y - 3, 6, 6)
      ctx.strokeRect(handle.x - 3, handle.y - 3, 6, 6)
    }
    if (layer.shape?.type === "rect") {
      for (const handle of getRoundedRectCornerRadiusHandles(layer.shape)) {
        ctx.beginPath()
        ctx.fillStyle = "#0f172a"
        ctx.strokeStyle = "#f59e0b"
        ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        const corner =
          handle.corner === "tl" ? { x: layer.shape.x, y: layer.shape.y } :
            handle.corner === "tr" ? { x: layer.shape.x + layer.shape.w, y: layer.shape.y } :
              handle.corner === "br" ? { x: layer.shape.x + layer.shape.w, y: layer.shape.y + layer.shape.h } :
                { x: layer.shape.x, y: layer.shape.y + layer.shape.h }
        ctx.beginPath()
        ctx.moveTo(corner.x, corner.y)
        ctx.lineTo(handle.x, handle.y)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  const editablePath = options.editablePath
  if (editablePath?.points.length) {
    const pathParts = [{ path: editablePath, subpathIndex: -1 }, ...(editablePath.subpaths ?? []).map((path, subpathIndex) => ({ path, subpathIndex }))]
    const selected = options.selectedAnchors
    const drawHandle = (point: Point, size = 3) => {
      ctx.fillRect(point.x - size, point.y - size, size * 2, size * 2)
      ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2)
    }
    const drawControls = (path: PathProps) => {
      for (const point of path.points) {
        if (point.cp1) {
          ctx.beginPath()
          ctx.moveTo(point.x, point.y)
          ctx.lineTo(point.cp1.x, point.cp1.y)
          ctx.stroke()
          drawHandle(point.cp1)
        }
        if (point.cp2) {
          ctx.beginPath()
          ctx.moveTo(point.x, point.y)
          ctx.lineTo(point.cp2.x, point.cp2.y)
          ctx.stroke()
          drawHandle(point.cp2)
        }
      }
    }
    ctx.save()
    ctx.strokeStyle = "#38bdf8"
    ctx.fillStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.beginPath()
    appendPathToCanvas(ctx, editablePath)
    ctx.stroke()
    ctx.strokeStyle = "#f59e0b"
    ctx.fillStyle = "#ffffff"
    for (const entry of pathParts) drawControls(entry.path)
    ctx.strokeStyle = "#38bdf8"
    for (const entry of pathParts) {
      for (const [pointIndex, point] of entry.path.points.entries()) {
        const isSelected = selected.some((anchor) => anchor.subpathIndex === entry.subpathIndex && anchor.pointIndex === pointIndex)
        ctx.beginPath()
        ctx.fillStyle = isSelected ? "#38bdf8" : "#ffffff"
        ctx.strokeStyle = isSelected ? "#ffffff" : "#38bdf8"
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}
