import type { BlendMode } from "../types"

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export interface FilterCompositeOptions {
  opacity?: number
  blendMode?: BlendMode
  maskData?: Uint8ClampedArray | null
  maskWidth?: number
  maskHeight?: number
  maskEnabled?: boolean
  maskDensity?: number
}

function blendFilterChannel(src: number, dest: number, mode: BlendMode) {
  switch (mode) {
    case "multiply":
      return (src * dest) / 255
    case "screen":
      return 255 - ((255 - src) * (255 - dest)) / 255
    case "overlay":
      return dest < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "hard-light":
      return src < 128
        ? (2 * src * dest) / 255
        : 255 - (2 * (255 - src) * (255 - dest)) / 255
    case "soft-light": {
      const s = src / 255
      const d = dest / 255
      const value = s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (Math.sqrt(d) - d)
      return value * 255
    }
    case "darken":
      return Math.min(src, dest)
    case "lighten":
      return Math.max(src, dest)
    case "difference":
      return Math.abs(dest - src)
    default:
      return src
  }
}

function filterMaskAlpha(options: FilterCompositeOptions, x: number, y: number, width: number, height: number) {
  if (options.maskEnabled === false || !options.maskData || !options.maskWidth || !options.maskHeight) return 1
  const mx = Math.max(0, Math.min(options.maskWidth - 1, Math.floor((x / width) * options.maskWidth)))
  const my = Math.max(0, Math.min(options.maskHeight - 1, Math.floor((y / height) * options.maskHeight)))
  const pixelCount = options.maskWidth * options.maskHeight
  if (options.maskData.length >= pixelCount * 4) {
    const i = (my * options.maskWidth + mx) * 4
    const luminance = (options.maskData[i] + options.maskData[i + 1] + options.maskData[i + 2]) / 765
    const raw = luminance * (options.maskData[i + 3] / 255)
    const density = clamp01(options.maskDensity ?? 1)
    return 1 - density + raw * density
  }
  const raw = options.maskData[my * options.maskWidth + mx] / 255
  const density = clamp01(options.maskDensity ?? 1)
  return 1 - density + raw * density
}

export function compositeFilterImageData(
  before: ImageData,
  after: ImageData,
  options: FilterCompositeOptions = {},
): ImageData {
  const width = Math.min(before.width, after.width)
  const height = Math.min(before.height, after.height)
  const out = new Uint8ClampedArray(before.data)
  const opacity = clamp01(options.opacity ?? 1)
  const blendMode = options.blendMode ?? "normal"

  if (opacity <= 0) return new ImageData(out, before.width, before.height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * before.width + x) * 4
      const si = (y * after.width + x) * 4
      const maskAlpha = filterMaskAlpha(options, x, y, width, height)
      const srcAlpha = (after.data[si + 3] / 255) * opacity * maskAlpha
      if (srcAlpha <= 0) continue

      const destAlpha = before.data[i + 3] / 255
      const outAlpha = srcAlpha + destAlpha * (1 - srcAlpha)
      if (outAlpha <= 0) {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
        continue
      }

      for (let c = 0; c < 3; c++) {
        const src = after.data[si + c]
        const dest = before.data[i + c]
        const blended = blendFilterChannel(src, dest, blendMode)
        out[i + c] = clamp8(Math.round((blended * srcAlpha + dest * destAlpha * (1 - srcAlpha)) / outAlpha))
      }
      out[i + 3] = clamp8(Math.round(outAlpha * 255))
    }
  }

  return new ImageData(out, before.width, before.height)
}
