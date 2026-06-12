/**
 * Pixel-level adjustment algorithms extracted from the filter registry.
 *
 * Each function returns new ImageData and preserves the registry's existing
 * parameter and pixel behavior.
 */

import {
  applyChannelMixerToImageData,
  type ChannelMixerParams,
} from "../color-channel-ops"
import { gaussianBlur } from "./basic-algorithms"
import {
  monotoneCurveLut,
  pseudoDither,
} from "./curve-helpers"
import {
  clamp01,
  clamp8,
  hslToRgb,
  luma,
  rgbToHsl,
} from "./pixel-helpers"

export type HueRange = "master" | "reds" | "yellows" | "greens" | "cyans" | "blues" | "magentas"

export const HUE_RANGES: Record<Exclude<HueRange, "master">, { center: number; inner: number; outer: number }> = {
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

export function hueRangeMask(h: number, s: number, range: HueRange) {
  if (range === "master") return 1
  if (s < 0.015) return 0
  const r = HUE_RANGES[range]
  const d = hueDistance(h, r.center)
  if (d <= r.inner) return 1
  if (d >= r.outer) return 0
  return 1 - (d - r.inner) / Math.max(0.0001, r.outer - r.inner)
}

export function hueSaturation(
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

export function levels(
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

export function invert(src: ImageData): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]
    out[i + 1] = 255 - out[i + 1]
    out[i + 2] = 255 - out[i + 2]
  }
  return new ImageData(out, src.width, src.height)
}

export function grayscale(src: ImageData): ImageData {
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

export function sepia(src: ImageData, amount: number): ImageData {
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

export function threshold(src: ImageData, level: number, channel = "rgb", invert = false): ImageData {
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

export function posterize(src: ImageData, levels: number, dither = false): ImageData {
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

export function photoFilter(src: ImageData, color: string, density: number): ImageData {
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

export function channelMixer(
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

export function exposure(src: ImageData, ev: number): ImageData {
  const factor = Math.pow(2, ev)
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(out[i] * factor)
    out[i + 1] = clamp8(out[i + 1] * factor)
    out[i + 2] = clamp8(out[i + 2] * factor)
  }
  return new ImageData(out, src.width, src.height)
}

export function desaturate(src: ImageData): ImageData {
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
export function equalize(
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
export function replaceColor(
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

export function selectiveColor(
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
export function shadowsHighlights(
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
export function hdrToning(
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
