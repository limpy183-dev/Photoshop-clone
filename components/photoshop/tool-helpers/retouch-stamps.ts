import { clampByte, sampleImageData } from "../tool-helpers-shared"

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
