import type { BlendMode, GradientStop, Layer, LayerStyle, MultiGradient } from "./types"

/* ------------------------------------------------------------------ */
/*  Rendering helpers                                                  */
/* ------------------------------------------------------------------ */

const ALPHA_THRESHOLD = 1 / 255
const INF = 1e20

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

function clamp(v: number, min = 0, max = 1) {
  return v < min ? min : v > max ? max : v
}

function hexToRgb(hex: string) {
  const raw = (hex || "#000000").trim().replace("#", "")
  const normalized =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.padEnd(6, "0").slice(0, 6)
  const parsed = Number.parseInt(normalized, 16)
  const v = Number.isFinite(parsed) ? parsed : 0
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

function withAlpha(hex: string, opacity: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${clamp(opacity ?? 1)})`
}

interface AlphaGeometry {
  w: number
  h: number
  alpha: Float32Array
  inside: Uint8Array
  distanceToInside: Float32Array
  distanceToOutside: Float32Array
  hasPixels: boolean
}

function readAlpha(canvas: HTMLCanvasElement): Float32Array {
  const w = canvas.width
  const h = canvas.height
  const alpha = new Float32Array(w * h)
  const ctx = canvas.getContext("2d")
  if (!ctx || w <= 0 || h <= 0) return alpha
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    alpha[p] = img.data[i + 3] / 255
  }
  return alpha
}

function buildGeometry(canvas: HTMLCanvasElement): AlphaGeometry {
  const w = canvas.width
  const h = canvas.height
  const alpha = readAlpha(canvas)
  const inside = new Uint8Array(w * h)
  const outside = new Uint8Array(w * h)
  let hasInside = false
  let hasOutside = false
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > ALPHA_THRESHOLD) {
      inside[i] = 1
      hasInside = true
    } else {
      outside[i] = 1
      hasOutside = true
    }
  }
  const distanceToInside = hasInside ? distanceToSeeds(inside, w, h) : fillDistance(w, h, INF)
  const distanceToOutside = hasOutside ? distanceToSeeds(outside, w, h) : borderDistance(w, h)
  return { w, h, alpha, inside, distanceToInside, distanceToOutside, hasPixels: hasInside }
}

function fillDistance(w: number, h: number, value: number) {
  const d = new Float32Array(w * h)
  d.fill(value)
  return d
}

function borderDistance(w: number, h: number) {
  const d = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      d[y * w + x] = Math.min(x + 1, y + 1, w - x, h - y)
    }
  }
  return d
}

function distanceToSeeds(seeds: Uint8Array, w: number, h: number) {
  const grid = new Float64Array(w * h)
  for (let i = 0; i < seeds.length; i++) grid[i] = seeds[i] ? 0 : INF
  const row = new Float64Array(Math.max(w, h))
  const dist = new Float64Array(Math.max(w, h))

  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) row[x] = grid[base + x]
    edt1d(row, w, dist)
    for (let x = 0; x < w; x++) grid[base + x] = dist[x]
  }

  const out = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) row[y] = grid[y * w + x]
    edt1d(row, h, dist)
    for (let y = 0; y < h; y++) out[y * w + x] = Math.sqrt(dist[y])
  }
  return out
}

function edt1d(f: Float64Array, n: number, d: Float64Array) {
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = intersection(f, q, v[k])
    while (s <= z[k]) {
      k--
      s = intersection(f, q, v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const p = v[k]
    d[q] = (q - p) * (q - p) + f[p]
  }
}

function intersection(f: Float64Array, q: number, p: number) {
  return ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p)
}

function blurMask(src: Float32Array, w: number, h: number, radius: number, passes = 3) {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return src.slice()
  let current = src.slice()
  for (let pass = 0; pass < passes; pass++) current = boxBlurOnce(current, w, h, r)
  return current
}

function boxBlurOnce(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = 2 * r + 1

  for (let y = 0; y < h; y++) {
    const base = y * w
    let sum = 0
    for (let i = -r; i <= r; i++) sum += src[base + clampInt(i, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      tmp[base + x] = sum / span
      const xOut = clampInt(x - r, 0, w - 1)
      const xIn = clampInt(x + r + 1, 0, w - 1)
      sum += src[base + xIn] - src[base + xOut]
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += tmp[clampInt(i, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span
      const yOut = clampInt(y - r, 0, h - 1)
      const yIn = clampInt(y + r + 1, 0, h - 1)
      sum += tmp[yIn * w + x] - tmp[yOut * w + x]
    }
  }
  return out
}

function clampInt(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v
}

function sampleMask(mask: Float32Array, w: number, h: number, x: number, y: number) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const a = mask[y0 * w + x0] * (1 - tx) + mask[y0 * w + x1] * tx
  const b = mask[y1 * w + x0] * (1 - tx) + mask[y1 * w + x1] * tx
  return a * (1 - ty) + b * ty
}

function offsetMask(mask: Float32Array, w: number, h: number, dx: number, dy: number) {
  const out = new Float32Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = sampleMask(mask, w, h, x - dx, y - dy)
  }
  return out
}

function applyChoke(mask: Float32Array, amount: number | undefined) {
  const pct = clamp((amount ?? 0) / 100, 0, 0.99)
  if (pct <= 0) return mask
  const out = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = clamp((mask[i] - pct) / (1 - pct))
  return out
}

function addNoise(mask: Float32Array, amount: number | undefined) {
  const pct = clamp((amount ?? 0) / 100)
  if (pct <= 0) return mask
  const out = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    const n = pseudoRandom(i) * 2 - 1
    out[i] = clamp(mask[i] * (1 + n * pct))
  }
  return out
}

function applyContour(mask: Float32Array, contour: "linear" | "soft" | "sharp" | "ring" | "cone" | undefined) {
  if (!contour || contour === "linear") return mask
  const out = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    const v = clamp(mask[i])
    if (contour === "soft") out[i] = v * v * (3 - 2 * v)
    else if (contour === "sharp") out[i] = Math.pow(v, 0.42)
    else if (contour === "ring") out[i] = clamp(Math.sin(v * Math.PI * 2) * 0.5 + 0.5)
    else if (contour === "cone") out[i] = v < 0.5 ? v * 2 : (1 - v) * 2
    else out[i] = v
  }
  return out
}

function applyContourValue(value: number, contour: "linear" | "soft" | "sharp" | "ring" | "cone" | undefined) {
  if (!contour || contour === "linear") return value
  const tmp = new Float32Array([value])
  return applyContour(tmp, contour)[0]
}

function pseudoRandom(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function edgeRamp(distance: number, radius: number) {
  if (radius <= 0) return 0
  return clamp(radius - distance + 0.75)
}

function distanceFalloff(distance: number, size: number, solidPercent: number | undefined, rangePercent: number | undefined) {
  if (size <= 0 || distance > size + 0.75) return 0
  const solid = clamp((solidPercent ?? 0) / 100, 0, 0.98) * size
  if (distance <= solid) return 1
  const t = 1 - (distance - solid) / Math.max(0.0001, size - solid)
  const range = clamp((rangePercent ?? 50) / 100)
  const power = 1.9 - range * 1.45
  return Math.pow(clamp(t), Math.max(0.25, power))
}

function solidMaskCanvas(mask: Float32Array, w: number, h: number, color: string, opacity = 1): HTMLCanvasElement {
  const cv = makeCanvas(w, h)
  const ctx = cv.getContext("2d")!
  const img = ctx.createImageData(w, h)
  const { r, g, b } = hexToRgb(color)
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    const a = clamp(mask[p] * opacity)
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
    img.data[i + 3] = Math.round(a * 255)
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

function gradientMaskCanvas(mask: Float32Array, w: number, h: number, gradient: MultiGradient, opacity = 1) {
  const cv = makeGradientCanvas(gradient, w, h)
  const ctx = cv.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    img.data[i + 3] = Math.round((img.data[i + 3] / 255) * clamp(mask[p] * opacity) * 255)
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

function drawEffectCanvas(
  destCtx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  blendMode: BlendMode | undefined,
) {
  destCtx.save()
  destCtx.globalCompositeOperation = blendModeMap(blendMode)
  destCtx.drawImage(source, 0, 0)
  destCtx.restore()
}

function alphaClipMask(alpha: Float32Array) {
  return alpha.slice()
}

function drawLayerFill(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, fillOpacity: number) {
  ctx.save()
  ctx.globalAlpha = clamp(fillOpacity)
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()
}

function resolveOffset(
  cfg: { angle?: number; distance?: number; offsetX?: number; offsetY?: number },
  fallbackX: number,
  fallbackY: number,
) {
  if (cfg.angle !== undefined || cfg.distance !== undefined) {
    const distance = cfg.distance ?? Math.hypot(cfg.offsetX ?? fallbackX, cfg.offsetY ?? fallbackY)
    const angle = ((cfg.angle ?? 120) * Math.PI) / 180
    return { dx: -Math.cos(angle) * distance, dy: Math.sin(angle) * distance }
  }
  return { dx: cfg.offsetX ?? fallbackX, dy: cfg.offsetY ?? fallbackY }
}

function makeStrokeMask(
  geom: AlphaGeometry,
  size: number,
  position: "inside" | "outside" | "center",
) {
  const { alpha, distanceToInside, distanceToOutside, w, h } = geom
  const mask = new Float32Array(w * h)
  const outerRadius = position === "center" ? size / 2 : size
  const innerRadius = position === "center" ? size / 2 : size

  for (let i = 0; i < mask.length; i++) {
    const a = alpha[i]
    let value = 0
    if (position === "outside" || position === "center") {
      const outside = edgeRamp(distanceToInside[i], outerRadius) * (1 - a)
      value = Math.max(value, outside)
    }
    if (position === "inside" || position === "center") {
      const inside = edgeRamp(distanceToOutside[i], innerRadius) * a
      value = Math.max(value, inside)
    }
    mask[i] = clamp(value)
  }
  return mask
}

function drawStroke(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["stroke"]>,
) {
  if (cfg.size <= 0 || (cfg.opacity ?? 1) <= 0) return
  const mask = makeStrokeMask(geom, cfg.size, cfg.position)
  const fill =
    cfg.fillType === "gradient" && cfg.gradient
      ? gradientMaskCanvas(mask, geom.w, geom.h, cfg.gradient, cfg.opacity ?? 1)
      : solidMaskCanvas(mask, geom.w, geom.h, cfg.color, cfg.opacity ?? 1)
  drawEffectCanvas(destCtx, fill, cfg.blendMode ?? "normal")
}

function drawDropShadow(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["dropShadow"]>,
) {
  if (cfg.opacity <= 0 || !geom.hasPixels) return
  const { dx, dy } = resolveOffset(cfg, cfg.offsetX, cfg.offsetY)
  let mask: Float32Array<ArrayBufferLike> = offsetMask(geom.alpha, geom.w, geom.h, dx, dy)
  mask = blurMask(mask, geom.w, geom.h, Math.max(0, cfg.size), 3)
  mask = applyChoke(mask, cfg.spread)
  mask = applyContour(mask, cfg.contour)
  mask = addNoise(mask, cfg.noise)
  const colored = solidMaskCanvas(mask, geom.w, geom.h, cfg.color, cfg.opacity)
  drawEffectCanvas(destCtx, colored, cfg.blendMode ?? "multiply")
}

function drawOuterGlow(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["outerGlow"]>,
) {
  if (cfg.size <= 0 || cfg.opacity <= 0 || !geom.hasPixels) return
  const mask = new Float32Array(geom.w * geom.h)
  for (let i = 0; i < mask.length; i++) {
    const outsideWeight = 1 - geom.alpha[i]
    if (outsideWeight <= 0) continue
    mask[i] = distanceFalloff(geom.distanceToInside[i], cfg.size, cfg.spread, cfg.range) * outsideWeight
  }
  const colored = solidMaskCanvas(addNoise(applyContour(mask, cfg.contour), cfg.noise), geom.w, geom.h, cfg.color, cfg.opacity)
  drawEffectCanvas(destCtx, colored, cfg.blendMode ?? "screen")
}

function drawInnerGlow(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["innerGlow"]>,
) {
  if (cfg.size <= 0 || cfg.opacity <= 0 || !geom.hasPixels) return
  const mask = new Float32Array(geom.w * geom.h)
  const fromCenter = (cfg.source ?? "edge") === "center"
  const range = clamp((cfg.range ?? 50) / 100)
  const power = Math.max(0.25, 1.9 - range * 1.45)
  for (let i = 0; i < mask.length; i++) {
    const a = geom.alpha[i]
    if (a <= 0) continue
    if (fromCenter) {
      mask[i] = Math.pow(clamp(geom.distanceToOutside[i] / Math.max(1, cfg.size)), power) * a
    } else {
      mask[i] = distanceFalloff(geom.distanceToOutside[i], cfg.size, cfg.choke, cfg.range) * a
    }
  }
  const colored = solidMaskCanvas(addNoise(applyContour(mask, cfg.contour), cfg.noise), geom.w, geom.h, cfg.color, cfg.opacity)
  drawEffectCanvas(destCtx, colored, cfg.blendMode ?? "screen")
}

function drawInnerShadow(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["innerShadow"]>,
) {
  if (cfg.opacity <= 0 || !geom.hasPixels) return
  const { dx, dy } = resolveOffset(cfg, cfg.offsetX, cfg.offsetY)
  const shifted = offsetMask(geom.alpha, geom.w, geom.h, dx, dy)
  let mask: Float32Array<ArrayBufferLike> = new Float32Array(shifted.length)
  for (let i = 0; i < shifted.length; i++) mask[i] = 1 - shifted[i]
  mask = blurMask(mask, geom.w, geom.h, Math.max(0, cfg.size), 3)
  mask = applyChoke(mask, cfg.choke)
  for (let i = 0; i < mask.length; i++) mask[i] *= geom.alpha[i]
  const colored = solidMaskCanvas(mask, geom.w, geom.h, cfg.color, cfg.opacity)
  drawEffectCanvas(destCtx, colored, cfg.blendMode ?? "multiply")
}

function drawColorOverlay(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  color: string,
  opacity: number,
  blendMode?: BlendMode,
) {
  if (opacity <= 0) return
  const colored = solidMaskCanvas(alphaClipMask(geom.alpha), geom.w, geom.h, color, opacity)
  drawEffectCanvas(destCtx, colored, blendMode ?? "normal")
}

/** Build a rendered gradient bitmap from a MultiGradient definition. */
export function makeGradientCanvas(g: MultiGradient, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h)
  const ctx = cv.getContext("2d")!
  const img = ctx.createImageData(w, h)
  const stops = normalizeStops(g.stops)
  const cx = w / 2
  const cy = h / 2
  const angleRad = ((g.angle ?? 0) * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const len = Math.max(1, Math.hypot(w, h) / 2)
  const diamondLen = Math.max(
    1,
    ...[
      [-cx, -cy],
      [w - cx, -cy],
      [-cx, h - cy],
      [w - cx, h - cy],
    ].map(([x, y]) => Math.abs(x * cos + y * sin) + Math.abs(-x * sin + y * cos)),
  )

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const projection = dx * cos + dy * sin
      let t = 0
      if (g.type === "radial") {
        t = Math.hypot(dx, dy) / len
      } else if (g.type === "angular") {
        t = (Math.atan2(dy, dx) - angleRad) / (Math.PI * 2)
        t = t - Math.floor(t)
      } else if (g.type === "reflected") {
        t = Math.abs(projection) / len
      } else if (g.type === "diamond") {
        const rx = dx * cos + dy * sin
        const ry = -dx * sin + dy * cos
        t = (Math.abs(rx) + Math.abs(ry)) / diamondLen
      } else {
        t = projection / len / 2 + 0.5
      }
      const c = sampleStops(stops, clamp(t))
      const i = (y * w + x) * 4
      img.data[i] = c.r
      img.data[i + 1] = c.g
      img.data[i + 2] = c.b
      img.data[i + 3] = Math.round(clamp(c.a) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

function normalizeStops(stops: GradientStop[] | undefined) {
  const normalized = (stops?.length ? stops : [{ offset: 0, color: "#000000", opacity: 1 }])
    .map((s) => ({ ...s, offset: clamp(s.offset), opacity: clamp(s.opacity ?? 1) }))
    .sort((a, b) => a.offset - b.offset)
  if (normalized.length === 1) normalized.push({ ...normalized[0], offset: 1 })
  return normalized
}

function sampleStops(stops: GradientStop[], t: number) {
  if (t <= stops[0].offset) return stopColor(stops[0])
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t <= b.offset) {
      const span = Math.max(0.0001, b.offset - a.offset)
      const k = (t - a.offset) / span
      const ca = hexToRgb(a.color)
      const cb = hexToRgb(b.color)
      return {
        r: Math.round(ca.r + (cb.r - ca.r) * k),
        g: Math.round(ca.g + (cb.g - ca.g) * k),
        b: Math.round(ca.b + (cb.b - ca.b) * k),
        a: a.opacity + (b.opacity - a.opacity) * k,
      }
    }
  }
  return stopColor(stops[stops.length - 1])
}

function stopColor(stop: GradientStop) {
  return { ...hexToRgb(stop.color), a: stop.opacity ?? 1 }
}

function drawGradientOverlay(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  gradient: MultiGradient,
  opacity: number,
  blendMode?: BlendMode,
) {
  if (opacity <= 0) return
  const grad = gradientMaskCanvas(alphaClipMask(geom.alpha), geom.w, geom.h, gradient, opacity)
  drawEffectCanvas(destCtx, grad, blendMode ?? "normal")
}

function drawBevel(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["bevel"]>,
) {
  if (cfg.size <= 0 || (cfg.opacity ?? 0) <= 0 || !geom.hasPixels) return
  const w = geom.w
  const h = geom.h
  const size = Math.max(1, cfg.size)
  const height = new Float32Array(w * h)
  const effectMask = new Float32Array(w * h)
  const style = cfg.style ?? "inner"

  for (let i = 0; i < height.length; i++) {
    const a = geom.alpha[i]
    const isInside = a > ALPHA_THRESHOLD
    const dOut = geom.distanceToOutside[i]
    const dIn = geom.distanceToInside[i]
    let value = 0
    let mask = 0

    if (style === "inner") {
      value = isInside ? applyContourValue(clamp(dOut / size), cfg.contour) : 0
      mask = isInside ? a : 0
    } else if (style === "outer") {
      value = isInside ? 1 : dIn <= size + 1 ? applyContourValue(clamp(1 - dIn / size), cfg.contour) : 0
      mask = !isInside && dIn <= size + 1 ? 1 - a : 0
    } else {
      value = isInside ? 0.5 + 0.5 * applyContourValue(clamp(dOut / size), cfg.contour) : dIn <= size + 1 ? 0.5 * applyContourValue(clamp(1 - dIn / size), cfg.contour) : 0
      mask = isInside ? a : dIn <= size + 1 ? 1 - a : 0
      if (style === "pillow") value = 1 - value
    }

    height[i] = value
    effectMask[i] = clamp(mask)
  }

  const angle = ((cfg.angle ?? 120) * Math.PI) / 180
  const altitude = ((cfg.altitude ?? 30) * Math.PI) / 180
  const light = {
    x: Math.cos(angle) * Math.cos(altitude),
    y: -Math.sin(angle) * Math.cos(altitude),
    z: Math.sin(altitude),
  }
  const high = new Float32Array(w * h)
  const shadow = new Float32Array(w * h)
  const depthScale = Math.max(0.1, (cfg.depth ?? 100) / 100) * 4
  const invert = (cfg.direction ?? "up") === "down" ? -1 : 1

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1)
    const y1 = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1)
      const x1 = Math.min(w - 1, x + 1)
      const i = y * w + x
      const mask = effectMask[i]
      if (mask <= 0) continue
      const gx = height[y * w + x1] - height[y * w + x0]
      const gy = height[y1 * w + x] - height[y0 * w + x]
      let nx = -gx * depthScale
      let ny = -gy * depthScale
      let nz = 1
      const nLen = Math.max(0.0001, Math.hypot(nx, ny, nz))
      nx /= nLen
      ny /= nLen
      nz /= nLen
      const dot = nx * light.x + ny * light.y + nz * light.z
      const shade = (dot - light.z) * 2.75 * invert
      if (shade > 0) high[i] = clamp(shade * mask)
      else shadow[i] = clamp(-shade * mask)
    }
  }

  const softenedHigh = cfg.soften > 0 ? blurMask(high, w, h, cfg.soften, 2) : high
  const softenedShadow = cfg.soften > 0 ? blurMask(shadow, w, h, cfg.soften, 2) : shadow
  const hiCanvas = solidMaskCanvas(
    softenedHigh,
    w,
    h,
    cfg.highlight,
    cfg.highlightOpacity ?? cfg.opacity ?? 0.75,
  )
  const shCanvas = solidMaskCanvas(
    softenedShadow,
    w,
    h,
    cfg.shadow,
    cfg.shadowOpacity ?? cfg.opacity ?? 0.75,
  )
  drawEffectCanvas(destCtx, hiCanvas, cfg.highlightBlendMode ?? "screen")
  drawEffectCanvas(destCtx, shCanvas, cfg.shadowBlendMode ?? "multiply")
}

function drawSatin(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  cfg: NonNullable<LayerStyle["satin"]>,
) {
  if (cfg.opacity <= 0 || !geom.hasPixels) return
  const angle = (cfg.angle * Math.PI) / 180
  const dx = Math.cos(angle) * cfg.distance
  const dy = Math.sin(angle) * cfg.distance
  const a = offsetMask(geom.alpha, geom.w, geom.h, dx, dy)
  const b = offsetMask(geom.alpha, geom.w, geom.h, -dx, -dy)
  let mask = new Float32Array(a.length)
  for (let i = 0; i < mask.length; i++) mask[i] = Math.abs(a[i] - b[i]) * geom.alpha[i]
  mask = blurMask(mask, geom.w, geom.h, Math.max(0, cfg.size), 2)
  const colored = solidMaskCanvas(mask, geom.w, geom.h, cfg.color, cfg.opacity)
  drawEffectCanvas(destCtx, colored, "screen")
}

function drawPatternOverlay(
  destCtx: CanvasRenderingContext2D,
  geom: AlphaGeometry,
  patternKind: "checker" | "dots" | "lines" | "noise",
  scale: number,
  color: string,
  opacity: number,
) {
  if (opacity <= 0) return
  const w = geom.w
  const h = geom.h
  const tileSize = Math.max(4, Math.floor(scale))
  const tile = makeCanvas(tileSize, tileSize)
  const tctx = tile.getContext("2d")!
  tctx.clearRect(0, 0, tileSize, tileSize)
  tctx.fillStyle = color
  if (patternKind === "checker") {
    const half = tileSize / 2
    tctx.fillRect(0, 0, half, half)
    tctx.fillRect(half, half, half, half)
  } else if (patternKind === "dots") {
    tctx.beginPath()
    tctx.arc(tileSize / 2, tileSize / 2, tileSize / 4, 0, Math.PI * 2)
    tctx.fill()
  } else if (patternKind === "lines") {
    tctx.fillRect(0, 0, tileSize, Math.max(1, tileSize / 4))
  } else {
    const img = tctx.getImageData(0, 0, tileSize, tileSize)
    const { r, g, b } = hexToRgb(color)
    for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
      const v = pseudoRandom(p)
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = v > 0.5 ? 255 : 0
    }
    tctx.putImageData(img, 0, 0)
  }
  const pattern = makeCanvas(w, h)
  const pctx = pattern.getContext("2d")!
  const pat = pctx.createPattern(tile, "repeat")!
  pctx.fillStyle = pat
  pctx.fillRect(0, 0, w, h)
  const img = pctx.getImageData(0, 0, w, h)
  for (let i = 0, p = 0; p < geom.alpha.length; i += 4, p++) {
    img.data[i + 3] = Math.round((img.data[i + 3] / 255) * geom.alpha[p] * clamp(opacity) * 255)
  }
  pctx.putImageData(img, 0, 0)
  drawEffectCanvas(destCtx, pattern, "normal")
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Compose a layer with its non-destructive style effects baked in.
 * Returns a new canvas (same document size) ready for compositing.
 */
export function applyLayerStyle(layer: Layer, fillOpacity = 1): HTMLCanvasElement {
  const style = layer.style
  if (!style) return layer.canvas
  const enabled =
    style.stroke?.enabled ||
    style.outerGlow?.enabled ||
    style.innerGlow?.enabled ||
    style.innerShadow?.enabled ||
    style.bevel?.enabled ||
    style.satin?.enabled ||
    style.colorOverlay?.enabled ||
    style.gradientOverlay?.enabled ||
    style.patternOverlay?.enabled ||
    style.dropShadow?.enabled
  if (!enabled && fillOpacity >= 1) return layer.canvas

  const geom = buildGeometry(layer.canvas)
  const out = makeCanvas(layer.canvas.width, layer.canvas.height)
  const ctx = out.getContext("2d")!

  if (style.dropShadow?.enabled) drawDropShadow(ctx, geom, style.dropShadow)
  if (style.outerGlow?.enabled) drawOuterGlow(ctx, geom, style.outerGlow)
  if (style.stroke?.enabled && style.stroke.position === "outside") drawStroke(ctx, geom, style.stroke)

  drawLayerFill(ctx, layer.canvas, fillOpacity)

  if (style.bevel?.enabled) drawBevel(ctx, geom, style.bevel)
  if (style.satin?.enabled) drawSatin(ctx, geom, style.satin)
  if (style.innerShadow?.enabled) drawInnerShadow(ctx, geom, style.innerShadow)
  if (style.innerGlow?.enabled) drawInnerGlow(ctx, geom, style.innerGlow)
  if (style.colorOverlay?.enabled) {
    drawColorOverlay(
      ctx,
      geom,
      style.colorOverlay.color,
      style.colorOverlay.opacity,
      style.colorOverlay.blendMode,
    )
  }
  if (style.gradientOverlay?.enabled) {
    drawGradientOverlay(
      ctx,
      geom,
      style.gradientOverlay.gradient,
      style.gradientOverlay.opacity,
      style.gradientOverlay.blendMode,
    )
  }
  if (style.patternOverlay?.enabled) {
    drawPatternOverlay(
      ctx,
      geom,
      style.patternOverlay.pattern,
      style.patternOverlay.scale,
      style.patternOverlay.color,
      style.patternOverlay.opacity,
    )
  }
  if (style.stroke?.enabled && style.stroke.position !== "outside") drawStroke(ctx, geom, style.stroke)
  return out
}

function blendModeMap(b?: BlendMode): GlobalCompositeOperation {
  const map: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    "color-dodge": "color-dodge",
    "color-burn": "color-burn",
    "hard-light": "hard-light",
    "soft-light": "soft-light",
    difference: "difference",
    exclusion: "exclusion",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    luminosity: "luminosity",
  }
  return map[b ?? "normal"] ?? "source-over"
}

/** Apply a layer's mask to a canvas in-place (multiplies alpha). */
export function applyMask(canvas: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width
  const h = canvas.height
  const out = makeCanvas(w, h)
  const ctx = out.getContext("2d")!
  ctx.drawImage(canvas, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const mctx = mask.getContext("2d")!
  const mImg = mctx.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = 0.299 * mImg.data[i] + 0.587 * mImg.data[i + 1] + 0.114 * mImg.data[i + 2]
    img.data[i + 3] = (img.data[i + 3] * lum) / 255
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** Default styles for a brand-new dialog. */
export function defaultStyle(color: string): LayerStyle {
  const defaultGradient: MultiGradient = {
    type: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "#000000", opacity: 1 },
      { offset: 1, color: "#ffffff", opacity: 1 },
    ],
  }
  return {
    stroke: {
      enabled: false,
      color,
      size: 4,
      position: "outside",
      opacity: 1,
      blendMode: "normal",
      fillType: "color",
      gradient: defaultGradient,
    },
    outerGlow: {
      enabled: false,
      color: "#ffff66",
      size: 18,
      opacity: 0.75,
      blendMode: "screen",
      spread: 0,
      range: 50,
      noise: 0,
      contour: "linear",
    },
    innerGlow: {
      enabled: false,
      color: "#ffffff",
      size: 14,
      opacity: 0.6,
      blendMode: "screen",
      source: "edge",
      choke: 0,
      range: 50,
      noise: 0,
      contour: "linear",
    },
    innerShadow: {
      enabled: false,
      color: "#000000",
      size: 8,
      offsetX: 4,
      offsetY: 4,
      opacity: 0.6,
      blendMode: "multiply",
      angle: 120,
      distance: 5,
      choke: 0,
      useGlobalLight: true,
    },
    bevel: {
      enabled: false,
      style: "inner",
      direction: "up",
      depth: 100,
      size: 6,
      soften: 0,
      angle: 120,
      altitude: 30,
      highlight: "#ffffff",
      shadow: "#000000",
      opacity: 0.75,
      highlightOpacity: 0.75,
      shadowOpacity: 0.75,
      highlightBlendMode: "screen",
      shadowBlendMode: "multiply",
      useGlobalLight: true,
      contour: "linear",
    },
    satin: {
      enabled: false,
      color: "#000000",
      angle: 19,
      distance: 10,
      size: 10,
      opacity: 0.5,
    },
    colorOverlay: {
      enabled: false,
      color,
      opacity: 1,
      blendMode: "normal",
    },
    gradientOverlay: {
      enabled: false,
      gradient: defaultGradient,
      opacity: 1,
      blendMode: "normal",
    },
    patternOverlay: {
      enabled: false,
      pattern: "checker",
      scale: 16,
      opacity: 0.5,
      color: "#888888",
    },
    dropShadow: {
      enabled: false,
      color: "#000000",
      size: 12,
      offsetX: 4,
      offsetY: 4,
      opacity: 0.5,
      blendMode: "multiply",
      angle: 120,
      distance: 8,
      spread: 0,
      noise: 0,
      useGlobalLight: true,
      contour: "linear",
    },
  }
}
