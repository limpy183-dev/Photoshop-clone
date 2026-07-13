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
  Filter as PsdFilter,
  Layer as PsdLayer,
  LayerEffectSatin as _LayerEffectSatin,
  PlacedLayerFilter,
} from "ag-psd"

import type { AdjustmentType, AdvancedBlending, BlendIfRange, BlendMode, Layer, SmartFilter } from "./types"
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
    "shadows-highlights": "round-trip",
    "hdr-toning": "round-trip",
    desaturate: "round-trip",
    "match-color": "round-trip",
    "replace-color": "round-trip",
    equalize: "round-trip",
  },
  smartFilters: "metadata-preserved",
  advancedBlending: "round-trip",
}

/* -------------------------------------------------------------------------- */
/* Color/blend-mode helpers                                                    */
/* -------------------------------------------------------------------------- */

import {
  APP_BLEND_MODES,
  appBlendToPsd,
  clamp01,
  clampByte,
  psdBlendToApp,
  px,
} from "./psd-effects-adjustments-shared"

export { appAdjustmentToPsdLayer, psdLayerToAppAdjustment } from "./psd-effects-adjustments-adjustment-layers"
export { layerStyleToPsdEffects, psdEffectsToLayerStyle } from "./psd-effects-adjustments-layer-styles"

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
  maskLinked: boolean
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
    maskLinked: fallback?.maskLinked ?? true,
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
    maskLinked: filter.maskLinked !== false,
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
          maskLinked: filters.every((filter) => filter.maskLinked !== false),
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
      if (nativeFilter.maskLinked === false) out.maskLinked = false
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
    maskLinked: entry.maskLinked !== false,
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
const PSD_BLENDIF_CHANNEL_INDEX = { r: 0, g: 1, b: 2 } as const

function blendIfRangeToTuple(range: BlendIfRange): [number, number, number, number] {
  return [range.black, range.blackFeather, range.whiteFeather, range.white]
}

function isDefaultBlendIfTuple(range: BlendIfRange): boolean {
  return range.black === 0 && range.blackFeather === 0 && range.whiteFeather === 255 && range.white === 255
}

export function appAdvancedBlendingToPsd(layer: Layer): Partial<PsdLayer> {
  const ab = layer.advancedBlending
  if (!ab) return {}
  const thisRange = clampBlendIfRange(ab.blendIfThis)
  const underlyingRange = clampBlendIfRange(ab.blendIfUnderlying)
  const out: Partial<PsdLayer> = {
    fillOpacity: clamp01(ab.fillOpacity, 1),
    knockout: ab.knockout !== "none",
    blendingRanges: {
      compositeGrayBlendSource: blendIfRangeToTuple(thisRange),
      compositeGraphBlendDestinationRange: blendIfRangeToTuple(underlyingRange),
      ranges: [],
    },
  }
  // Per-channel blend-if ranges share the same on-disk layout. ag-psd's
  // `ranges` array is an interleaved [sourceRange, destRange] list ordered by
  // channel index (R, G, B). Only emit entries for channels that diverge from
  // the default so files stay clean for layers that don't customise them.
  const ranges = out.blendingRanges?.ranges as Array<{
    sourceRange: [number, number, number, number]
    destRange: [number, number, number, number]
  }> | undefined
  if (ranges) {
    for (const channel of ["r", "g", "b"] as const) {
      const src = ab.blendIfThisChannels?.[channel]
      const dest = ab.blendIfUnderlyingChannels?.[channel]
      if (!src && !dest) continue
      const sourceRange = blendIfRangeToTuple(clampBlendIfRange(src))
      const destRange = blendIfRangeToTuple(clampBlendIfRange(dest))
      // Pad earlier channels with defaults if we skipped them
      while (ranges.length < PSD_BLENDIF_CHANNEL_INDEX[channel]) {
        ranges.push({
          sourceRange: [0, 0, 255, 255],
          destRange: [0, 0, 255, 255],
        })
      }
      ranges.push({ sourceRange, destRange })
    }
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

  // PSD stores per-channel ranges in `blendingRanges.ranges` as an ordered
  // array (R, G, B). Decode any that diverge from defaults.
  const blendIfThisChannels: AdvancedBlending["blendIfThisChannels"] = {}
  const blendIfUnderlyingChannels: AdvancedBlending["blendIfUnderlyingChannels"] = {}
  const rangeList = Array.isArray(ranges?.ranges) ? ranges!.ranges : []
  const channelOrder: Array<"r" | "g" | "b"> = ["r", "g", "b"]
  for (let i = 0; i < rangeList.length && i < channelOrder.length; i++) {
    const entry = rangeList[i] as
      | { sourceRange?: number[]; destRange?: number[] }
      | undefined
    if (!entry) continue
    const src = decode(entry.sourceRange, defaultRange)
    const dest = decode(entry.destRange, defaultRange)
    const channel = channelOrder[i]
    if (!isDefaultBlendIfTuple(src)) blendIfThisChannels[channel] = src
    if (!isDefaultBlendIfTuple(dest)) blendIfUnderlyingChannels[channel] = dest
  }

  return {
    fillOpacity: clamp01(psdLayer.fillOpacity, 1),
    knockout: knockoutAny ? "shallow" : "none",
    channels,
    blendIfThis: decode(ranges?.compositeGrayBlendSource, defaultRange),
    blendIfUnderlying: decode(ranges?.compositeGraphBlendDestinationRange, defaultRange),
    blendIfThisChannels: Object.keys(blendIfThisChannels).length ? blendIfThisChannels : undefined,
    blendIfUnderlyingChannels: Object.keys(blendIfUnderlyingChannels).length ? blendIfUnderlyingChannels : undefined,
  }
}
