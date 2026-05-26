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

export interface MagneticLassoTraceOptions {
  searchWidth?: number
  contrastThreshold?: number
  hysteresisRatio?: number
  /** 0..1 post-trace fitting that reduces cursor/edge jitter while preserving endpoints. */
  smoothing?: number
}

export interface MagneticLassoTraceResult {
  points: MaskPoint[]
  diagnostics: {
    strongEdgePixels: number
    weakLinkedPixels: number
    thinnedEdgePixels: number
    fallbackSegments: number
    totalPoints: number
  }
}

export interface TransformMaskOptions {
  scale?: number
  rotationDeg?: number
  previewZoom?: number
  smoothing?: boolean
}

export interface SelectionImageSource {
  width: number
  height: number
  data: ArrayLike<number>
  channels?: number
  maxValue?: number
}

export interface OfflineObjectAwareSelectionOptions {
  kind: "object" | "subject" | "sky" | "background"
  objectBounds?: { x: number; y: number; w: number; h: number }
  tolerance?: number
}

export interface OfflineObjectAwareSelectionResult {
  maskData: Uint8ClampedArray
  width: number
  height: number
  bounds: { x: number; y: number; w: number; h: number } | null
  score: number
  diagnostics: {
    method: "offline-object-aware"
    nativeAiParity: false
    sourcePrecision: "uint8" | "uint16" | "float32" | "numeric"
    candidatePixels: number
    keptPixels: number
    rejectedPixels: number
  }
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

function sourceChannels(source: SelectionImageSource) {
  return Math.max(1, Math.round(source.channels ?? 4))
}

function sourceMaxValue(source: SelectionImageSource) {
  if (source.maxValue && Number.isFinite(source.maxValue) && source.maxValue > 0) return source.maxValue
  if (source.data instanceof Uint16Array) return 65535
  if (source.data instanceof Float32Array || source.data instanceof Float64Array) return 1
  return 255
}

function sourcePrecision(source: SelectionImageSource): OfflineObjectAwareSelectionResult["diagnostics"]["sourcePrecision"] {
  if (source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray) return "uint8"
  if (source.data instanceof Uint16Array) return "uint16"
  if (source.data instanceof Float32Array || source.data instanceof Float64Array) return "float32"
  return "numeric"
}

function sourceChannel255(source: SelectionImageSource, pixel: number, channel: number) {
  const channels = sourceChannels(source)
  const max = sourceMaxValue(source)
  const fallback = channel === 3 ? max : 0
  const raw = Number(source.data[pixel * channels + channel] ?? fallback)
  if (max <= 1.000001) return clamp(raw, 0, 1) * 255
  return clamp((raw / max) * 255, 0, 255)
}

function sourcePixel(source: SelectionImageSource, x: number, y: number) {
  const sx = clamp(Math.round(x), 0, source.width - 1)
  const sy = clamp(Math.round(y), 0, source.height - 1)
  const pixel = sy * source.width + sx
  return {
    r: sourceChannel255(source, pixel, 0),
    g: sourceChannel255(source, pixel, 1),
    b: sourceChannel255(source, pixel, 2),
    a: sourceChannel255(source, pixel, 3),
  }
}

function imageLuma(source: SelectionImageSource, pixel: number) {
  return (
    0.299 * sourceChannel255(source, pixel, 0) +
    0.587 * sourceChannel255(source, pixel, 1) +
    0.114 * sourceChannel255(source, pixel, 2)
  )
}

function buildHysteresisEdgeMap(
  image: SelectionImageSource,
  highThreshold: number,
  hysteresisRatio: number,
) {
  const width = image.width
  const height = image.height
  const gradients = new Float32Array(width * height)
  const directions = new Float32Array(width * height)
  const thinned = new Float32Array(width * height)
  const strong = new Uint8Array(width * height)
  const linked = new Uint8Array(width * height)
  const queue: number[] = []
  const high = Math.max(0.000001, highThreshold)
  const low = high * clamp(hysteresisRatio, 0.05, 0.95)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      const tl = imageLuma(image, p - width - 1)
      const t = imageLuma(image, p - width)
      const tr = imageLuma(image, p - width + 1)
      const l = imageLuma(image, p - 1)
      const r = imageLuma(image, p + 1)
      const bl = imageLuma(image, p + width - 1)
      const b = imageLuma(image, p + width)
      const br = imageLuma(image, p + width + 1)

      const gx = -3 * tl + 3 * tr - 10 * l + 10 * r - 3 * bl + 3 * br
      const gy = -3 * tl - 10 * t - 3 * tr + 3 * bl + 10 * b + 3 * br
      const gradient = Math.hypot(gx, gy) / 16
      gradients[p] = gradient
      directions[p] = Math.atan2(gy, gx)
    }
  }

  let thinnedEdgePixels = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      const gradient = gradients[p]
      if (gradient <= 0) continue
      const angle = ((directions[p] * 180) / Math.PI + 180) % 180
      let before = p - 1
      let after = p + 1
      if (angle >= 22.5 && angle < 67.5) {
        before = p - width + 1
        after = p + width - 1
      } else if (angle >= 67.5 && angle < 112.5) {
        before = p - width
        after = p + width
      } else if (angle >= 112.5 && angle < 157.5) {
        before = p - width - 1
        after = p + width + 1
      }
      if (gradient < gradients[before] || gradient < gradients[after]) continue
      thinned[p] = gradient
      thinnedEdgePixels++
      if (gradient >= high) {
        strong[p] = 1
        linked[p] = 1
        queue.push(p)
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]
    const x = p % width
    const y = (p - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue
        const next = ny * width + nx
        if (linked[next] || thinned[next] < low) continue
        linked[next] = 1
        queue.push(next)
      }
    }
  }

  let strongEdgePixels = 0
  let weakLinkedPixels = 0
  for (let i = 0; i < linked.length; i++) {
    if (strong[i]) strongEdgePixels++
    else if (linked[i]) weakLinkedPixels++
  }

  return { gradients: thinned, linked, strongEdgePixels, weakLinkedPixels, thinnedEdgePixels }
}

function snapToLinkedEdge(
  point: MaskPoint,
  width: number,
  height: number,
  gradients: Float32Array,
  linked: Uint8Array,
  searchWidth: number,
) {
  const radius = Math.max(1, Math.round(searchWidth))
  const cx = clamp(Math.round(point.x), 0, width - 1)
  const cy = clamp(Math.round(point.y), 0, height - 1)
  let bestScore = -Infinity
  let best: MaskPoint | null = null
  const x0 = Math.max(0, cx - radius)
  const y0 = Math.max(0, cy - radius)
  const x1 = Math.min(width - 1, cx + radius)
  const y1 = Math.min(height - 1, cy + radius)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x
      if (!linked[p]) continue
      const distance = Math.hypot(x - point.x, y - point.y)
      if (distance > radius) continue
      const score = gradients[p] - distance * Math.max(32, gradients[p] * 0.65)
      if (score > bestScore) {
        bestScore = score
        best = { x, y }
      }
    }
  }

  return best ?? { x: cx, y: cy }
}

function appendDeduped(points: MaskPoint[], point: MaskPoint) {
  const last = points[points.length - 1]
  if (last && Math.round(last.x) === Math.round(point.x) && Math.round(last.y) === Math.round(point.y)) return
  points.push({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 })
}

function smoothMagneticTracePoints(points: MaskPoint[], amount: number) {
  const alpha = clamp(amount, 0, 1)
  if (alpha <= 0 || points.length <= 2) return points
  let current = points.map((point) => ({ ...point }))
  const iterations = Math.max(1, Math.ceil(alpha * 3))
  for (let pass = 0; pass < iterations; pass++) {
    const next = current.map((point) => ({ ...point }))
    for (let i = 1; i < current.length - 1; i++) {
      const prev = current[i - 1]
      const point = current[i]
      const following = current[i + 1]
      const mid = { x: (prev.x + following.x) / 2, y: (prev.y + following.y) / 2 }
      next[i] = {
        x: Math.round((point.x + (mid.x - point.x) * alpha) * 100) / 100,
        y: Math.round((point.y + (mid.y - point.y) * alpha) * 100) / 100,
      }
    }
    current = next
  }
  current[0] = { ...points[0] }
  current[current.length - 1] = { ...points[points.length - 1] }
  return current
}

export function traceMagneticLassoEdgePathData(
  image: SelectionImageSource,
  anchors: MaskPoint[],
  options: MagneticLassoTraceOptions = {},
): MagneticLassoTraceResult {
  if (anchors.length <= 1 || image.width <= 0 || image.height <= 0) {
    return {
      points: anchors.map((point) => ({ ...point })),
      diagnostics: { strongEdgePixels: 0, weakLinkedPixels: 0, thinnedEdgePixels: 0, fallbackSegments: 0, totalPoints: anchors.length },
    }
  }

  const searchWidth = Math.max(1, Math.round(options.searchWidth ?? 10))
  const edgeMap = buildHysteresisEdgeMap(
    image,
    options.contrastThreshold ?? 24,
    options.hysteresisRatio ?? 0.45,
  )
  const traced: MaskPoint[] = []
  let fallbackSegments = 0

  for (let i = 0; i < anchors.length - 1; i++) {
    const start = snapToLinkedEdge(anchors[i], image.width, image.height, edgeMap.gradients, edgeMap.linked, searchWidth)
    const end = snapToLinkedEdge(anchors[i + 1], image.width, image.height, edgeMap.gradients, edgeMap.linked, searchWidth)
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    const steps = Math.max(1, Math.ceil(distance))
    let segmentSnaps = 0

    if (i === 0) appendDeduped(traced, start)
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const target = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }
      const snapped = snapToLinkedEdge(target, image.width, image.height, edgeMap.gradients, edgeMap.linked, searchWidth)
      if (Math.hypot(snapped.x - target.x, snapped.y - target.y) <= searchWidth) {
        segmentSnaps++
        appendDeduped(traced, { x: snapped.x, y: target.y })
      } else {
        appendDeduped(traced, snapped)
      }
    }

    if (segmentSnaps === 0) {
      fallbackSegments++
      appendDeduped(traced, end)
    }
  }

  const points = smoothMagneticTracePoints(traced, options.smoothing ?? 0)

  return {
    points,
    diagnostics: {
      strongEdgePixels: edgeMap.strongEdgePixels,
      weakLinkedPixels: edgeMap.weakLinkedPixels,
      thinnedEdgePixels: edgeMap.thinnedEdgePixels,
      fallbackSegments,
      totalPoints: points.length,
    },
  }
}

function sampleMaskNearest(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const sx = Math.round(x)
  const sy = Math.round(y)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return 0
  return data[sy * width + sx]
}

function sampleMaskBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  if (x1 < 0 || y1 < 0 || x0 >= width || y0 >= height) return 0
  const sx0 = clamp(x0, 0, width - 1)
  const sx1 = clamp(x1, 0, width - 1)
  const sy0 = clamp(y0, 0, height - 1)
  const sy1 = clamp(y1, 0, height - 1)
  const tx = clamp(x - x0, 0, 1)
  const ty = clamp(y - y0, 0, 1)
  const a = data[sy0 * width + sx0]
  const b = data[sy0 * width + sx1]
  const c = data[sy1 * width + sx0]
  const d = data[sy1 * width + sx1]
  return Math.round(a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty)
}

export function transformSelectionMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { x: number; y: number; w: number; h: number },
  options: TransformMaskOptions = {},
) {
  const scale = Math.max(0.0001, options.scale ?? 1)
  const angle = ((options.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const out = new Uint8ClampedArray(width * height)
  const sampler = options.smoothing ? sampleMaskBilinear : sampleMaskNearest

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - cx) / scale
      const dy = (y + 0.5 - cy) / scale
      const sx = cx + dx * cos - dy * sin - 0.5
      const sy = cy + dx * sin + dy * cos - 0.5
      out[y * width + x] = sampler(data, width, height, sx, sy)
    }
  }
  return out
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

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function rgbToHsl255(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lum = (max + min) / 2
  if (max === min) return [0, 0, lum * 100]
  const delta = max - min
  const sat = lum > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6
  else hue = ((rn - gn) / delta + 4) / 6
  return [hue * 360, sat * 100, lum * 100]
}

function sourceGradient(source: SelectionImageSource, x: number, y: number) {
  if (x <= 0 || y <= 0 || x >= source.width - 1 || y >= source.height - 1) return 0
  const left = imageLuma(source, y * source.width + x - 1)
  const right = imageLuma(source, y * source.width + x + 1)
  const up = imageLuma(source, (y - 1) * source.width + x)
  const down = imageLuma(source, (y + 1) * source.width + x)
  return Math.hypot(right - left, down - up)
}

function normalizedRect(
  rect: { x: number; y: number; w: number; h: number } | undefined,
  width: number,
  height: number,
) {
  const raw = rect ?? { x: 0, y: 0, w: width, h: height }
  const x0 = clamp(Math.floor(Math.min(raw.x, raw.x + raw.w)), 0, Math.max(0, width - 1))
  const y0 = clamp(Math.floor(Math.min(raw.y, raw.y + raw.h)), 0, Math.max(0, height - 1))
  const x1 = clamp(Math.ceil(Math.max(raw.x, raw.x + raw.w)), x0 + 1, width)
  const y1 = clamp(Math.ceil(Math.max(raw.y, raw.y + raw.h)), y0 + 1, height)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function edgeAverageSource(source: SelectionImageSource, rect = normalizedRect(undefined, source.width, source.height)) {
  const samples: Array<{ r: number; g: number; b: number }> = []
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  const step = Math.max(1, Math.floor(Math.min(rect.w, rect.h) / 80))
  for (let x = x0; x < x1; x += step) {
    const top = sourcePixel(source, x, y0)
    const bottom = sourcePixel(source, x, y1 - 1)
    if (top.a > DEFAULT_THRESHOLD) samples.push(top)
    if (bottom.a > DEFAULT_THRESHOLD) samples.push(bottom)
  }
  for (let y = y0; y < y1; y += step) {
    const left = sourcePixel(source, x0, y)
    const right = sourcePixel(source, x1 - 1, y)
    if (left.a > DEFAULT_THRESHOLD) samples.push(left)
    if (right.a > DEFAULT_THRESHOLD) samples.push(right)
  }
  if (!samples.length) return { r: 0, g: 0, b: 0, spread: 0 }
  const avg = {
    r: samples.reduce((sum, pixel) => sum + pixel.r, 0) / samples.length,
    g: samples.reduce((sum, pixel) => sum + pixel.g, 0) / samples.length,
    b: samples.reduce((sum, pixel) => sum + pixel.b, 0) / samples.length,
  }
  const distances = samples.map((pixel) => colorDistance(pixel, avg))
  const mean = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, distances.length)
  return { ...avg, spread: mean + Math.sqrt(variance) }
}

function interiorAverageSource(
  source: SelectionImageSource,
  rect: { x: number; y: number; w: number; h: number },
  background: { r: number; g: number; b: number },
) {
  const samples: Array<{ r: number; g: number; b: number; weight: number }> = []
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const pixel = sourcePixel(source, x, y)
      if (pixel.a <= DEFAULT_THRESHOLD) continue
      const nx = (x - cx) / Math.max(1, rect.w * 0.34)
      const ny = (y - cy) / Math.max(1, rect.h * 0.34)
      const center = clamp(1 - Math.hypot(nx, ny), 0, 1)
      const distanceFromBackground = colorDistance(pixel, background)
      if (center <= 0 && distanceFromBackground < 24) continue
      samples.push({ ...pixel, weight: 0.2 + center + clamp(distanceFromBackground / 120, 0, 1) * 0.55 })
    }
  }
  if (!samples.length) {
    const pixel = sourcePixel(source, cx, cy)
    return { r: pixel.r, g: pixel.g, b: pixel.b, spread: 0 }
  }
  const weight = samples.reduce((sum, pixel) => sum + pixel.weight, 0)
  const avg = {
    r: samples.reduce((sum, pixel) => sum + pixel.r * pixel.weight, 0) / weight,
    g: samples.reduce((sum, pixel) => sum + pixel.g * pixel.weight, 0) / weight,
    b: samples.reduce((sum, pixel) => sum + pixel.b * pixel.weight, 0) / weight,
  }
  const distances = samples.map((pixel) => colorDistance(pixel, avg))
  const mean = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, distances.length)
  return { ...avg, spread: mean + Math.sqrt(variance) }
}

function countBinary(data: Uint8Array) {
  let count = 0
  for (let i = 0; i < data.length; i++) count += data[i] ? 1 : 0
  return count
}

function cleanObjectBinary(binary: Uint8Array, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return new Uint8Array(binary)
  const expanded = alphaToBinary(expandMaskData(binaryToAlpha(binary), width, height, r, DEFAULT_THRESHOLD), DEFAULT_THRESHOLD)
  return alphaToBinary(contractMaskData(binaryToAlpha(expanded), width, height, r, DEFAULT_THRESHOLD), DEFAULT_THRESHOLD)
}

function keepScoredObjectComponents(
  binary: Uint8Array,
  width: number,
  height: number,
  scoreComponent: (pixels: number[], touchesEdge: boolean) => number,
  minScoreRatio: number,
  minPixels: number,
) {
  const visited = new Uint8Array(width * height)
  const components: Array<{ pixels: number[]; score: number }> = []
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || visited[i]) continue
    const stack = [i]
    const pixels: number[] = []
    let touchesEdge = false
    while (stack.length) {
      const p = stack.pop()!
      if (visited[p] || !binary[p]) continue
      visited[p] = 1
      pixels.push(p)
      const x = p % width
      const y = (p - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      if (x > 0) stack.push(p - 1)
      if (x < width - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - width)
      if (y < height - 1) stack.push(p + width)
    }
    if (pixels.length >= minPixels) components.push({ pixels, score: scoreComponent(pixels, touchesEdge) })
  }
  const best = components.reduce((max, component) => Math.max(max, component.score), 0)
  const out = new Uint8Array(width * height)
  if (best <= 0) return out
  for (const component of components) {
    if (component.score < best * minScoreRatio) continue
    for (const p of component.pixels) out[p] = 1
  }
  return out
}

function fillObjectHoles(binary: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const pushOutside = (p: number) => {
    if (!binary[p] && !visited[p]) stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    pushOutside(x)
    pushOutside((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    pushOutside(y * width)
    pushOutside(y * width + width - 1)
  }
  while (stack.length) {
    const p = stack.pop()!
    if (visited[p] || binary[p]) continue
    visited[p] = 1
    const x = p % width
    const y = (p - x) / width
    if (x > 0) stack.push(p - 1)
    if (x < width - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - width)
    if (y < height - 1) stack.push(p + width)
  }
  const out = new Uint8Array(binary)
  for (let i = 0; i < out.length; i++) {
    if (!binary[i] && !visited[i]) out[i] = 1
  }
  return out
}

function buildSkyBinary(source: SelectionImageSource) {
  const { width, height } = source
  const candidate = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const yNorm = y / Math.max(1, height - 1)
    if (yNorm > 0.82) continue
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const pixel = sourcePixel(source, x, y)
      if (pixel.a <= DEFAULT_THRESHOLD) continue
      const [hue, sat, lum] = rgbToHsl255(pixel.r, pixel.g, pixel.b)
      const gradient = sourceGradient(source, x, y)
      const blueSky = hue >= 174 && hue <= 260 && sat > 10 && lum > 24 && pixel.b > pixel.r + 8 && pixel.b >= pixel.g * 0.72
      const paleSky = yNorm < 0.62 && lum > 58 && sat < 38 && gradient < 36
      const sunsetSky = yNorm < 0.5 && lum > 42 && sat > 16 && gradient < 28
      if (blueSky || paleSky || sunsetSky) candidate[p] = 1
    }
  }

  const connected = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  for (let x = 0; x < width; x++) {
    if (candidate[x]) stack.push(x)
    const upperBand = Math.min(height - 1, Math.floor(height * 0.08))
    if (candidate[upperBand * width + x]) stack.push(upperBand * width + x)
  }
  for (let y = 0; y < Math.floor(height * 0.58); y++) {
    if (candidate[y * width]) stack.push(y * width)
    if (candidate[y * width + width - 1]) stack.push(y * width + width - 1)
  }
  while (stack.length) {
    const p = stack.pop()!
    if (visited[p] || !candidate[p]) continue
    visited[p] = 1
    connected[p] = 1
    const x = p % width
    const y = (p - x) / width
    if (x > 0) stack.push(p - 1)
    if (x < width - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - width)
    if (y < height - 1) stack.push(p + width)
  }
  return cleanObjectBinary(connected, width, height, Math.max(0, Math.round(Math.min(width, height) / 160)))
}

function likelySemanticBackground(source: SelectionImageSource, x: number, y: number) {
  const pixel = sourcePixel(source, x, y)
  const [hue, sat, lum] = rgbToHsl255(pixel.r, pixel.g, pixel.b)
  const likelySky = y < source.height * 0.5 && hue >= 176 && hue <= 258 && sat > 12 && lum > 26 && pixel.b > pixel.r + 10
  const likelyGreen = hue >= 82 && hue <= 158 && sat > 18 && pixel.g > pixel.r + 22 && pixel.g > pixel.b + 6
  return likelySky || likelyGreen
}

function buildForegroundObjectBinary(
  source: SelectionImageSource,
  options: OfflineObjectAwareSelectionOptions,
) {
  const { width, height } = source
  const rect = normalizedRect(options.kind === "object" ? options.objectBounds : undefined, width, height)
  const background = edgeAverageSource(source, rect)
  const foreground = interiorAverageSource(source, rect, background)
  const candidate = new Uint8Array(width * height)
  const tolerance = Math.max(6, options.tolerance ?? 44)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  let candidatePixels = 0

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const p = y * width + x
      const pixel = sourcePixel(source, x, y)
      if (pixel.a <= DEFAULT_THRESHOLD) continue
      const centerDistance = Math.hypot((x - cx) / Math.max(1, rect.w * 0.55), (y - cy) / Math.max(1, rect.h * 0.55))
      const centerPrior = clamp(1 - centerDistance, 0, 1)
      const bgDistance = colorDistance(pixel, background)
      const fgDistance = colorDistance(pixel, foreground)
      const gradient = sourceGradient(source, x, y)
      const semanticBackground = options.kind === "subject" && likelySemanticBackground(source, x, y)
      if (semanticBackground && pixel.a > 245) continue
      if (options.kind === "object" && likelySemanticBackground(source, x, y) && fgDistance > bgDistance + tolerance * 0.2) continue
      const semanticPenalty = semanticBackground ? 46 : 0
      const edgeTouchPenalty = options.kind === "subject" && (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? 28 : 0
      const threshold = Math.max(10, tolerance * 0.36, background.spread * 0.28)
      const score =
        (bgDistance - fgDistance) +
        bgDistance * 0.42 +
        centerPrior * 42 +
        Math.min(48, gradient) * 0.18 -
        semanticPenalty -
        edgeTouchPenalty
      const transparentEdge = pixel.a < 246 && centerPrior > 0.04 && fgDistance < bgDistance + 26
      if (score > threshold || (fgDistance + threshold * 0.65 < bgDistance && centerPrior > 0.04) || transparentEdge) {
        candidate[p] = 1
        candidatePixels++
      }
    }
  }

  const cleaned = cleanObjectBinary(candidate, width, height, Math.max(0, Math.round(Math.min(rect.w, rect.h) / 110)))
  const kept = keepScoredObjectComponents(
    cleaned,
    width,
    height,
    (pixels, touchesEdge) => {
      let sx = 0
      let sy = 0
      for (const p of pixels) {
        sx += p % width
        sy += Math.floor(p / width)
      }
      const px = sx / pixels.length
      const py = sy / pixels.length
      const centerDistance = Math.hypot((px - cx) / Math.max(1, rect.w * 0.55), (py - cy) / Math.max(1, rect.h * 0.55))
      const centerScore = 1.5 - clamp(centerDistance, 0, 1)
      const edgePenalty = touchesEdge ? (options.kind === "object" ? 0.72 : 0.32) : 1
      return pixels.length * centerScore * edgePenalty
    },
    options.kind === "object" ? 0.24 : 0.34,
    Math.max(1, Math.floor(rect.w * rect.h * 0.004)),
  )

  const filled = fillObjectHoles(kept, width, height)
  const alpha = binaryToAlpha(filled)
  if (options.kind === "subject") {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const p = y * width + x
        if (alpha[p] <= DEFAULT_THRESHOLD) continue
        if (likelySemanticBackground(source, x, y)) alpha[p] = 0
      }
    }
  } else if (options.kind === "object") {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const p = y * width + x
        if (alpha[p] <= DEFAULT_THRESHOLD || !likelySemanticBackground(source, x, y)) continue
        const pixel = sourcePixel(source, x, y)
        if (colorDistance(pixel, foreground) > colorDistance(pixel, background) + tolerance * 0.2) alpha[p] = 0
      }
    }
  }
  const selected = alphaToBinary(alpha, DEFAULT_THRESHOLD)
  const selectedFeature = distanceToFeature(selected, width, height)
  const outside = new Uint8Array(width * height)
  for (let i = 0; i < outside.length; i++) outside[i] = selected[i] ? 0 : 1
  const outsideFeature = distanceToFeature(outside, width, height)
  const filamentRadius = Math.max(1, Math.round(Math.min(rect.w, rect.h) / 16))
  const filamentRadiusSq = filamentRadius * filamentRadius

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const p = y * width + x
      if (alpha[p] > DEFAULT_THRESHOLD) continue
      if (options.kind === "subject" && likelySemanticBackground(source, x, y)) continue
      const nearSelection = selectedFeature[p] <= filamentRadiusSq && outsideFeature[p] <= (filamentRadius + 1) ** 2
      if (!nearSelection) continue
      const pixel = sourcePixel(source, x, y)
      if (pixel.a <= DEFAULT_THRESHOLD) continue
      if (options.kind === "subject" && likelySemanticBackground(source, x, y)) continue
      const fgDistance = colorDistance(pixel, foreground)
      const bgDistance = colorDistance(pixel, background)
      if (options.kind === "object" && likelySemanticBackground(source, x, y) && fgDistance > bgDistance + tolerance * 0.2) continue
      const gradient = sourceGradient(source, x, y)
      const sourceAlpha = pixel.a / 255
      const looksLikeFilament = sourceAlpha < 0.98 || gradient > 18 || fgDistance + 14 < bgDistance
      if (!looksLikeFilament || fgDistance > bgDistance + 34) continue
      alpha[p] = clamp(Math.round((sourceAlpha < 0.98 ? sourceAlpha : 0.58) * 255), 72, 224)
    }
  }

  return { alpha, candidatePixels: Math.max(candidatePixels, countBinary(candidate)) }
}

function buildBackgroundBinaryFromSubject(source: SelectionImageSource, subjectAlpha: Uint8ClampedArray) {
  const { width, height } = source
  const background = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const canVisit = (p: number) => subjectAlpha[p] <= DEFAULT_THRESHOLD && sourceChannel255(source, p, 3) > DEFAULT_THRESHOLD
  const push = (p: number) => {
    if (!visited[p] && canVisit(p)) stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (stack.length) {
    const p = stack.pop()!
    if (visited[p] || !canVisit(p)) continue
    visited[p] = 1
    background[p] = 1
    const x = p % width
    const y = (p - x) / width
    if (x > 0) stack.push(p - 1)
    if (x < width - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - width)
    if (y < height - 1) stack.push(p + width)
  }
  return background
}

function objectAwareResult(
  source: SelectionImageSource,
  alpha: Uint8ClampedArray,
  candidatePixels: number,
): OfflineObjectAwareSelectionResult {
  const bounds = maskDataBounds(alpha, source.width, source.height, DEFAULT_THRESHOLD)
  let keptPixels = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > DEFAULT_THRESHOLD) keptPixels++
  return {
    maskData: alpha,
    width: source.width,
    height: source.height,
    bounds,
    score: keptPixels / Math.max(1, candidatePixels),
    diagnostics: {
      method: "offline-object-aware",
      nativeAiParity: false,
      sourcePrecision: sourcePrecision(source),
      candidatePixels,
      keptPixels,
      rejectedPixels: Math.max(0, candidatePixels - keptPixels),
    },
  }
}

export function buildOfflineObjectAwareSelectionMaskData(
  source: SelectionImageSource,
  options: OfflineObjectAwareSelectionOptions,
): OfflineObjectAwareSelectionResult {
  if (source.width <= 0 || source.height <= 0) {
    return objectAwareResult(source, new Uint8ClampedArray(0), 0)
  }

  if (options.kind === "sky") {
    const sky = buildSkyBinary(source)
    const candidatePixels = countBinary(sky)
    return objectAwareResult(source, binaryToAlpha(sky), candidatePixels)
  }

  if (options.kind === "background") {
    const subject = buildForegroundObjectBinary(source, { ...options, kind: "subject" })
    const background = buildBackgroundBinaryFromSubject(source, subject.alpha)
    const candidatePixels = countBinary(background)
    return objectAwareResult(source, binaryToAlpha(background), candidatePixels)
  }

  const foreground = buildForegroundObjectBinary(source, options)
  return objectAwareResult(source, foreground.alpha, foreground.candidatePixels)
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

/* ===================================================================
 * Phase 5 — Selection Workflows (Gap Report Item 20)
 *
 * Grow/shrink/similar/transform/border/smooth/feather selection,
 * named selection save/load, and enhanced Color Range helpers.
 * =================================================================== */

// ── Grow Selection (morphological dilation) ─────────────────────────

/**
 * Expand a binary selection mask outward by N pixels using circular dilation.
 */
export function growSelection(mask: Uint8Array, width: number, height: number, pixels: number): Uint8Array {
  const radius = Math.max(0, Math.round(pixels))
  if (radius === 0) return new Uint8Array(mask)
  const out = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const val = mask[ny * width + nx]
          if (val > maxVal) maxVal = val
        }
      }
      out[y * width + x] = maxVal
    }
  }
  return out
}

// ── Shrink Selection (morphological erosion) ────────────────────────

/**
 * Contract a binary selection mask inward by N pixels using circular erosion.
 */
export function shrinkSelection(mask: Uint8Array, width: number, height: number, pixels: number): Uint8Array {
  const radius = Math.max(0, Math.round(pixels))
  if (radius === 0) return new Uint8Array(mask)
  const out = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) { minVal = 0; continue }
          const val = mask[ny * width + nx]
          if (val < minVal) minVal = val
        }
      }
      out[y * width + x] = minVal
    }
  }
  return out
}

// ── Select Similar ──────────────────────────────────────────────────

/**
 * Find all pixels in the image that are similar in color to currently
 * selected pixels. Returns a soft mask.
 */
export function selectSimilarPixels(
  imageData: ImageData,
  currentMask: Uint8Array,
  tolerance: number,
  contiguous: boolean,
  _sampleAllLayers: boolean = false,
): Uint8Array {
  const w = imageData.width
  const h = imageData.height
  const d = imageData.data
  const tol = Math.max(0, Math.min(255, tolerance))

  // Collect sample colors from currently selected pixels
  const sampleColors: Array<[number, number, number]> = []
  const maxSamples = 256
  for (let i = 0; i < w * h && sampleColors.length < maxSamples; i++) {
    if (currentMask[i] > 128) {
      const pi = i * 4
      sampleColors.push([d[pi], d[pi + 1], d[pi + 2]])
    }
  }

  if (!sampleColors.length) return new Uint8Array(w * h)

  const result = new Uint8Array(w * h)

  function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
  }

  // Mark all pixels that match any sample within tolerance
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const r = d[pi], g = d[pi + 1], b = d[pi + 2]
    let matched = false
    for (const [sr, sg, sb] of sampleColors) {
      if (colorDistance(r, g, b, sr, sg, sb) <= tol * 1.732) {
        matched = true
        break
      }
    }
    if (matched) result[i] = 255
  }

  if (contiguous) {
    // Flood fill from existing selection to limit to contiguous regions
    const visited = new Uint8Array(w * h)
    const queue: number[] = []

    for (let i = 0; i < w * h; i++) {
      if (currentMask[i] > 128 && result[i] > 0) {
        queue.push(i)
        visited[i] = 1
      }
    }

    const contiguousResult = new Uint8Array(w * h)
    while (queue.length > 0) {
      const idx = queue.pop()!
      contiguousResult[idx] = 255
      const x = idx % w
      const y = Math.floor(idx / w)
      const neighbors = [
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
      ]
      for (const ni of neighbors) {
        if (ni >= 0 && !visited[ni] && result[ni] > 0) {
          visited[ni] = 1
          queue.push(ni)
        }
      }
    }
    return contiguousResult
  }

  return result
}

// ── Transform Selection ─────────────────────────────────────────────

/**
 * Apply geometric transformation to a selection mask using bilinear interpolation.
 */
export function transformSelectionMask(
  mask: Uint8Array,
  width: number,
  height: number,
  transform: {
    scaleX: number
    scaleY: number
    rotation: number
    translateX: number
    translateY: number
    skewX?: number
    skewY?: number
  },
): Uint8Array {
  const out = new Uint8Array(width * height)
  const cx = width / 2
  const cy = height / 2
  const cosR = Math.cos(-transform.rotation)
  const sinR = Math.sin(-transform.rotation)
  const sx = transform.scaleX || 1
  const sy = transform.scaleY || 1
  const skewX = transform.skewX || 0
  const skewY = transform.skewY || 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Inverse transform to find source position
      let px = x - cx - transform.translateX
      let py = y - cy - transform.translateY

      // Inverse skew
      px = px - py * skewX
      py = py - px * skewY

      // Inverse rotation
      const rx = px * cosR - py * sinR
      const ry = px * sinR + py * cosR

      // Inverse scale
      const srcX = rx / sx + cx
      const srcY = ry / sy + cy

      // Bilinear interpolation
      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = x0 + 1
      const y1 = y0 + 1
      const fx = srcX - x0
      const fy = srcY - y0

      function sample(sx: number, sy: number): number {
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) return 0
        return mask[sy * width + sx]
      }

      const v = sample(x0, y0) * (1 - fx) * (1 - fy)
        + sample(x1, y0) * fx * (1 - fy)
        + sample(x0, y1) * (1 - fx) * fy
        + sample(x1, y1) * fx * fy

      out[y * width + x] = Math.round(Math.max(0, Math.min(255, v)))
    }
  }

  return out
}

// ── Border Selection ────────────────────────────────────────────────

/**
 * Convert a selection to a border-only selection of the specified width.
 */
export function borderSelection(mask: Uint8Array, width: number, height: number, borderWidth: number): Uint8Array {
  const grown = growSelection(mask, width, height, borderWidth)
  const shrunk = shrinkSelection(mask, width, height, borderWidth)
  const out = new Uint8Array(width * height)

  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(0, grown[i] - shrunk[i])
  }
  return out
}

// ── Smooth Selection ────────────────────────────────────────────────

/**
 * Smooth selection edges using a majority-vote within the sample radius.
 */
export function smoothSelection(mask: Uint8Array, width: number, height: number, sampleRadius: number): Uint8Array {
  const radius = Math.max(1, Math.round(sampleRadius))
  const out = new Uint8Array(width * height)
  const threshold = Math.PI * radius * radius * 0.5 // ~half the circle area

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0
      let total = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          total++
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] > 128) count++
          }
        }
      }
      out[y * width + x] = count >= threshold ? 255 : 0
    }
  }
  return out
}

// ── Feather Selection ───────────────────────────────────────────────

/**
 * Apply Gaussian feathering to selection edges.
 */
export function featherSelection(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0.5, radius)
  const kernelSize = Math.ceil(r * 3) * 2 + 1
  const halfKernel = Math.floor(kernelSize / 2)

  // Build 1D Gaussian kernel
  const kernel = new Float32Array(kernelSize)
  let sum = 0
  for (let i = 0; i < kernelSize; i++) {
    const x = i - halfKernel
    kernel[i] = Math.exp(-(x * x) / (2 * r * r))
    sum += kernel[i]
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum

  // Horizontal pass
  const temp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const nx = Math.max(0, Math.min(width - 1, x + k))
        val += mask[y * width + nx] * kernel[k + halfKernel]
      }
      temp[y * width + x] = val
    }
  }

  // Vertical pass
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const ny = Math.max(0, Math.min(height - 1, y + k))
        val += temp[ny * width + x] * kernel[k + halfKernel]
      }
      out[y * width + x] = Math.round(Math.max(0, Math.min(255, val)))
    }
  }
  return out
}

// ── Named Selection Save/Load ───────────────────────────────────────

export interface NamedSelection {
  id: string
  name: string
  mask: Uint8Array
  width: number
  height: number
  createdAt: number
  channelIndex?: number
}

/**
 * Serialize a named selection to a base64 JSON string for storage.
 */
export function serializeNamedSelection(selection: NamedSelection): string {
  const maskBase64 = btoa(String.fromCharCode(...selection.mask))
  return JSON.stringify({
    id: selection.id,
    name: selection.name,
    width: selection.width,
    height: selection.height,
    createdAt: selection.createdAt,
    channelIndex: selection.channelIndex,
    maskBase64,
  })
}

/**
 * Deserialize a named selection from a stored string.
 */
export function deserializeNamedSelection(data: string): NamedSelection | null {
  try {
    const parsed = JSON.parse(data)
    if (!parsed.maskBase64 || !parsed.width || !parsed.height) return null
    const binary = atob(parsed.maskBase64)
    const mask = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) mask[i] = binary.charCodeAt(i)
    return {
      id: parsed.id ?? `sel-${Date.now()}`,
      name: parsed.name ?? "Untitled",
      mask,
      width: parsed.width,
      height: parsed.height,
      createdAt: parsed.createdAt ?? Date.now(),
      channelIndex: parsed.channelIndex,
    }
  } catch {
    return null
  }
}

/** AND two selection masks. */
export function intersectSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.min(a[i] ?? 0, b[i] ?? 0)
  return out
}

/** Subtract B from A. */
export function subtractSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, (a[i] ?? 0) - (b[i] ?? 0))
  return out
}

/** OR two selection masks. */
export function addSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length))
  for (let i = 0; i < out.length; i++) out[i] = Math.max(a[i] ?? 0, b[i] ?? 0)
  return out
}

// ── Enhanced Color Range ────────────────────────────────────────────

/**
 * Select pixels within a color range with Photoshop-style fuzziness
 * control. Returns a soft mask (0–255 per pixel).
 */
export function colorRangeSelectWithFuzziness(
  imageData: ImageData,
  targetColors: Array<{ r: number; g: number; b: number }>,
  fuzziness: number,
  range: number = 100,
): Uint8Array {
  const w = imageData.width
  const h = imageData.height
  const d = imageData.data
  const fuzz = Math.max(0, Math.min(200, fuzziness))
  const mask = new Uint8Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const r = d[pi], g = d[pi + 1], b = d[pi + 2]

    let bestDist = Infinity
    for (const target of targetColors) {
      const dist = Math.sqrt(
        (r - target.r) ** 2 +
        (g - target.g) ** 2 +
        (b - target.b) ** 2,
      )
      if (dist < bestDist) bestDist = dist
    }

    // Fuzziness maps distance to selection strength
    const maxDist = fuzz * 1.732 * (range / 100) // scale by range
    if (bestDist <= maxDist * 0.5) {
      mask[i] = 255 // fully selected
    } else if (bestDist <= maxDist) {
      // Feathered edge
      const t = (bestDist - maxDist * 0.5) / (maxDist * 0.5)
      mask[i] = Math.round((1 - t) * 255)
    }
  }

  return mask
}

/**
 * Generate a preview ImageData showing the color range selection in
 * different preview modes.
 */
export function colorRangePreview(
  imageData: ImageData,
  mask: Uint8Array,
  previewMode: "grayscale" | "black-matte" | "white-matte" | "quick-mask",
): ImageData {
  const w = imageData.width
  const h = imageData.height
  const out = new ImageData(w, h)
  const d = imageData.data

  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const alpha = mask[i] / 255

    switch (previewMode) {
      case "grayscale":
        out.data[pi] = mask[i]
        out.data[pi + 1] = mask[i]
        out.data[pi + 2] = mask[i]
        out.data[pi + 3] = 255
        break
      case "black-matte":
        out.data[pi] = Math.round(d[pi] * alpha)
        out.data[pi + 1] = Math.round(d[pi + 1] * alpha)
        out.data[pi + 2] = Math.round(d[pi + 2] * alpha)
        out.data[pi + 3] = 255
        break
      case "white-matte":
        out.data[pi] = Math.round(d[pi] * alpha + 255 * (1 - alpha))
        out.data[pi + 1] = Math.round(d[pi + 1] * alpha + 255 * (1 - alpha))
        out.data[pi + 2] = Math.round(d[pi + 2] * alpha + 255 * (1 - alpha))
        out.data[pi + 3] = 255
        break
      case "quick-mask":
        if (alpha < 0.5) {
          // Unselected — red overlay
          out.data[pi] = Math.round(d[pi] * 0.5 + 255 * 0.5)
          out.data[pi + 1] = Math.round(d[pi + 1] * 0.5)
          out.data[pi + 2] = Math.round(d[pi + 2] * 0.5)
        } else {
          out.data[pi] = d[pi]
          out.data[pi + 1] = d[pi + 1]
          out.data[pi + 2] = d[pi + 2]
        }
        out.data[pi + 3] = 255
        break
    }
  }

  return out
}
