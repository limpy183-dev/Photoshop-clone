import { clampByte, sampleImageData } from "@/editor/tool/helpers-shared"

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
        // Weighted by opacity for the same reason as healStamp: un-premultiplied
        // channels carry no colour where alpha is near zero.
        const weight = (original[i + 3] / 255) * (sample.a / 255)
        if (weight <= 0.002) continue
        dr += (original[i] - sample.r) * weight
        dg += (original[i + 1] - sample.g) * weight
        db += (original[i + 2] - sample.b) * weight
        borderCount += weight
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

/**
 * One pass of a box blur along rows (`horizontal`) or columns, over
 * premultiplied RGBA floats. Running-sum, so the cost is independent of the
 * kernel width; the window clamps at the line ends by replicating the edge
 * sample.
 */
function boxBlurPass(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  k: number,
  horizontal: boolean,
) {
  const outer = horizontal ? h : w
  const inner = horizontal ? w : h
  const step = (horizontal ? 1 : w) * 4
  const lineStep = (horizontal ? w : 1) * 4
  const win = k * 2 + 1
  for (let o = 0; o < outer; o++) {
    const base = o * lineStep
    let s0 = 0
    let s1 = 0
    let s2 = 0
    let s3 = 0
    for (let j = -k; j <= k; j++) {
      const i = base + Math.min(inner - 1, Math.max(0, j)) * step
      s0 += src[i]
      s1 += src[i + 1]
      s2 += src[i + 2]
      s3 += src[i + 3]
    }
    for (let p = 0; p < inner; p++) {
      const i = base + p * step
      dst[i] = s0 / win
      dst[i + 1] = s1 / win
      dst[i + 2] = s2 / win
      dst[i + 3] = s3 / win
      const add = base + Math.min(inner - 1, p + k + 1) * step
      const sub = base + Math.max(0, p - k) * step
      s0 += src[add] - src[sub]
      s1 += src[add + 1] - src[sub + 1]
      s2 += src[add + 2] - src[sub + 2]
      s3 += src[add + 3] - src[sub + 3]
    }
  }
}

/**
 * Blur dab at (x,y).
 *
 * `strength` (0–1) is the options-bar Strength: how far each dab moves a pixel
 * toward its blurred value, so the stroke builds up rather than replacing in
 * one hit. The kernel scales with the brush — a fixed 3×3 under a 100px dab is
 * invisible, which is what made the tool feel like it did nothing.
 *
 * Channels are averaged premultiplied so transparent neighbours contribute no
 * colour, and alpha is blurred too — otherwise a hard cutout keeps its hard
 * edge no matter how long you scrub it.
 */
export function blurStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  strength = 1,
) {
  const mixMax = Math.max(0, Math.min(1, strength))
  if (mixMax <= 0) return
  const r = Math.max(2, Math.floor(radius))
  // ponytail: capped kernel; repeated dabs still converge toward a wider blur,
  // so the cap only limits how fast a single dab gets there.
  const k = Math.max(1, Math.min(12, Math.round(r * 0.25)))
  // Read a patch padded by the kernel, so pixels at the dab rim average real
  // neighbours instead of a replicated patch edge.
  const x0 = Math.max(0, Math.floor(x - r) - k)
  const y0 = Math.max(0, Math.floor(y - r) - k)
  const x1 = Math.min(ctx.canvas.width, Math.ceil(x + r) + k)
  const y1 = Math.min(ctx.canvas.height, Math.ceil(y + r) + k)
  const pw = x1 - x0
  const ph = y1 - y0
  if (pw <= 0 || ph <= 0) return

  const img = ctx.getImageData(x0, y0, pw, ph)
  const data = img.data
  const count = pw * ph
  const a = new Float32Array(count * 4)
  const b = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i += 4) {
    const alpha = data[i + 3] / 255
    a[i] = data[i] * alpha
    a[i + 1] = data[i + 1] * alpha
    a[i + 2] = data[i + 2] * alpha
    a[i + 3] = data[i + 3]
  }
  boxBlurPass(a, b, pw, ph, k, true)
  boxBlurPass(b, a, pw, ph, k, false)

  const cx = x - x0
  const cy = y - y0
  // Soft rim over the outer quarter of the dab, so overlapping dabs blend into
  // a stroke instead of leaving a chain of hard-edged discs.
  const core = r * 0.75
  const fade = Math.max(1e-6, r - core)
  const pxMin = Math.max(0, Math.floor(cx - r))
  const pxMax = Math.min(pw - 1, Math.ceil(cx + r))
  const pyMin = Math.max(0, Math.floor(cy - r))
  const pyMax = Math.min(ph - 1, Math.ceil(cy + r))
  for (let py = pyMin; py <= pyMax; py++) {
    for (let px = pxMin; px <= pxMax; px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy)
      if (d > r) continue
      const mix = mixMax * (d <= core ? 1 : 1 - (d - core) / fade)
      if (mix <= 0) continue
      const i = (py * pw + px) * 4
      const outAlpha = a[i + 3]
      const unmul = outAlpha > 0.5 ? 255 / outAlpha : 0
      data[i] = clampByte(data[i] + (a[i] * unmul - data[i]) * mix)
      data[i + 1] = clampByte(data[i + 1] + (a[i + 1] * unmul - data[i + 1]) * mix)
      data[i + 2] = clampByte(data[i + 2] + (a[i + 2] * unmul - data[i + 2]) * mix)
      data[i + 3] = clampByte(data[i + 3] + (outAlpha - data[i + 3]) * mix)
    }
  }
  ctx.putImageData(img, x0, y0)
}

/** Sharpen stamp via 3x3 unsharp. Restricted to the circular brush
 *  radius so straight-edge artefacts don't show outside the brush. */
export function sharpenStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  strength = 1,
) {
  const mix = Math.max(0, Math.min(1, strength))
  if (mix <= 0) return
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
      out[i] = clampByte(src[i] + (r0 - src[i]) * mix)
      out[i + 1] = clampByte(src[i + 1] + (g0 - src[i + 1]) * mix)
      out[i + 2] = clampByte(src[i + 2] + (b0 - src[i + 2]) * mix)
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
/** Weight of a tonal range at luminance `l` (0–1). Peaks where the range lives. */
export function toneRangeWeight(l: number, range: "shadows" | "midtones" | "highlights") {
  if (range === "shadows") return Math.max(0, 1 - l * 1.6)
  if (range === "highlights") return Math.max(0, (l - 0.375) * 1.6)
  return Math.max(0, 1 - Math.abs(l - 0.5) * 2)
}

export interface DodgeBurnOptions {
  /** Which tones the brush acts on. Photoshop defaults to midtones. */
  range?: "shadows" | "midtones" | "highlights"
  /** Keep hue and saturation by scaling luminance instead of each channel. */
  protectTones?: boolean
  /** Brush hardness, 0–100. Below 100 the dab fades out toward its rim. */
  hardness?: number
}

/**
 * Dodge / burn dab.
 *
 * `strength` is the peak effect at the dab centre for pixels squarely inside
 * the selected tonal range; the radial falloff and the range weight both scale
 * it down. Restricting the effect by tone is what stops dodge from driving
 * everything to flat white — pushing every channel toward 255 regardless of the
 * pixel's starting luminance blows out highlights after one or two dabs.
 */
export function dodgeBurnStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  mode: "dodge" | "burn",
  strength: number,
  options?: DodgeBurnOptions,
) {
  const r = Math.max(2, Math.floor(radius))
  const sx = Math.max(0, Math.floor(x - r))
  const sy = Math.max(0, Math.floor(y - r))
  const sw = Math.min(ctx.canvas.width - sx, r * 2)
  const sh = Math.min(ctx.canvas.height - sy, r * 2)
  if (sw <= 0 || sh <= 0) return
  const range = options?.range ?? "midtones"
  const protectTones = options?.protectTones ?? true
  const hard = Math.max(0, Math.min(1, (options?.hardness ?? 100) / 100))
  const cx = x - sx
  const cy = y - sy
  const img = ctx.getImageData(sx, sy, sw, sh)
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const dx = px - cx
      const dy = py - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) continue
      const i = (py * sw + px) * 4
      if (img.data[i + 3] === 0) continue
      const red = img.data[i]
      const green = img.data[i + 1]
      const blue = img.data[i + 2]
      const luma = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
      // Same falloff shape as the clone/heal dabs: flat out to the hard core,
      // then a linear fade to the rim. The old bare `1 - d/r` cone peaked at a
      // single pixel and fell away immediately, so a stroke read as a chain of
      // dark-centred spots rather than an even sweep.
      const falloff =
        hard >= 1 || d <= r * hard
          ? 1
          : Math.max(0, 1 - (d - r * hard) / Math.max(1, r * (1 - hard)))
      const w = falloff * strength * toneRangeWeight(luma, range)
      if (w <= 0) continue
      // Scaling the channels by a luminance ratio preserves hue and saturation,
      // but it multiplies through zero: on a black pixel the ratio can never
      // lift anything, so dodging shadows did nothing and near-blacks collapsed
      // to flat black. There is no hue to protect down there, so fall through
      // to the additive form.
      if (protectTones && luma > 0.004) {
        // Move luminance, then rescale the pixel to hit it — hue and
        // saturation ride along unchanged.
        const targetLuma = mode === "dodge" ? luma + (1 - luma) * w : luma - luma * w
        const factor = targetLuma / luma
        img.data[i] = clampByte(red * factor)
        img.data[i + 1] = clampByte(green * factor)
        img.data[i + 2] = clampByte(blue * factor)
      } else if (mode === "dodge") {
        img.data[i] = clampByte(red + (255 - red) * w)
        img.data[i + 1] = clampByte(green + (255 - green) * w)
        img.data[i + 2] = clampByte(blue + (255 - blue) * w)
      } else {
        img.data[i] = clampByte(red - red * w)
        img.data[i + 1] = clampByte(green - green * w)
        img.data[i + 2] = clampByte(blue - blue * w)
      }
    }
  }
  ctx.putImageData(img, sx, sy)
}

/** Sponge brush stamp: desaturates opaque pixels inside the brush footprint. */
export function spongeStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  strength: number,
  mode: "desaturate" | "saturate" = "desaturate",
) {
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
      // Desaturate pulls channels toward luminance; saturate pushes them away
      // along the same axis, so the two modes are one sign flip apart.
      const amount = mode === "saturate" ? -strength : strength
      data[i] = clampByte(rr + (lum - rr) * amount)
      data[i + 1] = clampByte(gg + (lum - gg) * amount)
      data[i + 2] = clampByte(bb + (lum - bb) * amount)
    }
  }
  ctx.putImageData(img, sx, sy)
}

/** Healing brush: clone with luminance correction towards target area. */
/**
 * Choose where the spot-healing brush should take its donor patch from.
 *
 * Tries the four cardinal neighbours a patch-width away and keeps the one whose
 * mean colour is closest to the ring *around* the blemish — that ring is what
 * the repair has to blend into, while the blemish itself is what we want to
 * avoid re-sampling. Candidates are clamped inside the canvas, so healing near
 * an edge still finds real pixels instead of transparent margin.
 */
export function pickHealSource(
  srcCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number } {
  const ctx = srcCanvas.getContext("2d")
  const r = Math.max(2, Math.floor(radius))
  const fallback = { x: Math.min(srcCanvas.width - r, x + r * 2), y }
  if (!ctx) return fallback

  const clampX = (v: number) => Math.max(r, Math.min(srcCanvas.width - r, v))
  const clampY = (v: number) => Math.max(r, Math.min(srcCanvas.height - r, v))
  const meanAt = (cx: number, cy: number) => {
    const sx = Math.max(0, Math.min(srcCanvas.width - 1, Math.floor(cx - r)))
    const sy = Math.max(0, Math.min(srcCanvas.height - 1, Math.floor(cy - r)))
    const sw = Math.max(1, Math.min(srcCanvas.width - sx, r * 2))
    const sh = Math.max(1, Math.min(srcCanvas.height - sy, r * 2))
    const data = ctx.getImageData(sx, sy, sw, sh).data
    let sr = 0
    let sg = 0
    let sb = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      sr += data[i]
      sg += data[i + 1]
      sb += data[i + 2]
      n++
    }
    return n ? { r: sr / n, g: sg / n, b: sb / n, n } : null
  }

  // Reference = the annulus just outside the dab, approximated by the mean of a
  // patch one radius further out in each direction.
  const ring = [
    meanAt(clampX(x + r * 3), clampY(y)),
    meanAt(clampX(x - r * 3), clampY(y)),
    meanAt(clampX(x), clampY(y + r * 3)),
    meanAt(clampX(x), clampY(y - r * 3)),
  ].filter((m): m is NonNullable<typeof m> => m !== null)
  if (!ring.length) return fallback
  const target = {
    r: ring.reduce((s, m) => s + m.r, 0) / ring.length,
    g: ring.reduce((s, m) => s + m.g, 0) / ring.length,
    b: ring.reduce((s, m) => s + m.b, 0) / ring.length,
  }

  const candidates = [
    { x: clampX(x + r * 2), y: clampY(y) },
    { x: clampX(x - r * 2), y: clampY(y) },
    { x: clampX(x), y: clampY(y + r * 2) },
    { x: clampX(x), y: clampY(y - r * 2) },
  ]
  let best = fallback
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const mean = meanAt(candidate.x, candidate.y)
    if (!mean) continue
    const score =
      Math.abs(mean.r - target.r) + Math.abs(mean.g - target.g) + Math.abs(mean.b - target.b)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

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
  // Average colour difference around the patch border (texture vs target),
  // weighted by how opaque both sides are there.
  //
  // Canvas stores RGBA un-premultiplied, so a transparent pixel's colour
  // channels are arbitrary and a barely-opaque one's are quantised down to a
  // couple of usable bits. Letting those vote equally is what made healing over
  // low-opacity colour swing the whole patch to a wild tint.
  let dr = 0
  let dg = 0
  let db = 0
  let n = 0
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      if (px === 0 || py === 0 || px === sw - 1 || py === sh - 1) {
        const i = (py * sw + px) * 4
        const weight = (dest.data[i + 3] / 255) * (src.data[i + 3] / 255)
        if (weight <= 0.002) continue
        dr += (dest.data[i] - src.data[i]) * weight
        dg += (dest.data[i + 1] - src.data[i + 1]) * weight
        db += (dest.data[i + 2] - src.data[i + 2]) * weight
        n += weight
      }
    }
  }
  if (n > 0) {
    dr /= n
    dg /= n
    db /= n
  }
  // The dab centre sits at (r, r) only when the patch was not clipped by a
  // canvas edge; near one, dxi/dyi stop short and the centre shifts. Measuring
  // it from the real patch origin keeps the falloff under the cursor instead of
  // sliding off it along the top and left edges.
  const cx = dx - dxi
  const cy = dy - dyi
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const ddx = px - cx
      const ddy = py - cy
      const d = Math.sqrt(ddx * ddx + ddy * ddy)
      if (d > r) continue
      const t = 1 - d / r
      const i = (py * sw + px) * 4
      // Blend premultiplied, and carry alpha across too. Mixing raw channels
      // let a nearly transparent destination pixel's meaningless colour fight
      // the donor at full strength, which is what made the spot-healing brush
      // flash and smear over low-opacity paint; it also left alpha untouched,
      // so healing never actually filled a hole.
      const destAlpha = dest.data[i + 3] / 255
      const srcAlpha = src.data[i + 3] / 255
      const outAlpha = destAlpha + (srcAlpha - destAlpha) * t
      if (outAlpha <= 0) {
        dest.data[i + 3] = 0
        continue
      }
      for (let channel = 0; channel < 3; channel++) {
        const destValue = dest.data[i + channel] * destAlpha
        const srcValue = (src.data[i + channel] + (channel === 0 ? dr : channel === 1 ? dg : db)) * srcAlpha
        dest.data[i + channel] = clampByte((destValue + (srcValue - destValue) * t) / outAlpha)
      }
      dest.data[i + 3] = clampByte(outAlpha * 255)
    }
  }
  destCtx.putImageData(dest, dxi, dyi)
}
