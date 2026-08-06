import { FILTERS } from "@/editor/filters"
import type { AdjustmentType, Layer } from "@/editor/types"

export const ADJUSTMENT_LAYER_TYPES: readonly AdjustmentType[] = [
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
]

const ADJUSTMENT_TYPE_SET = new Set<string>(ADJUSTMENT_LAYER_TYPES)
const IDENTITY_AT_DEFAULT_TYPES = new Set<AdjustmentType>([
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "channel-mixer",
  "color-lookup",
  "selective-color",
  "shadows-highlights",
  "match-color",
  "replace-color",
])

export function isAdjustmentType(value: string): value is AdjustmentType {
  return ADJUSTMENT_TYPE_SET.has(value)
}

export function defaultAdjustmentParams(filterId: AdjustmentType) {
  const filter = FILTERS[filterId]
  const params: Record<string, number | string | boolean> = {}
  for (const param of filter?.params ?? []) params[param.key] = param.default
  return params
}

export function adjustmentParamsWithDefaults(
  filterId: AdjustmentType,
  params: Record<string, number | string | boolean>,
) {
  const filter = FILTERS[filterId]
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter?.params ?? []) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      out[param.key] = Math.max(param.min, Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default))
    } else if (param.type === "checkbox") {
      out[param.key] = raw === true
    } else if (param.type === "select") {
      out[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    } else {
      out[param.key] = typeof raw === "string" ? raw : param.default
    }
  }
  return out
}

export function isAdjustmentNoop(adjustment: Layer["adjustment"]) {
  if (!adjustment) return true
  if (!IDENTITY_AT_DEFAULT_TYPES.has(adjustment.type)) return false
  const filter = FILTERS[adjustment.type]
  if (!filter) return true
  const params = adjustmentParamsWithDefaults(adjustment.type, adjustment.params)
  for (const param of filter.params) {
    if (params[param.key] !== param.default) return false
  }
  return true
}

export function nextAdjustmentLayerName(filterId: AdjustmentType, layers: readonly Layer[]) {
  const base = FILTERS[filterId]?.name ?? filterId
  const pattern = new RegExp(`^${escapeRegExp(base)}(?: (\\d+))?$`)
  let max = 0
  for (const layer of layers) {
    if (layer.kind !== "adjustment") continue
    const match = layer.name.match(pattern)
    if (!match) continue
    max = Math.max(max, match[1] ? Number(match[1]) || 0 : 1)
  }
  return `${base} ${max + 1}`
}

/**
 * Where a new adjustment layer belongs: directly above the active layer, above any
 * adjustments already stacked on it, and inside the active layer's group. A selected
 * group takes the adjustment at the top of its own children.
 */
export function adjustmentInsertIndex(layers: readonly Layer[], activeLayerId: string | undefined) {
  const idx = layers.findIndex((layer) => layer.id === activeLayerId)
  if (idx < 0) return { index: layers.length, parentId: undefined as string | undefined }
  const active = layers[idx]
  if (active.kind === "group") return { index: idx, parentId: active.id }
  let index = idx + 1
  while (
    index < layers.length &&
    layers[index].kind === "adjustment" &&
    layers[index].parentId === active.parentId
  ) {
    index += 1
  }
  return { index, parentId: active.parentId }
}

export function createAdjustmentLayer({
  filterId,
  width,
  height,
  layers,
  makeCanvas,
  clipped = false,
  withMask = true,
}: {
  filterId: AdjustmentType
  width: number
  height: number
  layers: readonly Layer[]
  makeCanvas: (width: number, height: number, fill?: string) => HTMLCanvasElement
  clipped?: boolean
  withMask?: boolean
}): Layer {
  return {
    id: `adj_${Math.random().toString(36).slice(2, 9)}`,
    name: nextAdjustmentLayerName(filterId, layers),
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    clipped,
    canvas: makeCanvas(width, height),
    mask: withMask ? makeCanvas(width, height, "#ffffff") : null,
    adjustment: { type: filterId, params: defaultAdjustmentParams(filterId) },
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
