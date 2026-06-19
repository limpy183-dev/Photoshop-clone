import type { BlendMode, Layer } from "../types"

export const ALL_BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "dissolve",
  "behind",
  "clear",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

export const COMPATIBLE_BLEND_MODES = new Set<BlendMode>(ALL_BLEND_MODES)
export const BLEND_MODE_CODE = new Map<BlendMode, number>(ALL_BLEND_MODES.map((mode, index) => [mode, index]))

export const GPU_FILTERS = new Set([
  "brightness-contrast",
  "exposure",
  "invert",
  "hue-saturation",
  "vibrance",
  "posterize",
  "threshold",
  "levels",
  "curves",
  "channel-mixer",
  "black-white",
  "desaturate",
  "grayscale",
  "color-balance",
  "photo-filter",
  "color-lookup",
  "selective-color",
  "shadows-highlights",
  "hdr-toning",
  "replace-color",
  "gaussian-blur",
  "box-blur",
  "motion-blur",
  "sharpen",
  "unsharp-mask",
  "gradient-map",
  "emboss",
  "find-edges",
  "solarize",
  "pixelate",
  "noise",
])

export const GPU_ADJUSTMENT_TYPES = new Set([
  "brightness-contrast",
  "exposure",
  "invert",
  "hue-saturation",
  "vibrance",
  "posterize",
  "threshold",
  "levels",
  "curves",
  "channel-mixer",
  "black-white",
  "desaturate",
  "grayscale",
  "color-balance",
  "photo-filter",
  "color-lookup",
  "selective-color",
  "shadows-highlights",
  "hdr-toning",
  "replace-color",
])

export function readNumberParam(params: Record<string, number | string | boolean> | undefined, key: string, fallback: number) {
  if (!params) return fallback
  const v = params[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const parsed = Number(v)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function readStringParam(params: Record<string, number | string | boolean> | undefined, key: string, fallback: string) {
  const v = params?.[key]
  return typeof v === "string" && v.trim() ? v : fallback
}

export function readBooleanParam(params: Record<string, number | string | boolean> | undefined, key: string, fallback: boolean) {
  const v = params?.[key]
  return typeof v === "boolean" ? v : fallback
}

export function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function hasLayerEffects(layer: Layer) {
  const style = layer.style
  if (!style) return false
  return Object.values(style).some((effect) => effect && typeof effect === "object" && "enabled" in effect && effect.enabled === true)
}

const GPU_LAYER_STYLE_EFFECTS = new Set([
  "outerGlow",
  "innerGlow",
  "innerShadow",
  "bevel",
  "colorOverlay",
  "gradientOverlay",
  "patternOverlay",
  "dropShadow",
  "satin",
  "stroke",
])

export function hasUnsupportedLayerEffects(layer: Layer) {
  if (!hasLayerEffects(layer)) return false
  const style = layer.style as Record<string, unknown> | undefined
  if (!style) return false
  return Object.entries(style).some(([key, effect]) =>
    !GPU_LAYER_STYLE_EFFECTS.has(key) && !!effect && typeof effect === "object" && "enabled" in effect && effect.enabled === true,
  )
}

export function hasUnsupportedSmartFilters(layer: Layer) {
  return (layer.smartFilters ?? [])
    .filter((filter) => filter.enabled !== false)
    .some((filter) => {
      const feather = filter.maskFeather ?? 0
      const density = filter.maskDensity ?? 1
      return (
        !GPU_FILTERS.has(filter.filterId) ||
        feather < 0 ||
        feather > 32 ||
        density < 0 ||
        density > 1 ||
        !COMPATIBLE_BLEND_MODES.has(filter.blendMode ?? "normal")
      )
    })
}

export function hasAdvancedKnockout(layer: Layer) {
  return !!layer.advancedBlending && layer.advancedBlending.knockout !== "none"
}

export function hasUnsupportedAdvancedKnockout(_layer: Layer) {
  return false
}

