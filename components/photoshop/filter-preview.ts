import {
  applyFilterAsync,
  applyFilterPreview,
  applyFilterTiled,
  isFilterWorkerSupported,
  planExpensiveFilterTiling,
} from "./filter-worker"
import type { FilterContext, FilterDef } from "./filters"

type ParamValue = number | string | boolean
type ParamMap = Record<string, ParamValue>

export type FilterPreviewMode = "sync" | "worker" | "tiled-worker" | "tiled-main" | "downsample-sync"

export interface FilterPreviewPlan {
  mode: FilterPreviewMode
  pixelCount: number
  previewScale: number
  tileSize?: number
  reason: "small-preview" | "worker-supported-preview" | "expensive-filter-large-preview" | "unsupported-large-preview"
}

export function planFilterPreviewExecution(
  filterId: string,
  width: number,
  height: number,
  params: ParamMap = {},
): FilterPreviewPlan {
  const pixelCount = Math.max(0, Math.round(width)) * Math.max(0, Math.round(height))
  const previewScale = pixelCount >= 4_000_000 ? 0.5 : 1
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
) {
  const plan = planFilterPreviewExecution(filter.id, src.width, src.height, params)
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
