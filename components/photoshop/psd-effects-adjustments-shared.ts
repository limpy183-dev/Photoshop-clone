"use client"

/**
 * Shared descriptor utilities for the PSD effects/adjustments round-trip
 * helpers: blend-mode mapping, color parsing, unit helpers, contour presets,
 * and gradient conversion. Extracted verbatim from psd-effects-adjustments.ts.
 */

import type {
  BlendMode as PsdBlendMode,
  Color as PsdColor,
  EffectContour,
  EffectSolidGradient,
} from "ag-psd"

import type {
  BlendMode,
  MultiGradient,
} from "./types"

/* -------------------------------------------------------------------------- */
/* Color/blend-mode helpers                                                    */
/* -------------------------------------------------------------------------- */

export const APP_BLEND_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
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
])

export function psdBlendToApp(mode: PsdBlendMode | string | undefined): BlendMode {
  const normalized = ((mode ?? "normal") as string).replace(/\s+/g, "-") as BlendMode
  return APP_BLEND_MODES.has(normalized) ? normalized : "normal"
}

export function appBlendToPsd(mode: BlendMode): PsdBlendMode {
  return mode.replace(/-/g, " ") as PsdBlendMode
}

export function parseHexColor(hex: string): PsdColor {
  const clean = String(hex || "").replace("#", "").trim()
  const value =
    clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean.padEnd(6, "0").slice(0, 6)
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  }
}

export function colorToHex(color: PsdColor | undefined, fallback = "#000000"): string {
  if (!color || typeof color !== "object") return fallback
  const c = color as Record<string, unknown>
  const r = typeof c.r === "number" ? c.r : 0
  const g = typeof c.g === "number" ? c.g : 0
  const b = typeof c.b === "number" ? c.b : 0
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function px(value: number | undefined) {
  return { units: "Pixels" as const, value: Math.max(0, Number(value) || 0) }
}

export function offsetToDistance(x: number | undefined, y: number | undefined) {
  return Math.hypot(Number(x) || 0, Number(y) || 0)
}

export function offsetToAngle(x: number | undefined, y: number | undefined) {
  const angle = (Math.atan2(-(Number(y) || 0), Number(x) || 0) * 180) / Math.PI
  return Number.isFinite(angle) ? (angle + 360) % 360 : 120
}

export function clamp01(value: number | undefined, fallback = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

export function clampByte(value: number | undefined, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(255, Math.round(n)))
}

/* -------------------------------------------------------------------------- */
/* Contour curve presets                                                       */
/* -------------------------------------------------------------------------- */

export type ContourPreset = "linear" | "soft" | "sharp" | "ring" | "cone"

const CONTOUR_PRESETS: Record<ContourPreset, EffectContour> = {
  linear: {
    name: "Linear",
    curve: [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
  },
  soft: {
    name: "Cone - Inverted",
    curve: [
      { x: 0, y: 0 },
      { x: 64, y: 96 },
      { x: 192, y: 200 },
      { x: 255, y: 255 },
    ],
  },
  sharp: {
    name: "Gaussian",
    curve: [
      { x: 0, y: 0 },
      { x: 96, y: 32 },
      { x: 160, y: 224 },
      { x: 255, y: 255 },
    ],
  },
  ring: {
    name: "Ring",
    curve: [
      { x: 0, y: 0 },
      { x: 64, y: 255 },
      { x: 192, y: 255 },
      { x: 255, y: 0 },
    ],
  },
  cone: {
    name: "Cone",
    curve: [
      { x: 0, y: 0 },
      { x: 128, y: 255 },
      { x: 255, y: 0 },
    ],
  },
}

export function contourFromPreset(preset?: ContourPreset): EffectContour | undefined {
  if (!preset) return undefined
  return CONTOUR_PRESETS[preset]
}

/**
 * Map an ag-psd contour back to one of our enum presets by lookup of its
 * `name` field. Falls back to "linear" since every contour is at least a
 * monotonic curve from (0,0).
 */
export function contourToPreset(contour: EffectContour | undefined): ContourPreset | undefined {
  if (!contour) return undefined
  const name = (contour.name || "").toLowerCase()
  if (name.includes("ring")) return "ring"
  if (name.includes("cone") && name.includes("inverted")) return "soft"
  if (name.includes("cone")) return "cone"
  if (name.includes("gaussian") || name.includes("sharp")) return "sharp"
  if (name.includes("soft") || name.includes("half")) return "soft"
  if (name.includes("linear")) return "linear"
  return undefined
}

/* -------------------------------------------------------------------------- */
/* Gradient helpers                                                            */
/* -------------------------------------------------------------------------- */

export function appGradientToPsd(gradient: MultiGradient, name = "Gradient"): EffectSolidGradient {
  return {
    name,
    type: "solid",
    smoothness: 100,
    colorStops: gradient.stops.map((stop) => ({
      location: Math.round(clamp01(stop.offset, 0) * 4096),
      midpoint: 50,
      color: parseHexColor(stop.color),
    })),
    opacityStops: gradient.stops.map((stop) => ({
      location: Math.round(clamp01(stop.offset, 0) * 4096),
      midpoint: 50,
      opacity: clamp01(stop.opacity, 1),
    })),
  }
}

export function psdGradientToApp(
  gradient: EffectSolidGradient,
  type: MultiGradient["type"] = "linear",
  angle = 0,
): MultiGradient {
  return {
    type,
    angle,
    stops: gradient.colorStops.map((stop, index) => ({
      offset: Math.max(0, Math.min(1, (stop.location ?? 0) / 4096)),
      color: colorToHex(stop.color, "#000000"),
      opacity: clamp01(gradient.opacityStops?.[index]?.opacity, 1),
    })),
  }
}

export function psdGradientStyleToApp(type: string | undefined): MultiGradient["type"] {
  if (type === "angle") return "angular"
  if (type === "radial" || type === "reflected" || type === "diamond") return type
  return "linear"
}

export function appGradientStyleToPsd(type: MultiGradient["type"]) {
  if (type === "angular") return "angle" as const
  return type
}
