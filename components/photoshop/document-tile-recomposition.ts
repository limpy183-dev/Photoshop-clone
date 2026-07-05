import { unionDirtyRects, type DirtyRect } from "./dirty-rect"
import type { Layer, PsDocument } from "./types"

export interface DocumentTileRecompositionInput {
  dirtyByLayer: Readonly<Record<string, readonly DirtyRect[]>>
  tileSize?: number
}

export interface DocumentRecompositionTile {
  key: string
  col: number
  row: number
  rect: { x: number; y: number; w: number; h: number }
}

export interface DocumentTileRecompositionPlan {
  strategy: "none" | "tile-isolated" | "full-frame"
  tiles: DocumentRecompositionTile[]
  compositeRect: { x: number; y: number; w: number; h: number }
  layersNeedingRecomposition: string[]
  reasons: string[]
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

function rectToTiles(
  rect: DirtyRect,
  width: number,
  height: number,
  tileSize: number,
): DocumentRecompositionTile[] {
  if (rect.w <= 0 || rect.h <= 0) return []
  const minCol = Math.max(0, Math.floor(rect.x / tileSize))
  const minRow = Math.max(0, Math.floor(rect.y / tileSize))
  const maxCol = Math.min(
    Math.ceil(width / tileSize) - 1,
    Math.floor((rect.x + rect.w - 1) / tileSize),
  )
  const maxRow = Math.min(
    Math.ceil(height / tileSize) - 1,
    Math.floor((rect.y + rect.h - 1) / tileSize),
  )
  const tiles: DocumentRecompositionTile[] = []
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const x = col * tileSize
      const y = row * tileSize
      tiles.push({
        key: `${col}:${row}`,
        col,
        row,
        rect: {
          x,
          y,
          w: Math.max(0, Math.min(tileSize, width - x)),
          h: Math.max(0, Math.min(tileSize, height - y)),
        },
      })
    }
  }
  return tiles
}

function tileUnion(tiles: DocumentRecompositionTile[]) {
  if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0 }
  return unionDirtyRects(tiles.map((tile) => tile.rect))
}

function layerReasons(layer: Layer): string[] {
  const reasons: string[] = []
  if ((layer.mask && layer.maskEnabled !== false) || layer.vectorMask) reasons.push("mask")
  if (layer.style || layer.smartFilters?.some((filter) => filter.enabled)) reasons.push("effects")
  if (layer.kind === "adjustment" && layer.adjustment) reasons.push("adjustment")
  if (layer.clipped) reasons.push("clipping-group")
  if (layer.smartObject || layer.kind === "smart-object") reasons.push("smart-object")
  if (layer.kind === "3d" || layer.threeD) reasons.push("3d")
  if (layer.kind === "text") reasons.push("text")
  if (layer.kind === "shape" || layer.path || layer.vectorMask) reasons.push("vector")
  if (layer.advancedBlending?.knockout && layer.advancedBlending.knockout !== "none") {
    reasons.push("knockout")
  }
  return reasons
}

function requiresFullColorManagement(
  doc: Pick<PsDocument, "colorMode" | "modeSettings" | "colorManagement">,
) {
  const mode = doc.modeSettings?.mode ?? doc.colorMode
  const color = doc.colorManagement
  return doc.colorMode !== "RGB" ||
    mode !== "RGB" ||
    color?.proofColors === true ||
    color?.gamutWarning === true ||
    !!color?.proofChannels?.length ||
    (!!color?.assignedProfile && color.assignedProfile !== "sRGB IEC61966-2.1")
}

export function planDocumentTileRecomposition(
  doc: Pick<PsDocument, "width" | "height" | "layers" | "colorMode" | "modeSettings" | "colorManagement">,
  input: DocumentTileRecompositionInput,
): DocumentTileRecompositionPlan {
  const dirtyRects = Object.values(input.dirtyByLayer).flatMap((rects) => [...rects])
  if (!dirtyRects.length) {
    return {
      strategy: "none",
      tiles: [],
      compositeRect: { x: 0, y: 0, w: 0, h: 0 },
      layersNeedingRecomposition: [],
      reasons: [],
    }
  }

  const tileSize = positiveInt(input.tileSize, 512)
  const dirtyUnion = unionDirtyRects(dirtyRects)
  const dirtyIds = new Set(Object.keys(input.dirtyByLayer))
  let firstDirtyIndex = doc.layers.findIndex((layer) => dirtyIds.has(layer.id))
  if (firstDirtyIndex < 0) firstDirtyIndex = 0
  const layersNeedingRecomposition = doc.layers
    .slice(firstDirtyIndex)
    .filter((layer) => layer.visible && layer.kind !== "group")
    .map((layer) => layer.id)
  const reasons = new Set<string>()
  for (const layer of doc.layers.slice(firstDirtyIndex)) {
    if (!layer.visible || layer.kind === "group") continue
    for (const reason of layerReasons(layer)) reasons.add(reason)
  }
  if (requiresFullColorManagement(doc)) reasons.add("color-management")

  const coverage = (dirtyUnion.w * dirtyUnion.h) / Math.max(1, doc.width * doc.height)
  const fullFrameReasons = new Set(["effects", "knockout", "color-management"])
  if (coverage >= 0.6 || [...reasons].some((reason) => fullFrameReasons.has(reason))) {
    if (coverage >= 0.6) reasons.add("full-frame")
    return {
      strategy: "full-frame",
      tiles: [],
      compositeRect: { x: 0, y: 0, w: doc.width, h: doc.height },
      layersNeedingRecomposition,
      reasons: [...reasons].sort(),
    }
  }

  const tiles = rectToTiles(dirtyUnion, doc.width, doc.height, tileSize)
  return {
    strategy: tiles.length ? "tile-isolated" : "none",
    tiles,
    compositeRect: tileUnion(tiles),
    layersNeedingRecomposition,
    reasons: [...reasons].sort(),
  }
}
