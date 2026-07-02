import type { DirtyRect } from "./dirty-rect"
import type { TileCanvasRect } from "./layer-tile-renderer"
import { planTileGrid } from "./performance-engine"
import {
  planTileOnlyDefaultCompositor,
  planTileOnlyFilter,
  planTileOnlyInteractiveTool,
  planTileOnlySelection,
  supportsTileOnlyLayer,
  type TileOnlyTile,
  type TileOnlyExportLayerDescriptor,
} from "./tile-only-pipeline"

export type { TileOnlyExportLayerDescriptor } from "./tile-only-pipeline"

export interface TileOnlyExportInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  format: string
  scale?: number
  layers: readonly TileOnlyExportLayerDescriptor[]
}

export interface TileOnlyExportPlan {
  mode: "tile-stream" | "single-canvas"
  encoder: "tile-sequence" | "browser-canvas"
  materializesFullDocument: boolean
  outputWidth: number
  outputHeight: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  tiles: TileOnlyTile[]
  unsupportedLayerIds: string[]
  warnings: string[]
}

export type TileOnlyCapabilityStatus = "safe" | "approximate" | "blocked"

export interface TileOnlyCapabilityRow {
  id: string
  label: string
  status: TileOnlyCapabilityStatus
  detail: string
  tilesInScope?: number
  mitigation?: string
}

export interface TileOnlyCapabilityDashboardInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  viewport?: DirtyRect
  explicitTileOnly?: boolean
  canvasBudgetPixels?: number
  format?: string
  scale?: number
  layers: readonly TileOnlyExportLayerDescriptor[]
  colorMode?: string
  bitDepth?: number
  quickMask?: boolean
  filterPreviewCount?: number
}

export interface TileOnlyCapabilityDashboard {
  summary: string
  documentMegapixels: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  safeCount: number
  approximateCount: number
  blockedCount: number
  rows: TileOnlyCapabilityRow[]
  unflushedPaths: readonly TileOnlyUnflushedPath[]
}

export interface TileOnlyExportDecision {
  mode: "tile-sequence" | "full-canvas-fallback"
  status: TileOnlyCapabilityStatus
  label: string
  actionLabel: string
  detail: string
}

const DEFAULT_TILE_SIZE = 512

function positiveInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}

function normalizeRect(rect: DirtyRect, width: number, height: number): DirtyRect {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)))
  const right = Math.max(x, Math.min(width, Math.ceil(rect.x + rect.w)))
  const bottom = Math.max(y, Math.min(height, Math.ceil(rect.y + rect.h)))
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

function tileRect(col: number, row: number, width: number, height: number, tileSize: number): TileCanvasRect {
  const x = col * tileSize
  const y = row * tileSize
  return {
    x,
    y,
    w: Math.max(0, Math.min(tileSize, width - x)),
    h: Math.max(0, Math.min(tileSize, height - y)),
  }
}

function tilesForRect(rect: DirtyRect, width: number, height: number, tileSizeInput?: number): TileOnlyTile[] {
  const tileSize = positiveInt(tileSizeInput, DEFAULT_TILE_SIZE)
  const clipped = normalizeRect(rect, width, height)
  if (clipped.w <= 0 || clipped.h <= 0) return []
  const startCol = Math.floor(clipped.x / tileSize)
  const endCol = Math.floor((clipped.x + clipped.w - 1) / tileSize)
  const startRow = Math.floor(clipped.y / tileSize)
  const endRow = Math.floor((clipped.y + clipped.h - 1) / tileSize)
  const tiles: TileOnlyTile[] = []
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      tiles.push({ key: String(col) + ":" + String(row), col, row, rect: tileRect(col, row, width, height, tileSize) })
    }
  }
  return tiles
}

export interface TileOnlyUnflushedPath {

  id: string

  area: string

  why: string

  mitigation: string

}



export const TILE_ONLY_UNFLUSHED_PATHS: readonly TileOnlyUnflushedPath[] = [

  {

    id: "webgl-compositor-full-texture",

    area: "WebGL compositor",

    why: "The WebGL backend still uploads one large texture per layer; the tiled-WebGL path is tracked under Item 18 in the in-scope gaps report.",

    mitigation: "Canvas 2D tile path is used automatically when WebGL is bypassed.",

  },

  {

    id: "psd-save-flatten",

    area: "PSD save (document-io)",

    why: "PSD compatibility layer 0 requires a full composite; that flatten is intrinsic to the format, not a tile-store limitation.",

    mitigation: "Save streams layer 0 once and writes individual layers without re-flattening.",

  },

  {

    id: "filter-context-required",

    area: "Filters needing extra context (match-color, apply-image, calculations)",

    why: "These filters consume multiple layers/documents and cannot accept a single ImageData tile.",

    mitigation: "Run on the main thread with a downsampled preview when the document is too large to fit memory.",

  },

  {

    id: "vector-text-rasterization",

    area: "Text + vector rasterization",

    why: "Text and vector layers rasterize through the platform canvas which is layer-sized, not tile-sized.",

    mitigation: "Crop the rasterized canvas into per-tile reads at compose time; for very large layers this still allocates the full layer canvas.",

  },

  {

    id: "history-snapshots",

    area: "History store",

    why: "Snapshots before/after each edit currently capture the whole layer canvas to compress with WebP.",

    mitigation: "Older entries are spilled to WebP blobs and rehydrated lazily; bounded to last 12 raw entries.",

  },

  {

    id: "single-canvas-export",

    area: "Browser-canvas export fallback",

    why: "When a layer kind is not in supportsTileOnlyLayer (e.g., unsupported group flattening), planTileOnlyExport returns mode=single-canvas.",

    mitigation: "exportRasterTileSequenceBlob throws so the caller can switch to the browser-canvas path or remove the unsupported layer.",

  },

] as const



export function getTileOnlyUnflushedPaths(): readonly TileOnlyUnflushedPath[] {
  return TILE_ONLY_UNFLUSHED_PATHS
}

function statusCounts(rows: readonly TileOnlyCapabilityRow[]) {
  return rows.reduce(
    (counts, row) => {
      if (row.status === "safe") counts.safeCount += 1
      else if (row.status === "approximate") counts.approximateCount += 1
      else counts.blockedCount += 1
      return counts
    },
    { safeCount: 0, approximateCount: 0, blockedCount: 0 },
  )
}

function sampleOperationRect(width: number, height: number, tileSize: number): DirtyRect {
  const w = Math.max(1, Math.min(Math.ceil(tileSize / 3), width))
  const h = Math.max(1, Math.min(Math.ceil(tileSize / 3), height))
  return normalizeRect({
    x: Math.max(0, Math.floor((width - w) / 2)),
    y: Math.max(0, Math.floor((height - h) / 2)),
    w,
    h,
  }, width, height)
}

function defaultDashboardViewport(width: number, height: number, tileSize: number): DirtyRect {
  return normalizeRect({ x: 0, y: 0, w: Math.min(width, tileSize * 2), h: Math.min(height, tileSize * 2) }, width, height)
}

export function describeTileOnlyExportDecision(plan: TileOnlyExportPlan): TileOnlyExportDecision {
  if (plan.mode === "tile-stream") {
    return {
      mode: "tile-sequence",
      status: "safe",
      label: "Tile-sequence export",
      actionLabel: "Export tile package",
      detail: `${plan.outputWidth} x ${plan.outputHeight}px output streams as ${plan.tileCount} independently composited ${plan.tileSize}px tiles and avoids a full-canvas allocation.`,
    }
  }
  const unsupported = plan.unsupportedLayerIds.length ? plan.unsupportedLayerIds.join(", ") : "unsupported document payloads"
  return {
    mode: "full-canvas-fallback",
    status: "blocked",
    label: "Full-canvas export fallback",
    actionLabel: "Resolve unsupported layers",
    detail: `Tile-sequence export is blocked by ${unsupported}; browser-canvas export is the fallback and may exceed large-document limits.`,
  }
}

export function createTileOnlyCapabilityDashboard(input: TileOnlyCapabilityDashboardInput): TileOnlyCapabilityDashboard {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const grid = planTileGrid(width, height, tileSize)
  const rows: TileOnlyCapabilityRow[] = []
  const fallbackLayers: readonly TileOnlyExportLayerDescriptor[] = [{ id: "background", kind: "raster" }]
  const layers: readonly TileOnlyExportLayerDescriptor[] = input.layers.length ? input.layers : fallbackLayers
  const viewport = input.viewport ? normalizeRect(input.viewport, width, height) : defaultDashboardViewport(width, height, tileSize)
  const sampleRect = sampleOperationRect(width, height, tileSize)
  const unsupportedLayerIds = layers.filter((layer) => !supportsTileOnlyLayer(layer)).map((layer) => layer.id)

  const compositor = planTileOnlyDefaultCompositor({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    viewport,
    explicitTileOnly: input.explicitTileOnly ?? width * height > 10000 * 10000,
    canvasBudgetPixels: input.canvasBudgetPixels,
    layers,
  })
  rows.push({
    id: "viewport-compositing",
    label: "Viewport compositing",
    status: unsupportedLayerIds.length ? "blocked" : "safe",
    tilesInScope: compositor.viewportPlan.materializeTiles.length,
    detail: unsupportedLayerIds.length
      ? `Viewport tiling is blocked by unsupported layers: ${unsupportedLayerIds.join(", ")}.`
      : `Visible viewport composes ${compositor.viewportPlan.materializeTiles.length} tile${compositor.viewportPlan.materializeTiles.length === 1 ? "" : "s"} without allocating the full document.`,
    mitigation: unsupportedLayerIds.length ? "Flatten or rasterize unsupported layers before using tile-only viewport rendering." : undefined,
  })

  const paint = planTileOnlyInteractiveTool({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    tool: "brush",
    layerId: layers[0]?.id ?? "active-layer",
    bounds: sampleRect,
    radius: Math.max(8, Math.ceil(tileSize / 32)),
  })
  rows.push({
    id: "interactive-tools",
    label: "Paint and retouch tools",
    status: paint.strategy === "tile-local" ? "safe" : "blocked",
    tilesInScope: paint.writeTiles.length,
    detail: `Brush, clone, healing, smudge, dodge, burn, and sponge edits can limit reads and writes to touched tiles with halo padding.`,
    mitigation: paint.strategy === "tile-local" ? undefined : paint.unsupportedReasons.join(", "),
  })

  const filter = planTileOnlyFilter({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    layerId: layers[0]?.id ?? "active-layer",
    filterId: "gaussian-blur",
    params: { radius: 12 },
    bounds: sampleRect,
  })
  rows.push({
    id: "local-filters",
    label: "Local-kernel filters",
    status: "safe",
    tilesInScope: filter.writeTiles.length,
    detail: `Blur, sharpen, and similar local filters read halo tiles and write only the affected tile range.`,
  })

  const selection = planTileOnlySelection({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    kind: "quick-selection",
    bounds: sampleRect,
    tolerance: 24,
    sampleAllLayers: true,
  })
  rows.push({
    id: "selections-and-masks",
    label: "Selections and masks",
    status: "safe",
    tilesInScope: selection.writeTiles.length,
    detail: `Selections store tile masks and can sample tile-local composites instead of creating one full alpha canvas.`,
  })

  const exportPlan = planTileOnlyExport({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    format: input.format ?? "png",
    scale: input.scale ?? 1,
    layers,
  })
  const exportDecision = describeTileOnlyExportDecision(exportPlan)
  rows.push({
    id: "raster-export",
    label: "Raster export",
    status: exportDecision.status,
    tilesInScope: exportPlan.tileCount,
    detail: exportDecision.detail,
    mitigation: exportDecision.status === "blocked" ? "Remove, flatten, or rasterize the unsupported layer payload before tile-sequence export." : undefined,
  })

  if (input.colorMode && input.colorMode !== "RGB") {
    rows.push({
      id: "color-mode-preview",
      label: "Color-mode preview",
      status: "approximate",
      detail: `${input.colorMode} intent is previewed through browser RGB tiles; source metadata remains available for compatibility decisions.`,
      mitigation: "Use compatibility reports before export when color handoff matters.",
    })
  }
  if ((input.bitDepth ?? 8) > 8) {
    rows.push({
      id: "high-bit-preview",
      label: "High-bit preview",
      status: "approximate",
      detail: `${input.bitDepth}-bit sources can be preserved where supported, but browser canvas previews are 8-bit RGBA.`,
      mitigation: "Use high-bit reports and avoid destructive browser-raster export when precision matters.",
    })
  }
  if (input.quickMask) {
    rows.push({
      id: "quick-mask-preview",
      label: "Quick Mask preview",
      status: "approximate",
      detail: "Quick Mask overlays can force preview compositing outside the tile-local default path.",
      mitigation: "Commit or hide Quick Mask before evaluating final tile export.",
    })
  }
  if ((input.filterPreviewCount ?? 0) > 0) {
    rows.push({
      id: "active-filter-previews",
      label: "Active filter previews",
      status: "approximate",
      detail: "Live preview overlays can use reduced or tiled previews before the final pass commits.",
      mitigation: "Commit the preview to measure the final tile-only path.",
    })
  }

  for (const path of TILE_ONLY_UNFLUSHED_PATHS) {
    const blocksCurrentExport = path.id === "single-canvas-export" && exportPlan.mode === "single-canvas"
    const textVectorIdle =
      path.id === "vector-text-rasterization" &&
      !layers.some((layer) => layer.kind === "text" || layer.kind === "shape")
    rows.push({
      id: path.id,
      label: path.area,
      status: blocksCurrentExport ? "blocked" : textVectorIdle ? "safe" : "approximate",
      detail: path.why,
      mitigation: path.mitigation,
    })
  }

  const counts = statusCounts(rows)
  return {
    summary: `${grid.tileCount} tiles at ${tileSize}px; ${counts.safeCount} safe, ${counts.approximateCount} approximate, ${counts.blockedCount} blocked operation path${rows.length === 1 ? "" : "s"}.`,
    documentMegapixels: Math.round((width * height / 1_000_000) * 10) / 10,
    tileSize,
    tileColumns: grid.tileColumns,
    tileRows: grid.tileRows,
    tileCount: grid.tileCount,
    ...counts,
    rows,
    unflushedPaths: getTileOnlyUnflushedPaths(),
  }
}

export function planTileOnlyExport(input: TileOnlyExportInput): TileOnlyExportPlan {
  const scale = Number.isFinite(input.scale) ? Math.max(0.001, Number(input.scale)) : 1

  const width = positiveInt(input.documentWidth * scale, 1)

  const height = positiveInt(input.documentHeight * scale, 1)

  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)

  const grid = planTileGrid(width, height, tileSize)

  const tiles = tilesForRect({ x: 0, y: 0, w: width, h: height }, width, height, tileSize)

  const unsupportedLayerIds = input.layers

    .filter((layer) => !supportsTileOnlyLayer(layer))

    .map((layer) => layer.id)

  const browserCanvas = unsupportedLayerIds.length > 0

  const format = input.format.toUpperCase()

  return {

    mode: browserCanvas ? "single-canvas" : "tile-stream",

    encoder: browserCanvas ? "browser-canvas" : "tile-sequence",

    materializesFullDocument: browserCanvas,

    outputWidth: width,

    outputHeight: height,

    tileSize,

    tileColumns: grid.tileColumns,

    tileRows: grid.tileRows,

    tileCount: grid.tileCount,

    tiles,

    unsupportedLayerIds,

    warnings: browserCanvas

      ? [`${format} export requires the browser canvas path because unsupported layers are present: ${unsupportedLayerIds.join(", ")}.`]

      : [`${format} export streams tiles to the encoder plan instead of allocating a ${width} x ${height} canvas.`],

  }

}
