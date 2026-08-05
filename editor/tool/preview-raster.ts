/**
 * Preview renderers for the raster tools — brush and stroke work, the marquee
 * and lasso family, crop, the sampling tools, and the retouch/tonal group.
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
  paintDetail,
  strokePointAt,
  strokeTrail,
  trailRegion,
  samplePixel,
  drawCrosshair,
  drawRipple,
  paintCheckerTiles,
  drawCursor,
  clamp,
} from "@/editor/tool/preview-primitives"

export function drawBrushStroke(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const progress = clamp(t / 1.5, 0, 1)
  // Sample points along a sinusoidal stroke.
  const steps = 60
  ctx.save()
  if (kind === "pencil") {
    ctx.lineCap = "square"
    ctx.lineJoin = "miter"
    ctx.lineWidth = 2
  } else {
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 4
  }
  ctx.strokeStyle = kind === "color-replace" ? "#7bd1ff" : "#f5f5f5"
  ctx.beginPath()
  for (let i = 0; i <= steps * progress; i++) {
    const u = i / steps
    const x = 8 + u * (PREVIEW_WIDTH - 16)
    const y = PREVIEW_HEIGHT / 2 + Math.sin(u * Math.PI * 1.6) * 14
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
  const head = strokeHead(progress)
  drawCursor(ctx, head.x, head.y, kind === "pencil" ? 3 : 5)
}

function strokeHead(progress: number) {
  const u = progress
  const x = 8 + u * (PREVIEW_WIDTH - 16)
  const y = PREVIEW_HEIGHT / 2 + Math.sin(u * Math.PI * 1.6) * 14
  return { x, y }
}

export function drawMarquee(ctx: CanvasRenderingContext2D, t: number, shape: "rect" | "ellipse") {
  const w = 8 + (PREVIEW_WIDTH - 24) * clamp(t / 1.2, 0, 1)
  const h = 8 + (PREVIEW_HEIGHT - 20) * clamp(t / 1.2, 0, 1)
  const x = (PREVIEW_WIDTH - w) / 2
  const y = (PREVIEW_HEIGHT - h) / 2
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  const dashPhase = (t * 20) % 6
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -dashPhase
  ctx.beginPath()
  if (shape === "rect") ctx.rect(x, y, w, h)
  else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  drawCursor(ctx, x + w, y + h, 3)
}

export function drawSingleAxisMarquee(ctx: CanvasRenderingContext2D, t: number, axis: "row" | "col") {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -(t * 20) % 6
  ctx.lineWidth = 1
  const sweep = (Math.sin(t * Math.PI) + 1) / 2 // 0..1..0
  if (axis === "row") {
    const y = 10 + sweep * (PREVIEW_HEIGHT - 20)
    ctx.beginPath()
    ctx.moveTo(2, y)
    ctx.lineTo(PREVIEW_WIDTH - 2, y)
    ctx.stroke()
  } else {
    const x = 10 + sweep * (PREVIEW_WIDTH - 20)
    ctx.beginPath()
    ctx.moveTo(x, 2)
    ctx.lineTo(x, PREVIEW_HEIGHT - 2)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawLasso(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const progress = clamp(t / 1.5, 0, 1)
  const steps = 80
  const cx = PREVIEW_WIDTH / 2
  const cy = PREVIEW_HEIGHT / 2
  ctx.save()
  ctx.strokeStyle = kind === "refine-edge" || kind === "subject" || kind === "sky" || kind === "background" ? "#7bd1ff" : "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.lineDashOffset = -(t * 20) % 5
  ctx.beginPath()
  for (let i = 0; i <= steps * progress; i++) {
    const u = i / steps
    const a = u * Math.PI * 2
    const r = 22 + Math.sin(a * 3) * 4
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * (r - 4)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawPolygonLasso(ctx: CanvasRenderingContext2D, t: number) {
  const progress = clamp(t / 1.5, 0, 1)
  const points: Array<[number, number]> = [
    [12, 48],
    [30, 14],
    [56, 18],
    [70, 42],
    [50, 52],
  ]
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.lineDashOffset = -(t * 20) % 5
  const visible = Math.floor(progress * points.length)
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i <= visible; i++) {
    ctx.lineTo(points[i][0], points[i][1])
  }
  ctx.stroke()
  ctx.restore()
  for (let i = 0; i <= visible; i++) {
    const [x, y] = points[i]
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
}

export function drawMagicWand(ctx: CanvasRenderingContext2D, t: number) {
  // Pulse a star-shaped selection.
  const pulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.2
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -(t * 20) % 6
  ctx.beginPath()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const r = (i % 2 === 0 ? 18 : 22) * pulse
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

export function drawCrop(ctx: CanvasRenderingContext2D, t: number) {
  const inset = 6 + Math.sin(t * Math.PI) * 4
  const x = inset
  const y = inset
  const w = PREVIEW_WIDTH - inset * 2
  const h = PREVIEW_HEIGHT - inset * 2
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
  ctx.strokeStyle = "rgba(255,255,255,0.4)"
  ctx.beginPath()
  ctx.moveTo(x + w / 3, y)
  ctx.lineTo(x + w / 3, y + h)
  ctx.moveTo(x + (2 * w) / 3, y)
  ctx.lineTo(x + (2 * w) / 3, y + h)
  ctx.moveTo(x, y + h / 3)
  ctx.lineTo(x + w, y + h / 3)
  ctx.moveTo(x, y + (2 * h) / 3)
  ctx.lineTo(x + w, y + (2 * h) / 3)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = "#ffffff"
  ;[
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].forEach(([cx, cy]) => ctx.fillRect(cx - 2, cy - 2, 4, 4))
}

export function drawPerspectiveCrop(ctx: CanvasRenderingContext2D, t: number) {
  const skew = Math.sin(t * Math.PI) * 6
  const pts: Array<[number, number]> = [
    [10 + skew, 12],
    [PREVIEW_WIDTH - 10, 8],
    [PREVIEW_WIDTH - 14, PREVIEW_HEIGHT - 10],
    [14, PREVIEW_HEIGHT - 6 + skew],
  ]
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = "#ffffff"
  for (const [x, y] of pts) ctx.fillRect(x - 2, y - 2, 4, 4)
  ctx.restore()
}

export function drawSlice(ctx: CanvasRenderingContext2D, _t: number) {
  ctx.save()
  ctx.strokeStyle = "#9ad2ff"
  ctx.lineWidth = 1
  ctx.strokeRect(6, 6, PREVIEW_WIDTH - 12, PREVIEW_HEIGHT - 12)
  ctx.beginPath()
  ctx.moveTo(PREVIEW_WIDTH / 2, 6)
  ctx.lineTo(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT - 6)
  ctx.moveTo(6, PREVIEW_HEIGHT / 2)
  ctx.lineTo(PREVIEW_WIDTH - 6, PREVIEW_HEIGHT / 2)
  ctx.stroke()
  ctx.fillStyle = "#9ad2ff"
  ctx.fillRect(8, 8, 9, 7)
  ctx.fillStyle = "rgba(154,210,255,0.7)"
  ctx.fillRect(PREVIEW_WIDTH / 2 + 2, 8, 9, 7)
  ctx.restore()
}

const EYEDROPPER_STOPS: Array<[number, number]> = [
  [16, 12], // sky
  [58, 15], // sun
  [21, 36], // roof
]

/**
 * Move over the artwork, click, and the foreground swatch takes the pixel
 * underneath. The ring shows the live pixel on top and the current foreground
 * on the bottom — the same split ring Photoshop draws while sampling.
 */
export function drawEyedropper(ctx: CanvasRenderingContext2D, elapsed: number) {
  const dwell = 1.7
  const t = elapsed % (dwell * EYEDROPPER_STOPS.length)
  const index = Math.floor(t / dwell)
  const local = t - index * dwell
  const from = EYEDROPPER_STOPS[(index + EYEDROPPER_STOPS.length - 1) % EYEDROPPER_STOPS.length]
  const to = EYEDROPPER_STOPS[index]
  const travel = ease(beat(local, 0, 0.6))
  const x = from[0] + (to[0] - from[0]) * travel
  const y = from[1] + (to[1] - from[1]) * travel
  const picked = local >= 0.72

  paintPhoto(ctx)
  const live = samplePixel(ctx, x, y)
  const foreground = samplePixel(ctx, ...(picked ? to : from))

  // Split sampling ring: live pixel above, current foreground below.
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 10, Math.PI, 0)
  ctx.arc(x, y, 6, 0, Math.PI, true)
  ctx.closePath()
  ctx.fillStyle = live
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, 10, 0, Math.PI)
  ctx.arc(x, y, 6, Math.PI, 0, true)
  ctx.closePath()
  ctx.fillStyle = foreground
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = "rgba(0,0,0,0.55)"
  ctx.beginPath()
  ctx.arc(x, y, 10.5, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.arc(x, y, 6, 0, TAU)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 2.5, y)
  ctx.lineTo(x + 2.5, y)
  ctx.moveTo(x, y - 2.5)
  ctx.lineTo(x, y + 2.5)
  ctx.stroke()
  ctx.restore()

  drawRipple(ctx, to[0], to[1], beat(local, 0.66, 1.06))

  // Foreground / background swatches — the foreground flips on the click.
  ctx.save()
  ctx.fillStyle = "#e8e8e8"
  ctx.fillRect(58, 45, 13, 13)
  ctx.fillStyle = foreground
  ctx.fillRect(52, 39, 13, 13)
  ctx.strokeStyle = "rgba(255,255,255,0.85)"
  ctx.lineWidth = 1
  ctx.strokeRect(58.5, 45.5, 12, 12)
  ctx.strokeRect(52.5, 39.5, 12, 12)
  ctx.restore()
}

export function drawRuler(ctx: CanvasRenderingContext2D, _t: number) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(8, PREVIEW_HEIGHT - 10)
  ctx.lineTo(PREVIEW_WIDTH - 8, 14)
  ctx.stroke()
  for (let i = 0; i < 9; i++) {
    const u = i / 8
    const x = 8 + u * (PREVIEW_WIDTH - 16)
    const y = PREVIEW_HEIGHT - 10 - u * (PREVIEW_HEIGHT - 24)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 4, y - 4)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawNote(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save()
  ctx.fillStyle = "#f1d35a"
  ctx.fillRect(18, 14, 44, 34)
  ctx.fillStyle = "#e0bc3c"
  ctx.beginPath()
  ctx.moveTo(54, 48)
  ctx.lineTo(62, 48)
  ctx.lineTo(62, 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = "rgba(0,0,0,0.4)"
  for (let i = 0; i < 3; i++) ctx.fillRect(24, 22 + i * 6, 30 - i * 2, 2)
  ctx.restore()
  const pulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.3
  ctx.fillStyle = `rgba(255,255,255,${pulse})`
  ctx.beginPath()
  ctx.arc(62, 12, 3, 0, Math.PI * 2)
  ctx.fill()
}

export function drawCount(ctx: CanvasRenderingContext2D, t: number) {
  const dots = [
    [16, 18],
    [38, 14],
    [60, 22],
    [22, 36],
    [50, 44],
  ]
  const visible = Math.max(1, Math.floor(clamp(t / 1.5, 0, 1) * dots.length))
  ctx.save()
  ctx.fillStyle = "#ff5b5b"
  ctx.font = "bold 9px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  for (let i = 0; i < visible; i++) {
    const [x, y] = dots[i]
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(255,91,91,0.85)"
    ctx.fill()
    ctx.fillStyle = "#ffffff"
    ctx.fillText(String(i + 1), x, y + 1)
  }
  ctx.restore()
}

export function drawBucket(ctx: CanvasRenderingContext2D, t: number) {
  const fillProgress = clamp(t / 1.4, 0, 1)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(8, 24, (PREVIEW_WIDTH - 16) * fillProgress, PREVIEW_HEIGHT - 32)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.strokeRect(8, 24, PREVIEW_WIDTH - 16, PREVIEW_HEIGHT - 32)
  // Drip
  const dropY = 8 + (t / 2) * 14
  ctx.beginPath()
  ctx.fillStyle = "#3a6df0"
  ctx.arc(40, dropY, 3, 0, Math.PI * 2)
  ctx.fill()
}

export function drawHeal(ctx: CanvasRenderingContext2D, t: number) {
  // Show a blemish that fades out as the brush passes.
  const blemishAlpha = 1 - clamp(t / 1.4, 0, 1)
  ctx.fillStyle = `rgba(180,80,60,${blemishAlpha})`
  ctx.beginPath()
  ctx.arc(40, 32, 8, 0, Math.PI * 2)
  ctx.fill()
  const x = 12 + (t / 2) * (PREVIEW_WIDTH - 24)
  drawCursor(ctx, x, 32, 8)
}

export function drawRedEye(ctx: CanvasRenderingContext2D, t: number) {
  const t2 = clamp(t / 1.2, 0, 1)
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.ellipse(40, 30, 22, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(${Math.round(220 - t2 * 200)}, ${Math.round(40 + t2 * 20)}, ${Math.round(40 + t2 * 20)},1)`
  ctx.beginPath()
  ctx.arc(40, 30, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#111111"
  ctx.beginPath()
  ctx.arc(40, 30, 3, 0, Math.PI * 2)
  ctx.fill()
}

export function drawClone(ctx: CanvasRenderingContext2D, t: number) {
  const t2 = clamp(t / 1.5, 0, 1)
  ctx.fillStyle = "#7bd1ff"
  ctx.beginPath()
  ctx.arc(20, 20, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(123,209,255,${t2})`
  ctx.beginPath()
  ctx.arc(20 + t2 * 36, 20 + t2 * 18, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.setLineDash([2, 2])
  ctx.beginPath()
  ctx.moveTo(20, 20)
  ctx.lineTo(20 + t2 * 36, 20 + t2 * 18)
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * The document is sitting in a desaturated state; brushing paints the earlier
 * (color) history state back in, only where the stroke lands.
 */
export function drawHistory(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.8
  const progress = beat(t, 0.55, 2.4)
  const fade = 1 - beat(t, 3.4, 3.8)
  paintPhoto(ctx, true)
  if (progress > 0) {
    const points = strokeTrail(progress, kind === "art-history" ? 3 : 0)
    ctx.save()
    ctx.globalAlpha = fade
    ctx.clip(trailRegion(points, 9))
    paintPhoto(ctx)
    ctx.restore()
    if (t < 2.5) {
      const head = points[points.length - 1]
      drawCursor(ctx, head.x, head.y, 9)
    }
  }
  drawHistorySourceBadge(ctx)
}

/** "Painting from this saved state" chip shown by the history brush demo. */
function drawHistorySourceBadge(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.fillStyle = "rgba(0,0,0,0.58)"
  ctx.beginPath()
  ctx.roundRect(3, 3, 28, 14, 3)
  ctx.fill()
  ctx.strokeStyle = "#7bd1ff"
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(11, 10, 4.2, Math.PI * 0.42, Math.PI * 1.85)
  ctx.stroke()
  ctx.fillStyle = "#7bd1ff"
  ctx.beginPath()
  ctx.moveTo(13.6, 13.8)
  ctx.lineTo(14.4, 9.6)
  ctx.lineTo(10.3, 11)
  ctx.closePath()
  ctx.fill()
  // Thumbnail of the state being restored.
  ctx.fillStyle = "#2f6b47"
  ctx.fillRect(19, 6, 9, 8)
  ctx.fillStyle = "#e07b5a"
  ctx.fillRect(19, 6, 9, 3)
  ctx.strokeStyle = "rgba(255,255,255,0.7)"
  ctx.lineWidth = 1
  ctx.strokeRect(19.5, 6.5, 8, 7)
  ctx.restore()
}

/** Pixels are removed along the stroke, exposing transparency underneath. */
export function drawEraser(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  paintPhoto(ctx)
  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.globalCompositeOperation = "destination-out"
    for (const p of points) {
      const dab = ctx.createRadialGradient(p.x, p.y, 6.5, p.x, p.y, 9)
      dab.addColorStop(0, "rgba(0,0,0,1)")
      dab.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = dab
      ctx.fillRect(p.x - 9, p.y - 9, 18, 18)
    }
    ctx.restore()
  }
  // Refill what was erased with the transparency checker.
  ctx.save()
  ctx.globalCompositeOperation = "destination-over"
  paintCheckerTiles(ctx, true)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.restore()
  if (progress > 0 && t < 2.2) {
    const head = strokePointAt(progress)
    drawCursor(ctx, head.x, head.y, 9)
  }
}

/** Drag sets the ramp axis; the whole layer fills along it, live. */
export function drawGradient(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.6
  const p = ease(beat(t, 0.4, 1.9))
  const guide = 1 - beat(t, 2.1, 2.5)
  const x0 = 14
  const y0 = 46
  const hx = x0 + (66 - x0) * p
  const hy = y0 + (16 - y0) * p

  ctx.save()
  ctx.beginPath()
  ctx.rect(6, 8, 68, 44)
  ctx.clip()
  ctx.fillStyle = "#3b4048"
  ctx.fillRect(6, 8, 68, 44)
  if (p > 0.02) {
    const ramp = ctx.createLinearGradient(x0, y0, hx, hy)
    ramp.addColorStop(0, "#3a6df0")
    ramp.addColorStop(1, "#f5d97a")
    ctx.fillStyle = ramp
    ctx.fillRect(6, 8, 68, 44)
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.55)"
  ctx.lineWidth = 1
  ctx.strokeRect(6.5, 8.5, 67, 43)
  ctx.restore()

  if (guide > 0) {
    ctx.save()
    ctx.globalAlpha = guide
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(hx, hy)
    ctx.stroke()
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(x0 - 2, y0 - 2, 4, 4)
    drawCrosshair(ctx, hx, hy)
    ctx.restore()
  }
}

/** Only the brushed band is softened, sharpened, or pushed along the stroke. */
export function drawBlur(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  const startsSoft = kind === "sharpen"

  ctx.save()
  if (startsSoft) ctx.filter = "blur(1.8px)"
  paintDetail(ctx)
  ctx.restore()

  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.clip(trailRegion(points, 10))
    if (kind === "smudge") {
      // Smear: stamp the artwork repeatedly along the stroke direction.
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.globalAlpha = i === 0 ? 1 : 0.32
        ctx.translate(i * 2.6, 0)
        paintDetail(ctx)
        ctx.restore()
      }
    } else {
      if (!startsSoft) ctx.filter = "blur(2.4px)"
      paintDetail(ctx)
    }
    ctx.restore()
    if (t < 2.2) {
      const head = strokePointAt(progress)
      drawCursor(ctx, head.x, head.y, 10)
    }
  }
}

/** Brushing lightens (dodge), darkens (burn), or drains color (sponge). */
export function drawTonal(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  paintPhoto(ctx)
  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.clip(trailRegion(points, 10))
    if (kind === "dodge") {
      // color-dodge / color-burn shift tone while keeping the hue, like the tools do.
      ctx.globalCompositeOperation = "color-dodge"
      ctx.fillStyle = "rgb(64,64,64)"
    } else if (kind === "burn") {
      ctx.globalCompositeOperation = "color-burn"
      ctx.fillStyle = "rgb(205,205,205)"
    } else {
      ctx.globalCompositeOperation = "saturation"
      ctx.fillStyle = "rgb(128,128,128)"
    }
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    ctx.restore()
    if (t < 2.2) {
      const head = strokePointAt(progress)
      drawCursor(ctx, head.x, head.y, 10)
    }
  }
}
