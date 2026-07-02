import { isAdjustmentNoop } from "./adjustment-layers"
import { compositeLayer } from "./blend-modes"
import { isEmptyDirtyRect, intersectDirtyRect, unionDirtyRect, unionDirtyRects, type DirtyRect } from "./dirty-rect"
import { getFilter } from "./filters"
import { planExpensiveFilterTiling } from "./filter-worker"
import { renderLayerContentTile, type TileCanvasRect } from "./layer-tile-renderer"
import { planTileGrid } from "./performance-engine"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import type { BlendMode, Layer, LayerKind, PsDocument, ToolId } from "./types"
import { rasterizeVectorMaskForWebGL } from "./webgl-compositor"
export interface TileOnlyTile {
  key: string
  col: number
  row: number
  rect: TileCanvasRect
}
export interface TileOnlyOperation {
  kind:
    | "paint"
    | "erase"
    | "clone"
    | "heal"
    | "blur"
    | "sharpen"
    | "smudge"
    | "dodge-burn-sponge"
    | "selection-mask"
    | "transform"
    | "smart-object"
    | "3d"
    | "video"
  tool: string
  layerId: string
  bounds: DirtyRect
  radius?: number
  sourceBounds?: DirtyRect
}
export interface TileOnlyEditPlan {
  strategy: "tile-local" | "unsupported"
  layerId: string
  operationKind: TileOnlyOperation["kind"]
  readRect: DirtyRect
  writeRect: DirtyRect
  readTiles: TileOnlyTile[]
  writeTiles: TileOnlyTile[]
  materializesFullDocument: boolean
  reasons: string[]
  unsupportedReasons: string[]
}
export interface TileOnlyEditInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  operation: TileOnlyOperation
}
export interface TileOnlyFilterPlan extends TileOnlyEditPlan {
  filterId: string
  readHalo: number
  workerPreferred: boolean
}
export interface TileOnlyFilterInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  layerId: string
  filterId: string
  params?: Record<string, number | string | boolean>
  bounds?: DirtyRect
}
export interface TileOnlySelectionInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  kind:
    | "marquee"
    | "lasso"
    | "polygonal-lasso"
    | "magnetic-lasso"
    | "magic-wand"
    | "quick-selection"
    | "object-selection"
    | "color-range"
    | "refine-edge"
    | "quick-mask"
  bounds: DirtyRect
  sampleAllLayers?: boolean
  tolerance?: number
  feather?: number
}
export interface TileOnlySelectionPlan {
  strategy: "tile-local"
  selectionStorage: "tile-mask"
  readRect: DirtyRect
  writeRect: DirtyRect
  readTiles: TileOnlyTile[]
  writeTiles: TileOnlyTile[]
  materializesFullDocument: false
  reasons: string[]
}
export interface TileOnlyExportLayerDescriptor {
  id: string
  kind?: LayerKind
  visible?: boolean
}
export interface ComposeDocumentTileOptions {
  transparent?: boolean
  matte?: string
}
export interface TileOnlyDefaultCompositorInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  viewport: DirtyRect
  prefetchPadding?: number
  dirtyRects?: readonly DirtyRect[]
  cachedTileKeys?: readonly string[]
  spilledTileKeys?: readonly string[]
  layers: readonly TileOnlyExportLayerDescriptor[]
  explicitTileOnly?: boolean
  colorMode?: string
  bitDepth?: number
  quickMask?: boolean
  filterPreviewCount?: number
  canvasBudgetPixels?: number
}
export interface TileOnlyDefaultCompositorPlan {
  strategy: "tile-local" | "fallback-full"
  viewportPlan: TileOnlyViewportComposePlan
  materializesFullDocument: boolean
  unsupportedLayerIds: string[]
  reasons: string[]
}
export interface TileOnlyViewportRenderedTile extends TileOnlyViewportTile {
  canvas: HTMLCanvasElement
}
export interface TileOnlyViewportRenderResult {
  viewport: DirtyRect
  viewportUnion: DirtyRect
  tiles: TileOnlyViewportRenderedTile[]
  materializesFullDocument: false
}
export interface TileOnlyInteractiveToolInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  tool: ToolId
  layerId: string
  bounds: DirtyRect
  radius?: number
  sourceBounds?: DirtyRect
  sampleAllLayers?: boolean
}
const DEFAULT_TILE_SIZE = 512
function positiveInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}
function normalizeRect(rect: DirtyRect, width: number, height: number): DirtyRect {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const w = Math.ceil(rect.w)
  const h = Math.ceil(rect.h)
  return intersectDirtyRect({ x, y, w, h }, { x: 0, y: 0, w: width, h: height })
}
function inflateRect(rect: DirtyRect, radius: number, width: number, height: number): DirtyRect {
  const halo = Math.max(0, Math.ceil(radius))
  return normalizeRect({ x: rect.x - halo, y: rect.y - halo, w: rect.w + halo * 2, h: rect.h + halo * 2 }, width, height)
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
  if (isEmptyDirtyRect(clipped)) return []
  const grid = planTileGrid(width, height, tileSize)
  const col0 = Math.max(0, Math.floor(clipped.x / tileSize))
  const row0 = Math.max(0, Math.floor(clipped.y / tileSize))
  const col1 = Math.min(grid.tileColumns - 1, Math.floor((clipped.x + clipped.w - 1) / tileSize))
  const row1 = Math.min(grid.tileRows - 1, Math.floor((clipped.y + clipped.h - 1) / tileSize))
  const out: TileOnlyTile[] = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      out.push({ key: `${col}:${row}`, col, row, rect: tileRect(col, row, width, height, tileSize) })
    }
  }
  return out
}
function uniqueTiles(tiles: readonly TileOnlyTile[]) {
  const byKey = new Map<string, TileOnlyTile>()
  for (const tile of tiles) byKey.set(tile.key, tile)
  return [...byKey.values()].sort((a, b) => a.row - b.row || a.col - b.col)
}
function readTilesForOutputTiles(
  writeTiles: readonly TileOnlyTile[],
  halo: number,
  width: number,
  height: number,
  tileSize: number,
) {
  if (halo <= 0) return [...writeTiles]
  return uniqueTiles(writeTiles.flatMap((tile) => tilesForRect(inflateRect(tile.rect, halo, width, height), width, height, tileSize)))
}
function operationHalo(operation: TileOnlyOperation) {
  const explicit = Number(operation.radius)
  if (Number.isFinite(explicit) && explicit > 0) return Math.ceil(explicit)
  switch (operation.kind) {
    case "clone":
    case "heal":
    case "blur":
    case "sharpen":
    case "smudge":
    case "selection-mask":
      return 8
    default:
      return 0
  }
}
export function planTileOnlyEdit(input: TileOnlyEditInput): TileOnlyEditPlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const op = input.operation
  const writeRect = normalizeRect(op.bounds, width, height)
  const sourceRects = [writeRect, op.sourceBounds ? normalizeRect(op.sourceBounds, width, height) : null].filter(Boolean) as DirtyRect[]
  const combinedSourceRect = sourceRects.length ? unionDirtyRects(sourceRects) : writeRect
  const halo = operationHalo(op)
  const readRect = inflateRect(combinedSourceRect, halo, width, height)
  const writeTiles = tilesForRect(writeRect, width, height, tileSize)
  const readTiles = tilesForRect(readRect, width, height, tileSize)
  const unsupportedReasons: string[] = []
  if (isEmptyDirtyRect(writeRect)) unsupportedReasons.push("empty-bounds")
  const strategy = unsupportedReasons.length ? "unsupported" : "tile-local"
  return {
    strategy,
    layerId: op.layerId,
    operationKind: op.kind,
    readRect,
    writeRect,
    readTiles,
    writeTiles,
    materializesFullDocument: false,
    reasons: [`tool:${op.tool}`, `operation:${op.kind}`, halo > 0 ? `halo:${halo}` : "halo:0"],
    unsupportedReasons,
  }
}
export function planTileOnlyFilter(input: TileOnlyFilterInput): TileOnlyFilterPlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const params = input.params ?? {}
  const tiling = planExpensiveFilterTiling(input.filterId, width, height, params, { tileSize })
  const writeRect = input.bounds ? normalizeRect(input.bounds, width, height) : { x: 0, y: 0, w: width, h: height }
  const writeTiles = tilesForRect(writeRect, width, height, tileSize)
  const readTiles = readTilesForOutputTiles(writeTiles, tiling.overlap, width, height, tileSize)
  const readRect = readTiles.length ? unionDirtyRects(readTiles.map((tile) => tile.rect)) : writeRect
  return {
    strategy: "tile-local",
    layerId: input.layerId,
    operationKind: "smart-object",
    filterId: input.filterId,
    readHalo: tiling.overlap,
    workerPreferred: tiling.strategy === "tiled-worker-preferred",
    readRect,
    writeRect,
    readTiles,
    writeTiles,
    materializesFullDocument: false,
    reasons: [`filter:${input.filterId}`, tiling.overlap > 0 ? `halo:${tiling.overlap}` : "halo:0", tiling.strategy],
    unsupportedReasons: [],
  }
}
export function planTileOnlySelection(input: TileOnlySelectionInput): TileOnlySelectionPlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const halo = Math.max(0, Math.ceil(Number(input.feather ?? 0)))
  const writeRect = normalizeRect(input.bounds, width, height)
  const readRect = inflateRect(writeRect, halo, width, height)
  return {
    strategy: "tile-local",
    selectionStorage: "tile-mask",
    readRect,
    writeRect,
    readTiles: tilesForRect(readRect, width, height, tileSize),
    writeTiles: tilesForRect(writeRect, width, height, tileSize),
    materializesFullDocument: false,
    reasons: [
      `selection:${input.kind}`,
      input.sampleAllLayers ? "sample-all-layers" : "active-layer",
      `tolerance:${positiveInt(input.tolerance, 0)}`,
    ],
  }
}
export function supportsTileOnlyLayer(layer: Pick<Layer, "kind" | "visible" | "canvas"> | TileOnlyExportLayerDescriptor) {
  if ("visible" in layer && layer.visible === false) return true
  const kind = layer.kind ?? "raster"
  if (kind === "group") return false
  return [
    "raster",
    "text",
    "shape",
    "smart-object",
    "adjustment",
    "frame",
    "artboard",
    "3d",
    "video",
  ].includes(kind)
}
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}
function cropCanvas(source: HTMLCanvasElement | null | undefined, rect: TileCanvasRect) {
  if (!source || typeof source.getContext !== "function") return null
  const canvas = makeCanvas(rect.w, rect.h)
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return canvas
}
function imageDataToCanvas(image: ImageData) {
  const canvas = makeCanvas(image.width, image.height)
  canvas.getContext("2d")?.putImageData(image, 0, 0)
  return canvas
}
function paramsWithDefaults(filter: NonNullable<ReturnType<typeof getFilter>>, params: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
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
function applySmartFiltersToTile(sourceTile: HTMLCanvasElement, layer: Layer, rect: TileCanvasRect) {
  const enabled = layer.smartFilters?.filter((filter) => filter.enabled) ?? []
  if (!enabled.length) return sourceTile
  const canvas = makeCanvas(sourceTile.width, sourceTile.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(sourceTile, 0, 0)
  let current = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
    const blendMode = (smartFilter.blendMode ?? "normal") as BlendMode
    if (opacity <= 0) {
      current = before
      continue
    }
    const maskCanvas = smartFilter.maskEnabled === false ? null : smartFilter.mask ?? null
    const mask = maskCanvas ? smartFilterMaskToImageData(maskCanvas, maskCanvas.width, maskCanvas.height, smartFilter.maskFeather ?? 0) : null
    if (!mask && opacity >= 1 && blendMode === "normal") {
      current = after
      continue
    }
    const overlay = new ImageData(new Uint8ClampedArray(after.data), after.width, after.height)
    if (mask) {
      for (let y = 0; y < overlay.height; y++) {
        for (let x = 0; x < overlay.width; x++) {
          const maskX = rect.x + x
          const maskY = rect.y + y
          const i = (y * overlay.width + x) * 4
          overlay.data[i + 3] = Math.round(overlay.data[i + 3] * smartFilterMaskAmountAt(mask, maskX, maskY, smartFilter.maskDensity ?? 1))
        }
      }
    }
    const base = imageDataToCanvas(before)
    compositeLayer(base.getContext("2d")!, imageDataToCanvas(overlay), blendMode, opacity)
    current = base.getContext("2d")!.getImageData(0, 0, base.width, base.height)
  }
  ctx.putImageData(current, 0, 0)
  return canvas
}
function applyMaskCanvas(tile: HTMLCanvasElement, mask: HTMLCanvasElement | null) {
  if (!mask) return tile
  const canvas = makeCanvas(tile.width, tile.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(tile, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const maskCtx = mask.getContext("2d")
  if (!maskCtx) return canvas
  const maskImage = maskCtx.getImageData(0, 0, Math.min(mask.width, canvas.width), Math.min(mask.height, canvas.height))
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (x >= maskImage.width || y >= maskImage.height) {
        image.data[i + 3] = 0
        continue
      }
      const mi = (y * maskImage.width + x) * 4
      const luminance = (0.299 * maskImage.data[mi] + 0.587 * maskImage.data[mi + 1] + 0.114 * maskImage.data[mi + 2]) / 255
      image.data[i + 3] = Math.round(image.data[i + 3] * luminance * (maskImage.data[mi + 3] / 255))
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
function renderLayerTileForComposite(layer: Layer, rect: TileCanvasRect, doc: Pick<PsDocument, "width" | "height">, clipMask: HTMLCanvasElement | null) {
  let tile = renderLayerContentTile(layer, rect, { width: doc.width, height: doc.height })
  tile = applySmartFiltersToTile(tile, layer, rect)
  if (layer.mask && layer.maskEnabled !== false) tile = applyMaskCanvas(tile, cropCanvas(layer.mask, rect))
  if (layer.vectorMask) {
    const vectorMask = rasterizeVectorMaskForWebGL(layer, doc.width, doc.height, rect)
    tile = applyMaskCanvas(tile, vectorMask)
  }
  if (clipMask) tile = applyMaskCanvas(tile, clipMask)
  return tile
}
function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
}
function applyAdjustmentTile(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  rect: TileCanvasRect,
  clipMask: HTMLCanvasElement | null,
) {
  if (!layer.adjustment || isAdjustmentNoop(layer.adjustment) || layer.opacity <= 0) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return
  const before = ctx.getImageData(0, 0, rect.w, rect.h)
  const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCanvas = layer.mask && layer.maskEnabled !== false ? cropCanvas(layer.mask, rect) : null
  const mask = maskCanvas?.getContext("2d")?.getImageData(0, 0, maskCanvas.width, maskCanvas.height) ?? null
  const clip = clipMask?.getContext("2d")?.getImageData(0, 0, clipMask.width, clipMask.height) ?? null
  if (!mask && !clip && opacity >= 1) {
    ctx.putImageData(after, 0, 0)
    return
  }
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (y * rect.w + x) * 4
      const amount = opacity * maskAmountAt(mask, x, y) * maskAmountAt(clip, x, y)
      for (let channel = 0; channel < 4; channel++) {
        after.data[i + channel] = before.data[i + channel] * (1 - amount) + after.data[i + channel] * amount
      }
    }
  }
  ctx.putImageData(after, 0, 0)
}
function clippedBaseLayerCanvas(doc: Pick<PsDocument, "layers">, index: number, rect: TileCanvasRect) {
  for (let j = index - 1; j >= 0; j--) {
    const candidate = doc.layers[j]
    if (!candidate.clipped) return cropCanvas(candidate.canvas, rect)
  }
  return null
}
export function composeDocumentTile(
  doc: Pick<PsDocument, "width" | "height" | "layers" | "background">,
  rectInput: TileCanvasRect & ComposeDocumentTileOptions,
): HTMLCanvasElement {
  const rect = normalizeRect(rectInput, doc.width, doc.height)
  const canvas = makeCanvas(rect.w, rect.h)
  const ctx = canvas.getContext("2d")!
  if (!rectInput.transparent) {
    ctx.fillStyle = rectInput.matte ?? doc.background ?? "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  for (let index = 0; index < doc.layers.length; index++) {
    const layer = doc.layers[index]
    if (!layer.visible || layer.kind === "group") continue
    if (!supportsTileOnlyLayer(layer)) continue
    const clipMask = layer.clipped ? clippedBaseLayerCanvas(doc, index, rect) : null
    if (layer.kind === "adjustment" && layer.adjustment) {
      applyAdjustmentTile(ctx, layer, rect, clipMask)
      continue
    }
    const tile = renderLayerTileForComposite(layer, rect, doc, clipMask)
    compositeLayer(ctx, tile, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1, layer.advancedBlending)
  }
  return canvas
}
/* ------------------------------------------------------------------------- *
 * Tile-only viewport compositor planning
 *
 * The full document compositor (canvas-view.tsx) still builds an HTMLCanvasElement
 * sized to the *visible* viewport on every frame, and historically the same code
 * path materialized every layer's canvas at full document resolution before
 * cropping. For huge tile-mode documents we want the compositor to compute the
 * viewport-intersecting set of tiles and only request those tile rects from the
 * layer renderer — everything else stays cold in the tile store / OPFS.
 *
 * `planTileOnlyViewportCompose` is the pure planner the compositor calls to
 * decide which tiles to materialize at full res, which tiles to draw from the
 * progressive cache, and which tiles can stay on disk.
 *
 * NOTE (unflushed paths, intentionally documented):
 *   - canvas-view.tsx already tile-recomposes when `dirtyByLayer` is set, but
 *     the initial full compose still flattens the document into a canvas before
 *     drawing it. That is acceptable for documents that fit memory; for
 *     tile-only docs the caller should drive `planTileOnlyViewportCompose`
 *     manually and feed `composeDocumentTile` per visible tile.
 *   - WebGL compositor path in webgl-compositor.ts still allocates one large
 *     texture for the document. Item 18 tracks a tiled WebGL backend.
 *   - PSD I/O (document-io.ts) still flattens during *save* — this is not on
 *     the tile-only path because PSD encoding inherently needs the full
 *     composite for compatibility layer 0.
 * ------------------------------------------------------------------------- */
export interface TileOnlyViewportComposeInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  /** Viewport rect in document space. */
  viewport: DirtyRect
  /** Optional overscan so adjacent tiles can be prefetched. */
  prefetchPadding?: number
  /** Tiles that are known to be dirty and must re-render this frame. */
  dirtyRects?: readonly DirtyRect[]
  /** Tiles whose pixels are already cached. */
  cachedTileKeys?: readonly string[]
  /** Tiles that have been spilled to OPFS. */
  spilledTileKeys?: readonly string[]
}
export interface TileOnlyViewportTile extends TileOnlyTile {
  /** Tile intersects the visible viewport; must be at full res. */
  viewport: boolean
  /** Tile is inside the prefetch ring but outside the viewport. */
  prefetch: boolean
  /** Tile is dirty (something marked it so) and must be (re)rendered. */
  dirty: boolean
  /** Tile already has cached pixels available without re-rendering. */
  cached: boolean
  /** Tile sits on OPFS and must be paged in before composite. */
  spilled: boolean
}
export interface TileOnlyViewportComposePlan {
  strategy: "tile-local" | "fallback-full"
  tileSize: number
  viewport: DirtyRect
  prefetch: DirtyRect
  /** Tiles that need to be materialized this frame at full resolution. */
  materializeTiles: TileOnlyViewportTile[]
  /** Tiles that can be drawn from the existing tile cache (no work needed). */
  reuseTiles: TileOnlyViewportTile[]
  /** Tiles that should be paged in from OPFS before composite. */
  pageInTiles: TileOnlyViewportTile[]
  /** Tiles that should remain cold (off-screen + not adjacent + still cached). */
  retainColdTiles: TileOnlyViewportTile[]
  /** Tiles outside viewport+prefetch that are safe to evict to OPFS. */
  evictableTiles: TileOnlyViewportTile[]
  /** Pixel union of tiles that need to be redrawn into the framebuffer. */
  dirtyUnion: DirtyRect
  /** Pixel union of viewport-intersecting tiles. */
  viewportUnion: DirtyRect
  materializesFullDocument: false
  reasons: string[]
}
/**
 * Plan the compositor's per-tile work for a single frame. For huge documents
 * this avoids ever allocating a full-document canvas: only viewport tiles are
 * materialized, prefetch tiles can be queued, off-screen tiles can be evicted.
 */
export function planTileOnlyViewportCompose(input: TileOnlyViewportComposeInput): TileOnlyViewportComposePlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const viewport = normalizeRect(input.viewport, width, height)
  const prefetchPadding = Math.max(0, Math.ceil(Number(input.prefetchPadding ?? tileSize / 2)))
  const prefetch = inflateRect(viewport, prefetchPadding, width, height)
  const cached = new Set(input.cachedTileKeys ?? [])
  const spilled = new Set(input.spilledTileKeys ?? [])
  const dirtyKeys = new Set<string>()
  if (input.dirtyRects?.length) {
    for (const rect of input.dirtyRects) {
      for (const tile of tilesForRect(rect, width, height, tileSize)) dirtyKeys.add(tile.key)
    }
  }
  const grid = planTileGrid(width, height, tileSize)
  const viewportKeys = new Set(tilesForRect(viewport, width, height, tileSize).map((tile) => tile.key))
  const prefetchKeys = new Set(tilesForRect(prefetch, width, height, tileSize).map((tile) => tile.key))
  const materializeTiles: TileOnlyViewportTile[] = []
  const reuseTiles: TileOnlyViewportTile[] = []
  const pageInTiles: TileOnlyViewportTile[] = []
  const retainColdTiles: TileOnlyViewportTile[] = []
  const evictableTiles: TileOnlyViewportTile[] = []
  let dirtyUnion: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  let viewportUnion: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  for (let row = 0; row < grid.tileRows; row++) {
    for (let col = 0; col < grid.tileColumns; col++) {
      const key = `${col}:${row}`
      const rect = tileRect(col, row, width, height, tileSize)
      const inViewport = viewportKeys.has(key)
      const inPrefetch = prefetchKeys.has(key) && !inViewport
      const isDirty = dirtyKeys.has(key)
      const isCached = cached.has(key)
      const isSpilled = spilled.has(key)
      const tile: TileOnlyViewportTile = {
        key,
        col,
        row,
        rect,
        viewport: inViewport,
        prefetch: inPrefetch,
        dirty: isDirty,
        cached: isCached,
        spilled: isSpilled,
      }
      if (inViewport) {
        viewportUnion = unionDirtyRect(viewportUnion, rect)
        if (isDirty || (!isCached && !isSpilled)) {
          materializeTiles.push(tile)
          dirtyUnion = unionDirtyRect(dirtyUnion, rect)
        } else if (isSpilled) {
          pageInTiles.push(tile)
        } else {
          reuseTiles.push(tile)
        }
      } else if (inPrefetch) {
        if (isDirty) materializeTiles.push(tile)
        else if (isSpilled) pageInTiles.push(tile)
        else if (isCached) reuseTiles.push(tile)
        else retainColdTiles.push(tile)
      } else {
        if (isCached) evictableTiles.push(tile)
        else retainColdTiles.push(tile)
      }
    }
  }
  const reasons = [
    `viewport:${viewportKeys.size}`,
    `prefetch-padding:${prefetchPadding}`,
    `materialize:${materializeTiles.length}`,
    `reuse:${reuseTiles.length}`,
    `page-in:${pageInTiles.length}`,
    `cold:${retainColdTiles.length}`,
    `evict:${evictableTiles.length}`,
  ]
  return {
    strategy: "tile-local",
    tileSize,
    viewport,
    prefetch,
    materializeTiles,
    reuseTiles,
    pageInTiles,
    retainColdTiles,
    evictableTiles,
    dirtyUnion,
    viewportUnion,
    materializesFullDocument: false,
    reasons,
  }
}
export function planTileOnlyDefaultCompositor(input: TileOnlyDefaultCompositorInput): TileOnlyDefaultCompositorPlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const unsupportedLayerIds = input.layers
    .filter((layer) => !supportsTileOnlyLayer(layer))
    .map((layer) => layer.id)
  const viewportPlan = planTileOnlyViewportCompose({
    documentWidth: width,
    documentHeight: height,
    tileSize,
    viewport: input.viewport,
    prefetchPadding: input.prefetchPadding ?? 0,
    dirtyRects: input.dirtyRects,
    cachedTileKeys: input.cachedTileKeys,
    spilledTileKeys: input.spilledTileKeys,
  })
  const reasons: string[] = []
  const pixels = width * height
  const budget = Math.max(1, Math.floor(Number(input.canvasBudgetPixels ?? 10000 * 10000)))
  if (input.explicitTileOnly) reasons.push("explicit-tile-only")
  if (pixels > budget) reasons.push("huge-document")
  if (input.colorMode && input.colorMode !== "RGB") reasons.push("unsupported-color-mode")
  if ((input.bitDepth ?? 8) > 8) reasons.push("high-bit-fallback")
  if (input.quickMask) reasons.push("quick-mask-fallback")
  if ((input.filterPreviewCount ?? 0) > 0) reasons.push("filter-preview-fallback")
  if (unsupportedLayerIds.length) reasons.push("unsupported-layers")
  const compatible =
    unsupportedLayerIds.length === 0 &&
    (input.colorMode ?? "RGB") === "RGB" &&
    (input.bitDepth ?? 8) <= 8 &&
    !input.quickMask &&
    (input.filterPreviewCount ?? 0) === 0
  const shouldTile = compatible && (input.explicitTileOnly || pixels > budget)
  return {
    strategy: shouldTile ? "tile-local" : "fallback-full",
    viewportPlan,
    materializesFullDocument: !shouldTile,
    unsupportedLayerIds,
    reasons: reasons.length ? reasons : ["fits-full-frame"],
  }
}
export function renderTileOnlyViewportComposite(
  doc: Pick<PsDocument, "width" | "height" | "layers" | "background">,
  plan: Pick<TileOnlyDefaultCompositorPlan, "strategy" | "viewportPlan">,
  options: ComposeDocumentTileOptions = {},
): TileOnlyViewportRenderResult {
  const tiles = plan.viewportPlan.materializeTiles
    .filter((tile) => tile.viewport)
    .map((tile) => ({
      ...tile,
      canvas: composeDocumentTile(doc, {
        ...tile.rect,
        transparent: options.transparent ?? false,
        matte: options.matte,
      }),
    }))
  return {
    viewport: plan.viewportPlan.viewport,
    viewportUnion: plan.viewportPlan.viewportUnion,
    tiles,
    materializesFullDocument: false,
  }
}
function tileOnlyOperationKindForTool(tool: ToolId): TileOnlyOperation["kind"] | null {
  switch (tool) {
    case "brush":
    case "pencil":
    case "mixer-brush":
    case "pattern-stamp":
    case "color-replace":
      return "paint"
    case "eraser":
    case "background-eraser":
    case "magic-eraser":
      return "erase"
    case "clone-stamp":
    case "history-brush":
    case "art-history-brush":
      return "clone"
    case "healing-brush":
    case "spot-healing":
    case "patch-tool":
    case "remove-tool":
    case "red-eye":
      return "heal"
    case "blur":
      return "blur"
    case "sharpen":
      return "sharpen"
    case "smudge":
      return "smudge"
    case "dodge":
    case "burn":
    case "sponge":
      return "dodge-burn-sponge"
    default:
      return null
  }
}
export function planTileOnlyInteractiveTool(input: TileOnlyInteractiveToolInput): TileOnlyEditPlan {
  const kind = tileOnlyOperationKindForTool(input.tool)
  if (!kind) {
    const width = positiveInt(input.documentWidth, 1)
    const height = positiveInt(input.documentHeight, 1)
    const writeRect = normalizeRect(input.bounds, width, height)
    return {
      strategy: "unsupported",
      layerId: input.layerId,
      operationKind: "paint",
      readRect: writeRect,
      writeRect,
      readTiles: [],
      writeTiles: [],
      materializesFullDocument: false,
      reasons: [`tool:${input.tool}`],
      unsupportedReasons: ["unsupported-tool"],
    }
  }
  return planTileOnlyEdit({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    tileSize: input.tileSize,
    operation: {
      kind,
      tool: input.tool,
      layerId: input.layerId,
      bounds: input.bounds,
      radius: input.radius,
      sourceBounds: input.sourceBounds,
    },
  })
}
/* ------------------------------------------------------------------------- *
 * Paint-stroke damaged-tile tracking
 *
 * For brush/eraser/clone/heal/dodge-burn/sponge, the tool reads and writes only
 * the tiles a stroke physically touches. The reducer used to allocate a layer-
 * sized backing canvas per stroke; in tile-only mode, we instead compute the
 * `damagedTiles` set as the stroke advances and flush only those tiles back to
 * the tile store on commit.
 *
 * Usage:
 *   const tracker = createDamagedTileTracker({
 *     documentWidth: doc.width,
 *     documentHeight: doc.height,
 *     tileSize: 512,
 *     toolHalo: brushRadius + softnessHalo,
 *   })
 *   for (const sample of strokeSamples) tracker.touchPoint(sample.x, sample.y)
 *   const plan = tracker.commit() // -> writeTiles[], readTiles[] (with halo)
 * ------------------------------------------------------------------------- */
export interface DamagedTileTrackerInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  /** Halo (px) applied to every stamp so the read set picks up neighbors. */
  toolHalo?: number
}
export interface DamagedTileCommitPlan {
  writeTiles: TileOnlyTile[]
  readTiles: TileOnlyTile[]
  damagedRect: DirtyRect
  haloRect: DirtyRect
  materializesFullDocument: false
}
export interface DamagedTileTracker {
  /** Mark a paint stamp/dab. */
  touchStamp(rect: DirtyRect): void
  /** Convenience: mark a single point with the configured tool halo. */
  touchPoint(x: number, y: number, radius?: number): void
  /** Number of distinct touched tiles so far. */
  size(): number
  /** Snapshot the damaged tile keys; useful for live status / cursor previews. */
  damagedTileKeys(): string[]
  /** Snapshot of the damaged pixel rect so far (no halo). */
  damagedRect(): DirtyRect
  /** Build the final commit plan and reset internal state for the next stroke. */
  commit(): DamagedTileCommitPlan
}
export function createDamagedTileTracker(input: DamagedTileTrackerInput): DamagedTileTracker {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const halo = Math.max(0, Math.ceil(Number(input.toolHalo ?? 0)))
  const damaged = new Map<string, TileOnlyTile>()
  let damageRect: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  const touchStamp = (rect: DirtyRect) => {
    const clipped = normalizeRect(rect, width, height)
    if (isEmptyDirtyRect(clipped)) return
    damageRect = unionDirtyRect(damageRect, clipped)
    for (const tile of tilesForRect(clipped, width, height, tileSize)) damaged.set(tile.key, tile)
  }
  return {
    touchStamp,
    touchPoint(x, y, radius) {
      const r = Math.max(0, Math.ceil(Number(radius ?? halo)))
      const stamp: DirtyRect = { x: x - r, y: y - r, w: r * 2 + 1, h: r * 2 + 1 }
      touchStamp(stamp)
    },
    size() {
      return damaged.size
    },
    damagedTileKeys() {
      return [...damaged.keys()].sort()
    },
    damagedRect() {
      return { ...damageRect }
    },
    commit() {
      const writeTiles = [...damaged.values()].sort((a, b) => a.row - b.row || a.col - b.col)
      const haloRect = inflateRect(damageRect, halo, width, height)
      const readTiles = tilesForRect(haloRect, width, height, tileSize)
      const plan: DamagedTileCommitPlan = {
        writeTiles,
        readTiles,
        damagedRect: { ...damageRect },
        haloRect,
        materializesFullDocument: false,
      }
      damaged.clear()
      damageRect = { x: 0, y: 0, w: 0, h: 0 }
      return plan
    },
  }
}
/* ------------------------------------------------------------------------- *
 * Smart-object source-change re-render planning
 * ------------------------------------------------------------------------- */
export interface TileOnlySmartObjectUpdateInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  layerId: string
  /** The smart object's bounding rect on the final composite (document space). */
  renderBounds: DirtyRect
  /** Optional sub-rect of the source that changed; defaults to whole bounds. */
  sourceDirtyRect?: DirtyRect
  /** Edge halo (e.g., transform anti-aliasing) added around the dirty rect. */
  edgeHalo?: number
}
export interface TileOnlySmartObjectUpdatePlan {
  strategy: "tile-local"
  layerId: string
  operationKind: "smart-object"
  reRenderRect: DirtyRect
  writeRect: DirtyRect
  writeTiles: TileOnlyTile[]
  readTiles: TileOnlyTile[]
  materializesFullDocument: false
  reasons: string[]
}
/**
 * When a smart object's source updates, only the tiles within the layer's
 * render bounds intersected with the source-dirty rect need to be re-rendered.
 * Other tiles can keep their cached pixel data.
 */
export function planTileOnlySmartObjectUpdate(input: TileOnlySmartObjectUpdateInput): TileOnlySmartObjectUpdatePlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const halo = Math.max(0, Math.ceil(Number(input.edgeHalo ?? 0)))
  const bounds = normalizeRect(input.renderBounds, width, height)
  const dirty = input.sourceDirtyRect ? normalizeRect(input.sourceDirtyRect, width, height) : bounds
  const intersected = intersectDirtyRect(bounds, dirty)
  const writeRect = isEmptyDirtyRect(intersected) ? { x: 0, y: 0, w: 0, h: 0 } : intersected
  const inflated = halo > 0 ? inflateRect(writeRect, halo, width, height) : writeRect
  return {
    strategy: "tile-local",
    layerId: input.layerId,
    operationKind: "smart-object",
    reRenderRect: inflated,
    writeRect,
    writeTiles: tilesForRect(writeRect, width, height, tileSize),
    readTiles: tilesForRect(inflated, width, height, tileSize),
    materializesFullDocument: false,
    reasons: [
      `smart-object:${input.layerId}`,
      `bounds:${bounds.w}x${bounds.h}`,
      `halo:${halo}`,
    ],
  }
}
/* ------------------------------------------------------------------------- *
 * 3D / video tile-store routing
 *
 * The existing ray-tracer is already tiled (see three-d-video-engine
 * `rayTraceSceneTiled`). For huge documents in tile mode the renderer should
 * NOT allocate a full-frame canvas; instead each rendered tile is written
 * directly to a tile-store-shaped sink.
 *
 * `routeTiledRayTraceToTileStore` exposes the sink interface the engine wants:
 * the caller provides an `onTile(tile, imageData)` that writes into a
 * TiledBackingStore. Returning a function lets the caller bind a specific
 * layer/document id.
 *
 * The same sink works for tiled video-frame decoders (e.g., when the active
 * video frame is at the same canvas size as the document and is decomposed
 * into the same tile grid).
 * ------------------------------------------------------------------------- */
export interface TileOnlyRayTraceRouteInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
  /** Layer id whose tile store should receive the writes. */
  layerId: string
  /** Optional sub-region in document space; defaults to whole document. */
  bounds?: DirtyRect
}
export interface TileOnlyRayTraceRoutePlan {
  strategy: "tile-local"
  layerId: string
  operationKind: "3d" | "video"
  writeRect: DirtyRect
  writeTiles: TileOnlyTile[]
  materializesFullDocument: false
  reasons: string[]
}
export function planTileOnlyRayTraceRoute(
  input: TileOnlyRayTraceRouteInput & { kind?: "3d" | "video" },
): TileOnlyRayTraceRoutePlan {
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const bounds = input.bounds ? normalizeRect(input.bounds, width, height) : { x: 0, y: 0, w: width, h: height }
  const writeTiles = tilesForRect(bounds, width, height, tileSize)
  return {
    strategy: "tile-local",
    layerId: input.layerId,
    operationKind: input.kind ?? "3d",
    writeRect: bounds,
    writeTiles,
    materializesFullDocument: false,
    reasons: [`route:tile-store`, `tile-count:${writeTiles.length}`],
  }
}
export interface TileOnlySink {
  /** Called once per rendered tile. Implementations should write to the tile store. */
  onTile(tile: TileOnlyTile, image: ImageData): void | Promise<void>
}
/**
 * Wraps a TileOnlySink to be compatible with three-d-video-engine's
 * `rayTraceSceneTiled` `onTile` callback shape. Routes each engine tile to the
 * appropriate sink tile by `(col, row)` lookup so the engine can keep its own
 * scheduling/yield logic while the tile store stays the source of truth for
 * pixels — no full-frame canvas allocation needed.
 */
export function createTileOnlyRayTraceAdapter(
  plan: Pick<TileOnlyRayTraceRoutePlan, "writeTiles">,
  sink: TileOnlySink,
) {
  const byKey = new Map<string, TileOnlyTile>()
  for (const tile of plan.writeTiles) byKey.set(`${tile.col}:${tile.row}`, tile)
  return (engineTile: { key: string; col: number; row: number; rect: TileCanvasRect }, image: ImageData) => {
    const tile = byKey.get(`${engineTile.col}:${engineTile.row}`)
    if (!tile) return
    return sink.onTile(tile, image)
  }
}
/* ------------------------------------------------------------------------- *
 * Filter tile-margin routing
 *
 * `planTileOnlyFilter` already returns a `readHalo`. For kernel filters that
 * need neighbor samples, `planTileOnlyFilterMargin` lets the caller request an
 * inflated *read* rect per output tile so the worker has enough context to
 * avoid edge seams. The resulting pairs (writeTile, readRect) feed directly
 * into `applyFilterTiled` in filter-worker.ts via its `overlap` option.
 * ------------------------------------------------------------------------- */
export interface TileOnlyFilterMarginInput extends TileOnlyFilterInput {
  /** Override the auto-computed margin (e.g., raise for non-separable kernels). */
  overrideMargin?: number
}
export interface TileOnlyFilterMarginPair {
  tile: TileOnlyTile
  readRect: DirtyRect
  readTiles: TileOnlyTile[]
}
export interface TileOnlyFilterMarginPlan extends TileOnlyFilterPlan {
  /** Per-output-tile read rect inflated by the margin. */
  marginPairs: TileOnlyFilterMarginPair[]
  /** Effective margin in pixels (>= readHalo). */
  margin: number
}
export function planTileOnlyFilterMargin(input: TileOnlyFilterMarginInput): TileOnlyFilterMarginPlan {
  const base = planTileOnlyFilter(input)
  const width = positiveInt(input.documentWidth, 1)
  const height = positiveInt(input.documentHeight, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const margin = Math.max(base.readHalo, Math.max(0, Math.ceil(Number(input.overrideMargin ?? 0))))
  const marginPairs: TileOnlyFilterMarginPair[] = base.writeTiles.map((tile) => {
    const readRect = inflateRect(tile.rect, margin, width, height)
    return {
      tile,
      readRect,
      readTiles: tilesForRect(readRect, width, height, tileSize),
    }
  })
  return {
    ...base,
    margin,
    marginPairs,
  }
}
/* ------------------------------------------------------------------------- *
 * Tiled selection mask storage
 *
 * Marquee/lasso/wand should write into the relevant tiles only rather than
 * filling a full-document Uint8ClampedArray. The runtime store below holds
 * grayscale 8bpp tiles (one byte per pixel) and offers the same writeRect/
 * unionRect API as the pixel tile store. Memory is bounded by the document
 * dimensions and the configured tileSize.
 *
 * Marquee tools call `writeRect(rect, value=255)` then `commit()` to get the
 * dirty tile list; lasso/polygon tools call `writeMask(rect, maskBytes)` with
 * a precomputed pixel mask; wand tools call `applyMaskPredicate` per tile.
 * ------------------------------------------------------------------------- */
export type SelectionTileOp = "replace" | "add" | "subtract" | "intersect"
export interface TileOnlySelectionMaskInput {
  documentWidth: number
  documentHeight: number
  tileSize?: number
}
export interface TileOnlySelectionMaskSnapshot {
  totalTiles: number
  populatedTiles: number
  bytesAllocated: number
  bounds: DirtyRect
}
export class TileOnlySelectionMask {
  readonly width: number
  readonly height: number
  readonly tileSize: number
  readonly tileColumns: number
  readonly tileRows: number
  private readonly tiles = new Map<string, Uint8ClampedArray>()
  private dirtyBounds: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  constructor(input: TileOnlySelectionMaskInput) {
    this.width = positiveInt(input.documentWidth, 1)
    this.height = positiveInt(input.documentHeight, 1)
    this.tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
    const grid = planTileGrid(this.width, this.height, this.tileSize)
    this.tileColumns = grid.tileColumns
    this.tileRows = grid.tileRows
  }
  private tileAt(col: number, row: number): Uint8ClampedArray | null {
    return this.tiles.get(`${col}:${row}`) ?? null
  }
  private ensureTile(col: number, row: number): Uint8ClampedArray {
    const key = `${col}:${row}`
    let tile = this.tiles.get(key)
    if (tile) return tile
    const x = col * this.tileSize
    const y = row * this.tileSize
    const w = Math.min(this.tileSize, this.width - x)
    const h = Math.min(this.tileSize, this.height - y)
    tile = new Uint8ClampedArray(Math.max(1, w * h))
    this.tiles.set(key, tile)
    return tile
  }
  writeRect(rect: DirtyRect, value: number, op: SelectionTileOp = "replace"): TileOnlyTile[] {
    const clipped = normalizeRect(rect, this.width, this.height)
    if (isEmptyDirtyRect(clipped)) return []
    const touched: TileOnlyTile[] = []
    const v = Math.max(0, Math.min(255, Math.round(value)))
    for (const tile of tilesForRect(clipped, this.width, this.height, this.tileSize)) {
      const overlap = intersectDirtyRect(clipped, tile.rect)
      if (isEmptyDirtyRect(overlap)) continue
      const bytes = this.ensureTile(tile.col, tile.row)
      const tileW = tile.rect.w
      for (let yy = 0; yy < overlap.h; yy++) {
        const localY = overlap.y - tile.rect.y + yy
        const rowStart = localY * tileW + (overlap.x - tile.rect.x)
        for (let xx = 0; xx < overlap.w; xx++) {
          const offset = rowStart + xx
          const current = bytes[offset]
          if (op === "replace") bytes[offset] = v
          else if (op === "add") bytes[offset] = Math.min(255, current + v)
          else if (op === "subtract") bytes[offset] = Math.max(0, current - v)
          else if (op === "intersect") bytes[offset] = Math.min(current, v)
        }
      }
      touched.push(tile)
    }
    this.dirtyBounds = unionDirtyRect(this.dirtyBounds, clipped)
    return touched
  }
  writeMask(rect: DirtyRect, mask: Uint8ClampedArray | Uint8Array, op: SelectionTileOp = "replace"): TileOnlyTile[] {
    const clipped = normalizeRect(rect, this.width, this.height)
    if (isEmptyDirtyRect(clipped)) return []
    const touched: TileOnlyTile[] = []
    for (const tile of tilesForRect(clipped, this.width, this.height, this.tileSize)) {
      const overlap = intersectDirtyRect(clipped, tile.rect)
      if (isEmptyDirtyRect(overlap)) continue
      const bytes = this.ensureTile(tile.col, tile.row)
      const tileW = tile.rect.w
      for (let yy = 0; yy < overlap.h; yy++) {
        const localY = overlap.y - tile.rect.y + yy
        const maskY = overlap.y - clipped.y + yy
        for (let xx = 0; xx < overlap.w; xx++) {
          const offset = localY * tileW + (overlap.x - tile.rect.x) + xx
          const m = mask[maskY * clipped.w + (overlap.x - clipped.x) + xx]
          const current = bytes[offset]
          if (op === "replace") bytes[offset] = m
          else if (op === "add") bytes[offset] = Math.min(255, current + m)
          else if (op === "subtract") bytes[offset] = Math.max(0, current - m)
          else if (op === "intersect") bytes[offset] = Math.min(current, m)
        }
      }
      touched.push(tile)
    }
    this.dirtyBounds = unionDirtyRect(this.dirtyBounds, clipped)
    return touched
  }
  readRect(rect: DirtyRect): Uint8ClampedArray | null {
    const clipped = normalizeRect(rect, this.width, this.height)
    if (isEmptyDirtyRect(clipped)) return null
    const out = new Uint8ClampedArray(clipped.w * clipped.h)
    for (const tile of tilesForRect(clipped, this.width, this.height, this.tileSize)) {
      const bytes = this.tileAt(tile.col, tile.row)
      if (!bytes) continue
      const overlap = intersectDirtyRect(clipped, tile.rect)
      if (isEmptyDirtyRect(overlap)) continue
      const tileW = tile.rect.w
      for (let yy = 0; yy < overlap.h; yy++) {
        const localY = overlap.y - tile.rect.y + yy
        const dstY = overlap.y - clipped.y + yy
        const srcStart = localY * tileW + (overlap.x - tile.rect.x)
        const dstStart = dstY * clipped.w + (overlap.x - clipped.x)
        out.set(bytes.subarray(srcStart, srcStart + overlap.w), dstStart)
      }
    }
    return out
  }
  /** Sample a single mask byte (0 if outside or unallocated). */
  sample(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    const col = Math.floor(x / this.tileSize)
    const row = Math.floor(y / this.tileSize)
    const tile = this.tileAt(col, row)
    if (!tile) return 0
    const tileX = col * this.tileSize
    const tileY = row * this.tileSize
    const tileW = Math.min(this.tileSize, this.width - tileX)
    return tile[(y - tileY) * tileW + (x - tileX)]
  }
  clear(): void {
    this.tiles.clear()
    this.dirtyBounds = { x: 0, y: 0, w: 0, h: 0 }
  }
  snapshot(): TileOnlySelectionMaskSnapshot {
    let bytesAllocated = 0
    for (const tile of this.tiles.values()) bytesAllocated += tile.byteLength
    return {
      totalTiles: this.tileColumns * this.tileRows,
      populatedTiles: this.tiles.size,
      bytesAllocated,
      bounds: { ...this.dirtyBounds },
    }
  }
}
/* ------------------------------------------------------------------------- *
 * Tile-by-tile export streaming
 *
 * Many raster encoders accept the document as a single ImageData. For huge
 * documents we instead want the export pipeline to pull tiles one at a time
 * from a generator and stream them into the encoder. PNG (scanline-oriented)
 * and JPEG (8x8 MCU-oriented) can both accept row-major tiles. Other formats
 * (TIFF strip/tile, OpenEXR scanline) can also stream directly.
 *
 * `streamTileSequenceToScanlines` is a generator-friendly helper: given a
 * row-major tile producer, it yields full document rows so an encoder that
 * wants scanlines can call `for await` and never holds more than ~one tile
 * row of memory.
 *
 * For formats that *cannot* stream (some metadata-laden containers), the
 * caller should materialize to an OPFS-backed temp buffer first via
 * `materializeTileStreamToOpfsBlob`.
 * ------------------------------------------------------------------------- */
export interface TileStreamProducer {
  width: number
  height: number
  tileSize: number
  tileColumns: number
  tileRows: number
  /** Pulls the ImageData for one tile (row-major: row=0 col=0 then col=1 ... then row=1 col=0). */
  getTile(col: number, row: number): Promise<ImageData> | ImageData
}
/**
 * Yield one full document scanline at a time. Maintains a buffer of at most
 * `tileSize` rows (one tile row worth of pixels) and pulls tiles lazily.
 */
export async function* streamTileSequenceToScanlines(
  producer: TileStreamProducer,
): AsyncGenerator<{ y: number; row: Uint8ClampedArray }, void, void> {
  const { width, height, tileSize, tileColumns, tileRows } = producer
  for (let tileRow = 0; tileRow < tileRows; tileRow++) {
    const baseY = tileRow * tileSize
    const rowsInBand = Math.min(tileSize, height - baseY)
    const band = new Uint8ClampedArray(width * rowsInBand * 4)
    for (let tileCol = 0; tileCol < tileColumns; tileCol++) {
      const baseX = tileCol * tileSize
      const tileW = Math.min(tileSize, width - baseX)
      const image = await producer.getTile(tileCol, tileRow)
      for (let yy = 0; yy < rowsInBand; yy++) {
        const srcStart = yy * tileW * 4
        const dstStart = (yy * width + baseX) * 4
        band.set(image.data.subarray(srcStart, srcStart + tileW * 4), dstStart)
      }
    }
    for (let yy = 0; yy < rowsInBand; yy++) {
      yield {
        y: baseY + yy,
        row: band.subarray(yy * width * 4, (yy + 1) * width * 4),
      }
    }
  }
}
export interface TileStreamMaterializeOptions {
  /** Storage adapter (OPFS, IDB, in-memory) used to back the temp blob. */
  write: (key: string, blob: Blob) => Promise<void> | void
  /** Scratch key prefix; uniques per tile are appended. */
  keyPrefix: string
}
/**
 * Stream tiles to a sequence of small blobs in the provided storage adapter,
 * returning the manifest of stored chunks. Callers can then read the chunks
 * back into an encoder that needs the full image (e.g., a WASM encoder that
 * cannot accept scanlines). The whole stream never holds more than one tile
 * in JS memory at a time.
 */
export async function materializeTileStreamToOpfsBlob(
  producer: TileStreamProducer,
  options: TileStreamMaterializeOptions,
): Promise<{ keys: string[]; totalBytes: number; tileCount: number }> {
  const keys: string[] = []
  let totalBytes = 0
  for (let tileRow = 0; tileRow < producer.tileRows; tileRow++) {
    for (let tileCol = 0; tileCol < producer.tileColumns; tileCol++) {
      const image = await producer.getTile(tileCol, tileRow)
      const bytes = new Uint8Array(image.data.buffer.slice(0))
      const blob = new Blob([bytes])
      const key = `${options.keyPrefix}-${tileCol}-${tileRow}`
      await options.write(key, blob)
      keys.push(key)
      totalBytes += bytes.byteLength
    }
  }
  return { keys, totalBytes, tileCount: keys.length }
}
/**
 * Adapter: convert a `composeDocumentTile`-style function into a
 * TileStreamProducer that streams the whole document one tile at a time. The
 * compositor stays oblivious to the export — it just renders each tile rect.
 *
 * NOTE: the per-tile compose still relies on the layer renderer being able to
 * crop sources. Layer kinds rejected by `supportsTileOnlyLayer` (e.g., groups
 * without a pre-flattened canvas) will fall back to the browser-canvas path
 * upstream via `planTileOnlyExport`.
 */
export function createComposeTileStreamProducer(
  width: number,
  height: number,
  tileSize: number,
  compose: (rect: TileCanvasRect) => HTMLCanvasElement,
): TileStreamProducer {
  const grid = planTileGrid(width, height, tileSize)
  return {
    width,
    height,
    tileSize,
    tileColumns: grid.tileColumns,
    tileRows: grid.tileRows,
    async getTile(col, row) {
      const x = col * tileSize
      const y = row * tileSize
      const w = Math.min(tileSize, width - x)
      const h = Math.min(tileSize, height - y)
      const canvas = compose({ x, y, w, h })
      const ctx = canvas.getContext("2d")
      if (!ctx) return new ImageData(Math.max(1, w), Math.max(1, h))
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    },
  }
}
/* ------------------------------------------------------------------------- *
 * Documented remaining unflushed paths
 *
 * Items below still flatten to a full-document or full-layer canvas. They are
 * intentionally not silently degraded: callers can query
 * `getTileOnlyUnflushedPaths()` to surface limitations in diagnostics UI.
 *
 * Each entry has:
 *   - id:   stable identifier
 *   - area: human-readable subsystem
 *   - why:  reason a tile-local path is not yet wired
 *   - mitigation: what the runtime falls back to today
 * ------------------------------------------------------------------------- */
