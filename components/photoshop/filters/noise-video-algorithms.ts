import {
  parseFieldBlurPins,
  parsePathBlurPoints,
} from "../blur-gallery-controls"
import {
  hexToRgb as hexToRgbFilter,
} from "../color-utils"
import {
  channelMixer,
  desaturate,
  equalize,
  exposure,
  grayscale,
  hdrToning,
  hueSaturation,
  invert,
  levels,
  parseReplaceColorSamples,
  photoFilter,
  posterize,
  replaceColor,
  selectiveColor,
  sepia,
  shadowsHighlights,
  threshold,
} from "./adjustment-algorithms"
import {
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
} from "./advanced-adjustment-algorithms"
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
import {
  parseCurvePoints,
  pseudoDither,
} from "./curve-helpers"
import {
  adaptiveWideAngle,
  bilinearSample,
  distanceToSegment,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
} from "./distortion-algorithms"
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
} from "./pixel-helpers"
import {
  fbmNoise,
  renderClouds,
  renderFibers,
  renderLensFlare,
  skyReplacement,
} from "./render-algorithms"
import {
  smartBlur,
} from "./blur-algorithms"
import {
  hashNoise,
} from "./helpers-shared"

export function reduceNoise(src: ImageData, strength: number, colorNoise: number, detail: number, sharpen: number): ImageData {
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

export function dustAndScratches(src: ImageData, radius: number, threshold: number): ImageData {
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

export function despeckle(src: ImageData): ImageData {
  return smartBlur(src, 1.4, 42)
}

export function ntscColors(src: ImageData): ImageData {
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

export function _deInterlace(src: ImageData, field: string): ImageData {
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

export function addProceduralGrain(src: ImageData, amount: number, salt: string): ImageData {
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

export function deInterlaceAdvanced(src: ImageData, field: string, method: string): ImageData {
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

export {
  hexToRgbFilter,
  parseFieldBlurPins,
  parsePathBlurPoints,
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
  clamp01,
  clamp8,
  clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
  parseCurvePoints,
  pseudoDither,
  channelMixer,
  desaturate,
  equalize,
  exposure,
  grayscale,
  hdrToning,
  hueSaturation,
  invert,
  levels,
  parseReplaceColorSamples,
  photoFilter,
  posterize,
  replaceColor,
  selectiveColor,
  sepia,
  shadowsHighlights,
  threshold,
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
  adaptiveWideAngle,
  bilinearSample,
  distanceToSegment,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
  fbmNoise,
  renderClouds,
  renderFibers,
  renderLensFlare,
  skyReplacement,
}

