function clone(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Stack box blur - fast, separable, good Gaussian approximation. */
export function boxBlur(src: ImageData, radius: number): ImageData {
  if (radius <= 0) return clone(src)
  const r = Math.floor(radius)
  const w = src.width
  const h = src.height
  const a = new Uint8ClampedArray(src.data)
  const b = new Uint8ClampedArray(a.length)

  // horizontal
  for (let y = 0; y < h; y++) {
    let rs = 0
    let gs = 0
    let bs = 0
    let as_ = 0
    for (let i = -r; i <= r; i++) {
      const x = Math.max(0, Math.min(w - 1, i))
      const p = (y * w + x) * 4
      rs += a[p]
      gs += a[p + 1]
      bs += a[p + 2]
      as_ += a[p + 3]
    }
    const span = 2 * r + 1
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      b[p] = rs / span
      b[p + 1] = gs / span
      b[p + 2] = bs / span
      b[p + 3] = as_ / span
      const xOut = Math.max(0, Math.min(w - 1, x - r))
      const xIn = Math.max(0, Math.min(w - 1, x + r + 1))
      const pOut = (y * w + xOut) * 4
      const pIn = (y * w + xIn) * 4
      rs += a[pIn] - a[pOut]
      gs += a[pIn + 1] - a[pOut + 1]
      bs += a[pIn + 2] - a[pOut + 2]
      as_ += a[pIn + 3] - a[pOut + 3]
    }
  }

  // vertical
  for (let x = 0; x < w; x++) {
    let rs = 0
    let gs = 0
    let bs = 0
    let as_ = 0
    for (let i = -r; i <= r; i++) {
      const y = Math.max(0, Math.min(h - 1, i))
      const p = (y * w + x) * 4
      rs += b[p]
      gs += b[p + 1]
      bs += b[p + 2]
      as_ += b[p + 3]
    }
    const span = 2 * r + 1
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4
      a[p] = rs / span
      a[p + 1] = gs / span
      a[p + 2] = bs / span
      a[p + 3] = as_ / span
      const yOut = Math.max(0, Math.min(h - 1, y - r))
      const yIn = Math.max(0, Math.min(h - 1, y + r + 1))
      const pOut = (yOut * w + x) * 4
      const pIn = (yIn * w + x) * 4
      rs += b[pIn] - b[pOut]
      gs += b[pIn + 1] - b[pOut + 1]
      bs += b[pIn + 2] - b[pOut + 2]
      as_ += b[pIn + 3] - b[pOut + 3]
    }
  }

  return new ImageData(a, w, h)
}

export function gaussianBlur(src: ImageData, radius: number): ImageData {
  if (radius <= 0) return clone(src)
  // 3 passes of box blur approximate Gaussian blur.
  const r = Math.max(1, Math.round(radius / 3))
  let out = boxBlur(src, r)
  out = boxBlur(out, r)
  out = boxBlur(out, r)
  return out
}

export function motionBlur(src: ImageData, distance: number, angleDeg: number): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const steps = Math.max(1, Math.round(distance))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let i = -steps; i <= steps; i++) {
        const sx = Math.round(x + dx * i)
        const sy = Math.round(y + dy * i)
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
        const p = (sy * w + sx) * 4
        r += src.data[p]
        g += src.data[p + 1]
        b += src.data[p + 2]
        a += src.data[p + 3]
        n++
      }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return new ImageData(out, w, h)
}

export function convolve(src: ImageData, kernel: number[], divisor = 1): ImageData {
  const side = Math.round(Math.sqrt(kernel.length))
  const half = Math.floor(side / 2)
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let cy = 0; cy < side; cy++) {
        for (let cx = 0; cx < side; cx++) {
          const sy = Math.max(0, Math.min(h - 1, y + cy - half))
          const sx = Math.max(0, Math.min(w - 1, x + cx - half))
          const p = (sy * w + sx) * 4
          const k = kernel[cy * side + cx]
          r += src.data[p] * k
          g += src.data[p + 1] * k
          b += src.data[p + 2] * k
        }
      }
      const o = (y * w + x) * 4
      out[o] = clamp8(r / divisor)
      out[o + 1] = clamp8(g / divisor)
      out[o + 2] = clamp8(b / divisor)
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function sharpen(src: ImageData, amount: number): ImageData {
  // amount 0..200 (%)
  const a = amount / 100
  const k = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  return convolve(src, k)
}

export function unsharpMask(src: ImageData, amount: number, radius: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const k = amount / 100
  for (let i = 0; i < src.data.length; i += 4) {
    out[i] = clamp8(src.data[i] + (src.data[i] - blurred.data[i]) * k)
    out[i + 1] = clamp8(src.data[i + 1] + (src.data[i + 1] - blurred.data[i + 1]) * k)
    out[i + 2] = clamp8(src.data[i + 2] + (src.data[i + 2] - blurred.data[i + 2]) * k)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, w, h)
}

export function findEdges(src: ImageData): ImageData {
  // Sobel
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0
      let sy = 0
      for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const py = Math.max(0, Math.min(h - 1, y + cy - 1))
          const px = Math.max(0, Math.min(w - 1, x + cx - 1))
          const p = (py * w + px) * 4
          const lum = 0.299 * src.data[p] + 0.587 * src.data[p + 1] + 0.114 * src.data[p + 2]
          sx += lum * gx[cy * 3 + cx]
          sy += lum * gy[cy * 3 + cx]
        }
      }
      const m = clamp8(Math.hypot(sx, sy))
      const o = (y * w + x) * 4
      out[o] = m
      out[o + 1] = m
      out[o + 2] = m
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function emboss(src: ImageData, amount: number): ImageData {
  const k = [-2, -1, 0, -1, 1, 1, 0, 1, 2].map((v) => v * (amount / 100))
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 128
      let g = 128
      let b = 128
      for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const sy = Math.max(0, Math.min(h - 1, y + cy - 1))
          const sx = Math.max(0, Math.min(w - 1, x + cx - 1))
          const p = (sy * w + sx) * 4
          const kv = k[cy * 3 + cx]
          r += src.data[p] * kv
          g += src.data[p + 1] * kv
          b += src.data[p + 2] * kv
        }
      }
      const o = (y * w + x) * 4
      out[o] = clamp8(r)
      out[o + 1] = clamp8(g)
      out[o + 2] = clamp8(b)
      out[o + 3] = src.data[o + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function solarize(src: ImageData, threshold: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i] > threshold ? 255 - out[i] : out[i]
    out[i + 1] = out[i + 1] > threshold ? 255 - out[i + 1] : out[i + 1]
    out[i + 2] = out[i + 2] > threshold ? 255 - out[i + 2] : out[i + 2]
  }
  return new ImageData(out, src.width, src.height)
}

export function pixelate(src: ImageData, cellSize: number): ImageData {
  const w = src.width
  const h = src.height
  const cs = Math.max(1, Math.floor(cellSize))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y += cs) {
    for (let x = 0; x < w; x += cs) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let cy = 0; cy < cs && y + cy < h; cy++) {
        for (let cx = 0; cx < cs && x + cx < w; cx++) {
          const p = ((y + cy) * w + (x + cx)) * 4
          r += src.data[p]
          g += src.data[p + 1]
          b += src.data[p + 2]
          a += src.data[p + 3]
          n++
        }
      }
      r /= n
      g /= n
      b /= n
      a /= n
      for (let cy = 0; cy < cs && y + cy < h; cy++) {
        for (let cx = 0; cx < cs && x + cx < w; cx++) {
          const p = ((y + cy) * w + (x + cx)) * 4
          out[p] = r
          out[p + 1] = g
          out[p + 2] = b
          out[p + 3] = a
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

export function noise(src: ImageData, amount: number, mono: boolean, gaussian = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const randFn = gaussian
    ? () => {
        // Box-Muller transform for gaussian distribution
        let u = 0, v = 0
        while (u === 0) u = Math.random()
        while (v === 0) v = Math.random()
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.33
      }
    : () => Math.random() - 0.5

  for (let i = 0; i < out.length; i += 4) {
    if (mono) {
      const n = randFn() * 2 * amount
      out[i] = clamp8(out[i] + n)
      out[i + 1] = clamp8(out[i + 1] + n)
      out[i + 2] = clamp8(out[i + 2] + n)
    } else {
      out[i] = clamp8(out[i] + randFn() * 2 * amount)
      out[i + 1] = clamp8(out[i + 1] + randFn() * 2 * amount)
      out[i + 2] = clamp8(out[i + 2] + randFn() * 2 * amount)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function brightnessContrast(src: ImageData, brightness: number, contrast: number, useLegacy = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  if (useLegacy) {
    const c = (contrast + 100) / 100
    for (let i = 0; i < out.length; i += 4) {
      out[i] = clamp8((out[i] - 128) * c + 128 + brightness)
      out[i + 1] = clamp8((out[i + 1] - 128) * c + 128 + brightness)
      out[i + 2] = clamp8((out[i + 2] - 128) * c + 128 + brightness)
    }
    return new ImageData(out, src.width, src.height)
  }

  const b = brightness / 150
  const c = contrast / 100
  const pivot = 0.5 + b * 0.12
  for (let i = 0; i < out.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = out[i + k] / 255
      v = b >= 0 ? v + (1 - v) * b : v * (1 + b)
      if (c !== 0) {
        const slope = c >= 0 ? 1 + c * 2.2 : 1 + c * 0.85
        v = (v - pivot) * slope + pivot
      }
      out[i + k] = clamp8(v * 255)
    }
  }
  return new ImageData(out, src.width, src.height)
}
