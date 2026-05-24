export interface MaskPoint {
  x: number
  y: number
}

export interface MaskContourPath {
  points: MaskPoint[]
  closed: boolean
}

export interface MaskContourOptions {
  threshold?: number
  simplifyTolerance?: number
  minPoints?: number
}

const DEFAULT_THRESHOLD = 8
const DIST_INF = 1e12

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function alphaToBinary(data: Uint8ClampedArray, threshold = DEFAULT_THRESHOLD) {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] > threshold ? 1 : 0
  return out
}

function binaryToAlpha(data: Uint8Array) {
  return Uint8ClampedArray.from(data, (value) => (value ? 255 : 0))
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
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / Math.max(1, 2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / Math.max(1, 2 * q - 2 * v[k])
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

export function maskDataBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = DEFAULT_THRESHOLD,
) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] <= threshold) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function expandMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold = DEFAULT_THRESHOLD,
) {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return new Uint8ClampedArray(data)
  const selected = alphaToBinary(data, threshold)
  const dist = distanceToFeature(selected, width, height)
  const rr = r * r
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = dist[i] <= rr ? 1 : 0
  return binaryToAlpha(out)
}

export function contractMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold = DEFAULT_THRESHOLD,
) {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return new Uint8ClampedArray(data)
  const selected = alphaToBinary(data, threshold)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < selected.length; i++) outside[i] = selected[i] ? 0 : 1
  const dist = distanceToFeature(outside, width, height)
  const rr = r * r
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = selected[i] && dist[i] > rr ? 1 : 0
  return binaryToAlpha(out)
}

export function borderMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold = DEFAULT_THRESHOLD,
) {
  const r = Math.max(1, Math.round(radius))
  const selected = alphaToBinary(data, threshold)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < selected.length; i++) outside[i] = selected[i] ? 0 : 1
  const distOutside = distanceToFeature(outside, width, height)
  const rr = r * r
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = selected[i] && distOutside[i] <= rr ? 1 : 0
  return binaryToAlpha(out)
}

export function featherMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold = DEFAULT_THRESHOLD,
) {
  const r = Math.max(0, radius)
  if (r <= 0) return new Uint8ClampedArray(data)
  const selected = alphaToBinary(data, threshold)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < selected.length; i++) outside[i] = selected[i] ? 0 : 1

  const distToSelected = distanceToFeature(selected, width, height)
  const distToOutside = distanceToFeature(outside, width, height)
  const out = new Uint8ClampedArray(width * height)
  const span = Math.max(0.0001, r * 2)

  for (let i = 0; i < out.length; i++) {
    const signed = selected[i]
      ? Math.max(0, Math.sqrt(distToOutside[i]) - 0.5)
      : -Math.max(0, Math.sqrt(distToSelected[i]) - 0.5)
    const t = clamp((signed + r) / span, 0, 1)
    const eased = t * t * (3 - 2 * t)
    out[i] = Math.round(eased * 255)
  }
  return out
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) {
      if (x >= 0 && x < width) sum += data[y * width + x]
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / (r * 2 + 1)
      const remove = x - r
      const add = x + r + 1
      if (remove >= 0 && remove < width) sum -= data[y * width + remove]
      if (add >= 0 && add < width) sum += data[y * width + add]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) {
      if (y >= 0 && y < height) sum += tmp[y * width + x]
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / (r * 2 + 1)
      const remove = y - r
      const add = y + r + 1
      if (remove >= 0 && remove < height) sum -= tmp[remove * width + x]
      if (add >= 0 && add < height) sum += tmp[add * width + x]
    }
  }

  return out
}

export function smoothMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold = DEFAULT_THRESHOLD,
) {
  const r = Math.max(1, Math.round(radius))
  let current = Uint8ClampedArray.from(alphaToBinary(data, threshold), (value) => (value ? 255 : 0))
  const passes = r > 6 ? 3 : r > 1 ? 2 : 1
  const blurRadius = Math.max(1, Math.ceil(r / passes))
  for (let pass = 0; pass < passes; pass++) {
    const blurred = boxBlur(current, width, height, blurRadius)
    const next = new Uint8ClampedArray(width * height)
    for (let i = 0; i < next.length; i++) next[i] = blurred[i] > 128 ? 255 : 0
    current = next
  }
  return current
}

function samePoint(a: MaskPoint, b: MaskPoint) {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}

function pointLineDistanceSq(point: MaskPoint, a: MaskPoint, b: MaskPoint) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1)
  const x = a.x + dx * t
  const y = a.y + dy * t
  return (point.x - x) ** 2 + (point.y - y) ** 2
}

function simplifyRange(points: MaskPoint[], toleranceSq: number, start: number, end: number, keep: Uint8Array) {
  let best = -1
  let bestDistance = 0
  for (let i = start + 1; i < end; i++) {
    const distance = pointLineDistanceSq(points[i], points[start], points[end])
    if (distance > bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  if (best >= 0 && bestDistance > toleranceSq) {
    keep[best] = 1
    simplifyRange(points, toleranceSq, start, best, keep)
    simplifyRange(points, toleranceSq, best, end, keep)
  }
}

export function simplifyMaskPath(points: MaskPoint[], tolerance: number) {
  if (points.length <= 2 || tolerance <= 0) return points.map((point) => ({ ...point }))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  simplifyRange(points, tolerance * tolerance, 0, points.length - 1, keep)
  return points.filter((_, index) => keep[index]).map((point) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }))
}

function pathArea(points: MaskPoint[]) {
  let area = 0
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y
  }
  return area / 2
}

export function extractMaskContourPaths(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: MaskContourOptions = {},
): MaskContourPath[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const selected = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] > threshold

  const segments: Array<{ start: MaskPoint; end: MaskPoint; used: boolean }> = []
  const add = (start: MaskPoint, end: MaskPoint) => segments.push({ start, end, used: false })

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!selected(x, y)) continue
      if (!selected(x, y - 1)) add({ x, y }, { x: x + 1, y })
      if (!selected(x + 1, y)) add({ x: x + 1, y }, { x: x + 1, y: y + 1 })
      if (!selected(x, y + 1)) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 })
      if (!selected(x - 1, y)) add({ x, y: y + 1 }, { x, y })
    }
  }

  const starts = new Map<string, number[]>()
  const key = (point: MaskPoint) => `${point.x},${point.y}`
  segments.forEach((segment, index) => {
    const k = key(segment.start)
    const list = starts.get(k)
    if (list) list.push(index)
    else starts.set(k, [index])
  })

  const takeFrom = (point: MaskPoint) => {
    const list = starts.get(key(point))
    while (list?.length) {
      const index = list.shift()!
      if (!segments[index].used) return index
    }
    return -1
  }

  const paths: MaskContourPath[] = []
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i]
    if (first.used) continue
    first.used = true
    const points = [{ ...first.start }, { ...first.end }]
    const start = first.start
    let current = first.end
    let guard = 0

    while (!samePoint(current, start) && guard++ < segments.length + 1) {
      const nextIndex = takeFrom(current)
      if (nextIndex < 0) break
      const next = segments[nextIndex]
      next.used = true
      current = next.end
      points.push({ ...current })
    }

    const closed = samePoint(points[0], points[points.length - 1])
    if (points.length >= (options.minPoints ?? 4)) {
      const simplified = simplifyMaskPath(points, options.simplifyTolerance ?? 0)
      if (closed && !samePoint(simplified[0], simplified[simplified.length - 1])) simplified.push({ ...simplified[0] })
      paths.push({ points: simplified, closed })
    }
  }

  return paths.sort((a, b) => Math.abs(pathArea(b.points)) - Math.abs(pathArea(a.points)))
}

export function selectionMaskToPathCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: MaskContourOptions = {},
) {
  return extractMaskContourPaths(data, width, height, {
    simplifyTolerance: options.simplifyTolerance ?? 1.25,
    threshold: options.threshold,
    minPoints: options.minPoints ?? 4,
  })
}
