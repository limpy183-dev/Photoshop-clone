/**
 * Shared drawing vocabulary for the tool preview animations.
 *
 * Backdrop, photo stand-in, cursors, badges and the easing helpers that every
 * renderer in `preview-raster.ts`, `preview-vector.ts` and
 * `preview-viewport.ts` builds on. This module imports nothing from its
 * siblings, which is what keeps the preview graph acyclic.
 */

/** Preview canvas size in CSS pixels. Renderers assume these bounds. */
export const PREVIEW_WIDTH = 80
export const PREVIEW_HEIGHT = 60

export const TAU = Math.PI * 2

export function ease(u: number) {
  const c = clamp(u, 0, 1)
  return c < 0.5 ? 2 * c * c : 1 - ((-2 * c + 2) ** 2) / 2
}

/** Progress 0..1 through the `[start, end]` beat of a looping timeline. */
export function beat(t: number, start: number, end: number) {
  return clamp((t - start) / (end - start), 0, 1)
}

/**
 * Stand-in artwork the pixel-editing demos operate on, so a preview can show a
 * real before/after instead of an abstract shape. `mono` paints the same scene
 * desaturated — used as the "current state" in the history brush demo.
 */
export function paintPhoto(ctx: CanvasRenderingContext2D, mono = false) {
  const c = mono
    ? { skyTop: "#3d3d3d", skyBottom: "#9d9d9d", sun: "#d8d8d8", far: "#767676", near: "#4f4f4f", roof: "#8f8f8f", wall: "#c8c8c8" }
    : { skyTop: "#24548f", skyBottom: "#8fc4e8", sun: "#f5d97a", far: "#57996a", near: "#2f6b47", roof: "#e07b5a", wall: "#e8dcc8" }
  ctx.save()
  const sky = ctx.createLinearGradient(0, 0, 0, PREVIEW_HEIGHT)
  sky.addColorStop(0, c.skyTop)
  sky.addColorStop(1, c.skyBottom)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.fillStyle = c.sun
  ctx.beginPath()
  ctx.arc(58, 15, 7, 0, TAU)
  ctx.fill()
  ctx.fillStyle = c.far
  ctx.beginPath()
  ctx.moveTo(0, PREVIEW_HEIGHT)
  ctx.lineTo(0, 38)
  ctx.quadraticCurveTo(24, 22, 46, 36)
  ctx.quadraticCurveTo(64, 46, PREVIEW_WIDTH, 34)
  ctx.lineTo(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.closePath()
  ctx.fill()
  // A hard-edged, saturated detail to sample, erase, blur, and dodge.
  ctx.fillStyle = c.wall
  ctx.fillRect(14, 40, 15, 12)
  ctx.fillStyle = c.roof
  ctx.beginPath()
  ctx.moveTo(10, 40)
  ctx.lineTo(21.5, 31)
  ctx.lineTo(33, 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = c.near
  ctx.beginPath()
  ctx.moveTo(0, PREVIEW_HEIGHT)
  ctx.lineTo(0, 50)
  ctx.quadraticCurveTo(30, 45, 52, 52)
  ctx.quadraticCurveTo(68, 56, PREVIEW_WIDTH, 50)
  ctx.lineTo(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** High-frequency artwork so softening/sharpening is actually visible. */
export function paintDetail(ctx: CanvasRenderingContext2D) {
  ctx.save()
  // Overdraw the bounds so a blurred copy never fades out at the canvas edge.
  ctx.fillStyle = "#cfd6e0"
  ctx.fillRect(-10, -10, PREVIEW_WIDTH + 20, PREVIEW_HEIGHT + 20)
  ctx.strokeStyle = "#39404d"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = -PREVIEW_HEIGHT - 10; x < PREVIEW_WIDTH + 10; x += 9) {
    ctx.moveTo(x, -10)
    ctx.lineTo(x + PREVIEW_HEIGHT + 20, PREVIEW_HEIGHT + 10)
  }
  ctx.stroke()
  ctx.fillStyle = "#e07b5a"
  ctx.beginPath()
  ctx.arc(40, 30, 13, 0, TAU)
  ctx.fill()
  ctx.fillStyle = "#2b3140"
  ctx.beginPath()
  ctx.arc(40, 30, 5, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** The single demo stroke shared by every brush-driven preview. */
export function strokePointAt(u: number, curl = 0) {
  return {
    x: 10 + u * 60,
    y: 30 + Math.sin(u * Math.PI * 1.7) * 13 + Math.sin(u * Math.PI * 9) * curl,
  }
}

/** Dab centers along the demo stroke, up to `progress` (0..1). */
export function strokeTrail(progress: number, curl = 0) {
  const p = clamp(progress, 0, 1)
  const count = Math.max(1, Math.ceil(44 * p))
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= count; i++) points.push(strokePointAt((i / count) * p, curl))
  return points
}

/** Union of round dabs along a trail — clip to it to confine an effect. */
export function trailRegion(points: Array<{ x: number; y: number }>, radius: number) {
  const region = new Path2D()
  for (const p of points) {
    region.moveTo(p.x + radius, p.y)
    region.arc(p.x, p.y, radius, 0, TAU)
  }
  return region
}

/** Read the pixel actually on the canvas, so sampling demos show real colors. */
export function samplePixel(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const m = ctx.getTransform()
  const px = clamp(Math.round(x * m.a), 0, PREVIEW_WIDTH * m.a - 1)
  const py = clamp(Math.round(y * m.d), 0, PREVIEW_HEIGHT * m.d - 1)
  try {
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return "#ffffff"
  }
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 7, y)
  ctx.lineTo(x - 2, y)
  ctx.moveTo(x + 2, y)
  ctx.lineTo(x + 7, y)
  ctx.moveTo(x, y - 7)
  ctx.lineTo(x, y - 2)
  ctx.moveTo(x, y + 2)
  ctx.lineTo(x, y + 7)
  ctx.stroke()
  ctx.restore()
}

/** Photoshop's black (whole path) and white (single anchor) arrow cursors. */
export function drawArrowCursor(ctx: CanvasRenderingContext2D, x: number, y: number, solid: boolean) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x, y + 11)
  ctx.lineTo(x + 3, y + 8.4)
  ctx.lineTo(x + 5, y + 12.6)
  ctx.lineTo(x + 7.2, y + 11.6)
  ctx.lineTo(x + 5.2, y + 7.5)
  ctx.lineTo(x + 8.4, y + 7.2)
  ctx.closePath()
  ctx.fillStyle = solid ? "#111111" : "#ffffff"
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = solid ? "#ffffff" : "#111111"
  ctx.stroke()
  ctx.restore()
}

/** Expanding ring marking the instant of a click. */
export function drawRipple(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number) {
  if (progress <= 0 || progress >= 1) return
  ctx.save()
  ctx.globalAlpha = 1 - progress
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 4 + progress * 12, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

/** Small dark chip with a readout (zoom level, view angle, …). */
export function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.save()
  ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif"
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  const width = ctx.measureText(label).width + 7
  ctx.fillStyle = "rgba(0,0,0,0.62)"
  ctx.beginPath()
  ctx.roundRect(x, y, width, 11, 2)
  ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.fillText(label, x + 3.5, y + 6)
  ctx.restore()
}

/** `light` paints Photoshop's high-contrast transparency checker. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, light = false) {
  ctx.fillStyle = light ? "#ffffff" : "#2a2a2a"
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  paintCheckerTiles(ctx, light)
}

/**
 * The dark squares only. Split out so `destination-over` fills can lay the
 * tiles down first and let the base color land in the gaps behind them.
 */
export function paintCheckerTiles(ctx: CanvasRenderingContext2D, light: boolean) {
  ctx.fillStyle = light ? "#a6a6a6" : "#333333"
  const tile = light ? 6 : 8
  for (let y = 0; y < PREVIEW_HEIGHT; y += tile) {
    for (let x = 0; x < PREVIEW_WIDTH; x += tile) {
      if (((x / tile) + (y / tile)) % 2 === 0) ctx.fillRect(x, y, tile, tile)
    }
  }
}

export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size = 6) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.fillStyle = "rgba(255,255,255,0.15)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, size, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}
