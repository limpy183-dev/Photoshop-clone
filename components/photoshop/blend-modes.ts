/**
 * Pixel-exact blending mode implementations.
 *
 * Canvas 2D natively supports: normal, darken, multiply, color-burn, lighten,
 * screen, color-dodge, overlay, soft-light, hard-light, difference, exclusion,
 * hue, saturation, color, luminosity, source-over, destination-over, destination-out.
 *
 * This module provides pixel-level implementations for modes that Canvas 2D
 * either does not support at all or maps incorrectly:
 *   Dissolve, Linear Burn, Darker Color, Linear Dodge, Lighter Color,
 *   Vivid Light, Linear Light, Pin Light, Hard Mix, Subtract, Divide
 *
 * It also provides `compositeLayerPixels()` — the main entry point that
 * composites a source layer onto a destination ImageData using any BlendMode.
 */

import type { AdvancedBlending, BlendIfRange, BlendMode } from "./types"

/* =========================================================================
   Low-level per-channel blend formulas
   Each takes normalised [0,1] values for base (B) and source/top (S).
   ========================================================================= */

// Helpers
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* --- Standard modes (pixel-level for custom pipeline) --- */
const blendNormal = (_b: number, s: number) => s
const blendDarken = (b: number, s: number) => Math.min(b, s)
const blendMultiply = (b: number, s: number) => b * s
const blendColorBurn = (b: number, s: number) =>
  s === 0 ? 0 : clamp01(1 - (1 - b) / s)
const blendLinearBurn = (b: number, s: number) => clamp01(b + s - 1)
const blendDarkerColor = (_b: number, _s: number) => 0 // handled per-pixel (needs all 3 channels)
const blendLighten = (b: number, s: number) => Math.max(b, s)
const blendScreen = (b: number, s: number) => 1 - (1 - b) * (1 - s)
const blendColorDodge = (b: number, s: number) =>
  s >= 1 ? 1 : clamp01(b / (1 - s))
const blendLinearDodge = (b: number, s: number) => clamp01(b + s)
const blendLighterColor = (_b: number, _s: number) => 0 // handled per-pixel
const blendOverlay = (b: number, s: number) =>
  b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
const blendSoftLight = (b: number, s: number) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
  return b + (2 * s - 1) * (d - b)
}
const blendHardLight = (b: number, s: number) =>
  s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
const blendVividLight = (b: number, s: number) => {
  if (s <= 0.5) {
    const s2 = 2 * s
    return s2 === 0 ? 0 : clamp01(1 - (1 - b) / s2)
  }
  const s2 = 2 * (s - 0.5)
  return s2 >= 1 ? 1 : clamp01(b / (1 - s2))
}
const blendLinearLight = (b: number, s: number) => clamp01(b + 2 * s - 1)
const blendPinLight = (b: number, s: number) => {
  if (s <= 0.5) return Math.min(b, 2 * s)
  return Math.max(b, 2 * s - 1)
}
const blendHardMix = (b: number, s: number) => (b + s >= 1 ? 1 : 0)
const blendDifference = (b: number, s: number) => Math.abs(b - s)
const blendExclusion = (b: number, s: number) => b + s - 2 * b * s
const blendSubtract = (b: number, s: number) => clamp01(b - s)
const blendDivide = (b: number, s: number) =>
  s === 0 ? 1 : clamp01(b / s)

/* Lookup for per-channel blend functions */
const CHANNEL_BLEND: Record<string, (b: number, s: number) => number> = {
  normal: blendNormal,
  darken: blendDarken,
  multiply: blendMultiply,
  "color-burn": blendColorBurn,
  "linear-burn": blendLinearBurn,
  lighten: blendLighten,
  screen: blendScreen,
  "color-dodge": blendColorDodge,
  "linear-dodge": blendLinearDodge,
  overlay: blendOverlay,
  "soft-light": blendSoftLight,
  "hard-light": blendHardLight,
  "vivid-light": blendVividLight,
  "linear-light": blendLinearLight,
  "pin-light": blendPinLight,
  "hard-mix": blendHardMix,
  difference: blendDifference,
  exclusion: blendExclusion,
  subtract: blendSubtract,
  divide: blendDivide,
}

function stableNoise01(x: number, y: number) {
  let n = (x + 1) * 374761393 + (y + 1) * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  n = n ^ (n >> 16)
  return ((n >>> 0) % 10000) / 10000
}

/* =========================================================================
   HSL helpers for Hue / Saturation / Color / Luminosity modes
   ========================================================================= */

function lum(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function sat(r: number, g: number, b: number) {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b)
  const n = Math.min(r, g, b)
  const x = Math.max(r, g, b)
  let rr = r, gg = g, bb = b
  if (n < 0) {
    rr = l + (rr - l) * l / (l - n)
    gg = l + (gg - l) * l / (l - n)
    bb = l + (bb - l) * l / (l - n)
  }
  if (x > 1) {
    rr = l + (rr - l) * (1 - l) / (x - l)
    gg = l + (gg - l) * (1 - l) / (x - l)
    bb = l + (bb - l) * (1 - l) / (x - l)
  }
  return [clamp01(rr), clamp01(gg), clamp01(bb)]
}

function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b)
  return clipColor(r + d, g + d, b + d)
}

function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  // Sort channels and remap
  const arr: [number, number][] = [[r, 0], [g, 1], [b, 2]]
  arr.sort((a, b) => a[0] - b[0])
  const out = [0, 0, 0]
  if (arr[2][0] > arr[0][0]) {
    out[arr[1][1]] = ((arr[1][0] - arr[0][0]) * s) / (arr[2][0] - arr[0][0])
    out[arr[2][1]] = s
  } else {
    out[arr[1][1]] = 0
    out[arr[2][1]] = 0
  }
  out[arr[0][1]] = 0
  return [out[0], out[1], out[2]]
}

/* =========================================================================
   Modes that Canvas 2D natively supports (no pixel blending needed)
   ========================================================================= */

const NATIVE_MODES: Set<BlendMode> = new Set([
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
])

/** Modes that need to be composited via a native Canvas compositeOperation */
const NATIVE_MAP: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: "source-over",
  darken: "darken",
  multiply: "multiply",
  "color-burn": "color-burn",
  lighten: "lighten",
  screen: "screen",
  "color-dodge": "color-dodge",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
}

/**
 * Returns the native compositeOperation for modes that Canvas supports,
 * or null if the mode needs pixel-level blending.
 */
export function getNativeComposite(mode: BlendMode): GlobalCompositeOperation | null {
  return NATIVE_MAP[mode] ?? null
}

/**
 * Returns true if this blend mode requires custom pixel-level compositing.
 * These modes are: dissolve, behind, clear, linear-burn, darker-color,
 * linear-dodge, lighter-color, vivid-light, linear-light, pin-light,
 * hard-mix, subtract, divide.
 */
export function needsPixelBlend(mode: BlendMode): boolean {
  return !NATIVE_MODES.has(mode)
}

/* =========================================================================
   Blend If helpers
   ========================================================================= */

/**
 * Compute Blend If opacity for a single pixel based on its luminosity
 * and the configured range. The range has four values:
 *   black (hard cut start), blackFeather (soft start),
 *   whiteFeather (soft end), white (hard cut end).
 * Pixels with luminosity < black or > white are fully hidden.
 * Between black..blackFeather and whiteFeather..white, opacity fades linearly.
 */
function blendIfFactor(luminosity: number, range: BlendIfRange): number {
  // luminosity is 0..255
  if (luminosity <= range.black || luminosity >= range.white) return 0
  if (luminosity >= range.blackFeather && luminosity <= range.whiteFeather) return 1
  if (luminosity < range.blackFeather) {
    return (luminosity - range.black) / Math.max(1, range.blackFeather - range.black)
  }
  // luminosity > range.whiteFeather
  return (range.white - luminosity) / Math.max(1, range.white - range.whiteFeather)
}

function pixelLuminosity255(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function isDefaultBlendIfRange(range: BlendIfRange): boolean {
  return range.black === 0 && range.blackFeather === 0 && range.whiteFeather === 255 && range.white === 255
}

function hasBlendIf(ab: AdvancedBlending | undefined): boolean {
  if (!ab) return false
  return !isDefaultBlendIfRange(ab.blendIfThis) || !isDefaultBlendIfRange(ab.blendIfUnderlying)
}

/* =========================================================================
   Main compositing function — pixel-level blend
   ========================================================================= */

/**
 * Composites `srcCanvas` onto `destCtx` using the given blendMode and opacity.
 *
 * For modes natively supported by Canvas 2D, delegates to the native pipeline.
 * For non-native modes, performs pixel-level blending via ImageData.
 *
 * @param destCtx  - The destination 2D context (composite canvas)
 * @param srcCanvas - The source layer canvas to blend
 * @param mode      - Photoshop blend mode
 * @param opacity   - Layer opacity 0..1
 * @param fillOpacity - Fill opacity 0..1 (dims layer pixels only, not styles)
 */
export function compositeLayer(
  destCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  mode: BlendMode,
  opacity: number,
  fillOpacity: number = 1,
  advancedBlending?: AdvancedBlending,
) {
  const effectiveOpacity = opacity * fillOpacity
  const useBlendIf = hasBlendIf(advancedBlending)
  const channelMask = advancedBlending?.channels

  // Fast path: native blend mode (only if no Blend If)
  const native = getNativeComposite(mode)
  if (native && !useBlendIf && (!channelMask || (channelMask.r && channelMask.g && channelMask.b))) {
    destCtx.save()
    destCtx.globalAlpha = effectiveOpacity
    destCtx.globalCompositeOperation = native
    destCtx.drawImage(srcCanvas, 0, 0)
    destCtx.restore()
    return
  }

  // Pixel-level blending path
  const w = destCtx.canvas.width
  const h = destCtx.canvas.height
  const destImg = destCtx.getImageData(0, 0, w, h)
  const destData = destImg.data

  const srcCtx = srcCanvas.getContext("2d")
  if (!srcCtx) return
  const srcImg = srcCtx.getImageData(0, 0, Math.min(srcCanvas.width, w), Math.min(srcCanvas.height, h))
  const srcData = srcImg.data
  const srcW = srcImg.width

  const channelFn = CHANNEL_BLEND[mode]

  for (let y = 0; y < Math.min(srcImg.height, h); y++) {
    for (let x = 0; x < Math.min(srcW, w); x++) {
      const si = (y * srcW + x) * 4
      const di = (y * w + x) * 4

      let sa = (srcData[si + 3] / 255) * effectiveOpacity
      if (sa <= 0) continue

      // Blend If: This Layer — attenuate based on source pixel luminosity
      if (useBlendIf && advancedBlending) {
        const srcLum = pixelLuminosity255(srcData[si], srcData[si + 1], srcData[si + 2])
        sa *= blendIfFactor(srcLum, advancedBlending.blendIfThis)
        if (sa <= 0) continue
        // Blend If: Underlying Layer — attenuate based on destination pixel luminosity
        const destLum = pixelLuminosity255(destData[di], destData[di + 1], destData[di + 2])
        sa *= blendIfFactor(destLum, advancedBlending.blendIfUnderlying)
        if (sa <= 0) continue
      }

      // Channel masking: zero out disabled channels
      const chR = !channelMask || channelMask.r
      const chG = !channelMask || channelMask.g
      const chB = !channelMask || channelMask.b

      const da = destData[di + 3] / 255

      // Normalise to 0..1
      const sr = srcData[si] / 255
      const sg = srcData[si + 1] / 255
      const sb = srcData[si + 2] / 255
      const dr = destData[di] / 255
      const dg = destData[di + 1] / 255
      const db = destData[di + 2] / 255

      let rr: number, rg: number, rb: number

      // Special modes
      if (mode === "dissolve") {
        // Dissolve: stable stochastic source coverage based on effective alpha.
        // A coordinate hash avoids the full layer flickering every render.
        if (stableNoise01(x, y) > sa) continue
        rr = sr; rg = sg; rb = sb
        const ra = Math.min(1, sa + da * (1 - sa))
        destData[di] = rr * 255
        destData[di + 1] = rg * 255
        destData[di + 2] = rb * 255
        destData[di + 3] = ra * 255
        continue
      } else if (mode === "behind") {
        // Behind: only affects transparent parts of destination
        if (da > 0.01) continue
        rr = sr; rg = sg; rb = sb
        const ra = sa
        destData[di] = rr * 255
        destData[di + 1] = rg * 255
        destData[di + 2] = rb * 255
        destData[di + 3] = ra * 255
        continue
      } else if (mode === "clear") {
        // Clear: erase destination where source has pixels
        destData[di + 3] = Math.max(0, (da - sa) * 255)
        continue
      } else if (mode === "darker-color") {
        // Compare luminosity of base and source, keep whichever is darker
        const lumB = lum(dr, dg, db)
        const lumS = lum(sr, sg, sb)
        if (lumS < lumB) { rr = sr; rg = sg; rb = sb }
        else { rr = dr; rg = dg; rb = db }
      } else if (mode === "lighter-color") {
        const lumB = lum(dr, dg, db)
        const lumS = lum(sr, sg, sb)
        if (lumS > lumB) { rr = sr; rg = sg; rb = sb }
        else { rr = dr; rg = dg; rb = db }
      } else if (channelFn) {
        rr = channelFn(dr, sr)
        rg = channelFn(dg, sg)
        rb = channelFn(db, sb)
      } else {
        // Fallback to normal
        rr = sr; rg = sg; rb = sb
      }

      // Porter-Duff source-over alpha compositing with blended colour
      const ra = sa + da * (1 - sa)
      if (ra > 0) {
        destData[di] = chR ? ((rr * sa + dr * da * (1 - sa)) / ra) * 255 : destData[di]
        destData[di + 1] = chG ? ((rg * sa + dg * da * (1 - sa)) / ra) * 255 : destData[di + 1]
        destData[di + 2] = chB ? ((rb * sa + db * da * (1 - sa)) / ra) * 255 : destData[di + 2]
        destData[di + 3] = ra * 255
      }
    }
  }

  destCtx.putImageData(destImg, 0, 0)
}
