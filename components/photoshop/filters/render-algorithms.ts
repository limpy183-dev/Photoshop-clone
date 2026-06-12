/**
 * Deterministic sky replacement and procedural render algorithms.
 */

import {
  clamp01,
  clamp8,
  rgbToHsl,
} from "./pixel-helpers"

export function skyReplacement(src: ImageData, horizonPct: number, tolerance: number, blend: number, warmth: number, seed: number): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data)
  const horizon = Math.round((horizonPct / 100) * h)
  const tol = tolerance / 100
  const mix = blend / 100
  const warm = warmth / 100
  const top = { r: 52 + warm * 42, g: 130 + warm * 18, b: 230 - warm * 30 }
  const mid = { r: 150 + warm * 52, g: 198 + warm * 22, b: 245 - warm * 18 }
  const low = { r: 245 + warm * 10, g: 208 + warm * 24, b: 166 - warm * 30 }
  for (let y = 0; y < Math.min(h, horizon); y++) {
    const ty = y / Math.max(1, horizon)
    const base = ty < 0.62
      ? {
          r: top.r + (mid.r - top.r) * (ty / 0.62),
          g: top.g + (mid.g - top.g) * (ty / 0.62),
          b: top.b + (mid.b - top.b) * (ty / 0.62),
        }
      : {
          r: mid.r + (low.r - mid.r) * ((ty - 0.62) / 0.38),
          g: mid.g + (low.g - mid.g) * ((ty - 0.62) / 0.38),
          b: mid.b + (low.b - mid.b) * ((ty - 0.62) / 0.38),
        }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (out[i + 3] === 0) continue
      const hsl = rgbToHsl(out[i], out[i + 1], out[i + 2])
      const blueHue = hsl.h > 0.50 && hsl.h < 0.72
      const brightNeutral = hsl.l > 0.62 && hsl.s < 0.28
      const upperBias = 1 - ty * 0.42
      const mask = clamp01(((blueHue ? hsl.s : 0) + (brightNeutral ? 0.38 : 0) + tol - 0.22) * upperBias)
      if (mask <= 0) continue
      const cloud = fbmNoise(x / w * 4.2, y / h * 3.4, seed, 5)
      const cloudLift = Math.max(0, cloud - 0.55) * 80
      const localMix = mask * mix
      out[i] = clamp8(out[i] * (1 - localMix) + (base.r + cloudLift) * localMix)
      out[i + 1] = clamp8(out[i + 1] * (1 - localMix) + (base.g + cloudLift) * localMix)
      out[i + 2] = clamp8(out[i + 2] * (1 - localMix) + (base.b + cloudLift) * localMix)
    }
  }
  return new ImageData(out, w, h)
}

/* ====================== RENDER FILTERS ================================= */

// Perlin-style noise helpers
function perlinFade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function perlinLerp(a: number, b: number, t: number) { return a + t * (b - a) }

function perlinNoise2D(x: number, y: number, seed: number): number {
  // Hash-based gradient noise
  const hash = (ix: number, iy: number) => {
    let h = ix * 374761393 + iy * 668265263 + seed * 1274126177
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return h
  }
  const grad = (h: number, dx: number, dy: number) => {
    const g = h & 3
    return (g === 0 ? dx + dy : g === 1 ? -dx + dy : g === 2 ? dx - dy : -dx - dy)
  }
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const u = perlinFade(fx), v = perlinFade(fy)
  const n00 = grad(hash(ix, iy), fx, fy)
  const n10 = grad(hash(ix + 1, iy), fx - 1, fy)
  const n01 = grad(hash(ix, iy + 1), fx, fy - 1)
  const n11 = grad(hash(ix + 1, iy + 1), fx - 1, fy - 1)
  return perlinLerp(perlinLerp(n00, n10, u), perlinLerp(n01, n11, u), v)
}

export function fbmNoise(x: number, y: number, seed: number, octaves: number = 6): number {
  let value = 0, amp = 0.5, freq = 1
  for (let i = 0; i < octaves; i++) {
    value += amp * perlinNoise2D(x * freq, y * freq, seed + i * 37)
    amp *= 0.5
    freq *= 2
  }
  return value * 0.5 + 0.5 // normalize to [0,1]
}

export function renderClouds(src: ImageData, scale: number, seed: number, difference: boolean): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const sc = Math.max(1, scale) / 50
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbmNoise(x / w / sc, y / h / sc, seed)
      const v = clamp8(n * 255)
      const i = (y * w + x) * 4
      if (difference) {
        out[i] = Math.abs(out[i] - v)
        out[i + 1] = Math.abs(out[i + 1] - v)
        out[i + 2] = Math.abs(out[i + 2] - v)
      } else {
        out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255
      }
    }
  }
  return new ImageData(out, w, h)
}

export function renderFibers(src: ImageData, variance: number, strength: number, seed: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const sc = variance / 16
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Fibers: heavily directional noise (mostly vertical variation)
      const n1 = fbmNoise(x / w * sc * 0.3, y / h * sc * 4, seed)
      const n2 = fbmNoise(x / w * sc * 0.5 + 10, y / h * sc * 6 + 10, seed + 99)
      const v = clamp8(((n1 * 0.6 + n2 * 0.4) * strength / 4) * 255)
      const i = (y * w + x) * 4
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255
    }
  }
  return new ImageData(out, w, h)
}

export function renderLensFlare(src: ImageData, brightness: number, cxPct: number, cyPct: number, _lens: string): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data)
  const fx = (cxPct / 100) * w, fy = (cyPct / 100) * h
  const br = brightness / 100
  const maxR = Math.max(w, h) * 0.6
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - fx, dy = y - fy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * w + x) * 4
      // Main glow
      const glow = Math.max(0, 1 - dist / maxR)
      const mainFlare = Math.pow(glow, 3) * 255 * br
      // Bright core
      const core = Math.pow(Math.max(0, 1 - dist / (maxR * 0.05)), 2) * 255 * br * 2
      // Rays (8-point star)
      const angle = Math.atan2(dy, dx)
      const ray = Math.pow(Math.abs(Math.cos(angle * 4)), 32) * Math.max(0, 1 - dist / (maxR * 0.4)) * 120 * br
      // Chromatic ring
      const ring = Math.exp(-Math.pow((dist - maxR * 0.3) / (maxR * 0.03), 2)) * 80 * br
      // Secondary flare (opposite side)
      const dx2 = x - (w - fx), dy2 = y - (h - fy)
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
      const sec = Math.pow(Math.max(0, 1 - dist2 / (maxR * 0.15)), 3) * 60 * br

      out[i] = clamp8(out[i] + mainFlare + core + ray + ring * 0.3 + sec * 0.7)
      out[i + 1] = clamp8(out[i + 1] + mainFlare + core + ray + ring * 0.8 + sec * 0.5)
      out[i + 2] = clamp8(out[i + 2] + mainFlare + core + ray * 0.7 + ring + sec * 1.2)
    }
  }
  return new ImageData(out, w, h)
}
