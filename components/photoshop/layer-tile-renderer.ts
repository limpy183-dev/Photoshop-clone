import { unionDirtyRects, type DirtyRect } from "./dirty-rect"
import { planTileGrid } from "./performance-engine"
import { rayTraceScene } from "./three-d-video-engine"
import type { Layer, PsDocument } from "./types"
import {
  createLayerTileAddress,
  type LayerTileAddress,
  type LayerTileKind,
} from "./tiled-backing-store"

export interface LayerTileRef {
  col: number
  row: number
  tileSize: number
  documentWidth: number
  documentHeight: number
}

export interface TileCanvasRect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayerTileRenderPlan {
  address: LayerTileAddress
  rect: TileCanvasRect
  cacheable: boolean
  dependencies: string[]
  contentSource: "canvas" | "smart-source" | "3d-preview" | "adjustment-input"
}

export interface LayerTileBackingStoreLike {
  getOrRenderLayerTile(
    address: LayerTileAddress,
    render: (address: LayerTileAddress) => Blob | Promise<Blob>,
  ): Promise<Blob>
}

export interface LayerTileCanvasCodec {
  encodeCanvas?: (canvas: HTMLCanvasElement, plan: LayerTileRenderPlan) => Blob | Promise<Blob>
  decodeCanvas?: (blob: Blob, plan: LayerTileRenderPlan) => HTMLCanvasElement | Promise<HTMLCanvasElement>
  documentSize?: { width: number; height: number }
  mimeType?: string
  quality?: number
}

export interface DocumentTileRecompositionInput {
  dirtyByLayer: Readonly<Record<string, readonly DirtyRect[]>>
  tileSize?: number
}

export interface DocumentRecompositionTile {
  key: string
  col: number
  row: number
  rect: TileCanvasRect
}

export interface DocumentTileRecompositionPlan {
  strategy: "none" | "tile-isolated" | "full-frame"
  tiles: DocumentRecompositionTile[]
  compositeRect: TileCanvasRect
  layersNeedingRecomposition: string[]
  reasons: string[]
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

function tileRect(ref: LayerTileRef): TileCanvasRect {
  const x = Math.max(0, Math.round(ref.col) * ref.tileSize)
  const y = Math.max(0, Math.round(ref.row) * ref.tileSize)
  return {
    x,
    y,
    w: Math.max(0, Math.min(ref.tileSize, ref.documentWidth - x)),
    h: Math.max(0, Math.min(ref.tileSize, ref.documentHeight - y)),
  }
}

function stableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== "object") return value
  if (typeof (value as { getContext?: unknown }).getContext === "function") {
    const canvas = value as HTMLCanvasElement
    return { canvasWidth: canvas.width, canvasHeight: canvas.height }
  }
  if (Array.isArray(value)) return value.map(stableValue)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === "canvas" || key === "fileHandle") continue
    const next = (value as Record<string, unknown>)[key]
    if (typeof next === "function") continue
    out[key] = stableValue(next)
  }
  return out
}

function stableString(value: unknown) {
  return JSON.stringify(stableValue(value))
}

function smartObjectSourceVersion(layer: Layer) {
  const source = layer.smartSource
  if (!source) return `canvas:${layer.canvas.width}x${layer.canvas.height}`
  return [
    `id:${source.id ?? layer.id}`,
    `hash:${source.sourceHash ?? ""}`,
    `updated:${source.updatedAt ?? ""}`,
    `modified:${source.lastKnownModified ?? ""}`,
    `relinked:${source.relinkedAt ?? ""}`,
    `file:${source.relativePath ?? source.fileName ?? source.name ?? ""}`,
    `size:${source.width ?? source.canvas?.width ?? layer.canvas.width}x${source.height ?? source.canvas?.height ?? layer.canvas.height}`,
    `status:${source.status ?? ""}`,
  ].join("|")
}

function smartObjectDependencies(layer: Layer): string[] {
  const dependencies = [smartObjectSourceVersion(layer)]
  if (layer.smartFilters?.length) dependencies.push(`smartFilters:${stableString(layer.smartFilters)}`)
  return dependencies
}

function editableLayerDependencies(layer: Layer): string[] {
  const dependencies = [
    `kind:${layer.kind ?? "raster"}`,
    `canvas:${layer.canvas.width}x${layer.canvas.height}`,
    `opacity:${layer.opacity}`,
    `fill:${layer.fillOpacity ?? 1}`,
    `blend:${layer.blendMode}`,
  ]
  if (layer.text) dependencies.push(`text:${stableString(layer.text)}`)
  if (layer.shape) dependencies.push(`shape:${stableString(layer.shape)}`)
  if (layer.path) dependencies.push(`path:${stableString(layer.path)}`)
  if (layer.vectorMask) dependencies.push(`vectorMask:${stableString(layer.vectorMask)}`)
  if (layer.style) dependencies.push(`style:${stableString(layer.style)}`)
  if (layer.smartFilters?.length) dependencies.push(`smartFilters:${stableString(layer.smartFilters)}`)
  return dependencies
}

export function layerTileKindForLayer(layer: Layer): LayerTileKind {
  if (layer.smartObject || layer.kind === "smart-object") return "smart-object"
  if (layer.kind === "3d" || layer.threeD) return "3d"
  if (layer.kind === "adjustment") return "adjustment"
  if (layer.path || layer.vectorMask) return "vector"
  if (layer.kind === "text") return "text"
  if (layer.kind === "shape") return "shape"
  return "raster"
}

export function threeDCameraTileKey(layer: Pick<Layer, "threeD">): string {
  const scene = layer.threeD
  if (!scene) return "camera:none"
  const camera = scene.camera
  return [
    `pos:${camera.position.x},${camera.position.y},${camera.position.z}`,
    `target:${camera.target.x},${camera.target.y},${camera.target.z}`,
    `fov:${camera.fov}`,
    `focal:${camera.focalLength}`,
    `scene:${stableString({ objects: scene.objects, materials: scene.materials, lights: scene.lights })}`,
  ].join("|")
}

export function layerTileAddressForLayer(layer: Layer, ref: LayerTileRef): LayerTileAddress {
  const kind = layerTileKindForLayer(layer)
  if (kind === "3d") {
    return createLayerTileAddress({
      layerId: layer.id,
      layerKind: kind,
      col: ref.col,
      row: ref.row,
      cameraKey: threeDCameraTileKey(layer),
    })
  }
  const dependencies = kind === "smart-object" ? smartObjectDependencies(layer) : editableLayerDependencies(layer)
  return createLayerTileAddress({
    layerId: layer.id,
    layerKind: kind,
    col: ref.col,
    row: ref.row,
    sourceVersion: dependencies.join("||"),
  })
}

export function planLayerTileRender(layer: Layer, ref: LayerTileRef): LayerTileRenderPlan {
  const kind = layerTileKindForLayer(layer)
  const dependencies = kind === "smart-object"
    ? smartObjectDependencies(layer)
    : kind === "3d"
      ? [threeDCameraTileKey(layer)]
      : editableLayerDependencies(layer)
  return {
    address: layerTileAddressForLayer(layer, ref),
    rect: tileRect(ref),
    cacheable: layer.visible !== false && kind !== "adjustment",
    dependencies,
    contentSource: kind === "smart-object" ? "smart-source" : kind === "3d" ? "3d-preview" : kind === "adjustment" ? "adjustment-input" : "canvas",
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = makeCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  if (ctx) ctx.putImageData(image, 0, 0)
  return canvas
}

export function renderTileCanvas(source: HTMLCanvasElement, rect: TileCanvasRect): HTMLCanvasElement {
  const canvas = makeCanvas(rect.w, rect.h)
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return canvas
}

export function renderLayerContentTile(
  layer: Layer,
  rect: TileCanvasRect,
  documentSize?: { width: number; height: number },
): HTMLCanvasElement {
  if (layer.kind === "3d" || layer.threeD) {
    return imageDataToCanvas(renderThreeDLayerTilePreview(layer, rect, documentSize ?? {
      width: layer.canvas.width,
      height: layer.canvas.height,
    }))
  }
  if (layer.smartObject || layer.kind === "smart-object") {
    const source = layer.smartSource?.canvas ?? layer.canvas
    const canvas = makeCanvas(rect.w, rect.h)
    const ctx = canvas.getContext("2d")
    if (!ctx) return canvas
    const scaleX = source.width / Math.max(1, layer.canvas.width)
    const scaleY = source.height / Math.max(1, layer.canvas.height)
    ctx.drawImage(
      source,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.w * scaleX,
      rect.h * scaleY,
      0,
      0,
      rect.w,
      rect.h,
    )
    return canvas
  }
  return renderTileCanvas(layer.canvas, rect)
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType = "image/png", quality?: number): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Could not encode layer tile"))
      }, mimeType, quality)
    })
  }
  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL(mimeType, quality)
    return fetch(dataUrl).then((response) => response.blob())
  }
  return Promise.reject(new Error("Canvas tile encoding is unavailable"))
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob)
    const canvas = makeCanvas(bitmap.width, bitmap.height)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
  }
  const image = new Image()
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Could not decode layer tile"))
      image.src = url
    })
    const canvas = makeCanvas(image.naturalWidth || 1, image.naturalHeight || 1)
    canvas.getContext("2d")?.drawImage(image, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function renderLayerTileForBackingStore(
  store: LayerTileBackingStoreLike,
  layer: Layer,
  ref: LayerTileRef,
  codec: LayerTileCanvasCodec = {},
): Promise<HTMLCanvasElement> {
  const plan = planLayerTileRender(layer, ref)
  const blob = await store.getOrRenderLayerTile(plan.address, async () => {
    const canvas = renderLayerContentTile(layer, plan.rect, codec.documentSize ?? {
      width: ref.documentWidth,
      height: ref.documentHeight,
    })
    return codec.encodeCanvas
      ? codec.encodeCanvas(canvas, plan)
      : canvasToBlob(canvas, codec.mimeType, codec.quality)
  })
  return codec.decodeCanvas ? codec.decodeCanvas(blob, plan) : blobToCanvas(blob)
}

export function renderThreeDLayerTilePreview(
  layer: Pick<Layer, "threeD">,
  rect: TileCanvasRect,
  documentSize: { width: number; height: number },
): ImageData {
  if (!layer.threeD) return new ImageData(Math.max(1, rect.w), Math.max(1, rect.h))
  return rayTraceScene(layer.threeD, rect.w, rect.h, {
    viewport: rect,
    documentWidth: documentSize.width,
    documentHeight: documentSize.height,
  })
}

function rectToTiles(rect: DirtyRect, width: number, height: number, tileSize: number): DocumentRecompositionTile[] {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h))
  if (x1 <= x0 || y1 <= y0) return []
  const grid = planTileGrid(width, height, tileSize)
  const col0 = Math.max(0, Math.floor(x0 / tileSize))
  const row0 = Math.max(0, Math.floor(y0 / tileSize))
  const col1 = Math.min(grid.tileColumns - 1, Math.floor((x1 - 1) / tileSize))
  const row1 = Math.min(grid.tileRows - 1, Math.floor((y1 - 1) / tileSize))
  const tiles: DocumentRecompositionTile[] = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
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

function tileUnion(tiles: DocumentRecompositionTile[]): TileCanvasRect {
  if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0 }
  const rect = unionDirtyRects(tiles.map((tile) => tile.rect))
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
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
  return reasons
}

export function planDocumentTileRecomposition(
  doc: Pick<PsDocument, "width" | "height" | "layers">,
  input: DocumentTileRecompositionInput,
): DocumentTileRecompositionPlan {
  const dirtyRects = Object.values(input.dirtyByLayer).flatMap((rects) => [...rects])
  if (!dirtyRects.length) {
    return { strategy: "none", tiles: [], compositeRect: { x: 0, y: 0, w: 0, h: 0 }, layersNeedingRecomposition: [], reasons: [] }
  }

  const tileSize = positiveInt(input.tileSize, 512)
  const dirtyUnion = unionDirtyRects(dirtyRects)
  const coverage = (dirtyUnion.w * dirtyUnion.h) / Math.max(1, doc.width * doc.height)
  if (coverage >= 0.6) {
    return {
      strategy: "full-frame",
      tiles: [],
      compositeRect: { x: 0, y: 0, w: doc.width, h: doc.height },
      layersNeedingRecomposition: doc.layers.filter((layer) => layer.visible && layer.kind !== "group").map((layer) => layer.id),
      reasons: ["full-frame"],
    }
  }

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
  const tiles = rectToTiles(dirtyUnion, doc.width, doc.height, tileSize)
  return {
    strategy: tiles.length ? "tile-isolated" : "none",
    tiles,
    compositeRect: tileUnion(tiles),
    layersNeedingRecomposition,
    reasons: [...reasons].sort(),
  }
}
