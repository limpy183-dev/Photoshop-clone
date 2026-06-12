export interface EraserColorSample {
  r: number
  g: number
  b: number
  a?: number
}

export function colorDistance(a: EraserColorSample, b: EraserColorSample) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  const da = (a.a ?? 255) - (b.a ?? 255)
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da * 0.25)
}

export function connectedEraserMask(mask: Uint8Array, w: number, h: number, sx: number, sy: number) {
  const out = new Uint8Array(w * h)
  const start = sy * w + sx
  if (!mask[start]) return out
  const stack = [start]
  while (stack.length) {
    const p = stack.pop()!
    if (out[p] || !mask[p]) continue
    out[p] = 1
    const x = p % w
    const y = (p - x) / w
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  return out
}

export function localPatchGradient(img: ImageData, x: number, y: number, w: number, h: number) {
  const lum = (px: number, py: number) => {
    const cx = Math.max(0, Math.min(w - 1, px))
    const cy = Math.max(0, Math.min(h - 1, py))
    const i = (cy * w + cx) * 4
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
  }
  return Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1))
}
