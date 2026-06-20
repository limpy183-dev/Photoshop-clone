import { makeCanvas } from "../canvas-utils"

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
      const _sIdx = (syp * w + sxp) * 4
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
