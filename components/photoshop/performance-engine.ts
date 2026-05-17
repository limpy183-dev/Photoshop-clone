const BYTES_PER_PIXEL = 4
const MIB = 1024 * 1024
const DEFAULT_TILE_SIZE = 512
const DEFAULT_MEMORY_BUDGET_MB = 1024
const COMPOSITE_CACHE_MAX_PIXELS = 16_000_000
const HISTORY_MAX_PATCHES = 24
const HISTORY_MAX_PATCH_AREA_RATIO = 0.42
const HISTORY_MAX_PATCH_CHAIN_AREA_RATIO = 0.9

export interface CanvasSize {
  width: number
  height: number
}

export interface TileGridPlan {
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
}

export interface LargeCanvasBenchmarkInput extends CanvasSize {
  layerCount?: number
  tileSize?: number
  memoryBudgetMB?: number
}

export interface LargeCanvasBenchmarkSummary extends TileGridPlan {
  pixelCount: number
  megapixels: number
  bytesPerLayer: number
  estimatedWorkingSetMB: number
  strategy: "single-frame" | "tiled"
  warnings: string[]
}

export interface StrokePoint {
  x: number
  y: number
}

export interface BrushStrokeBenchmarkInput {
  canvasWidth: number
  canvasHeight: number
  start: StrokePoint
  end: StrokePoint
  brushSize: number
  spacingPercent?: number
}

export interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BrushStrokeBenchmarkPlan {
  dabCount: number
  dabSpacingPx: number
  affectedBounds: DirtyRect
  affectedPixels: number
  estimatedDabPixels: number
  patchAreaRatio: number
  historyRecommendation: "patch" | "full-snapshot"
  warnings: string[]
}

export interface HistoryMemoryBudgetInput extends CanvasSize {
  layerCount?: number
  historyStates?: number
  averageChangedLayerRatio?: number
  memoryBudgetMB?: number
}

export interface HistoryMemoryBudgetSummary {
  fullSnapshotMB: number
  projectedHistoryMB: number
  maxPatchAreaRatio: number
  maxPatchChainAreaRatio: number
  maxPatchesPerLayer: number
  status: "within-budget" | "over-budget"
  warnings: string[]
}

export interface MergeWorkflowTilingInput extends CanvasSize {
  layerCount: number
  tileSize?: number
  memoryBudgetMB?: number
}

export interface MergeWorkflowTilingPlan extends TileGridPlan {
  strategy: "single-frame-merge" | "tiled-merge"
  estimatedCompositeOps: number
  memoryPeakMB: number
  fullFrameWorkingSetMB: number
  warnings: string[]
}

export interface CompositeCacheInput extends CanvasSize {
  forcedRender?: boolean
  maxCachePixels?: number
}

export interface CompositeCachePlan {
  storeCache: boolean
  reason: "cacheable" | "forced-render" | "large-canvas"
  pixelCount: number
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

function bytesToMB(bytes: number) {
  return Math.round(bytes / MIB)
}

export function planTileGrid(width: number, height: number, tileSize = DEFAULT_TILE_SIZE): TileGridPlan {
  const safeWidth = positiveInt(width, 1)
  const safeHeight = positiveInt(height, 1)
  const safeTileSize = positiveInt(tileSize, DEFAULT_TILE_SIZE)
  const tileColumns = Math.ceil(safeWidth / safeTileSize)
  const tileRows = Math.ceil(safeHeight / safeTileSize)
  return {
    tileSize: safeTileSize,
    tileColumns,
    tileRows,
    tileCount: tileColumns * tileRows,
  }
}

export function planLargeCanvasBenchmark(input: LargeCanvasBenchmarkInput): LargeCanvasBenchmarkSummary {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const layerCount = positiveInt(input.layerCount, 1)
  const memoryBudgetMB = positiveInt(input.memoryBudgetMB, DEFAULT_MEMORY_BUDGET_MB)
  const pixelCount = width * height
  const bytesPerLayer = pixelCount * BYTES_PER_PIXEL
  const estimatedWorkingSetMB = bytesToMB(bytesPerLayer * layerCount)
  const grid = planTileGrid(width, height, input.tileSize)
  const warnings: string[] = []

  if (estimatedWorkingSetMB > memoryBudgetMB) {
    warnings.push(`Estimated working set ${estimatedWorkingSetMB} MB exceeds memory budget ${memoryBudgetMB} MB.`)
  }
  if (pixelCount >= 50_000_000) {
    warnings.push("Large canvas exceeds 50 MP; prefer tiled processing and bounded history patches.")
  }

  return {
    ...grid,
    pixelCount,
    megapixels: Math.round((pixelCount / 1_000_000) * 10) / 10,
    bytesPerLayer,
    estimatedWorkingSetMB,
    strategy: estimatedWorkingSetMB > memoryBudgetMB || pixelCount >= 50_000_000 ? "tiled" : "single-frame",
    warnings,
  }
}

export function planBrushStrokeBenchmark(input: BrushStrokeBenchmarkInput): BrushStrokeBenchmarkPlan {
  const canvasWidth = positiveInt(input.canvasWidth, 1)
  const canvasHeight = positiveInt(input.canvasHeight, 1)
  const brushSize = positiveInt(input.brushSize, 1)
  const spacingPercent = Math.max(1, input.spacingPercent ?? 25)
  const radius = brushSize / 2
  const dabSpacingPx = Math.max(1, Math.round(brushSize * (spacingPercent / 100)))
  const dx = input.end.x - input.start.x
  const dy = input.end.y - input.start.y
  const distance = Math.hypot(dx, dy)
  const dabCount = Math.max(1, Math.ceil(distance / dabSpacingPx) + 1)
  const left = Math.max(0, Math.floor(Math.min(input.start.x, input.end.x) - radius))
  const top = Math.max(0, Math.floor(Math.min(input.start.y, input.end.y) - radius))
  const right = Math.min(canvasWidth, Math.ceil(Math.max(input.start.x, input.end.x) + radius))
  const bottom = Math.min(canvasHeight, Math.ceil(Math.max(input.start.y, input.end.y) + radius))
  const affectedBounds = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) }
  const affectedPixels = affectedBounds.w * affectedBounds.h
  const patchAreaRatio = affectedPixels / Math.max(1, canvasWidth * canvasHeight)
  const warnings: string[] = []

  if (patchAreaRatio > HISTORY_MAX_PATCH_AREA_RATIO) {
    warnings.push(`Stroke affects ${(patchAreaRatio * 100).toFixed(1)}% of the canvas, above the history patch budget.`)
  }
  if (dabCount > 200) {
    warnings.push(`Stroke emits ${dabCount} dabs; batch pixel reads and yielding are recommended.`)
  }

  return {
    dabCount,
    dabSpacingPx,
    affectedBounds,
    affectedPixels,
    estimatedDabPixels: Math.round(Math.PI * radius * radius * dabCount),
    patchAreaRatio,
    historyRecommendation: patchAreaRatio <= HISTORY_MAX_PATCH_AREA_RATIO ? "patch" : "full-snapshot",
    warnings,
  }
}

export function estimateHistoryMemoryBudget(input: HistoryMemoryBudgetInput): HistoryMemoryBudgetSummary {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const layerCount = positiveInt(input.layerCount, 1)
  const historyStates = positiveInt(input.historyStates, 1)
  const memoryBudgetMB = positiveInt(input.memoryBudgetMB, DEFAULT_MEMORY_BUDGET_MB)
  const averageChangedLayerRatio = Math.max(0, Math.min(1, input.averageChangedLayerRatio ?? 1))
  const fullSnapshotBytes = width * height * BYTES_PER_PIXEL * layerCount
  const projectedHistoryBytes = fullSnapshotBytes * averageChangedLayerRatio * historyStates
  const fullSnapshotMB = bytesToMB(fullSnapshotBytes)
  const projectedHistoryMB = bytesToMB(projectedHistoryBytes)
  const warnings: string[] = []

  if (projectedHistoryMB > memoryBudgetMB) {
    warnings.push(`Projected history memory ${projectedHistoryMB} MB exceeds budget ${memoryBudgetMB} MB.`)
  }
  if (historyStates > 24 && averageChangedLayerRatio > HISTORY_MAX_PATCH_AREA_RATIO / 4) {
    warnings.push("High history state count with broad edits can exhaust patch chains quickly.")
  }

  return {
    fullSnapshotMB,
    projectedHistoryMB,
    maxPatchAreaRatio: HISTORY_MAX_PATCH_AREA_RATIO,
    maxPatchChainAreaRatio: HISTORY_MAX_PATCH_CHAIN_AREA_RATIO,
    maxPatchesPerLayer: HISTORY_MAX_PATCHES,
    status: projectedHistoryMB > memoryBudgetMB ? "over-budget" : "within-budget",
    warnings,
  }
}

export function planMergeWorkflowTiling(input: MergeWorkflowTilingInput): MergeWorkflowTilingPlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const layerCount = positiveInt(input.layerCount, 1)
  const memoryBudgetMB = positiveInt(input.memoryBudgetMB, DEFAULT_MEMORY_BUDGET_MB)
  const grid = planTileGrid(width, height, input.tileSize ?? 1024)
  const fullFrameWorkingSetMB = bytesToMB(width * height * BYTES_PER_PIXEL * Math.max(2, layerCount))
  const tilePixels = grid.tileSize * grid.tileSize
  const memoryPeakMB = bytesToMB(tilePixels * BYTES_PER_PIXEL * 2)
  const warnings: string[] = []
  const needsTiling = grid.tileCount > 1 && (fullFrameWorkingSetMB > memoryBudgetMB || layerCount >= 8 || width * height >= 16_000_000)

  if (needsTiling) {
    warnings.push("Merge should composite tile-by-tile to avoid allocating every layer at full-frame scale.")
  }

  return {
    ...grid,
    strategy: needsTiling ? "tiled-merge" : "single-frame-merge",
    estimatedCompositeOps: grid.tileCount * layerCount,
    memoryPeakMB,
    fullFrameWorkingSetMB,
    warnings,
  }
}

export function planCompositeCache(input: CompositeCacheInput): CompositeCachePlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const pixelCount = width * height
  const maxCachePixels = positiveInt(input.maxCachePixels, COMPOSITE_CACHE_MAX_PIXELS)

  if (input.forcedRender) {
    return { storeCache: false, reason: "forced-render", pixelCount }
  }
  if (pixelCount > maxCachePixels) {
    return { storeCache: false, reason: "large-canvas", pixelCount }
  }
  return { storeCache: true, reason: "cacheable", pixelCount }
}
