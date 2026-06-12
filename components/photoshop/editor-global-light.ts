import type { LayerStyle, PsDocument } from "./types"

export type EditorGlobalLight = NonNullable<PsDocument["globalLight"]>

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Fast deep clone for plain objects/arrays. */
function deepClonePlain<T>(obj: T): T {
  if (typeof structuredClone === "function") return structuredClone(obj)
  return JSON.parse(JSON.stringify(obj))
}

export function normalizeGlobalLight(light: EditorGlobalLight): EditorGlobalLight {
  return {
    angle: clamp(Math.round(Number.isFinite(light.angle) ? light.angle : 120), -180, 180),
    altitude: clamp(Math.round(Number.isFinite(light.altitude) ? light.altitude : 30), 0, 90),
  }
}

export function offsetFromGlobalLight(
  effect: { angle?: number; distance?: number; offsetX?: number; offsetY?: number },
  angle: number,
) {
  const distance = effect.distance ?? Math.hypot(effect.offsetX ?? 0, effect.offsetY ?? 0)
  const radians = (angle * Math.PI) / 180
  return {
    angle,
    distance,
    offsetX: -Math.cos(radians) * distance,
    offsetY: Math.sin(radians) * distance,
  }
}

export function applyGlobalLightToStyle(style: LayerStyle | undefined, light: EditorGlobalLight): LayerStyle | undefined {
  if (!style) return style
  let next: LayerStyle | undefined = style
  const editable = () => {
    if (next === style) next = deepClonePlain(style)
    return next!
  }
  if (style.dropShadow && (style.dropShadow.useGlobalLight ?? true)) {
    const target = editable()
    target.dropShadow = {
      ...target.dropShadow!,
      ...offsetFromGlobalLight(target.dropShadow!, light.angle),
    }
  }
  if (style.innerShadow && (style.innerShadow.useGlobalLight ?? true)) {
    const target = editable()
    target.innerShadow = {
      ...target.innerShadow!,
      ...offsetFromGlobalLight(target.innerShadow!, light.angle),
    }
  }
  if (style.bevel && (style.bevel.useGlobalLight ?? true)) {
    const target = editable()
    target.bevel = {
      ...target.bevel!,
      angle: light.angle,
      altitude: light.altitude,
    }
  }
  return next
}
