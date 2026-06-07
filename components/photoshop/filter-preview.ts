import {
  applyFilterAsync,
  applyFilterPreview,
  applyFilterTiled,
  isFilterWorkerSupported,
  planExpensiveFilterTiling,
} from "./filter-worker"
import {
  getBlurGalleryControlState,
  isBlurGalleryFilterId,
  parseFieldBlurPins,
  parsePathBlurPoints,
} from "./blur-gallery-controls"
import type { FilterContext, FilterDef } from "./filters"

type ParamValue = number | string | boolean
type ParamMap = Record<string, ParamValue>

export type FilterPreviewMode = "sync" | "worker" | "tiled-worker" | "tiled-main" | "downsample-sync"

export interface FilterPreviewPlan {
  mode: FilterPreviewMode
  pixelCount: number
  previewScale: number
  tileSize?: number
  reason:
    | "small-preview"
    | "worker-supported-preview"
    | "expensive-filter-large-preview"
    | "unsupported-large-preview"
    | "interactive-blur-gallery-preview"
}

export interface FilterPreviewOptions {
  interactive?: boolean
}

export type FilterPreviewDisplayMode = "after" | "split" | "before"

export interface FilterPreviewDisplayModeOption {
  id: FilterPreviewDisplayMode
  label: string
  description: string
}

export interface FilterPreviewQualityModel {
  executionLabel: string
  detailLabel: string
  pathKind: FilterPreviewMode
  destructive: boolean
  previewScale: number
  tileSize?: number
}

export function getFilterPreviewDisplayModes(): FilterPreviewDisplayModeOption[] {
  return [
    { id: "after", label: "After", description: "Show the filtered result." },
    { id: "split", label: "Split", description: "Compare the original and filtered result side by side." },
    { id: "before", label: "Before", description: "Show the unfiltered source." },
  ]
}

function previewExecutionLabel(mode: FilterPreviewMode) {
  switch (mode) {
    case "worker":
      return "Worker preview"
    case "tiled-worker":
      return "Tiled worker preview"
    case "tiled-main":
      return "Tiled main-thread preview"
    case "downsample-sync":
      return "Downsampled preview"
    default:
      return "Main-thread preview"
  }
}

export function buildFilterPreviewQualityModel(
  plan: FilterPreviewPlan,
  options: { debounceMs?: number; selectedLayerCount?: number; smartTarget?: boolean } = {},
): FilterPreviewQualityModel {
  const layerCount = Math.max(1, options.selectedLayerCount ?? 1)
  const queued = `Preview is queued after ${Math.max(0, Math.round(options.debounceMs ?? 0))} ms`
  const target = options.smartTarget
    ? "and will be added as a Smart Filter."
    : `and applies to ${layerCount} layer${layerCount === 1 ? "" : "s"}.`
  const scaleDetail = plan.previewScale < 1 ? ` Downsampled to ${Math.round(plan.previewScale * 100)}% while editing.` : ""
  const tileDetail = plan.tileSize ? ` Tile size ${plan.tileSize}px.` : ""

  return {
    executionLabel: previewExecutionLabel(plan.mode),
    detailLabel: `${queued} ${target}${scaleDetail}${tileDetail}`,
    pathKind: plan.mode,
    destructive: !options.smartTarget,
    previewScale: plan.previewScale,
    tileSize: plan.tileSize,
  }
}

export function planFilterPreviewExecution(
  filterId: string,
  width: number,
  height: number,
  params: ParamMap = {},
  options: FilterPreviewOptions = {},
): FilterPreviewPlan {
  const pixelCount = Math.max(0, Math.round(width)) * Math.max(0, Math.round(height))
  const previewScale = pixelCount >= 4_000_000 ? 0.5 : 1

  if (isInteractiveBlurGalleryPreview(filterId, params, options) && isHeavyBlurGalleryPreview(filterId, width, height, params)) {
    return {
      mode: "downsample-sync",
      pixelCount,
      previewScale: pixelCount >= 4_000_000 ? 0.25 : 0.5,
      reason: "interactive-blur-gallery-preview",
    }
  }

  const tiling = planExpensiveFilterTiling(filterId, width, height, params, { tileSize: 512 })

  if (tiling.strategy === "tiled-worker-preferred") {
    return {
      mode: "tiled-worker",
      pixelCount,
      previewScale,
      tileSize: tiling.tileSize,
      reason: "expensive-filter-large-preview",
    }
  }

  if (tiling.strategy === "tiled-main-thread") {
    return {
      mode: "tiled-main",
      pixelCount,
      previewScale,
      tileSize: tiling.tileSize,
      reason: "unsupported-large-preview",
    }
  }

  if (pixelCount <= 1_000_000) {
    return { mode: "sync", pixelCount, previewScale: 1, reason: "small-preview" }
  }

  if (isFilterWorkerSupported(filterId)) {
    return { mode: "worker", pixelCount, previewScale, reason: "worker-supported-preview" }
  }

  return { mode: "downsample-sync", pixelCount, previewScale, reason: "unsupported-large-preview" }
}

export async function applyPlannedFilterPreview(
  filter: FilterDef,
  src: ImageData,
  params: ParamMap,
  context: FilterContext,
  signal?: AbortSignal,
  options: FilterPreviewOptions = {},
) {
  const plan = planFilterPreviewExecution(filter.id, src.width, src.height, params, options)
  if (signal?.aborted) throw new DOMException("Filter preview cancelled", "AbortError")

  if (Object.keys(context).length > 0) {
    return filter.apply(src, params, context)
  }

  if (plan.mode === "tiled-worker" || plan.mode === "tiled-main") {
    return applyFilterTiled(filter.id, src, params, {
      tileSize: plan.tileSize,
      useWorker: plan.mode === "tiled-worker",
      signal,
    })
  }

  if (plan.mode === "worker") {
    return applyFilterAsync(filter.id, src, params)
  }

  if (plan.mode === "downsample-sync" && plan.previewScale < 1) {
    return applyFilterPreview(filter.id, src, params, plan.previewScale)
  }

  return filter.apply(src, params, context)
}

function isInteractiveBlurGalleryPreview(filterId: string, params: ParamMap, options: FilterPreviewOptions) {
  if (!isBlurGalleryFilterId(filterId)) return false
  return options.interactive === true || getBlurGalleryControlState(params).previewQuality === "interactive"
}

function isHeavyBlurGalleryPreview(filterId: string, width: number, height: number, params: ParamMap) {
  const pixelCount = Math.max(0, Math.round(width)) * Math.max(0, Math.round(height))
  if (pixelCount >= 1_000_000) return true

  if (filterId === "field-blur") {
    const pins = parseFieldBlurPins(String(params.pins ?? ""))
    const maxPinBlur = pins.reduce((max, pin) => Math.max(max, pin.blur), 0)
    return pins.length > 1 || Math.max(Number(params.blur) || 0, maxPinBlur) >= 32
  }

  if (filterId === "iris-blur" || filterId === "tilt-shift") {
    return (Number(params.blur) || 0) >= 32
  }

  if (filterId === "path-blur") {
    return parsePathBlurPoints(String(params.path ?? "")).length > 2 || (Number(params.distance) || 0) >= 48
  }

  if (filterId === "spin-blur") {
    return (Number(params.amount) || 0) >= 32 || (Number(params.radius) || 0) >= 65
  }

  return false
}

export async function applyPlannedFilterFinal(
  filter: FilterDef,
  src: ImageData,
  params: ParamMap,
  context: FilterContext,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("Filter processing cancelled", "AbortError")
  if (Object.keys(context).length > 0) {
    return filter.apply(src, params, context)
  }

  const tiling = planExpensiveFilterTiling(filter.id, src.width, src.height, params, { tileSize: 512 })
  if (tiling.strategy !== "single-frame") {
    return applyFilterTiled(filter.id, src, params, {
      tileSize: tiling.tileSize,
      overlap: tiling.overlap,
      useWorker: tiling.strategy === "tiled-worker-preferred",
      yieldEveryTiles: tiling.yieldEveryTiles,
      signal,
    })
  }

  if (isFilterWorkerSupported(filter.id)) {
    return applyFilterAsync(filter.id, src, params)
  }

  return filter.apply(src, params, context)
}
