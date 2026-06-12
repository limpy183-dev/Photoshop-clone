/**
 * Pixel-level filter implementations. Each `apply(src, params)` returns a
 * NEW ImageData with the filter applied. Source is not mutated, so callers
 * can use the same ImageData for live previews across many parameter changes.
 */

import { hexToRgb as hexToRgbFilter } from "../color-utils"
import { applyChannelMixerToImageData, type ChannelMixerParams } from "../color-channel-ops"
import { parseFieldBlurPins, parsePathBlurPoints } from "../blur-gallery-controls"
import {
  boxBlur,
  brightnessContrast,
  convolve,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "./basic-algorithms"
import type { FilterDef } from "./contracts"

export type {
  FilterContext,
  FilterDef,
  FilterParam,
} from "./contracts"
export {
  compositeFilterImageData,
  type FilterCompositeOptions,
} from "./composite"

/* --------------------------- helpers ----------------------------------- */

function clone(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function numberParam(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function parseBool(v: number | string | boolean | undefined, fallback = false) {
  return typeof v === "boolean" ? v : fallback
}

function parseNumber(v: number | string | boolean | undefined, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return { h, s, l }
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number) {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return { r: r * 255, g: g * 255, b: b * 255 }
}

type HueRange = "master" | "reds" | "yellows" | "greens" | "cyans" | "blues" | "magentas"

const HUE_RANGES: Record<Exclude<HueRange, "master">, { center: number; inner: number; outer: number }> = {
  reds: { center: 0, inner: 18 / 360, outer: 42 / 360 },
  yellows: { center: 60 / 360, inner: 22 / 360, outer: 48 / 360 },
  greens: { center: 120 / 360, inner: 26 / 360, outer: 56 / 360 },
  cyans: { center: 180 / 360, inner: 24 / 360, outer: 54 / 360 },
  blues: { center: 240 / 360, inner: 26 / 360, outer: 58 / 360 },
  magentas: { center: 300 / 360, inner: 24 / 360, outer: 54 / 360 },
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b)
  return d > 0.5 ? 1 - d : d
}

function hueRangeMask(h: number, s: number, range: HueRange) {
  if (range === "master") return 1
  if (s < 0.015) return 0
  const r = HUE_RANGES[range]
  const d = hueDistance(h, r.center)
  if (d <= r.inner) return 1
  if (d >= r.outer) return 0
  return 1 - (d - r.inner) / Math.max(0.0001, r.outer - r.inner)
}

function hueSaturation(
  src: ImageData,
  hueShift: number,
  satShift: number,
  lightShift: number,
  range: HueRange = "master",
  colorize = false,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  // Hue is normalised to [0, 1). Without the second `% 360` a hueShift of 0
  // produces 360/360 = 1.0 which lies outside the valid range and
  // mis-renders red as the very next adjacent hue when colorize is on.
  const targetHue = (((hueShift % 360) + 360) % 360) / 360
  for (let i = 0; i < out.length; i += 4) {
    const before = rgbToHsl(out[i], out[i + 1], out[i + 2])
    const mask = colorize ? 1 : hueRangeMask(before.h, before.s, range)
    if (mask <= 0) continue
    let nh = colorize ? targetHue : before.h + hueShift / 360
    nh = nh - Math.floor(nh)
    const satDelta = satShift / 100
    const lightDelta = lightShift / 100
    const ns = colorize
      ? clamp01((satShift + 100) / 200)
      : satDelta >= 0
        ? before.s + (1 - before.s) * satDelta
        : before.s * (1 + satDelta)
    const nl = lightDelta >= 0
      ? before.l + (1 - before.l) * lightDelta
      : before.l * (1 + lightDelta)
    const adjusted = hslToRgb(nh, clamp01(ns), clamp01(nl))
    out[i] = clamp8(out[i] + (adjusted.r - out[i]) * mask)
    out[i + 1] = clamp8(out[i + 1] + (adjusted.g - out[i + 1]) * mask)
    out[i + 2] = clamp8(out[i + 2] + (adjusted.b - out[i + 2]) * mask)
  }
  return new ImageData(out, src.width, src.height)
}

function levels(
  src: ImageData,
  inputBlack: number,
  inputWhite: number,
  gamma: number,
  outputBlack: number,
  outputWhite: number,
  channel = "rgb",
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const range = Math.max(1, inputWhite - inputBlack)
  const g = 1 / Math.max(0.01, gamma)
  const channels = channel === "red" ? [0] : channel === "green" ? [1] : channel === "blue" ? [2] : [0, 1, 2]
  for (let i = 0; i < out.length; i += 4) {
    for (const k of channels) {
      let v = (out[i + k] - inputBlack) / range
      v = clamp01(v)
      v = Math.pow(v, g)
      v = v * (outputWhite - outputBlack) + outputBlack
      out[i + k] = clamp8(v)
    }
  }
  return new ImageData(out, src.width, src.height)
}

function invert(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]
    out[i + 1] = 255 - out[i + 1]
    out[i + 2] = 255 - out[i + 2]
  }
  return new ImageData(out, src.width, src.height)
}

function grayscale(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const v = clamp8(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2])
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
  }
  return new ImageData(out, src.width, src.height)
}

function _blackWhite(src: ImageData, reds: number, yellows: number, greens: number, cyans: number, blues: number, magentas: number): ImageData {
  // Black & White adjustment with channel mixing controls
  // Parameters are in range -100 to 100, representing percentage shift from default mix
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] / 255
    const g = out[i + 1] / 255
    const b = out[i + 2] / 255

    // Convert to HSL to work with hue
    const { h, l } = rgbToHsl(r, g, b)

    // Start with base luminance
    let lightness = l

    // Apply adjustments based on hue ranges
    // Normalize hue to 0-1 range
    const hue = h

    // Red range (0-30Â° and 330-360Â°)
    if (hue < 0.083 || hue > 0.917) {
      lightness += (reds / 100) * 0.3 // Scale factor for subtle adjustment
    }
    // Yellow range (30-90Â°)
    else if (hue >= 0.083 && hue < 0.25) {
      lightness += (yellows / 100) * 0.3
    }
    // Green range (90-150Â°)
    else if (hue >= 0.25 && hue < 0.417) {
      lightness += (greens / 100) * 0.3
    }
    // Cyan range (150-210Â°)
    else if (hue >= 0.417 && hue < 0.583) {
      lightness += (cyans / 100) * 0.3
    }
    // Blue range (210-270Â°)
    else if (hue >= 0.583 && hue < 0.75) {
      lightness += (blues / 100) * 0.3
    }
    // Magenta range (270-330Â°)
    else if (hue >= 0.75 && hue < 0.917) {
      lightness += (magentas / 100) * 0.3
    }

    // Clamp lightness to valid range
    lightness = Math.max(0, Math.min(1, lightness))

    // Convert back to RGB with zero saturation (true grayscale)
    const { r: nr, g: ng, b: nb } = hslToRgb(hue, 0, lightness)

    out[i] = nr * 255
    out[i + 1] = ng * 255
    out[i + 2] = nb * 255
  }

  return new ImageData(out, src.width, src.height)
}

function sepia(src: ImageData, amount: number): ImageData {
  const a = amount / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const tr = 0.393 * r + 0.769 * g + 0.189 * b
    const tg = 0.349 * r + 0.686 * g + 0.168 * b
    const tb = 0.272 * r + 0.534 * g + 0.131 * b
    out[i] = clamp8(r + (tr - r) * a)
    out[i + 1] = clamp8(g + (tg - g) * a)
    out[i + 2] = clamp8(b + (tb - b) * a)
  }
  return new ImageData(out, src.width, src.height)
}

function channelValue(data: Uint8ClampedArray, i: number, channel: string) {
  switch (channel) {
    case "red":
      return data[i]
    case "green":
      return data[i + 1]
    case "blue":
      return data[i + 2]
    case "alpha":
      return data[i + 3]
    default:
      return luma(data[i], data[i + 1], data[i + 2])
  }
}

function threshold(src: ImageData, level: number, channel = "rgb", invert = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const value = channelValue(out, i, channel)
    const v = (value >= level) !== invert ? 255 : 0
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
  }
  return new ImageData(out, src.width, src.height)
}

function posterize(src: ImageData, levels: number, dither = false): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const count = Math.max(2, Math.min(256, Math.round(levels)))
  const step = 255 / Math.max(1, count - 1)
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    const noise = dither ? (pseudoDither(p) - 0.5) * step : 0
    out[i] = Math.round(clamp8(out[i] + noise) / step) * step
    out[i + 1] = Math.round(clamp8(out[i + 1] + noise) / step) * step
    out[i + 2] = Math.round(clamp8(out[i + 2] + noise) / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

function _curves(
  src: ImageData,
  shadow: number,
  midtone: number,
  highlight: number,
): ImageData {
  // Build a 256-entry LUT from 3 control points: (0,shadow), (128,midtone), (255,highlight)
  const lut = new Uint8ClampedArray(256)
  // Quadratic Bezier-ish blend through 3 points
  const cs = clamp8(shadow)
  const cm = clamp8(midtone)
  const ch = clamp8(highlight)
  for (let i = 0; i < 256; i++) {
    let v: number
    if (i <= 128) {
      const t = i / 128
      // Bezier between (0, cs) and (128, cm)
      v = (1 - t) * (1 - t) * cs + 2 * (1 - t) * t * ((cs + cm) / 2 + (cm - cs) * 0.1) + t * t * cm
    } else {
      const t = (i - 128) / 127
      v = (1 - t) * (1 - t) * cm + 2 * (1 - t) * t * ((cm + ch) / 2 + (ch - cm) * 0.1) + t * t * ch
    }
    lut[i] = clamp8(v)
  }
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = lut[out[i]]
    out[i + 1] = lut[out[i + 1]]
    out[i + 2] = lut[out[i + 2]]
  }
  return new ImageData(out, src.width, src.height)
}

function _colorBalance(
  src: ImageData,
  cyanRed: number,
  magentaGreen: number,
  yellowBlue: number,
): ImageData {
  // values in -100..100; positive shifts toward Red/Green/Blue, negative the opposite
  const cr = cyanRed / 100
  const mg = magentaGreen / 100
  const yb = yellowBlue / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] + cr * 60)
    out[i + 1] = clamp8(out[i + 1] + mg * 60)
    out[i + 2] = clamp8(out[i + 2] + yb * 60)
  }
  return new ImageData(out, src.width, src.height)
}

function photoFilter(src: ImageData, color: string, density: number): ImageData {
  // tint the image toward `color`, density 0..100
  let r = 240
  let g = 130
  let b = 60
  if (color === "blue") {
    r = 60
    g = 100
    b = 200
  } else if (color === "green") {
    r = 90
    g = 200
    b = 110
  } else if (color === "magenta") {
    r = 220
    g = 80
    b = 200
  } else if (color === "cyan") {
    r = 80
    g = 200
    b = 220
  } else if (color === "yellow") {
    r = 245
    g = 230
    b = 100
  }
  const a = density / 100
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] * (1 - a) + r * a)
    out[i + 1] = clamp8(out[i + 1] * (1 - a) + g * a)
    out[i + 2] = clamp8(out[i + 2] * (1 - a) + b * a)
  }
  return new ImageData(out, src.width, src.height)
}

function channelMixer(
  src: ImageData,
  rR: number,
  rG: number,
  rB: number,
  gR: number,
  gG: number,
  gB: number,
  bR: number,
  bG: number,
  bB: number,
  extra: Partial<ChannelMixerParams> = {},
): ImageData {
  return applyChannelMixerToImageData(src, {
    rR,
    rG,
    rB,
    gR,
    gG,
    gB,
    bR,
    bG,
    bB,
    ...extra,
  })
}

function _vibrance(src: ImageData, amount: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const a = amount / 100
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const max = Math.max(r, g, b)
    const avg = (r + g + b) / 3
    const amt = (((Math.abs(max - avg) * 2) / 255) * a) | 0
    if (r !== max) out[i] = clamp8(r + ((max - r) * amt) / 100)
    if (g !== max) out[i + 1] = clamp8(g + ((max - g) * amt) / 100)
    if (b !== max) out[i + 2] = clamp8(b + ((max - b) * amt) / 100)
  }
  return new ImageData(out, src.width, src.height)
}

function exposure(src: ImageData, ev: number): ImageData {
  const factor = Math.pow(2, ev)
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] * factor)
    out[i + 1] = clamp8(out[i + 1] * factor)
    out[i + 2] = clamp8(out[i + 2] * factor)
  }
  return new ImageData(out, src.width, src.height)
}

function desaturate(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const luma = (max + min) / 2
    out[i] = luma
    out[i + 1] = luma
    out[i + 2] = luma
  }
  return new ImageData(out, src.width, src.height)
}

/**
 * Equalize — histogram equalization.
 *
 *   mode "image"           : build histogram from the entire image, apply to all pixels.
 *   mode "selection-only"  : build & apply only inside selectionMask > 0.
 *   mode "selection-source": build histogram from selectionMask > 0 but apply to the
 *                            whole image (Photoshop's "Equalize entire image based on
 *                            selected area").
 *
 *   selectionMask: a Uint8Array (one byte per pixel) the same size as the image.
 *                  Bytes > 0 are "inside" the selection.
 */
function equalize(
  src: ImageData,
  mode: "image" | "selection-only" | "selection-source" = "image",
  selectionMask: Uint8Array | null = null,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const pixelCount = src.width * src.height
  const histogram = new Array(256).fill(0)

  // Build histogram (either from selection or entire image, per mode).
  const usingSelection = (mode === "selection-only" || mode === "selection-source") && selectionMask && selectionMask.length >= pixelCount
  let histTotal = 0
  for (let p = 0; p < pixelCount; p++) {
    if (usingSelection && selectionMask![p] === 0) continue
    const i = p * 4
    const Y = Math.round(luma(out[i], out[i + 1], out[i + 2]))
    histogram[Math.max(0, Math.min(255, Y))]++
    histTotal++
  }
  if (histTotal === 0) {
    // Empty selection — fall back to the whole image so we never produce an
    // all-black result, but still honor "selection-only" by skipping apply.
    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4
      const Y = Math.round(luma(out[i], out[i + 1], out[i + 2]))
      histogram[Math.max(0, Math.min(255, Y))]++
    }
    histTotal = pixelCount
  }

  const cdf = new Array(256).fill(0)
  let sum = 0
  for (let i = 0; i < 256; i++) {
    sum += histogram[i]
    cdf[i] = Math.round((sum / histTotal) * 255)
  }

  // Apply — preserves chroma by scaling RGB uniformly by newY/Y.
  for (let p = 0; p < pixelCount; p++) {
    if (mode === "selection-only" && usingSelection && selectionMask![p] === 0) continue
    const i = p * 4
    const Y = Math.round(luma(out[i], out[i + 1], out[i + 2]))
    const newY = cdf[Math.max(0, Math.min(255, Y))]
    if (Y === 0) {
      out[i] = newY
      out[i + 1] = newY
      out[i + 2] = newY
    } else {
      const k = newY / Y
      out[i] = clamp8(out[i] * k)
      out[i + 1] = clamp8(out[i + 1] * k)
      out[i + 2] = clamp8(out[i + 2] * k)
    }
  }

  return new ImageData(out, src.width, src.height)
}

export interface ReplaceColorSample {
  r: number
  g: number
  b: number
}

/**
 * Replace Color — Photoshop-style.
 *   - includeSamples / excludeSamples: lists of RGB colors. The selection
 *     mask is the union of color similarity around each include sample minus
 *     the union of similarity around each exclude sample.
 *   - fuzziness: 0..200, distance in RGB space (~ sqrt(3*255²) = 442 max).
 *   - localizedClusters: when true, fuzziness is weighted by RGB Euclidean
 *     distance not hue alone, so samples form tight clusters and a far-away
 *     pixel with the same hue but very different brightness isn't grabbed.
 *   - replacementHue/Sat/Light: full HSL transform on the matched pixels.
 *   - resultColor: optional explicit replacement RGB — when present, the
 *     output of the matched zone is interpolated toward this color (the
 *     Photoshop "Result" swatch behavior).
 */
function replaceColor(
  src: ImageData,
  includeSamples: ReplaceColorSample[],
  excludeSamples: ReplaceColorSample[],
  fuzziness: number,
  localizedClusters: boolean,
  replacementHue: number,
  replacementSaturation: number,
  replacementLightness: number,
  resultColor: ReplaceColorSample | null,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const fuzz = Math.max(0, Math.min(200, fuzziness))
  // Larger fuzziness => bigger search radius. We normalize so that 50 ~ a hue
  // distance of 1/6 (one color band) or an RGB distance of ~80.
  const hueRange = Math.max(0.001, fuzz / 360)
  const rgbRange = Math.max(1, fuzz * 2.2)
  const satShift = replacementSaturation / 100
  const lightShift = replacementLightness / 100
  const replHue = (((replacementHue % 360) + 360) % 360) / 360
  const hasInclude = includeSamples.length > 0
  if (!hasInclude && !resultColor) return new ImageData(out, src.width, src.height)

  // Precompute sample HSL.
  const includeHsl = includeSamples.map((s) => ({ ...rgbToHsl(s.r, s.g, s.b), rgb: s }))
  const excludeHsl = excludeSamples.map((s) => ({ ...rgbToHsl(s.r, s.g, s.b), rgb: s }))

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2]
    const { h, s, l } = rgbToHsl(r, g, b)

    let inMask = 0
    for (const sample of includeHsl) {
      if (localizedClusters) {
        const dr = r - sample.rgb.r
        const dg = g - sample.rgb.g
        const db = b - sample.rgb.b
        const d = Math.sqrt(dr * dr + dg * dg + db * db)
        const mask = clamp01(1 - d / rgbRange)
        if (mask > inMask) inMask = mask
      } else {
        const d = hueDistance(h, sample.h)
        const mask = clamp01(1 - d / hueRange)
        if (mask > inMask) inMask = mask
      }
    }
    if (inMask <= 0) continue

    let outMask = 0
    for (const sample of excludeHsl) {
      if (localizedClusters) {
        const dr = r - sample.rgb.r
        const dg = g - sample.rgb.g
        const db = b - sample.rgb.b
        const d = Math.sqrt(dr * dr + dg * dg + db * db)
        outMask = Math.max(outMask, clamp01(1 - d / rgbRange))
      } else {
        const d = hueDistance(h, sample.h)
        outMask = Math.max(outMask, clamp01(1 - d / hueRange))
      }
    }
    const mask = clamp01(inMask - outMask)
    if (mask <= 0) continue

    if (resultColor) {
      // Interpolate toward the explicit result color in RGB.
      out[i] = clamp8(r + (resultColor.r - r) * mask)
      out[i + 1] = clamp8(g + (resultColor.g - g) * mask)
      out[i + 2] = clamp8(b + (resultColor.b - b) * mask)
      continue
    }

    const nextS = clamp01(s + satShift * mask)
    const nextL = clamp01(l + lightShift * mask)
    const targetHue = h + ((replHue - h) % 1) * mask
    const { r: rr, g: gg, b: bb } = hslToRgb(targetHue, nextS, nextL)
    out[i] = clamp8(rr)
    out[i + 1] = clamp8(gg)
    out[i + 2] = clamp8(bb)
  }
  return new ImageData(out, src.width, src.height)
}

/** Parse a "r,g,b;r,g,b" sample list. */
export function parseReplaceColorSamples(value: string): ReplaceColorSample[] {
  if (!value) return []
  const out: ReplaceColorSample[] = []
  for (const entry of value.split(";")) {
    const parts = entry.split(",").map((n) => Number(n))
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
      out.push({ r: parts[0], g: parts[1], b: parts[2] })
    }
  }
  return out
}

export function formatReplaceColorSamples(samples: ReplaceColorSample[]): string {
  return samples.map((s) => `${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)}`).join(";")
}

function _matchColor(src: ImageData): ImageData {
  // Simple implementation: normalize visible pixels to luminance.
  const out = new Uint8ClampedArray(src.data)
  let count = 0

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] > 0) { // Non-transparent pixels
      count++
    }
  }

  if (count === 0) return new ImageData(out, src.width, src.height)

  // Convert to grayscale based on luminance
  for (let i = 0; i < out.length; i += 4) {
    const gray = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    out[i] = gray
    out[i + 1] = gray
    out[i + 2] = gray
  }

  return new ImageData(out, src.width, src.height)
}

function selectiveColor(
  src: ImageData,
  range: string,
  cyan: number,
  magenta: number,
  yellow: number,
  black: number,
  method: string,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const relative = method !== "absolute"

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const { h, s, l } = rgbToHsl(r, g, b)
    const mask = selectiveColorMask(range, h, s, l)
    if (mask <= 0) continue

    const c = 1 - r / 255
    const m = 1 - g / 255
    const y = 1 - b / 255
    const k = Math.min(c, m, y)
    const scale = relative ? mask : mask * 0.65
    const nextC = clamp01(c + (cyan / 100) * scale * (relative ? Math.max(0.08, 1 - c) : 1))
    const nextM = clamp01(m + (magenta / 100) * scale * (relative ? Math.max(0.08, 1 - m) : 1))
    const nextY = clamp01(y + (yellow / 100) * scale * (relative ? Math.max(0.08, 1 - y) : 1))
    const nextK = clamp01(k + (black / 100) * scale * (relative ? Math.max(0.08, 1 - k) : 1))

    out[i] = clamp8((1 - Math.min(1, nextC + nextK * 0.7)) * 255)
    out[i + 1] = clamp8((1 - Math.min(1, nextM + nextK * 0.7)) * 255)
    out[i + 2] = clamp8((1 - Math.min(1, nextY + nextK * 0.7)) * 255)
  }

  return new ImageData(out, src.width, src.height)
}

function selectiveColorMask(range: string, h: number, s: number, l: number) {
  if (range === "whites") return clamp01((l - 0.72) / 0.22)
  if (range === "neutrals") return clamp01(1 - Math.abs(l - 0.5) / 0.34) * clamp01(1 - Math.max(0, s - 0.5))
  if (range === "blacks") return clamp01((0.30 - l) / 0.24)
  const centers: Record<string, number> = {
    reds: 0,
    yellows: 1 / 6,
    greens: 1 / 3,
    cyans: 0.5,
    blues: 2 / 3,
    magentas: 5 / 6,
  }
  const center = centers[range] ?? 0
  return clamp01(1 - hueDistance(h, center) / (1 / 9)) * clamp01(s * 1.6)
}

/**
 * Shadows/Highlights — local-contrast preserving lightening of shadow regions
 * and darkening of highlight regions, with full Photoshop-style controls.
 *
 *   shadowsAmount   0..100   how much to lighten dark areas
 *   shadowsTonalWidth 0..100 how far up the tonal scale the shadow mask reaches
 *   shadowsRadius   0..250   blur radius used to build the *local* tonal mask
 *                            (preserves local contrast — the lift is gated by
 *                             the blurred luminance, not the per-pixel value)
 *   highlightsAmount    0..100  how much to recover bright areas
 *   highlightsTonalWidth 0..100 how far down the tonal scale highlight mask reaches
 *   highlightsRadius     0..250 blur radius used to build the highlight mask
 *   colorCorrection -100..100  saturate (positive) or desaturate (negative)
 *                              the regions that got lifted/recovered
 *   midtoneContrast -100..100  S-curve in the midtones to keep crunch
 *   blackClip   0..50 %    re-clip the darkest blackClip% to true black
 *   whiteClip   0..50 %    re-clip the lightest whiteClip% to pure white
 */
function shadowsHighlights(
  src: ImageData,
  shadowsAmount: number,
  shadowsTonalWidth: number,
  shadowsRadius: number,
  highlightsAmount: number,
  highlightsTonalWidth: number,
  highlightsRadius: number,
  colorCorrection: number,
  midtoneContrast: number,
  blackClip: number,
  whiteClip: number,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const w = src.width
  const h = src.height

  const shAmt = Math.max(0, Math.min(100, shadowsAmount)) / 100
  const shWidth = Math.max(0.01, Math.min(1, shadowsTonalWidth / 100))
  const hiAmt = Math.max(0, Math.min(100, highlightsAmount)) / 100
  const hiWidth = Math.max(0.01, Math.min(1, highlightsTonalWidth / 100))
  const colorK = Math.max(-100, Math.min(100, colorCorrection)) / 100
  const midK = Math.max(-100, Math.min(100, midtoneContrast)) / 100

  const shRadius = Math.max(0, Math.min(250, shadowsRadius))
  const hiRadius = Math.max(0, Math.min(250, highlightsRadius))
  // Build (optionally two) blurred copies for the tonal masks. The blur radius
  // is what gives "local contrast preserving" behavior: a small dark feature
  // sitting inside a bright neighborhood will be left alone because the
  // *local* mean is bright, so the shadow mask there is zero.
  const shadowsBlur =
    shRadius > 0 ? gaussianBlur(src, Math.min(64, shRadius)) : src
  const highlightsBlur =
    hiRadius > 0 && hiRadius !== shRadius ? gaussianBlur(src, Math.min(64, hiRadius)) : shadowsBlur

  // Optional clipping thresholds (Photoshop's Black/White Clip act on the
  // result histogram). We just do a soft remap after the tonal correction.
  const blackClipT = clamp01(Math.max(0, Math.min(50, blackClip)) / 100)
  const whiteClipT = 1 - clamp01(Math.max(0, Math.min(50, whiteClip)) / 100)
  const clipRange = Math.max(0.001, whiteClipT - blackClipT)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = out[i]
      const g = out[i + 1]
      const b = out[i + 2]
      // Local luminance from the blurred copy — preserves local contrast.
      const shLumLocal = luma(
        shadowsBlur.data[i],
        shadowsBlur.data[i + 1],
        shadowsBlur.data[i + 2],
      ) / 255
      const hiLumLocal = luma(
        highlightsBlur.data[i],
        highlightsBlur.data[i + 1],
        highlightsBlur.data[i + 2],
      ) / 255

      // Smoothstep tonal masks: 1 deep in the shadow band, fading to 0 at the
      // edge of the tonal-width window.
      const shadowMask = smoothstep(shWidth, 0, shLumLocal)
      const highlightMask = smoothstep(1 - hiWidth, 1, hiLumLocal)

      const pixelLum = luma(r, g, b) / 255
      // Shadow lift: lift = amount * mask, applied so that midtones near the
      // mask edge get a smaller push (this is the bit that makes the result
      // look natural instead of like a brightness slap).
      // The lift is anchored to (1 - pixelLum) so blacks don't clip.
      const lift = shAmt * shadowMask
      // Highlight recover: a downward pull anchored at pixelLum so whites
      // don't push past 1.
      const recover = hiAmt * highlightMask

      // Apply lift / recover per channel. Using (1-v) keeps shadow lift from
      // burning highlights and using v keeps highlight recover from killing
      // shadows.
      let nr = (r / 255) + (1 - r / 255) * lift * 0.85 - (r / 255) * recover * 0.55
      let ng = (g / 255) + (1 - g / 255) * lift * 0.85 - (g / 255) * recover * 0.55
      let nb = (b / 255) + (1 - b / 255) * lift * 0.85 - (b / 255) * recover * 0.55

      // Midtone contrast (S-curve centered at 0.5). Strength scales with
      // distance from the affected zones so we don't double-process them.
      if (midK !== 0) {
        const midMask = 1 - Math.max(shadowMask, highlightMask) * 0.7
        const t = midK * 0.6 * midMask
        nr = applyMidContrast(nr, t)
        ng = applyMidContrast(ng, t)
        nb = applyMidContrast(nb, t)
      }

      // Color Correction: pull saturation in the regions that got moved.
      // Positive => boost saturation, negative => desaturate. This is what
      // Photoshop calls "Color" / "Color Correction" — it stops shadow lift
      // from looking gray.
      if (colorK !== 0) {
        const correctMask = Math.max(shadowMask, highlightMask)
        const grayN = nr * 0.299 + ng * 0.587 + nb * 0.114
        const sat = 1 + colorK * 0.45 * correctMask
        nr = grayN + (nr - grayN) * sat
        ng = grayN + (ng - grayN) * sat
        nb = grayN + (nb - grayN) * sat
      }

      // Clipping pass: stretch [blackClipT .. whiteClipT] back to [0..1].
      if (blackClipT > 0 || whiteClipT < 1) {
        nr = (nr - blackClipT) / clipRange
        ng = (ng - blackClipT) / clipRange
        nb = (nb - blackClipT) / clipRange
      }

      // pixelLum is read above to keep the algorithm easy to extend; suppress
      // the unused-var lint without changing observed behavior.
      void pixelLum

      out[i] = clamp8(nr * 255)
      out[i + 1] = clamp8(ng * 255)
      out[i + 2] = clamp8(nb * 255)
    }
  }

  return new ImageData(out, w, h)
}

function smoothstep(edge0: number, edge1: number, x: number) {
  if (edge0 === edge1) return x < edge0 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function applyMidContrast(v: number, k: number) {
  // S-curve around 0.5. k in [-0.6 .. 0.6] gives a gentle Photoshop-like push.
  const c = v - 0.5
  return clamp01(0.5 + c + k * Math.sin(c * Math.PI))
}

/**
 * HDR Toning — four methods, matching Photoshop's UI:
 *
 *   "exposure-gamma": global Exposure (stops) + Gamma curve. Useful when an
 *                     image already fits the display range.
 *   "highlight-compression": pull highlights down without touching the rest
 *                            of the curve, like a soft clip.
 *   "equalize-histogram":   spread the histogram, similar to Image > Adjustments
 *                           > Equalize but for the full local-adaptation result.
 *   "local-adaptation":     the full HDR Toning behavior — Radius / Strength /
 *                           Edge Glow + Tone & Detail (Gamma, Exposure, Detail)
 *                           + Advanced (Shadow, Highlight, Vibrance, Saturation)
 *                           + optional Toning Curve.
 *
 * All four methods read the same param record so a preset can switch between
 * them without losing the user's other tweaks.
 */
function hdrToning(
  src: ImageData,
  method: string,
  radius: number,
  strength: number,
  edgeGlow: number,
  gamma: number,
  exposureEv: number,
  detail: number,
  shadow: number,
  highlight: number,
  vibrance: number,
  saturation: number,
  toningCurve: [number, number][] | null,
): ImageData {
  const w = src.width
  const h = src.height
  const out = new Uint8ClampedArray(src.data)

  if (method === "exposure-gamma") {
    const factor = Math.pow(2, exposureEv)
    const g = Math.max(0.05, gamma)
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = clamp01((out[i + c] / 255) * factor)
        out[i + c] = clamp8(Math.pow(v, 1 / g) * 255)
      }
    }
    return new ImageData(out, w, h)
  }

  if (method === "highlight-compression") {
    // Soft knee compressing the top of the range. Keeps midtones intact.
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = out[i + c] / 255
        // Reinhard-style compression with knee = 0.6
        const compressed = v < 0.6 ? v : 0.6 + (v - 0.6) / (1 + (v - 0.6) * 2)
        out[i + c] = clamp8(compressed * 255)
      }
    }
    return new ImageData(out, w, h)
  }

  if (method === "equalize-histogram") {
    // Per-channel equalization using a CDF derived from luminance, so we
    // don't desaturate the image the way per-channel equalize does.
    const histogram = new Array(256).fill(0)
    for (let i = 0; i < out.length; i += 4) {
      histogram[Math.round(luma(out[i], out[i + 1], out[i + 2]))]++
    }
    const cdf = new Array(256).fill(0)
    let sum = 0
    const total = w * h
    for (let i = 0; i < 256; i++) {
      sum += histogram[i]
      cdf[i] = sum / total
    }
    for (let i = 0; i < out.length; i += 4) {
      const Y = luma(out[i], out[i + 1], out[i + 2])
      const newY = clamp01(cdf[Math.round(Y)]) * 255
      const k = (newY + 0.001) / (Y + 0.001)
      out[i] = clamp8(out[i] * k)
      out[i + 1] = clamp8(out[i + 1] * k)
      out[i + 2] = clamp8(out[i + 2] * k)
    }
    return new ImageData(out, w, h)
  }

  // ---- Local Adaptation ----
  const r = Math.max(0, Math.min(250, radius))
  const big = r > 0 ? gaussianBlur(src, Math.min(64, r)) : src
  // "Edge Glow" widens the radius slightly for a halo control. Bigger glow
  // => more visible halo near edges.
  const glow = Math.max(0, Math.min(100, edgeGlow)) / 100
  const haloR = Math.min(64, r * (1 + glow * 0.6))
  const halo = haloR > 0 && haloR !== r ? gaussianBlur(src, haloR) : big

  const sAmt = Math.max(0, Math.min(200, strength)) / 100
  const dAmt = Math.max(-100, Math.min(100, detail)) / 100
  const gPow = 1 / Math.max(0.05, gamma)
  const expFactor = Math.pow(2, exposureEv)
  const shadowAmt = Math.max(-100, Math.min(100, shadow)) / 100
  const highlightAmt = Math.max(-100, Math.min(100, highlight)) / 100
  const vibAmt = Math.max(-100, Math.min(100, vibrance)) / 100
  const satAmt = Math.max(-100, Math.min(100, saturation)) / 100
  const lut = toningCurve && toningCurve.length >= 2 ? monotoneCurveLut(toningCurve) : null

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r0 = out[i]
      const g0 = out[i + 1]
      const b0 = out[i + 2]

      // Local mean & highpass detail.
      const br = big.data[i], bg = big.data[i + 1], bb = big.data[i + 2]
      const hr = halo.data[i], hg = halo.data[i + 1], hb = halo.data[i + 2]
      const halor = hr, halog = hg, halob = hb

      let nr = (r0 - br) * sAmt + br
      let ng = (g0 - bg) * sAmt + bg
      let nb = (b0 - bb) * sAmt + bb

      // Detail (high-frequency boost using big - halo difference).
      if (dAmt !== 0) {
        nr += (br - halor) * dAmt
        ng += (bg - halog) * dAmt
        nb += (bb - halob) * dAmt
      }

      // Exposure + gamma on the result.
      nr = Math.pow(clamp01((nr * expFactor) / 255), gPow) * 255
      ng = Math.pow(clamp01((ng * expFactor) / 255), gPow) * 255
      nb = Math.pow(clamp01((nb * expFactor) / 255), gPow) * 255

      // Shadow / Highlight per-region pushes, using local luminance.
      const localL = luma(br, bg, bb) / 255
      const shMask = clamp01(0.5 - localL) * 2 // 1 at black, 0 at midgray
      const hiMask = clamp01(localL - 0.5) * 2 // 1 at white, 0 at midgray
      const shPush = shadowAmt * shMask
      const hiPush = highlightAmt * hiMask
      nr += shPush * (255 - nr) * 0.55 - hiPush * nr * 0.55
      ng += shPush * (255 - ng) * 0.55 - hiPush * ng * 0.55
      nb += shPush * (255 - nb) * 0.55 - hiPush * nb * 0.55

      // Saturation + Vibrance (vibrance is saturation weighted by 1 - current
      // saturation so skin tones don't over-saturate).
      if (satAmt !== 0 || vibAmt !== 0) {
        const gray = nr * 0.299 + ng * 0.587 + nb * 0.114
        const maxC = Math.max(nr, ng, nb)
        const minC = Math.min(nr, ng, nb)
        const currentSat = maxC > 0 ? (maxC - minC) / maxC : 0
        const vibK = vibAmt * (1 - currentSat)
        const k = 1 + satAmt + vibK
        nr = gray + (nr - gray) * k
        ng = gray + (ng - gray) * k
        nb = gray + (nb - gray) * k
      }

      // Optional toning curve on luminance.
      if (lut) {
        const Y = clamp8(luma(nr, ng, nb))
        const newY = lut[Math.round(Y)]
        const kk = (newY + 0.001) / (Y + 0.001)
        nr *= kk
        ng *= kk
        nb *= kk
      }

      out[i] = clamp8(nr)
      out[i + 1] = clamp8(ng)
      out[i + 2] = clamp8(nb)
    }
  }
  return new ImageData(out, w, h)
}

export interface HdrToningPreset {
  method: string
  radius: number
  strength: number
  edgeGlow: number
  gamma: number
  exposureEv: number
  detail: number
  shadow: number
  highlight: number
  vibrance: number
  saturation: number
  toningCurve: string
}

/** Photoshop-style HDR Toning presets. */
export const HDR_TONING_PRESETS: Record<string, HdrToningPreset> = {
  default: {
    method: "local-adaptation",
    radius: 60,
    strength: 100,
    edgeGlow: 30,
    gamma: 1.0,
    exposureEv: 0,
    detail: 0,
    shadow: 0,
    highlight: 0,
    vibrance: 0,
    saturation: 0,
    toningCurve: "0,0;255,255",
  },
  monochromatic: {
    method: "local-adaptation",
    radius: 60,
    strength: 80,
    edgeGlow: 50,
    gamma: 1.0,
    exposureEv: 0,
    detail: 20,
    shadow: 10,
    highlight: -10,
    vibrance: 0,
    saturation: -100,
    toningCurve: "0,0;128,140;255,250",
  },
  "more-saturated": {
    method: "local-adaptation",
    radius: 80,
    strength: 100,
    edgeGlow: 40,
    gamma: 1.0,
    exposureEv: 0.1,
    detail: 30,
    shadow: 0,
    highlight: 0,
    vibrance: 60,
    saturation: 40,
    toningCurve: "0,0;255,255",
  },
  photorealistic: {
    method: "local-adaptation",
    radius: 100,
    strength: 90,
    edgeGlow: 20,
    gamma: 1.05,
    exposureEv: 0,
    detail: 10,
    shadow: 15,
    highlight: -10,
    vibrance: 25,
    saturation: 0,
    toningCurve: "0,4;64,60;128,128;192,200;255,250",
  },
  surrealistic: {
    method: "local-adaptation",
    radius: 30,
    strength: 180,
    edgeGlow: 80,
    gamma: 0.85,
    exposureEv: 0.4,
    detail: 60,
    shadow: 40,
    highlight: -40,
    vibrance: 80,
    saturation: 30,
    toningCurve: "0,10;64,90;128,160;192,220;255,255",
  },
  "highlight-compression": {
    method: "highlight-compression",
    radius: 0,
    strength: 100,
    edgeGlow: 0,
    gamma: 1.0,
    exposureEv: 0,
    detail: 0,
    shadow: 0,
    highlight: 0,
    vibrance: 0,
    saturation: 0,
    toningCurve: "0,0;255,255",
  },
  "equalize-histogram": {
    method: "equalize-histogram",
    radius: 0,
    strength: 100,
    edgeGlow: 0,
    gamma: 1.0,
    exposureEv: 0,
    detail: 0,
    shadow: 0,
    highlight: 0,
    vibrance: 0,
    saturation: 0,
    toningCurve: "0,0;255,255",
  },
}

/* ============================================================
 *  Auto Tone / Auto Contrast / Auto Color
 *  Photoshop's "Options" dialog covers four algorithms × a few clipping knobs.
 *  Implementations here are deterministic and avoid any heuristic that can't
 *  be reproduced by a downstream test.
 * ============================================================ */

export type AutoAlgorithm =
  | "monochromatic-contrast"  // Auto Contrast — stretch luminance, RGB locked
  | "per-channel-contrast"    // Auto Tone — stretch each channel independently
  | "dark-light-colors"       // Auto Color — find darkest/lightest pixels, map them
  | "brightness-contrast"     // Auto Brightness & Contrast — gentle stretch + S-curve

export interface AutoOptions {
  algorithm: AutoAlgorithm
  shadowsClipPct: number            // 0..50 — % of pixels to clip to black
  highlightsClipPct: number         // 0..50 — % of pixels to clip to white
  midtoneTargetRgb: { r: number; g: number; b: number }   // target color for midtones (gray balance)
  shadowsTargetRgb: { r: number; g: number; b: number }
  highlightsTargetRgb: { r: number; g: number; b: number }
  snapNeutralMidtones: boolean      // remove a color cast detected at the midtone
}

export const AUTO_DEFAULTS: AutoOptions = {
  algorithm: "per-channel-contrast",
  shadowsClipPct: 0.1,
  highlightsClipPct: 0.1,
  shadowsTargetRgb: { r: 0, g: 0, b: 0 },
  midtoneTargetRgb: { r: 128, g: 128, b: 128 },
  highlightsTargetRgb: { r: 255, g: 255, b: 255 },
  snapNeutralMidtones: true,
}

interface ChannelHist {
  black: number
  white: number
  median: number
}

function channelHistogram(src: ImageData, channel: 0 | 1 | 2, lowClipPct: number, highClipPct: number): ChannelHist {
  const hist = new Array(256).fill(0)
  let total = 0
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    hist[src.data[i + channel]]++
    total++
  }
  const lowClip = total * (lowClipPct / 100)
  const highClip = total * (highClipPct / 100)
  let acc = 0
  let black = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lowClip) { black = v; break } }
  acc = 0
  let white = 255
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= highClip) { white = v; break } }
  acc = 0
  let median = 128
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total / 2) { median = v; break } }
  return { black, white: Math.max(black + 1, white), median }
}

function luminanceHistogram(src: ImageData, lowClipPct: number, highClipPct: number): ChannelHist {
  const hist = new Array(256).fill(0)
  let total = 0
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    hist[Math.max(0, Math.min(255, Math.round(luma(src.data[i], src.data[i + 1], src.data[i + 2]))))]++
    total++
  }
  const lowClip = total * (lowClipPct / 100)
  const highClip = total * (highClipPct / 100)
  let acc = 0
  let black = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lowClip) { black = v; break } }
  acc = 0
  let white = 255
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= highClip) { white = v; break } }
  acc = 0
  let median = 128
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total / 2) { median = v; break } }
  return { black, white: Math.max(black + 1, white), median }
}

/** Apply the selected Auto algorithm and return a new ImageData. Pure / deterministic. */
export function applyAutoAdjustment(src: ImageData, opts: AutoOptions): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const o = { ...AUTO_DEFAULTS, ...opts }
  switch (o.algorithm) {
    case "monochromatic-contrast": {
      const stats = luminanceHistogram(src, o.shadowsClipPct, o.highlightsClipPct)
      const range = Math.max(1, stats.white - stats.black)
      const sLow = o.shadowsTargetRgb
      const sHi = o.highlightsTargetRgb
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const target = c === 0 ? sLow.r : c === 1 ? sLow.g : sLow.b
          const targetHi = c === 0 ? sHi.r : c === 1 ? sHi.g : sHi.b
          const v = out[i + c]
          const t = clamp01((v - stats.black) / range)
          out[i + c] = clamp8(target + (targetHi - target) * t)
        }
      }
      break
    }
    case "per-channel-contrast": {
      const stats: ChannelHist[] = [0, 1, 2].map((c) => channelHistogram(src, c as 0 | 1 | 2, o.shadowsClipPct, o.highlightsClipPct))
      const sLow = [o.shadowsTargetRgb.r, o.shadowsTargetRgb.g, o.shadowsTargetRgb.b]
      const sHi = [o.highlightsTargetRgb.r, o.highlightsTargetRgb.g, o.highlightsTargetRgb.b]
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const s = stats[c]
          const range = Math.max(1, s.white - s.black)
          const t = clamp01((out[i + c] - s.black) / range)
          out[i + c] = clamp8(sLow[c] + (sHi[c] - sLow[c]) * t)
        }
      }
      if (o.snapNeutralMidtones) snapMidtonesInPlace(out, src.width, src.height, o.midtoneTargetRgb)
      break
    }
    case "dark-light-colors": {
      // Find the darkest and brightest *colors* (not channels), map each to
      // the corresponding target. This is the algorithm Photoshop documents
      // as "Find Dark & Light Colors".
      let darkest = { r: 255, g: 255, b: 255, l: 1 }
      let lightest = { r: 0, g: 0, b: 0, l: 0 }
      for (let i = 0; i < src.data.length; i += 4) {
        if (src.data[i + 3] === 0) continue
        const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2]
        const L = luma(r, g, b) / 255
        if (L < darkest.l) darkest = { r, g, b, l: L }
        if (L > lightest.l) lightest = { r, g, b, l: L }
      }
      const sLow = o.shadowsTargetRgb
      const sHi = o.highlightsTargetRgb
      const gainsLow = [
        (sLow.r - darkest.r) || 0,
        (sLow.g - darkest.g) || 0,
        (sLow.b - darkest.b) || 0,
      ]
      const gainsHi = [
        (sHi.r - lightest.r) || 0,
        (sHi.g - lightest.g) || 0,
        (sHi.b - lightest.b) || 0,
      ]
      for (let i = 0; i < out.length; i += 4) {
        const L = luma(out[i], out[i + 1], out[i + 2]) / 255
        for (let c = 0; c < 3; c++) {
          out[i + c] = clamp8(out[i + c] + gainsLow[c] * (1 - L) + gainsHi[c] * L)
        }
      }
      if (o.snapNeutralMidtones) snapMidtonesInPlace(out, src.width, src.height, o.midtoneTargetRgb)
      break
    }
    case "brightness-contrast": {
      const stats = luminanceHistogram(src, o.shadowsClipPct, o.highlightsClipPct)
      const range = Math.max(1, stats.white - stats.black)
      const targetMid = (o.midtoneTargetRgb.r + o.midtoneTargetRgb.g + o.midtoneTargetRgb.b) / 3
      // Place the histogram median at the target midtone.
      const gamma = Math.log(targetMid / 255) / Math.log(Math.max(0.001, (stats.median - stats.black) / range))
      const safeGamma = Math.max(0.1, Math.min(9.99, Number.isFinite(gamma) ? gamma : 1))
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const t = clamp01((out[i + c] - stats.black) / range)
          out[i + c] = clamp8(Math.pow(t, safeGamma) * 255)
        }
      }
      break
    }
  }
  return new ImageData(out, src.width, src.height)
}

function snapMidtonesInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
) {
  // Walk the (now-corrected) buffer, average the midtone band, and apply a
  // multiplicative correction so the midtone average lands on `target`.
  let sumR = 0, sumG = 0, sumB = 0, count = 0
  const pixels = width * height
  for (let p = 0; p < pixels; p++) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    const L = luma(data[i], data[i + 1], data[i + 2])
    if (L < 64 || L > 192) continue
    sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++
  }
  if (count === 0) return
  const avgR = sumR / count
  const avgG = sumG / count
  const avgB = sumB / count
  const kR = target.r / Math.max(1, avgR)
  const kG = target.g / Math.max(1, avgG)
  const kB = target.b / Math.max(1, avgB)
  for (let p = 0; p < pixels; p++) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    data[i] = clamp8(data[i] * kR)
    data[i + 1] = clamp8(data[i + 1] * kG)
    data[i + 2] = clamp8(data[i + 2] * kB)
  }
}

interface CubeLut {
  size: number
  values: Array<[number, number, number]>
}

function parseCubeLut(value: unknown): CubeLut | null {
  if (typeof value !== "string" || !value.trim()) return null
  let size = 0
  const values: Array<[number, number, number]> = []
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || /^TITLE\b/i.test(line)) continue
    const sizeMatch = line.match(/^LUT_3D_SIZE\s+(\d+)/i)
    if (sizeMatch) {
      size = Math.max(2, Math.min(64, Number(sizeMatch[1]) || 0))
      continue
    }
    if (/^(DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) continue
    const parts = line.split(/\s+/).map(Number)
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      values.push([
        clamp01(parts[0]) * 255,
        clamp01(parts[1]) * 255,
        clamp01(parts[2]) * 255,
      ])
    }
  }
  if (!size || values.length < size * size * size) return null
  return { size, values }
}

function sampleCubeLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size
  const rf = clamp01(r / 255) * (n - 1)
  const gf = clamp01(g / 255) * (n - 1)
  const bf = clamp01(b / 255) * (n - 1)
  const r0 = Math.floor(rf), g0 = Math.floor(gf), b0 = Math.floor(bf)
  const r1 = Math.min(n - 1, r0 + 1), g1 = Math.min(n - 1, g0 + 1), b1 = Math.min(n - 1, b0 + 1)
  const tr = rf - r0, tg = gf - g0, tb = bf - b0
  const at = (ri: number, gi: number, bi: number) => lut.values[bi * n * n + gi * n + ri] ?? [r, g, b]
  const out: [number, number, number] = [0, 0, 0]
  for (const [ri, rw] of [[r0, 1 - tr], [r1, tr]] as const) {
    for (const [gi, gw] of [[g0, 1 - tg], [g1, tg]] as const) {
      for (const [bi, bw] of [[b0, 1 - tb], [b1, tb]] as const) {
        const c = at(ri, gi, bi)
        const w = rw * gw * bw
        out[0] += c[0] * w
        out[1] += c[1] * w
        out[2] += c[2] * w
      }
    }
  }
  return out
}

function applyLookupPreset(r: number, g: number, b: number, preset: string): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  if (preset === "warm") return [clamp8(r * 1.08 + 8), clamp8(g * 1.02 + 3), clamp8(b * 0.92)]
  if (preset === "cool") return [clamp8(r * 0.92), clamp8(g * 1.02 + 2), clamp8(b * 1.1 + 8)]
  if (preset === "bleach") {
    const gray = luma(r, g, b)
    return [clamp8(gray * 0.35 + r * 0.88 + 12), clamp8(gray * 0.35 + g * 0.88 + 12), clamp8(gray * 0.35 + b * 0.88 + 12)]
  }
  if (preset === "cross-process") return [clamp8(Math.pow(rn, 0.82) * 255), clamp8(Math.pow(gn, 1.06) * 255 + 8), clamp8(Math.pow(bn, 1.22) * 255)]
  const contrast = 1.15
  return [
    clamp8((rn - 0.5) * 255 * contrast + 128),
    clamp8((gn - 0.5) * 255 * contrast + 128),
    clamp8((bn - 0.5) * 255 * contrast + 128),
  ]
}

function colorLookup(src: ImageData, lutStrength: number, lutData = "", preset = "filmic"): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const amount = Math.max(-100, Math.min(100, lutStrength)) / 100
  const lut = parseCubeLut(lutData)

  for (let i = 0; i < out.length; i += 4) {
    const mapped = lut
      ? sampleCubeLut(lut, out[i], out[i + 1], out[i + 2])
      : applyLookupPreset(out[i], out[i + 1], out[i + 2], preset)
    out[i] = clamp8(out[i] + (mapped[0] - out[i]) * amount)
    out[i + 1] = clamp8(out[i + 1] + (mapped[1] - out[i + 1]) * amount)
    out[i + 2] = clamp8(out[i + 2] + (mapped[2] - out[i + 2]) * amount)
  }

  return new ImageData(out, src.width, src.height)
}

function _gradientMap(src: ImageData): ImageData {
  // Simplified gradient map - maps luminance to a gradient from black to white
  // In a full implementation, this would use a gradient defined by two colors
  const out = new Uint8ClampedArray(src.data)

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]

    // Calculate luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b

    // Map luminance to gradient (black to white for simplicity)
    // In a real implementation, this would interpolate between two colors
    const mapped = luminance

    out[i] = mapped
    out[i + 1] = mapped
    out[i + 2] = mapped
  }

  return new ImageData(out, src.width, src.height)
}

function blackWhiteAdvanced(
  src: ImageData,
  reds: number,
  yellows: number,
  greens: number,
  cyans: number,
  blues: number,
  magentas: number,
  tint = false,
  tintHue = 38,
  tintSaturation = 18,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const shifts = { reds, yellows, greens, cyans, blues, magentas }
  for (let i = 0; i < out.length; i += 4) {
    const base = luma(out[i], out[i + 1], out[i + 2])
    const { h, s } = rgbToHsl(out[i], out[i + 1], out[i + 2])
    let adjustment = 0
    for (const key of Object.keys(HUE_RANGES) as Exclude<HueRange, "master">[]) {
      adjustment += hueRangeMask(h, s, key) * (shifts[key] / 100) * 85
    }
    const gray = clamp8(base + adjustment)
    if (tint) {
      const tinted = hslToRgb(((tintHue % 360) + 360) / 360, clamp01(tintSaturation / 100), gray / 255)
      out[i] = tinted.r
      out[i + 1] = tinted.g
      out[i + 2] = tinted.b
    } else {
      out[i] = gray
      out[i + 1] = gray
      out[i + 2] = gray
    }
  }
  return new ImageData(out, src.width, src.height)
}

function parseCurvePoints(value: unknown, fallback: [number, number][] = [[0, 0], [255, 255]]) {
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

function monotoneCurveLut(points: [number, number][]) {
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

function curvesAdvanced(
  src: ImageData,
  params: Record<string, number | string | boolean>,
): ImageData {
  const points = parseCurvePoints(params.points, [
    [0, parseNumber(params.shadow, 0)],
    [128, parseNumber(params.midtone, 128)],
    [255, parseNumber(params.highlight, 255)],
  ])
  const lut = monotoneCurveLut(points)
  const channel = String(params.channel ?? "rgb")
  const channels = channel === "red" ? [0] : channel === "green" ? [1] : channel === "blue" ? [2] : [0, 1, 2]
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    for (const k of channels) out[i + k] = lut[out[i + k]]
  }
  return new ImageData(out, src.width, src.height)
}

function colorBalanceAdvanced(
  src: ImageData,
  cyanRed: number,
  magentaGreen: number,
  yellowBlue: number,
  tone: "shadows" | "midtones" | "highlights" = "midtones",
  preserveLuminosity = true,
): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const cr = cyanRed * 0.9
  const mg = magentaGreen * 0.9
  const yb = yellowBlue * 0.9
  for (let i = 0; i < out.length; i += 4) {
    const beforeLum = luma(out[i], out[i + 1], out[i + 2])
    const L = beforeLum / 255
    const shadows = clamp01((0.62 - L) / 0.62)
    const highlights = clamp01((L - 0.38) / 0.62)
    const midtones = clamp01(1 - Math.abs(L - 0.5) / 0.5)
    const weight =
      tone === "shadows" ? shadows * shadows :
      tone === "highlights" ? highlights * highlights :
      midtones * midtones
    let r = out[i] + cr * weight
    let g = out[i + 1] + mg * weight
    let b = out[i + 2] + yb * weight
    if (preserveLuminosity) {
      const afterLum = Math.max(1, luma(r, g, b))
      const ratio = beforeLum / afterLum
      r = beforeLum + (r * ratio - beforeLum) * 0.92
      g = beforeLum + (g * ratio - beforeLum) * 0.92
      b = beforeLum + (b * ratio - beforeLum) * 0.92
    }
    out[i] = clamp8(r)
    out[i + 1] = clamp8(g)
    out[i + 2] = clamp8(b)
  }
  return new ImageData(out, src.width, src.height)
}

function vibranceAdvanced(src: ImageData, vibranceAmount: number, saturationAmount: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const hsl = rgbToHsl(out[i], out[i + 1], out[i + 2])
    const skinHue = hsl.h >= 18 / 360 && hsl.h <= 55 / 360
    const skinTone = skinHue && hsl.s > 0.12 && hsl.s < 0.78 && hsl.l > 0.18 && hsl.l < 0.86
    const lowSatBoost = 1 - hsl.s
    const skinProtect = skinTone ? 0.45 : 1
    const v = vibranceAmount / 100
    let s = hsl.s
    s = v >= 0
      ? s + (1 - s) * v * lowSatBoost * skinProtect
      : s * (1 + v * (1.35 - hsl.s))
    const sat = saturationAmount / 100
    s = sat >= 0 ? s + (1 - s) * sat : s * (1 + sat)
    const rgb = hslToRgb(hsl.h, clamp01(s), hsl.l)
    out[i] = rgb.r
    out[i + 1] = rgb.g
    out[i + 2] = rgb.b
  }
  return new ImageData(out, src.width, src.height)
}

interface GradientStopValue {
  offset: number
  color: string
}

function parseGradientStops(value: unknown): GradientStopValue[] {
  const fallback = [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ]
  if (typeof value !== "string" || !value.trim()) return fallback
  const stops = value
    .split(";")
    .map((entry) => {
      const [offset, color] = entry.split(",")
      const n = Number(offset)
      return Number.isFinite(n) && /^#[0-9a-f]{6}$/i.test(color ?? "")
        ? { offset: clamp01(n), color }
        : null
    })
    .filter((s): s is GradientStopValue => !!s)
    .sort((a, b) => a.offset - b.offset)
  if (!stops.length) return fallback
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 })
  if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 })
  return stops
}

function sampleGradient(stops: GradientStopValue[], t: number, interpolation = "rgb") {
  const first = stops[0]
  if (t <= first.offset) return hexToRgbFilter(first.color)
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t <= b.offset) {
      const span = Math.max(0.0001, b.offset - a.offset)
      const k = (t - a.offset) / span
      const ca = hexToRgbFilter(a.color)
      const cb = hexToRgbFilter(b.color)
      if (interpolation === "hsl") {
        const ha = rgbToHsl(ca.r, ca.g, ca.b)
        const hb = rgbToHsl(cb.r, cb.g, cb.b)
        let dh = hb.h - ha.h
        if (dh > 0.5) dh -= 1
        if (dh < -0.5) dh += 1
        const c = hslToRgb((ha.h + dh * k + 1) % 1, ha.s + (hb.s - ha.s) * k, ha.l + (hb.l - ha.l) * k)
        return { r: c.r, g: c.g, b: c.b }
      }
      return {
        r: ca.r + (cb.r - ca.r) * k,
        g: ca.g + (cb.g - ca.g) * k,
        b: ca.b + (cb.b - ca.b) * k,
      }
    }
  }
  return hexToRgbFilter(stops[stops.length - 1].color)
}


function gradientMapAdvanced(src: ImageData, gradient: string, reverse = false, dither = false, interpolation = "rgb"): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const stops = parseGradientStops(gradient)
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    let t = luma(out[i], out[i + 1], out[i + 2]) / 255
    if (dither) t = clamp01(t + (pseudoDither(p) - 0.5) / 255)
    if (reverse) t = 1 - t
    const c = sampleGradient(stops, t, interpolation)
    out[i] = c.r
    out[i + 1] = c.g
    out[i + 2] = c.b
  }
  return new ImageData(out, src.width, src.height)
}

function pseudoDither(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

interface LabStats {
  mean: [number, number, number]
  std: [number, number, number]
}

function matchColorAdvanced(
  src: ImageData,
  source: ImageData | null | undefined,
  luminance: number,
  colorIntensity: number,
  fade: number,
  neutralize: boolean,
) {
  if (!source) return clone(src)
  const srcStats = labStats(src)
  const refStats = labStats(source)
  const out = new Uint8ClampedArray(src.data)
  const lumAmount = luminance / 100
  const colorAmount = colorIntensity / 100
  const fadeAmount = fade / 100
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const original = [out[i], out[i + 1], out[i + 2]] as [number, number, number]
    let lab = rgbToLab(original[0], original[1], original[2])
    lab = [
      refStats.mean[0] + ((lab[0] - srcStats.mean[0]) * refStats.std[0]) / Math.max(0.0001, srcStats.std[0]),
      refStats.mean[1] + ((lab[1] - srcStats.mean[1]) * refStats.std[1]) / Math.max(0.0001, srcStats.std[1]),
      refStats.mean[2] + ((lab[2] - srcStats.mean[2]) * refStats.std[2]) / Math.max(0.0001, srcStats.std[2]),
    ]
    lab[0] = srcStats.mean[0] + (lab[0] - srcStats.mean[0]) * lumAmount
    lab[1] = srcStats.mean[1] + (lab[1] - srcStats.mean[1]) * colorAmount
    lab[2] = srcStats.mean[2] + (lab[2] - srcStats.mean[2]) * colorAmount
    if (neutralize) {
      lab[1] *= 0.86
      lab[2] *= 0.86
    }
    const matched = labToRgb(lab[0], lab[1], lab[2])
    out[i] = clamp8(original[0] * fadeAmount + matched[0] * (1 - fadeAmount))
    out[i + 1] = clamp8(original[1] * fadeAmount + matched[1] * (1 - fadeAmount))
    out[i + 2] = clamp8(original[2] * fadeAmount + matched[2] * (1 - fadeAmount))
  }
  return new ImageData(out, src.width, src.height)
}

function labStats(img: ImageData): LabStats {
  let count = 0
  const sum: [number, number, number] = [0, 0, 0]
  const sumSq: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const lab = rgbToLab(img.data[i], img.data[i + 1], img.data[i + 2])
    for (let k = 0; k < 3; k++) {
      sum[k] += lab[k]
      sumSq[k] += lab[k] * lab[k]
    }
    count++
  }
  if (!count) return { mean: [0, 0, 0], std: [1, 1, 1] }
  const mean = sum.map((v) => v / count) as [number, number, number]
  const std = sumSq.map((v, k) => Math.sqrt(Math.max(0.0001, v / count - mean[k] * mean[k]))) as [number, number, number]
  return { mean, std }
}

function srgbToLinear(v: number) {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return clamp8(c * 255)
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  let x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  let y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb)
  let z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const f = (v: number) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  x = f(x)
  y = f(y)
  z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  let y = (L + 16) / 116
  let x = a / 500 + y
  let z = y - b / 200
  const f = (v: number) => {
    const v3 = v * v * v
    return v3 > 0.008856 ? v3 : (v - 16 / 116) / 7.787
  }
  x = f(x) * 0.95047
  y = f(y)
  z = f(z) * 1.08883
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)]
}

/* ====================== BILINEAR INTERPOLATION ========================= */

function bilinearSample(data: Uint8ClampedArray, w: number, h: number, fx: number, fy: number): [number, number, number, number] {
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

function distortTwirl(src: ImageData, angleDeg: number): ImageData {
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

function distortPinch(src: ImageData, amount: number): ImageData {
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

function distortSpherize(src: ImageData, amount: number, mode: string): ImageData {
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

function distortWave(src: ImageData, wavelength: number, amplitude: number, type: string, scale: number): ImageData {
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

function distortRipple(src: ImageData, amount: number, size: string): ImageData {
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

function distortZigZag(src: ImageData, amount: number, ridges: number, style: string): ImageData {
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

function distortPolar(src: ImageData, mode: string): ImageData {
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

function parseAdaptiveConstraints(raw: string): AdaptiveWideAngleConstraint[] {
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

function adaptiveWideAngle(
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

function perspectivePlaneWarp(
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

function vanishingPoint(
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

function skyReplacement(src: ImageData, horizonPct: number, tolerance: number, blend: number, warmth: number, seed: number): ImageData {
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

function fbmNoise(x: number, y: number, seed: number, octaves: number = 6): number {
  let value = 0, amp = 0.5, freq = 1
  for (let i = 0; i < octaves; i++) {
    value += amp * perlinNoise2D(x * freq, y * freq, seed + i * 37)
    amp *= 0.5
    freq *= 2
  }
  return value * 0.5 + 0.5 // normalize to [0,1]
}

function renderClouds(src: ImageData, scale: number, seed: number, difference: boolean): ImageData {
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

function renderFibers(src: ImageData, variance: number, strength: number, seed: number): ImageData {
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

function renderLensFlare(src: ImageData, brightness: number, cxPct: number, cyPct: number, _lens: string): ImageData {
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

/* ====================== OTHER FILTERS ================================== */

function filterHighPass(src: ImageData, radius: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8((src.data[i] - blurred.data[i]) + 128)
    out[i + 1] = clamp8((src.data[i + 1] - blurred.data[i + 1]) + 128)
    out[i + 2] = clamp8((src.data[i + 2] - blurred.data[i + 2]) + 128)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function filterOffset(src: ImageData, dx: number, dy: number, edgeMode: string, fillR = 255, fillG = 255, fillB = 255): ImageData {
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

function filterMaxMin(src: ImageData, radius: number, isMax: boolean): ImageData {
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

interface SmartSharpenExtras {
  remove?: "gaussian" | "lens" | "motion"
  motionAngle?: number
  moreAccurate?: boolean
  shadowTonalWidth?: number
  shadowRadius?: number
  highlightTonalWidth?: number
  highlightRadius?: number
}

function smartSharpenBlurSource(src: ImageData, radius: number, extras: SmartSharpenExtras) {
  const r = Math.max(0.5, radius)
  const remove = extras.remove ?? "gaussian"
  if (remove === "motion") {
    return motionBlur(src, Math.max(1, r * (extras.moreAccurate ? 4 : 2)), extras.motionAngle ?? 0)
  }
  if (remove === "lens") {
    return lensBlur(src, Math.max(1, r), 6, 0, 0, 255, 0, true, { shape: "circle" })
  }
  return extras.moreAccurate ? gaussianBlur(gaussianBlur(src, r), Math.max(0.5, r * 0.35)) : gaussianBlur(src, r)
}

function tonalFadeForSmartSharpen(
  lum: number,
  shadowFade: number,
  highlightFade: number,
  extras: SmartSharpenExtras,
) {
  let fade = 1
  const shadowAmount = Math.max(0, Math.min(100, shadowFade)) / 100
  const highlightAmount = Math.max(0, Math.min(100, highlightFade)) / 100

  if (shadowAmount > 0) {
    const tonalWidth = Math.max(1, Math.min(100, extras.shadowTonalWidth ?? 25)) / 100
    const tonalLimit = Math.max(1, 255 * tonalWidth)
    const radiusBoost = 1 + Math.max(0, Math.min(250, extras.shadowRadius ?? 0)) / 250
    const influence = Math.min(1, Math.max(0, 1 - lum / tonalLimit) * radiusBoost)
    fade *= 1 - shadowAmount * influence
  }

  if (highlightAmount > 0) {
    const tonalWidth = Math.max(1, Math.min(100, extras.highlightTonalWidth ?? 25)) / 100
    const tonalLimit = Math.max(1, 255 * tonalWidth)
    const radiusBoost = 1 + Math.max(0, Math.min(250, extras.highlightRadius ?? 0)) / 250
    const influence = Math.min(1, Math.max(0, 1 - (255 - lum) / tonalLimit) * radiusBoost)
    fade *= 1 - highlightAmount * influence
  }

  return Math.max(0, Math.min(1, fade))
}

function smartSharpen(
  src: ImageData,
  amount: number,
  radius: number,
  threshold: number,
  shadowFade: number,
  highlightFade: number,
  extras: SmartSharpenExtras = {},
): ImageData {
  const blurred = smartSharpenBlurSource(src, radius, extras)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const k = amount / 100

  for (let i = 0; i < src.data.length; i += 4) {
    const lum = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]
    // Edge magnitude (difference from blur)
    const edgeMag = Math.abs(src.data[i] - blurred.data[i]) +
                    Math.abs(src.data[i + 1] - blurred.data[i + 1]) +
                    Math.abs(src.data[i + 2] - blurred.data[i + 2])

    // Threshold: only sharpen if edge magnitude exceeds threshold
    if (edgeMag / 3 < threshold) {
      out[i] = src.data[i]; out[i + 1] = src.data[i + 1]; out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      continue
    }

    const fade = tonalFadeForSmartSharpen(lum, shadowFade, highlightFade, extras)

    const effectiveK = k * fade
    for (let c = 0; c < 3; c++) {
      const diff = src.data[i + c] - blurred.data[i + c]
      out[i + c] = clamp8(src.data[i + c] + diff * effectiveK)
    }
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, w, h)
}

/* --------- LENS BLUR --------- */

interface LensBlurExtras {
  depthSource?: ImageData | null
  depthChannel?: "luminance" | "red" | "green" | "blue" | "alpha"
  depthFocus?: number   // 0..255 — pixel depth values matching this stay sharp
  depthBlurScale?: number // 0..100 — how strongly off-focus depths get blurred
  depthInvert?: boolean
  shape?: "hexagon" | "pentagon" | "octagon" | "circle" | "triangle" | "square"
}

function extractDepthValue(depth: ImageData, x: number, y: number, channel: string, invert: boolean): number {
  const sx = (x / Math.max(1, x)) // satisfy lint when called with single coords
  void sx
  const dw = depth.width, dh = depth.height
  // For now nearest-neighbor index since callers pass integer coords matched to src size already.
  const ix = Math.max(0, Math.min(dw - 1, Math.round(x)))
  const iy = Math.max(0, Math.min(dh - 1, Math.round(y)))
  const idx = (iy * dw + ix) * 4
  const r = depth.data[idx], g = depth.data[idx + 1], b = depth.data[idx + 2], a = depth.data[idx + 3]
  let v: number
  switch (channel) {
    case "red":   v = r; break
    case "green": v = g; break
    case "blue":  v = b; break
    case "alpha": v = a; break
    default:      v = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return invert ? 255 - v : v
}

function buildIrisOffsets(r: number, blades: number, rotation: number, shape: string): number[] {
  const offsets: number[] = []
  const rotRad = rotation * Math.PI / 180
  const halfSeg = Math.PI / blades
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky)
      if (dist > r) continue
      if (shape === "circle") {
        offsets.push(kx, ky)
        continue
      }
      if (shape === "square") {
        if (Math.abs(kx) <= r && Math.abs(ky) <= r) offsets.push(kx, ky)
        continue
      }
      // Polygon shape — number of sides derived from the requested shape, with
      // bladeCount acting as a secondary modifier (e.g., hexagon = 6 sides).
      let sides = blades
      if (shape === "triangle") sides = 3
      else if (shape === "pentagon") sides = 5
      else if (shape === "hexagon") sides = 6
      else if (shape === "octagon") sides = 8
      const angle = Math.atan2(ky, kx) - rotRad
      const segment = 2 * Math.PI / sides
      const localAngle = ((angle % segment) + segment) % segment - segment / 2
      const polyRadius = r * Math.cos(segment / 2) / Math.max(0.001, Math.cos(localAngle))
      if (dist <= polyRadius) offsets.push(kx, ky)
      void halfSeg
    }
  }
  return offsets
}

function lensBlurDefault(
  src: ImageData,
  radius: number,
  bladeCount: number,
  rotation: number,
  specBright: number,
  specThreshold: number,
  noiseAmt: number,
  noiseMono: boolean,
): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(40, Math.round(radius)))
  const blades = Math.max(3, Math.min(8, Math.round(bladeCount)))
  const rot = (rotation * Math.PI) / 180
  const kernel: Array<[number, number]> = []
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky)
      if (dist > r) continue
      const angle = Math.atan2(ky, kx) - rot
      const segment = (2 * Math.PI) / blades
      const local = ((angle % segment) + segment) % segment
      const polyRadius = r / Math.max(0.2, Math.cos(Math.PI / blades - local))
      if (dist <= Math.abs(polyRadius)) kernel.push([kx, ky])
    }
  }
  const specK = Math.max(0, specBright) / 100
  const specT = Math.max(0, Math.min(255, specThreshold))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, ws = 0
      for (const [kx, ky] of kernel) {
        const sx = x + kx < 0 ? 0 : x + kx >= w ? w - 1 : x + kx
        const sy = y + ky < 0 ? 0 : y + ky >= h ? h - 1 : y + ky
        const p = (sy * w + sx) * 4
        let weight = 1
        const lum = Math.max(src.data[p], src.data[p + 1], src.data[p + 2])
        if (specK > 0 && lum > specT) weight = 1 + ((lum - specT) / 255) * specK * 4
        rs += src.data[p] * weight
        gs += src.data[p + 1] * weight
        bs += src.data[p + 2] * weight
        as_ += src.data[p + 3] * weight
        ws += weight
      }
      const i = (y * w + x) * 4
      out[i] = rs / ws
      out[i + 1] = gs / ws
      out[i + 2] = bs / ws
      out[i + 3] = as_ / ws
    }
  }
  if (noiseAmt > 0) {
    const amp = noiseAmt * 2.55
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (noiseMono) {
          const n = (hashNoise(x, y, 211) - 0.5) * amp
          out[i] = clamp8(out[i] + n)
          out[i + 1] = clamp8(out[i + 1] + n)
          out[i + 2] = clamp8(out[i + 2] + n)
        } else {
          out[i] = clamp8(out[i] + (hashNoise(x, y, 211) - 0.5) * amp)
          out[i + 1] = clamp8(out[i + 1] + (hashNoise(x, y, 307) - 0.5) * amp)
          out[i + 2] = clamp8(out[i + 2] + (hashNoise(x, y, 401) - 0.5) * amp)
        }
      }
    }
  }
  return new ImageData(out, w, h)
}

function lensBlur(src: ImageData, radius: number, bladeCount: number, rotation: number, specBright: number, specThreshold: number, noiseAmt: number, noiseMono: boolean, extras: LensBlurExtras = {}): ImageData {
  if (radius < 1 && !(extras.depthSource && (extras.depthBlurScale ?? 0) > 0)) return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const w = src.width, h = src.height
  const baseR = Math.max(1, Math.min(40, Math.round(Math.max(1, radius))))
  const blades = Math.max(3, Math.min(8, Math.round(bladeCount)))
  const shape = extras.shape ?? "hexagon"

  const depthSrc = extras.depthSource ?? null
  const depthChannel = extras.depthChannel ?? "luminance"
  const depthFocus = Math.max(0, Math.min(255, extras.depthFocus ?? 128))
  const depthScale = Math.max(0, Math.min(100, extras.depthBlurScale ?? 0)) / 100
  const depthInvert = Boolean(extras.depthInvert)

  if (!depthSrc && depthScale <= 0 && shape === "hexagon") {
    return lensBlurDefault(src, baseR, blades, rotation, specBright, specThreshold, noiseAmt, noiseMono)
  }

  // Precompute per-pixel radius when a depth map is supplied. The pixel's
  // distance from the focus value scales the blur radius — pixels at the focus
  // value stay sharp, pixels at max distance receive the full configured radius.
  let depthRadius: Uint8Array | null = null
  let maxR = baseR
  if (depthSrc && depthScale > 0) {
    depthRadius = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Sample depth map. If depth dims differ, scale linearly.
        const dx = depthSrc.width === w ? x : Math.round((x / Math.max(1, w - 1)) * (depthSrc.width - 1))
        const dy = depthSrc.height === h ? y : Math.round((y / Math.max(1, h - 1)) * (depthSrc.height - 1))
        const v = extractDepthValue(depthSrc, dx, dy, depthChannel, depthInvert)
        const dist = Math.abs(v - depthFocus) / 255
        const pr = Math.max(0, Math.min(baseR, Math.round(baseR * dist * depthScale * 2)))
        depthRadius[y * w + x] = pr
        if (pr > maxR) maxR = pr
      }
    }
  }

  // Build a stack of iris kernels for each radius we may need. Without depth,
  // we only need a single kernel at baseR. With depth, we lazily build a
  // dictionary keyed by radius and reuse it across pixels.
  const kernelCache = new Map<number, number[]>()
  const baseOffsets = buildIrisOffsets(baseR, blades, rotation, shape)
  kernelCache.set(baseR, baseOffsets)
  if (!baseOffsets.length) return new ImageData(new Uint8ClampedArray(src.data), w, h)

  // Pre-convert source to linear-light squared values for gamma-correct averaging.
  const linR = new Float32Array(w * h)
  const linG = new Float32Array(w * h)
  const linB = new Float32Array(w * h)
  const specMap = new Float32Array(w * h) // extra multiplier for bright specs
  const specK = Math.max(0, specBright) / 100
  const specT = Math.max(0, Math.min(255, specThreshold))
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      const rr = src.data[i] / 255, gg = src.data[i + 1] / 255, bb = src.data[i + 2] / 255
      linR[py * w + px] = rr * rr
      linG[py * w + px] = gg * gg
      linB[py * w + px] = bb * bb
      const lum = Math.max(src.data[i], src.data[i + 1], src.data[i + 2])
      let m = 1
      if (specK > 0 && lum > specT) {
        // Boost is proportional to how far above threshold the pixel is.
        m = 1 + ((lum - specT) / Math.max(1, 255 - specT)) * specK * 6
      }
      specMap[py * w + px] = m
    }
  }

  function getKernel(rr: number): number[] {
    const cached = kernelCache.get(rr)
    if (cached) return cached
    const built = buildIrisOffsets(rr, blades, rotation, shape)
    kernelCache.set(rr, built)
    return built
  }

  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const localR = depthRadius ? depthRadius[y * w + x] : baseR
      if (localR < 1) {
        // No blur for this pixel — copy source directly.
        const idx = (y * w + x) * 4
        out[idx]     = src.data[idx]
        out[idx + 1] = src.data[idx + 1]
        out[idx + 2] = src.data[idx + 2]
        out[idx + 3] = src.data[idx + 3]
        continue
      }
      const offsets = getKernel(localR)
      const kCount = offsets.length / 2
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, wSum = 0
      for (let k = 0; k < kCount; k++) {
        const ox = offsets[k * 2], oy = offsets[k * 2 + 1]
        const sx = x + ox < 0 ? 0 : x + ox >= w ? w - 1 : x + ox
        const sy = y + oy < 0 ? 0 : y + oy >= h ? h - 1 : y + oy
        const sIdx = sy * w + sx
        const weight = specMap[sIdx]
        rSum += linR[sIdx] * weight
        gSum += linG[sIdx] * weight
        bSum += linB[sIdx] * weight
        aSum += src.data[sIdx * 4 + 3] * weight
        wSum += weight
      }
      const idx = (y * w + x) * 4
      // sqrt back to gamma-encoded display space
      out[idx] = clamp8(Math.sqrt(rSum / wSum) * 255)
      out[idx + 1] = clamp8(Math.sqrt(gSum / wSum) * 255)
      out[idx + 2] = clamp8(Math.sqrt(bSum / wSum) * 255)
      out[idx + 3] = clamp8(aSum / wSum)
    }
  }
  void maxR

  if (noiseAmt > 0) {
    const amp = noiseAmt * 2.55
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (noiseMono) {
          const n = (hashNoise(x, y, 211) - 0.5) * amp
          out[i] = clamp8(out[i] + n)
          out[i + 1] = clamp8(out[i + 1] + n)
          out[i + 2] = clamp8(out[i + 2] + n)
        } else {
          out[i] = clamp8(out[i] + (hashNoise(x, y, 211) - 0.5) * amp)
          out[i + 1] = clamp8(out[i + 1] + (hashNoise(x, y, 307) - 0.5) * amp)
          out[i + 2] = clamp8(out[i + 2] + (hashNoise(x, y, 401) - 0.5) * amp)
        }
      }
    }
  }

  return new ImageData(out, w, h)
}

function surfaceBlur(src: ImageData, radius: number, threshold: number): ImageData {
  if (radius <= 0 || threshold <= 0) return clone(src)
  const w = src.width, h = src.height
  const r = Math.max(1, Math.min(18, Math.round(radius)))
  const t = Math.max(0, Math.min(255, threshold))

  const sigmaS = Math.max(0.75, r * 0.645)
  const sigmaR = Math.max(1, t * 0.55375)
  const twoSigmaS2 = 2 * sigmaS * sigmaS
  const twoSigmaR2 = 2 * sigmaR * sigmaR
  const r2 = r * r
  const spatial = new Float32Array((2 * r + 1) * (2 * r + 1))
  const offsets: number[] = []
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const d2 = ox * ox + oy * oy
      if (d2 > r2) continue
      spatial[(oy + r) * (2 * r + 1) + (ox + r)] = Math.exp(-d2 / twoSigmaS2)
      offsets.push(ox, oy)
    }
  }

  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const baseLum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let rs = 0, gs = 0, bs = 0, as_ = 0, wSum = 0
      for (let k = 0; k < offsets.length; k += 2) {
        const ox = offsets[k], oy = offsets[k + 1]
        const sx = x + ox < 0 ? 0 : x + ox >= w ? w - 1 : x + ox
        const sy = y + oy < 0 ? 0 : y + oy >= h ? h - 1 : y + oy
        const p = (sy * w + sx) * 4
        const diff = Math.abs(luma(src.data[p], src.data[p + 1], src.data[p + 2]) - baseLum)
        if (diff >= t) continue
        const sp = spatial[(oy + r) * (2 * r + 1) + (ox + r)]
        const range = Math.exp(-(diff * diff) / twoSigmaR2)
        const weight = sp * range
        rs += src.data[p] * weight
        gs += src.data[p + 1] * weight
        bs += src.data[p + 2] * weight
        as_ += src.data[p + 3] * weight
        wSum += weight
      }
      if (wSum > 0) {
        out[i] = rs / wSum
        out[i + 1] = gs / wSum
        out[i + 2] = bs / wSum
        out[i + 3] = as_ / wSum
      } else {
        out[i] = src.data[i]; out[i + 1] = src.data[i + 1]; out[i + 2] = src.data[i + 2]; out[i + 3] = src.data[i + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

function radialBlur(src: ImageData, amount: number, method: string, quality: string, centerX = 50, centerY = 50): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = clamp01(centerX / 100) * (w - 1)
  const cy = clamp01(centerY / 100) * (h - 1)
  const strength = Math.max(0, Math.min(100, amount)) / 100
  if (strength <= 0) return new ImageData(new Uint8ClampedArray(src.data), w, h)
  const steps = quality === "best" ? 48 : quality === "good" ? 24 : 12
  // Scale spin angle with image diagonal so far pixels travel a constant arc length,
  // which is what Photoshop's spin blur does (constant pixel velocity).
  const diag = Math.hypot(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.hypot(dx, dy)
      let rs = 0, gs = 0, bs = 0, as_ = 0, wSum = 0
      for (let s = 0; s < steps; s++) {
        // Tent weight peaks at the center sample for natural smooth falloff.
        const stepWeight = 1 - Math.abs((s / Math.max(1, steps - 1)) - 0.5) * 2
        const jitter = quality === "best" ? (pseudoDither(y * w + x + s * 17) - 0.5) / steps : 0
        const t = (s / Math.max(1, steps - 1) - 0.5 + jitter) * strength
        let sx = x, sy = y
        if (method === "zoom") {
          const scale = 1 + t * 1.3
          sx = cx + dx * scale
          sy = cy + dy * scale
        } else {
          // spin — angular sweep proportional to (amount / dist) so arc length is
          // bounded by the diagonal-scaled spin radius
          const arc = t * (diag * 0.5) / Math.max(8, dist)
          const cos = Math.cos(arc), sin = Math.sin(arc)
          sx = cx + dx * cos - dy * sin
          sy = cy + dx * sin + dy * cos
        }
        const sample = bilinearSample(src.data, w, h, sx, sy)
        rs += sample[0] * stepWeight
        gs += sample[1] * stepWeight
        bs += sample[2] * stepWeight
        as_ += sample[3] * stepWeight
        wSum += stepWeight
      }
      const i = (y * w + x) * 4
      out[i] = rs / wSum; out[i + 1] = gs / wSum; out[i + 2] = bs / wSum; out[i + 3] = as_ / wSum
    }
  }
  return new ImageData(out, w, h)
}

function oilPaint(src: ImageData, radius: number, levels: number, shine: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(8, Math.round(radius)))
  const buckets = Math.max(4, Math.min(32, Math.round(levels)))
  const gloss = Math.max(0, Math.min(100, shine)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const count = new Array<number>(buckets).fill(0)
      const rs = new Array<number>(buckets).fill(0)
      const gs = new Array<number>(buckets).fill(0)
      const bs = new Array<number>(buckets).fill(0)
      const as = new Array<number>(buckets).fill(0)
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(h - 1, y + oy))
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue
          const sx = Math.max(0, Math.min(w - 1, x + ox))
          const p = (sy * w + sx) * 4
          const b = Math.min(buckets - 1, Math.floor((luma(src.data[p], src.data[p + 1], src.data[p + 2]) / 256) * buckets))
          count[b]++
          rs[b] += src.data[p]; gs[b] += src.data[p + 1]; bs[b] += src.data[p + 2]; as[b] += src.data[p + 3]
        }
      }
      let best = 0
      for (let b = 1; b < buckets; b++) if (count[b] > count[best]) best = b
      const n = Math.max(1, count[best])
      const i = (y * w + x) * 4
      const below = (Math.min(h - 1, y + 1) * w + x) * 4
      const above = (Math.max(0, y - 1) * w + x) * 4
      const edge = Math.abs(luma(src.data[below], src.data[below + 1], src.data[below + 2]) - luma(src.data[above], src.data[above + 1], src.data[above + 2]))
      out[i] = clamp8(rs[best] / n + edge * gloss)
      out[i + 1] = clamp8(gs[best] / n + edge * gloss)
      out[i + 2] = clamp8(bs[best] / n + edge * gloss)
      out[i + 3] = as[best] / n
    }
  }
  return new ImageData(out, w, h)
}

function glassDistort(src: ImageData, distortion: number, smoothness: number, texture: string, scale: number): ImageData {
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

function mixBlurredByWeight(src: ImageData, blurred: ImageData, weightForPixel: (x: number, y: number) => number) {
  const out = new Uint8ClampedArray(src.data)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const weight = clamp01(weightForPixel(x, y))
      if (weight <= 0) continue
      out[i] = clamp8(src.data[i] * (1 - weight) + blurred.data[i] * weight)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - weight) + blurred.data[i + 1] * weight)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - weight) + blurred.data[i + 2] * weight)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

function fieldBlur(src: ImageData, blur: number, centerX: number, centerY: number, falloff: number, pinsSpec = "") {
  const pins = parseFieldBlurPins(pinsSpec)
  if (pins.length > 0) {
    const maxBlur = Math.max(0, blur, ...pins.map((pin) => pin.blur))
    if (maxBlur <= 0) return clone(src)
    const blurred = boxBlur(src, Math.max(1, maxBlur))
    return mixBlurredByWeight(src, blurred, (x, y) => {
      const px = (x / Math.max(1, src.width - 1)) * 100
      const py = (y / Math.max(1, src.height - 1)) * 100
      let weightedBlur = 0
      let totalWeight = 0
      for (const pin of pins) {
        const dx = ((px - pin.x) / 100) * src.width
        const dy = ((py - pin.y) / 100) * src.height
        const d2 = dx * dx + dy * dy
        if (d2 < 0.25) return pin.blur / maxBlur
        const weight = 1 / Math.max(1, d2)
        weightedBlur += pin.blur * weight
        totalWeight += weight
      }
      return totalWeight > 0 ? weightedBlur / totalWeight / maxBlur : 0
    })
  }

  const blurred = boxBlur(src, Math.max(1, blur))
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const maxDistance = Math.hypot(Math.max(cx, src.width - cx), Math.max(cy, src.height - cy)) || 1
  const keepRadius = maxDistance * clamp01((100 - falloff) / 140)
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.max(0, Math.hypot(x - cx, y - cy) - keepRadius)
    return d / Math.max(1, maxDistance - keepRadius)
  })
}

function irisBlur(
  src: ImageData,
  blur: number,
  centerX: number,
  centerY: number,
  radius: number,
  feather: number,
  ellipseWidth = radius,
  ellipseHeight = radius,
  rotation = 0,
) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const rx = Math.max(1, src.width * (ellipseWidth / 100) * 0.5)
  const ry = Math.max(1, src.height * (ellipseHeight / 100) * 0.5)
  const radians = -rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const featherWidth = Math.max(0.01, feather / 100)
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const localX = dx * cos - dy * sin
    const localY = dx * sin + dy * cos
    const d = Math.hypot(localX / rx, localY / ry)
    return (d - 1) / featherWidth
  })
}

function tiltShiftBlur(src: ImageData, blur: number, angle: number, radius: number, feather: number, centerX = 50, centerY = 50) {
  const blurred = boxBlur(src, Math.max(1, blur))
  const radians = (angle * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const clearBand = Math.max(1, Math.min(src.width, src.height) * (radius / 100) * 0.5)
  const featherBand = Math.max(1, Math.min(src.width, src.height) * (feather / 100))
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const d = Math.abs((x - cx) * nx + (y - cy) * ny)
    return (d - clearBand) / featherBand
  })
}

function pathBlur(src: ImageData, distance: number, angle: number, taper: number, pathSpec = "") {
  const hasPath = pathSpec.trim().length > 0
  const points = hasPath ? parsePathBlurPoints(pathSpec) : []
  const pathAngle = hasPath && points.length >= 2 ? angleFromPathPoints(points, src.width, src.height) : angle
  const blurred = motionBlur(src, Math.max(1, distance), Number.isFinite(pathAngle) ? pathAngle : angle)
  const taperAmount = clamp01(taper / 100)
  if (hasPath && points.length >= 2) {
    const canvasPoints = points.map((point) => ({
      x: (point.x / 100) * Math.max(1, src.width - 1),
      y: (point.y / 100) * Math.max(1, src.height - 1),
    }))
    const influenceBand = Math.max(8, Math.min(src.width, src.height) * 0.18)
    return mixBlurredByWeight(src, blurred, (x, y) => {
      const nearest = distanceToPolyline({ x, y }, canvasPoints)
      const pathWeight = 1 - clamp01(nearest / influenceBand)
      if (taperAmount <= 0) return pathWeight
      const edge = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
      const edgeWeight = 1 - clamp01(edge / Math.max(1, Math.min(src.width, src.height) * 0.5) * taperAmount)
      return Math.max(pathWeight, edgeWeight * 0.35)
    })
  }
  if (taperAmount <= 0) return blurred
  return mixBlurredByWeight(src, blurred, (x, y) => {
    const edge = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
    return 1 - clamp01(edge / (Math.min(src.width, src.height) * 0.5) * taperAmount)
  })
}

function spinBlur(src: ImageData, amount: number, centerX: number, centerY: number, radius = 100) {
  const shifted = radialBlur(src, Math.max(1, amount), "spin", "best", centerX, centerY)
  const cx = (centerX / 100) * Math.max(1, src.width - 1)
  const cy = (centerY / 100) * Math.max(1, src.height - 1)
  const radiusPx = Math.max(1, Math.min(src.width, src.height) * clamp01(radius / 100) * 0.5)
  const featherPx = Math.max(2, radiusPx * 0.2)
  return mixBlurredByWeight(src, shifted, (x, y) => 1 - clamp01((Math.hypot(x - cx, y - cy) - radiusPx) / featherPx))
}

function angleFromPathPoints(points: { x: number; y: number }[], width: number, height: number) {
  const first = points[0]
  const last = points[points.length - 1]
  const dx = ((last.x - first.x) / 100) * width
  const dy = ((last.y - first.y) / 100) * height
  return Math.atan2(dy, dx) * 180 / Math.PI
}

function distanceToPolyline(point: { x: number; y: number }, points: { x: number; y: number }[]) {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(point, points[i], points[i + 1]))
  }
  return best
}

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 0.0001) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}

/* ------------------------- lens profile presets -------------------------- */
interface LensProfilePreset {
  k1: number
  k2: number
  k3: number
  p1: number
  p2: number
  vignette: number
  chromatic: number
  defringe: number
  description: string
}

const LENS_DEFAULT_VIGNETTE_MIDPOINT = 68
const LENS_MANUAL_DISTORTION_DIVISOR = 115
const LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE = 0.55
const LENS_CHROMATIC_SHIFT_SCALE = 1.5

const LENS_PROFILE_PRESETS: Record<string, LensProfilePreset> = {
  custom:        { k1: 0,     k2: 0,    k3: 0,    p1: 0,    p2: 0,    vignette: 0,    chromatic: 0,    defringe: 0,    description: "Manual" },
  smartphone:    { k1: 0.16,  k2: 0.04, k3: 0,    p1: 0,    p2: 0,    vignette: 0.18, chromatic: 0.08, defringe: 0.16, description: "Generic phone wide" },
  "compact-wide": { k1: 0.22, k2: 0.06, k3: 0.01, p1: 0,    p2: 0,    vignette: 0.20, chromatic: 0.12, defringe: 0.16, description: "Compact camera wide" },
  "wide-angle":  { k1: 0.34,  k2: 0.10, k3: 0.02, p1: 0,    p2: 0,    vignette: 0.32, chromatic: 0.18, defringe: 0.20, description: "24mm wide" },
  fisheye:       { k1: 0.62,  k2: 0.30, k3: 0.10, p1: 0,    p2: 0,    vignette: 0.45, chromatic: 0.22, defringe: 0.24, description: "Fisheye 8-15mm" },
  "standard-50": { k1: 0.04,  k2: 0.01, k3: 0,    p1: 0,    p2: 0,    vignette: 0.08, chromatic: 0.04, defringe: 0.08, description: "Standard 50mm" },
  telephoto:     { k1: -0.10, k2: -0.02, k3: 0,   p1: 0,    p2: 0,    vignette: 0.10, chromatic: 0.05, defringe: 0.10, description: "85-200mm tele" },
  "macro-100":   { k1: -0.03, k2: -0.01, k3: 0,   p1: 0,    p2: 0,    vignette: 0.05, chromatic: 0.03, defringe: 0.12, description: "100mm macro flat-field" },
  "super-tele":  { k1: -0.22, k2: -0.06, k3: -0.01, p1: 0,  p2: 0,    vignette: 0.06, chromatic: 0.03, defringe: 0.08, description: "300mm+ super tele" },
  "drone-fpv":   { k1: 0.45,  k2: 0.18, k3: 0.05, p1: 0.01, p2: 0.01, vignette: 0.36, chromatic: 0.20, defringe: 0.22, description: "Drone/action cam" },
  "architecture-shift": { k1: 0.08, k2: 0.02, k3: 0, p1: -0.01, p2: 0.01, vignette: 0.14, chromatic: 0.06, defringe: 0.14, description: "Shift lens / architecture" },
}

interface LensCorrectionExtras {
  perspectiveV?: number
  perspectiveH?: number
  vignetteMidpoint?: number
  fringeR?: number
  fringeG?: number
  fringeB?: number
  scalePct?: number
}

function lensCorrection(
  src: ImageData,
  distortion: number,
  vignette: number,
  chromatic: number,
  k2Strength: number = 0,
  k3Strength: number = 0,
  tangentialX: number = 0,
  tangentialY: number = 0,
  profile: string = "custom",
  autoScale: boolean = false,
  edgeMode: string = "clamp",
  profileStrength: number = 100,
  defringe: number = 0,
  extras: LensCorrectionExtras = {},
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const maxR = Math.max(1, Math.hypot(cx, cy))
  const preset = LENS_PROFILE_PRESETS[profile] ?? LENS_PROFILE_PRESETS.custom
  const strength = Math.max(0, Math.min(150, profileStrength)) / 100
  const k1 = preset.k1 * strength + distortion / LENS_MANUAL_DISTORTION_DIVISOR
  const k2 = preset.k2 * strength + (k2Strength + distortion * LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE) / 420
  const k3 = preset.k3 * strength + k3Strength / 900
  const p1 = preset.p1 * strength + tangentialX / 1200
  const p2 = preset.p2 * strength + tangentialY / 1200
  const ca = (chromatic + preset.chromatic * 100 * strength) / 100
  const vig = (vignette + preset.vignette * 100 * strength) / 100
  const fringeClean = Math.max(0, Math.min(100, defringe + preset.defringe * 100 * strength)) / 100
  const fringeR = (extras.fringeR ?? 0) / 100
  const fringeG = (extras.fringeG ?? 0) / 100
  const fringeB = (extras.fringeB ?? 0) / 100
  const perspV = (extras.perspectiveV ?? 0) / 200
  const perspH = (extras.perspectiveH ?? 0) / 200
  const vigMid = Math.max(0, Math.min(100, extras.vignetteMidpoint ?? LENS_DEFAULT_VIGNETTE_MIDPOINT)) / 100
  const extraScale = Math.max(0.05, (extras.scalePct ?? 100) / 100)
  // Compute an auto-scale factor so the corrected image fills the frame
  // without exposing the resampled edge — sample the 4 image corners and
  // scale by the smallest displacement factor.
  let outScale = 1 / extraScale
  if (autoScale) {
    const corners: Array<[number, number]> = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    ]
    let minFactor = Infinity
    for (const [px, py] of corners) {
      const dx = px - cx, dy = py - cy
      const nx2 = dx / maxR, ny2 = dy / maxR
      const r2c = nx2 * nx2 + ny2 * ny2
      const f = 1 + k1 * r2c + k2 * r2c * r2c + k3 * r2c * r2c * r2c
      if (f > 0 && f < minFactor) minFactor = f
    }
    if (isFinite(minFactor) && minFactor > 0) outScale = minFactor / extraScale
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) * outScale, dy = (y - cy) * outScale
      const nx = dx / maxR, ny = dy / maxR
      const r2 = nx * nx + ny * ny
      const r4 = r2 * r2, r6 = r4 * r2
      const factor = 1 + k1 * r2 + k2 * r4 + k3 * r6
      // Brown-Conrady tangential distortion (off-axis lens tilt)
      const tx = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx)
      const ty = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny
      // Vertical / horizontal perspective: keystone correction
      const ny01 = (y / Math.max(1, h - 1)) - 0.5
      const nx01 = (x / Math.max(1, w - 1)) - 0.5
      const perspXScale = 1 + perspV * (2 * ny01)
      const perspYScale = 1 + perspH * (2 * nx01)
      const sx = cx + dx * factor * perspXScale + tx * maxR
      const sy = cy + dy * factor * perspYScale + ty * maxR
      const chromaShift = ca * (0.3 + r2) * LENS_CHROMATIC_SHIFT_SCALE
      const red = bilinearSample(src.data, w, h, sx + nx * (chromaShift + fringeR * 8), sy + ny * (chromaShift + fringeR * 8))
      const mid = bilinearSample(src.data, w, h, sx + nx * fringeG * 4, sy + ny * fringeG * 4)
      const blue = bilinearSample(src.data, w, h, sx - nx * (chromaShift + fringeB * 8), sy - ny * (chromaShift + fringeB * 8))
      const radial = Math.pow(clamp01(Math.sqrt(r2)), 1.7)
      const radialShaped = Math.pow(radial, 0.3 + (1 - vigMid) * 2.2)
      const shade = vig >= 0 ? clamp01(1 - vig * radialShaped * 0.85) : 1 + Math.abs(vig) * radialShaped * 0.55
      const i = (y * w + x) * 4
      const outOfBounds = sx < 0 || sx > w - 1 || sy < 0 || sy > h - 1
      if (outOfBounds && edgeMode === "transparent") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0
      } else if (outOfBounds && edgeMode === "black") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = mid[3]
      } else if (outOfBounds && edgeMode === "white") {
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = mid[3]
      } else {
        let rr = red[0]
        let gg = mid[1]
        let bb = blue[2]
        if (fringeClean > 0) {
          const rb = (rr + bb) / 2
          const clean = fringeClean * radial
          gg = gg * (1 - clean) + rb * clean
          rr = rr * (1 - clean * 0.3) + rb * clean * 0.3
          bb = bb * (1 - clean * 0.3) + rb * clean * 0.3
        }
        out[i] = clamp8(rr * shade)
        out[i + 1] = clamp8(gg * shade)
        out[i + 2] = clamp8(bb * shade)
        out[i + 3] = mid[3]
      }
    }
  }
  return new ImageData(out, w, h)
}

function colorHalftone(src: ImageData, radius: number, angle: number): ImageData {
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

function mezzotint(src: ImageData, type: string, density: number): ImageData {
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

interface LightConfig {
  type?: "spot" | "point" | "directional" | "omni"
  x?: number
  y?: number
  z?: number
  intensity?: number
  color?: [number, number, number]
  radius?: number
  focus?: number
  angleX?: number
  angleY?: number
}

interface MaterialConfig {
  gloss?: number
  shine?: number
  ambientColor?: [number, number, number]
  exposure?: number
}

function defaultLightsForStyle(style: string, intensityPercent: number): LightConfig[] {
  const intensity = Math.max(0, intensityPercent) / 100
  if (style === "directional") {
    return [{ type: "directional", angleX: -0.5, angleY: -0.7, z: 0.7, intensity, color: [255, 240, 215] }]
  }
  if (style === "omni" || style === "point") {
    return [{ type: "point", x: 0.5, y: 0.5, z: 0.45, intensity, color: [255, 245, 230], radius: 0.7 }]
  }
  if (style === "three-point") {
    return [
      { type: "spot", x: 0.32, y: 0.3, z: 0.55, intensity, color: [255, 235, 200], radius: 0.55, focus: 0.45 },
      { type: "spot", x: 0.72, y: 0.4, z: 0.4, intensity: intensity * 0.55, color: [200, 220, 255], radius: 0.5, focus: 0.35 },
      { type: "point", x: 0.5, y: 0.85, z: 0.3, intensity: intensity * 0.35, color: [255, 215, 180], radius: 0.65 },
    ]
  }
  if (style === "rgb-trio") {
    return [
      { type: "spot", x: 0.25, y: 0.35, z: 0.5, intensity, color: [255, 60, 60], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.55, y: 0.3, z: 0.5, intensity, color: [60, 255, 80], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.75, y: 0.5, z: 0.5, intensity, color: [60, 80, 255], radius: 0.55, focus: 0.4 },
    ]
  }
  return [{ type: "spot", x: 0.45, y: 0.35, z: 0.6, intensity, color: [255, 240, 215], radius: 0.6, focus: 0.4 }]
}

function parseLightsConfig(raw: unknown): LightConfig[] | null {
  if (!raw) return null
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(value)) return null
    return value.filter((entry) => entry && typeof entry === "object") as LightConfig[]
  } catch {
    return null
  }
}

function usesDefaultLightingMaterial(material: MaterialConfig) {
  return (
    (material.gloss ?? 0.5) === 0.5 &&
    (material.shine ?? 0.6) === 0.6 &&
    (material.exposure ?? 0) === 0 &&
    material.ambientColor === undefined
  )
}

function lightingEffectsDefault(src: ImageData, style: string, intensity: number, ambient: number, height: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const light = Math.max(0, intensity) / 100
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const lx = style === "directional" ? -0.5 : 0.35
  const ly = style === "directional" ? -0.7 : -0.45
  const lz = style === "omni" ? 0.95 : 0.7
  const len = Math.hypot(lx, ly, lz)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const xl = Math.max(0, x - 1)
      const xr = Math.min(w - 1, x + 1)
      const yu = Math.max(0, y - 1)
      const yd = Math.min(h - 1, y + 1)
      const right = (y * w + xr) * 4
      const left = (y * w + xl) * 4
      const down = (yd * w + x) * 4
      const up = (yu * w + x) * 4
      const lumX = luma(src.data[right], src.data[right + 1], src.data[right + 2]) - luma(src.data[left], src.data[left + 1], src.data[left + 2])
      const lumY = luma(src.data[down], src.data[down + 1], src.data[down + 2]) - luma(src.data[up], src.data[up + 1], src.data[up + 2])
      const nx = (-lumX / 255) * heightScale
      const ny = (-lumY / 255) * heightScale
      const nz = 1
      const nLen = Math.hypot(nx, ny, nz)
      let spot = 1
      if (style === "spot") {
        const dx = (x - w * 0.45) / w
        const dy = (y - h * 0.35) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2)
      } else if (style === "omni") {
        const dx = (x - w * 0.5) / w
        const dy = (y - h * 0.5) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 1.8)
      }
      const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nLen * len))
      const highlight = Math.pow(diffuse, 18) * light * (0.35 + heightScale)
      const falloff = style === "directional" ? 1 : spot
      const amount = amb + diffuse * light * falloff
      out[i] = clamp8(src.data[i] * amount + (12 + 70 * highlight) * falloff)
      out[i + 1] = clamp8(src.data[i + 1] * amount + (16 + 62 * highlight) * falloff)
      out[i + 2] = clamp8(src.data[i + 2] * amount + (24 + 48 * highlight) * falloff)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

function lightingEffects(
  src: ImageData,
  style: string,
  intensity: number,
  ambient: number,
  height: number,
  lightsRaw?: unknown,
  materialRaw?: unknown,
  bumpSource?: ImageData | null,
  bumpChannel?: "luminance" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const customLights = parseLightsConfig(lightsRaw)
  const material: MaterialConfig = (() => {
    if (!materialRaw) return {}
    try {
      return typeof materialRaw === "string" ? JSON.parse(materialRaw) : (materialRaw as MaterialConfig)
    } catch {
      return {}
    }
  })()
  if (!customLights && !bumpSource && (bumpChannel ?? "luminance") === "luminance" && usesDefaultLightingMaterial(material)) {
    return lightingEffectsDefault(src, style, intensity, ambient, height)
  }
  const lights = customLights ?? defaultLightsForStyle(style, intensity)
  const gloss = Math.max(0, Math.min(1, material.gloss ?? 0.5))
  const shine = Math.max(0, Math.min(1, material.shine ?? 0.6))
  const exposure = Math.pow(2, Math.max(-2, Math.min(2, material.exposure ?? 0)))
  const ambColor = material.ambientColor ?? [255, 255, 255]
  const specExp = 4 + gloss * 96

  // Compute a per-pixel scalar height value from the source or the supplied
  // bump-source image (using the requested channel). The normals are derived
  // from finite differences over the height field.
  const bw = bumpSource?.width ?? w
  const bh = bumpSource?.height ?? h
  const bumpData = bumpSource?.data ?? src.data
  const channel = bumpChannel ?? "luminance"
  const sampleHeight = (px: number, py: number): number => {
    // Scale source-space coords into bump-source space.
    const sx = bumpSource ? Math.min(bw - 1, Math.max(0, Math.round((px / Math.max(1, w - 1)) * (bw - 1)))) : px
    const sy = bumpSource ? Math.min(bh - 1, Math.max(0, Math.round((py / Math.max(1, h - 1)) * (bh - 1)))) : py
    const i = (sy * bw + sx) * 4
    const r = bumpData[i], g = bumpData[i + 1], b = bumpData[i + 2], a = bumpData[i + 3]
    switch (channel) {
      case "red":   return r
      case "green": return g
      case "blue":  return b
      case "alpha": return a
      default:      return luma(r, g, b)
    }
  }

  const nxBuf = new Float32Array(w * h)
  const nyBuf = new Float32Array(w * h)
  const nzBuf = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x
      const xr = x < w - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y
      const yd = y < h - 1 ? y + 1 : y
      const lx = (sampleHeight(xr, y) - sampleHeight(xl, y)) / 255
      const ly = (sampleHeight(x, yd) - sampleHeight(x, yu)) / 255
      const vx = -lx * heightScale * 3
      const vy = -ly * heightScale * 3
      const vz = 1
      const n = Math.hypot(vx, vy, vz) || 1
      const idx = y * w + x
      nxBuf[idx] = vx / n
      nyBuf[idx] = vy / n
      nzBuf[idx] = vz / n
    }
  }

  const diag = Math.hypot(w, h)
  const prep = lights.map((light) => {
    const t = light.type ?? "spot"
    const lc = light.color ?? [255, 255, 255]
    const intensityN = Math.max(0, light.intensity ?? 0.8)
    if (t === "directional") {
      const dx = light.angleX ?? -0.4
      const dy = light.angleY ?? -0.5
      const dz = light.z ?? 0.75
      const n = Math.hypot(dx, dy, dz) || 1
      return { kind: "dir" as const, dx: dx / n, dy: dy / n, dz: dz / n, intensity: intensityN, color: lc }
    }
    return {
      kind: (t === "point" || t === "omni") ? ("point" as const) : ("spot" as const),
      cx: (light.x ?? 0.5) * w,
      cy: (light.y ?? 0.5) * h,
      cz: Math.max(0.05, light.z ?? 0.4) * diag,
      radius: Math.max(0.01, light.radius ?? 0.6) * diag,
      focus: Math.max(0.01, light.focus ?? 0.4),
      intensity: intensityN,
      color: lc,
    }
  })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const idx = y * w + x
      const nX = nxBuf[idx], nY = nyBuf[idx], nZ = nzBuf[idx]

      let rLight = ambColor[0] * amb
      let gLight = ambColor[1] * amb
      let bLight = ambColor[2] * amb

      for (const light of prep) {
        let lx = 0, ly = 0, lz = 0
        let attenuation = 1
        let cone = 1
        if (light.kind === "dir") {
          lx = light.dx; ly = light.dy; lz = light.dz
        } else {
          const dx = light.cx - x
          const dy = light.cy - y
          const dz = light.cz
          const len = Math.hypot(dx, dy, dz) || 1
          lx = dx / len; ly = dy / len; lz = dz / len
          const planar = Math.hypot(dx, dy)
          attenuation = Math.max(0, 1 - planar / light.radius)
          attenuation *= attenuation
          if (light.kind === "spot") {
            const coneAngle = Math.max(0, lz)
            cone = Math.pow(coneAngle, 1 + light.focus * 10)
          }
        }
        const dotN = Math.max(0, nX * lx + nY * ly + nZ * lz)
        const diffuse = dotN * attenuation * cone * light.intensity
        const hx = lx, hy = ly, hz = lz + 1
        const hLen = Math.hypot(hx, hy, hz) || 1
        const specDot = Math.max(0, (nX * hx + nY * hy + nZ * hz) / hLen)
        const specular = Math.pow(specDot, specExp) * shine * attenuation * cone * light.intensity

        rLight += light.color[0] * diffuse + 255 * specular
        gLight += light.color[1] * diffuse + 255 * specular
        bLight += light.color[2] * diffuse + 255 * specular
      }

      out[i] = clamp8((src.data[i] * rLight / 255) * exposure)
      out[i + 1] = clamp8((src.data[i + 1] * gLight / 255) * exposure)
      out[i + 2] = clamp8((src.data[i + 2] * bLight / 255) * exposure)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

function parseKernelMatrix(value: unknown): number[] | null {
  if (typeof value !== "string" || !value.trim()) return null
  const numbers = value
    .trim()
    .split(/[\s,;]+/)
    .map(Number)
    .filter(Number.isFinite)
  const side = Math.sqrt(numbers.length)
  if (!Number.isInteger(side) || side < 3 || side > 7 || side % 2 === 0) return null
  return numbers
}

function customConvolution(src: ImageData, preset: string, strength: number, bias: number, matrix = "", divisor = 0): ImageData {
  const kernels: Record<string, number[]> = {
    "sharpen-more": [0, -1, 0, -1, 5, -1, 0, -1, 0],
    "edge-enhance": [0, 0, 0, -1, 1, 0, 0, 0, 0],
    outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    "sobel-x": [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    "sobel-y": [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  }
  const kernel = parseKernelMatrix(matrix) ?? kernels[preset] ?? kernels["sharpen-more"]
  const kernelSum = kernel.reduce((sum, value) => sum + value, 0)
  const raw = convolve(src, kernel, divisor ? divisor : kernelSum > 0 ? kernelSum : 1)
  const mix = Math.max(0, Math.min(200, strength)) / 100
  const offset = Math.max(-255, Math.min(255, bias))
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + (raw.data[i] + offset) * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + (raw.data[i + 1] + offset) * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + (raw.data[i + 2] + offset) * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

/* --------- APPLY IMAGE / CALCULATIONS --------- */

type ApplyChannel = "rgb" | "red" | "green" | "blue" | "luminance" | "alpha" | "gray"

function selectChannelValue(data: Uint8ClampedArray, i: number, channel: ApplyChannel): [number, number, number] {
  switch (channel) {
    case "red":   return [data[i], data[i], data[i]]
    case "green": return [data[i + 1], data[i + 1], data[i + 1]]
    case "blue":  return [data[i + 2], data[i + 2], data[i + 2]]
    case "alpha": return [data[i + 3], data[i + 3], data[i + 3]]
    case "gray":
    case "luminance": {
      const v = luma(data[i], data[i + 1], data[i + 2])
      return [v, v, v]
    }
    default:
      return [data[i], data[i + 1], data[i + 2]]
  }
}

function resampleImageData(src: ImageData, targetW: number, targetH: number): ImageData {
  if (src.width === targetW && src.height === targetH) return src
  const out = new ImageData(targetW, targetH)
  const sxScale = src.width / targetW
  const syScale = src.height / targetH
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * sxScale))
      const sy = Math.min(src.height - 1, Math.floor(y * syScale))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetW + x) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return out
}

function pixelBlend(
  dr: number, dg: number, db: number,
  sr: number, sg: number, sb: number,
  mode: string,
): [number, number, number] {
  const b = [dr / 255, dg / 255, db / 255]
  const s = [sr / 255, sg / 255, sb / 255]
  const apply = (fn: (a: number, c: number) => number) =>
    [fn(b[0], s[0]), fn(b[1], s[1]), fn(b[2], s[2])] as [number, number, number]
  let out: [number, number, number]
  switch (mode) {
    case "multiply":     out = apply((a, c) => a * c); break
    case "screen":       out = apply((a, c) => 1 - (1 - a) * (1 - c)); break
    case "overlay":      out = apply((a, c) => a < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "soft-light":   out = apply((a, c) => c <= 0.5 ? a - (1 - 2 * c) * a * (1 - a) : a + (2 * c - 1) * ((a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a)); break
    case "hard-light":   out = apply((a, c) => c < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "darken":       out = apply((a, c) => Math.min(a, c)); break
    case "lighten":      out = apply((a, c) => Math.max(a, c)); break
    case "difference":   out = apply((a, c) => Math.abs(a - c)); break
    case "exclusion":    out = apply((a, c) => a + c - 2 * a * c); break
    case "color-burn":   out = apply((a, c) => c === 0 ? 0 : Math.max(0, 1 - (1 - a) / c)); break
    case "linear-burn":  out = apply((a, c) => Math.max(0, a + c - 1)); break
    case "color-dodge":  out = apply((a, c) => c >= 1 ? 1 : Math.min(1, a / (1 - c))); break
    case "linear-dodge": out = apply((a, c) => Math.min(1, a + c)); break
    case "vivid-light":  out = apply((a, c) => c <= 0.5 ? (c === 0 ? 0 : Math.max(0, 1 - (1 - a) / (2 * c))) : (2 * (c - 0.5) >= 1 ? 1 : Math.min(1, a / (1 - 2 * (c - 0.5))))); break
    case "linear-light": out = apply((a, c) => Math.max(0, Math.min(1, a + 2 * c - 1))); break
    case "pin-light":    out = apply((a, c) => c <= 0.5 ? Math.min(a, 2 * c) : Math.max(a, 2 * c - 1)); break
    case "hard-mix":     out = apply((a, c) => a + c >= 1 ? 1 : 0); break
    case "subtract":     out = apply((a, c) => Math.max(0, a - c)); break
    case "divide":       out = apply((a, c) => c === 0 ? 1 : Math.min(1, a / c)); break
    case "add":          out = apply((a, c) => Math.min(1, a + c)); break
    default:             out = [s[0], s[1], s[2]] // normal
  }
  return [clamp8(out[0] * 255), clamp8(out[1] * 255), clamp8(out[2] * 255)]
}

function applyImageFilter(
  src: ImageData,
  source: ImageData | null,
  channel: ApplyChannel,
  blendMode: string,
  opacity: number,
  invert: boolean,
  preserveTransparency: boolean,
): ImageData {
  if (!source) return clone(src)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const sample = resampleImageData(source, w, h)
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [sr, sg, sb] = selectChannelValue(sample.data, i, channel)
      if (invert) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb }
      const dr = src.data[i], dg = src.data[i + 1], db = src.data[i + 2]
      const [br, bg, bb] = pixelBlend(dr, dg, db, sr, sg, sb, blendMode)
      out[i] = clamp8(dr * (1 - op) + br * op)
      out[i + 1] = clamp8(dg * (1 - op) + bg * op)
      out[i + 2] = clamp8(db * (1 - op) + bb * op)
      out[i + 3] = preserveTransparency ? src.data[i + 3] : Math.max(src.data[i + 3], sample.data[i + 3])
    }
  }
  return new ImageData(out, w, h)
}

function calculationsFilter(
  src: ImageData,
  sourceA: ImageData | null,
  sourceB: ImageData | null,
  channelA: ApplyChannel,
  channelB: ApplyChannel,
  blendMode: string,
  opacity: number,
  invertA: boolean,
  invertB: boolean,
  resultChannel: "gray" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const a = sourceA ? resampleImageData(sourceA, w, h) : src
  const b = sourceB ? resampleImageData(sourceB, w, h) : src
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [ar, ag, ab] = selectChannelValue(a.data, i, channelA)
      let [br, bg, bb] = selectChannelValue(b.data, i, channelB)
      if (invertA) { ar = 255 - ar; ag = 255 - ag; ab = 255 - ab }
      if (invertB) { br = 255 - br; bg = 255 - bg; bb = 255 - bb }
      const [r, g, bl] = pixelBlend(ar, ag, ab, br, bg, bb, blendMode)
      const mixed = clamp8(luma(r, g, bl)) * op + clamp8(luma(ar, ag, ab)) * (1 - op)
      const v = clamp8(mixed)
      switch (resultChannel) {
        case "red":   out[i] = v; break
        case "green": out[i + 1] = v; break
        case "blue":  out[i + 2] = v; break
        case "alpha": out[i + 3] = v; break
        default:      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = src.data[i + 3] || 255
      }
    }
  }
  return new ImageData(out, w, h)
}

/* --------- REDUCE NOISE (Bilateral Filter) --------- */

function reduceNoise(src: ImageData, strength: number, colorNoise: number, detail: number, sharpen: number): ImageData {
  const w = src.width, h = src.height
  const noiseStrength = Math.max(0, Math.min(10, strength))
  const colorK = Math.max(0, Math.min(100, colorNoise)) / 100
  if (noiseStrength <= 0 && colorK <= 0 && sharpen <= 0) return clone(src)

  const sigmaS = Math.max(0.5, noiseStrength * 1.35) // spatial sigma
  const sigmaR = Math.max(1, (105 - Math.max(0, Math.min(100, detail))) * (1.1 + noiseStrength * 0.32))
  const r = Math.min(Math.ceil(sigmaS * 2), 7)

  // Phase 1: Bilateral luminance denoise
  const out = new Uint8ClampedArray(src.data)
  if (noiseStrength > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = (y * w + x) * 4
        const cR = src.data[ci], cG = src.data[ci + 1], cB = src.data[ci + 2]
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.max(0, Math.min(w - 1, x + dx))
            const sy = Math.max(0, Math.min(h - 1, y + dy))
            const si = (sy * w + sx) * 4
            const nR = src.data[si], nG = src.data[si + 1], nB = src.data[si + 2]

            const spatialDist = (dx * dx + dy * dy) / (2 * sigmaS * sigmaS)
            const colorDist = ((cR - nR) ** 2 + (cG - nG) ** 2 + (cB - nB) ** 2) / (2 * sigmaR * sigmaR * 3)
            const weight = Math.exp(-spatialDist - colorDist)

            rSum += nR * weight; gSum += nG * weight; bSum += nB * weight
            wSum += weight
          }
        }
        out[ci] = wSum ? clamp8(rSum / wSum) : src.data[ci]
        out[ci + 1] = wSum ? clamp8(gSum / wSum) : src.data[ci + 1]
        out[ci + 2] = wSum ? clamp8(bSum / wSum) : src.data[ci + 2]
        out[ci + 3] = src.data[ci + 3]
      }
    }
  }

  // Phase 2: Color noise reduction (average chrominance in neighborhood)
  if (colorK > 0) {
    const cr = Math.min(3, Math.ceil(colorK * 3))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = (y * w + x) * 4
        let rAvg = 0, gAvg = 0, bAvg = 0, cnt = 0
        for (let dy = -cr; dy <= cr; dy++) {
          for (let dx = -cr; dx <= cr; dx++) {
            const sx = Math.max(0, Math.min(w - 1, x + dx))
            const sy = Math.max(0, Math.min(h - 1, y + dy))
            const si = (sy * w + sx) * 4
            rAvg += out[si]; gAvg += out[si + 1]; bAvg += out[si + 2]
            cnt++
          }
        }
        rAvg /= cnt; gAvg /= cnt; bAvg /= cnt
        out[ci] = clamp8(out[ci] * (1 - colorK) + rAvg * colorK)
        out[ci + 1] = clamp8(out[ci + 1] * (1 - colorK) + gAvg * colorK)
        out[ci + 2] = clamp8(out[ci + 2] * (1 - colorK) + bAvg * colorK)
      }
    }
  }

  // Phase 3: Sharpening pass to restore details
  if (sharpen > 0) {
    const sK = sharpen / 200
    const blurred = gaussianBlur(new ImageData(new Uint8ClampedArray(out), w, h), 0.5)
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        out[i + c] = clamp8(out[i + c] + (out[i + c] - blurred.data[i + c]) * sK)
      }
    }
  }

  return new ImageData(out, w, h)
}

/* --------- DUST & SCRATCHES (Adaptive Median) --------- */

function dustAndScratches(src: ImageData, radius: number, threshold: number): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const r = Math.max(1, Math.min(16, Math.floor(radius)))
  const t = Math.max(0, Math.min(255, threshold))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4
      const origR = src.data[ci], origG = src.data[ci + 1], origB = src.data[ci + 2]
      const origLum = luma(origR, origG, origB)

      // Collect neighborhood pixels
      const rVals: number[] = [], gVals: number[] = [], bVals: number[] = [], lVals: number[] = []
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue
          const sx = Math.max(0, Math.min(w - 1, x + dx))
          const sy = Math.max(0, Math.min(h - 1, y + dy))
          const si = (sy * w + sx) * 4
          rVals.push(src.data[si]); gVals.push(src.data[si + 1]); bVals.push(src.data[si + 2])
          lVals.push(luma(src.data[si], src.data[si + 1], src.data[si + 2]))
        }
      }
      if (!rVals.length) continue

      // Sort to find median
      rVals.sort((a, b) => a - b)
      gVals.sort((a, b) => a - b)
      bVals.sort((a, b) => a - b)
      lVals.sort((a, b) => a - b)
      const mid = Math.floor(rVals.length / 2)
      const medR = rVals[mid], medG = gVals[mid], medB = bVals[mid]
      const medLum = lVals[mid]

      // Replace isolated dust/scratch impulses, but leave normal edge pixels intact.
      const impulse = Math.abs(origLum - medLum)
      if (impulse > t) {
        const mix = t <= 0 ? 1 : clamp01((impulse - t) / Math.max(1, 255 - t))
        out[ci] = clamp8(origR * (1 - mix) + medR * mix)
        out[ci + 1] = clamp8(origG * (1 - mix) + medG * mix)
        out[ci + 2] = clamp8(origB * (1 - mix) + medB * mix)
      }
    }
  }
  return new ImageData(out, w, h)
}

/* --------- GAP REPORT LEGACY FILTERS --------- */

function averageBlur(src: ImageData): ImageData {
  let r = 0, g = 0, b = 0, a = 0, count = 0
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = src.data[i + 3] / 255
    if (alpha <= 0) continue
    r += src.data[i] * alpha
    g += src.data[i + 1] * alpha
    b += src.data[i + 2] * alpha
    a += src.data[i + 3]
    count += alpha
  }
  const out = new Uint8ClampedArray(src.data.length)
  const rr = count ? r / count : 0
  const gg = count ? g / count : 0
  const bb = count ? b / count : 0
  const aa = src.data.length ? a / (src.data.length / 4) : 255
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rr
    out[i + 1] = gg
    out[i + 2] = bb
    out[i + 3] = aa
  }
  return new ImageData(out, src.width, src.height)
}

function smartBlur(src: ImageData, radius: number, threshold: number): ImageData {
  const blurred = gaussianBlur(src, radius)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const keep = edges.data[i] > threshold
    out[i] = keep ? src.data[i] : blurred.data[i]
    out[i + 1] = keep ? src.data[i + 1] : blurred.data[i + 1]
    out[i + 2] = keep ? src.data[i + 2] : blurred.data[i + 2]
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function despeckle(src: ImageData): ImageData {
  return smartBlur(src, 1.4, 42)
}

function ntscColors(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const max = Math.max(out[i], out[i + 1], out[i + 2])
    const min = Math.min(out[i], out[i + 1], out[i + 2])
    const sat = max - min
    if (sat > 110 || max > 235 || min < 16) {
      const lum = luma(out[i], out[i + 1], out[i + 2])
      const scale = Math.min(1, 110 / Math.max(1, sat))
      out[i] = clamp8(lum + (out[i] - lum) * scale)
      out[i + 1] = clamp8(lum + (out[i + 1] - lum) * scale)
      out[i + 2] = clamp8(lum + (out[i + 2] - lum) * scale)
      out[i] = Math.min(235, Math.max(16, out[i]))
      out[i + 1] = Math.min(235, Math.max(16, out[i + 1]))
      out[i + 2] = Math.min(235, Math.max(16, out[i + 2]))
    }
  }
  return new ImageData(out, src.width, src.height)
}

function _deInterlace(src: ImageData, field: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const even = field !== "odd"
  for (let y = even ? 1 : 0; y < src.height; y += 2) {
    const above = Math.max(0, y - 1)
    const below = Math.min(src.height - 1, y + 1)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const a = (above * src.width + x) * 4
      const b = (below * src.width + x) * 4
      out[i] = (src.data[a] + src.data[b]) / 2
      out[i + 1] = (src.data[a + 1] + src.data[b + 1]) / 2
      out[i + 2] = (src.data[a + 2] + src.data[b + 2]) / 2
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

function glowingEdges(src: ImageData, width: number, brightness: number, smooth: number): ImageData {
  const edge = gaussianBlur(findEdges(src), smooth)
  const out = new Uint8ClampedArray(src.data.length)
  const gain = brightness / 80
  for (let i = 0; i < out.length; i += 4) {
    const e = Math.pow(edge.data[i] / 255, Math.max(0.4, width / 5))
    out[i] = clamp8(20 + e * 50)
    out[i + 1] = clamp8(80 + e * 220 * gain)
    out[i + 2] = clamp8(120 + e * 255 * gain)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function wind(src: ImageData, strength: number, direction: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const right = direction !== "left"
  const steps = Math.max(1, Math.round(strength))
  for (let y = 0; y < src.height; y++) {
    let carry = [0, 0, 0, 0]
    const start = right ? 0 : src.width - 1
    const end = right ? src.width : -1
    const step = right ? 1 : -1
    for (let x = start; x !== end; x += step) {
      const i = (y * src.width + x) * 4
      const bright = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
      const mix = Math.min(0.92, bright * steps * 0.06)
      out[i] = clamp8(src.data[i] * (1 - mix) + carry[0] * mix)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + carry[1] * mix)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + carry[2] * mix)
      out[i + 3] = src.data[i + 3]
      carry = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    }
  }
  return new ImageData(out, src.width, src.height)
}

function extrude(src: ImageData, depth: number, mode: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const dx = Math.round(depth * 0.6)
  const dy = Math.round(depth * 0.45)
  for (let y = src.height - 1; y >= 0; y--) {
    for (let x = src.width - 1; x >= 0; x--) {
      const si = (y * src.width + x) * 4
      if (src.data[si + 3] < 8) continue
      for (let d = 1; d <= depth; d++) {
        const tx = x + Math.round((dx * d) / depth)
        const ty = y + Math.round((dy * d) / depth)
        if (tx < 0 || ty < 0 || tx >= src.width || ty >= src.height) continue
        const ti = (ty * src.width + tx) * 4
        const shade = mode === "pyramid" ? 1 - d / (depth * 1.4) : 0.72
        out[ti] = clamp8(src.data[si] * shade)
        out[ti + 1] = clamp8(src.data[si + 1] * shade)
        out[ti + 2] = clamp8(src.data[si + 2] * shade)
        out[ti + 3] = Math.max(out[ti + 3], src.data[si + 3])
      }
    }
  }
  return new ImageData(out, src.width, src.height)
}

function renderFlame(src: ImageData, heightPct: number, turbulence: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const base = src.height - 1
  const maxH = Math.max(8, src.height * (heightPct / 100))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const rise = (base - y) / maxH
      const n = fbmNoise(x / 80, y / 80, 41, 5)
      const flame = Math.max(0, Math.min(1, rise + (n - 0.5) * (turbulence / 50)))
      if (flame <= 0) continue
      out[i] = clamp8(out[i] * (1 - flame) + 255 * flame)
      out[i + 1] = clamp8(out[i + 1] * (1 - flame) + (80 + flame * 150) * flame)
      out[i + 2] = clamp8(out[i + 2] * (1 - flame) + 20 * flame)
      out[i + 3] = Math.max(out[i + 3], flame * 220)
    }
  }
  return new ImageData(out, src.width, src.height)
}

function pictureFrame(src: ImageData, size: number, color: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const c = parseHexColor(color)
  const inset = Math.max(1, Math.round(size))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const border = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
      if (border > inset) continue
      const i = (y * src.width + x) * 4
      const shade = border < inset * 0.45 ? 0.7 : 1.18
      out[i] = clamp8(c.r * shade)
      out[i + 1] = clamp8(c.g * shade)
      out[i + 2] = clamp8(c.b * shade)
      out[i + 3] = 255
    }
  }
  return new ImageData(out, src.width, src.height)
}

function renderTree(src: ImageData, branches: number, leaves: boolean): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const drawPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return
    const i = (Math.floor(y) * src.width + Math.floor(x)) * 4
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.max(out[i + 3], a)
  }
  const branch = (x: number, y: number, len: number, angle: number, depth: number) => {
    const x2 = x + Math.cos(angle) * len
    const y2 = y + Math.sin(angle) * len
    const steps = Math.max(1, Math.round(len))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      drawPixel(x + (x2 - x) * t, y + (y2 - y) * t, 92, 58, 33)
    }
    if (depth <= 0) {
      if (leaves) {
        for (let i = 0; i < 18; i++) drawPixel(x2 + (hashNoise(i, x2, 2) - 0.5) * 30, y2 + (hashNoise(i, y2, 3) - 0.5) * 18, 42, 132 + hashNoise(i, x2, 4) * 90, 58)
      }
      return
    }
    for (let i = 0; i < branches; i++) {
      const spread = (i - (branches - 1) / 2) * 0.34
      branch(x2, y2, len * (0.62 + hashNoise(depth, i, 5) * 0.12), angle - 0.45 + spread, depth - 1)
    }
  }
  branch(src.width / 2, src.height - 8, src.height * 0.22, -Math.PI / 2, 6)
  return new ImageData(out, src.width, src.height)
}

function displace(
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

function shapeBlur(src: ImageData, radius: number, shape: string): ImageData {
  if (radius <= 0) return clone(src)
  const out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const inside = shape === "diamond" ? Math.abs(dx) + Math.abs(dy) <= r : shape === "line" ? Math.abs(dy) <= 1 : dx * dx + dy * dy <= r * r
          if (!inside) continue
          const sx = Math.max(0, Math.min(src.width - 1, x + dx))
          const sy = Math.max(0, Math.min(src.height - 1, y + dy))
          const i = (sy * src.width + sx) * 4
          rs += src.data[i]; gs += src.data[i + 1]; bs += src.data[i + 2]; as_ += src.data[i + 3]; n++
        }
      }
      const o = (y * src.width + x) * 4
      out[o] = rs / n; out[o + 1] = gs / n; out[o + 2] = bs / n; out[o + 3] = as_ / n
    }
  }
  return new ImageData(out, src.width, src.height)
}

function diffuseGlow(src: ImageData, grain: number, glow: number, clear: number): ImageData {
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

function oceanRipple(src: ImageData, size: number, magnitude: number): ImageData {
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

function galleryStylize(src: ImageData, style: string, intensity: number): ImageData {
  let work = clone(src)
  const amount = intensity / 100
  if (style.includes("edge") || style.includes("outline") || style.includes("pen") || style.includes("photocopy")) {
    work = findEdges(src)
  } else if (style.includes("blur") || style.includes("pastel") || style.includes("water") || style.includes("daub") || style.includes("sumi")) {
    work = gaussianBlur(src, 1 + amount * 5)
  } else if (style.includes("grain") || style.includes("reticulation") || style.includes("sponge") || style.includes("spatter")) {
    work = addProceduralGrain(src, amount * 70, style)
  } else if (style.includes("cutout") || style.includes("stamp") || style.includes("poster") || style.includes("palette")) {
    work = posterizeImage(src, Math.max(2, Math.round(8 - amount * 5)))
  } else if (style.includes("chrome") || style.includes("plastic") || style.includes("bas relief") || style.includes("plaster")) {
    work = embossLike(src, amount)
  } else {
    work = convolve(src, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1)
  }
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const paper = style.includes("paper") || style.includes("texture") || style.includes("craquelure") || style.includes("tiles") || style.includes("glass")
      ? (hashNoise(i, intensity, 31) - 0.5) * 42 * amount
      : 0
    out[i] = clamp8(src.data[i] * (1 - amount) + work.data[i] * amount + paper)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + work.data[i + 1] * amount + paper)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + work.data[i + 2] * amount + paper)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function addProceduralGrain(src: ImageData, amount: number, salt: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const seed = salt.length * 17
  for (let i = 0; i < out.length; i += 4) {
    const n = (hashNoise(i, seed, 3) - 0.5) * amount
    out[i] = clamp8(out[i] + n)
    out[i + 1] = clamp8(out[i + 1] + n)
    out[i + 2] = clamp8(out[i + 2] + n)
  }
  return new ImageData(out, src.width, src.height)
}

function posterizeImage(src: ImageData, levels: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(out[i] / step) * step
    out[i + 1] = Math.round(out[i + 1] / step) * step
    out[i + 2] = Math.round(out[i + 2] / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

function embossLike(src: ImageData, amount: number): ImageData {
  const edge = convolve(src, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const v = 128 + (luma(edge.data[i], edge.data[i + 1], edge.data[i + 2]) - 128) * (1 + amount * 2)
    out[i] = clamp8(src.data[i] * (1 - amount) + v * amount)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + v * amount)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + v * amount)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function blendImageData(src: ImageData, work: ImageData, amount: number): ImageData {
  const mix = clamp01(amount)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + work.data[i] * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + work.data[i + 1] * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + work.data[i + 2] * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

function coloredPencilFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const hatch = ((x + y * 2) % 5 === 0 ? -28 : (hashNoise(x, y, 17) - 0.5) * 18) * amount
      const edgeDark = (255 - edges.data[i]) * 0.45 * amount
      const paper = 238 + hatch - edgeDark
      out[i] = clamp8(paper * 0.56 + src.data[i] * 0.44 * (lum / 255 + 0.45))
      out[i + 1] = clamp8(paper * 0.56 + src.data[i + 1] * 0.44 * (lum / 255 + 0.45))
      out[i + 2] = clamp8(paper * 0.56 + src.data[i + 2] * 0.44 * (lum / 255 + 0.45))
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function dryBrushFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const smoothed = surfaceBlur(src, 1 + amount * 3, 42 + amount * 72)
  const blocked = posterizeImage(smoothed, Math.max(4, Math.round(9 - amount * 4)))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const left = (y * src.width + Math.max(0, x - 1)) * 4
      const streak = (blocked.data[left] - blocked.data[i]) * 0.18 * amount
      out[i] = clamp8(blocked.data[i] + streak)
      out[i + 1] = clamp8(blocked.data[i + 1] + streak)
      out[i + 2] = clamp8(blocked.data[i + 2] + streak)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function watercolorFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const wash = surfaceBlur(src, 2 + amount * 4, 95)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const pigment = 0.82 + (hashNoise(i, intensity, 43) - 0.5) * 0.12 * amount
    const edgeDark = (255 - edges.data[i]) * 0.22 * amount
    out[i] = clamp8(wash.data[i] * pigment - edgeDark)
    out[i + 1] = clamp8(wash.data[i + 1] * pigment - edgeDark)
    out[i + 2] = clamp8(wash.data[i + 2] * (pigment + 0.03) - edgeDark)
    out[i + 3] = src.data[i + 3]
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function crosshatchFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let ink = 255 - lum
      if ((x + y) % 4 === 0) ink += 58 * amount
      if ((x - y + 16) % 5 === 0 && lum < 180) ink += 78 * amount
      if ((x + y * 3) % 7 === 0 && lum < 110) ink += 92 * amount
      const v = clamp8(255 - ink)
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function graphicPenFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const line = ((x * 2 + y) % 6) / 6
      const threshold = 218 - amount * 96 + line * 86
      const v = lum > threshold ? 245 : 18
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function craquelureFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const n1 = fbmNoise(x / 4, y / 4, 71, 3)
      const n2 = fbmNoise((x + 3) / 3, (y - 5) / 3, 109, 2)
      const crack = Math.abs(n1 - n2) < 0.085 + amount * 0.035 ? 1 : 0
      const relief = (n1 - 0.5) * 46 * amount
      const dark = crack * (95 + 75 * amount)
      out[i] = clamp8(src.data[i] + relief - dark)
      out[i + 1] = clamp8(src.data[i + 1] + relief - dark)
      out[i + 2] = clamp8(src.data[i + 2] + relief - dark)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

function mosaicTilesFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const tile = Math.max(2, Math.round(5 - amount * 2))
  const grout = Math.max(28, Math.round(70 * amount))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const tx = Math.floor(x / tile) * tile
      const ty = Math.floor(y / tile) * tile
      let rs = 0, gs = 0, bs = 0, n = 0
      for (let yy = ty; yy < Math.min(src.height, ty + tile); yy++) {
        for (let xx = tx; xx < Math.min(src.width, tx + tile); xx++) {
          const p = (yy * src.width + xx) * 4
          rs += src.data[p]; gs += src.data[p + 1]; bs += src.data[p + 2]; n++
        }
      }
      const i = (y * src.width + x) * 4
      const seam = x % tile === 0 || y % tile === 0
      out[i] = seam ? grout : clamp8(rs / n)
      out[i + 1] = seam ? grout : clamp8(gs / n)
      out[i + 2] = seam ? grout : clamp8(bs / n)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

function copySample(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number) {
  const ix = Math.max(0, Math.min(src.width - 1, Math.round(sx)))
  const iy = Math.max(0, Math.min(src.height - 1, Math.round(sy)))
  const s = (iy * src.width + ix) * 4
  const d = (y * src.width + x) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

function copySampleWithEdge(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number, edgeMode: string) {
  let ix = Math.round(sx)
  let iy = Math.round(sy)
  const d = (y * src.width + x) * 4
  if (edgeMode === "wrap") {
    ix = ((ix % src.width) + src.width) % src.width
    iy = ((iy % src.height) + src.height) % src.height
  } else if (edgeMode === "transparent") {
    if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) {
      out[d] = 0
      out[d + 1] = 0
      out[d + 2] = 0
      out[d + 3] = 0
      return
    }
  } else {
    ix = Math.max(0, Math.min(src.width - 1, ix))
    iy = Math.max(0, Math.min(src.height - 1, iy))
  }
  const s = (iy * src.width + ix) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

function parseHexColor(color: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "111827"
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function hashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

function legacyGalleryDefs(items: { id: string; name: string; category: string; intensity?: number }[]) {
  return Object.fromEntries(items.map((item) => [
    item.id,
    {
      id: item.id,
      name: `${item.name} (approx.)`,
      category: item.category,
      params: [
        { type: "slider" as const, key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: item.intensity ?? 68, suffix: "%" },
      ],
      apply: (src: ImageData, p: Record<string, number | string | boolean>) => galleryStylize(src, item.id.replace(/-/g, " "), Number(p.intensity)),
    } satisfies FilterDef,
  ]))
}

function promotedGalleryDef(
  id: string,
  name: string,
  category: string,
  apply: (src: ImageData, intensity: number) => ImageData,
  intensity = 68,
): FilterDef {
  return {
    id,
    name,
    category,
    params: [
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: intensity, suffix: "%" },
    ],
    apply: (src, p) => apply(src, Number(p.intensity)),
  }
}

const PROMOTED_GALLERY_FILTERS: Record<string, FilterDef> = {
  "colored-pencil": promotedGalleryDef("colored-pencil", "Colored Pencil", "Artistic", coloredPencilFilter),
  "dry-brush": promotedGalleryDef("dry-brush", "Dry Brush", "Artistic", dryBrushFilter),
  watercolor: promotedGalleryDef("watercolor", "Watercolor", "Artistic", watercolorFilter),
  crosshatch: promotedGalleryDef("crosshatch", "Crosshatch", "Brush Strokes", crosshatchFilter),
  "graphic-pen": promotedGalleryDef("graphic-pen", "Graphic Pen", "Sketch", graphicPenFilter),
  craquelure: promotedGalleryDef("craquelure", "Craquelure", "Texture", craquelureFilter),
  "mosaic-tiles": promotedGalleryDef("mosaic-tiles", "Mosaic Tiles", "Texture", mosaicTilesFilter),
}

/* ----------- new stylize / pixelate / distort filters ----------- */

function fragment(src: ImageData): ImageData {
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

function facet(src: ImageData, threshold = 22): ImageData {
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

function pointillize(src: ImageData, cellSize: number, background = "#ffffff"): ImageData {
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

function shear(src: ImageData, amount: number, edgeMode: string): ImageData {
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

function tilesFilter(src: ImageData, numberOfTiles: number, maxOffset: number, fill: string): ImageData {
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

function diffuse(src: ImageData, mode: string, amount: number): ImageData {
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
function deInterlaceAdvanced(src: ImageData, field: string, method: string): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const odd = field === "odd"
  // Replace odd/even rows
  for (let y = odd ? 1 : 0; y < h; y += 2) {
    const above = Math.max(0, y - 1)
    const below = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      const ai = (above * w + x) * 4
      const bi = (below * w + x) * 4
      if (method === "duplication") {
        // Duplicate the nearest kept row above
        out[di] = src.data[ai]
        out[di + 1] = src.data[ai + 1]
        out[di + 2] = src.data[ai + 2]
        out[di + 3] = src.data[ai + 3]
      } else {
        // interpolation: average neighbour rows
        out[di] = (src.data[ai] + src.data[bi]) >> 1
        out[di + 1] = (src.data[ai + 1] + src.data[bi + 1]) >> 1
        out[di + 2] = (src.data[ai + 2] + src.data[bi + 2]) >> 1
        out[di + 3] = src.data[di + 3]
      }
    }
  }
  return new ImageData(out, w, h)
}

const LEGACY_GAP_FILTERS: Record<string, FilterDef> = {
  ...legacyGalleryDefs([
    { id: "colored-pencil", name: "Colored Pencil", category: "Artistic" },
    { id: "cutout", name: "Cutout", category: "Artistic" },
    { id: "dry-brush", name: "Dry Brush", category: "Artistic" },
    { id: "film-grain", name: "Film Grain", category: "Artistic" },
    { id: "fresco", name: "Fresco", category: "Artistic" },
    { id: "neon-glow", name: "Neon Glow", category: "Artistic" },
    { id: "paint-daubs", name: "Paint Daubs", category: "Artistic" },
    { id: "palette-knife", name: "Palette Knife", category: "Artistic" },
    { id: "plastic-wrap", name: "Plastic Wrap", category: "Artistic" },
    { id: "poster-edges", name: "Poster Edges", category: "Artistic" },
    { id: "rough-pastels", name: "Rough Pastels", category: "Artistic" },
    { id: "smudge-stick", name: "Smudge Stick", category: "Artistic" },
    { id: "sponge-filter", name: "Sponge", category: "Artistic" },
    { id: "underpainting", name: "Underpainting", category: "Artistic" },
    { id: "watercolor", name: "Watercolor", category: "Artistic" },
    { id: "accented-edges", name: "Accented Edges", category: "Brush Strokes" },
    { id: "angled-strokes", name: "Angled Strokes", category: "Brush Strokes" },
    { id: "crosshatch", name: "Crosshatch", category: "Brush Strokes" },
    { id: "dark-strokes", name: "Dark Strokes", category: "Brush Strokes" },
    { id: "ink-outlines", name: "Ink Outlines", category: "Brush Strokes" },
    { id: "spatter", name: "Spatter", category: "Brush Strokes" },
    { id: "sprayed-strokes", name: "Sprayed Strokes", category: "Brush Strokes" },
    { id: "sumi-e", name: "Sumi-e", category: "Brush Strokes" },
    { id: "bas-relief", name: "Bas Relief", category: "Sketch" },
    { id: "chalk-charcoal", name: "Chalk & Charcoal", category: "Sketch" },
    { id: "charcoal", name: "Charcoal", category: "Sketch" },
    { id: "chrome", name: "Chrome", category: "Sketch" },
    { id: "conte-crayon", name: "Conte Crayon", category: "Sketch" },
    { id: "graphic-pen", name: "Graphic Pen", category: "Sketch" },
    { id: "halftone-pattern", name: "Halftone Pattern", category: "Sketch" },
    { id: "note-paper", name: "Note Paper", category: "Sketch" },
    { id: "photocopy", name: "Photocopy", category: "Sketch" },
    { id: "plaster", name: "Plaster", category: "Sketch" },
    { id: "reticulation", name: "Reticulation", category: "Sketch" },
    { id: "stamp-filter", name: "Stamp", category: "Sketch" },
    { id: "torn-edges", name: "Torn Edges", category: "Sketch" },
    { id: "water-paper", name: "Water Paper", category: "Sketch" },
    { id: "craquelure", name: "Craquelure", category: "Texture" },
    { id: "grain", name: "Grain", category: "Texture" },
    { id: "mosaic-tiles", name: "Mosaic Tiles", category: "Texture" },
    { id: "patchwork", name: "Patchwork", category: "Texture" },
    { id: "stained-glass", name: "Stained Glass", category: "Texture" },
    { id: "texturizer", name: "Texturizer", category: "Texture" },
  ]),
  ...PROMOTED_GALLERY_FILTERS,
  "average-blur": { id: "average-blur", name: "Average", category: "Blur", params: [], apply: (src) => averageBlur(src) },
  "blur-more": { id: "blur-more", name: "Blur More", category: "Blur", params: [], apply: (src) => boxBlur(src, 3) },
  "smart-blur": {
    id: "smart-blur",
    name: "Smart Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 32, step: 0.1, default: 4, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 38 },
    ],
    apply: (src, p) => smartBlur(src, Number(p.radius), Number(p.threshold)),
  },
  "shape-blur": {
    id: "shape-blur",
    name: "Shape Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 40, step: 1, default: 8, suffix: "px" },
      { type: "select", key: "shape", label: "Shape", options: [
        { value: "circle", label: "Circle" },
        { value: "diamond", label: "Diamond" },
        { value: "line", label: "Line" },
      ], default: "circle" },
    ],
    apply: (src, p) => shapeBlur(src, Number(p.radius), String(p.shape)),
  },
  despeckle: { id: "despeckle", name: "Despeckle", category: "Noise", params: [], apply: (src) => despeckle(src) },
  "ntsc-colors": { id: "ntsc-colors", name: "NTSC Colors", category: "Video", params: [], apply: (src) => ntscColors(src) },
  "de-interlace": {
    id: "de-interlace",
    name: "De-Interlace",
    category: "Video",
    params: [
      { type: "select", key: "field", label: "Eliminate", options: [
        { value: "even", label: "Even Fields" },
        { value: "odd", label: "Odd Fields" },
      ], default: "even" },
      { type: "select", key: "method", label: "Create New Fields by", options: [
        { value: "duplication", label: "Duplication" },
        { value: "interpolation", label: "Interpolation" },
      ], default: "interpolation" },
    ],
    apply: (src, p) => deInterlaceAdvanced(src, String(p.field ?? "even"), String(p.method ?? "interpolation")),
  },
  "glowing-edges": {
    id: "glowing-edges",
    name: "Glowing Edges",
    category: "Stylize",
    params: [
      { type: "slider", key: "width", label: "Edge Width", min: 1, max: 14, step: 1, default: 4 },
      { type: "slider", key: "brightness", label: "Brightness", min: 0, max: 100, step: 1, default: 55 },
      { type: "slider", key: "smooth", label: "Smoothness", min: 0, max: 10, step: 1, default: 2 },
    ],
    apply: (src, p) => glowingEdges(src, Number(p.width), Number(p.brightness), Number(p.smooth)),
  },
  wind: {
    id: "wind",
    name: "Wind",
    category: "Stylize",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: 1, max: 30, step: 1, default: 12 },
      { type: "select", key: "direction", label: "Direction", options: [
        { value: "right", label: "From Left" },
        { value: "left", label: "From Right" },
      ], default: "right" },
    ],
    apply: (src, p) => wind(src, Number(p.strength), String(p.direction)),
  },
  extrude: {
    id: "extrude",
    name: "Extrude",
    category: "Stylize",
    params: [
      { type: "slider", key: "depth", label: "Depth", min: 1, max: 80, step: 1, default: 18, suffix: "px" },
      { type: "select", key: "mode", label: "Type", options: [
        { value: "blocks", label: "Blocks" },
        { value: "pyramid", label: "Pyramids" },
      ], default: "blocks" },
    ],
    apply: (src, p) => extrude(src, Number(p.depth), String(p.mode)),
  },
  flame: {
    id: "flame",
    name: "Flame",
    category: "Render",
    params: [
      { type: "slider", key: "height", label: "Height", min: 10, max: 100, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "turbulence", label: "Turbulence", min: 0, max: 100, step: 1, default: 55, suffix: "%" },
    ],
    apply: (src, p) => renderFlame(src, Number(p.height), Number(p.turbulence)),
  },
  "picture-frame": {
    id: "picture-frame",
    name: "Picture Frame",
    category: "Render",
    params: [
      { type: "slider", key: "size", label: "Frame Size", min: 1, max: 120, step: 1, default: 28, suffix: "px" },
      { type: "select", key: "color", label: "Color", options: [
        { value: "#111827", label: "Graphite" },
        { value: "#8b5cf6", label: "Violet" },
        { value: "#f8fafc", label: "White" },
        { value: "#92400e", label: "Walnut" },
      ], default: "#111827" },
    ],
    apply: (src, p) => pictureFrame(src, Number(p.size), String(p.color)),
  },
  tree: {
    id: "tree",
    name: "Tree",
    category: "Render",
    params: [
      { type: "slider", key: "branches", label: "Branches", min: 2, max: 5, step: 1, default: 3 },
      { type: "checkbox", key: "leaves", label: "Leaves", default: true },
    ],
    apply: (src, p) => renderTree(src, Number(p.branches), Boolean(p.leaves)),
  },
  displace: {
    id: "displace",
    name: "Displace",
    category: "Distort",
    params: [
      { type: "slider", key: "scaleX", label: "Horizontal Scale", min: -200, max: 200, step: 1, default: 24 },
      { type: "slider", key: "scaleY", label: "Vertical Scale", min: -200, max: 200, step: 1, default: 24 },
      { type: "select", key: "map", label: "Displacement Map", options: [
        { value: "image", label: "Image (Displacement Map…)" },
        { value: "noise", label: "Procedural Noise" },
        { value: "luminance", label: "Layer Luminance" },
        { value: "horizontal-gradient", label: "Horizontal Gradient" },
      ], default: "image" },
      { type: "text", key: "mapSource", label: "Map Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "tileMap", label: "Map Placement", options: [
        { value: "tile", label: "Tile" },
        { value: "stretch", label: "Stretch to Fit" },
      ], default: "tile" },
      { type: "select", key: "edgeMode", label: "Undefined Areas", options: [
        { value: "repeat", label: "Repeat Edge Pixels" },
        { value: "wrap", label: "Wrap Around" },
        { value: "transparent", label: "Set to Transparent" },
      ], default: "repeat" },
    ],
    apply: (src, p, ctx) => displace(
      src,
      Number(p.scaleX ?? (String(p.mode) === "vertical" ? 0 : p.scale ?? 24)),
      Number(p.scaleY ?? (String(p.mode) === "horizontal" ? 0 : p.scale ?? 24)),
      String(p.map ?? "image"),
      String(p.edgeMode ?? "repeat"),
      ctx?.displacementMap ?? null,
      String(p.tileMap ?? "tile") === "tile",
    ),
  },
  "diffuse-glow": {
    id: "diffuse-glow",
    name: "Diffuse Glow",
    category: "Distort",
    params: [
      { type: "slider", key: "grain", label: "Graininess", min: 0, max: 100, step: 1, default: 35 },
      { type: "slider", key: "glow", label: "Glow Amount", min: 0, max: 100, step: 1, default: 45 },
      { type: "slider", key: "clear", label: "Clear Amount", min: 0, max: 100, step: 1, default: 35 },
    ],
    apply: (src, p) => diffuseGlow(src, Number(p.grain), Number(p.glow), Number(p.clear)),
  },
  "ocean-ripple": {
    id: "ocean-ripple",
    name: "Ocean Ripple",
    category: "Distort",
    params: [
      { type: "slider", key: "size", label: "Ripple Size", min: 4, max: 80, step: 1, default: 18 },
      { type: "slider", key: "magnitude", label: "Magnitude", min: 0, max: 50, step: 1, default: 12 },
    ],
    apply: (src, p) => oceanRipple(src, Number(p.size), Number(p.magnitude)),
  },
  fragment: {
    id: "fragment",
    name: "Fragment",
    category: "Pixelate",
    params: [],
    apply: (src) => fragment(src),
  },
  facet: {
    id: "facet",
    name: "Facet",
    category: "Pixelate",
    params: [
      { type: "slider", key: "threshold", label: "Threshold", min: 4, max: 80, step: 1, default: 22 },
    ],
    apply: (src, p) => facet(src, Number(p.threshold ?? 22)),
  },
  pointillize: {
    id: "pointillize",
    name: "Pointillize",
    category: "Pixelate",
    params: [
      { type: "slider", key: "cellSize", label: "Cell Size", min: 3, max: 96, step: 1, default: 8, suffix: "px" },
      { type: "select", key: "background", label: "Background", options: [
        { value: "#ffffff", label: "White" },
        { value: "#000000", label: "Black" },
        { value: "#7f7f7f", label: "Gray" },
      ], default: "#ffffff" },
    ],
    apply: (src, p) => pointillize(src, Number(p.cellSize ?? 8), String(p.background ?? "#ffffff")),
  },
  shear: {
    id: "shear",
    name: "Shear",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 30 },
      { type: "select", key: "edgeMode", label: "Undefined Areas", options: [
        { value: "repeat", label: "Repeat Edge Pixels" },
        { value: "wrap", label: "Wrap Around" },
        { value: "transparent", label: "Set to Transparent" },
      ], default: "repeat" },
    ],
    apply: (src, p) => shear(src, Number(p.amount ?? 30), String(p.edgeMode ?? "repeat")),
  },
  tiles: {
    id: "tiles",
    name: "Tiles",
    category: "Stylize",
    params: [
      { type: "slider", key: "tiles", label: "Number of Tiles", min: 2, max: 99, step: 1, default: 10 },
      { type: "slider", key: "maxOffset", label: "Maximum Offset", min: 1, max: 99, step: 1, default: 10, suffix: "%" },
      { type: "select", key: "fill", label: "Fill Empty Area With", options: [
        { value: "background", label: "Background" },
        { value: "foreground", label: "Foreground" },
        { value: "transparent", label: "Transparent" },
      ], default: "background" },
    ],
    apply: (src, p) => tilesFilter(src, Number(p.tiles ?? 10), Number(p.maxOffset ?? 10), String(p.fill ?? "background")),
  },
  diffuse: {
    id: "diffuse",
    name: "Diffuse",
    category: "Stylize",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "normal", label: "Normal" },
        { value: "darken", label: "Darken Only" },
        { value: "lighten", label: "Lighten Only" },
        { value: "anisotropic", label: "Anisotropic" },
      ], default: "normal" },
      { type: "slider", key: "amount", label: "Strength", min: 1, max: 100, step: 1, default: 30 },
    ],
    apply: (src, p) => diffuse(src, String(p.mode ?? "normal"), Number(p.amount ?? 30)),
  },
}

/* --------------------------- DEFINITIONS ------------------------------- */

export const FILTERS: Record<string, FilterDef> = {
  "gaussian-blur": {
    id: "gaussian-blur",
    name: "Gaussian Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 0.1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => gaussianBlur(src, Number(p.radius)),
  },
  "box-blur": {
    id: "box-blur",
    name: "Box Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => boxBlur(src, Number(p.radius)),
  },
  "motion-blur": {
    id: "motion-blur",
    name: "Motion Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "Â°" },
      { type: "slider", key: "distance", label: "Distance", min: 1, max: 100, step: 1, default: 12, suffix: "px" },
    ],
    apply: (src, p) => motionBlur(src, Number(p.distance), Number(p.angle)),
  },
  "field-blur": {
    id: "field-blur",
    name: "Field Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 12, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "falloff", label: "Falloff", min: 0, max: 100, step: 1, default: 45, suffix: "%" },
      { type: "text", key: "pins", label: "Pins", default: "", placeholder: "x%,y%,blur; x%,y%,blur" },
    ],
    apply: (src, p) => fieldBlur(src, Number(p.blur), Number(p.centerX), Number(p.centerY), Number(p.falloff), String(p.pins ?? "")),
  },
  "iris-blur": {
    id: "iris-blur",
    name: "Iris Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 14, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "radius", label: "Iris Radius", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "ellipseWidth", label: "Ellipse Width", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "ellipseHeight", label: "Ellipse Height", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "rotation", label: "Ellipse Rotation", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => irisBlur(
      src,
      Number(p.blur),
      Number(p.centerX),
      Number(p.centerY),
      Number(p.radius),
      Number(p.feather),
      Number(p.ellipseWidth ?? p.radius),
      Number(p.ellipseHeight ?? p.radius),
      Number(p.rotation ?? 0),
    ),
  },
  "tilt-shift": {
    id: "tilt-shift",
    name: "Tilt-Shift",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 16, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "radius", label: "Sharp Band", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => tiltShiftBlur(src, Number(p.blur), Number(p.angle), Number(p.radius), Number(p.feather), Number(p.centerX ?? 50), Number(p.centerY ?? 50)),
  },
  "path-blur": {
    id: "path-blur",
    name: "Path Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "distance", label: "Speed", min: 1, max: 160, step: 1, default: 24, suffix: "px" },
      { type: "slider", key: "angle", label: "Direction", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "taper", label: "Taper", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
      { type: "text", key: "path", label: "Path Points", default: "25,50;75,50", placeholder: "x%,y%; x%,y%" },
    ],
    apply: (src, p) => pathBlur(src, Number(p.distance), Number(p.angle), Number(p.taper), String(p.path ?? "")),
  },
  "spin-blur": {
    id: "spin-blur",
    name: "Spin Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "amount", label: "Angle", min: 1, max: 100, step: 1, default: 28 },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 55, suffix: "%" },
    ],
    apply: (src, p) => spinBlur(src, Number(p.amount), Number(p.centerX), Number(p.centerY), Number(p.radius ?? 55)),
  },
  sharpen: {
    id: "sharpen",
    name: "Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 200, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => sharpen(src, Number(p.amount)),
  },
  "find-edges": {
    id: "find-edges",
    name: "Find Edges",
    category: "Stylize",
    params: [],
    apply: (src) => findEdges(src),
  },
  emboss: {
    id: "emboss",
    name: "Emboss",
    category: "Stylize",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => emboss(src, Number(p.amount)),
  },
  solarize: {
    id: "solarize",
    name: "Solarize",
    category: "Stylize",
    params: [
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 128 },
    ],
    apply: (src, p) => solarize(src, Number(p.threshold)),
  },
  pixelate: {
    id: "pixelate",
    name: "Pixelate (Mosaic)",
    category: "Stylize",
    params: [
      { type: "slider", key: "size", label: "Cell size", min: 2, max: 64, step: 1, default: 8, suffix: "px" },
    ],
    apply: (src, p) => pixelate(src, Number(p.size)),
  },
  noise: {
    id: "noise",
    name: "Add Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 25 },
      { type: "select", key: "distribution", label: "Distribution", options: [
        { value: "uniform", label: "Uniform" },
        { value: "gaussian", label: "Gaussian" },
      ], default: "uniform" },
      { type: "checkbox", key: "mono", label: "Monochromatic", default: false },
    ],
    apply: (src, p) => noise(src, Number(p.amount), Boolean(p.mono), String(p.distribution) === "gaussian"),
  },

  /* Adjustments */
  "brightness-contrast": {
    id: "brightness-contrast",
    name: "Brightness/Contrast",
    category: "Adjustments",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: -150, max: 150, step: 1, default: 0 },
      { type: "slider", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "useLegacy", label: "Use Legacy", default: false },
    ],
    apply: (src, p) => brightnessContrast(src, Number(p.brightness), Number(p.contrast), parseBool(p.useLegacy)),
  },
  "hue-saturation": {
    id: "hue-saturation",
    name: "Hue/Saturation",
    category: "Adjustments",
    params: [
      { type: "select", key: "range", label: "Range", options: [
        { value: "master", label: "Master" },
        { value: "reds", label: "Reds" },
        { value: "yellows", label: "Yellows" },
        { value: "greens", label: "Greens" },
        { value: "cyans", label: "Cyans" },
        { value: "blues", label: "Blues" },
        { value: "magentas", label: "Magentas" },
      ], default: "master" },
      { type: "slider", key: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0, suffix: "Â°" },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "lightness", label: "Lightness", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "colorize", label: "Colorize", default: false },
    ],
    apply: (src, p) =>
      hueSaturation(
        src,
        Number(p.hue),
        Number(p.saturation),
        Number(p.lightness),
        String(p.range ?? "master") as HueRange,
        parseBool(p.colorize),
      ),
  },
  levels: {
    id: "levels",
    name: "Levels",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "inputBlack", label: "Input Black", min: 0, max: 254, step: 1, default: 0 },
      { type: "slider", key: "inputWhite", label: "Input White", min: 1, max: 255, step: 1, default: 255 },
      { type: "slider", key: "gamma", label: "Gamma", min: 0.1, max: 9.99, step: 0.01, default: 1 },
      { type: "slider", key: "outputBlack", label: "Output Black", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "outputWhite", label: "Output White", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) =>
      levels(
        src,
        Number(p.inputBlack),
        Number(p.inputWhite),
        Number(p.gamma),
        Number(p.outputBlack),
        Number(p.outputWhite),
        String(p.channel ?? "rgb"),
      ),
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "Adjustments",
    params: [
      { type: "slider", key: "level", label: "Threshold Level", min: 0, max: 255, step: 1, default: 128 },
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "Composite" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "rgb" },
      { type: "checkbox", key: "invert", label: "Invert", default: false },
    ],
    apply: (src, p) => threshold(src, Number(p.level), String(p.channel ?? "rgb"), parseBool(p.invert)),
  },
  posterize: {
    id: "posterize",
    name: "Posterize",
    category: "Adjustments",
    params: [
      { type: "slider", key: "levels", label: "Levels", min: 2, max: 32, step: 1, default: 4 },
      { type: "checkbox", key: "dither", label: "Dither", default: false },
    ],
    apply: (src, p) => posterize(src, Number(p.levels), parseBool(p.dither)),
  },
  vibrance: {
    id: "vibrance",
    name: "Vibrance",
    category: "Adjustments",
    params: [
      { type: "slider", key: "amount", label: "Vibrance", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => vibranceAdvanced(src, Number(p.amount), Number(p.saturation ?? 0)),
  },
  invert: {
    id: "invert",
    name: "Invert",
    category: "Adjustments",
    params: [],
    apply: (src) => invert(src),
  },
  grayscale: {
    id: "grayscale",
    name: "Black & White",
    category: "Adjustments",
    params: [],
    apply: (src) => grayscale(src),
  },
  "black-white": {
    id: "black-white",
    name: "Black & White...",
    category: "Adjustments",
    params: [
      { type: "slider", key: "reds", label: "Reds", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellows", label: "Yellows", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "greens", label: "Greens", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "cyans", label: "Cyans", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blues", label: "Blues", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentas", label: "Magentas", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "tint", label: "Tint", default: false },
      { type: "slider", key: "tintHue", label: "Tint Hue", min: 0, max: 360, step: 1, default: 38, suffix: "Â°" },
      { type: "slider", key: "tintSaturation", label: "Tint Saturation", min: 0, max: 100, step: 1, default: 18 },
    ],
    apply: (src, p) => blackWhiteAdvanced(
      src,
      Number(p.reds),
      Number(p.yellows),
      Number(p.greens),
      Number(p.cyans),
      Number(p.blues),
      Number(p.magentas),
      parseBool(p.tint),
      Number(p.tintHue ?? 38),
      Number(p.tintSaturation ?? 18),
    ),
  },
  sepia: {
    id: "sepia",
    name: "Sepia",
    category: "Color",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 80, suffix: "%" },
    ],
    apply: (src, p) => sepia(src, Number(p.amount)),
  },
  curves: {
    id: "curves",
    name: "Curves",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "shadow", label: "Shadow", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "midtone", label: "Midtone", min: 0, max: 255, step: 1, default: 128 },
      { type: "slider", key: "highlight", label: "Highlight", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) => curvesAdvanced(src, p),
  },
  "color-balance": {
    id: "color-balance",
    name: "Color Balance",
    category: "Adjustments",
    params: [
      { type: "select", key: "tone", label: "Tone", options: [
        { value: "shadows", label: "Shadows" },
        { value: "midtones", label: "Midtones" },
        { value: "highlights", label: "Highlights" },
      ], default: "midtones" },
      { type: "slider", key: "cyanRed", label: "Cyan / Red", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentaGreen", label: "Magenta / Green", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellowBlue", label: "Yellow / Blue", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "preserveLuminosity", label: "Preserve Luminosity", default: true },
    ],
    apply: (src, p) =>
      colorBalanceAdvanced(
        src,
        Number(p.cyanRed),
        Number(p.magentaGreen),
        Number(p.yellowBlue),
        String(p.tone ?? "midtones") as "shadows" | "midtones" | "highlights",
        parseBool(p.preserveLuminosity, true),
      ),
  },
  "photo-filter": {
    id: "photo-filter",
    name: "Photo Filter",
    category: "Adjustments",
    params: [
      {
        type: "select",
        key: "color",
        label: "Color",
        options: [
          { value: "warm", label: "Warming" },
          { value: "blue", label: "Cooling" },
          { value: "green", label: "Green" },
          { value: "magenta", label: "Magenta" },
          { value: "cyan", label: "Cyan" },
          { value: "yellow", label: "Yellow" },
        ],
        default: "warm",
      },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => photoFilter(src, String(p.color), Number(p.density)),
  },
  "channel-mixer": {
    id: "channel-mixer",
    name: "Channel Mixer",
    category: "Adjustments",
    params: [
      { type: "checkbox", key: "monochrome", label: "Monochrome", default: false },
      { type: "checkbox", key: "preserveLuminosity", label: "Preserve Luminosity", default: false },
      { type: "slider", key: "rR", label: "Red â† Red", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "rG", label: "Red â† Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "rB", label: "Red â† Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gR", label: "Green â† Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gG", label: "Green â† Green", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "gB", label: "Green â† Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bR", label: "Blue â† Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bG", label: "Blue â† Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bB", label: "Blue â† Blue", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "constantR", label: "Red Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "constantG", label: "Green Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "constantB", label: "Blue Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "grayR", label: "Gray <- Red", min: -200, max: 200, step: 1, default: 40 },
      { type: "slider", key: "grayG", label: "Gray <- Green", min: -200, max: 200, step: 1, default: 40 },
      { type: "slider", key: "grayB", label: "Gray <- Blue", min: -200, max: 200, step: 1, default: 20 },
      { type: "slider", key: "constantGray", label: "Gray Constant", min: -200, max: 200, step: 1, default: 0 },
    ],
    apply: (src, p) =>
      channelMixer(
        src,
        Number(p.rR),
        Number(p.rG),
        Number(p.rB),
        Number(p.gR),
        Number(p.gG),
        Number(p.gB),
        Number(p.bR),
        Number(p.bG),
        Number(p.bB),
        {
          constantR: Number(p.constantR ?? 0),
          constantG: Number(p.constantG ?? 0),
          constantB: Number(p.constantB ?? 0),
          monochrome: parseBool(p.monochrome),
          grayR: Number(p.grayR ?? 40),
          grayG: Number(p.grayG ?? 40),
          grayB: Number(p.grayB ?? 20),
          constantGray: Number(p.constantGray ?? 0),
          preserveLuminosity: parseBool(p.preserveLuminosity),
        },
      ),
  },
  "unsharp-mask": {
    id: "unsharp-mask",
    name: "Unsharp Mask",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 100, step: 0.1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => unsharpMask(src, Number(p.amount), Number(p.radius)),
  },
  "exposure": {
    id: "exposure",
    name: "Exposure",
    category: "Adjustments",
    params: [
      { type: "slider", key: "ev", label: "EV", min: -5, max: 5, step: 0.1, default: 0 },
    ],
    apply: (src, p) => exposure(src, Number(p.ev)),
  },
  "desaturate": {
    id: "desaturate",
    name: "Desaturate",
    category: "Adjustments",
    params: [],
    apply: (src) => desaturate(src),
  },
  "equalize": {
    id: "equalize",
    name: "Equalize",
    category: "Adjustments",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "image", label: "Equalize entire image" },
        { value: "selection-only", label: "Equalize selected area only" },
        { value: "selection-source", label: "Equalize entire image based on selected area" },
      ], default: "image" },
    ],
    apply: (src, p, context) => {
      const rawMode = String(p.mode ?? "image")
      const mode = (rawMode === "selection-only" || rawMode === "selection-source" ? rawMode : "image") as "image" | "selection-only" | "selection-source"
      return equalize(src, mode, context?.selectionMask ?? null)
    },
  },
  "replace-color": {
    id: "replace-color",
    name: "Replace Color",
    category: "Adjustments",
    params: [
      // Sample lists are stored as ";"-separated "r,g,b" so they round-trip through
      // the adjustments panel and the destructive filter dialog without bespoke types.
      { type: "text", key: "includeSamples", label: "Include samples (r,g,b;...)", default: "", placeholder: "255,0,0;0,128,255" },
      { type: "text", key: "excludeSamples", label: "Exclude samples (r,g,b;...)", default: "", placeholder: "" },
      { type: "slider", key: "sourceHue", label: "Legacy Source Hue", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "fuzziness", label: "Fuzziness", min: 0, max: 200, step: 1, default: 40 },
      { type: "checkbox", key: "localizedClusters", label: "Localized Color Clusters", default: false },
      { type: "slider", key: "replacementHue", label: "Replacement Hue", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "replacementSaturation", label: "Replacement Saturation", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "replacementLightness", label: "Replacement Lightness", min: -100, max: 100, step: 1, default: 0 },
      { type: "text", key: "resultColor", label: "Result color (r,g,b)", default: "", placeholder: "leave blank to use HSL shift" },
    ],
    apply: (src, p) => {
      // Build include list. Prefer explicit samples list; fall back to the
      // legacy single sourceHue param for back-compat with old documents.
      const include = parseReplaceColorSamples(String(p.includeSamples ?? ""))
      if (include.length === 0) {
        const hueDeg = Number(p.sourceHue ?? p.hue ?? -1)
        if (Number.isFinite(hueDeg) && hueDeg >= 0) {
          const { r, g, b } = hslToRgb(((hueDeg % 360) + 360) % 360 / 360, 1, 0.5)
          include.push({ r, g, b })
        }
      }
      const exclude = parseReplaceColorSamples(String(p.excludeSamples ?? ""))
      const resultParsed = parseReplaceColorSamples(String(p.resultColor ?? ""))
      const result = resultParsed.length > 0 ? resultParsed[0] : null
      return replaceColor(
        src,
        include,
        exclude,
        Number(p.fuzziness ?? p.tolerance ?? 40),
        parseBool(p.localizedClusters),
        Number(p.replacementHue ?? p.hue ?? 0),
        Number(p.replacementSaturation ?? 0),
        Number(p.replacementLightness ?? p.lightness ?? 0),
        result,
      )
    },
  },
  "match-color": {
    id: "match-color",
    name: "Match Color",
    category: "Adjustments",
    params: [
      // Source identifier — read by the dialog/menu to resolve the source
      // ImageData and pass it via FilterContext.matchColorSource at apply time.
      // Format: "doc:<docId>" or "layer:<docId>:<layerId>". Empty = no source
      // (the source becomes the active document itself, so Match Color
      // degenerates into a Neutralize/Fade pass).
      { type: "text", key: "matchSource", label: "Source (doc:id or layer:docId:layerId)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "slider", key: "luminance", label: "Luminance", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "colorIntensity", label: "Color Intensity", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "fade", label: "Fade", min: 0, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "neutralize", label: "Neutralize", default: false },
    ],
    apply: (src, p, context) =>
      matchColorAdvanced(
        src,
        context?.matchColorSource,
        Number(p.luminance ?? 100),
        Number(p.colorIntensity ?? 100),
        Number(p.fade ?? 0),
        parseBool(p.neutralize),
      ),
  },
  "apply-image": {
    id: "apply-image",
    name: "Apply Image",
    category: "Adjustments",
    params: [
      { type: "text", key: "applySource", label: "Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Luminance" },
        { value: "alpha", label: "Alpha" },
      ], default: "rgb" },
      { type: "select", key: "blend", label: "Blending", options: [
        { value: "normal", label: "Normal" },
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "soft-light", label: "Soft Light" },
        { value: "hard-light", label: "Hard Light" },
        { value: "darken", label: "Darken" },
        { value: "lighten", label: "Lighten" },
        { value: "color-burn", label: "Color Burn" },
        { value: "color-dodge", label: "Color Dodge" },
        { value: "linear-burn", label: "Linear Burn" },
        { value: "linear-dodge", label: "Linear Dodge (Add)" },
        { value: "vivid-light", label: "Vivid Light" },
        { value: "linear-light", label: "Linear Light" },
        { value: "pin-light", label: "Pin Light" },
        { value: "hard-mix", label: "Hard Mix" },
        { value: "difference", label: "Difference" },
        { value: "exclusion", label: "Exclusion" },
        { value: "subtract", label: "Subtract" },
        { value: "divide", label: "Divide" },
        { value: "add", label: "Add" },
      ], default: "multiply" },
      { type: "slider", key: "opacity", label: "Opacity", min: 0, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "checkbox", key: "invert", label: "Invert", default: false },
      { type: "checkbox", key: "preserveTransparency", label: "Preserve Transparency", default: true },
    ],
    apply: (src, p, context) =>
      applyImageFilter(
        src,
        context?.applyImageSource ?? null,
        String(p.channel ?? "rgb") as ApplyChannel,
        String(p.blend ?? "multiply"),
        Number(p.opacity ?? 100) / 100,
        parseBool(p.invert),
        parseBool(p.preserveTransparency, true),
      ),
  },
  "calculations": {
    id: "calculations",
    name: "Calculations",
    category: "Adjustments",
    params: [
      { type: "text", key: "sourceA", label: "Source 1 (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId>" },
      { type: "select", key: "channelA", label: "Channel 1", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Gray" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "checkbox", key: "invertA", label: "Invert Source 1", default: false },
      { type: "text", key: "sourceB", label: "Source 2 (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId>" },
      { type: "select", key: "channelB", label: "Channel 2", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Gray" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "checkbox", key: "invertB", label: "Invert Source 2", default: false },
      { type: "select", key: "blend", label: "Blending", options: [
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "soft-light", label: "Soft Light" },
        { value: "hard-light", label: "Hard Light" },
        { value: "difference", label: "Difference" },
        { value: "subtract", label: "Subtract" },
        { value: "add", label: "Add" },
        { value: "divide", label: "Divide" },
      ], default: "multiply" },
      { type: "slider", key: "opacity", label: "Opacity", min: 0, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "result", label: "Result", options: [
        { value: "gray", label: "New Grayscale (replace RGB)" },
        { value: "red", label: "Write to Red" },
        { value: "green", label: "Write to Green" },
        { value: "blue", label: "Write to Blue" },
        { value: "alpha", label: "Write to Alpha" },
      ], default: "gray" },
    ],
    apply: (src, p, context) =>
      calculationsFilter(
        src,
        context?.calcSourceA ?? null,
        context?.calcSourceB ?? null,
        String(p.channelA ?? "luminance") as ApplyChannel,
        String(p.channelB ?? "luminance") as ApplyChannel,
        String(p.blend ?? "multiply"),
        Number(p.opacity ?? 100) / 100,
        parseBool(p.invertA),
        parseBool(p.invertB),
        String(p.result ?? "gray") as "gray" | "red" | "green" | "blue" | "alpha",
      ),
  },
  "selective-color": {
    id: "selective-color",
    name: "Selective Color",
    category: "Adjustments",
    params: [
      { type: "select", key: "range", label: "Colors", options: [
        { value: "reds", label: "Reds" },
        { value: "yellows", label: "Yellows" },
        { value: "greens", label: "Greens" },
        { value: "cyans", label: "Cyans" },
        { value: "blues", label: "Blues" },
        { value: "magentas", label: "Magentas" },
        { value: "whites", label: "Whites" },
        { value: "neutrals", label: "Neutrals" },
        { value: "blacks", label: "Blacks" },
      ], default: "reds" },
      { type: "slider", key: "cyan", label: "Cyan", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magenta", label: "Magenta", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellow", label: "Yellow", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "black", label: "Black", min: -100, max: 100, step: 1, default: 0 },
      { type: "select", key: "method", label: "Method", options: [
        { value: "relative", label: "Relative" },
        { value: "absolute", label: "Absolute" },
      ], default: "relative" },
    ],
    apply: (src, p) => selectiveColor(
      src,
      String(p.range ?? "reds"),
      Number(p.cyan ?? p.cyans ?? 0),
      Number(p.magenta ?? p.magentas ?? 0),
      Number(p.yellow ?? p.yellows ?? 0),
      Number(p.black ?? p.blacks ?? 0),
      String(p.method ?? "relative"),
    ),
  },
  "shadows-highlights": {
    id: "shadows-highlights",
    name: "Shadows/Highlights",
    category: "Adjustments",
    params: [
      // Shadows group.
      { type: "slider", key: "shadowsAmount", label: "Shadows: Amount", min: 0, max: 100, step: 1, default: 35, suffix: "%" },
      { type: "slider", key: "shadowsTonalWidth", label: "Shadows: Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shadowsRadius", label: "Shadows: Radius", min: 0, max: 250, step: 1, default: 30, suffix: "px" },
      // Highlights group.
      { type: "slider", key: "highlightsAmount", label: "Highlights: Amount", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "highlightsTonalWidth", label: "Highlights: Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "highlightsRadius", label: "Highlights: Radius", min: 0, max: 250, step: 1, default: 30, suffix: "px" },
      // Adjustments group.
      { type: "slider", key: "colorCorrection", label: "Color Correction", min: -100, max: 100, step: 1, default: 20 },
      { type: "slider", key: "midtoneContrast", label: "Midtone Contrast", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blackClip", label: "Black Clip", min: 0, max: 50, step: 0.01, default: 0.01, suffix: "%" },
      { type: "slider", key: "whiteClip", label: "White Clip", min: 0, max: 50, step: 0.01, default: 0.01, suffix: "%" },
    ],
    apply: (src, p) => shadowsHighlights(
      src,
      // Legacy "shadows"/"highlights"/"tonalWidth"/"radius" keys are accepted as
      // fallbacks so existing documents do not lose their settings.
      Number(p.shadowsAmount ?? p.shadows ?? 0),
      Number(p.shadowsTonalWidth ?? p.tonalWidth ?? 50),
      Number(p.shadowsRadius ?? p.radius ?? 30),
      Number(p.highlightsAmount ?? p.highlights ?? 0),
      Number(p.highlightsTonalWidth ?? p.tonalWidth ?? 50),
      Number(p.highlightsRadius ?? p.radius ?? 30),
      Number(p.colorCorrection ?? 0),
      Number(p.midtoneContrast ?? 0),
      Number(p.blackClip ?? 0.01),
      Number(p.whiteClip ?? 0.01),
    ),
  },
  "hdr-toning": {
    id: "hdr-toning",
    name: "HDR Toning",
    category: "Adjustments",
    params: [
      { type: "select", key: "method", label: "Method", options: [
        { value: "local-adaptation", label: "Local Adaptation" },
        { value: "exposure-gamma", label: "Exposure and Gamma" },
        { value: "highlight-compression", label: "Highlight Compression" },
        { value: "equalize-histogram", label: "Equalize Histogram" },
      ], default: "local-adaptation" },
      // "Edge Glow" group
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 250, step: 1, default: 60, suffix: "px" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "edgeGlow", label: "Edge Glow", min: 0, max: 100, step: 1, default: 30 },
      // "Tone and Detail" group
      { type: "slider", key: "gamma", label: "Gamma", min: 0.3, max: 3, step: 0.01, default: 1 },
      { type: "slider", key: "exposureEv", label: "Exposure", min: -4, max: 4, step: 0.01, default: 0, suffix: "EV" },
      { type: "slider", key: "detail", label: "Detail", min: -100, max: 100, step: 1, default: 0 },
      // "Advanced" group
      { type: "slider", key: "shadow", label: "Shadow", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "highlight", label: "Highlight", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
      // "Toning Curve" group — stored as "x,y;x,y;..."
      { type: "text", key: "toningCurve", label: "Toning Curve points", default: "0,0;255,255", placeholder: "0,0;128,128;255,255" },
    ],
    apply: (src, p) => hdrToning(
      src,
      String(p.method ?? "local-adaptation"),
      Number(p.radius ?? 60),
      Number(p.strength ?? 100),
      Number(p.edgeGlow ?? 30),
      Number(p.gamma ?? 1),
      Number(p.exposureEv ?? 0),
      Number(p.detail ?? 0),
      Number(p.shadow ?? 0),
      Number(p.highlight ?? 0),
      Number(p.vibrance ?? 0),
      Number(p.saturation ?? 0),
      parseCurvePoints(p.toningCurve ?? "0,0;255,255"),
    ),
  },
  "color-lookup": {
    id: "color-lookup",
    name: "Color Lookup (LUT approximation)",
    category: "Adjustments",
    params: [
      { type: "select", key: "preset", label: "Preset", options: [
        { value: "filmic", label: "Filmic Contrast" },
        { value: "warm", label: "Warm" },
        { value: "cool", label: "Cool" },
        { value: "bleach", label: "Bleach Bypass" },
        { value: "cross-process", label: "Cross Process" },
      ], default: "filmic" },
      { type: "slider", key: "strength", label: "Strength", min: -100, max: 100, step: 1, default: 0 },
      { type: "text", key: "lutData", label: "Imported LUT (.cube)", default: "", multiline: true, accept: ".cube,.CUBE", placeholder: "Paste or import CUBE LUT data" },
    ],
    apply: (src, p) => colorLookup(src, Number(p.strength), String(p.lutData ?? ""), String(p.preset ?? "filmic")),
  },
  "gradient-map": {
    id: "gradient-map",
    name: "Gradient Map",
    category: "Adjustments",
    params: [
      { type: "text", key: "gradient", label: "Gradient Stops", default: "0,#000000;1,#ffffff", placeholder: "0,#000000;0.5,#ff0000;1,#ffffff" },
      { type: "select", key: "interpolation", label: "Interpolation", options: [
        { value: "rgb", label: "RGB" },
        { value: "hsl", label: "HSL" },
      ], default: "rgb" },
      { type: "checkbox", key: "reverse", label: "Reverse", default: false },
      { type: "checkbox", key: "dither", label: "Dither", default: true },
    ],
    apply: (src, p) =>
      gradientMapAdvanced(
        src,
        String(p.gradient ?? "0,#000000;1,#ffffff"),
        parseBool(p.reverse),
        parseBool(p.dither, true),
        String(p.interpolation ?? "rgb"),
      ),
  },
  "sky-replacement": {
    id: "sky-replacement",
    name: "Sky Replacement",
    category: "Adjustments",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "tolerance", label: "Sky Detection", min: 0, max: 100, step: 1, default: 54, suffix: "%" },
      { type: "slider", key: "blend", label: "Blend", min: 0, max: 100, step: 1, default: 82, suffix: "%" },
      { type: "slider", key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, default: 12 },
      { type: "slider", key: "seed", label: "Cloud Seed", min: 0, max: 999, step: 1, default: 4 },
    ],
    apply: (src, p) => skyReplacement(src, Number(p.horizon), Number(p.tolerance), Number(p.blend), Number(p.warmth), Number(p.seed)),
  },

  /* ======================== DISTORT FILTERS ======================== */

  "adaptive-wide-angle": {
    id: "adaptive-wide-angle",
    name: "Adaptive Wide Angle",
    category: "Distort",
    params: [
      { type: "slider", key: "correction", label: "Correction", min: -100, max: 100, step: 1, default: 42 },
      { type: "slider", key: "fisheye", label: "Fisheye", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "rotate", label: "Rotate", min: -45, max: 45, step: 0.5, default: 0, suffix: "deg" },
      { type: "slider", key: "scale", label: "Scale", min: 60, max: 160, step: 1, default: 108, suffix: "%" },
      { type: "slider", key: "focalLength", label: "Focal Length", min: 0, max: 300, step: 1, default: 0, suffix: "mm" },
      { type: "slider", key: "cropFactor", label: "Crop Factor", min: 0, max: 6, step: 0.1, default: 0, suffix: "x" },
      { type: "text", key: "constraints", label: "Constraints (JSON)", default: "", multiline: true, placeholder: '[{"type":"vertical","x1":0.3,"y1":0.1,"x2":0.3,"y2":0.9}]' },
    ],
    apply: (src, p) => adaptiveWideAngle(
      src,
      Number(p.correction),
      Number(p.fisheye),
      Number(p.rotate),
      Number(p.scale),
      {
        focalLength: Number(p.focalLength ?? 0),
        cropFactor: Number(p.cropFactor ?? 0),
        constraints: parseAdaptiveConstraints(String(p.constraints ?? "")),
      },
    ),
  },
  "vanishing-point": {
    id: "vanishing-point",
    name: "Vanishing Point",
    category: "Distort",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "left", label: "Left Plane", min: -100, max: 100, step: 1, default: -32 },
      { type: "slider", key: "right", label: "Right Plane", min: -100, max: 100, step: 1, default: 26 },
      { type: "slider", key: "depth", label: "Depth", min: -100, max: 100, step: 1, default: 45 },
      { type: "checkbox", key: "grid", label: "Show Plane Grid", default: true },
      { type: "slider", key: "topLeftX", label: "Top Left X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topLeftY", label: "Top Left Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topRightX", label: "Top Right X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topRightY", label: "Top Right Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomRightX", label: "Bottom Right X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomRightY", label: "Bottom Right Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomLeftX", label: "Bottom Left X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomLeftY", label: "Bottom Left Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
    ],
    apply: (src, p) => vanishingPoint(
      src,
      Number(p.horizon),
      Number(p.left),
      Number(p.right),
      Number(p.depth),
      parseBool(p.grid, true),
      {
        topLeftX: Number(p.topLeftX ?? 0),
        topLeftY: Number(p.topLeftY ?? 0),
        topRightX: Number(p.topRightX ?? 0),
        topRightY: Number(p.topRightY ?? 0),
        bottomRightX: Number(p.bottomRightX ?? 0),
        bottomRightY: Number(p.bottomRightY ?? 0),
        bottomLeftX: Number(p.bottomLeftX ?? 0),
        bottomLeftY: Number(p.bottomLeftY ?? 0),
      },
    ),
  },
  "twirl": {
    id: "twirl",
    name: "Twirl",
    category: "Distort",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -999, max: 999, step: 1, default: 50, suffix: "Â°" },
    ],
    apply: (src, p) => distortTwirl(src, Number(p.angle)),
  },
  "pinch": {
    id: "pinch",
    name: "Pinch",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => distortPinch(src, Number(p.amount)),
  },
  "spherize": {
    id: "spherize",
    name: "Spherize",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "normal", label: "Normal" },
        { value: "horizontal", label: "Horizontal Only" },
        { value: "vertical", label: "Vertical Only" },
      ], default: "normal" },
    ],
    apply: (src, p) => distortSpherize(src, Number(p.amount), String(p.mode)),
  },
  "wave": {
    id: "wave",
    name: "Wave",
    category: "Distort",
    params: [
      { type: "slider", key: "wavelength", label: "Wavelength", min: 1, max: 999, step: 1, default: 120 },
      { type: "slider", key: "amplitude", label: "Amplitude", min: 1, max: 999, step: 1, default: 35 },
      { type: "select", key: "type", label: "Type", options: [
        { value: "sine", label: "Sine" },
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square" },
      ], default: "sine" },
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 100, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => distortWave(src, Number(p.wavelength), Number(p.amplitude), String(p.type), Number(p.scale)),
  },
  "ripple": {
    id: "ripple",
    name: "Ripple",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -999, max: 999, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "size", label: "Size", options: [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
      ], default: "medium" },
    ],
    apply: (src, p) => distortRipple(src, Number(p.amount), String(p.size)),
  },
  "zigzag": {
    id: "zigzag",
    name: "ZigZag",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 20 },
      { type: "slider", key: "ridges", label: "Ridges", min: 1, max: 20, step: 1, default: 5 },
      { type: "select", key: "style", label: "Style", options: [
        { value: "pond", label: "Pond Ripples" },
        { value: "from-center", label: "Out From Center" },
        { value: "around-center", label: "Around Center" },
      ], default: "pond" },
    ],
    apply: (src, p) => distortZigZag(src, Number(p.amount), Number(p.ridges), String(p.style)),
  },
  "polar-coordinates": {
    id: "polar-coordinates",
    name: "Polar Coordinates",
    category: "Distort",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "rect-to-polar", label: "Rectangular to Polar" },
        { value: "polar-to-rect", label: "Polar to Rectangular" },
      ], default: "rect-to-polar" },
    ],
    apply: (src, p) => distortPolar(src, String(p.mode)),
  },

  /* ======================== RENDER FILTERS ======================== */

  "clouds": {
    id: "clouds",
    name: "Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), false),
  },
  "difference-clouds": {
    id: "difference-clouds",
    name: "Difference Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), true),
  },
  "fibers": {
    id: "fibers",
    name: "Fibers",
    category: "Render",
    params: [
      { type: "slider", key: "variance", label: "Variance", min: 1, max: 64, step: 1, default: 16 },
      { type: "slider", key: "strength", label: "Strength", min: 1, max: 64, step: 1, default: 4 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderFibers(src, Number(p.variance), Number(p.strength), Number(p.seed)),
  },
  "lens-flare": {
    id: "lens-flare",
    name: "Lens Flare",
    category: "Render",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: 10, max: 300, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "cx", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "cy", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "select", key: "lens", label: "Lens Type", options: [
        { value: "50-300", label: "50-300mm Zoom" },
        { value: "35", label: "35mm Prime" },
        { value: "105", label: "105mm Prime" },
        { value: "movie", label: "Movie Prime" },
      ], default: "50-300" },
    ],
    apply: (src, p) => renderLensFlare(src, Number(p.brightness), Number(p.cx), Number(p.cy), String(p.lens)),
  },

  /* ======================== OTHER FILTERS ======================== */

  "high-pass": {
    id: "high-pass",
    name: "High Pass",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 250, step: 0.1, default: 10, suffix: "px" },
    ],
    apply: (src, p) => filterHighPass(src, Number(p.radius)),
  },
  "offset": {
    id: "offset",
    name: "Offset",
    category: "Other",
    params: [
      { type: "slider", key: "horizontal", label: "Horizontal", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "slider", key: "vertical", label: "Vertical", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "select", key: "wrap", label: "Undefined Areas", options: [
        { value: "wrap", label: "Wrap Around" },
        { value: "repeat", label: "Repeat Edge Pixels" },
        { value: "transparent", label: "Set to Transparent" },
        { value: "background", label: "Set to Background Color" },
      ], default: "wrap" },
      { type: "text", key: "fill", label: "Background Color (hex)", default: "#ffffff", placeholder: "#ffffff" },
    ],
    apply: (src, p) => {
      const hex = String(p.fill ?? "#ffffff")
      const rgb = hexToRgbFilter(hex) ?? { r: 255, g: 255, b: 255 }
      return filterOffset(src, Number(p.horizontal), Number(p.vertical), String(p.wrap), rgb.r, rgb.g, rgb.b)
    },
  },
  "maximum": {
    id: "maximum",
    name: "Maximum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), true),
  },
  "minimum": {
    id: "minimum",
    name: "Minimum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), false),
  },

  /* ---------- ADVANCED FILTERS ---------- */

  "smart-sharpen": {
    id: "smart-sharpen",
    name: "Smart Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 64, step: 0.1, default: 1.0, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
      { type: "select", key: "remove", label: "Remove", options: [
        { value: "gaussian", label: "Gaussian Blur" },
        { value: "lens", label: "Lens Blur" },
        { value: "motion", label: "Motion Blur" },
      ], default: "gaussian" },
      { type: "slider", key: "motionAngle", label: "Motion Angle", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "checkbox", key: "moreAccurate", label: "More Accurate", default: false },
      { type: "slider", key: "shadowAmount", label: "Shadow Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "shadowTonalWidth", label: "Shadow Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shadowRadius", label: "Shadow Radius", min: 0, max: 250, step: 1, default: 1, suffix: "px" },
      { type: "slider", key: "highlightAmount", label: "Highlight Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "highlightTonalWidth", label: "Highlight Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "highlightRadius", label: "Highlight Radius", min: 0, max: 250, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => smartSharpen(
      src,
      Number(p.amount),
      Number(p.radius),
      Number(p.threshold),
      Number(p.shadowAmount),
      Number(p.highlightAmount),
      {
        remove: String(p.remove ?? "gaussian") as SmartSharpenExtras["remove"],
        motionAngle: Number(p.motionAngle ?? 0),
        moreAccurate: parseBool(p.moreAccurate),
        shadowTonalWidth: Number(p.shadowTonalWidth ?? 50),
        shadowRadius: Number(p.shadowRadius ?? 1),
        highlightTonalWidth: Number(p.highlightTonalWidth ?? 50),
        highlightRadius: Number(p.highlightRadius ?? 1),
      },
    ),
  },

  "lens-blur": {
    id: "lens-blur",
    name: "Lens Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 1, default: 10, suffix: "px" },
      { type: "select", key: "shape", label: "Iris Shape", options: [
        { value: "hexagon", label: "Hexagon" },
        { value: "pentagon", label: "Pentagon" },
        { value: "octagon", label: "Octagon" },
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square" },
        { value: "circle", label: "Circle" },
      ], default: "hexagon" },
      { type: "slider", key: "bladeCount", label: "Blade Curvature", min: 3, max: 8, step: 1, default: 6 },
      { type: "slider", key: "rotation", label: "Rotation", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "brightness", label: "Specular Brightness", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "threshold", label: "Specular Threshold", min: 0, max: 255, step: 1, default: 255 },
      { type: "slider", key: "noiseAmount", label: "Noise Amount", min: 0, max: 25, step: 1, default: 0 },
      { type: "checkbox", key: "noiseMono", label: "Monochromatic Noise", default: true },
      { type: "text", key: "depthSource", label: "Depth Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "depthChannel", label: "Depth Source Channel", options: [
        { value: "luminance", label: "Luminance" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "slider", key: "depthFocus", label: "Depth Focus", min: 0, max: 255, step: 1, default: 128 },
      { type: "slider", key: "depthBlurScale", label: "Depth Blur Strength", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "checkbox", key: "depthInvert", label: "Invert Depth", default: false },
    ],
    apply: (src, p, ctx) => lensBlur(
      src,
      Number(p.radius),
      Number(p.bladeCount),
      Number(p.rotation),
      Number(p.brightness),
      Number(p.threshold),
      Number(p.noiseAmount),
      Boolean(p.noiseMono),
      {
        shape: String(p.shape ?? "hexagon") as LensBlurExtras["shape"],
        depthSource: ctx?.lensBlurDepthSource ?? null,
        depthChannel: String(p.depthChannel ?? "luminance") as LensBlurExtras["depthChannel"],
        depthFocus: Number(p.depthFocus ?? 128),
        depthBlurScale: Number(p.depthBlurScale ?? 0),
        depthInvert: Boolean(p.depthInvert),
      },
    ),
  },

  "surface-blur": {
    id: "surface-blur",
    name: "Surface Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 18, step: 1, default: 5, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 24 },
    ],
    apply: (src, p) => surfaceBlur(src, Number(p.radius), Number(p.threshold)),
  },

  "radial-blur": {
    id: "radial-blur",
    name: "Radial Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 100, step: 1, default: 25 },
      { type: "select", key: "method", label: "Method", options: [
        { value: "spin", label: "Spin" },
        { value: "zoom", label: "Zoom" },
      ], default: "spin" },
      { type: "select", key: "quality", label: "Quality", options: [
        { value: "draft", label: "Draft" },
        { value: "good", label: "Good" },
        { value: "best", label: "Best" },
      ], default: "good" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => radialBlur(src, Number(p.amount), String(p.method), String(p.quality), Number(p.centerX ?? 50), Number(p.centerY ?? 50)),
  },

  "oil-paint": {
    id: "oil-paint",
    name: "Oil Paint",
    category: "Stylize",
    params: [
      { type: "slider", key: "radius", label: "Stylization Radius", min: 1, max: 8, step: 1, default: 4, suffix: "px" },
      { type: "slider", key: "levels", label: "Cleanliness", min: 4, max: 32, step: 1, default: 16 },
      { type: "slider", key: "shine", label: "Lighting Shine", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
    ],
    apply: (src, p) => oilPaint(src, Number(p.radius), Number(p.levels), Number(p.shine)),
  },

  "glass": {
    id: "glass",
    name: "Glass",
    category: "Distort",
    params: [
      { type: "slider", key: "distortion", label: "Distortion", min: 0, max: 100, step: 1, default: 24 },
      { type: "slider", key: "smoothness", label: "Smoothness", min: 0, max: 8, step: 1, default: 2 },
      { type: "select", key: "texture", label: "Texture", options: [
        { value: "canvas", label: "Canvas" },
        { value: "frosted", label: "Frosted" },
        { value: "blocks", label: "Blocks" },
      ], default: "canvas" },
      { type: "slider", key: "scale", label: "Scale", min: 10, max: 400, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => glassDistort(src, Number(p.distortion), Number(p.smoothness), String(p.texture), Number(p.scale)),
  },

  "lens-correction": {
    id: "lens-correction",
    name: "Lens Correction",
    category: "Distort",
    params: [
      { type: "select", key: "profile", label: "Lens Profile", default: "custom", options: [
        { value: "custom", label: "Custom (Manual)" },
        { value: "smartphone", label: "Smartphone Wide" },
        { value: "compact-wide", label: "Compact Wide" },
        { value: "wide-angle", label: "Wide Angle 24mm" },
        { value: "fisheye", label: "Fisheye 8-15mm" },
        { value: "standard-50", label: "Standard 50mm" },
        { value: "telephoto", label: "Telephoto 85-200mm" },
        { value: "macro-100", label: "Macro 100mm" },
        { value: "super-tele", label: "Super Telephoto 300mm+" },
        { value: "drone-fpv", label: "Drone / Action Cam" },
        { value: "architecture-shift", label: "Architecture Shift" },
      ] },
      { type: "slider", key: "profileStrength", label: "Profile Strength", min: 0, max: 150, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "distortion", label: "Geometric Distortion (k1)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "k2", label: "Higher-Order Distortion (k2)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "k3", label: "Extreme Distortion (k3)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "tangentialX", label: "Tangential X (p1)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "tangentialY", label: "Tangential Y (p2)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vignette", label: "Vignette Amount", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vignetteMidpoint", label: "Vignette Midpoint", min: 0, max: 100, step: 1, default: LENS_DEFAULT_VIGNETTE_MIDPOINT },
      { type: "slider", key: "chromatic", label: "Chromatic Aberration", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeR", label: "Red Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeG", label: "Green Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeB", label: "Blue Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "defringe", label: "Defringe", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "perspectiveV", label: "Vertical Perspective", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "perspectiveH", label: "Horizontal Perspective", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "scalePct", label: "Scale", min: 50, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "checkbox", key: "autoScale", label: "Auto-Scale to Fit", default: false },
      { type: "select", key: "edgeMode", label: "Edge Handling", default: "clamp", options: [
        { value: "clamp", label: "Clamp Edges" },
        { value: "transparent", label: "Transparent" },
        { value: "black", label: "Black" },
        { value: "white", label: "White" },
      ] },
    ],
    apply: (src, p) => lensCorrection(
      src,
      numberParam(p.distortion, 0),
      numberParam(p.vignette, 0),
      numberParam(p.chromatic, 0),
      numberParam(p.k2, 0),
      numberParam(p.k3, 0),
      numberParam(p.tangentialX, 0),
      numberParam(p.tangentialY, 0),
      String(p.profile ?? "custom"),
      Boolean(p.autoScale),
      String(p.edgeMode ?? "clamp"),
      numberParam(p.profileStrength, 100),
      numberParam(p.defringe, 0),
      {
        fringeR: numberParam(p.fringeR, 0),
        fringeG: numberParam(p.fringeG, 0),
        fringeB: numberParam(p.fringeB, 0),
        perspectiveV: numberParam(p.perspectiveV, 0),
        perspectiveH: numberParam(p.perspectiveH, 0),
        vignetteMidpoint: numberParam(p.vignetteMidpoint, LENS_DEFAULT_VIGNETTE_MIDPOINT),
        scalePct: numberParam(p.scalePct, 100),
      },
    ),
  },

  "color-halftone": {
    id: "color-halftone",
    name: "Color Halftone",
    category: "Pixelate",
    params: [
      { type: "slider", key: "radius", label: "Max Radius", min: 2, max: 32, step: 1, default: 8, suffix: "px" },
      { type: "slider", key: "angle", label: "Screen Angle", min: 0, max: 180, step: 1, default: 45, suffix: "deg" },
    ],
    apply: (src, p) => colorHalftone(src, Number(p.radius), Number(p.angle)),
  },

  "mezzotint": {
    id: "mezzotint",
    name: "Mezzotint",
    category: "Pixelate",
    params: [
      { type: "select", key: "type", label: "Type", options: [
        { value: "fine-dots", label: "Fine Dots" },
        { value: "short-strokes", label: "Short Strokes" },
        { value: "long-strokes", label: "Long Strokes" },
      ], default: "fine-dots" },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 70, suffix: "%" },
    ],
    apply: (src, p) => mezzotint(src, String(p.type), Number(p.density)),
  },

  "lighting-effects": {
    id: "lighting-effects",
    name: "Lighting Effects",
    category: "Render",
    params: [
      { type: "select", key: "style", label: "Light Style", options: [
        { value: "spot", label: "Spot" },
        { value: "omni", label: "Omni" },
        { value: "directional", label: "Directional" },
        { value: "three-point", label: "Three-Point" },
        { value: "rgb-trio", label: "RGB Trio" },
      ], default: "spot" },
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 250, step: 1, default: 120, suffix: "%" },
      { type: "slider", key: "ambient", label: "Ambience", min: 0, max: 150, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "height", label: "Texture Height", min: 0, max: 100, step: 1, default: 35, suffix: "%" },
      { type: "slider", key: "gloss", label: "Gloss", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shine", label: "Shine", min: 0, max: 100, step: 1, default: 60, suffix: "%" },
      { type: "slider", key: "exposure", label: "Exposure", min: -200, max: 200, step: 1, default: 0, suffix: "/100 EV" },
      { type: "text", key: "bumpSource", label: "Bump Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "bumpChannel", label: "Bump Source Channel", options: [
        { value: "luminance", label: "Luminance (default)" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "text", key: "lights", label: "Lights JSON", default: "", multiline: true, placeholder: '[{"type":"spot","x":0.5,"y":0.4,"z":0.6,"intensity":1,"color":[255,240,210],"radius":0.6,"focus":0.4}]' },
    ],
    apply: (src, p, ctx) => {
      const material: MaterialConfig = {
        gloss: Number(p.gloss ?? 50) / 100,
        shine: Number(p.shine ?? 60) / 100,
        exposure: Number(p.exposure ?? 0) / 100,
      }
      const bumpChannel = String(p.bumpChannel ?? "luminance") as
        "luminance" | "red" | "green" | "blue" | "alpha"
      return lightingEffects(
        src,
        String(p.style ?? "spot"),
        Number(p.intensity),
        Number(p.ambient),
        Number(p.height),
        p.lights ? String(p.lights) : undefined,
        material,
        ctx?.lightingBumpSource ?? null,
        bumpChannel,
      )
    },
  },

  "custom-convolution": {
    id: "custom-convolution",
    name: "Custom Convolution",
    category: "Other",
    params: [
      { type: "select", key: "preset", label: "Kernel", options: [
        { value: "sharpen-more", label: "Sharpen More" },
        { value: "edge-enhance", label: "Edge Enhance" },
        { value: "outline", label: "Outline" },
        { value: "laplacian", label: "Laplacian" },
        { value: "sobel-x", label: "Sobel X" },
        { value: "sobel-y", label: "Sobel Y" },
      ], default: "sharpen-more" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "bias", label: "Bias", min: -255, max: 255, step: 1, default: 0 },
      { type: "slider", key: "divisor", label: "Scale/Divisor", min: -64, max: 64, step: 1, default: 0 },
      { type: "text", key: "matrix", label: "Matrix", default: "", multiline: true, placeholder: "0 0 0\n0 1 0\n0 0 0" },
    ],
    apply: (src, p) => customConvolution(src, String(p.preset), Number(p.strength), Number(p.bias), String(p.matrix ?? ""), Number(p.divisor ?? 0)),
  },
  "custom-filter": {
    id: "custom-filter",
    name: "Custom Filter",
    category: "Other",
    params: [
      { type: "select", key: "preset", label: "Kernel", options: [
        { value: "sharpen-more", label: "Sharpen More" },
        { value: "edge-enhance", label: "Edge Enhance" },
        { value: "outline", label: "Outline" },
        { value: "laplacian", label: "Laplacian" },
        { value: "sobel-x", label: "Sobel X" },
        { value: "sobel-y", label: "Sobel Y" },
      ], default: "sharpen-more" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "bias", label: "Bias", min: -255, max: 255, step: 1, default: 0 },
      { type: "slider", key: "divisor", label: "Scale/Divisor", min: -64, max: 64, step: 1, default: 0 },
      { type: "text", key: "matrix", label: "Matrix", default: "", multiline: true, placeholder: "0 0 0\n0 1 0\n0 0 0" },
    ],
    apply: (src, p) => customConvolution(src, String(p.preset), Number(p.strength), Number(p.bias), String(p.matrix ?? ""), Number(p.divisor ?? 0)),
  },

  "reduce-noise": {
    id: "reduce-noise",
    name: "Reduce Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 10, step: 1, default: 6 },
      { type: "slider", key: "colorNoise", label: "Reduce Color Noise", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
      { type: "slider", key: "detail", label: "Preserve Details", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "sharpen", label: "Sharpen Details", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => reduceNoise(src, Number(p.strength), Number(p.colorNoise), Number(p.detail), Number(p.sharpen)),
  },

  "dust-scratches": {
    id: "dust-scratches",
    name: "Dust & Scratches",
    category: "Noise",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 16, step: 1, default: 1, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
    ],
    apply: (src, p) => dustAndScratches(src, Number(p.radius), Number(p.threshold)),
  },

  ...LEGACY_GAP_FILTERS,
}

export function getFilter(id: string): FilterDef | null {
  return FILTERS[id] ?? null
}
