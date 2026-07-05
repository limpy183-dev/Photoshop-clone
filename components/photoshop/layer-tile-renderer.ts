import { compositeLayer } from "./blend-modes"
import { getFilter } from "./filters"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import { planRayTraceTiles, rayTraceScene, rayTraceSceneTiled, type ThreeDTilePlan } from "./three-d-video-engine"
import type { Layer } from "./types"
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

export interface LayerContentMaterializeOptions {
  documentSize?: { width: number; height: number }
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

function parseFixtureFillColor(value: unknown): [number, number, number, number] | null {
  if (typeof value !== "string") return null
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    const raw = hex[1]
    const full = raw.length === 3
      ? raw.split("").map((ch) => ch + ch).join("")
      : raw.padEnd(8, "f")
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      parseInt(full.slice(6, 8), 16),
    ]
  }
  const rgba = value.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!rgba) return null
  const parts = rgba[1].split(",").map((part) => Number(part.trim()))
  if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null
  return [
    Math.max(0, Math.min(255, Math.round(parts[0]))),
    Math.max(0, Math.min(255, Math.round(parts[1]))),
    Math.max(0, Math.min(255, Math.round(parts[2]))),
    Math.max(0, Math.min(255, Math.round((Number.isFinite(parts[3]) ? parts[3] : 1) * 255))),
  ]
}

function readCanvasImageData(canvas: HTMLCanvasElement, width = canvas.width, height = canvas.height): ImageData {
  const ctx = canvas.getContext("2d")
  const image = ctx?.getImageData(0, 0, width, height) ?? new ImageData(width, height)
  const hasVisiblePixels = image.data.some((value, index) => index % 4 === 3 && value > 0)
  const fill = !hasVisiblePixels ? parseFixtureFillColor((canvas as HTMLCanvasElement & { fill?: unknown }).fill) : null
  if (!fill) return image
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = fill[0]
    image.data[i + 1] = fill[1]
    image.data[i + 2] = fill[2]
    image.data[i + 3] = fill[3]
  }
  return image
}

function fixtureBackedImageData(canvas: HTMLCanvasElement): ImageData | null {
  const fixture = canvas as HTMLCanvasElement & { imageData?: ImageData | null; fill?: unknown }
  if (!fixture.imageData && fixture.fill === undefined) return null
  return readCanvasImageData(canvas)
}

function cropImageData(source: ImageData, rect: TileCanvasRect): ImageData {
  const out = new ImageData(Math.max(1, rect.w), Math.max(1, rect.h))
  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y
    if (sy < 0 || sy >= source.height) continue
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x
      if (sx < 0 || sx >= source.width) continue
      const sourceIndex = (sy * source.width + sx) * 4
      const targetIndex = (y * rect.w + x) * 4
      out.data[targetIndex] = source.data[sourceIndex]
      out.data[targetIndex + 1] = source.data[sourceIndex + 1]
      out.data[targetIndex + 2] = source.data[sourceIndex + 2]
      out.data[targetIndex + 3] = source.data[sourceIndex + 3]
    }
  }
  return out
}

function applySmartFiltersToCanvas(source: HTMLCanvasElement, smartFilters: Layer["smartFilters"]): HTMLCanvasElement {
  const enabled = smartFilters?.filter((filter) => filter.enabled) ?? []
  if (!enabled.length) return source
  const canvas = makeCanvas(source.width, source.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) return source
  ctx.drawImage(source, 0, 0)
  let current = readCanvasImageData(canvas)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
    if (opacity <= 0) {
      current = before
      continue
    }
    const mask = smartFilter.maskEnabled === false || !smartFilter.mask
      ? null
      : smartFilterMaskToImageData(smartFilter.mask, canvas.width, canvas.height, smartFilter.maskFeather ?? 0)
    if (!mask && opacity >= 1 && (smartFilter.blendMode ?? "normal") === "normal") {
      current = after
      continue
    }
    const overlay = new ImageData(new Uint8ClampedArray(after.data), canvas.width, canvas.height)
    if (mask) {
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          overlay.data[i + 3] = Math.round(overlay.data[i + 3] * smartFilterMaskAmountAt(mask, x, y, smartFilter.maskDensity ?? 1))
        }
      }
    }
    const baseCanvas = imageDataToCanvas(before)
    compositeLayer(baseCanvas.getContext("2d")!, imageDataToCanvas(overlay), smartFilter.blendMode ?? "normal", opacity)
    current = readCanvasImageData(baseCanvas)
  }
  ctx.putImageData(current, 0, 0)
  return canvas
}

export function materializeLayerContentCanvas(
  layer: Layer,
  options: LayerContentMaterializeOptions = {},
): HTMLCanvasElement {
  if (layer.kind === "3d" || layer.threeD) {
    const width = Math.max(1, Math.round(options.documentSize?.width ?? layer.canvas.width))
    const height = Math.max(1, Math.round(options.documentSize?.height ?? layer.canvas.height))
    return imageDataToCanvas(renderThreeDLayerTilePreview(layer, { x: 0, y: 0, w: width, h: height }, { width, height }))
  }

  if (layer.smartObject || layer.kind === "smart-object") {
    const source = layer.smartSource?.canvas ?? layer.canvas
    const canvas = makeCanvas(layer.canvas.width, layer.canvas.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) return canvas
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return applySmartFiltersToCanvas(canvas, layer.smartFilters)
  }

  return applySmartFiltersToCanvas(layer.canvas, layer.smartFilters)
}

export function renderTileCanvas(source: HTMLCanvasElement, rect: TileCanvasRect): HTMLCanvasElement {
  const canvas = makeCanvas(rect.w, rect.h)
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const fixturePixels = fixtureBackedImageData(source)
  if (fixturePixels) {
    ctx.putImageData(cropImageData(fixturePixels, rect), 0, 0)
    return canvas
  }
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
    return renderTileCanvas(materializeLayerContentCanvas(layer, { documentSize }), rect)
  }
  if (layer.smartFilters?.some((filter) => filter.enabled)) {
    return renderTileCanvas(materializeLayerContentCanvas(layer, { documentSize }), rect)
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

export interface ThreeDLayerTiledPreviewOptions {
  tileSize?: number
  onTile?: (tile: { key: string; col: number; row: number; rect: TileCanvasRect }, image: ImageData) => void
  maxTiles?: number
}

/**
 * Tile-by-tile preview pass for 3D layers — mirrors the filter-worker tile
 * pattern so callers can yield between tiles and stream progress. Useful for
 * large 3D layers where a single full-frame raytrace would block the main
 * thread for too long.
 */
export function renderThreeDLayerTilePreviewTiled(
  layer: Pick<Layer, "threeD">,
  rect: TileCanvasRect,
  documentSize: { width: number; height: number },
  options: ThreeDLayerTiledPreviewOptions = {},
): { image: ImageData; plan: ThreeDTilePlan } {
  if (!layer.threeD) {
    return {
      image: new ImageData(Math.max(1, rect.w), Math.max(1, rect.h)),
      plan: planRayTraceTiles(Math.max(1, rect.w), Math.max(1, rect.h), options.tileSize ?? 256),
    }
  }
  const plan = planRayTraceTiles(Math.max(1, rect.w), Math.max(1, rect.h), options.tileSize ?? 256)
  const image = rayTraceSceneTiled(layer.threeD, rect.w, rect.h, {
    viewport: rect,
    documentWidth: documentSize.width,
    documentHeight: documentSize.height,
    tileSize: options.tileSize,
    maxTiles: options.maxTiles,
    onTile: options.onTile,
  })
  return { image, plan }
}
