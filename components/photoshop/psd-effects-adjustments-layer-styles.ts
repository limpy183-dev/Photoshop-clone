"use client"

/**
 * Layer style (layer effects) conversion between the app's `LayerStyle`
 * model and ag-psd's `LayerEffectsInfo`. Extracted verbatim from
 * psd-effects-adjustments.ts.
 */

import type {
  BevelDirection,
  BevelStyle,
  BlendMode as PsdBlendMode,
  EffectSolidGradient,
  GlowSource,
  LayerEffectsInfo,
  LayerEffectBevel,
  LayerEffectShadow,
  LayerEffectsOuterGlow,
  LayerEffectInnerGlow,
  LayerEffectStroke,
  LayerEffectSatin as _LayerEffectSatin,
  LayerEffectGradientOverlay,
  LayerEffectPatternOverlay,
  LayerEffectSolidFill,
} from "ag-psd"

import type { LayerStyle } from "./types"
import {
  appBlendToPsd,
  appGradientStyleToPsd,
  appGradientToPsd,
  clamp01,
  colorToHex,
  contourFromPreset,
  contourToPreset,
  offsetToAngle,
  offsetToDistance,
  parseHexColor,
  psdBlendToApp,
  psdGradientStyleToApp,
  psdGradientToApp,
  px,
} from "./psd-effects-adjustments-shared"

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
