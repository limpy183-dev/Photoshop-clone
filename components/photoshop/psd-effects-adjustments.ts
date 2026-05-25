"use client"

/**
 * Stream 2: PSD round-trip helpers for layer styles, adjustment layers,
 * smart filters, and advanced blending.
 *
 * This module is independent of document-io.ts. The integrator wires it in
 * by importing the helpers below and replacing the in-place versions in
 * document-io.ts. Mental type-check is against ag-psd's exposed
 * declarations (see node_modules/ag-psd/dist/psd.d.ts).
 */

import type {
  AdjustmentLayer as PsdAdjustmentLayer,
  BevelDirection,
  BevelStyle,
  BlackAndWhiteAdjustment,
  BlendMode as PsdBlendMode,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ChannelMixerChannel,
  ColorBalanceAdjustment,
  ColorLookupAdjustment,
  Color as PsdColor,
  CurvesAdjustment,
  CurvesAdjustmentChannel,
  EffectContour,
  EffectSolidGradient,
  ExposureAdjustment,
  Filter as PsdFilter,
  GlowSource,
  GradientMapAdjustment,
  HueSaturationAdjustment,
  HueSaturationAdjustmentChannel,
  InvertAdjustment,
  Layer as PsdLayer,
  LayerEffectsInfo,
  LayerEffectBevel,
  LayerEffectShadow,
  LayerEffectsOuterGlow,
  LayerEffectInnerGlow,
  LayerEffectStroke,
  LayerEffectSatin,
  LayerEffectGradientOverlay,
  LayerEffectPatternOverlay,
  LayerEffectSolidFill,
  LevelsAdjustment,
  LevelsAdjustmentChannel,
  PhotoFilterAdjustment,
  PlacedLayerFilter,
  PosterizeAdjustment,
  SelectiveColorAdjustment,
  ThresholdAdjustment,
  VibranceAdjustment,
} from "ag-psd"

import type {
  AdjustmentProps,
  AdjustmentType,
  AdvancedBlending,
  BlendIfRange,
  BlendMode,
  Layer,
  LayerStyle,
  MultiGradient,
  SmartFilter,
} from "./types"
import { createBlurGalleryMeshResource, isBlurGalleryFilterId } from "./blur-gallery-controls"

/* -------------------------------------------------------------------------- */
/* Capability descriptor                                                       */
/* -------------------------------------------------------------------------- */

export type CapabilityStatus =
  | "round-trip"
  | "metadata-preserved"
  | "lossy"

export interface EffectsAdjustmentsCapability {
  layerStyles: CapabilityStatus
  adjustments: Record<AdjustmentType, CapabilityStatus>
  smartFilters: CapabilityStatus
  advancedBlending: CapabilityStatus
}

/**
 * Round-trip capability documentation consumed by the compatibility report.
 * "round-trip" types use ag-psd's native adjustment payload.
 * "metadata-preserved" types keep editable app parameters in the PSD
 * app-preservation payload when ag-psd has no matching native descriptor.
 */
export const EFFECTS_ADJUSTMENTS_CAPABILITY: EffectsAdjustmentsCapability = {
  layerStyles: "round-trip",
  adjustments: {
    "brightness-contrast": "round-trip",
    levels: "round-trip",
    curves: "round-trip",
    exposure: "round-trip",
    vibrance: "round-trip",
    "hue-saturation": "round-trip",
    "color-balance": "round-trip",
    "black-white": "round-trip",
    "photo-filter": "round-trip",
    "channel-mixer": "round-trip",
    "color-lookup": "round-trip",
    invert: "round-trip",
    posterize: "round-trip",
    threshold: "round-trip",
    "gradient-map": "round-trip",
    "selective-color": "round-trip",
    "shadows-highlights": "metadata-preserved",
    "hdr-toning": "metadata-preserved",
    desaturate: "round-trip",
    "match-color": "metadata-preserved",
    "replace-color": "metadata-preserved",
    equalize: "metadata-preserved",
  },
  smartFilters: "metadata-preserved",
  advancedBlending: "round-trip",
}

/* -------------------------------------------------------------------------- */
/* Color/blend-mode helpers                                                    */
/* -------------------------------------------------------------------------- */

const APP_BLEND_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
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

function psdBlendToApp(mode: PsdBlendMode | string | undefined): BlendMode {
  const normalized = ((mode ?? "normal") as string).replace(/\s+/g, "-") as BlendMode
  return APP_BLEND_MODES.has(normalized) ? normalized : "normal"
}

function appBlendToPsd(mode: BlendMode): PsdBlendMode {
  return mode.replace(/-/g, " ") as PsdBlendMode
}

function parseHexColor(hex: string): PsdColor {
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

function colorToHex(color: PsdColor | undefined, fallback = "#000000"): string {
  if (!color || typeof color !== "object") return fallback
  const c = color as Record<string, unknown>
  const r = typeof c.r === "number" ? c.r : 0
  const g = typeof c.g === "number" ? c.g : 0
  const b = typeof c.b === "number" ? c.b : 0
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function px(value: number | undefined) {
  return { units: "Pixels" as const, value: Math.max(0, Number(value) || 0) }
}

function offsetToDistance(x: number | undefined, y: number | undefined) {
  return Math.hypot(Number(x) || 0, Number(y) || 0)
}

function offsetToAngle(x: number | undefined, y: number | undefined) {
  const angle = (Math.atan2(-(Number(y) || 0), Number(x) || 0) * 180) / Math.PI
  return Number.isFinite(angle) ? (angle + 360) % 360 : 120
}

function clamp01(value: number | undefined, fallback = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function clampByte(value: number | undefined, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(255, Math.round(n)))
}

/* -------------------------------------------------------------------------- */
/* Contour curve presets                                                       */
/* -------------------------------------------------------------------------- */

type ContourPreset = "linear" | "soft" | "sharp" | "ring" | "cone"

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

function contourFromPreset(preset?: ContourPreset): EffectContour | undefined {
  if (!preset) return undefined
  return CONTOUR_PRESETS[preset]
}

/**
 * Map an ag-psd contour back to one of our enum presets by lookup of its
 * `name` field. Falls back to "linear" since every contour is at least a
 * monotonic curve from (0,0).
 */
function contourToPreset(contour: EffectContour | undefined): ContourPreset | undefined {
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

function appGradientToPsd(gradient: MultiGradient, name = "Gradient"): EffectSolidGradient {
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

function psdGradientToApp(
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

function psdGradientStyleToApp(type: string | undefined): MultiGradient["type"] {
  if (type === "angle") return "angular"
  if (type === "radial" || type === "reflected" || type === "diamond") return type
  return "linear"
}

function appGradientStyleToPsd(type: MultiGradient["type"]) {
  if (type === "angular") return "angle" as const
  return type
}

/* -------------------------------------------------------------------------- */
/* Layer style: app -> PSD                                                     */
/* -------------------------------------------------------------------------- */

export function layerStyleToPsdEffects(
  style: LayerStyle | undefined,
  globalLight?: { angle: number; altitude: number },
): LayerEffectsInfo | undefined {
  if (!style) return undefined
  const effects: LayerEffectsInfo = { scale: 1 }

  if (style.dropShadow?.enabled) {
    const ds = style.dropShadow
    const distance = ds.distance ?? offsetToDistance(ds.offsetX, ds.offsetY)
    const angle = ds.angle ?? offsetToAngle(ds.offsetX, ds.offsetY)
    const shadow: LayerEffectShadow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(ds.size),
      distance: px(distance),
      angle: ds.useGlobalLight && globalLight ? globalLight.angle : angle,
      color: parseHexColor(ds.color),
      blendMode: appBlendToPsd(ds.blendMode ?? "multiply"),
      opacity: clamp01(ds.opacity, 0.75),
      choke: px(ds.spread),
      useGlobalLight: !!ds.useGlobalLight,
    }
    const contour = contourFromPreset(ds.contour)
    if (contour) shadow.contour = contour
    effects.dropShadow = [shadow]
  }

  if (style.innerShadow?.enabled) {
    const is = style.innerShadow
    const distance = is.distance ?? offsetToDistance(is.offsetX, is.offsetY)
    const angle = is.angle ?? offsetToAngle(is.offsetX, is.offsetY)
    effects.innerShadow = [{
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(is.size),
      distance: px(distance),
      angle: is.useGlobalLight && globalLight ? globalLight.angle : angle,
      color: parseHexColor(is.color),
      blendMode: appBlendToPsd(is.blendMode ?? "multiply"),
      opacity: clamp01(is.opacity, 0.75),
      choke: px(is.choke),
      useGlobalLight: !!is.useGlobalLight,
    }]
  }

  if (style.outerGlow?.enabled) {
    const og = style.outerGlow
    const out: LayerEffectsOuterGlow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(og.size),
      color: parseHexColor(og.color),
      blendMode: appBlendToPsd(og.blendMode ?? "screen"),
      opacity: clamp01(og.opacity, 0.75),
      choke: px(og.spread),
      range: og.range,
      noise: og.noise,
    }
    const contour = contourFromPreset(og.contour)
    if (contour) out.contour = contour
    effects.outerGlow = out
  }

  if (style.innerGlow?.enabled) {
    const ig = style.innerGlow
    const out: LayerEffectInnerGlow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(ig.size),
      color: parseHexColor(ig.color),
      blendMode: appBlendToPsd(ig.blendMode ?? "screen"),
      opacity: clamp01(ig.opacity, 0.75),
      source: (ig.source ?? "edge") as GlowSource,
      choke: px(ig.choke),
      range: ig.range,
      noise: ig.noise,
    }
    const contour = contourFromPreset(ig.contour)
    if (contour) out.contour = contour
    effects.innerGlow = out
  }

  if (style.stroke?.enabled) {
    const sk = style.stroke
    const out: LayerEffectStroke = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(sk.size),
      position: sk.position,
      fillType: sk.fillType ?? "color",
      color: parseHexColor(sk.color),
      blendMode: appBlendToPsd(sk.blendMode ?? "normal"),
      opacity: clamp01(sk.opacity, 1),
    }
    if (sk.gradient) out.gradient = appGradientToPsd(sk.gradient, "Stroke Gradient")
    effects.stroke = [out]
  }

  if (style.colorOverlay?.enabled) {
    const co = style.colorOverlay
    const fill: LayerEffectSolidFill = {
      enabled: true,
      present: true,
      showInDialog: true,
      color: parseHexColor(co.color),
      blendMode: appBlendToPsd(co.blendMode ?? "normal"),
      opacity: clamp01(co.opacity, 1),
    }
    effects.solidFill = [fill]
  }

  if (style.gradientOverlay?.enabled) {
    const go = style.gradientOverlay
    const gOut: LayerEffectGradientOverlay = {
      enabled: true,
      present: true,
      showInDialog: true,
      blendMode: appBlendToPsd(go.blendMode ?? "normal"),
      opacity: clamp01(go.opacity, 1),
      type: appGradientStyleToPsd(go.gradient.type),
      angle: go.gradient.angle,
      gradient: appGradientToPsd(go.gradient, "Gradient Overlay"),
    }
    effects.gradientOverlay = [gOut]
  }

  if (style.bevel?.enabled) {
    const bv = style.bevel
    const styleMap: Record<NonNullable<LayerStyle["bevel"]>["style"], BevelStyle> = {
      inner: "inner bevel",
      outer: "outer bevel",
      emboss: "emboss",
      pillow: "pillow emboss",
    }
    const out: LayerEffectBevel = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(bv.size),
      soften: px(bv.soften),
      strength: bv.depth,
      angle: bv.useGlobalLight && globalLight ? globalLight.angle : bv.angle,
      altitude: bv.useGlobalLight && globalLight ? globalLight.altitude : bv.altitude,
      direction: (bv.direction ?? "up") as BevelDirection,
      style: styleMap[bv.style] ?? "inner bevel",
      highlightColor: parseHexColor(bv.highlight),
      shadowColor: parseHexColor(bv.shadow),
      highlightOpacity: clamp01(bv.highlightOpacity ?? bv.opacity, 0.75),
      shadowOpacity: clamp01(bv.shadowOpacity ?? bv.opacity, 0.75),
      highlightBlendMode: appBlendToPsd(bv.highlightBlendMode ?? "screen"),
      shadowBlendMode: appBlendToPsd(bv.shadowBlendMode ?? "multiply"),
      useGlobalLight: !!bv.useGlobalLight,
    }
    const contour = contourFromPreset(bv.contour)
    if (contour) out.contour = contour
    effects.bevel = out
  }

  if (style.satin?.enabled) {
    const sa = style.satin
    effects.satin = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(sa.size),
      distance: px(sa.distance),
      angle: sa.angle ?? 19,
      color: parseHexColor(sa.color),
      blendMode: appBlendToPsd(sa.blendMode ?? "multiply"),
      opacity: clamp01(sa.opacity, 0.5),
      invert: !!sa.invert,
    }
  }

  if (style.patternOverlay?.enabled) {
    const po = style.patternOverlay
    const safeScale = Math.max(1, Math.min(1000, Math.round(po.scale || 100)))
    const patternId = `pat_${(po.pattern || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}`
    const out: LayerEffectPatternOverlay = {
      enabled: true,
      present: true,
      showInDialog: true,
      blendMode: appBlendToPsd(po.blendMode ?? "normal"),
      opacity: clamp01(po.opacity, 1),
      scale: safeScale,
      align: po.align !== false,
      phase: po.phase
        ? { x: Number(po.phase.x) || 0, y: Number(po.phase.y) || 0 }
        : { x: 0, y: 0 },
      pattern: { name: po.pattern || "Pattern", id: patternId },
    }
    effects.patternOverlay = out
  }

  return Object.keys(effects).length > 1 ? effects : undefined
}

/* -------------------------------------------------------------------------- */
/* Layer style: PSD -> app                                                     */
/* -------------------------------------------------------------------------- */

export function psdEffectsToLayerStyle(effects: LayerEffectsInfo | undefined): LayerStyle | undefined {
  if (!effects) return undefined
  const style: LayerStyle = {}

  const dropShadow = effects.dropShadow?.find((effect) => effect.enabled)
  if (dropShadow) {
    const distance = dropShadow.distance?.value ?? 0
    const angle = dropShadow.angle ?? 120
    style.dropShadow = {
      enabled: true,
      color: colorToHex(dropShadow.color, "#000000"),
      size: dropShadow.size?.value ?? 0,
      offsetX: Math.cos((angle * Math.PI) / 180) * distance,
      offsetY: -Math.sin((angle * Math.PI) / 180) * distance,
      opacity: clamp01(dropShadow.opacity, 0.75),
      blendMode: psdBlendToApp(dropShadow.blendMode),
      angle,
      distance,
      spread: dropShadow.choke?.value,
      useGlobalLight: !!dropShadow.useGlobalLight,
      contour: contourToPreset(dropShadow.contour),
    }
  }

  const innerShadow = effects.innerShadow?.find((effect) => effect.enabled)
  if (innerShadow) {
    const distance = innerShadow.distance?.value ?? 0
    const angle = innerShadow.angle ?? 120
    style.innerShadow = {
      enabled: true,
      color: colorToHex(innerShadow.color, "#000000"),
      size: innerShadow.size?.value ?? 0,
      offsetX: Math.cos((angle * Math.PI) / 180) * distance,
      offsetY: -Math.sin((angle * Math.PI) / 180) * distance,
      opacity: clamp01(innerShadow.opacity, 0.75),
      blendMode: psdBlendToApp(innerShadow.blendMode),
      angle,
      distance,
      choke: innerShadow.choke?.value,
      useGlobalLight: !!innerShadow.useGlobalLight,
    }
  }

  if (effects.outerGlow?.enabled) {
    style.outerGlow = {
      enabled: true,
      color: colorToHex(effects.outerGlow.color, "#ffffff"),
      size: effects.outerGlow.size?.value ?? 0,
      opacity: clamp01(effects.outerGlow.opacity, 0.75),
      blendMode: psdBlendToApp(effects.outerGlow.blendMode),
      spread: effects.outerGlow.choke?.value,
      range: effects.outerGlow.range,
      noise: effects.outerGlow.noise,
      contour: contourToPreset(effects.outerGlow.contour),
    }
  }

  if (effects.innerGlow?.enabled) {
    style.innerGlow = {
      enabled: true,
      color: colorToHex(effects.innerGlow.color, "#ffffff"),
      size: effects.innerGlow.size?.value ?? 0,
      opacity: clamp01(effects.innerGlow.opacity, 0.75),
      blendMode: psdBlendToApp(effects.innerGlow.blendMode),
      source: effects.innerGlow.source === "center" ? "center" : "edge",
      choke: effects.innerGlow.choke?.value,
      range: effects.innerGlow.range,
      noise: effects.innerGlow.noise,
      contour: contourToPreset(effects.innerGlow.contour),
    }
  }

  const stroke = effects.stroke?.find((effect) => effect.enabled)
  if (stroke) {
    const isGradient = stroke.fillType === "gradient" && stroke.gradient && stroke.gradient.type === "solid"
    style.stroke = {
      enabled: true,
      color: colorToHex(stroke.color, "#000000"),
      size: stroke.size?.value ?? 1,
      position: stroke.position ?? "outside",
      opacity: clamp01(stroke.opacity, 1),
      blendMode: psdBlendToApp(stroke.blendMode),
      fillType: stroke.fillType === "gradient" ? "gradient" : "color",
      gradient: isGradient
        ? psdGradientToApp(stroke.gradient as EffectSolidGradient, "linear", 0)
        : undefined,
    }
  }

  const solidFill = effects.solidFill?.find((effect) => effect.enabled)
  if (solidFill) {
    style.colorOverlay = {
      enabled: true,
      color: colorToHex(solidFill.color, "#000000"),
      opacity: clamp01(solidFill.opacity, 1),
      blendMode: psdBlendToApp(solidFill.blendMode),
    }
  }

  const gradientOverlay = effects.gradientOverlay?.find((effect) => effect.enabled)
  if (gradientOverlay?.gradient && gradientOverlay.gradient.type === "solid") {
    style.gradientOverlay = {
      enabled: true,
      opacity: clamp01(gradientOverlay.opacity, 1),
      blendMode: psdBlendToApp(gradientOverlay.blendMode as PsdBlendMode),
      gradient: psdGradientToApp(
        gradientOverlay.gradient,
        psdGradientStyleToApp(gradientOverlay.type),
        gradientOverlay.angle ?? 0,
      ),
    }
  }

  if (effects.bevel?.enabled) {
    const styleMap: Record<BevelStyle, NonNullable<LayerStyle["bevel"]>["style"]> = {
      "inner bevel": "inner",
      "outer bevel": "outer",
      emboss: "emboss",
      "pillow emboss": "pillow",
      "stroke emboss": "emboss",
    }
    style.bevel = {
      enabled: true,
      style: styleMap[effects.bevel.style ?? "inner bevel"] ?? "inner",
      direction: effects.bevel.direction === "down" ? "down" : "up",
      depth: effects.bevel.strength ?? 100,
      size: effects.bevel.size?.value ?? 0,
      soften: effects.bevel.soften?.value ?? 0,
      angle: effects.bevel.angle ?? 120,
      altitude: effects.bevel.altitude ?? 30,
      highlight: colorToHex(effects.bevel.highlightColor, "#ffffff"),
      shadow: colorToHex(effects.bevel.shadowColor, "#000000"),
      opacity: Math.max(
        clamp01(effects.bevel.highlightOpacity, 0),
        clamp01(effects.bevel.shadowOpacity, 0),
        0.75,
      ),
      highlightOpacity: clamp01(effects.bevel.highlightOpacity, 0.75),
      shadowOpacity: clamp01(effects.bevel.shadowOpacity, 0.75),
      highlightBlendMode: psdBlendToApp(effects.bevel.highlightBlendMode),
      shadowBlendMode: psdBlendToApp(effects.bevel.shadowBlendMode),
      useGlobalLight: !!effects.bevel.useGlobalLight,
      contour: contourToPreset(effects.bevel.contour),
    }
  }

  if (effects.satin?.enabled) {
    style.satin = {
      enabled: true,
      color: colorToHex(effects.satin.color, "#000000"),
      blendMode: psdBlendToApp(effects.satin.blendMode),
      opacity: clamp01(effects.satin.opacity, 0.5),
      angle: effects.satin.angle ?? 19,
      distance: effects.satin.distance?.value ?? 11,
      size: effects.satin.size?.value ?? 14,
      invert: !!effects.satin.invert,
    }
  }

  // ag-psd models patternOverlay as a single object (not an array). Be defensive
  // against either shape since older payloads or alternate runners may differ.
  const patternRaw = Array.isArray(effects.patternOverlay)
    ? effects.patternOverlay.find((effect: LayerEffectPatternOverlay) => effect.enabled)
    : effects.patternOverlay
  if (patternRaw?.enabled) {
    style.patternOverlay = {
      enabled: true,
      pattern: patternRaw.pattern?.name ?? patternRaw.pattern?.id ?? "Pattern",
      blendMode: psdBlendToApp(patternRaw.blendMode),
      opacity: clamp01(patternRaw.opacity, 1),
      scale: Math.max(1, Math.min(1000, Math.round(patternRaw.scale ?? 100))),
      align: patternRaw.align !== false,
      phase: patternRaw.phase ? { x: Number(patternRaw.phase.x) || 0, y: Number(patternRaw.phase.y) || 0 } : undefined,
    }
  }

  return Object.keys(style).length ? style : undefined
}

/* -------------------------------------------------------------------------- */
/* Marker-name encoding for unsupported adjustment types                       */
/* -------------------------------------------------------------------------- */

const MARKER_PREFIX = "__adj:"
const MARKER_SUFFIX = "__"
const MARKER_RE = /^__adj:([a-z-]+):([A-Za-z0-9+/=]+)__$/

/**
 * Round-trip encoding for adjustment types ag-psd doesn't model natively.
 * We use base64-of-encodeURIComponent so the resulting string only contains
 * characters legal in PSD layer names. The payload survives Photoshop too:
 * Photoshop renames are still in the round-trip envelope, so the marker
 * doesn't need to be invisible.
 */
function encodeAdjustmentMarker(type: AdjustmentType, params: Record<string, unknown>) {
  const safe = JSON.stringify(params ?? {})
  const encoded = btoa(encodeURIComponent(safe))
  return `${MARKER_PREFIX}${type}:${encoded}${MARKER_SUFFIX}`
}

function decodeAdjustmentMarker(name: string | undefined): AdjustmentProps | null {
  if (typeof name !== "string") return null
  const match = name.match(MARKER_RE)
  if (!match) return null
  const type = match[1] as AdjustmentType
  if (!ADJUSTMENT_TYPES_SET.has(type)) return null
  try {
    const decoded = decodeURIComponent(atob(match[2]))
    const params = JSON.parse(decoded) as Record<string, number | string | boolean>
    return { type, params }
  } catch {
    return null
  }
}

const ADJUSTMENT_TYPES_SET = new Set<AdjustmentType>([
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "black-white",
  "photo-filter",
  "channel-mixer",
  "color-lookup",
  "invert",
  "posterize",
  "threshold",
  "gradient-map",
  "selective-color",
  "shadows-highlights",
  "hdr-toning",
  "desaturate",
  "match-color",
  "replace-color",
  "equalize",
])

/* -------------------------------------------------------------------------- */
/* Adjustment converters                                                       */
/* -------------------------------------------------------------------------- */

function levelsChannelFromParams(params: Record<string, number | string | boolean>): LevelsAdjustmentChannel {
  return {
    shadowInput: Math.max(0, Math.min(254, Number(params.inputBlack) || 0)),
    highlightInput: Math.max(1, Math.min(255, Number(params.inputWhite ?? 255))),
    midtoneInput: Math.round(((Number(params.gamma) || 1) * 100)),
    shadowOutput: Math.max(0, Math.min(255, Number(params.outputBlack) || 0)),
    highlightOutput: Math.max(0, Math.min(255, Number(params.outputWhite ?? 255))),
  }
}

function curvesChannelFromParams(params: Record<string, number | string | boolean>): CurvesAdjustmentChannel {
  const shadow = Number(params.shadow) || 0
  const midtone = Number(params.midtone ?? 128)
  const highlight = Number(params.highlight ?? 255)
  return [
    { input: 0, output: clampByte(shadow) },
    { input: 128, output: clampByte(midtone, 128) },
    { input: 255, output: clampByte(highlight, 255) },
  ]
}

function hueSatChannelFromParams(params: Record<string, number | string | boolean>): HueSaturationAdjustmentChannel {
  return {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    hue: Number(params.hue) || 0,
    saturation: Number(params.saturation) || 0,
    lightness: Number(params.lightness) || 0,
  }
}

function channelMixerRow(
  r: unknown,
  g: unknown,
  b: unknown,
  constant = 0,
): ChannelMixerChannel {
  return {
    red: Number(r) || 0,
    green: Number(g) || 0,
    blue: Number(b) || 0,
    constant,
  }
}

/**
 * Translate an app `Layer` whose `kind === "adjustment"` into the PSD layer
 * fields needed by ag-psd. Returns native descriptors where available;
 * unsupported private Photoshop commands are preserved through XMP.
 */
export function appAdjustmentToPsdLayer(layer: Layer): Partial<PsdLayer> {
  if (layer.kind !== "adjustment" || !layer.adjustment) return {}
  const { type, params } = layer.adjustment

  switch (type) {
    case "brightness-contrast": {
      const adjustment: BrightnessAdjustment = {
        type: "brightness/contrast",
        brightness: Number(params.brightness) || 0,
        contrast: Number(params.contrast) || 0,
        useLegacy: params.useLegacy === true,
      }
      return { adjustment }
    }
    case "levels": {
      const channel = String(params.channel ?? "rgb")
      const adjustment: LevelsAdjustment = { type: "levels" }
      const data = levelsChannelFromParams(params)
      if (channel === "red") adjustment.red = data
      else if (channel === "green") adjustment.green = data
      else if (channel === "blue") adjustment.blue = data
      else adjustment.rgb = data
      return { adjustment }
    }
    case "curves": {
      const channel = String(params.channel ?? "rgb")
      const adjustment: CurvesAdjustment = { type: "curves" }
      const data = curvesChannelFromParams(params)
      if (channel === "red") adjustment.red = data
      else if (channel === "green") adjustment.green = data
      else if (channel === "blue") adjustment.blue = data
      else adjustment.rgb = data
      return { adjustment }
    }
    case "exposure": {
      const adjustment: ExposureAdjustment = {
        type: "exposure",
        exposure: Number(params.ev) || 0,
        offset: 0,
        gamma: 1,
      }
      return { adjustment }
    }
    case "vibrance": {
      const adjustment: VibranceAdjustment = {
        type: "vibrance",
        vibrance: Number(params.amount) || 0,
        saturation: Number(params.saturation) || 0,
      }
      return { adjustment }
    }
    case "hue-saturation": {
      const channel = String(params.range ?? "master")
      const adjustment: HueSaturationAdjustment = { type: "hue/saturation" }
      const data = hueSatChannelFromParams(params)
      const slot = channel as keyof HueSaturationAdjustment
      // typed assignment via known slot keys (ag-psd uses string indexer-style fields)
      const channelMap: Record<string, keyof HueSaturationAdjustment> = {
        master: "master",
        reds: "reds",
        yellows: "yellows",
        greens: "greens",
        cyans: "cyans",
        blues: "blues",
        magentas: "magentas",
      }
      const slotKey = channelMap[slot] ?? "master"
      ;(adjustment as unknown as Record<string, unknown>)[slotKey] = data
      return { adjustment }
    }
    case "color-balance": {
      const tone = String(params.tone ?? "midtones") as "shadows" | "midtones" | "highlights"
      const adjustment: ColorBalanceAdjustment = {
        type: "color balance",
        preserveLuminosity: params.preserveLuminosity !== false,
      }
      adjustment[tone] = {
        cyanRed: Number(params.cyanRed) || 0,
        magentaGreen: Number(params.magentaGreen) || 0,
        yellowBlue: Number(params.yellowBlue) || 0,
      }
      return { adjustment }
    }
    case "black-white": {
      const adjustment: BlackAndWhiteAdjustment = {
        type: "black & white",
        reds: Number(params.reds) || 0,
        yellows: Number(params.yellows) || 0,
        greens: Number(params.greens) || 0,
        cyans: Number(params.cyans) || 0,
        blues: Number(params.blues) || 0,
        magentas: Number(params.magentas) || 0,
        useTint: params.tint === true,
      }
      if (params.tint === true) {
        // approximate tint hue/saturation by emitting a gray-ish color stub;
        // a richer color round-trip would require the HSB->RGB pipeline.
        const hue = Number(params.tintHue) || 38
        const sat = (Number(params.tintSaturation) || 18) / 100
        adjustment.tintColor = hsvToRgb(hue, sat, 1)
      }
      return { adjustment }
    }
    case "photo-filter": {
      const adjustment: PhotoFilterAdjustment = {
        type: "photo filter",
        density: Number(params.density) || 25,
        preserveLuminosity: true,
        color: photoFilterColor(String(params.color ?? "warm")),
      }
      return { adjustment }
    }
    case "channel-mixer": {
      const adjustment: ChannelMixerAdjustment = {
        type: "channel mixer",
        monochrome: false,
        red: channelMixerRow(params.rR, params.rG, params.rB),
        green: channelMixerRow(params.gR, params.gG, params.gB),
        blue: channelMixerRow(params.bR, params.bG, params.bB),
      }
      return { adjustment }
    }
    case "color-lookup": {
      const adjustment: ColorLookupAdjustment = {
        type: "color lookup",
        lookupType: "3dlut",
        name: `strength:${Number(params.strength) || 0}`,
        dither: false,
      }
      return { adjustment }
    }
    case "invert": {
      const adjustment: InvertAdjustment = { type: "invert" }
      return { adjustment }
    }
    case "posterize": {
      const adjustment: PosterizeAdjustment = {
        type: "posterize",
        levels: Math.max(2, Math.min(255, Math.round(Number(params.levels) || 4))),
      }
      return { adjustment }
    }
    case "threshold": {
      const adjustment: ThresholdAdjustment = {
        type: "threshold",
        level: Math.max(0, Math.min(255, Math.round(Number(params.level) || 128))),
      }
      return { adjustment }
    }
    case "gradient-map": {
      const adjustment: GradientMapAdjustment = {
        type: "gradient map",
        name: "Gradient Map",
        gradientType: "solid",
        dither: params.dither !== false,
        reverse: params.reverse === true,
        method: "linear",
        smoothness: 100,
        colorStops: [
          { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 50 },
          { color: { r: 255, g: 255, b: 255 }, location: 4096, midpoint: 50 },
        ],
        opacityStops: [
          { opacity: 1, location: 0, midpoint: 50 },
          { opacity: 1, location: 4096, midpoint: 50 },
        ],
      }
      return { adjustment }
    }
    case "selective-color": {
      const colorBucket = (
        c: number | string | boolean | undefined,
        m: number | string | boolean | undefined,
        y: number | string | boolean | undefined,
        k: number | string | boolean | undefined,
      ) => ({
        c: Number(c) || 0,
        m: Number(m) || 0,
        y: Number(y) || 0,
        k: Number(k) || 0,
      })
      const bucket = colorBucket(params.cyans, params.magentas, params.yellows, 0)
      const adjustment: SelectiveColorAdjustment = {
        type: "selective color",
        mode: "relative",
        whites: colorBucket(0, 0, 0, params.whites),
        neutrals: colorBucket(0, 0, 0, params.neutrals),
        blacks: colorBucket(0, 0, 0, params.blacks),
        cyans: bucket,
        magentas: bucket,
        yellows: bucket,
      }
      return { adjustment }
    }
    case "desaturate": {
      const adjustment: HueSaturationAdjustment = {
        type: "hue/saturation",
        master: {
          a: 0,
          b: 0,
          c: 0,
          d: 0,
          hue: 0,
          saturation: -100,
          lightness: 0,
        },
      }
      return { adjustment }
    }
    // ag-psd doesn't expose native descriptors for these Photoshop commands.
    // Preserve their editable params through the XMP app-preservation payload
    // instead of encoding data into the visible layer name.
    case "shadows-highlights":
    case "hdr-toning":
    case "match-color":
    case "replace-color":
    case "equalize":
      return {}
    default:
      return {}
  }
}

/**
 * Reverse of `appAdjustmentToPsdLayer` — reads ag-psd's parsed `adjustment`
 * payload or detects a marker-name. Returns `null` if the PSD layer is not
 * an adjustment.
 */
export function psdLayerToAppAdjustment(psdLayer: PsdLayer): AdjustmentProps | null {
  const marker = decodeAdjustmentMarker(psdLayer.name)
  if (marker) return marker
  const adjustment = psdLayer.adjustment as PsdAdjustmentLayer | undefined
  if (!adjustment) return null

  switch (adjustment.type) {
    case "brightness/contrast":
      return {
        type: "brightness-contrast",
        params: {
          brightness: adjustment.brightness ?? 0,
          contrast: adjustment.contrast ?? 0,
          useLegacy: !!adjustment.useLegacy,
        },
      }
    case "levels": {
      const pick = adjustment.red ?? adjustment.green ?? adjustment.blue ?? adjustment.rgb
      const channel = adjustment.red ? "red" : adjustment.green ? "green" : adjustment.blue ? "blue" : "rgb"
      if (!pick) return { type: "levels", params: {} }
      return {
        type: "levels",
        params: {
          channel,
          inputBlack: pick.shadowInput ?? 0,
          inputWhite: pick.highlightInput ?? 255,
          gamma: Math.max(0.01, (pick.midtoneInput ?? 100) / 100),
          outputBlack: pick.shadowOutput ?? 0,
          outputWhite: pick.highlightOutput ?? 255,
        },
      }
    }
    case "curves": {
      const pick = adjustment.red ?? adjustment.green ?? adjustment.blue ?? adjustment.rgb
      const channel = adjustment.red ? "red" : adjustment.green ? "green" : adjustment.blue ? "blue" : "rgb"
      const params: Record<string, number | string | boolean> = { channel }
      if (pick && pick.length) {
        const find = (input: number) => pick.find((p) => p.input === input)?.output
        params.shadow = find(0) ?? 0
        params.midtone = find(128) ?? 128
        params.highlight = find(255) ?? 255
      } else {
        params.shadow = 0
        params.midtone = 128
        params.highlight = 255
      }
      return { type: "curves", params }
    }
    case "exposure":
      return { type: "exposure", params: { ev: adjustment.exposure ?? 0 } }
    case "vibrance":
      return {
        type: "vibrance",
        params: {
          amount: adjustment.vibrance ?? 0,
          saturation: adjustment.saturation ?? 0,
        },
      }
    case "hue/saturation": {
      // Pick the first non-master with values, otherwise master.
      const slots: Array<keyof HueSaturationAdjustment> = ["master", "reds", "yellows", "greens", "cyans", "blues", "magentas"]
      let range: keyof HueSaturationAdjustment = "master"
      for (const slot of slots) {
        if (adjustment[slot]) {
          range = slot
          break
        }
      }
      const data = adjustment[range] as HueSaturationAdjustmentChannel | undefined
      return {
        type: "hue-saturation",
        params: {
          range: String(range),
          hue: data?.hue ?? 0,
          saturation: data?.saturation ?? 0,
          lightness: data?.lightness ?? 0,
          colorize: false,
        },
      }
    }
    case "color balance": {
      const tone: "shadows" | "midtones" | "highlights" = adjustment.shadows
        ? "shadows"
        : adjustment.highlights
          ? "highlights"
          : "midtones"
      const data = adjustment[tone]
      return {
        type: "color-balance",
        params: {
          tone,
          cyanRed: data?.cyanRed ?? 0,
          magentaGreen: data?.magentaGreen ?? 0,
          yellowBlue: data?.yellowBlue ?? 0,
          preserveLuminosity: adjustment.preserveLuminosity !== false,
        },
      }
    }
    case "black & white":
      return {
        type: "black-white",
        params: {
          reds: adjustment.reds ?? 0,
          yellows: adjustment.yellows ?? 0,
          greens: adjustment.greens ?? 0,
          cyans: adjustment.cyans ?? 0,
          blues: adjustment.blues ?? 0,
          magentas: adjustment.magentas ?? 0,
          tint: !!adjustment.useTint,
          tintHue: 38,
          tintSaturation: 18,
        },
      }
    case "photo filter":
      return {
        type: "photo-filter",
        params: {
          color: detectPhotoFilterColor(adjustment.color),
          density: adjustment.density ?? 25,
        },
      }
    case "channel mixer":
      return {
        type: "channel-mixer",
        params: {
          rR: adjustment.red?.red ?? 100,
          rG: adjustment.red?.green ?? 0,
          rB: adjustment.red?.blue ?? 0,
          gR: adjustment.green?.red ?? 0,
          gG: adjustment.green?.green ?? 100,
          gB: adjustment.green?.blue ?? 0,
          bR: adjustment.blue?.red ?? 0,
          bG: adjustment.blue?.green ?? 0,
          bB: adjustment.blue?.blue ?? 100,
        },
      }
    case "color lookup": {
      const strengthMatch = (adjustment.name || "").match(/strength:(-?\d+)/)
      return {
        type: "color-lookup",
        params: { strength: strengthMatch ? Number(strengthMatch[1]) : 0 },
      }
    }
    case "invert":
      return { type: "invert", params: {} }
    case "posterize":
      return { type: "posterize", params: { levels: adjustment.levels ?? 4 } }
    case "threshold":
      return { type: "threshold", params: { level: adjustment.level ?? 128 } }
    case "gradient map":
      return {
        type: "gradient-map",
        params: {
          reverse: !!adjustment.reverse,
          dither: adjustment.dither !== false,
        },
      }
    case "selective color":
      return {
        type: "selective-color",
        params: {
          cyans: adjustment.cyans?.c ?? 0,
          magentas: adjustment.magentas?.m ?? 0,
          yellows: adjustment.yellows?.y ?? 0,
          whites: adjustment.whites?.k ?? 0,
          neutrals: adjustment.neutrals?.k ?? 0,
          blacks: adjustment.blacks?.k ?? 0,
        },
      }
    default:
      return null
  }
}

function hsvToRgb(h: number, s: number, v: number): PsdColor {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function photoFilterColor(key: string): PsdColor {
  const map: Record<string, PsdColor> = {
    warm: { r: 234, g: 159, b: 64 },
    blue: { r: 64, g: 145, b: 234 },
    green: { r: 80, g: 200, b: 120 },
    magenta: { r: 220, g: 64, b: 200 },
    cyan: { r: 64, g: 220, b: 220 },
    yellow: { r: 240, g: 220, b: 60 },
  }
  return map[key] ?? map.warm
}

function detectPhotoFilterColor(color: PsdColor | undefined): string {
  if (!color || typeof color !== "object") return "warm"
  const c = color as { r?: number; g?: number; b?: number }
  const r = c.r ?? 0
  const g = c.g ?? 0
  const b = c.b ?? 0
  if (r > g && r > b) return r > 200 && g > 200 ? "yellow" : "warm"
  if (b > r && b > g) return b > 200 && g > 200 ? "cyan" : "blue"
  if (g > r && g > b) return "green"
  if (r > 150 && b > 150) return "magenta"
  return "warm"
}

/* -------------------------------------------------------------------------- */
/* Smart filters                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Custom additionalLayerInfo key used to stash our smart-filter stack in
 * the PSD. Photoshop ignores unknown keys, so the data survives a save.
 * Round-trip import reads it back via `psdToAppSmartFilters`.
 */
export const SMART_FILTERS_INFO_KEY = "ps-web/smart-filters"

interface SerializedSmartFilter {
  id: string
  filterId: string
  name: string
  enabled: boolean
  opacity: number
  blendMode: BlendMode
  params: Record<string, number | string | boolean>
  hasMask: boolean
  maskEnabled: boolean
  maskDensity: number
  maskFeather: number
  blurGalleryMesh?: SmartFilter["blurGalleryMesh"]
}

type PsdFilterEffectMasks = NonNullable<PsdLayer["filterEffectsMasks"]>

function numberParam(params: Record<string, number | string | boolean> | undefined, key: string, fallback = 0) {
  const value = Number(params?.[key])
  return Number.isFinite(value) ? value : fallback
}

function baseNativeFilter(filter: SmartFilter): Omit<PsdFilter, "type" | "filter"> {
  return {
    name: filter.name || filter.filterId,
    opacity: clamp01(filter.opacity, 1),
    blendMode: appBlendToPsd(filter.blendMode ?? "normal"),
    enabled: filter.enabled !== false,
    hasOptions: true,
    foregroundColor: { r: 0, g: 0, b: 0 },
    backgroundColor: { r: 255, g: 255, b: 255 },
  } as Omit<PsdFilter, "type" | "filter">
}

function appSmartFilterToNativeFilter(filter: SmartFilter): PsdFilter | null {
  const base = baseNativeFilter(filter)
  const params = filter.params ?? {}
  switch (filter.filterId) {
    case "average":
    case "blur":
    case "blur-more":
      return { ...base, type: filter.filterId.replace(/-/g, " ") } as PsdFilter
    case "invert":
      return { ...base, type: "invert" } as PsdFilter
    case "box-blur":
      return { ...base, type: "box blur", filter: { radius: px(numberParam(params, "radius", 1)) } } as PsdFilter
    case "gaussian-blur":
      return { ...base, type: "gaussian blur", filter: { radius: px(numberParam(params, "radius", 1)) } } as PsdFilter
    case "motion-blur":
      return {
        ...base,
        type: "motion blur",
        filter: {
          angle: numberParam(params, "angle", 0),
          distance: px(numberParam(params, "distance", numberParam(params, "radius", 10))),
        },
      } as PsdFilter
    case "radial-blur":
      return {
        ...base,
        type: "radial blur",
        filter: {
          amount: numberParam(params, "amount", 10),
          method: params.method === "zoom" ? "zoom" : "spin",
          quality: params.quality === "draft" || params.quality === "good" ? params.quality : "best",
        },
      } as PsdFilter
    case "surface-blur":
      return {
        ...base,
        type: "surface blur",
        filter: {
          radius: px(numberParam(params, "radius", 5)),
          threshold: numberParam(params, "threshold", 15),
        },
      } as PsdFilter
    case "smart-blur":
      return {
        ...base,
        type: "smart blur",
        filter: {
          radius: numberParam(params, "radius", 5),
          threshold: numberParam(params, "threshold", 15),
          quality: params.quality === "low" || params.quality === "high" ? params.quality : "medium",
          mode: params.mode === "edge only" || params.mode === "overlay edge" ? params.mode : "normal",
        },
      } as PsdFilter
    case "add-noise":
    case "noise":
      return {
        ...base,
        type: "add noise",
        filter: {
          amount: numberParam(params, "amount", 5),
          distribution: params.distribution === "gaussian" ? "gaussian" : "uniform",
          monochromatic: params.monochromatic === true || params.mono === true,
          randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))),
        },
      } as PsdFilter
    case "median":
      return { ...base, type: "median", filter: { radius: px(numberParam(params, "radius", 1)) } } as PsdFilter
    case "unsharp-mask":
      return {
        ...base,
        type: "unsharp mask",
        filter: {
          amount: numberParam(params, "amount", 50),
          radius: px(numberParam(params, "radius", 1)),
          threshold: numberParam(params, "threshold", 0),
        },
      } as PsdFilter
    case "sharpen":
    case "sharpen-edges":
    case "sharpen-more":
      return { ...base, type: filter.filterId.replace(/-/g, " ") } as PsdFilter
    case "find-edges":
      return { ...base, type: "find edges" } as PsdFilter
    case "solarize":
      return { ...base, type: "solarize" } as PsdFilter
    case "emboss":
      return {
        ...base,
        type: "emboss",
        filter: {
          angle: numberParam(params, "angle", 135),
          height: numberParam(params, "height", 3),
          amount: numberParam(params, "amount", 100),
        },
      } as PsdFilter
    case "twirl":
      return { ...base, type: "twirl", filter: { angle: numberParam(params, "angle", 50) } } as PsdFilter
    case "pinch":
      return { ...base, type: "pinch", filter: { amount: numberParam(params, "amount", 0) } } as PsdFilter
    case "spherize": {
      const sphereMode = params.mode === "horizontal only" || params.mode === "vertical only" ? params.mode : "normal"
      return {
        ...base,
        type: "spherize",
        filter: { amount: numberParam(params, "amount", 100), mode: sphereMode },
      } as PsdFilter
    }
    case "ripple": {
      const rippleSize = params.size === "small" || params.size === "large" ? params.size : "medium"
      return {
        ...base,
        type: "ripple",
        filter: { amount: numberParam(params, "amount", 100), size: rippleSize },
      } as PsdFilter
    }
    case "zigzag": {
      const zigStyle =
        params.style === "out from center" || params.style === "pond ripples" ? params.style : "around center"
      return {
        ...base,
        type: "zigzag",
        filter: {
          amount: numberParam(params, "amount", 10),
          ridges: Math.max(0, Math.round(numberParam(params, "ridges", 5))),
          style: zigStyle,
        },
      } as PsdFilter
    }
    case "polar-coordinates": {
      const conversion =
        params.conversion === "polar to rectangular" ? "polar to rectangular" : "rectangular to polar"
      return { ...base, type: "polar coordinates", filter: { conversion } } as PsdFilter
    }
    case "clouds":
      return {
        ...base,
        type: "clouds",
        filter: { randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))) },
      } as PsdFilter
    case "difference-clouds":
      return {
        ...base,
        type: "difference clouds",
        filter: { randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))) },
      } as PsdFilter
    case "fibers":
      return {
        ...base,
        type: "fibers",
        filter: {
          variance: numberParam(params, "variance", 16),
          strength: numberParam(params, "strength", 4),
          randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))),
        },
      } as PsdFilter
    case "lens-flare": {
      const lensType =
        params.lensType === "32mm prime" || params.lensType === "105mm prime" || params.lensType === "movie prime"
          ? params.lensType
          : "50-300mm zoom"
      return {
        ...base,
        type: "lens flare",
        filter: {
          brightness: numberParam(params, "brightness", 100),
          position: { x: numberParam(params, "x", 0.5), y: numberParam(params, "y", 0.5) },
          lensType,
        },
      } as PsdFilter
    }
    case "high-pass":
      return { ...base, type: "high pass", filter: { radius: px(numberParam(params, "radius", 10)) } } as PsdFilter
    case "maximum":
      return { ...base, type: "maximum", filter: { radius: px(numberParam(params, "radius", 1)) } } as PsdFilter
    case "minimum":
      return { ...base, type: "minimum", filter: { radius: px(numberParam(params, "radius", 1)) } } as PsdFilter
    case "offset": {
      const undefinedAreas =
        params.undefinedAreas === "set to transparent" || params.undefinedAreas === "repeat edge pixels"
          ? params.undefinedAreas
          : "wrap around"
      return {
        ...base,
        type: "offset",
        filter: {
          horizontal: numberParam(params, "horizontal", numberParam(params, "x", 0)),
          vertical: numberParam(params, "vertical", numberParam(params, "y", 0)),
          undefinedAreas,
        },
      } as PsdFilter
    }
    case "color-halftone":
      return {
        ...base,
        type: "color halftone",
        filter: {
          radius: numberParam(params, "radius", 8),
          angle1: numberParam(params, "angle1", 108),
          angle2: numberParam(params, "angle2", 162),
          angle3: numberParam(params, "angle3", 90),
          angle4: numberParam(params, "angle4", 45),
        },
      } as PsdFilter
    case "mezzotint": {
      const mezType =
        typeof params.mezType === "string"
          ? params.mezType
          : typeof params.type === "string"
            ? params.type
            : "medium dots"
      const allowedMez = [
        "fine dots",
        "medium dots",
        "grainy dots",
        "coarse dots",
        "short lines",
        "medium lines",
        "long lines",
        "short strokes",
        "medium strokes",
        "long strokes",
      ] as const
      const resolvedMez = (allowedMez as readonly string[]).includes(mezType) ? (mezType as (typeof allowedMez)[number]) : "medium dots"
      return {
        ...base,
        type: "mezzotint",
        filter: {
          type: resolvedMez,
          randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))),
        },
      } as PsdFilter
    }
    case "dust-scratches":
      return {
        ...base,
        type: "dust and scratches",
        filter: {
          radius: numberParam(params, "radius", 2),
          threshold: numberParam(params, "threshold", 0),
        },
      } as PsdFilter
    case "custom-convolution": {
      const matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0]
      return {
        ...base,
        type: "custom",
        filter: {
          scale: numberParam(params, "scale", 1),
          offset: numberParam(params, "offset", 0),
          matrix,
        },
      } as PsdFilter
    }
    case "wind": {
      const method =
        params.method === "blast" || params.method === "stagger" ? params.method : "wind"
      const direction = params.direction === "right" ? "right" : "left"
      return { ...base, type: "wind", filter: { method, direction } } as PsdFilter
    }
    case "extrude": {
      const extrudeType = params.mode === "pyramid" || params.mode === "pyramids" ? "pyramids" : "blocks"
      return {
        ...base,
        type: "extrude",
        filter: {
          type: extrudeType,
          size: Math.max(1, Math.round(numberParam(params, "size", 30))),
          depth: Math.max(1, Math.round(numberParam(params, "depth", 30))),
          depthMode: params.depthMode === "level-based" ? "level-based" : "random",
          randomSeed: Math.max(0, Math.round(numberParam(params, "randomSeed", 1))),
          solidFrontFaces: params.solidFrontFaces === true,
          maskIncompleteBlocks: params.maskIncompleteBlocks !== false,
        },
      } as PsdFilter
    }
    case "de-interlace": {
      const eliminate = params.eliminate === "even lines" ? "even lines" : "odd lines"
      const newFieldsBy = params.newFieldsBy === "duplication" ? "duplication" : "interpolation"
      return { ...base, type: "de-interlace", filter: { eliminate, newFieldsBy } } as PsdFilter
    }
    case "oil-paint":
      return {
        ...base,
        type: "oil paint",
        filter: {
          lightingOn: params.lightingOn !== false,
          stylization: numberParam(params, "stylization", 5),
          cleanliness: numberParam(params, "cleanliness", 5),
          brushScale: numberParam(params, "brushScale", 0.8),
          microBrush: numberParam(params, "microBrush", 0.5),
          lightDirection: numberParam(params, "lightDirection", 90),
          specularity: numberParam(params, "specularity", 0),
        },
      } as PsdFilter
    case "brightness-contrast":
      return {
        ...base,
        type: "brightness/contrast",
        filter: {
          brightness: numberParam(params, "brightness", 0),
          contrast: numberParam(params, "contrast", 0),
          useLegacy: params.useLegacy === true,
        },
      } as PsdFilter
    default:
      return null
  }
}

function nativeFilterToAppFilter(entry: PsdFilter, fallback?: SerializedSmartFilter): SmartFilter {
  const type = String(entry.type)
  const id = fallback?.id ?? `sf_${type.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`
  let filterId = type.replace(/\s+/g, "-")
  const params: Record<string, number | string | boolean> = {}
  const raw = entry as PsdFilter & { filter?: Record<string, unknown> }
  const filter = raw.filter ?? {}
  const unit = (value: unknown, fallbackValue = 0) =>
    typeof value === "object" && value && "value" in value
      ? Number((value as { value?: unknown }).value) || fallbackValue
      : Number(value) || fallbackValue

  switch (type) {
    case "box blur":
    case "gaussian blur":
    case "median":
      params.radius = unit(filter.radius, fallback?.params.radius as number | undefined)
      break
    case "motion blur":
      params.angle = Number(filter.angle) || 0
      params.distance = unit(filter.distance, fallback?.params.distance as number | undefined)
      break
    case "radial blur":
      params.amount = Number(filter.amount) || 0
      params.method = String(filter.method ?? "spin")
      params.quality = String(filter.quality ?? "best")
      break
    case "surface blur":
      params.radius = unit(filter.radius, fallback?.params.radius as number | undefined)
      params.threshold = Number(filter.threshold) || 0
      break
    case "smart blur":
      params.radius = Number(filter.radius) || 0
      params.threshold = Number(filter.threshold) || 0
      params.quality = String(filter.quality ?? "medium")
      params.mode = String(filter.mode ?? "normal")
      break
    case "add noise":
      params.amount = Number(filter.amount) || 0
      params.distribution = String(filter.distribution ?? "uniform")
      params.monochromatic = filter.monochromatic === true
      filterId = "noise"
      break
    case "unsharp mask":
      params.amount = Number(filter.amount) || 0
      params.radius = unit(filter.radius, fallback?.params.radius as number | undefined)
      params.threshold = Number(filter.threshold) || 0
      break
    case "blur more":
      filterId = "blur-more"
      break
    case "sharpen":
    case "sharpen edges":
    case "sharpen more":
      params.amount = Number(filter.amount) || (fallback?.params.amount as number | undefined) || 50
      break
    case "find edges":
    case "solarize":
      break
    case "emboss":
      params.angle = Number(filter.angle) || 0
      params.height = Number(filter.height) || 0
      params.amount = Number(filter.amount) || 0
      break
    case "twirl":
      params.angle = Number(filter.angle) || 0
      break
    case "pinch":
      params.amount = Number(filter.amount) || 0
      break
    case "spherize":
      params.amount = Number(filter.amount) || 0
      params.mode = String(filter.mode ?? "normal")
      break
    case "ripple":
      params.amount = Number(filter.amount) || 0
      params.size = String(filter.size ?? "medium")
      break
    case "zigzag":
      params.amount = Number(filter.amount) || 0
      params.ridges = Number(filter.ridges) || 0
      params.style = String(filter.style ?? "around center")
      break
    case "polar coordinates":
      params.conversion = String(filter.conversion ?? "rectangular to polar")
      break
    case "clouds":
    case "difference clouds":
      params.randomSeed = Number(filter.randomSeed) || 0
      break
    case "fibers":
      params.variance = Number(filter.variance) || 0
      params.strength = Number(filter.strength) || 0
      params.randomSeed = Number(filter.randomSeed) || 0
      break
    case "lens flare":
      params.brightness = Number(filter.brightness) || 0
      if (typeof filter.position === "object" && filter.position) {
        const pos = filter.position as { x?: number; y?: number }
        params.x = Number(pos.x) || 0
        params.y = Number(pos.y) || 0
      }
      params.lensType = String(filter.lensType ?? "50-300mm zoom")
      break
    case "high pass":
    case "maximum":
    case "minimum":
      params.radius = unit(filter.radius, fallback?.params.radius as number | undefined)
      break
    case "offset":
      params.horizontal = Number(filter.horizontal) || 0
      params.vertical = Number(filter.vertical) || 0
      params.undefinedAreas = String(filter.undefinedAreas ?? "wrap around")
      break
    case "color halftone":
      params.radius = Number(filter.radius) || 0
      params.angle1 = Number(filter.angle1) || 0
      params.angle2 = Number(filter.angle2) || 0
      params.angle3 = Number(filter.angle3) || 0
      params.angle4 = Number(filter.angle4) || 0
      break
    case "mezzotint":
      params.mezType = String(filter.type ?? "medium dots")
      params.randomSeed = Number(filter.randomSeed) || 0
      break
    case "dust and scratches":
      params.radius = Number(filter.radius) || 0
      params.threshold = Number(filter.threshold) || 0
      filterId = "dust-scratches"
      break
    case "custom":
      params.scale = Number(filter.scale) || 1
      params.offset = Number(filter.offset) || 0
      filterId = "custom-convolution"
      break
    case "wind":
      params.method = String(filter.method ?? "wind")
      params.direction = String(filter.direction ?? "left")
      break
    case "extrude":
      params.mode = String(filter.type ?? "blocks")
      params.size = Number(filter.size) || 0
      params.depth = Number(filter.depth) || 0
      params.depthMode = String(filter.depthMode ?? "random")
      params.randomSeed = Number(filter.randomSeed) || 0
      params.solidFrontFaces = filter.solidFrontFaces === true
      params.maskIncompleteBlocks = filter.maskIncompleteBlocks !== false
      break
    case "de-interlace":
      params.eliminate = String(filter.eliminate ?? "odd lines")
      params.newFieldsBy = String(filter.newFieldsBy ?? "interpolation")
      break
    case "oil paint":
      params.lightingOn = filter.lightingOn !== false
      params.stylization = Number(filter.stylization) || 0
      params.cleanliness = Number(filter.cleanliness) || 0
      params.brushScale = Number(filter.brushScale) || 0
      params.microBrush = Number(filter.microBrush) || 0
      params.lightDirection = Number(filter.lightDirection) || 0
      params.specularity = Number(filter.specularity) || 0
      break
    case "brightness/contrast":
      params.brightness = Number(filter.brightness) || 0
      params.contrast = Number(filter.contrast) || 0
      params.useLegacy = filter.useLegacy === true
      filterId = "brightness-contrast"
      break
    default:
      break
  }

  return {
    id,
    filterId,
    name: entry.name || fallback?.name || filterId,
    enabled: entry.enabled !== false,
    opacity: clamp01(entry.opacity, fallback?.opacity ?? 1),
    blendMode: psdBlendToApp(entry.blendMode),
    params: Object.keys(params).length ? params : fallback?.params ?? {},
    mask: null,
    maskEnabled: fallback?.maskEnabled ?? true,
    maskDensity: clamp01(fallback?.maskDensity, 1),
    maskFeather: Math.max(0, Math.min(250, Number.isFinite(fallback?.maskFeather ?? 0) ? fallback?.maskFeather ?? 0 : 0)),
    blurGalleryMesh: fallback?.blurGalleryMesh,
  }
}

function smartFilterMaskToBytes(mask: HTMLCanvasElement | null | undefined) {
  if (!mask?.width || !mask?.height || typeof mask.getContext !== "function") return null
  const width = Math.max(1, Math.round(mask.width))
  const height = Math.max(1, Math.round(mask.height))
  try {
    const data = mask.getContext("2d")?.getImageData(0, 0, width, height).data
    if (!data) return null
    const gray = new Uint8Array(width * height)
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const alpha = data[p + 3] ?? 255
      gray[i] = Math.round((((data[p] ?? 0) + (data[p + 1] ?? 0) + (data[p + 2] ?? 0)) / 3) * (alpha / 255))
    }
    return { width, height, data: gray }
  } catch {
    return null
  }
}

function bytesToSmartFilterMask(width: number, height: number, data: Uint8Array): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (typeof document !== "undefined" && typeof ImageData !== "undefined") {
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const v = data[i] ?? 255
      rgba[p] = v
      rgba[p + 1] = v
      rgba[p + 2] = v
      rgba[p + 3] = 255
    }
    canvas.getContext("2d")?.putImageData(new ImageData(rgba, w, h), 0, 0)
    return canvas
  }
  return {
    width: w,
    height: h,
    getContext: () => ({
      getImageData: () => ({ width: w, height: h, data }),
      putImageData: () => {},
    }),
  } as unknown as HTMLCanvasElement
}

function appSmartFilterMasksToPsd(filters: SmartFilter[]): PsdFilterEffectMasks | undefined {
  const masks: PsdFilterEffectMasks = []
  for (const filter of filters) {
    const mask = smartFilterMaskToBytes(filter.mask)
    if (!mask) continue
    const channel = { compressionMode: 0, data: mask.data }
    masks.push({
      id: filter.id.slice(0, 255),
      top: 0,
      left: 0,
      bottom: mask.height,
      right: mask.width,
      depth: 8,
      channels: [channel, undefined],
      extra: {
        top: 0,
        left: 0,
        bottom: mask.height,
        right: mask.width,
        compressionMode: 0,
        data: mask.data,
      },
    })
  }
  return masks.length ? masks : undefined
}

function psdFilterMasksToCanvases(masks: PsdFilterEffectMasks | undefined): Array<HTMLCanvasElement | null> {
  return (masks ?? []).map((mask) => {
    const data = mask.extra?.data ?? mask.channels.find((channel) => channel?.data)?.data
    if (!data) return null
    return bytesToSmartFilterMask(Math.max(1, mask.right - mask.left), Math.max(1, mask.bottom - mask.top), data)
  })
}

function serializeSmartFilter(filter: SmartFilter): SerializedSmartFilter {
  const blurGalleryMesh = filter.blurGalleryMesh ??
    (isBlurGalleryFilterId(filter.filterId) ? createBlurGalleryMeshResource(filter.filterId, filter.params ?? {}) : undefined)
  return {
    id: filter.id,
    filterId: filter.filterId,
    name: filter.name,
    enabled: filter.enabled,
    opacity: clamp01(filter.opacity, 1),
    blendMode: filter.blendMode ?? "normal",
    params: filter.params ?? {},
    hasMask: !!filter.mask,
    maskEnabled: filter.maskEnabled !== false,
    maskDensity: clamp01(filter.maskDensity, 1),
    maskFeather: Math.max(0, Math.min(250, Number.isFinite(filter.maskFeather ?? 0) ? filter.maskFeather ?? 0 : 0)),
    ...(blurGalleryMesh ? { blurGalleryMesh } : {}),
  }
}

/**
 * Apply smart filters into a rasterized canvas AND return the serialized
 * metadata that should be stashed in the PSD's `additionalLayerInfo`.
 *
 * The integrator should:
 *  1. Apply the returned canvas as the layer's pixel data.
 *  2. Attach `additionalInfo` to the resulting PsdLayer's
 *     `additionalLayerInfo` map under the key `SMART_FILTERS_INFO_KEY`.
 *
 * The actual rasterization is delegated to a caller-supplied helper so we
 * stay decoupled from document-io's renderer. If `rasterize` is omitted, the
 * raw layer canvas is returned untouched (callers that don't have access to
 * the filter pipeline can still preserve the metadata).
 *
 * Returns null when the layer has no smart filters.
 */
export function appSmartFiltersToPsd(
  layer: Layer,
  rasterize?: (source: HTMLCanvasElement, filters: SmartFilter[]) => HTMLCanvasElement,
): {
  rastered: HTMLCanvasElement
  additionalInfo: Record<string, unknown>
  nativeFilter?: PlacedLayerFilter
  filterEffectsMasks?: PsdFilterEffectMasks
} | null {
  const filters = layer.smartFilters?.filter((sf) => sf && typeof sf === "object") ?? []
  if (!filters.length) return null

  const rastered = rasterize ? rasterize(layer.canvas, filters) : layer.canvas
  const serialized = filters.map(serializeSmartFilter)
  const nativeList = filters.map(appSmartFilterToNativeFilter).filter((filter): filter is PsdFilter => !!filter)
  const filterEffectsMasks = appSmartFilterMasksToPsd(filters)
  return {
    rastered,
    nativeFilter: nativeList.length
      ? {
          enabled: true,
          validAtPosition: true,
          maskEnabled: filters.some((filter) => filter.maskEnabled !== false && !!filter.mask),
          maskLinked: false,
          maskExtendWithWhite: true,
          list: nativeList,
        }
      : undefined,
    filterEffectsMasks,
    additionalInfo: {
      [SMART_FILTERS_INFO_KEY]: {
        version: 1,
        filters: serialized,
        nativeFilterCount: nativeList.length,
        maskCount: filterEffectsMasks?.length ?? 0,
      },
    },
  }
}

export function appSmartFiltersToNativePsd(
  filters: SmartFilter[] | undefined,
  width = 1,
  height = 1,
): { filter?: PlacedLayerFilter; filterEffectsMasks?: PsdFilterEffectMasks } {
  const layer = {
    id: "smart-filter-native",
    name: "Smart Filters",
    kind: "smart-object",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: { width, height, getContext: () => null } as unknown as HTMLCanvasElement,
    smartFilters: filters,
  } as Layer
  const out = appSmartFiltersToPsd(layer)
  return {
    filter: out?.nativeFilter,
    filterEffectsMasks: out?.filterEffectsMasks,
  }
}

export function psdNativeSmartFiltersToApp(psdLayer: PsdLayer): SmartFilter[] | undefined {
  return psdToAppSmartFilters(psdLayer)
}

/**
 * Read our custom additionalLayerInfo block and reconstruct the SmartFilter
 * stack. Returns undefined if no metadata is present.
 *
 * NOTE: smart-filter mask canvases are not preserved through ag-psd's
 * additionalLayerInfo path. The returned filters have `mask: null` and
 * `maskEnabled` set from the serialized flag; callers that need editable
 * masks must reallocate them.
 */
export function psdToAppSmartFilters(psdLayer: PsdLayer): SmartFilter[] | undefined {
  // ag-psd exposes vendor additional layer info under a Map-like field; in
  // some builds it's a plain Record. Be defensive.
  const raw = (psdLayer as unknown as { additionalLayerInfo?: Record<string, unknown> }).additionalLayerInfo
  const payload = raw ? (raw[SMART_FILTERS_INFO_KEY] as { filters?: SerializedSmartFilter[] } | undefined) : undefined
  const fallbacks = Array.isArray(payload?.filters) ? payload.filters : []
  const nativeFilter = (psdLayer as PsdLayer & { placedLayer?: { filter?: PlacedLayerFilter } }).placedLayer?.filter
  const maskCanvases = psdFilterMasksToCanvases((psdLayer as PsdLayer).filterEffectsMasks)

  if (nativeFilter?.list?.length) {
    return nativeFilter.list.map((entry, index) => {
      const out = nativeFilterToAppFilter(entry, fallbacks[index])
      out.mask = maskCanvases[index] ?? null
      out.maskEnabled = nativeFilter.maskEnabled && out.maskEnabled !== false
      return out
    })
  }

  if (!payload || !Array.isArray(payload.filters)) return undefined
  return payload.filters.map((entry, index) => ({
    id: String(entry.id ?? `sf_${Math.random().toString(36).slice(2, 8)}`),
    filterId: String(entry.filterId ?? ""),
    name: String(entry.name ?? entry.filterId ?? ""),
    enabled: entry.enabled !== false,
    opacity: clamp01(entry.opacity, 1),
    blendMode: APP_BLEND_MODES.has(entry.blendMode) ? entry.blendMode : "normal",
    params: entry.params ?? {},
    mask: maskCanvases[index] ?? null,
    maskEnabled: entry.maskEnabled !== false,
    maskDensity: clamp01(entry.maskDensity, 1),
    maskFeather: Math.max(0, Math.min(250, Number.isFinite(entry.maskFeather ?? 0) ? entry.maskFeather ?? 0 : 0)),
    blurGalleryMesh: entry.blurGalleryMesh,
  }))
}

/* -------------------------------------------------------------------------- */
/* Advanced blending                                                           */
/* -------------------------------------------------------------------------- */

function clampBlendIfRange(range: BlendIfRange | undefined): BlendIfRange {
  return {
    black: clampByte(range?.black, 0),
    blackFeather: clampByte(range?.blackFeather, 0),
    whiteFeather: clampByte(range?.whiteFeather, 255),
    white: clampByte(range?.white, 255),
  }
}

/**
 * Translate the app's `AdvancedBlending` record into PSD layer fields. PSD
 * encodes blend-if ranges as `compositeGrayBlendSource` (this layer) and
 * `compositeGraphBlendDestinationRange` (underlying) on the
 * `blendingRanges` info block. Per-channel R/G/B ranges live in the
 * `ranges` array.
 */
export function appAdvancedBlendingToPsd(layer: Layer): Partial<PsdLayer> {
  const ab = layer.advancedBlending
  if (!ab) return {}
  const thisRange = clampBlendIfRange(ab.blendIfThis)
  const underlyingRange = clampBlendIfRange(ab.blendIfUnderlying)
  const out: Partial<PsdLayer> = {
    fillOpacity: clamp01(ab.fillOpacity, 1),
    knockout: ab.knockout !== "none",
    blendingRanges: {
      compositeGrayBlendSource: [thisRange.black, thisRange.blackFeather, thisRange.whiteFeather, thisRange.white],
      compositeGraphBlendDestinationRange: [
        underlyingRange.black,
        underlyingRange.blackFeather,
        underlyingRange.whiteFeather,
        underlyingRange.white,
      ],
      ranges: [],
    },
  }
  // ag-psd has no direct `channels.r/g/b` slot, but encodes channel-protection
  // via the `channelBlendingRestrictions` array (channel indices that are
  // restricted). 0=R, 1=G, 2=B in RGB color mode.
  const restrictions: number[] = []
  if (ab.channels) {
    if (!ab.channels.r) restrictions.push(0)
    if (!ab.channels.g) restrictions.push(1)
    if (!ab.channels.b) restrictions.push(2)
  }
  if (restrictions.length) out.channelBlendingRestrictions = restrictions
  return out
}

export function psdToAppAdvancedBlending(psdLayer: PsdLayer): AdvancedBlending | undefined {
  const hasFill = typeof psdLayer.fillOpacity === "number"
  const ranges = psdLayer.blendingRanges
  const knockoutAny = !!psdLayer.knockout
  if (!hasFill && !ranges && !knockoutAny && !psdLayer.channelBlendingRestrictions) return undefined

  const decode = (arr: number[] | undefined, fallback: BlendIfRange): BlendIfRange => {
    if (!Array.isArray(arr) || arr.length < 4) return fallback
    return {
      black: clampByte(arr[0], fallback.black),
      blackFeather: clampByte(arr[1], fallback.blackFeather),
      whiteFeather: clampByte(arr[2], fallback.whiteFeather),
      white: clampByte(arr[3], fallback.white),
    }
  }

  const defaultRange: BlendIfRange = { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 }
  const channels = { r: true, g: true, b: true }
  for (const idx of psdLayer.channelBlendingRestrictions ?? []) {
    if (idx === 0) channels.r = false
    else if (idx === 1) channels.g = false
    else if (idx === 2) channels.b = false
  }

  return {
    fillOpacity: clamp01(psdLayer.fillOpacity, 1),
    knockout: knockoutAny ? "shallow" : "none",
    channels,
    blendIfThis: decode(ranges?.compositeGrayBlendSource, defaultRange),
    blendIfUnderlying: decode(ranges?.compositeGraphBlendDestinationRange, defaultRange),
  }
}
