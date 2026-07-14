import {
  gaussianBlur,
  motionBlur,
} from "./basic-algorithms"
import {
  clamp8,
} from "./pixel-helpers"
import {
  lensBlur,
} from "./blur-algorithms"

export function filterHighPass(src: ImageData, radius: number): ImageData {
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

export interface SmartSharpenExtras {
  remove?: "gaussian" | "lens" | "motion"
  motionAngle?: number
  moreAccurate?: boolean
  shadowTonalWidth?: number
  shadowRadius?: number
  highlightTonalWidth?: number
  highlightRadius?: number
}

export function smartSharpenBlurSource(src: ImageData, radius: number, extras: SmartSharpenExtras) {
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

export function tonalFadeForSmartSharpen(
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

export function smartSharpen(
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

