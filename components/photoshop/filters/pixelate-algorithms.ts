import {
  clamp01,
  clamp8,
  luma,
} from "./pixel-helpers"
import {
  fbmNoise,
} from "./render-algorithms"
import {
  hashNoise,
  parseHexColor,
} from "./helpers-shared"

export function colorHalftone(src: ImageData, radius: number, angle: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cell = Math.max(4, Math.min(64, Math.round(radius * 2)))
  const rad = angle * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = x * cos - y * sin
      const ry = x * sin + y * cos
      const cx = Math.floor(rx / cell) * cell + cell / 2
      const cy = Math.floor(ry / cell) * cell + cell / 2
      const dist = Math.hypot(rx - cx, ry - cy)
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const ink = 1 - src.data[i + c] / 255
        const dot = Math.sqrt(ink) * cell * 0.62
        out[i + c] = dist <= dot ? Math.min(src.data[i + c], 24) : 255
      }
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function mezzotint(src: ImageData, type: string, density: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const d = Math.max(0, Math.min(100, density)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum01 = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
      const pattern = type === "long-strokes"
        ? Math.sin((x + y * 0.35) * 0.25)
        : type === "short-strokes"
          ? Math.sin(x * 0.8) * Math.cos(y * 0.8)
          : fbmNoise(x / w * 40, y / h * 40, 31, 2) * 2 - 1
      const value = clamp01(lum01 + pattern * 0.35 * d) > 0.5 ? 255 : 0
      out[i] = value; out[i + 1] = value; out[i + 2] = value; out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function fragment(src: ImageData): ImageData {
  const w = src.width, h = src.height
  const out = new Float32Array(w * h * 4)
  const offsets: Array<[number, number]> = [
    [-4, 0], [4, 0], [0, -4], [0, 4],
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      let r = 0, g = 0, b = 0, a = 0
      for (const [dx, dy] of offsets) {
        const sx = Math.max(0, Math.min(w - 1, x + dx))
        const sy = Math.max(0, Math.min(h - 1, y + dy))
        const si = (sy * w + sx) * 4
        r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; a += src.data[si + 3]
      }
      out[di] = r / 4
      out[di + 1] = g / 4
      out[di + 2] = b / 4
      out[di + 3] = a / 4
    }
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i++) data[i] = clamp8(out[i])
  return new ImageData(data, w, h)
}

export function facet(src: ImageData, threshold = 22): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const used = new Uint8Array(w * h)
  const queue: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (used[idx]) continue
      const si = idx * 4
      const seedR = src.data[si], seedG = src.data[si + 1], seedB = src.data[si + 2]
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0
      const region: number[] = []
      queue.length = 0
      queue.push(idx)
      used[idx] = 1
      while (queue.length > 0) {
        const ci = queue.pop()!
        const cx = ci % w
        const cy = (ci - cx) / w
        const pi = ci * 4
        const r = src.data[pi], g = src.data[pi + 1], b = src.data[pi + 2], a = src.data[pi + 3]
        sumR += r; sumG += g; sumB += b; sumA += a; count++
        region.push(ci)
        if (count > 4096) continue
        const neighbors = [
          [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (used[ni]) continue
          const npi = ni * 4
          const dr = src.data[npi] - seedR
          const dg = src.data[npi + 1] - seedG
          const db = src.data[npi + 2] - seedB
          if (Math.sqrt(dr * dr + dg * dg + db * db) > threshold) continue
          used[ni] = 1
          queue.push(ni)
        }
      }
      const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count, avgA = sumA / count
      for (const ci of region) {
        const pi = ci * 4
        out[pi] = clamp8(avgR)
        out[pi + 1] = clamp8(avgG)
        out[pi + 2] = clamp8(avgB)
        out[pi + 3] = clamp8(avgA)
      }
    }
  }
  return new ImageData(out, w, h)
}

export function pointillize(src: ImageData, cellSize: number, background = "#ffffff"): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const bg = parseHexColor(background)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg.r
    out[i + 1] = bg.g
    out[i + 2] = bg.b
    out[i + 3] = 255
  }
  const size = Math.max(2, Math.min(96, Math.round(cellSize)))
  for (let cy = 0; cy < h; cy += size) {
    for (let cx = 0; cx < w; cx += size) {
      const r1 = hashNoise(cx, cy, 1)
      const r2 = hashNoise(cx + 3, cy + 7, 17)
      const r3 = hashNoise(cx + 11, cy + 5, 99)
      const jitterX = cx + r1 * size
      const jitterY = cy + r2 * size
      const radius = (0.45 + r3 * 0.4) * size * 0.5
      const sx = Math.max(0, Math.min(w - 1, Math.round(jitterX)))
      const sy = Math.max(0, Math.min(h - 1, Math.round(jitterY)))
      const si = (sy * w + sx) * 4
      const r = src.data[si], g = src.data[si + 1], b = src.data[si + 2]
      const x0 = Math.max(0, Math.floor(jitterX - radius))
      const x1 = Math.min(w - 1, Math.ceil(jitterX + radius))
      const y0 = Math.max(0, Math.floor(jitterY - radius))
      const y1 = Math.min(h - 1, Math.ceil(jitterY + radius))
      const r2sq = radius * radius
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - jitterX
          const dy = py - jitterY
          if (dx * dx + dy * dy > r2sq) continue
          const di = (py * w + px) * 4
          out[di] = r
          out[di + 1] = g
          out[di + 2] = b
          out[di + 3] = 255
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

