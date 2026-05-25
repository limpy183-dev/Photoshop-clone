import type { HighBitImage } from "./color-pipeline"

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
  cameraProfileId?: CameraRawCameraProfileId
  hsl?: Partial<Record<"reds" | "oranges" | "yellows" | "greens" | "aquas" | "blues" | "purples" | "magentas", CameraRawRangeAdjustment>>
  optics?: {
    profileId?: CameraRawLensProfileId
    profileStrength?: number
    distortion?: number
    vignette?: number
    chromaticAberration?: number
    defringe?: number
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

export type CameraRawCameraProfileId = "adobe-color" | "camera-standard" | "camera-neutral" | "camera-vivid" | "linear-raw"

export interface CameraRawCameraProfile {
  id: CameraRawCameraProfileId
  name: string
  toneCurve: "linear" | "low-contrast" | "medium-contrast" | "high-contrast"
  saturation: number
  contrast: number
}

export interface CameraRawSnapshot {
  id: string
  name: string
  createdAt: number
  settings: CameraRawSettings
}

export interface CameraRawPreset {
  id: string
  name: string
  group: string
  createdAt: number
  updatedAt: number
  settings: CameraRawSettings
}

export interface CameraRawPresetLibrary {
  builtIn: CameraRawPreset[]
  user: CameraRawPreset[]
}

export type CameraRawLensProfileId =
  | "none"
  | "phone-wide"
  | "action-cam"
  | "compact-wide"
  | "wide-prime"
  | "standard-prime"
  | "portrait-tele"
  | "macro-100"
  | "drone-wide"

export interface CameraRawLensProfile {
  id: CameraRawLensProfileId
  name: string
  description: string
  distortion: number
  vignette: number
  chromaticAberration: number
  defringe: number
}

export interface CameraRawApplyOptions {
  maskData?: Uint8ClampedArray | null
  maskWidth?: number
  maskHeight?: number
}

export interface CameraRawSourceMetadata {
  fileName?: string
  cameraMake?: string
  cameraModel?: string
  lensModel?: string
  focalLengthMm?: number
  aperture?: number
  iso?: number
}

export interface CameraRawLensProfileRecord {
  id: string
  cameraMake?: string
  cameraModel?: string
  lensModel: string
  minFocalLengthMm: number
  maxFocalLengthMm: number
  profileId: CameraRawLensProfileId
}

export interface CameraRawDevelopRecipe {
  source: HighBitImage
  settings: CameraRawSettings
  metadata: CameraRawSourceMetadata
  createdAt: number
  updatedAt: number
  nonDestructive: true
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
  cameraProfileId: "adobe-color",
  hsl: {},
  optics: {},
  geometry: {},
  calibration: {},
}

export const CAMERA_RAW_CAMERA_PROFILES: Record<CameraRawCameraProfileId, CameraRawCameraProfile> = {
  "adobe-color": {
    id: "adobe-color",
    name: "Adobe Color",
    toneCurve: "medium-contrast",
    saturation: 1.04,
    contrast: 1.08,
  },
  "camera-standard": {
    id: "camera-standard",
    name: "Camera Standard",
    toneCurve: "low-contrast",
    saturation: 1,
    contrast: 1.02,
  },
  "camera-neutral": {
    id: "camera-neutral",
    name: "Camera Neutral",
    toneCurve: "linear",
    saturation: 0.96,
    contrast: 0.96,
  },
  "camera-vivid": {
    id: "camera-vivid",
    name: "Camera Vivid",
    toneCurve: "high-contrast",
    saturation: 1.16,
    contrast: 1.14,
  },
  "linear-raw": {
    id: "linear-raw",
    name: "Linear RAW",
    toneCurve: "linear",
    saturation: 1,
    contrast: 1,
  },
}

export const CAMERA_RAW_LENS_PROFILES: Record<CameraRawLensProfileId, CameraRawLensProfile> = {
  none: {
    id: "none",
    name: "None",
    description: "No local lens profile approximation",
    distortion: 0,
    vignette: 0,
    chromaticAberration: 0,
    defringe: 0,
  },
  "phone-wide": {
    id: "phone-wide",
    name: "Phone Wide",
    description: "Generic phone wide camera correction",
    distortion: 18,
    vignette: 18,
    chromaticAberration: 10,
    defringe: 18,
  },
  "action-cam": {
    id: "action-cam",
    name: "Action Cam",
    description: "Small action camera wide-angle correction",
    distortion: 42,
    vignette: 32,
    chromaticAberration: 18,
    defringe: 24,
  },
  "compact-wide": {
    id: "compact-wide",
    name: "Compact Wide",
    description: "Compact camera wide-end correction",
    distortion: 22,
    vignette: 20,
    chromaticAberration: 12,
    defringe: 16,
  },
  "wide-prime": {
    id: "wide-prime",
    name: "Wide Prime",
    description: "24-28mm rectilinear prime approximation",
    distortion: 12,
    vignette: 16,
    chromaticAberration: 7,
    defringe: 10,
  },
  "standard-prime": {
    id: "standard-prime",
    name: "Standard Prime",
    description: "35-55mm low-distortion prime approximation",
    distortion: 4,
    vignette: 8,
    chromaticAberration: 4,
    defringe: 8,
  },
  "portrait-tele": {
    id: "portrait-tele",
    name: "Portrait Tele",
    description: "85-135mm mild pincushion and vignette correction",
    distortion: -7,
    vignette: 9,
    chromaticAberration: 5,
    defringe: 10,
  },
  "macro-100": {
    id: "macro-100",
    name: "Macro 100mm",
    description: "Flat-field macro approximation for close focus work",
    distortion: -3,
    vignette: 5,
    chromaticAberration: 3,
    defringe: 12,
  },
  "drone-wide": {
    id: "drone-wide",
    name: "Drone Wide",
    description: "Drone wide camera correction with stronger edge cleanup",
    distortion: 34,
    vignette: 28,
    chromaticAberration: 16,
    defringe: 22,
  },
}

export const CAMERA_RAW_LENS_PROFILE_DATABASE: CameraRawLensProfileRecord[] = [
  { id: "apple-phone-wide-24-28", cameraMake: "Apple", cameraModel: "iPhone", lensModel: "Phone Wide", minFocalLengthMm: 22, maxFocalLengthMm: 30, profileId: "phone-wide" },
  { id: "action-cam-12-16", lensModel: "Action Cam Wide", minFocalLengthMm: 10, maxFocalLengthMm: 18, profileId: "action-cam" },
  { id: "compact-wide-24-35", lensModel: "Compact Wide Zoom", minFocalLengthMm: 24, maxFocalLengthMm: 35, profileId: "compact-wide" },
  { id: "prime-24-28", lensModel: "Wide Prime", minFocalLengthMm: 24, maxFocalLengthMm: 28, profileId: "wide-prime" },
  { id: "prime-35-55", lensModel: "Standard Prime", minFocalLengthMm: 35, maxFocalLengthMm: 58, profileId: "standard-prime" },
  { id: "tele-85-135", lensModel: "Portrait Tele", minFocalLengthMm: 80, maxFocalLengthMm: 140, profileId: "portrait-tele" },
  { id: "macro-90-105", lensModel: "Macro 100", minFocalLengthMm: 90, maxFocalLengthMm: 110, profileId: "macro-100" },
  { id: "drone-wide-20-28", lensModel: "Drone Wide", minFocalLengthMm: 20, maxFocalLengthMm: 28, profileId: "drone-wide" },
]

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

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function cloneCameraRawSettings(settings: CameraRawSettings): CameraRawSettings {
  return JSON.parse(JSON.stringify({
    ...DEFAULT_CAMERA_RAW_SETTINGS,
    ...settings,
    hsl: settings.hsl ?? {},
    optics: settings.optics ?? {},
    geometry: settings.geometry ?? {},
    calibration: settings.calibration ?? {},
  })) as CameraRawSettings
}

export function createCameraRawPreset(name: string, settings: CameraRawSettings, group = "User"): CameraRawPreset {
  const now = Date.now()
  return {
    id: uid("acr_preset"),
    name: name.trim() || "Untitled Preset",
    group: group.trim() || "User",
    createdAt: now,
    updatedAt: now,
    settings: cloneCameraRawSettings(settings),
  }
}

function builtInPresetList(): CameraRawPreset[] {
  return Object.values(CAMERA_RAW_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    group: "Built-in",
    createdAt: 0,
    updatedAt: 0,
    settings: cloneCameraRawSettings(preset.settings),
  }))
}

export function normalizeCameraRawPresetLibrary(userPresets: CameraRawPreset[] = []): CameraRawPresetLibrary {
  const seen = new Set<string>()
  const user = userPresets
    .filter((preset) => preset && typeof preset.name === "string" && preset.settings)
    .map((preset) => ({
      ...preset,
      id: preset.id || uid("acr_preset"),
      name: preset.name.trim() || "Untitled Preset",
      group: preset.group?.trim() || "User",
      createdAt: Number.isFinite(preset.createdAt) ? preset.createdAt : Date.now(),
      updatedAt: Number.isFinite(preset.updatedAt) ? preset.updatedAt : Date.now(),
      settings: cloneCameraRawSettings(preset.settings),
    }))
    .filter((preset) => {
      if (seen.has(preset.id)) return false
      seen.add(preset.id)
      return true
    })
    .slice(0, 80)
  return { builtIn: builtInPresetList(), user }
}

export function applyCameraRawPreset(
  current: CameraRawSettings,
  preset: { settings: CameraRawSettings },
  mode: "replace" | "merge" = "replace",
): CameraRawSettings {
  if (mode === "merge") {
    return cloneCameraRawSettings({
      ...current,
      ...preset.settings,
      hsl: { ...(current.hsl ?? {}), ...(preset.settings.hsl ?? {}) },
      optics: { ...(current.optics ?? {}), ...(preset.settings.optics ?? {}) },
      geometry: { ...(current.geometry ?? {}), ...(preset.settings.geometry ?? {}) },
      calibration: { ...(current.calibration ?? {}), ...(preset.settings.calibration ?? {}) },
    })
  }
  return cloneCameraRawSettings(preset.settings)
}

export function renameCameraRawSnapshot(snapshot: CameraRawSnapshot, name: string): CameraRawSnapshot {
  return { ...snapshot, name: name.trim() || snapshot.name }
}

export function duplicateCameraRawSnapshot(snapshot: CameraRawSnapshot, name = `${snapshot.name} copy`): CameraRawSnapshot {
  return {
    id: uid("acr"),
    name,
    createdAt: Date.now(),
    settings: cloneCameraRawSettings(snapshot.settings),
  }
}

export function deleteCameraRawSnapshot(snapshots: CameraRawSnapshot[], id: string): CameraRawSnapshot[] {
  return snapshots.filter((snapshot) => snapshot.id !== id)
}

export function promoteCameraRawSnapshotToPreset(snapshot: CameraRawSnapshot, name = snapshot.name): CameraRawPreset {
  return createCameraRawPreset(name, snapshot.settings, "Snapshots")
}

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

function resolvedOptics(settings: CameraRawSettings) {
  const profile = CAMERA_RAW_LENS_PROFILES[settings.optics?.profileId ?? "none"] ?? CAMERA_RAW_LENS_PROFILES.none
  const profileStrength = clamp((settings.optics?.profileStrength ?? 100) / 100, 0, 1.5)
  return {
    distortion: (settings.optics?.distortion ?? 0) + profile.distortion * profileStrength,
    vignette: (settings.optics?.vignette ?? 0) + profile.vignette * profileStrength,
    chromaticAberration: (settings.optics?.chromaticAberration ?? 0) + profile.chromaticAberration * profileStrength,
    defringe: (settings.optics?.defringe ?? 0) + profile.defringe * profileStrength,
  }
}

function sourceIndexWithOptics(x: number, y: number, width: number, height: number, settings: CameraRawSettings, channel: 0 | 1 | 2) {
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  let nx = (x - cx) / Math.max(1, cx)
  let ny = (y - cy) / Math.max(1, cy)
  const optics = resolvedOptics(settings)
  const distortion = optics.distortion / 280
  const chromatic = (optics.chromaticAberration / 1000) * (channel === 0 ? 1 : channel === 2 ? -1 : 0)
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
  const optics = resolvedOptics(merged)

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

      const defringe = clamp(optics.defringe / 100, 0, 1)
      if (defringe > 0) {
        const dx = (x - (src.width - 1) / 2) / Math.max(1, src.width / 2)
        const dy = (y - (src.height - 1) / 2) / Math.max(1, src.height / 2)
        const edge = clamp(Math.hypot(dx, dy), 0, 1)
        const fringe = defringe * edge
        const rbAverage = (r + b) / 2
        const magentaGreenDelta = Math.abs(g - rbAverage)
        if (magentaGreenDelta > 8) {
          g = g * (1 - fringe) + rbAverage * fringe
          r = r * (1 - fringe * 0.35) + rbAverage * fringe * 0.35
          b = b * (1 - fringe * 0.35) + rbAverage * fringe * 0.35
        }
      }

      const vignette = optics.vignette / 100
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
    id: uid("acr"),
    name: name.trim() || "Snapshot",
    createdAt: Date.now(),
    settings: cloneCameraRawSettings(settings),
  }
}

export function applyCameraRawBatch(images: ImageData[], settings: CameraRawSettings) {
  return images.map((image) => applyCameraRawImageData(image, settings))
}

function highBitMax(source: HighBitImage) {
  return source.storage === "uint16" ? 65535 : source.storage === "uint8" ? 255 : 1
}

function readUnit(source: HighBitImage, index: number) {
  const value = Number(source.data[index])
  return source.storage === "float32" ? Math.max(0, value) : Math.max(0, value / highBitMax(source))
}

function writeUnit(target: HighBitImage, index: number, value: number) {
  const v = clamp(value, 0, target.storage === "float32" ? 16 : 1)
  if (target.storage === "uint16") (target.data as Uint16Array)[index] = Math.round(clamp(v, 0, 1) * 65535)
  else if (target.storage === "uint8") (target.data as Uint8ClampedArray)[index] = clamp255(clamp(v, 0, 1) * 255)
  else (target.data as Float32Array)[index] = v
}

function cloneHighBitForCameraRaw(source: HighBitImage): HighBitImage {
  const Ctor = source.storage === "uint16" ? Uint16Array : source.storage === "uint8" ? Uint8ClampedArray : Float32Array
  return {
    ...source,
    data: new Ctor(source.data) as HighBitImage["data"],
    warnings: [...source.warnings, "Camera Raw high-bit recipe applied non-destructively from typed RAW/source data."],
  }
}

function cameraProfileTone(value: number, profile: CameraRawCameraProfile) {
  const v = Math.max(0, value)
  if (profile.toneCurve === "linear") return v
  if (profile.toneCurve === "low-contrast") return Math.max(v, (v - 0.5) * 0.92 + 0.5)
  if (profile.toneCurve === "high-contrast") return Math.max(v, (v - 0.5) * 1.18 + 0.5)
  return Math.max(v, (v - 0.5) * 1.08 + 0.5)
}

function adjustUnitSaturation(r: number, g: number, b: number, amount: number) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return [
    gray + (r - gray) * amount,
    gray + (g - gray) * amount,
    gray + (b - gray) * amount,
  ] as const
}

export function applyCameraRawHighBitImage(source: HighBitImage, settings: CameraRawSettings, options: CameraRawApplyOptions = {}): HighBitImage {
  const merged = cloneCameraRawSettings(settings)
  const out = cloneHighBitForCameraRaw(source)
  const profile = CAMERA_RAW_CAMERA_PROFILES[merged.cameraProfileId ?? "adobe-color"] ?? CAMERA_RAW_CAMERA_PROFILES["adobe-color"]
  const exposure = 2 ** merged.exposure
  const contrast = profile.contrast * (1 + (merged.contrast + merged.clarity * 0.25 + merged.dehaze * 0.25) / 100)
  const saturation = profile.saturation * (1 + (merged.saturation + merged.vibrance * 0.55) / 100)
  const optics = resolvedOptics(merged)

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4
      const alpha = maskAlpha(options, x, y, source.width, source.height)
      if (alpha <= 0) continue
      let r = readUnit(source, i) * exposure + merged.temperature / 550
      let g = readUnit(source, i + 1) * exposure - merged.tint / 800
      let b = readUnit(source, i + 2) * exposure - merged.temperature / 650 + merged.tint / 900
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      if (luma > 0.55) {
        const lift = (luma - 0.55) / 0.45
        r += (merged.highlights * lift + merged.whites * luma) / 180
        g += (merged.highlights * lift + merged.whites * luma) / 180
        b += (merged.highlights * lift + merged.whites * luma) / 180
      } else {
        const lift = (0.55 - luma) / 0.55
        r += (merged.shadows * lift + merged.blacks * (1 - luma)) / 180
        g += (merged.shadows * lift + merged.blacks * (1 - luma)) / 180
        b += (merged.shadows * lift + merged.blacks * (1 - luma)) / 180
      }
      r = cameraProfileTone((r - 0.5) * contrast + 0.5, profile)
      g = cameraProfileTone((g - 0.5) * contrast + 0.5, profile)
      b = cameraProfileTone((b - 0.5) * contrast + 0.5, profile)
      ;[r, g, b] = adjustUnitSaturation(r, g, b, saturation)

      const vignette = optics.vignette / 100
      if (vignette) {
        const dx = (x - (source.width - 1) / 2) / Math.max(1, source.width / 2)
        const dy = (y - (source.height - 1) / 2) / Math.max(1, source.height / 2)
        const factor = 1 + vignette * Math.min(1, dx * dx + dy * dy)
        r *= factor
        g *= factor
        b *= factor
      }
      if (exposure > 1) {
        r = Math.max(r, readUnit(source, i) * Math.min(exposure, 4) * 0.98)
        g = Math.max(g, readUnit(source, i + 1) * Math.min(exposure, 4) * 0.98)
        b = Math.max(b, readUnit(source, i + 2) * Math.min(exposure, 4) * 0.98)
      }

      writeUnit(out, i, readUnit(source, i) * (1 - alpha) + r * alpha)
      writeUnit(out, i + 1, readUnit(source, i + 1) * (1 - alpha) + g * alpha)
      writeUnit(out, i + 2, readUnit(source, i + 2) * (1 - alpha) + b * alpha)
      writeUnit(out, i + 3, readUnit(source, i + 3))
    }
  }
  return out
}

function textScore(haystack: string | undefined, needle: string | undefined) {
  const h = (haystack ?? "").toLowerCase()
  const n = (needle ?? "").toLowerCase()
  if (!h || !n) return 0
  if (h === n) return 4
  if (h.includes(n) || n.includes(h)) return 2
  return 0
}

export function matchCameraRawLensProfile(metadata: CameraRawSourceMetadata): CameraRawLensProfileRecord | null {
  let best: { record: CameraRawLensProfileRecord; score: number } | null = null
  for (const record of CAMERA_RAW_LENS_PROFILE_DATABASE) {
    let score = 0
    score += textScore(metadata.lensModel, record.lensModel) * 3
    score += textScore(metadata.cameraMake, record.cameraMake)
    score += textScore(metadata.cameraModel, record.cameraModel)
    if (typeof metadata.focalLengthMm === "number") {
      if (metadata.focalLengthMm >= record.minFocalLengthMm && metadata.focalLengthMm <= record.maxFocalLengthMm) score += 5
      else score -= Math.min(4, Math.abs(metadata.focalLengthMm - (record.minFocalLengthMm + record.maxFocalLengthMm) / 2) / 12)
    }
    if (score > (best?.score ?? 0)) best = { record, score }
  }
  return best && best.score >= 4 ? best.record : null
}

export function createCameraRawDevelopRecipe(
  source: HighBitImage,
  settings: CameraRawSettings,
  metadata: CameraRawSourceMetadata = {},
): CameraRawDevelopRecipe {
  const matched = matchCameraRawLensProfile(metadata)
  const recipeSettings = cloneCameraRawSettings({
    ...settings,
    optics: {
      ...(settings.optics ?? {}),
      profileId: settings.optics?.profileId ?? matched?.profileId,
    },
  })
  const now = Date.now()
  return {
    source,
    settings: recipeSettings,
    metadata: { ...metadata },
    createdAt: now,
    updatedAt: now,
    nonDestructive: true,
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[ch] ?? ch)
}

function unescapeXml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
}

export function serializeCameraRawSidecar(recipe: CameraRawDevelopRecipe) {
  const payload = JSON.stringify({
    settings: recipe.settings,
    metadata: recipe.metadata,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    nonDestructive: recipe.nonDestructive,
  })
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:psweb="https://example.local/photoshop-web/1.0/"><crs:Version>Photoshop Web Camera Raw 1.0</crs:Version><crs:CameraProfile>${escapeXml(recipe.settings.cameraProfileId ?? "adobe-color")}</crs:CameraProfile><psweb:CameraRawRecipe>${escapeXml(payload)}</psweb:CameraRawRecipe></rdf:Description></rdf:RDF></x:xmpmeta>`
}

export function parseCameraRawSidecar(sidecar: string): Omit<CameraRawDevelopRecipe, "source"> {
  const match = sidecar.match(/<psweb:CameraRawRecipe>([\s\S]*?)<\/psweb:CameraRawRecipe>/)
  if (!match) {
    return {
      settings: cloneCameraRawSettings(DEFAULT_CAMERA_RAW_SETTINGS),
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
      nonDestructive: true,
    }
  }
  const parsed = JSON.parse(unescapeXml(match[1])) as Omit<CameraRawDevelopRecipe, "source">
  return {
    settings: cloneCameraRawSettings(parsed.settings),
    metadata: parsed.metadata ?? {},
    createdAt: Number.isFinite(parsed.createdAt) ? parsed.createdAt : 0,
    updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
    nonDestructive: true,
  }
}
