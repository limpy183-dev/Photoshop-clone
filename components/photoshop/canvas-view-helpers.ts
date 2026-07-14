import type { BrushRgba } from "./brush-engine"
import { hexToRgb, makeCanvas } from "./tool-helpers"
import { hexToRgba } from "./color-utils"
import type { GradientStop, Layer, PathPoint, PathProps } from "./types"

export interface CanvasDirtyRect {
  x: number
  y: number
  w: number
  h: number
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function textLayerPath(layer: Layer | null | undefined): PathProps | null {
  const points = layer?.text?.textPath
  if (!points?.length) return null
  return {
    points: points.map((point) => ({ x: point.x, y: point.y })),
    closed: layer?.text?.textPathClosed === true,
  }
}

export function hashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

export function maskBounds(mask: HTMLCanvasElement, width: number, height: number) {
  const ctx = mask.getContext("2d")
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, width, height)
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let hasPixels = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (img.data[(y * width + x) * 4 + 3] > 8) {
        hasPixels = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return hasPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function cloneCanvasForTool(canvas: HTMLCanvasElement) {
  const copy = makeCanvas(canvas.width, canvas.height)
  copy.getContext("2d")!.drawImage(canvas, 0, 0)
  return copy
}

export function alphaMaskFromCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let hasPixels = false
  // Single linear pass; reconstruct x,y from a running index instead of using
  // expensive division+modulo per pixel.
  let x = 0
  let y = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 0) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
    } else {
      hasPixels = true
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    x++
    if (x === w) {
      x = 0
      y++
    }
  }
  return {
    mask: img,
    bounds: hasPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  }
}

export function pointInMask(mask: HTMLCanvasElement, pt: { x: number; y: number }) {
  if (pt.x < 0 || pt.y < 0 || pt.x >= mask.width || pt.y >= mask.height) return false
  const ctx = mask.getContext("2d")
  if (!ctx) return false
  const px = ctx.getImageData(Math.floor(pt.x), Math.floor(pt.y), 1, 1).data
  return px[3] > 8
}

export function makeCurvaturePath(nodes: PathPoint[], closed: boolean): PathPoint[] {
  if (nodes.length < 2) return nodes.map((p) => ({ x: p.x, y: p.y }))
  const pts = nodes.map((p) => ({ x: p.x, y: p.y } as PathPoint))
  const get = (index: number) => {
    if (closed) return nodes[(index + nodes.length) % nodes.length]
    return nodes[Math.max(0, Math.min(nodes.length - 1, index))]
  }
  const segments = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % nodes.length
    const p0 = get(i - 1)
    const p1 = get(i)
    const p2 = get(i + 1)
    const p3 = get(i + 2)
    pts[i].cp1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    }
    pts[next].cp2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    }
  }
  return pts
}

export function requiredRgbaFromCss(color: string): Required<BrushRgba> {
  const rgb = hexToRgb(color)
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }
}

export function rgbaToCss(color: Required<BrushRgba>) {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${clamp01(color.a)})`
}

export function mergeDirtyRect(a: CanvasDirtyRect | undefined, b: CanvasDirtyRect): CanvasDirtyRect {
  if (!a) return b
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x + a.w, b.x + b.w)
  const y2 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function sortCorners(pts: { x: number; y: number }[]): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  const angled = pts.map((p) => ({ ...p, angle: Math.atan2(p.y - cy, p.x - cx) }))
  angled.sort((a, b) => a.angle - b.angle)
  // After sorting by angle: should be TL, BL, BR, TR (counter-clockwise)
  // We need TL, TR, BR, BL
  const [tl, bl, br, tr] = angled
  return [tl, tr, br, bl]
}

export function sampleCanvasColor(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
  sampleSize: "point" | "3x3" | "5x5",
) {
  const ctx = canvas.getContext("2d")!
  const side = sampleSize === "5x5" ? 5 : sampleSize === "3x3" ? 3 : 1
  const half = Math.floor(side / 2)
  const x0 = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x) - half))
  const y0 = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y) - half))
  const w = Math.max(1, Math.min(side, canvas.width - x0))
  const h = Math.max(1, Math.min(side, canvas.height - y0))
  const pixels = ctx.getImageData(x0, y0, w, h).data
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let weight = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    const k = alpha > 0 ? alpha : 1
    r += pixels[i] * k
    g += pixels[i + 1] * k
    b += pixels[i + 2] * k
    a += pixels[i + 3]
    weight += k
  }
  const denom = Math.max(1, weight)
  return {
    r: Math.round(r / denom),
    g: Math.round(g / denom),
    b: Math.round(b / denom),
    a: Math.round(a / Math.max(1, pixels.length / 4)),
  }
}

export interface GradientRenderSettings {
  stops?: GradientStop[]
  reverse?: boolean
  cycle?: boolean
  dither?: boolean
}

export function getGradientStops(
  gradient: GradientRenderSettings,
  foreground: string,
  background: string,
): GradientStop[] {
  const base = gradient.stops?.length
    ? gradient.stops
    : [
      { offset: 0, color: foreground, opacity: 1 },
      { offset: 1, color: background, opacity: 1 },
    ]
  const stops = base
    .map((s) => ({
      offset: gradient.reverse ? 1 - s.offset : s.offset,
      color: s.color,
      opacity: s.opacity,
    }))
    .sort((a, b) => a.offset - b.offset)
  if (stops[0]?.offset > 0) stops.unshift({ ...stops[0], offset: 0 })
  if (stops[stops.length - 1]?.offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 })
  return stops
}

export function addGradientStops(g: CanvasGradient, stops: GradientStop[]) {
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s.offset)), hexToRgba(s.color, s.opacity))
}

export function sampleGradient(gradient: GradientRenderSettings, stops: GradientStop[], t: number) {
  let tt = gradient.cycle ? t - Math.floor(t) : clamp01(t)
  if (gradient.reverse) tt = 1 - tt
  let prev = stops[0]
  let next = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].offset <= tt && stops[i + 1].offset >= tt) {
      prev = stops[i]
      next = stops[i + 1]
      break
    }
  }
  const span = Math.max(0.0001, next.offset - prev.offset)
  const k = clamp01((tt - prev.offset) / span)
  const a = hexToRgb(prev.color)
  const b = hexToRgb(next.color)
  const opacity = prev.opacity + (next.opacity - prev.opacity) * k
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
    a: Math.round(opacity * 255),
  }
}

export function applyDitherToCanvas(canvas: HTMLCanvasElement, dither: boolean | undefined) {
  if (!dither) return
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const n = (Math.random() - 0.5) * 3
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}
