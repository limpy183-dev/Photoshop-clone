/**
 * Pure helpers behind the Layer Style dialog: merging a style over its
 * defaults, scaling every distance in a style by a factor, the built-in preset
 * list, and the blend-mode label formatter.
 *
 * None of this touches React — it is style-record maths, so it lives here
 * rather than in the dialog that happens to call it.
 */

import { defaultStyle } from "@/editor/layer-styles"
import type { LayerStyle } from "@/editor/types"

export type StyleKey =
  | "blending"
  | "dropShadow"
  | "outerGlow"
  | "innerGlow"
  | "innerShadow"
  | "bevel"
  | "satin"
  | "colorOverlay"
  | "gradientOverlay"
  | "stroke"
  | "patternOverlay"

export type EffectKey = Exclude<StyleKey, "blending">

/** The effect list in Photoshop's dialog order — Blending Options first. */
export const EFFECTS: { key: StyleKey; label: string }[] = [
  { key: "blending", label: "Blending Options" },
  { key: "bevel", label: "Bevel & Emboss" },
  { key: "stroke", label: "Stroke" },
  { key: "innerShadow", label: "Inner Shadow" },
  { key: "innerGlow", label: "Inner Glow" },
  { key: "satin", label: "Satin" },
  { key: "colorOverlay", label: "Color Overlay" },
  { key: "gradientOverlay", label: "Gradient Overlay" },
  { key: "patternOverlay", label: "Pattern Overlay" },
  { key: "outerGlow", label: "Outer Glow" },
  { key: "dropShadow", label: "Drop Shadow" },
]

/** Structured clone with a JSON fallback for older runtimes. */
export function cloneStyle(style: LayerStyle): LayerStyle {
  if (typeof structuredClone === "function") return structuredClone(style)
  return JSON.parse(JSON.stringify(style))
}

export function mergeStyle(base: LayerStyle, incoming: LayerStyle | undefined) {
  if (!incoming) return base
  const next: Partial<import("@/editor/types").LayerStyle> = { ...base }
  for (const { key } of EFFECTS) {
    if (key === "blending") continue
    const current = (incoming as Record<string, unknown>)[key]
    if (!current) continue
    ;(next as Partial<Record<EffectKey, unknown>>)[key] = mergeEffect(
      (base as Record<string, unknown>)[key] as Record<string, unknown>,
      current as Record<string, unknown>,
    )
  }
  return next as LayerStyle
}

export function mergeEffect(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...(base ?? {}), ...(patch ?? {}) }
  if (base?.gradient || patch?.gradient) {
    const bg = base?.gradient as Record<string, unknown> | undefined
    const pg = patch?.gradient as Record<string, unknown> | undefined
    next.gradient = { ...(bg ?? {}), ...(pg ?? {}) }
    if (bg?.stops || pg?.stops) {
      (next.gradient as Record<string, unknown>).stops = pg?.stops ?? bg?.stops
    }
  }
  return next
}

export function builtInStylePresets(color: string): { id: string; name: string; style: LayerStyle }[] {
  const base = () => defaultStyle(color)
  const make = (id: string, name: string, patch: Partial<LayerStyle>) => ({
    id,
    name,
    style: mergeStyle(base(), patch as LayerStyle),
  })
  return [
    make("neon", "Neon Glow", {
      outerGlow: { enabled: true, color: "#00e5ff", size: 28, opacity: 0.9, blendMode: "screen", spread: 8, range: 70, noise: 0 },
      innerGlow: { enabled: true, color: "#ffffff", size: 8, opacity: 0.65, blendMode: "screen", source: "edge", choke: 0, range: 60, noise: 0 },
    }),
    make("gold", "Polished Gold", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 260, size: 8, soften: 1, angle: 120, altitude: 35, highlight: "#fff4b0", shadow: "#5f3400", opacity: 0.8, highlightOpacity: 0.95, shadowOpacity: 0.75, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      gradientOverlay: { enabled: true, opacity: 1, blendMode: "normal", gradient: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#7a3f00", opacity: 1 }, { offset: 0.5, color: "#ffd86b", opacity: 1 }, { offset: 1, color: "#9f6500", opacity: 1 }] } },
    }),
    make("chrome", "Chrome", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 360, size: 7, soften: 0, angle: 120, altitude: 45, highlight: "#ffffff", shadow: "#111827", opacity: 0.9, highlightOpacity: 1, shadowOpacity: 0.8, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      gradientOverlay: { enabled: true, opacity: 1, blendMode: "normal", gradient: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#f8fafc", opacity: 1 }, { offset: 0.25, color: "#64748b", opacity: 1 }, { offset: 0.5, color: "#ffffff", opacity: 1 }, { offset: 0.75, color: "#334155", opacity: 1 }, { offset: 1, color: "#f8fafc", opacity: 1 }] } },
    }),
    make("glass", "Clear Glass", {
      innerGlow: { enabled: true, color: "#ffffff", size: 16, opacity: 0.45, blendMode: "screen", source: "edge", choke: 8, range: 80, noise: 0 },
      stroke: { enabled: true, color: "#dbeafe", size: 2, position: "inside", opacity: 0.7, blendMode: "screen", fillType: "color" },
    }),
    make("plastic", "Soft Plastic", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 120, size: 10, soften: 4, angle: 120, altitude: 30, highlight: "#ffffff", shadow: "#1f2937", opacity: 0.65, highlightOpacity: 0.8, shadowOpacity: 0.45, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      innerShadow: { enabled: true, color: "#000000", size: 12, offsetX: 2, offsetY: 2, opacity: 0.22, blendMode: "multiply", angle: 120, distance: 2, choke: 0, useGlobalLight: true },
    }),
    make("emboss", "Paper Emboss", {
      bevel: { enabled: true, style: "emboss", direction: "up", depth: 90, size: 5, soften: 2, angle: 120, altitude: 25, highlight: "#ffffff", shadow: "#94a3b8", opacity: 0.7, highlightOpacity: 0.65, shadowOpacity: 0.45, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
    }),
    make("sticker", "Sticker Edge", {
      stroke: { enabled: true, color: "#ffffff", size: 10, position: "outside", opacity: 1, blendMode: "normal", fillType: "color" },
      dropShadow: { enabled: true, color: "#000000", size: 16, offsetX: 0, offsetY: 8, opacity: 0.35, blendMode: "multiply", angle: 90, distance: 8, spread: 0, noise: 0, useGlobalLight: false },
    }),
    make("shadow-card", "Soft Shadow", {
      dropShadow: { enabled: true, color: "#000000", size: 24, offsetX: 0, offsetY: 12, opacity: 0.28, blendMode: "multiply", angle: 90, distance: 12, spread: 0, noise: 0, useGlobalLight: false },
    }),
    make("red-glow", "Red Alert Glow", {
      outerGlow: { enabled: true, color: "#ef4444", size: 30, opacity: 0.85, blendMode: "screen", spread: 12, range: 65, noise: 0 },
      colorOverlay: { enabled: true, color: "#fee2e2", opacity: 0.18, blendMode: "screen" },
    }),
    make("blueprint", "Blueprint Line", {
      stroke: { enabled: true, color: "#38bdf8", size: 3, position: "center", opacity: 1, blendMode: "screen", fillType: "color" },
      outerGlow: { enabled: true, color: "#0ea5e9", size: 10, opacity: 0.45, blendMode: "screen", spread: 0, range: 50, noise: 0 },
    }),
  ]
}

export function scaleLayerStyle(style: LayerStyle, factor: number): LayerStyle {
  const scaleNumber = (value: number | undefined) => (value === undefined ? value : Math.max(0, Math.round(value * factor)))
  const next = cloneStyle(style)
  if (next.dropShadow) {
    next.dropShadow.size = scaleNumber(next.dropShadow.size) ?? next.dropShadow.size
    next.dropShadow.distance = scaleNumber(next.dropShadow.distance)
    next.dropShadow.offsetX = scaleNumber(next.dropShadow.offsetX) ?? next.dropShadow.offsetX
    next.dropShadow.offsetY = scaleNumber(next.dropShadow.offsetY) ?? next.dropShadow.offsetY
  }
  if (next.innerShadow) {
    next.innerShadow.size = scaleNumber(next.innerShadow.size) ?? next.innerShadow.size
    next.innerShadow.distance = scaleNumber(next.innerShadow.distance)
    next.innerShadow.offsetX = scaleNumber(next.innerShadow.offsetX) ?? next.innerShadow.offsetX
    next.innerShadow.offsetY = scaleNumber(next.innerShadow.offsetY) ?? next.innerShadow.offsetY
  }
  if (next.outerGlow) next.outerGlow.size = scaleNumber(next.outerGlow.size) ?? next.outerGlow.size
  if (next.innerGlow) next.innerGlow.size = scaleNumber(next.innerGlow.size) ?? next.innerGlow.size
  if (next.bevel) {
    next.bevel.size = scaleNumber(next.bevel.size) ?? next.bevel.size
    next.bevel.soften = scaleNumber(next.bevel.soften) ?? next.bevel.soften
  }
  if (next.satin) {
    next.satin.distance = scaleNumber(next.satin.distance) ?? next.satin.distance
    next.satin.size = scaleNumber(next.satin.size) ?? next.satin.size
  }
  if (next.stroke) next.stroke.size = scaleNumber(next.stroke.size) ?? next.stroke.size
  if (next.patternOverlay) next.patternOverlay.scale = scaleNumber(next.patternOverlay.scale) ?? next.patternOverlay.scale
  return next
}

export function titleCaseBlend(value: string) {
  return value
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}
