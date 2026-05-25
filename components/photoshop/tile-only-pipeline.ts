import { isAdjustmentNoop } from "./adjustment-layers"
import { compositeLayer } from "./blend-modes"
import { isEmptyDirtyRect, intersectDirtyRect, unionDirtyRects, type DirtyRect } from "./dirty-rect"
import { getFilter } from "./filters"
import { planExpensiveFilterTiling } from "./filter-worker"
import { renderLayerContentTile, type TileCanvasRect } from "./layer-tile-renderer"
import { planTileGrid } from "./performance-engine"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import type { BlendMode, Layer, LayerKind, PsDocument } from "./types"
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

export interface ComposeDocumentTileOptions {
  transparent?: boolean
  matte?: string
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
