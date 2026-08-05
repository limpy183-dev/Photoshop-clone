/**
 * Preview renderers for the tools that move the view or the pixels wholesale —
 * hand, rotate view, zoom, free transform, quick mask and move.
 *
 * Renderers are deterministic pure functions of elapsed time drawing into an
 * already DPR-scaled 80x60 context. Shared drawing vocabulary lives in
 * `preview-primitives.ts`; the kind -> renderer switch lives in
 * `preview-painters.ts`.
 */

import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  TAU,
  ease,
  beat,
  paintPhoto,
  drawRipple,
  drawBadge,
  clamp,
} from "@/editor/tool/preview-primitives"

const VIEWPORT = { x: 7, y: 7, w: 66, h: 46 }

/** Run `paint` clipped to the document window, over a dark app background. */
function withViewport(ctx: CanvasRenderingContext2D, paint: () => void) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h)
  ctx.clip()
  ctx.fillStyle = "#1d1f22"
  ctx.fillRect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h)
  paint()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.75)"
  ctx.lineWidth = 1
  ctx.strokeRect(VIEWPORT.x + 0.5, VIEWPORT.y + 0.5, VIEWPORT.w - 1, VIEWPORT.h - 1)
  ctx.restore()
}

function drawHandCursor(ctx: CanvasRenderingContext2D, x: number, y: number, grabbing: boolean) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = "#ffffff"
  ctx.strokeStyle = "#111111"
  ctx.lineWidth = 1
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.roundRect(-4 + i * 3.4, grabbing ? -5 : -9, 3, grabbing ? 6 : 10, 1.5)
    ctx.fill()
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.roundRect(-8, -1, 4.5, 6, 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(-5, -2, 11, 10, 3)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Grab the image and push it around inside a window that stays put. */
export function drawHand(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.8
  const pan = ease(beat(t, 0.5, 1.7)) - ease(beat(t, 2.6, 3.7))
  const dx = pan * 17
  const dy = pan * -10
  withViewport(ctx, () => {
    ctx.translate(dx, dy)
    ctx.translate(40, 30)
    ctx.scale(1.5, 1.5)
    ctx.translate(-40, -30)
    paintPhoto(ctx)
  })
  drawHandCursor(ctx, 36 + dx, 32 + dy, t > 0.4 && t < 3.7)
}

/** The window stays square while the document itself is spun under it. */
export function drawRotateView(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 4.4
  const angle = (ease(beat(t, 0.4, 1.9)) - ease(beat(t, 3.0, 4.3))) * -0.52
  withViewport(ctx, () => {
    ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
    ctx.rotate(angle)
    ctx.scale(0.74, 0.74)
    ctx.translate(-PREVIEW_WIDTH / 2, -PREVIEW_HEIGHT / 2)
    paintPhoto(ctx)
    ctx.strokeStyle = "rgba(255,255,255,0.9)"
    ctx.lineWidth = 1.6
    ctx.strokeRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  })

  // Compass: north tips with the view, so the rotation reads as a view change.
  ctx.save()
  ctx.translate(62, 42)
  ctx.fillStyle = "rgba(0,0,0,0.55)"
  ctx.beginPath()
  ctx.arc(0, 0, 8.5, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, -6.5)
  ctx.lineTo(3, 1)
  ctx.lineTo(-3, 1)
  ctx.closePath()
  ctx.fillStyle = "#ff6b5b"
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, 6.5)
  ctx.lineTo(3, 1)
  ctx.lineTo(-3, 1)
  ctx.closePath()
  ctx.fillStyle = "#e8e8e8"
  ctx.fill()
  ctx.restore()

  drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round((angle * 180) / Math.PI)}°`)
}

/** Click to magnify around the pointer; pixels grow, the window does not. */
export function drawZoom(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 4.4
  const scale = 1 + (ease(beat(t, 0.6, 2.0)) - ease(beat(t, 3.1, 4.3))) * 1.5
  const focus = { x: 22, y: 38 }
  withViewport(ctx, () => {
    ctx.translate(focus.x, focus.y)
    ctx.scale(scale, scale)
    ctx.translate(-focus.x, -focus.y)
    paintPhoto(ctx)
  })
  drawRipple(ctx, focus.x, focus.y, beat(t, 0.5, 1.0))

  // Magnifier cursor with the zoom-in plus.
  ctx.save()
  ctx.translate(focus.x, focus.y)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = "#111111"
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, TAU)
  ctx.moveTo(5, 5)
  ctx.lineTo(11, 11)
  ctx.stroke()
  ctx.lineWidth = 1.4
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, TAU)
  ctx.moveTo(5, 5)
  ctx.lineTo(11, 11)
  ctx.moveTo(-3.2, 0)
  ctx.lineTo(3.2, 0)
  ctx.moveTo(0, -3.2)
  ctx.lineTo(0, 3.2)
  ctx.stroke()
  ctx.restore()

  drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round(scale * 100)}%`)
}

export function drawTransform(ctx: CanvasRenderingContext2D, t: number) {
  const skew = Math.sin(t * Math.PI) * 0.15
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.transform(1, skew, skew, 1, 0, 0)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(-20, -14, 40, 28)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(-20, -14, 40, 28)
  ctx.fillStyle = "#ffffff"
  for (const [x, y] of [[-20, -14], [20, -14], [-20, 14], [20, 14]] as Array<[number, number]>) {
    ctx.fillRect(x - 2, y - 2, 4, 4)
  }
  ctx.restore()
}

export function drawQuickMask(ctx: CanvasRenderingContext2D, t: number) {
  // Subject silhouette behind a translucent red mask sweep.
  ctx.save()
  ctx.fillStyle = "#888888"
  ctx.beginPath()
  ctx.ellipse(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2 + 4, 22, 18, 0, 0, Math.PI * 2)
  ctx.fill()
  const sweep = clamp(t / 1.6, 0, 1)
  ctx.fillStyle = "rgba(255,0,0,0.4)"
  ctx.fillRect(0, 0, PREVIEW_WIDTH * sweep, PREVIEW_HEIGHT)
  ctx.restore()
}

export function drawMove(ctx: CanvasRenderingContext2D, t: number) {
  const dx = Math.sin(t * Math.PI) * 12
  ctx.save()
  ctx.fillStyle = "rgba(123,209,255,0.6)"
  ctx.fillRect(14, 22, 36, 22)
  ctx.fillStyle = "#7bd1ff"
  ctx.fillRect(14 + dx, 18, 36, 22)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(14 + dx, 18, 36, 22)
  ctx.restore()
  // Direction arrow
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.moveTo(14 + dx, 50)
  ctx.lineTo(14 + dx + 18, 50)
  ctx.lineTo(14 + dx + 14, 46)
  ctx.moveTo(14 + dx + 18, 50)
  ctx.lineTo(14 + dx + 14, 54)
  ctx.stroke()
}
