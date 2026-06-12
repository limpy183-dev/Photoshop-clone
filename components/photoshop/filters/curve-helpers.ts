import {
  clamp01,
  clamp8,
} from "./pixel-helpers"

export function parseCurvePoints(value: unknown, fallback: [number, number][] = [[0, 0], [255, 255]]) {
  if (typeof value !== "string") return fallback
  const points = value
    .split(";")
    .map((pair) => {
      const [x, y] = pair.split(",").map((n) => Number(n))
      return Number.isFinite(x) && Number.isFinite(y) ? [clamp8(x), clamp8(y)] as [number, number] : null
    })
    .filter((p): p is [number, number] => !!p)
    .sort((a, b) => a[0] - b[0])
  if (!points.some((p) => p[0] === 0)) points.unshift([0, 0])
  if (!points.some((p) => p[0] === 255)) points.push([255, 255])
  return points.length >= 2 ? points : fallback
}

export function monotoneCurveLut(points: [number, number][]) {
  const pts = points
    .map(([x, y]) => [clamp8(x), clamp8(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0])
  const n = pts.length
  const d = new Array(Math.max(0, n - 1)).fill(0)
  const m = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / Math.max(1, pts[i + 1][0] - pts[i][0])
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }

  const lut = new Uint8ClampedArray(256)
  for (let x = 0; x < 256; x++) {
    let j = 0
    while (j < n - 2 && x > pts[j + 1][0]) j++
    const x0 = pts[j][0]
    const y0 = pts[j][1]
    const x1 = pts[j + 1][0]
    const y1 = pts[j + 1][1]
    const span = Math.max(1, x1 - x0)
    const t = clamp01((x - x0) / span)
    const t2 = t * t
    const t3 = t2 * t
    lut[x] = clamp8(
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * span * m[j] +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * span * m[j + 1],
    )
  }
  return lut
}

export function pseudoDither(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
