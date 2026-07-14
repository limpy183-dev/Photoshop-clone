import {
  gaussianBlur,
} from "./basic-algorithms"
import {
  bilinearSample,
} from "./distortion-algorithms"
import {
  clamp8,
  luma,
} from "./pixel-helpers"
import {
  fbmNoise,
} from "./render-algorithms"
import {
  copySample,
  copySampleWithEdge,
  hashNoise,
  parseHexColor,
} from "./helpers-shared"

export function filterOffset(src: ImageData, dx: number, dy: number, edgeMode: string, fillR = 255, fillG = 255, fillB = 255): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const dxi = Math.round(dx), dyi = Math.round(dy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x - dxi, sy = y - dyi
      const oi = (y * w + x) * 4
      if (edgeMode === "wrap") {
        sx = ((sx % w) + w) % w
        sy = ((sy % h) + h) % h
      } else if (edgeMode === "repeat") {
        sx = Math.max(0, Math.min(w - 1, sx))
        sy = Math.max(0, Math.min(h - 1, sy))
      } else if (edgeMode === "background") {
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
          out[oi] = fillR; out[oi + 1] = fillG; out[oi + 2] = fillB; out[oi + 3] = 255
          continue
        }
      } else {
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
          out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; out[oi + 3] = 0
          continue
        }
      }
      const si = (sy * w + sx) * 4
      out[oi] = src.data[si]; out[oi + 1] = src.data[si + 1]
      out[oi + 2] = src.data[si + 2]; out[oi + 3] = src.data[si + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function filterMaxMin(src: ImageData, radius: number, isMax: boolean): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const r = Math.max(1, Math.floor(radius))
  // Horizontal pass
  const tmp = new Uint8ClampedArray(out.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = isMax ? 0 : 255
      let br = 0, bg = 0, bb = 0, ba = 0
      for (let k = -r; k <= r; k++) {
        const sx = Math.max(0, Math.min(w - 1, x + k))
        const si = (y * w + sx) * 4
        const lum = out[si] * 0.3 + out[si + 1] * 0.6 + out[si + 2] * 0.1
        if (isMax ? lum > best : lum < best) {
          best = lum; br = out[si]; bg = out[si + 1]; bb = out[si + 2]; ba = out[si + 3]
        }
      }
      const oi = (y * w + x) * 4
      tmp[oi] = br; tmp[oi + 1] = bg; tmp[oi + 2] = bb; tmp[oi + 3] = ba
    }
  }
  // Vertical pass
  const tmp2 = new Uint8ClampedArray(tmp.length)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let best = isMax ? 0 : 255
      let br = 0, bg = 0, bb = 0, ba = 0
      for (let k = -r; k <= r; k++) {
        const sy = Math.max(0, Math.min(h - 1, y + k))
        const si = (sy * w + x) * 4
        const lum = tmp[si] * 0.3 + tmp[si + 1] * 0.6 + tmp[si + 2] * 0.1
        if (isMax ? lum > best : lum < best) {
          best = lum; br = tmp[si]; bg = tmp[si + 1]; bb = tmp[si + 2]; ba = tmp[si + 3]
        }
      }
      const oi = (y * w + x) * 4
      tmp2[oi] = br; tmp2[oi + 1] = bg; tmp2[oi + 2] = bb; tmp2[oi + 3] = ba
    }
  }
  return new ImageData(tmp2, w, h)
}

/* --------- SMART SHARPEN --------- */

export function glassDistort(src: ImageData, distortion: number, smoothness: number, texture: string, scale: number): ImageData {
  const w = src.width, h = src.height
  const source = smoothness > 0 ? gaussianBlur(src, Math.min(8, smoothness)) : src
  const out = new Uint8ClampedArray(src.data.length)
  const amp = Math.max(0, Math.min(100, distortion)) * 0.45
  const sc = Math.max(10, Math.min(400, scale)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w) / sc
      const ny = y / Math.max(1, h) / sc
      let n1: number
      let n2: number
      if (texture === "blocks") {
        n1 = Math.floor(nx * 16) % 2 ? 0.2 : 0.8
        n2 = Math.floor(ny * 16) % 2 ? 0.8 : 0.2
      } else if (texture === "frosted") {
        n1 = fbmNoise(nx * 10, ny * 10, 53, 3)
        n2 = fbmNoise(nx * 10 + 13, ny * 10 + 17, 97, 3)
      } else {
        n1 = fbmNoise(nx * 4, ny * 4, 17, 5)
        n2 = fbmNoise(nx * 4 + 9, ny * 4 + 11, 71, 5)
      }
      const sample = bilinearSample(source.data, w, h, x + (n1 - 0.5) * amp, y + (n2 - 0.5) * amp)
      const i = (y * w + x) * 4
      out[i] = sample[0]; out[i + 1] = sample[1]; out[i + 2] = sample[2]; out[i + 3] = sample[3]
    }
  }
  return new ImageData(out, w, h)
}

export function displace(
  src: ImageData,
  scaleX: number,
  scaleY: number,
  map: string,
  edgeMode: string,
  mapImage?: ImageData | null,
  tileMap: boolean = true,
): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  const mw = mapImage?.width ?? 0
  const mh = mapImage?.height ?? 0
  const hasImageMap = map === "image" && mapImage && mw > 0 && mh > 0
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const nx = src.width <= 1 ? 0 : x / (src.width - 1)
      const ny = src.height <= 1 ? 0 : y / (src.height - 1)
      let dx = 0
      let dy = 0
      if (hasImageMap && mapImage) {
        // Photoshop convention: red channel drives X displacement, green channel drives Y.
        // 128 = no shift; 0 = -scale; 255 = +scale.
        let mx: number, my: number
        if (tileMap) {
          mx = ((x % mw) + mw) % mw
          my = ((y % mh) + mh) % mh
        } else {
          mx = Math.min(mw - 1, Math.floor(nx * (mw - 1)))
          my = Math.min(mh - 1, Math.floor(ny * (mh - 1)))
        }
        const mi = (my * mw + mx) * 4
        dx = ((mapImage.data[mi] - 128) / 127) * scaleX
        dy = ((mapImage.data[mi + 1] - 128) / 127) * scaleY
      } else if (map === "horizontal-gradient") {
        dx = (nx - 0.5) * scaleX
        dy = (ny - 0.5) * scaleY
      } else if (map === "luminance") {
        const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255 - 0.5
        dx = lum * scaleX
        dy = lum * scaleY
      } else {
        dx = (fbmNoise(x / 90, y / 90, 13, 4) - 0.5) * scaleX
        dy = (fbmNoise(x / 90, y / 90, 29, 4) - 0.5) * scaleY
      }
      copySampleWithEdge(src, out, x, y, x + dx, y + dy, edgeMode)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function diffuseGlow(src: ImageData, grain: number, glow: number, clear: number): ImageData {
  const blurred = gaussianBlur(src, Math.max(1, glow / 8))
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const n = (hashNoise(i, grain, 21) - 0.5) * grain
    const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
    const mix = Math.max(0, (lum - clear / 100)) * (glow / 50)
    out[i] = clamp8(src.data[i] * (1 - mix) + blurred.data[i] * mix + n)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + blurred.data[i + 1] * mix + n)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + blurred.data[i + 2] * mix + n)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function oceanRipple(src: ImageData, size: number, magnitude: number): ImageData {
  const out = new Uint8ClampedArray(src.data.length)
  const freq = Math.max(4, size)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const wave = Math.sin(y / freq) + Math.sin((x + y) / (freq * 0.7))
      copySample(src, out, x, y, x + wave * magnitude, y + Math.cos(x / freq) * magnitude)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function shear(src: ImageData, amount: number, edgeMode: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const amp = (amount / 100) * w * 0.5
  for (let y = 0; y < h; y++) {
    const t = (y / Math.max(1, h - 1)) * Math.PI
    const shift = Math.sin(t) * amp
    for (let x = 0; x < w; x++) {
      let sx = x - shift
      let useTransparent = false
      if (sx < 0 || sx > w - 1) {
        if (edgeMode === "wrap") {
          sx = ((sx % w) + w) % w
        } else if (edgeMode === "transparent") {
          useTransparent = true
        } else {
          sx = Math.max(0, Math.min(w - 1, sx))
        }
      }
      const di = (y * w + x) * 4
      if (useTransparent) {
        out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0
        continue
      }
      const sample = bilinearSample(src.data, w, h, sx, y)
      out[di] = sample[0]
      out[di + 1] = sample[1]
      out[di + 2] = sample[2]
      out[di + 3] = sample[3]
    }
  }
  return new ImageData(out, w, h)
}

export function tilesFilter(src: ImageData, numberOfTiles: number, maxOffset: number, fill: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(w * h * 4)
  const fillColor = parseHexColor(fill === "background" ? "#ffffff" : fill === "foreground" ? "#111827" : fill)
  const tileCount = Math.max(2, Math.min(99, Math.round(numberOfTiles)))
  const tileW = Math.max(1, Math.floor(w / tileCount))
  const tileH = Math.max(1, Math.floor(h / tileCount))
  const maxShift = Math.max(0, Math.min(99, maxOffset)) / 100
  // Init with fill color (transparent edges)
  const transparent = fill === "transparent"
  for (let i = 0; i < out.length; i += 4) {
    if (transparent) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0 }
    else { out[i] = fillColor.r; out[i + 1] = fillColor.g; out[i + 2] = fillColor.b; out[i + 3] = 255 }
  }
  for (let ty = 0; ty * tileH < h; ty++) {
    for (let tx = 0; tx * tileW < w; tx++) {
      const noiseX = (hashNoise(tx, ty, 7) * 2 - 1) * tileW * maxShift
      const noiseY = (hashNoise(tx + 13, ty + 5, 19) * 2 - 1) * tileH * maxShift
      const offX = Math.round(noiseX)
      const offY = Math.round(noiseY)
      const srcX0 = tx * tileW
      const srcY0 = ty * tileH
      for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
          const sx = srcX0 + px
          const sy = srcY0 + py
          if (sx >= w || sy >= h) continue
          const dx = sx + offX
          const dy = sy + offY
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue
          const si = (sy * w + sx) * 4
          const di = (dy * w + dx) * 4
          out[di] = src.data[si]
          out[di + 1] = src.data[si + 1]
          out[di + 2] = src.data[si + 2]
          out[di + 3] = src.data[si + 3]
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

export function diffuse(src: ImageData, mode: string, amount: number): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const radius = Math.max(1, Math.min(8, Math.round(amount / 12)))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      const rx = Math.floor((hashNoise(x, y, 3) * 2 - 1) * radius)
      const ry = Math.floor((hashNoise(x + 7, y + 1, 11) * 2 - 1) * radius)
      const sx = Math.max(0, Math.min(w - 1, x + rx))
      const sy = Math.max(0, Math.min(h - 1, y + ry))
      const si = (sy * w + sx) * 4
      if (mode === "lighten") {
        out[di] = Math.max(src.data[di], src.data[si])
        out[di + 1] = Math.max(src.data[di + 1], src.data[si + 1])
        out[di + 2] = Math.max(src.data[di + 2], src.data[si + 2])
      } else if (mode === "darken") {
        out[di] = Math.min(src.data[di], src.data[si])
        out[di + 1] = Math.min(src.data[di + 1], src.data[si + 1])
        out[di + 2] = Math.min(src.data[di + 2], src.data[si + 2])
      } else if (mode === "anisotropic") {
        const cur = luma(src.data[di], src.data[di + 1], src.data[di + 2])
        const cand = luma(src.data[si], src.data[si + 1], src.data[si + 2])
        const w1 = Math.abs(cur - cand) < 30 ? 0.8 : 0.2
        out[di] = clamp8(src.data[di] * (1 - w1) + src.data[si] * w1)
        out[di + 1] = clamp8(src.data[di + 1] * (1 - w1) + src.data[si + 1] * w1)
        out[di + 2] = clamp8(src.data[di + 2] * (1 - w1) + src.data[si + 2] * w1)
      } else {
        out[di] = src.data[si]
        out[di + 1] = src.data[si + 1]
        out[di + 2] = src.data[si + 2]
      }
      out[di + 3] = src.data[di + 3]
    }
  }
  return new ImageData(out, w, h)
}

/** De-interlace with choice of replacement method. */
