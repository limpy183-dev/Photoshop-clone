/* ---------------------------------------------------------------- */
/*  SHARED GEOMETRY / PIXEL UTILS                                     */
/* ---------------------------------------------------------------- */

export const MASK_THRESHOLD = 8
export const DIST_INF = 1e12

export type Rect = { x: number; y: number; w: number; h: number }

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function imageIndex(x: number, y: number, width: number) {
  return (y * width + x) * 4
}

export function sampleImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const sx0 = Math.max(0, Math.min(width - 1, x0))
  const sy0 = Math.max(0, Math.min(height - 1, y0))
  const sx1 = Math.max(0, Math.min(width - 1, x0 + 1))
  const sy1 = Math.max(0, Math.min(height - 1, y0 + 1))
  const i00 = imageIndex(sx0, sy0, width)
  const i10 = imageIndex(sx1, sy0, width)
  const i01 = imageIndex(sx0, sy1, width)
  const i11 = imageIndex(sx1, sy1, width)
  const mix = (c: number) =>
    data[i00 + c] * (1 - tx) * (1 - ty) +
    data[i10 + c] * tx * (1 - ty) +
    data[i01 + c] * (1 - tx) * ty +
    data[i11 + c] * tx * ty
  return { r: mix(0), g: mix(1), b: mix(2), a: mix(3) }
}

function distanceTransform1d(f: Float64Array, n: number) {
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s =
      ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) /
      Math.max(1, 2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s =
        ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) /
        Math.max(1, 2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    d[q] = dx * dx + f[v[k]]
  }
  return d
}

export function distanceToFeature(feature: Uint8Array, width: number, height: number) {
  let any = false
  for (let i = 0; i < feature.length; i++) {
    if (feature[i]) {
      any = true
      break
    }
  }
  const out = new Float64Array(width * height)
  if (!any) {
    out.fill(DIST_INF)
    return out
  }

  const tmp = new Float64Array(width * height)
  const f = new Float64Array(Math.max(width, height))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = feature[y * width + x] ? 0 : DIST_INF
    const row = distanceTransform1d(f.subarray(0, width), width)
    for (let x = 0; x < width; x++) tmp[y * width + x] = row[x]
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = tmp[y * width + x]
    const col = distanceTransform1d(f.subarray(0, height), height)
    for (let y = 0; y < height; y++) out[y * width + x] = col[y]
  }
  return out
}

/* ---------------------------------------------------------------- */
/*  SNAP HELPERS                                                      */
/* ---------------------------------------------------------------- */

export function snapValue(
  v: number,
  candidates: number[],
  threshold = 6,
): number {
  for (const c of candidates) {
    if (Math.abs(v - c) <= threshold) return c
  }
  return v
}
