/**
 * Preview renderers for the vector tools — the pen family and its anchor
 * editing, path selection, type, and the shape tools.
 *
 * Renderers are deterministic pure functions of elapsed time drawing into an
 * already DPR-scaled 80x60 context. Shared drawing vocabulary lives in
 * `preview-primitives.ts`; the kind -> renderer switch lives in
 * `preview-painters.ts`.
 */

import type { ToolPreviewKind } from "@/editor/tool/tooltip-content"
import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  TAU,
  ease,
  beat,
  paintPhoto,
  drawCrosshair,
  drawArrowCursor,
  drawRipple,
  drawBadge,
  clamp,
} from "@/editor/tool/preview-primitives"

const PEN_A = { x: 11, y: 46 }
const PEN_B = { x: 40, y: 19 }
const PEN_C = { x: 69, y: 44 }
const PEN_HB = { x: 18, y: 0 }
const PEN_HC = { x: 14, y: 12 }

function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, u: number) {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}

function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, selected = true) {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = "#111111"
  ctx.fillStyle = selected ? "#ffffff" : "rgba(255,255,255,0.25)"
  ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
  ctx.strokeRect(x - 2.5, y - 2.5, 5, 5)
  ctx.restore()
}

/** Direction handle: bar through the anchor with a round knob at each live end. */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  vector: { x: number; y: number },
  grow: number,
  mirrored: boolean,
) {
  if (grow <= 0.01) return
  const out = { x: anchor.x + vector.x * grow, y: anchor.y + vector.y * grow }
  const back = { x: anchor.x - vector.x * grow, y: anchor.y - vector.y * grow }
  ctx.save()
  ctx.strokeStyle = "rgba(123,209,255,0.9)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mirrored ? back.x : anchor.x, mirrored ? back.y : anchor.y)
  ctx.lineTo(out.x, out.y)
  ctx.stroke()
  ctx.fillStyle = "#7bd1ff"
  for (const knob of mirrored ? [out, back] : [out]) {
    ctx.beginPath()
    ctx.arc(knob.x, knob.y, 2.2, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

function drawPenCursor(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(4.5, 7)
  ctx.lineTo(8, 3.5)
  ctx.closePath()
  ctx.fillStyle = "#ffffff"
  ctx.fill()
  ctx.strokeStyle = "#111111"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(5.5, 5)
  ctx.lineTo(11, 10.5)
  ctx.stroke()
  ctx.restore()
}

/**
 * Click to drop an anchor, drag to pull out direction handles and bend the
 * segment — the actual construction loop of the pen tool.
 */
export function drawPen(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 4.8
  const freeform = kind === "freeform-pen"
  const curvature = kind === "curvature-pen"

  // Beat table per variant: when each anchor lands and how far its handle pulls.
  const hasB = freeform ? beat(t, 0.5, 2.1) >= 1 : t > 1.15
  const hasC = freeform ? beat(t, 0.5, 2.1) >= 1 : t > 2.55
  const growB = curvature ? ease(beat(t, 2.55, 3.2)) : freeform ? 1 : ease(beat(t, 1.2, 1.85))
  const growC = curvature ? ease(beat(t, 2.55, 3.2)) : freeform ? 1 : ease(beat(t, 2.6, 3.2))
  const trace = freeform ? beat(t, 0.5, 2.1) : 1

  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PEN_A.x, PEN_A.y)
  if (freeform) {
    // Freehand: the path is dragged out in one continuous motion.
    const steps = Math.max(1, Math.round(48 * trace))
    for (let i = 1; i <= steps; i++) {
      const p = penPointAt((i / steps) * trace, growB, growC)
      ctx.lineTo(p.x, p.y)
    }
  } else {
    if (hasB) ctx.bezierCurveTo(PEN_A.x, PEN_A.y, PEN_B.x - PEN_HB.x * growB, PEN_B.y - PEN_HB.y * growB, PEN_B.x, PEN_B.y)
    if (hasC) {
      ctx.bezierCurveTo(
        PEN_B.x + PEN_HB.x * growB,
        PEN_B.y + PEN_HB.y * growB,
        PEN_C.x - PEN_HC.x * growC,
        PEN_C.y - PEN_HC.y * growC,
        PEN_C.x,
        PEN_C.y,
      )
    }
  }
  ctx.stroke()
  ctx.restore()

  if (!freeform) {
    drawHandles(ctx, PEN_B, PEN_HB, growB, true)
    // Only the incoming handle at the final anchor — the outgoing one is off-canvas.
    drawHandles(ctx, PEN_C, { x: -PEN_HC.x, y: -PEN_HC.y }, growC, false)
  }

  if (freeform ? trace > 0 : t > 0.55) drawAnchor(ctx, PEN_A.x, PEN_A.y)
  if (hasB) drawAnchor(ctx, PEN_B.x, PEN_B.y)
  if (hasC) drawAnchor(ctx, PEN_C.x, PEN_C.y)

  // Cursor: travels between clicks, then rides the handle while dragging.
  let cursor = PEN_A
  if (freeform) {
    cursor = penPointAt(trace, 1, 1)
  } else if (t < 0.55) {
    cursor = lerpPoint({ x: 4, y: 30 }, PEN_A, ease(beat(t, 0, 0.5)))
  } else if (t < 1.15) {
    cursor = lerpPoint(PEN_A, PEN_B, ease(beat(t, 0.7, 1.15)))
  } else if (t < 2.0) {
    cursor = { x: PEN_B.x + PEN_HB.x * growB, y: PEN_B.y + PEN_HB.y * growB }
  } else if (t < 2.55) {
    cursor = lerpPoint({ x: PEN_B.x + PEN_HB.x, y: PEN_B.y + PEN_HB.y }, PEN_C, ease(beat(t, 2.05, 2.55)))
  } else if (t < 3.4) {
    cursor = { x: PEN_C.x - PEN_HC.x * growC, y: PEN_C.y - PEN_HC.y * growC }
  } else {
    cursor = PEN_C
  }
  drawPenCursor(ctx, cursor.x, cursor.y)
}

/** Point at parameter `u` (0..1) along the two-segment demo path. */
function penPointAt(u: number, growB: number, growC: number) {
  const p = clamp(u, 0, 1)
  if (p <= 0.5) {
    return cubicAt(
      PEN_A,
      PEN_A,
      { x: PEN_B.x - PEN_HB.x * growB, y: PEN_B.y - PEN_HB.y * growB },
      PEN_B,
      p / 0.5,
    )
  }
  return cubicAt(
    PEN_B,
    { x: PEN_B.x + PEN_HB.x * growB, y: PEN_B.y + PEN_HB.y * growB },
    { x: PEN_C.x - PEN_HC.x * growC, y: PEN_C.y - PEN_HC.y * growC },
    PEN_C,
    (p - 0.5) / 0.5,
  )
}

function cubicAt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  u: number,
) {
  const v = 1 - u
  const a = v * v * v
  const b = 3 * v * v * u
  const c = 3 * v * u * u
  const d = u * u * u
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Add, delete, or convert a single anchor on a finished path. */
export function drawAnchorEdit(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.6
  const acted = t > 1.5
  const settle = ease(beat(t, 1.5, 2.1))
  // convert: the middle anchor's handles retract, turning a smooth point into a corner.
  const growB = kind === "anchor-convert" ? 1 - settle : 1
  const keepB = kind === "anchor-delete" ? !acted : true
  const midpoint = cubicAt(
    PEN_B,
    { x: PEN_B.x + PEN_HB.x, y: PEN_B.y + PEN_HB.y },
    { x: PEN_C.x - PEN_HC.x, y: PEN_C.y - PEN_HC.y },
    PEN_C,
    0.5,
  )

  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PEN_A.x, PEN_A.y)
  if (keepB) {
    ctx.bezierCurveTo(PEN_A.x, PEN_A.y, PEN_B.x - PEN_HB.x * growB, PEN_B.y - PEN_HB.y * growB, PEN_B.x, PEN_B.y)
    ctx.bezierCurveTo(
      PEN_B.x + PEN_HB.x * growB,
      PEN_B.y + PEN_HB.y * growB,
      PEN_C.x - PEN_HC.x,
      PEN_C.y - PEN_HC.y,
      PEN_C.x,
      PEN_C.y,
    )
  } else {
    // With the middle anchor gone the two segments collapse into one.
    ctx.bezierCurveTo(PEN_A.x + 6, PEN_A.y - 10, PEN_C.x - PEN_HC.x, PEN_C.y - PEN_HC.y, PEN_C.x, PEN_C.y)
  }
  ctx.stroke()
  ctx.restore()

  if (keepB) drawHandles(ctx, PEN_B, PEN_HB, growB, true)
  drawHandles(ctx, PEN_C, { x: -PEN_HC.x, y: -PEN_HC.y }, 1, false)
  drawAnchor(ctx, PEN_A.x, PEN_A.y, false)
  drawAnchor(ctx, PEN_C.x, PEN_C.y, false)
  if (keepB) drawAnchor(ctx, PEN_B.x, PEN_B.y, kind !== "anchor-add")
  if (kind === "anchor-add" && acted) drawAnchor(ctx, midpoint.x, midpoint.y)

  const target = kind === "anchor-add" ? midpoint : PEN_B
  const cursor = lerpPoint({ x: 6, y: 14 }, target, ease(beat(t, 0.2, 1.3)))
  drawRipple(ctx, target.x, target.y, beat(t, 1.45, 1.9))
  drawPenCursor(ctx, cursor.x, cursor.y)

  // Badge the mode so add / delete / convert stay distinguishable.
  const glyph = kind === "anchor-add" ? "+" : kind === "anchor-delete" ? "−" : "⌃"
  ctx.save()
  ctx.fillStyle = kind === "anchor-delete" ? "#ff7b7b" : "#7bd1ff"
  ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(glyph, cursor.x + 12, cursor.y + 3)
  ctx.restore()
}

const PATH_NODES = [
  { x: 40, y: 17 },
  { x: 64, y: 33 },
  { x: 40, y: 50 },
  { x: 16, y: 33 },
]

/** Closed Catmull-Rom curve through `points`, as a reusable Path2D. */
function smoothClosedPath(points: Array<{ x: number; y: number }>) {
  const path = new Path2D()
  const n = points.length
  path.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    path.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    )
  }
  path.closePath()
  return path
}

/**
 * Black arrow moves the whole path; white arrow drags one anchor and reshapes
 * the curve around it.
 */
export function drawPathSelect(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.8
  const shift = ease(beat(t, 0.55, 1.6)) - ease(beat(t, 2.7, 3.7))
  const whole = kind === "path-select"
  const dx = shift * (whole ? 13 : 5)
  const dy = shift * (whole ? -8 : -9)
  const nodes = PATH_NODES.map((p, i) => (whole || i === 0 ? { x: p.x + dx, y: p.y + dy } : { ...p }))
  const path = smoothClosedPath(nodes)

  if (Math.abs(shift) > 0.03) {
    ctx.save()
    ctx.setLineDash([2, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.3)"
    ctx.lineWidth = 1
    ctx.stroke(smoothClosedPath(PATH_NODES))
    ctx.restore()
  }

  ctx.save()
  ctx.fillStyle = "rgba(58,109,240,0.3)"
  ctx.fill(path)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.stroke(path)
  ctx.restore()

  if (!whole) {
    const anchor = nodes[0]
    drawHandles(
      ctx,
      anchor,
      { x: (nodes[1].x - nodes[3].x) / 3, y: (nodes[1].y - nodes[3].y) / 3 },
      1,
      true,
    )
  }
  nodes.forEach((p, i) => drawAnchor(ctx, p.x, p.y, whole || i === 0))

  const grip = whole ? { x: nodes[1].x - 2, y: nodes[1].y - 2 } : nodes[0]
  drawArrowCursor(ctx, grip.x, grip.y, whole)
}

/** Click to set an insertion point, type, then double-click to select a word. */
export function drawType(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 5.2
  const word = "Type"
  const vertical = kind === "type-vertical"
  const mask = kind === "type-mask"
  const typed = word.slice(0, Math.floor(beat(t, 0.8, 2.5) * word.length))
  const selecting = t > 3.5 && t < 4.7
  const caretOn = t > 0.7 && t < 3.5 && Math.floor(t * 2.4) % 2 === 0
  const boxAlpha = beat(t, 0.55, 0.8)
  const font = vertical ? 'bold 13px Georgia, "Times New Roman", serif' : 'bold 20px Georgia, "Times New Roman", serif'
  const originX = vertical ? PREVIEW_WIDTH / 2 : 15
  const baseline = 36

  if (mask) paintPhoto(ctx)

  if (boxAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = boxAlpha * 0.75
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.65)"
    ctx.lineWidth = 1
    ctx.strokeRect(8.5, vertical ? 6.5 : 14.5, 63, vertical ? 47 : 30)
    ctx.restore()
  }

  ctx.save()
  ctx.font = font
  ctx.textBaseline = vertical ? "middle" : "alphabetic"
  ctx.textAlign = vertical ? "center" : "left"
  const width = vertical ? 0 : ctx.measureText(typed).width

  if (selecting && typed) {
    ctx.fillStyle = "#2f6fd0"
    if (vertical) ctx.fillRect(originX - 9, 10, 18, typed.length * 13)
    else ctx.fillRect(originX - 1, baseline - 16, width + 2, 21)
  }

  if (mask) {
    // Type mask cuts the letters out of a rubylith overlay — the text is a selection.
    ctx.fillStyle = "rgba(220,40,40,0.5)"
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    ctx.globalCompositeOperation = "destination-out"
  }
  ctx.fillStyle = "#ffffff"
  if (vertical) {
    for (let i = 0; i < typed.length; i++) ctx.fillText(typed[i], originX, 17 + i * 13)
  } else {
    ctx.fillText(typed, originX, baseline)
  }
  if (mask) {
    // Put the artwork back inside the letters — they are a window, not a hole.
    ctx.globalCompositeOperation = "destination-over"
    paintPhoto(ctx)
  }
  ctx.restore()

  if (mask && typed) {
    ctx.save()
    ctx.font = font
    ctx.textBaseline = vertical ? "middle" : "alphabetic"
    ctx.textAlign = vertical ? "center" : "left"
    ctx.strokeStyle = "rgba(255,255,255,0.9)"
    ctx.lineWidth = 0.7
    ctx.setLineDash([2, 2])
    if (vertical) {
      for (let i = 0; i < typed.length; i++) ctx.strokeText(typed[i], originX, 17 + i * 13)
    } else {
      ctx.strokeText(typed, originX, baseline)
    }
    ctx.restore()
  }

  if (caretOn) {
    ctx.fillStyle = "#ffffff"
    if (vertical) ctx.fillRect(originX - 7, 11 + typed.length * 13, 14, 2)
    else ctx.fillRect(originX + width + 1, baseline - 16, 1.5, 20)
  }

  // I-beam travels in and clicks to place the insertion point.
  if (t < 0.9) {
    const p = ease(beat(t, 0, 0.55))
    const ix = 4 + (originX - 4) * p
    const iy = 46 - 16 * p
    ctx.save()
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ix, iy - 6)
    ctx.lineTo(ix, iy + 6)
    ctx.moveTo(ix - 3, iy - 6)
    ctx.lineTo(ix + 3, iy - 6)
    ctx.moveTo(ix - 3, iy + 6)
    ctx.lineTo(ix + 3, iy + 6)
    ctx.stroke()
    ctx.restore()
    drawRipple(ctx, originX, baseline - 6, beat(t, 0.55, 0.95))
  }
}

/** Shape geometry fitted to the box the pointer has dragged out. */
function shapePath(kind: ToolPreviewKind, x: number, y: number, w: number, h: number) {
  const path = new Path2D()
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  switch (kind) {
    case "shape-rounded-rect":
      path.roundRect(x, y, w, h, Math.max(0, Math.min(8, w / 3, h / 3)))
      break
    case "shape-ellipse":
      path.ellipse(cx, cy, rx, ry, 0, 0, TAU)
      break
    case "shape-polygon":
    case "shape-star": {
      const corners = kind === "shape-star" ? 10 : 6
      for (let i = 0; i < corners; i++) {
        const a = (i / corners) * TAU - Math.PI / 2
        const k = kind === "shape-star" && i % 2 ? 0.45 : 1
        const px = cx + Math.cos(a) * rx * k
        const py = cy + Math.sin(a) * ry * k
        if (i === 0) path.moveTo(px, py)
        else path.lineTo(px, py)
      }
      path.closePath()
      break
    }
    case "shape-triangle":
      path.moveTo(cx, y)
      path.lineTo(x + w, y + h)
      path.lineTo(x, y + h)
      path.closePath()
      break
    case "shape-line":
      path.moveTo(x, y + h)
      path.lineTo(x + w, y)
      break
    case "custom-shape": {
      const mx = (u: number) => x + u * w
      const my = (v: number) => y + v * h
      path.moveTo(mx(0.5), my(0.96))
      path.bezierCurveTo(mx(0.02), my(0.46), mx(0.14), my(0.02), mx(0.5), my(0.28))
      path.bezierCurveTo(mx(0.86), my(0.02), mx(0.98), my(0.46), mx(0.5), my(0.96))
      path.closePath()
      break
    }
    default:
      path.rect(x, y, w, h)
      break
  }
  return path
}

/** Drag from one corner to the other; the shape is previewed live, then set. */
export function drawShape(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.6
  const p = ease(beat(t, 0.35, 1.6))
  const dragging = t < 1.75
  const x = 11
  const y = 10
  const w = 58 * p
  const h = 40 * p
  if (p <= 0.01) {
    drawCrosshair(ctx, x, y)
    return
  }

  const path = shapePath(kind, x, y, w, h)
  ctx.save()
  if (kind === "shape-line") {
    ctx.strokeStyle = "#3a6df0"
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.stroke(path)
  } else {
    ctx.fillStyle = "#3a6df0"
    ctx.fill(path)
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.stroke(path)
  }
  ctx.restore()

  if (dragging) {
    ctx.save()
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.55)"
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    ctx.restore()
    drawCrosshair(ctx, x + w, y + h)
    drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round(w)}×${Math.round(h)}`)
  } else {
    ctx.save()
    ctx.fillStyle = "#ffffff"
    ctx.strokeStyle = "#111111"
    ctx.lineWidth = 1
    for (const [hx, hy] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]) {
      ctx.fillRect(hx - 2.5, hy - 2.5, 5, 5)
      ctx.strokeRect(hx - 2.5, hy - 2.5, 5, 5)
    }
    ctx.restore()
  }
}
