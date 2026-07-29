import { normalizeAdvancedBlending } from "./layer-workflows"
import type { Layer, PathProps } from "./types"

const canvasIdMap = new WeakMap<HTMLCanvasElement, number>()
let nextCanvasId = 1

export function canvasIdFor(canvas: HTMLCanvasElement): number {
  const cached = canvasIdMap.get(canvas)
  if (cached !== undefined) return cached
  const id = nextCanvasId++
  canvasIdMap.set(canvas, id)
  return id
}

const adjustmentParamsFingerprintCache = new WeakMap<object, string>()
export function adjustmentParamsFingerprint(params: unknown): string {
  if (params == null || typeof params !== "object") return String(params ?? "")
  const cached = adjustmentParamsFingerprintCache.get(params as object)
  if (cached !== undefined) return cached
  const fp = JSON.stringify(params)
  adjustmentParamsFingerprintCache.set(params as object, fp)
  return fp
}

// Path and advanced-blending fingerprints are recomputed for every layer on
// every composite. `JSON.stringify` over a vector path (which can carry
// hundreds of points, each with two control points) was one of the largest
// per-frame main-thread costs during pointer interaction. Paths and blending
// descriptors are replaced immutably by the reducer, exactly like the
// adjustment params and layer styles already cached below, so keying the
// fingerprint on object identity is safe and keeps the returned string
// byte-for-byte identical.
const pathFingerprintCache = new WeakMap<PathProps, string>()
export function pathFingerprint(path: PathProps | null | undefined): string {
  if (!path) return ""
  const cached = pathFingerprintCache.get(path)
  if (cached !== undefined) return cached
  const fp = JSON.stringify(path)
  pathFingerprintCache.set(path, fp)
  return fp
}

type AdvancedBlending = NonNullable<Layer["advancedBlending"]>
const advancedBlendingFingerprintCache = new WeakMap<AdvancedBlending, string>()
export function advancedBlendingFingerprint(advanced: Layer["advancedBlending"]): string {
  if (!advanced) return ""
  const cached = advancedBlendingFingerprintCache.get(advanced)
  if (cached !== undefined) return cached
  const fp = JSON.stringify(normalizeAdvancedBlending(advanced))
  advancedBlendingFingerprintCache.set(advanced, fp)
  return fp
}

export function offsetPath(path: PathProps | null | undefined, dx: number, dy: number): PathProps | null | undefined {
  if (!path) return path
  return {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
      cp1: point.cp1 ? { x: point.cp1.x + dx, y: point.cp1.y + dy } : undefined,
      cp2: point.cp2 ? { x: point.cp2.x + dx, y: point.cp2.y + dy } : undefined,
    })),
    subpaths: path.subpaths?.map((subpath) => offsetPath(subpath, dx, dy) as PathProps),
  }
}

export let maskAlphaEpoch = 0

export function invalidateMaskAlphaCache() {
  maskAlphaEpoch++
}

type SmartFilters = NonNullable<Layer["smartFilters"]>

// Smart-filter keys stringify every enabled filter's params on every
// composite. The filter list is replaced immutably when it changes, so the key
// only needs recomputing when the list identity changes or a mask's alpha is
// invalidated - the epoch is part of the cache key so mask edits still bust it,
// preserving the previous invalidation semantics exactly.
const smartFilterCacheKeyCache = new WeakMap<SmartFilters, { epoch: number; key: string }>()

export function smartFilterCacheKey(smartFilters: SmartFilters): string {
  const cached = smartFilterCacheKeyCache.get(smartFilters)
  if (cached !== undefined && cached.epoch === maskAlphaEpoch) return cached.key
  const key = smartFilters
    .filter((sf) => sf.enabled)
    .map((sf) => {
      const maskId = sf.mask ? canvasIdFor(sf.mask) : ""
      const maskEpoch = sf.mask ? maskAlphaEpoch : 0
      return `${sf.id}:${sf.filterId}:${JSON.stringify(sf.params)}:${sf.opacity ?? 1}:${sf.blendMode ?? "normal"}:${sf.maskEnabled === false ? 0 : 1}:${maskId}:${sf.maskDensity ?? 1}:${sf.maskFeather ?? 0}:${maskEpoch}`
    })
    .join("|")
  smartFilterCacheKeyCache.set(smartFilters, { epoch: maskAlphaEpoch, key })
  return key
}

function styleEffectFp(prefix: string, effect: Record<string, unknown> | undefined): string {
  if (!effect || effect.enabled !== true) return ""
  let out = prefix
  for (const key of Object.keys(effect).sort()) {
    if (key === "enabled") continue
    const value = effect[key]
    if (value == null) continue
    if (typeof value === "object") out += `${key}=${JSON.stringify(value)};`
    else out += `${key}=${value};`
  }
  return out + "|"
}

const layerStyleKeyCache = new WeakMap<NonNullable<Layer["style"]>, string>()

export function layerStyleCacheKey(style: NonNullable<Layer["style"]>): string {
  const cached = layerStyleKeyCache.get(style)
  if (cached !== undefined) return cached
  const fp =
    styleEffectFp("st:", style.stroke as Record<string, unknown> | undefined) +
    styleEffectFp("og:", style.outerGlow as Record<string, unknown> | undefined) +
    styleEffectFp("ig:", style.innerGlow as Record<string, unknown> | undefined) +
    styleEffectFp("is:", style.innerShadow as Record<string, unknown> | undefined) +
    styleEffectFp("bv:", style.bevel as Record<string, unknown> | undefined) +
    styleEffectFp("sa:", style.satin as Record<string, unknown> | undefined) +
    styleEffectFp("co:", style.colorOverlay as Record<string, unknown> | undefined) +
    styleEffectFp("go:", style.gradientOverlay as Record<string, unknown> | undefined) +
    styleEffectFp("po:", style.patternOverlay as Record<string, unknown> | undefined) +
    styleEffectFp("ds:", style.dropShadow as Record<string, unknown> | undefined)
  layerStyleKeyCache.set(style, fp)
  return fp
}
