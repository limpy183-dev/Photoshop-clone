import {
  applyTransformContext,
  transformCorners,
  type TransformDragState,
  type TransformInterpolation,
} from "./canvas-transform-geometry"

export function drawTransformSourcePreview(
  ctx: CanvasRenderingContext2D,
  t: TransformDragState,
) {
  if (!t.source) return
  if (!hasPerspectiveTransform(t)) {
    applyTransformContext(ctx, t)
    ctx.drawImage(t.source, 0, 0)
    return
  }
  drawPerspectiveWarp(ctx, t.source, t.bounds, transformCorners(t), t.interpolation ?? "bicubic")
}

function hasPerspectiveTransform(t: TransformDragState) {
  const p = t.perspective
  if (!p) return false
  return [p.tl, p.tr, p.br, p.bl].some((point) => Math.abs(point.x) > 0.01 || Math.abs(point.y) > 0.01)
}

function drawPerspectiveWarp(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  srcRect: { x: number; y: number; w: number; h: number },
  quad: { x: number; y: number }[],
  interpolation: TransformInterpolation,
) {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxX = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)))
  const maxY = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)))
  if (maxX <= minX || maxY <= minY || srcRect.w <= 0 || srcRect.h <= 0) return
  const sctx = source.getContext("2d")
  if (!sctx) return
  const src = sctx.getImageData(0, 0, source.width, source.height)
  const out = ctx.getImageData(minX, minY, maxX - minX, maxY - minY)
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const uv = inverseBilinear({ x: x + 0.5, y: y + 0.5 }, quad)
      if (!uv || uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) continue
      const sx = srcRect.x + uv.u * srcRect.w
      const sy = srcRect.y + uv.v * srcRect.h
      const sample = sampleCanvasImage(src, sx, sy, interpolation !== "nearest")
      const i = ((y - minY) * out.width + (x - minX)) * 4
      const a = sample.a / 255
      if (a <= 0) continue
      out.data[i] = sample.r
      out.data[i + 1] = sample.g
      out.data[i + 2] = sample.b
      out.data[i + 3] = sample.a
    }
  }
  ctx.putImageData(out, minX, minY)
}

function inverseBilinear(point: { x: number; y: number }, quad: { x: number; y: number }[]) {
  let u = 0.5
  let v = 0.5
  for (let i = 0; i < 8; i++) {
    const p = bilinearPoint(quad, u, v)
    const du = {
      x: (1 - v) * (quad[1].x - quad[0].x) + v * (quad[2].x - quad[3].x),
      y: (1 - v) * (quad[1].y - quad[0].y) + v * (quad[2].y - quad[3].y),
    }
    const dv = {
      x: (1 - u) * (quad[3].x - quad[0].x) + u * (quad[2].x - quad[1].x),
      y: (1 - u) * (quad[3].y - quad[0].y) + u * (quad[2].y - quad[1].y),
    }
    const ex = p.x - point.x
    const ey = p.y - point.y
    const det = du.x * dv.y - du.y * dv.x
    if (Math.abs(det) < 1e-6) break
    u -= (ex * dv.y - ey * dv.x) / det
    v -= (du.x * ey - du.y * ex) / det
  }
  return { u, v }
}

function bilinearPoint(quad: { x: number; y: number }[], u: number, v: number) {
  const a = (1 - u) * (1 - v)
  const b = u * (1 - v)
  const c = u * v
  const d = (1 - u) * v
  return {
    x: quad[0].x * a + quad[1].x * b + quad[2].x * c + quad[3].x * d,
    y: quad[0].y * a + quad[1].y * b + quad[2].y * c + quad[3].y * d,
  }
}

function sampleCanvasImage(img: ImageData, x: number, y: number, smooth: boolean) {
  if (!smooth) {
    const sx = Math.max(0, Math.min(img.width - 1, Math.round(x)))
    const sy = Math.max(0, Math.min(img.height - 1, Math.round(y)))
    const i = (sy * img.width + sx) * 4
    return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: img.data[i + 3] }
  }
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(img.width - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(img.height - 1, y0 + 1))
  const tx = x - x0
  const ty = y - y0
  const at = (px: number, py: number, c: number) => img.data[(py * img.width + px) * 4 + c]
  const mix = (c: number) =>
    at(x0, y0, c) * (1 - tx) * (1 - ty) +
    at(x1, y0, c) * tx * (1 - ty) +
    at(x0, y1, c) * (1 - tx) * ty +
    at(x1, y1, c) * tx * ty
  return { r: mix(0), g: mix(1), b: mix(2), a: mix(3) }
}
