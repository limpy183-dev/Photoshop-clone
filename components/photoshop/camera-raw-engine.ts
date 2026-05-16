export interface CameraRawRangeAdjustment {
  hue?: number
  saturation?: number
  luminance?: number
}

export interface CameraRawSettings {
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  clarity: number
  dehaze: number
  vibrance: number
  saturation: number
  hsl?: Partial<Record<"reds" | "oranges" | "yellows" | "greens" | "aquas" | "blues" | "purples" | "magentas", CameraRawRangeAdjustment>>
  optics?: {
    distortion?: number
    vignette?: number
    chromaticAberration?: number
  }
  geometry?: {
    horizontal?: number
    vertical?: number
    rotate?: number
    scale?: number
  }
  calibration?: {
    redHue?: number
    greenHue?: number
    blueHue?: number
    saturation?: number
  }
}

export interface CameraRawSnapshot {
  id: string
  name: string
  createdAt: number
  settings: CameraRawSettings
}

export interface CameraRawApplyOptions {
  maskData?: Uint8ClampedArray | null
  maskWidth?: number
  maskHeight?: number
}

export const DEFAULT_CAMERA_RAW_SETTINGS: CameraRawSettings = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
  hsl: {},
  optics: {},
  geometry: {},
  calibration: {},
}

export const CAMERA_RAW_PRESETS = {
  neutral: { id: "neutral", name: "Neutral", settings: DEFAULT_CAMERA_RAW_SETTINGS },
  landscape: {
    id: "landscape",
    name: "Landscape",
    settings: {
      ...DEFAULT_CAMERA_RAW_SETTINGS,
      contrast: 12,
      highlights: -18,
      shadows: 16,
      clarity: 18,
      dehaze: 12,
      vibrance: 22,
      hsl: { blues: { saturation: 10, luminance: -4 }, greens: { saturation: 8, luminance: 4 } },
    },
  },
  portrait: {
    id: "portrait",
    name: "Portrait",
    settings: {
      ...DEFAULT_CAMERA_RAW_SETTINGS,
      highlights: -10,
      shadows: 10,
      clarity: -6,
      vibrance: 8,
      hsl: { oranges: { saturation: -4, luminance: 8 }, reds: { saturation: -6 } },
    },
  },
} satisfies Record<string, { id: string; name: string; settings: CameraRawSettings }>

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp255 = (value: number) => clamp(Math.round(value), 0, 255)

function adjustSaturation(r: number, g: number, b: number, amount: number) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return [
    gray + (r - gray) * amount,
    gray + (g - gray) * amount,
    gray + (b - gray) * amount,
  ] as const
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
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h: h * 360, s, l }
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
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  }
}

function hueRange(hue: number): keyof NonNullable<CameraRawSettings["hsl"]> | null {
  if (hue < 20 || hue >= 345) return "reds"
  if (hue < 45) return "oranges"
  if (hue < 75) return "yellows"
  if (hue < 165) return "greens"
  if (hue < 195) return "aquas"
  if (hue < 255) return "blues"
  if (hue < 285) return "purples"
  if (hue < 345) return "magentas"
  return null
}

function maskAlpha(options: CameraRawApplyOptions, x: number, y: number, width: number, height: number) {
  if (!options.maskData || !options.maskWidth || !options.maskHeight) return 1
  const mx = clamp(Math.round((x / Math.max(1, width - 1)) * (options.maskWidth - 1)), 0, options.maskWidth - 1)
  const my = clamp(Math.round((y / Math.max(1, height - 1)) * (options.maskHeight - 1)), 0, options.maskHeight - 1)
  return (options.maskData[my * options.maskWidth + mx] ?? 0) / 255
}

function sourceIndexWithOptics(x: number, y: number, width: number, height: number, settings: CameraRawSettings, channel: 0 | 1 | 2) {
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  let nx = (x - cx) / Math.max(1, cx)
  let ny = (y - cy) / Math.max(1, cy)
  const distortion = (settings.optics?.distortion ?? 0) / 280
  const chromatic = ((settings.optics?.chromaticAberration ?? 0) / 1000) * (channel === 0 ? 1 : channel === 2 ? -1 : 0)
  const radiusSq = nx * nx + ny * ny
  const scale = 1 + (distortion + chromatic) * radiusSq
  nx *= scale
  ny *= scale
  const sx = clamp(Math.round(cx + nx * Math.max(1, cx)), 0, width - 1)
  const sy = clamp(Math.round(cy + ny * Math.max(1, cy)), 0, height - 1)
  return (sy * width + sx) * 4 + channel
}

export function applyCameraRawImageData(src: ImageData, settings: CameraRawSettings, options: CameraRawApplyOptions = {}) {
  const merged: CameraRawSettings = {
    ...DEFAULT_CAMERA_RAW_SETTINGS,
    ...settings,
    hsl: settings.hsl ?? {},
    optics: settings.optics ?? {},
    geometry: settings.geometry ?? {},
    calibration: settings.calibration ?? {},
  }
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const exposure = Math.pow(2, merged.exposure)
  const contrast = 1 + (merged.contrast + merged.clarity * 0.35 + merged.dehaze * 0.4) / 100
  const sat = 1 + merged.saturation / 100
  const tempR = merged.temperature * 0.9
  const tempB = -merged.temperature * 0.9
  const tintG = -merged.tint * 0.55
  const magenta = merged.tint * 0.35
  const calibrationSat = 1 + (merged.calibration?.saturation ?? 0) / 100

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      if (src.data[i + 3] === 0) continue
      const alpha = maskAlpha(options, x, y, src.width, src.height)
      if (alpha <= 0) continue

      let r = src.data[sourceIndexWithOptics(x, y, src.width, src.height, merged, 0)] * exposure + tempR + magenta
      let g = src.data[sourceIndexWithOptics(x, y, src.width, src.height, merged, 1)] * exposure + tintG
      let b = src.data[sourceIndexWithOptics(x, y, src.width, src.height, merged, 2)] * exposure + tempB + magenta
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255

      if (luma > 0.55) {
        const lift = (luma - 0.55) / 0.45
        r += merged.highlights * lift * 1.4 + merged.whites * luma * 1.1
        g += merged.highlights * lift * 1.4 + merged.whites * luma * 1.1
        b += merged.highlights * lift * 1.4 + merged.whites * luma * 1.1
      } else {
        const lift = (0.55 - luma) / 0.55
        r += merged.shadows * lift * 1.35 + merged.blacks * (1 - luma) * 1.1
        g += merged.shadows * lift * 1.35 + merged.blacks * (1 - luma) * 1.1
        b += merged.shadows * lift * 1.35 + merged.blacks * (1 - luma) * 1.1
      }

      r = (r - 128) * contrast + 128
      g = (g - 128) * contrast + 128
      b = (b - 128) * contrast + 128

      r += (merged.calibration?.redHue ?? 0) * 0.5
      g += (merged.calibration?.greenHue ?? 0) * 0.5
      b += (merged.calibration?.blueHue ?? 0) * 0.5

      const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
      const vibranceBoost = 1 + (merged.vibrance / 100) * (1 - chroma)
      ;[r, g, b] = adjustSaturation(r, g, b, sat * vibranceBoost * calibrationSat)

      const hsl = rgbToHsl(r, g, b)
      const range = hueRange(hsl.h)
      const hslAdjustment = range ? merged.hsl?.[range] : null
      if (hslAdjustment) {
        hsl.h += hslAdjustment.hue ?? 0
        hsl.s = clamp(hsl.s * (1 + (hslAdjustment.saturation ?? 0) / 100), 0, 1)
        hsl.l = clamp(hsl.l + (hslAdjustment.luminance ?? 0) / 150, 0, 1)
        const rgb = hslToRgb(hsl.h, hsl.s, hsl.l)
        r = rgb.r
        g = rgb.g
        b = rgb.b
      }

      const vignette = (merged.optics?.vignette ?? 0) / 100
      if (vignette !== 0) {
        const dx = (x - (src.width - 1) / 2) / Math.max(1, src.width / 2)
        const dy = (y - (src.height - 1) / 2) / Math.max(1, src.height / 2)
        const edge = clamp(Math.hypot(dx, dy), 0, 1)
        const factor = 1 + vignette * edge * edge
        r *= factor
        g *= factor
        b *= factor
      }

      out.data[i] = clamp255(src.data[i] * (1 - alpha) + r * alpha)
      out.data[i + 1] = clamp255(src.data[i + 1] * (1 - alpha) + g * alpha)
      out.data[i + 2] = clamp255(src.data[i + 2] * (1 - alpha) + b * alpha)
    }
  }
  return out
}

export function createCameraRawSnapshot(name: string, settings: CameraRawSettings): CameraRawSnapshot {
  return {
    id: `acr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: Date.now(),
    settings: JSON.parse(JSON.stringify({ ...DEFAULT_CAMERA_RAW_SETTINGS, ...settings })) as CameraRawSettings,
  }
}

export function applyCameraRawBatch(images: ImageData[], settings: CameraRawSettings) {
  return images.map((image) => applyCameraRawImageData(image, settings))
}
