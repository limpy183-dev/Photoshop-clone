/**
 * Shared image geometry sampling and distortion algorithms.
 */

import {
  clamp01,
  clamp8,
} from "./pixel-helpers"

/* ====================== BILINEAR INTERPOLATION ========================= */

export function bilinearSample(data: Uint8ClampedArray, w: number, h: number, fx: number, fy: number): [number, number, number, number] {
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = x0 + 1, y1 = y0 + 1
  const dx = fx - x0, dy = fy - y0
  const sx0 = Math.max(0, Math.min(w - 1, x0)), sx1 = Math.max(0, Math.min(w - 1, x1))
  const sy0 = Math.max(0, Math.min(h - 1, y0)), sy1 = Math.max(0, Math.min(h - 1, y1))
  const p00 = (sy0 * w + sx0) * 4, p10 = (sy0 * w + sx1) * 4
  const p01 = (sy1 * w + sx0) * 4, p11 = (sy1 * w + sx1) * 4
  const w00 = (1 - dx) * (1 - dy), w10 = dx * (1 - dy), w01 = (1 - dx) * dy, w11 = dx * dy
  return [
    data[p00] * w00 + data[p10] * w10 + data[p01] * w01 + data[p11] * w11,
    data[p00 + 1] * w00 + data[p10 + 1] * w10 + data[p01 + 1] * w01 + data[p11 + 1] * w11,
    data[p00 + 2] * w00 + data[p10 + 2] * w10 + data[p01 + 2] * w01 + data[p11 + 2] * w11,
    data[p00 + 3] * w00 + data[p10 + 3] * w10 + data[p01 + 3] * w01 + data[p11 + 3] * w11,
  ]
}

/* ====================== DISTORT FILTERS ================================ */

export function distortTwirl(src: ImageData, angleDeg: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.min(cx, cy)
  const angleRad = (angleDeg * Math.PI) / 180
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      if (dist < maxR) {
        const t = 1 - dist / maxR
        const twist = angleRad * t * t
        const cosT = Math.cos(twist), sinT = Math.sin(twist)
        const sx = cx + cosT * dx - sinT * dy
        const sy = cy + sinT * dx + cosT * dy
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortPinch(src: ImageData, amount: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.min(cx, cy)
  const str = amount / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      if (dist < maxR && dist > 0) {
        const t = dist / maxR
        const scale = Math.pow(t, str > 0 ? 1 + str * 2 : 1 / (1 - str * 2))
        const sx = cx + dx * (scale / t)
        const sy = cy + dy * (scale / t)
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortSpherize(src: ImageData, amount: number, mode: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, rw = w / 2, rh = h / 2
  const str = amount / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rw, ny = (y - cy) / rh
      const d2 = nx * nx + ny * ny
      const i = (y * w + x) * 4
      if (d2 < 1) {
        const d = Math.sqrt(d2)
        const refract = d > 0 ? (1 - Math.sqrt(1 - d2)) / d * str + (1 - str) : 1
        let sx: number, sy: number
        if (mode === "horizontal") {
          sx = cx + nx * refract * rw; sy = y
        } else if (mode === "vertical") {
          sx = x; sy = cy + ny * refract * rh
        } else {
          sx = cx + nx * refract * rw; sy = cy + ny * refract * rh
        }
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]
        out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortWave(src: ImageData, wavelength: number, amplitude: number, type: string, scale: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const s = scale / 100
  const waveFunc = (t: number): number => {
    if (type === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(t * Math.PI * 2))
    if (type === "square") return Math.sin(t * Math.PI * 2) >= 0 ? 1 : -1
    return Math.sin(t * Math.PI * 2)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + waveFunc(y / wavelength) * amplitude * s
      const sy = y + waveFunc(x / wavelength) * amplitude * s
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortRipple(src: ImageData, amount: number, size: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const freq = size === "small" ? 0.4 : size === "large" ? 0.05 : 0.15
  const amp = amount / 100 * (size === "small" ? 5 : size === "large" ? 40 : 15)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + Math.sin(y * freq * Math.PI) * amp
      const sy = y + Math.sin(x * freq * Math.PI) * amp
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortZigZag(src: ImageData, amount: number, ridges: number, style: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)
      const t = dist / maxR
      const i = (y * w + x) * 4
      let displacement = 0
      if (style === "pond") {
        displacement = Math.sin(t * ridges * Math.PI * 2) * amount * t
      } else if (style === "from-center") {
        displacement = Math.sin(t * ridges * Math.PI * 2) * amount
      } else {
        displacement = Math.sin(angle * ridges) * amount * t
      }
      const sx = x + Math.cos(angle) * displacement
      const sy = y + Math.sin(angle) * displacement
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distortPolar(src: ImageData, mode: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2, cy = h / 2, maxR = Math.max(cx, cy)
  if (mode === "rect-to-polar") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const angle = (x / w) * Math.PI * 2
        const radius = (1 - y / h) * maxR
        const sx = cx + Math.cos(angle) * radius
        const sy = cy - Math.sin(angle) * radius
        const i = (y * w + x) * 4
        if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
          const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
        }
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(-dy, dx)
        const sx = ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * w
        const sy = (1 - dist / maxR) * h
        const i = (y * w + x) * 4
        if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
          const [r, g, b, a] = bilinearSample(src.data, w, h, sx, sy)
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

interface AdaptiveWideAngleConstraint {
  type: "vertical" | "horizontal" | "full"
  x1: number
  y1: number
  x2: number
  y2: number
}

interface AdaptiveWideAngleExtras {
  focalLength?: number      // mm
  cropFactor?: number       // x
  constraints?: AdaptiveWideAngleConstraint[]
}

export function parseAdaptiveConstraints(raw: string): AdaptiveWideAngleConstraint[] {
  if (!raw || typeof raw !== "string") return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const value = JSON.parse(trimmed)
    if (!Array.isArray(value)) return []
    return value
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const e = entry as Record<string, unknown>
        const type = e.type === "vertical" || e.type === "horizontal" || e.type === "full" ? e.type : "vertical"
        return {
          type: type as AdaptiveWideAngleConstraint["type"],
          x1: Number(e.x1 ?? 0),
          y1: Number(e.y1 ?? 0),
          x2: Number(e.x2 ?? 1),
          y2: Number(e.y2 ?? 1),
        }
      })
  } catch {
    return []
  }
}

export function adaptiveWideAngle(
  src: ImageData,
  correction: number,
  fisheye: number,
  rotateDeg: number,
  scalePct: number,
  extras: AdaptiveWideAngleExtras = {},
): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.hypot(cx, cy)
  // Focal length / crop factor automatically blend into the "correction" baseline:
  // smaller focal-equivalent => more inherent barrel; larger crop factor => less.
  const focal = Math.max(1, extras.focalLength ?? 0)
  const crop = Math.max(0.1, extras.cropFactor ?? 0)
  let focalBias = 0
  if (focal > 1 && crop > 0.1) {
    const equiv = focal * crop
    // Wider lenses (smaller equivalent) push barrel positive; longer lenses pull negative
    focalBias = (35 - equiv) / 90   // ~+0.39 @ 0mm equiv; ~-2.94 @ 300mm equiv
  }
  const strength = (fisheye - correction) / 100 + focalBias
  const rot = (-rotateDeg * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const scale = Math.max(0.1, scalePct / 100)

  // Constraint lines: each line provides a local correction direction.
  // A "vertical" constraint applies extra de-rotation to a band that contains
  // the line so it ends up straight; "horizontal" likewise. "full" tries both
  // directions.
  const constraints = extras.constraints ?? []
  type PrepConstraint = { type: AdaptiveWideAngleConstraint["type"]; ax: number; ay: number; bx: number; by: number; angle: number }
  const prep: PrepConstraint[] = constraints.map((c) => {
    const ax = c.x1 * w, ay = c.y1 * h, bx = c.x2 * w, by = c.y2 * h
    const angle = Math.atan2(by - ay, bx - ax)
    return { type: c.type, ax, ay, bx, by, angle }
  })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / scale
      const ny = (y - cy) / scale
      const rx = cos * nx - sin * ny
      const ry = sin * nx + cos * ny
      const r = Math.hypot(rx, ry) / maxR
      const barrel = 1 + strength * r * r * 0.85
      let sx = cx + rx * barrel
      let sy = cy + ry * barrel
      // Apply local rotation around the constraint mid-point so the constraint
      // segment becomes axis-aligned within its influence band.
      for (const c of prep) {
        const mx = (c.ax + c.bx) / 2
        const my = (c.ay + c.by) / 2
        const dist = distanceToSegment({ x: sx, y: sy }, { x: c.ax, y: c.ay }, { x: c.bx, y: c.by })
        const band = Math.max(16, Math.hypot(c.bx - c.ax, c.by - c.ay) * 0.35)
        const influence = 1 - clamp01(dist / band)
        if (influence <= 0) continue
        const target = c.type === "horizontal" ? 0 : c.type === "vertical" ? Math.PI / 2 : c.angle
        const delta = (target - c.angle) * influence
        const ca = Math.cos(delta)
        const sa = Math.sin(delta)
        const dx = sx - mx
        const dy = sy - my
        sx = mx + ca * dx - sa * dy
        sy = my + sa * dx + ca * dy
      }
      const i = (y * w + x) * 4
      if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        const [rr, gg, bb, aa] = bilinearSample(src.data, w, h, sx, sy)
        out[i] = rr
        out[i + 1] = gg
        out[i + 2] = bb
        out[i + 3] = aa
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
      }
    }
  }
  return new ImageData(out, w, h)
}

export function perspectivePlaneWarp(
  src: ImageData,
  offsets: {
    topLeftX: number
    topLeftY: number
    topRightX: number
    topRightY: number
    bottomRightX: number
    bottomRightY: number
    bottomLeftX: number
    bottomLeftY: number
  },
  showGrid: boolean,
) {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const scaleX = w / 100
  const scaleY = h / 100
  const tl = { x: offsets.topLeftX * scaleX, y: offsets.topLeftY * scaleY }
  const tr = { x: w - 1 + offsets.topRightX * scaleX, y: offsets.topRightY * scaleY }
  const br = { x: w - 1 + offsets.bottomRightX * scaleX, y: h - 1 + offsets.bottomRightY * scaleY }
  const bl = { x: offsets.bottomLeftX * scaleX, y: h - 1 + offsets.bottomLeftY * scaleY }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let u = w <= 1 ? 0 : x / (w - 1)
      let v = h <= 1 ? 0 : y / (h - 1)
      for (let iter = 0; iter < 5; iter++) {
        const px = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x
        const py = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y
        const dux = -(1 - v) * tl.x + (1 - v) * tr.x + v * br.x - v * bl.x
        const duy = -(1 - v) * tl.y + (1 - v) * tr.y + v * br.y - v * bl.y
        const dvx = -(1 - u) * tl.x - u * tr.x + u * br.x + (1 - u) * bl.x
        const dvy = -(1 - u) * tl.y - u * tr.y + u * br.y + (1 - u) * bl.y
        const ex = px - x
        const ey = py - y
        const det = dux * dvy - dvx * duy
        if (Math.abs(det) < 0.0001) break
        u = clamp01(u - (ex * dvy - ey * dvx) / det)
        v = clamp01(v - (dux * ey - duy * ex) / det)
      }
      const [rr, gg, bb, aa] = bilinearSample(src.data, w, h, u * (w - 1), v * (h - 1))
      const i = (y * w + x) * 4
      out[i] = rr
      out[i + 1] = gg
      out[i + 2] = bb
      out[i + 3] = aa
      if (showGrid && ((Math.round(u * 8) === u * 8) || (Math.round(v * 8) === v * 8))) {
        out[i] = clamp8(out[i] * 0.55 + 38)
        out[i + 1] = clamp8(out[i + 1] * 0.55 + 160)
        out[i + 2] = clamp8(out[i + 2] * 0.55 + 255)
        out[i + 3] = Math.max(out[i + 3], 190)
      }
    }
  }
  return new ImageData(out, w, h)
}

export function vanishingPoint(
  src: ImageData,
  horizonPct: number,
  leftVanishing: number,
  rightVanishing: number,
  depth: number,
  showGrid: boolean,
  planeOffsets?: Parameters<typeof perspectivePlaneWarp>[1],
): ImageData {
  if (planeOffsets && Object.values(planeOffsets).some((value) => Math.abs(value) > 0.001)) {
    return perspectivePlaneWarp(src, planeOffsets, showGrid)
  }
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const horizon = clamp01(horizonPct / 100)
  const left = leftVanishing / 100
  const right = rightVanishing / 100
  const depthAmount = depth / 100
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    const distanceFromHorizon = v - horizon
    const perspective = 1 + distanceFromHorizon * depthAmount * 1.8
    const rowShift = (left * (1 - v) - right * v) * w * 0.18
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2 - rowShift) / Math.max(0.18, perspective) + w / 2
      const sy = (v - horizon) / Math.max(0.18, perspective) * h + horizon * h
      const i = (y * w + x) * 4
      if (u >= 0 && u < w - 1 && sy >= 0 && sy < h - 1) {
        const [rr, gg, bb, aa] = bilinearSample(src.data, w, h, u, sy)
        out[i] = rr
        out[i + 1] = gg
        out[i + 2] = bb
        out[i + 3] = aa
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
      }
      if (showGrid && ((Math.round(u) % 64 === 0) || (Math.round(sy) % 64 === 0))) {
        out[i] = clamp8(out[i] * 0.55 + 38)
        out[i + 1] = clamp8(out[i + 1] * 0.55 + 160)
        out[i + 2] = clamp8(out[i + 2] * 0.55 + 255)
        out[i + 3] = Math.max(out[i + 3], 190)
      }
    }
  }
  return new ImageData(out, w, h)
}

export function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 0.0001) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}
